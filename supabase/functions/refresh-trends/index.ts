import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";
import { normalizeProductionType, REQUIRED_TREND_TYPES } from "../_shared/trendsNormalize.ts";
import { resolveGateway } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-iffy-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getFormatBucketFromProdType(pt: string): string {
  const p = (pt || "").toLowerCase().replace(/_/g, "-");
  if (p === "vertical-drama") return "vertical_drama";
  if (["documentary", "documentary-series", "hybrid-documentary"].includes(p)) return "documentary";
  return "film";
}

// Cooldown windows in hours per trigger type
const COOLDOWN_HOURS: Record<string, number> = {
  manual: 6,
  backfill: 1,
  scheduled: 144, // 6 days
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Ping
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, build: "refresh-trends-v2" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const _gw = resolveGateway();
  const lovableApiKey = _gw.apiKey;
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  let runId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    const cronSecret = req.headers.get("X-IFFY-CRON-SECRET");
    const expectedCronSecret = Deno.env.get("IFFY_CRON_SECRET");

    let isCronAuth = false;

    // Mode 1: Cron secret auth (scheduled calls, no user session)
    if (cronSecret && expectedCronSecret && cronSecret === expectedCronSecret) {
      isCronAuth = true;
      console.log("[refresh-trends] Authenticated via cron secret");
    }
    // Mode 2: User JWT auth
    else if (authHeader?.startsWith("Bearer ")) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await anonClient.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Neither valid
    else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    let productionType: string | null = null;
    let scope: string = "all";
    let trigger: string = "manual";
    let force = false;
    try {
      const body = await req.json();
      productionType = body.production_type || null;
      scope = body.scope || "all";
      trigger = body.trigger || "manual";
      force = !!body.force;
    } catch {
      // No body or invalid JSON
    }

    // scope='required_types' → loop all required types sequentially
    if (scope === "required_types" && !productionType) {
      const results: any[] = [];
      for (const reqType of REQUIRED_TREND_TYPES) {
        console.log(`[refresh-trends] scope=required_types, refreshing: ${reqType}`);
        const selfUrl = `${supabaseUrl}/functions/v1/refresh-trends`;
        const subHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (isCronAuth && expectedCronSecret) {
          subHeaders["X-IFFY-CRON-SECRET"] = expectedCronSecret;
        } else if (authHeader) {
          subHeaders["Authorization"] = authHeader;
        }
        try {
          const subRes = await fetch(selfUrl, {
            method: "POST",
            headers: subHeaders,
            body: JSON.stringify({ production_type: reqType, scope: "one", trigger }),
          });
          const subData = await subRes.json();
          results.push({ production_type: reqType, status: subRes.status, ...subData });
        } catch (e: any) {
          results.push({ production_type: reqType, error: e.message });
        }
      }
      return new Response(JSON.stringify({ ok: true, scope: "required_types", results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Per-type cooldown check ──
    const requestedTypes = productionType ? [productionType] : [...REQUIRED_TREND_TYPES];
    const cooldownHours = COOLDOWN_HOURS[trigger] || COOLDOWN_HOURS.manual;

    if (!force) {
      const cooldownCutoff = new Date(Date.now() - cooldownHours * 3600_000).toISOString();
      // Check runs that completed THIS specific type (not global)
      const typesToCheck = productionType ? [productionType] : [...REQUIRED_TREND_TYPES];
      const { data: recentRuns } = await supabase
        .from("trend_refresh_runs")
        .select("id, created_at, completed_types")
        .eq("ok", true)
        .gte("created_at", cooldownCutoff)
        .contains("completed_types", typesToCheck)
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentRuns && recentRuns.length > 0) {
        const lastRunAt = recentRuns[0].created_at;
        const nextAllowed = new Date(new Date(lastRunAt).getTime() + cooldownHours * 3600_000).toISOString();
        return new Response(JSON.stringify({
          error: "COOLDOWN_ACTIVE",
          production_type: productionType || "all",
          last_run_at: lastRunAt,
          next_allowed_at: nextAllowed,
          cooldown_hours: cooldownHours,
          cooldown_scope: productionType ? "per-type" : "all",
          trigger,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Create run log entry ──
    const { data: runRow, error: runInsertErr } = await supabase
      .from("trend_refresh_runs")
      .insert({
        trigger,
        scope: productionType ? "one" : scope,
        requested_types: requestedTypes,
        model_trends: "google/gemini-2.5-flash",
        model_grounding: PERPLEXITY_API_KEY ? "perplexity/sonar" : null,
        recency_filter: "week",
        ok: false,
      })
      .select("id")
      .single();

    if (runInsertErr) {
      console.error("[refresh-trends] Failed to create run log:", runInsertErr);
    } else {
      runId = runRow.id;
    }
    console.log(`[refresh-trends] run_id=${runId} trigger=${trigger} types=${requestedTypes.join(",")}`);

    const typeFilter = productionType ? ` for production_type="${productionType}"` : "";
    const typeInstruction = productionType
      ? `IMPORTANT: Generate signals ONLY for production_type = "${productionType}". Every signal must have production_type set to "${productionType}".`
      : `Distribute signals across production types: film, tv-series, documentary, commercial, branded-content, music-video, short-film, digital-series, vertical-drama.`;

    // Fetch existing signals for context
    let signalQuery = supabase
      .from("trend_signals")
      .select("name, category, cycle_phase, status")
      .eq("status", "active");
    let castQuery = supabase
      .from("cast_trends")
      .select("actor_name, region, trend_type, status")
      .eq("status", "active");

    if (productionType) {
      signalQuery = signalQuery.eq("production_type", productionType);
      castQuery = castQuery.eq("production_type", productionType);
    }

    const { data: existingSignals } = await signalQuery;
    const { data: existingCast } = await castQuery;

    const existingSignalNames = (existingSignals || []).map((s: any) => s.name).join(", ");
    const existingCastNames = (existingCast || []).map((c: any) => c.actor_name).join(", ");

    // ── Perplexity grounded market intelligence ──
    let perplexityMarketData = "";
    let perplexityCitations: Array<{ title?: string; url: string; source?: string; snippet?: string }> = [];
    if (PERPLEXITY_API_KEY) {
      try {
        const pType = productionType || "film";
        const pResponse = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You are an entertainment industry market analyst. Return factual, current market data with specifics." },
              { role: "user", content: `What are the current major trends, shifts, and signals in the ${pType} industry as of 2026? Include: genre trends, buyer appetite changes, talent market shifts, festival/market buzz, streaming vs theatrical dynamics, international co-production activity, and any emerging formats or technologies. Be specific with recent examples and data points.` },
            ],
            search_recency_filter: "week",
          }),
        });
        if (pResponse.ok) {
          const pData = await pResponse.json();
          perplexityMarketData = pData.choices?.[0]?.message?.content || "";
          console.log("Perplexity market intelligence fetched successfully");

          const rawCitations: string[] = pData.citations || [];
          const seenUrls = new Set<string>();
          for (const item of rawCitations) {
            try {
              const url = typeof item === "string" ? item : (item as any)?.url;
              if (!url || typeof url !== "string" || !url.match(/^https?:\/\//)) continue;
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);
              let hostname = "";
              try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch {}
              perplexityCitations.push({
                url,
                title: (item as any)?.title || hostname || undefined,
                source: hostname || undefined,
              });
            } catch {}
          }
          perplexityCitations = perplexityCitations.slice(0, 8);
          console.log(`[refresh-trends] Extracted ${perplexityCitations.length} citations from Perplexity`);
        }
      } catch (e) {
        console.warn("Perplexity market research failed:", e);
      }
    }

    const groundedContext = perplexityMarketData
      ? `\n\n=== REAL-TIME MARKET INTELLIGENCE (from live web search) ===\n${perplexityMarketData}\n=== END MARKET INTELLIGENCE ===\n\nIMPORTANT: Use the above real-time data to ground your signals in current reality. Prioritize trends that are confirmed by this research.`
      : "";

    const isVerticalDrama = productionType === "vertical-drama";
    const verticalDramaContext = isVerticalDrama
      ? `\n\nThis is VERTICAL DRAMA — short-form, mobile-first narrative content for platforms like TikTok, ReelShort, DramaBox, ShortTV, GoodShort. Focus on:
- Platform algorithm shifts and ranking changes
- Scroll retention and episodic hook patterns  
- Micro-genre heat (e.g. CEO romance, revenge arcs, time-loop)
- Creator/influencer momentum for short-form
- Monetisation models (micro-transactions, ad-supported, subscription)
- China-origin vs Western-entry market dynamics
- App store ranking momentum
Categories for vertical-drama: Platform Algorithm, Scroll Retention, Cast Social Value, Micro-Genre Heat, Monetisation Model, Regional Expansion, Content Innovation, Creator Economy`
      : "";

    // --- REFRESH STORY TREND SIGNALS ---
    const guardrails = buildGuardrailBlock({ productionType: productionType || "film", engineName: "refresh-trends" });
    console.log(`[refresh-trends] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const signalPrompt = `You are an international film, television, and commercial content market intelligence analyst. Your job is to identify emerging, building, peaking, and declining signals across the entertainment and content industry.

${guardrails.textBlock}

Current active signals${typeFilter}: ${existingSignalNames || "None"}

Research and return an updated set of 10-15 trend signals${typeFilter}. For each existing signal, assess whether its cycle_phase should change (Early → Building → Peaking → Declining → Dead). Remove signals that are no longer relevant. Add new signals you detect.

${typeInstruction}
${verticalDramaContext}
${groundedContext}

For commercial and branded-content signals, use category terms like "Brand Strategy", "Creative Direction", "Client Behaviour", "Content Innovation" — never use film-distribution terminology like "pre-sales", "sales agent", "theatrical", etc.

Categories by production type:
- film/tv-series: Narrative, IP, Market Behaviour, Buyer Appetite, Genre Cycle
- commercial: Brand Strategy, Creative Direction, Production Innovation, Award Cycles, Client Behaviour
- branded-content: Brand Strategy, Platform Behaviour, Cultural Shifts, Engagement Patterns, Content Innovation
- documentary: Subject Access, Impact Trends, Broadcaster Appetite, Grant Cycles, Archive Innovation
- music-video: Visual Innovation, Artist Momentum, Platform Strategy, Commissioner Behaviour
- short-film/digital-series: Festival Cycles, Platform Algorithm, Creator Economy, Format Innovation
- vertical-drama: Platform Algorithm, Scroll Retention, Cast Social Value, Micro-Genre Heat, Monetisation Model, Regional Expansion, Content Innovation, Creator Economy

Cycle phases: Early, Building, Peaking, Declining
Regions: US, UK, Europe, Asia, LatAm, International, MENA, Africa, China
Velocity: Rising, Stable, Declining
Saturation Risk: Low, Medium, High
Budget Tiers: Micro, Low, Mid, Upper-Mid, High, Studio-Scale
Dimensions: visual_style, narrative, platform, monetization, talent, format, market_behavior, buyer_appetite

For each signal provide:
- name: concise signal name
- category: one of the categories for its production type
- cycle_phase: current phase
- explanation: 2-3 sentences explaining the signal, evidence, and implications
- sources_count: estimated number of independent sources (3-8)
- genre_tags: relevant genres (array)
- tone_tags: relevant tones (array)
- format_tags: relevant formats (array)
- region: primary region
- lane_relevance: which finance lanes this affects (array)
- production_type: "${productionType || "film"}"
- strength: 1-10 integer
- velocity: Rising, Stable, or Declining
- saturation_risk: Low, Medium, or High
- forecast: one sentence 12-month outlook
- budget_tier: one of Micro, Low, Mid, Upper-Mid, High, Studio-Scale
- target_buyer: the primary buyer type relevant to this signal's production type
- dimension: one of visual_style, narrative, platform, monetization, talent, format, market_behavior, buyer_appetite (REQUIRED)
- modality: one of animation, live_action, hybrid, or null if not applicable
- style_tags: array of visual style tags (e.g. ["anime", "painterly2d", "toon_shading"]) — empty if not visual
- narrative_tags: array of narrative tags (e.g. ["ceo_romance", "revenge_arc", "timeloop"]) — empty if not narrative

Return ONLY a JSON array of signal objects. No markdown, no explanation outside the JSON.`;

    const castLabel = isVerticalDrama ? "creator/talent" : "talent";
    const castPrompt = `You are an international entertainment ${castLabel} analyst focused on finance-relevant talent intelligence. Your job is to identify talent whose market momentum is shifting in ways that affect project packaging and finance.

Current tracked ${castLabel}${typeFilter}: ${existingCastNames || "None"}

Research and return an updated set of 10-15 ${castLabel} trends${typeFilter}. For existing entries, update their cycle_phase and timing_window. Remove entries whose momentum has stalled. Add new emerging talent.

${typeInstruction}
${isVerticalDrama ? "\nFor vertical-drama, track creators, influencers, and actors with strong social media/short-form presence. Focus on those with proven scroll-stopping ability, not traditional film credentials." : ""}
${groundedContext}

Focus on talent relevant to international content — not just Hollywood A-listers. Include talent from UK, Europe, Asia, LatAm, and Australia/NZ.

Trend types: Emerging, Accelerating, Resurgent, Declining
Cycle phases: Early, Building, Peaking, Declining
Velocity: Rising, Stable, Declining
Saturation Risk: Low, Medium, High

For each entry provide:
- actor_name: full name
- region: primary region
- age_band: 18-25, 26-35, 36-45, 46-55, 55+
- trend_type: one of the types above
- explanation: 2-3 sentences on why this talent's momentum matters
- genre_relevance: array of relevant genres or specialties
- market_alignment: Studio, Indie, Streamer, Brand, or Agency
- cycle_phase: current phase
- sales_leverage: one of Pre-sales friendly, MG-driven, Festival-driven, Streamer-oriented, Brand-aligned
- timing_window: e.g. "Strong next 6-12 months"
- production_type: "${productionType || "film"}"
- strength: 1-10 integer
- velocity: Rising, Stable, or Declining
- saturation_risk: Low, Medium, or High
- forecast: one sentence 12-month outlook
- budget_tier: one of Micro, Low, Mid, Upper-Mid, High, Studio-Scale
- target_buyer: the primary buyer type relevant to this talent's production type

Return ONLY a JSON array of objects. No markdown, no explanation outside the JSON.`;

    // Make both AI calls in parallel
    const [signalResponse, castResponse] = await Promise.all([
      fetch(_gw.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: signalPrompt }],
        }),
      }),
      fetch(_gw.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: castPrompt }],
        }),
      }),
    ]);

    if (!signalResponse.ok || !castResponse.ok) {
      const status = !signalResponse.ok ? signalResponse.status : castResponse.status;
      if (status === 429) {
        if (runId) await supabase.from("trend_refresh_runs").update({ ok: false, error: "AI rate limit 429" }).eq("id", runId);
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        if (runId) await supabase.from("trend_refresh_runs").update({ ok: false, error: "AI credits exhausted 402" }).eq("id", runId);
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: signal=${signalResponse.status}, cast=${castResponse.status}`);
    }

    const signalData = await signalResponse.json();
    const castData = await castResponse.json();

    const signalContent = signalData.choices?.[0]?.message?.content || "";
    const castContent = castData.choices?.[0]?.message?.content || "";

    const parseJson = (raw: string) => {
      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
      if (!cleaned.startsWith("[") && !cleaned.startsWith("{")) {
        const arrStart = cleaned.indexOf("[");
        const objStart = cleaned.indexOf("{");
        const start = arrStart >= 0 && objStart >= 0 ? Math.min(arrStart, objStart) : Math.max(arrStart, objStart);
        if (start >= 0) cleaned = cleaned.slice(start);
      }
      const lastBracket = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
      if (lastBracket >= 0) cleaned = cleaned.slice(0, lastBracket + 1);
      return JSON.parse(cleaned);
    };

    let newSignals: any[];
    let newCast: any[];

    try {
      newSignals = parseJson(signalContent);
    } catch (e) {
      console.error("Failed to parse signal JSON:", signalContent.slice(0, 500));
      throw new Error("AI returned invalid signal data");
    }

    try {
      newCast = parseJson(castContent);
    } catch (e) {
      console.error("Failed to parse cast JSON:", castContent.slice(0, 500));
      throw new Error("AI returned invalid cast data");
    }

    // Archive existing active signals — ONLY for the requested production_type
    const now = new Date().toISOString();

    let archiveSignalQuery = supabase
      .from("trend_signals")
      .update({ status: "archived", archived_at: now })
      .eq("status", "active");

    let archiveCastQuery = supabase
      .from("cast_trends")
      .update({ status: "archived", archived_at: now })
      .eq("status", "active");

    if (productionType) {
      archiveSignalQuery = archiveSignalQuery.eq("production_type", productionType);
      archiveCastQuery = archiveCastQuery.eq("production_type", productionType);
    }

    await archiveSignalQuery;
    await archiveCastQuery;

    // Insert new signals with refresh_run_id
    const VALID_DIMENSIONS = ["visual_style", "narrative", "platform", "monetization", "talent", "format", "market_behavior", "buyer_appetite"];
    const normalizeDimension = (d: string | null): string => {
      if (!d) return "market_behavior";
      const n = d.toLowerCase().replace(/[\s-]+/g, "_");
      return VALID_DIMENSIONS.includes(n) ? n : "market_behavior";
    };
    const normalizeModality = (m: string | null): string | null => {
      if (!m) return null;
      const n = m.toLowerCase().replace(/[\s-]+/g, "_");
      if (["animation", "live_action", "hybrid"].includes(n)) return n;
      return null;
    };
    const normTags = (arr: any): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr.map((t: any) => String(t).toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
    };

    const signalRows = newSignals.map((s: any) => {
      const genreTags = s.genre_tags || [];
      const toneTags = s.tone_tags || [];
      const formatTags = s.format_tags || [];
      const styleTags = normTags(s.style_tags);
      const narrativeTags = normTags(s.narrative_tags);
      // signal_tags = union of all tag categories, normalized
      const signalTags = [...new Set([
        ...normTags(genreTags), ...normTags(toneTags), ...normTags(formatTags),
        ...styleTags, ...narrativeTags,
      ])];

      return {
        name: s.name || "Unnamed Signal",
        category: s.category || "Narrative",
        cycle_phase: s.cycle_phase || "Early",
        explanation: s.explanation || "",
        sources_count: s.sources_count || 3,
        genre_tags: genreTags,
        tone_tags: toneTags,
        format_tags: formatTags,
        region: s.region || "International",
        lane_relevance: s.lane_relevance || [],
        production_type: normalizeProductionType(s.production_type, productionType),
        strength: Math.min(10, Math.max(1, parseInt(s.strength) || 5)),
        velocity: ["Rising", "Stable", "Declining"].includes(s.velocity) ? s.velocity : "Stable",
        saturation_risk: ["Low", "Medium", "High"].includes(s.saturation_risk) ? s.saturation_risk : "Low",
        forecast: s.forecast || "",
        budget_tier: s.budget_tier || "",
        target_buyer: s.target_buyer || "",
        status: "active",
        first_detected_at: now,
        last_updated_at: now,
        source_citations: perplexityCitations.length > 0 ? perplexityCitations : null,
        refresh_run_id: runId || undefined,
        dimension: normalizeDimension(s.dimension),
        modality: normalizeModality(s.modality),
        style_tags: styleTags,
        narrative_tags: narrativeTags,
        signal_tags: signalTags,
      };
    });

    const castRows = newCast.map((c: any) => ({
      actor_name: c.actor_name || "Unknown",
      region: c.region || "",
      age_band: c.age_band || "",
      trend_type: c.trend_type || "Emerging",
      explanation: c.explanation || "",
      genre_relevance: c.genre_relevance || [],
      market_alignment: c.market_alignment || "",
      cycle_phase: c.cycle_phase || "Early",
      sales_leverage: c.sales_leverage || "",
      timing_window: c.timing_window || "",
      production_type: normalizeProductionType(c.production_type, productionType),
      strength: Math.min(10, Math.max(1, parseInt(c.strength) || 5)),
      velocity: ["Rising", "Stable", "Declining"].includes(c.velocity) ? c.velocity : "Stable",
      saturation_risk: ["Low", "Medium", "High"].includes(c.saturation_risk) ? c.saturation_risk : "Low",
      forecast: c.forecast || "",
      budget_tier: c.budget_tier || "",
      target_buyer: c.target_buyer || "",
      status: "active",
      first_detected_at: now,
      last_updated_at: now,
      source_citations: perplexityCitations.length > 0 ? perplexityCitations : null,
      refresh_run_id: runId || undefined,
    }));

    const { data: insertedSignals, error: signalInsertErr } = await supabase.from("trend_signals").insert(signalRows).select("id, name, genre_tags, tone_tags, format_tags, production_type, strength, velocity, dimension, modality, style_tags, narrative_tags, signal_tags");
    if (signalInsertErr) {
      console.error("Signal insert error:", signalInsertErr);
      throw new Error("Failed to save trend signals");
    }

    const { error: castInsertErr } = await supabase.from("cast_trends").insert(castRows);
    if (castInsertErr) {
      console.error("Cast insert error:", castInsertErr);
      throw new Error("Failed to save cast trends");
    }

    // ── Update run log with success ──
    if (runId) {
      await supabase.from("trend_refresh_runs").update({
        ok: true,
        completed_types: requestedTypes,
        citations_total: perplexityCitations.length,
        signals_total: signalRows.length,
        cast_total: castRows.length,
      }).eq("id", runId);
    }

    // ── Write trend_observations from generated signals ──
    try {
      const observationRows = (insertedSignals || []).map((sig: any, idx: number) => {
        const raw = newSignals[idx] || {};
        const allTags = [
          ...(sig.genre_tags || []),
          ...(sig.tone_tags || []),
          ...(sig.format_tags || []),
        ].map((t: string) => String(t));
        return {
          observed_at: now,
          source_type: "ai_generation",
          source_name: "refresh-trends",
          source_url: null,
          raw_text: raw.explanation || sig.name || "",
          raw_metrics: {
            strength: sig.strength,
            velocity: sig.velocity === "Rising" ? 0.8 : sig.velocity === "Declining" ? 0.2 : 0.5,
            sources_count: raw.sources_count || 3,
          },
          extraction_confidence: 0.7,
          format_hint: getFormatBucketFromProdType(sig.production_type || "film"),
          tags: allTags,
          cluster_id: sig.id,
          ingested_by: "refresh-trends",
          user_id: null,
        };
      });
      if (observationRows.length > 0) {
        const { error: obsErr } = await supabase.from("trend_observations").insert(observationRows);
        if (obsErr) console.error("Observation insert error (non-fatal):", obsErr);
        else console.log(`[refresh-trends] Wrote ${observationRows.length} trend_observations`);
      }
    } catch (obsE) {
      console.warn("[refresh-trends] trend_observations write failed (non-fatal):", obsE);
    }

    // --- GENERATE WEEKLY BRIEF ---
    const briefType = productionType || "film";
    const briefSignalSummary = signalRows
      .map((s: any) => `${s.name} (${s.cycle_phase}, strength ${s.strength}, ${s.velocity})`)
      .join("; ");
    const briefCastSummary = castRows
      .map((c: any) => `${c.actor_name} (${c.trend_type}, ${c.cycle_phase})`)
      .join("; ");

    const briefPrompt = `You are a senior market intelligence analyst. Write a concise weekly signal brief (3-5 sentences) summarising the most important shifts for "${briefType}" production this week.

Current signals: ${briefSignalSummary}
Current talent trends: ${briefCastSummary}

Focus on:
- What changed (new signals, phase shifts, declining trends)
- What producers should pay attention to right now
- Any notable opportunities or risks

Write in direct, professional prose. No bullet points, no headers. Just a tight paragraph a producer can scan in 30 seconds.`;

    try {
      const briefResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [{ role: "user", content: briefPrompt }],
        }),
      });

      if (briefResponse.ok) {
        const briefData = await briefResponse.json();
        const briefText = briefData.choices?.[0]?.message?.content?.trim() || "";
        if (briefText) {
          const today = new Date();
          const dayOfWeek = today.getDay();
          const monday = new Date(today);
          monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
          const weekStart = monday.toISOString().split("T")[0];

          await supabase
            .from("trend_weekly_briefs")
            .upsert(
              {
                week_start: weekStart,
                production_type: briefType,
                summary: briefText,
              },
              { onConflict: "week_start,production_type" }
            );
        }
      }
    } catch (briefErr) {
      console.error("Weekly brief generation failed:", briefErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        signals_updated: signalRows.length,
        cast_updated: castRows.length,
        production_type: productionType || "all",
        refreshed_at: now,
        run_id: runId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("refresh-trends error:", e);
    // Update run log on failure
    if (runId) {
      await supabase.from("trend_refresh_runs").update({
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      }).eq("id", runId).catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", run_id: runId }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
