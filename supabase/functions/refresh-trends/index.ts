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
    // Validate auth
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

    // Fetch existing signals for context
    const { data: existingSignals } = await supabase
      .from("trend_signals")
      .select("name, category, cycle_phase, status")
      .eq("status", "active");

    const { data: existingCast } = await supabase
      .from("cast_trends")
      .select("actor_name, region, trend_type, status")
      .eq("status", "active");

    const existingSignalNames = (existingSignals || []).map((s: any) => s.name).join(", ");
    const existingCastNames = (existingCast || []).map((c: any) => c.actor_name).join(", ");

    // --- REFRESH STORY TREND SIGNALS ---
    const signalPrompt = `You are an international film, television, and commercial content market intelligence analyst. Your job is to identify emerging, building, peaking, and declining signals across the entertainment and content industry, segmented by production type.

Current active signals: ${existingSignalNames || "None"}

Research and return an updated set of 15-20 trend signals. For each existing signal, assess whether its cycle_phase should change (Early → Building → Peaking → Declining → Dead). Remove signals that are no longer relevant. Add new signals you detect.

IMPORTANT: Each signal MUST specify a production_type. Distribute signals across production types: film, tv-series, documentary, commercial, branded-content, music-video, short-film, digital-series.

For commercial and branded-content signals, use category terms like "Brand Strategy", "Creative Direction", "Client Behaviour", "Content Innovation" — never use film-distribution terminology like "pre-sales", "sales agent", "theatrical", etc.

Categories by production type:
- film/tv-series: Narrative, IP, Market Behaviour, Buyer Appetite, Genre Cycle
- commercial: Brand Strategy, Creative Direction, Production Innovation, Award Cycles, Client Behaviour
- branded-content: Brand Strategy, Platform Behaviour, Cultural Shifts, Engagement Patterns, Content Innovation
- documentary: Subject Access, Impact Trends, Broadcaster Appetite, Grant Cycles, Archive Innovation
- music-video: Visual Innovation, Artist Momentum, Platform Strategy, Commissioner Behaviour
- short-film/digital-series: Festival Cycles, Platform Algorithm, Creator Economy, Format Innovation

Cycle phases: Early, Building, Peaking, Declining
Regions: US, UK, Europe, Asia, LatAm, International, MENA, Africa
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
- format_tags: relevant formats like Feature, Series, Limited Series (array)
- region: primary region
- lane_relevance: which finance lanes this affects (array from: studio-streamer, independent-film, low-budget, international-copro, genre-market, prestige-awards, fast-turnaround)
- production_type: one of film, tv-series, documentary, documentary-series, commercial, branded-content, music-video, short-film, digital-series, proof-of-concept, hybrid
- strength: 1-10 integer
- velocity: Rising, Stable, or Declining
- saturation_risk: Low, Medium, or High
- forecast: one sentence 12-month outlook
- budget_tier: one of Micro, Low, Mid, Upper-Mid, High, Studio-Scale
- target_buyer: the primary buyer type relevant to this signal's production type

Return ONLY a JSON array of signal objects. No markdown, no explanation outside the JSON.`;

    const castPrompt = `You are an international entertainment talent analyst focused on finance-relevant talent intelligence, segmented by production type. Your job is to identify talent whose market momentum is shifting in ways that affect project packaging and finance.

Current tracked talent: ${existingCastNames || "None"}

Research and return an updated set of 15-20 talent trends. For existing entries, update their cycle_phase and timing_window. Remove entries whose momentum has stalled. Add new emerging talent.

IMPORTANT: Each entry MUST specify a production_type. For commercial/branded-content, track directors and creative leads rather than actors. For music-video, track directors. Distribute across production types.

Focus on talent relevant to international content — not just Hollywood A-listers. Include talent from UK, Europe, Asia, LatAm, and Australia/NZ.

Trend types: Emerging, Accelerating, Resurgent, Declining
Cycle phases: Early, Building, Peaking, Declining
Regions: US, UK, Europe, Asia, LatAm, Australia, MENA, Africa
Market alignment: Studio, Indie, Streamer, Brand, Agency
Sales leverage: Pre-sales friendly, MG-driven, Festival-driven, Streamer-oriented, Brand-aligned
Velocity: Rising, Stable, Declining
Saturation Risk: Low, Medium, High

For each entry provide:
- actor_name: full name (or director/creator name for non-film types)
- region: primary region
- age_band: 18-25, 26-35, 36-45, 46-55, 55+
- trend_type: one of the types above
- explanation: 2-3 sentences on why this talent's momentum matters
- genre_relevance: array of relevant genres or specialties
- market_alignment: Studio, Indie, Streamer, Brand, or Agency
- cycle_phase: current phase
- sales_leverage: one of the leverage types
- timing_window: e.g. "Strong next 6-12 months"
- production_type: one of film, tv-series, documentary, commercial, branded-content, music-video, short-film, digital-series
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

    // Parse JSON from AI responses (strip markdown fences if present)
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

    // Archive existing active signals
    const now = new Date().toISOString();

    await supabase
      .from("trend_signals")
      .update({ status: "archived", archived_at: now })
      .eq("status", "active");

    await supabase
      .from("cast_trends")
      .update({ status: "archived", archived_at: now })
      .eq("status", "active");

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
      production_type: s.production_type || "film",
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
      production_type: c.production_type || "film",
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

    return new Response(
      JSON.stringify({
        success: true,
        signals_updated: signalRows.length,
        cast_updated: castRows.length,
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
