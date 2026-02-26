import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      productionType, genre, subgenre, budgetBand, region, platformTarget,
      audienceDemo, riskLevel, count, coverageContext, feedbackContext,
      briefNotes, projectId, skipSignals, hardCriteria,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const typeLabel = productionType || "film";
    const batchSize = Math.min(count || 10, 15);

    const coverageSection = coverageContext
      ? `\n\nEXISTING COVERAGE CONTEXT (generate pivot pitches based on this):\n${coverageContext}`
      : "";

    const feedbackSection = feedbackContext
      ? `\n\nPREVIOUS USER FEEDBACK (use to improve ranking and style):\n${JSON.stringify(feedbackContext)}`
      : "";

    const notesSection = briefNotes ? `\n\nADDITIONAL BRIEF NOTES FROM PRODUCER:\n${briefNotes}` : "";

    // ── Hard Criteria block ──
    let hardCriteriaBlock = "";
    if (hardCriteria) {
      const parts: string[] = [];
      if (hardCriteria.culturalTag) parts.push(`Cultural/Style Tag: ${hardCriteria.culturalTag} — ALL concepts MUST reflect this aesthetic, cultural sensibility, and storytelling tradition.`);
      if (hardCriteria.lane) parts.push(`Monetisation Lane: ${hardCriteria.lane} — concepts MUST be viable in this lane.`);
      if (hardCriteria.rating) parts.push(`Rating: ${hardCriteria.rating} — content MUST be appropriate for this rating.`);
      if (hardCriteria.epLength) parts.push(`Episode Length: ${hardCriteria.epLength} minutes per episode.`);
      if (hardCriteria.epCount) parts.push(`Episode Count: ${hardCriteria.epCount} episodes.`);
      if (hardCriteria.mustHaveTropes?.length > 0) parts.push(`MUST INCLUDE these tropes/themes: ${hardCriteria.mustHaveTropes.join(', ')}. Every concept MUST incorporate at least one.`);
      if (hardCriteria.avoidTropes?.length > 0) parts.push(`MUST AVOID these tropes/themes: ${hardCriteria.avoidTropes.join(', ')}. NO concept may use any of these.`);
      if (parts.length > 0) {
        hardCriteriaBlock = `\n\n=== HARD CRITERIA (NON-NEGOTIABLE — reject any concept that violates these) ===\n${parts.join('\n')}\n=== END HARD CRITERIA ===\n`;
      }
    }

    // ── Signal context injection ──
    let signalBlock = "";
    let signalsUsedIds: string[] = [];
    let signalInfluence: number | null = null;
    let signalsApplied = false;
    let signalsRationale = "no projectId";

    // ── Nuance / Drift context ──
    let nuanceBlock = "";
    let driftBlock = "";

    if (projectId) {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const supa = createClient(supabaseUrl, supabaseKey);

      // Fetch project settings + lane
      const { data: proj } = await supa.from("projects")
        .select("assigned_lane, signals_influence, signals_apply, production_format")
        .eq("id", projectId).single();

      const lane = proj?.assigned_lane || "independent-film";

      // Fetch project_lane_prefs for nuance context
      try {
        const { data: prefsRow } = await supa.from("project_lane_prefs")
          .select("prefs")
          .eq("project_id", projectId)
          .eq("lane", lane)
          .maybeSingle();

        if (prefsRow?.prefs) {
          const prefs = prefsRow.prefs as any;
          const parts: string[] = [];
          if (prefs.style_benchmark) parts.push(`Style Benchmark: ${prefs.style_benchmark}`);
          if (prefs.pacing_feel) parts.push(`Pacing Feel: ${prefs.pacing_feel}`);
          if (prefs.last_ui?.restraint !== undefined) parts.push(`Restraint Level: ${prefs.last_ui.restraint}/10`);
          if (prefs.last_ui?.conflict_mode) parts.push(`Conflict Mode: ${prefs.last_ui.conflict_mode}`);
          if (prefs.last_ui?.story_engine) parts.push(`Story Engine: ${prefs.last_ui.story_engine}`);
          if (parts.length > 0) {
            nuanceBlock = `\n\n=== NUANCE PREFS (from project ruleset — weight these in tone/style) ===\n${parts.join('\n')}\n=== END NUANCE PREFS ===\n`;
          }
        }
      } catch (e) {
        console.warn("[generate-pitch] Nuance prefs fetch failed (non-fatal):", e);
      }

      // Fetch latest drift metrics
      try {
        const { data: driftRuns } = await supa.from("cinematic_quality_runs")
          .select("metrics_json, final_score, final_pass, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (driftRuns?.[0]) {
          const d = driftRuns[0];
          driftBlock = `\n\n=== CREATIVE DRIFT (latest quality metrics — use to avoid drift patterns) ===\nLast Score: ${d.final_score}/100 (${d.final_pass ? 'PASS' : 'FAIL'})\nMetrics: ${JSON.stringify(d.metrics_json)}\n=== END DRIFT ===\n`;
        }
      } catch (e) {
        console.warn("[generate-pitch] Drift fetch failed (non-fatal):", e);
      }

      // Signal context
      if (skipSignals) {
        signalsRationale = "skipSignals";
      } else {
        try {
          signalInfluence = proj?.signals_influence ?? 0.5;
          const applyConfig = proj?.signals_apply ?? { pitch: true };
          if (!applyConfig.pitch) {
            signalsRationale = "signals_apply.pitch=false";
          } else {
            const { data: matches } = await supa
              .from("project_signal_matches")
              .select("cluster_id, relevance_score, impact_score, rationale, cluster:cluster_id(name, category, strength, velocity, saturation_risk, explanation, cluster_scoring)")
              .eq("project_id", projectId)
              .order("impact_score", { ascending: false })
              .limit(3);
            if (matches && matches.length > 0) {
              signalsUsedIds = matches.map((m: any) => m.cluster_id);
              signalsApplied = true;
              signalsRationale = "applied";
              const inf = signalInfluence ?? 0.5;
              const influenceLabel = inf >= 0.65 ? "HIGH" : inf >= 0.35 ? "MODERATE" : "LOW";
              let influenceRule = "";
              if (inf >= 0.65) influenceRule = "Signals may shape logline framing, comps, buyer angle, AND format mechanics.";
              else if (inf >= 0.35) influenceRule = "Signals should shape comps and buyer positioning ONLY.";
              else influenceRule = "Signals add risk flags and optional comps ONLY.";
              const lines = matches.map((m: any, i: number) => {
                const c = m.cluster;
                return `${i+1}. ${c?.name || "Signal"} [${c?.category || ""}] — strength ${c?.strength || 0}/10, ${c?.velocity || "Stable"}, saturation ${c?.saturation_risk || "Low"}\n   ${c?.explanation || ""}`;
              }).join("\n");
              signalBlock = `\n=== MARKET & FORMAT SIGNALS (influence: ${influenceLabel}) ===\n${influenceRule}\n\n${lines}\n=== END SIGNALS ===\n`;
            } else {
              signalsRationale = "no matches";
            }
          }
        } catch (e) {
          console.warn("[generate-pitch] Signal fetch failed (non-fatal):", e);
          signalsRationale = "fetch error";
        }
      }
    }

    // Inject guardrails
    const guardrails = buildGuardrailBlock({ productionType: typeLabel, engineName: "generate-pitch" });
    console.log(`[generate-pitch] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}, batch=${batchSize}`);

    const systemPrompt = `You are IFFY's Development Pitch Engine — an expert development executive who generates production-ready concept pitches for the entertainment industry.

${guardrails.textBlock}

PRODUCTION TYPE: ${typeLabel}
ALL outputs MUST be strictly constrained to this production type.${hardCriteriaBlock}${nuanceBlock}${driftBlock}

Generate exactly ${batchSize} ranked development concepts.${coverageSection}${feedbackSection}${notesSection}${signalBlock}

For each idea, provide weighted scores (0-100):
- market_heat, feasibility, lane_fit, saturation_risk (inverse), company_fit
- total_score = (market_heat × 0.30) + (feasibility × 0.25) + (lane_fit × 0.20) + (saturation_risk × 0.15) + (company_fit × 0.10)

RANK by total_score descending.

CRITICAL: Every character must have a DISTINCT name fitting the story's cultural setting. Never reuse generic names across pitches.

You MUST call submit_pitches with ALL ${batchSize} ideas.`;

    const userPrompt = `Generate ${batchSize} ranked pitch ideas:
- Production Type: ${typeLabel}
- Genre: ${genre || "any"}${subgenre ? `\n- Subgenre: ${subgenre}` : ""}
- Budget Band: ${budgetBand || "any"}
- Region: ${region || "global"}
- Platform Target: ${platformTarget || "any"}${audienceDemo ? `\n- Audience Demo: ${audienceDemo}` : ""}
- Risk Level: ${riskLevel || "medium"}
${coverageContext ? "\nMode: Coverage Transformer" : "Mode: Greenlight Radar — fresh original concepts."}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_pitches",
              description: "Submit generated pitch ideas with scoring",
              parameters: {
                type: "object",
                properties: {
                  ideas: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        logline: { type: "string", description: "1-2 sentence hook" },
                        one_page_pitch: { type: "string", description: "Full 1-page pitch (3-5 paragraphs)" },
                        comps: { type: "array", items: { type: "string" }, description: "3-5 comparable titles" },
                        recommended_lane: { type: "string" },
                        lane_confidence: { type: "number" },
                        budget_band: { type: "string" },
                        genre: { type: "string" },
                        packaging_suggestions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: { role: { type: "string" }, archetype: { type: "string" }, names: { type: "array", items: { type: "string" } }, rationale: { type: "string" } },
                            required: ["role", "archetype", "rationale"], additionalProperties: false,
                          },
                        },
                        development_sprint: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: { week: { type: "string" }, milestone: { type: "string" }, deliverable: { type: "string" } },
                            required: ["week", "milestone", "deliverable"], additionalProperties: false,
                          },
                        },
                        risks_mitigations: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: { risk: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high"] }, mitigation: { type: "string" } },
                            required: ["risk", "severity", "mitigation"], additionalProperties: false,
                          },
                        },
                        why_us: { type: "string" },
                        risk_level: { type: "string", enum: ["low", "medium", "high"] },
                        score_market_heat: { type: "number" },
                        score_feasibility: { type: "number" },
                        score_lane_fit: { type: "number" },
                        score_saturation_risk: { type: "number" },
                        score_company_fit: { type: "number" },
                        score_total: { type: "number" },
                      },
                      required: ["title", "logline", "one_page_pitch", "comps", "recommended_lane", "lane_confidence", "budget_band", "genre", "packaging_suggestions", "development_sprint", "risks_mitigations", "why_us", "risk_level", "score_market_heat", "score_feasibility", "score_lane_fit", "score_saturation_risk", "score_company_fit", "score_total"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["ideas"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_pitches" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI generation failed");
    }

    const result = await response.json();
    const msg = result.choices?.[0]?.message;
    const toolCall = msg?.tool_calls?.[0];

    let ideas: any;
    if (toolCall?.function?.arguments) {
      ideas = JSON.parse(toolCall.function.arguments);
    } else if (msg?.content) {
      const raw = msg.content;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        ideas = JSON.parse(jsonMatch[0]);
      } else {
        console.error("No parseable JSON in content:", raw.substring(0, 500));
        throw new Error("No structured output returned");
      }
    } else {
      console.error("Unexpected response shape:", JSON.stringify(result).substring(0, 500));
      throw new Error("No structured output returned");
    }

    if (Array.isArray(ideas)) ideas = { ideas };
    if (!ideas.ideas) ideas = { ideas: [ideas] };

    ideas.signals_metadata = {
      signals_used: signalsUsedIds,
      influence_value: signalInfluence,
      applied: signalsApplied,
      rationale: signalsRationale,
    };

    return new Response(JSON.stringify(ideas), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-pitch error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
