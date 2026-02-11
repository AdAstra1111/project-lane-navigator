import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body for optional production_type filter
    let productionType: string | null = null;
    try {
      const body = await req.json();
      productionType = body.production_type || null;
    } catch {
      // No body or invalid JSON — refresh all types
    }

    const typeFilter = productionType ? ` for production_type="${productionType}"` : "";
    const typeInstruction = productionType
      ? `IMPORTANT: Generate signals ONLY for production_type = "${productionType}". Every signal must have production_type set to "${productionType}".`
      : `Distribute signals across production types: film, tv-series, documentary, commercial, branded-content, music-video, short-film, digital-series, vertical-drama.`;

    // Fetch existing signals for context (filtered if production_type provided)
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
        }
      } catch (e) {
        console.warn("Perplexity market research failed:", e);
      }
    }

    const groundedContext = perplexityMarketData
      ? `\n\n=== REAL-TIME MARKET INTELLIGENCE (from live web search) ===\n${perplexityMarketData}\n=== END MARKET INTELLIGENCE ===\n\nIMPORTANT: Use the above real-time data to ground your signals in current reality. Prioritize trends that are confirmed by this research.`
      : "";

    // Build vertical-drama-specific prompt additions
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
    const signalPrompt = `You are an international film, television, and commercial content market intelligence analyst. Your job is to identify emerging, building, peaking, and declining signals across the entertainment and content industry.

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
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
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
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
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

    // Insert new signals
    const signalRows = newSignals.map((s: any) => ({
      name: s.name || "Unnamed Signal",
      category: s.category || "Narrative",
      cycle_phase: s.cycle_phase || "Early",
      explanation: s.explanation || "",
      sources_count: s.sources_count || 3,
      genre_tags: s.genre_tags || [],
      tone_tags: s.tone_tags || [],
      format_tags: s.format_tags || [],
      region: s.region || "International",
      lane_relevance: s.lane_relevance || [],
      production_type: productionType || s.production_type || "film",
      strength: Math.min(10, Math.max(1, parseInt(s.strength) || 5)),
      velocity: ["Rising", "Stable", "Declining"].includes(s.velocity) ? s.velocity : "Stable",
      saturation_risk: ["Low", "Medium", "High"].includes(s.saturation_risk) ? s.saturation_risk : "Low",
      forecast: s.forecast || "",
      budget_tier: s.budget_tier || "",
      target_buyer: s.target_buyer || "",
      status: "active",
      first_detected_at: now,
      last_updated_at: now,
    }));

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
      production_type: productionType || c.production_type || "film",
      strength: Math.min(10, Math.max(1, parseInt(c.strength) || 5)),
      velocity: ["Rising", "Stable", "Declining"].includes(c.velocity) ? c.velocity : "Stable",
      saturation_risk: ["Low", "Medium", "High"].includes(c.saturation_risk) ? c.saturation_risk : "Low",
      forecast: c.forecast || "",
      budget_tier: c.budget_tier || "",
      target_buyer: c.target_buyer || "",
      status: "active",
      first_detected_at: now,
      last_updated_at: now,
    }));

    const { error: signalInsertErr } = await supabase.from("trend_signals").insert(signalRows);
    if (signalInsertErr) {
      console.error("Signal insert error:", signalInsertErr);
      throw new Error("Failed to save trend signals");
    }

    const { error: castInsertErr } = await supabase.from("cast_trends").insert(castRows);
    if (castInsertErr) {
      console.error("Cast insert error:", castInsertErr);
      throw new Error("Failed to save cast trends");
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
      const briefResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("refresh-trends error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
