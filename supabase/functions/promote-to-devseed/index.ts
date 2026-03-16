import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Invalid auth token");

    const { pitchIdeaId } = await req.json();
    if (!pitchIdeaId) throw new Error("pitchIdeaId required");

    // Fetch the pitch idea
    const { data: idea, error: ideaErr } = await supabase
      .from("pitch_ideas")
      .select("*")
      .eq("id", pitchIdeaId)
      .eq("user_id", user.id)
      .single();

    if (ideaErr || !idea) throw new Error("Pitch idea not found or access denied");

    // Build context for DevSeed generation
    const ideaContext = {
      title: idea.title,
      logline: idea.logline,
      one_page_pitch: idea.one_page_pitch,
      genre: idea.genre,
      production_type: idea.production_type,
      budget_band: idea.budget_band,
      recommended_lane: idea.recommended_lane,
      comps: idea.comps || [],
      packaging_suggestions: idea.packaging_suggestions || [],
      risks_mitigations: idea.risks_mitigations || [],
      why_us: idea.why_us || "",
      risk_level: idea.risk_level,
      score_total: idea.score_total,
    };

    // ── Build convergence guidance block from pitch metadata (if present) ──
    let convergenceGuidanceBlock = "";
    const rawResponse = idea.raw_response || {};
    const sm = rawResponse.signals_metadata;
    if (sm?.convergence_applied && sm?.convergence_summary) {
      const cs = sm.convergence_summary;
      const parts: string[] = [];

      if (Array.isArray(cs.genre_heat) && cs.genre_heat.length > 0) {
        parts.push(`Genre Heat:\n${cs.genre_heat.map((g: any) => `  - ${g.genre} (heat=${g.score})`).join("\n")}`);
      }
      if (cs.tone_style?.tone_band || cs.tone_style?.pacing) {
        const tsParts: string[] = [];
        if (cs.tone_style.tone_band) tsParts.push(`tone=${cs.tone_style.tone_band}`);
        if (cs.tone_style.pacing) tsParts.push(`pacing=${cs.tone_style.pacing}`);
        parts.push(`Tone/Style: ${tsParts.join(", ")}`);
      }
      if (Array.isArray(cs.comparable_titles) && cs.comparable_titles.length > 0) {
        parts.push(`Audience Reference Points (do NOT clone plots — tonal/market anchors only):\n${cs.comparable_titles.map((t: string) => `  - ${t}`).join("\n")}`);
      }
      if (Array.isArray(cs.constraints_notes) && cs.constraints_notes.length > 0) {
        parts.push(`Market Constraints:\n${cs.constraints_notes.map((n: string) => `  - ${n}`).join("\n")}`);
      }
      if (Array.isArray(cs.risks) && cs.risks.length > 0) {
        parts.push(`Saturation Risks:\n${cs.risks.map((r: any) => `  - [${r.severity}] ${r.label}`).join("\n")}`);
      }

      if (parts.length > 0) {
        convergenceGuidanceBlock = `\n\n=== CONVERGENCE GUIDANCE (FROM PITCH — AUDIENCE APPETITE CONTEXT) ===\n${parts.join("\n")}\n\nINSTRUCTION:\n- Treat as strong recommendations for voice, tone, pacing, and world density.\n- Stay original; do not clone plots or characters from reference titles.\n- Keep one "novelty slot" consistent with the pitch's differentiation move.\n- Do NOT write this guidance into canon — use it to shape the creative DNA of foundation docs.\n=== END CONVERGENCE GUIDANCE ===\n`;
        console.log(`[promote-to-devseed] Convergence guidance injected: ${cs.genre_heat?.length || 0} genres, ${cs.comparable_titles?.length || 0} comps`);
      }
    }

    // Generate DevSeed via AI
    // ── NUE-INFORMED STRUCTURAL REQUIREMENTS ──
    const isEpisodic = ["vertical-drama", "vertical_drama", "tv-series", "series", "limited-series", "digital-series"].includes(
      (idea.recommended_lane || idea.production_type || "").toLowerCase().replace(/_/g, "-"),
    );
    const isVerticalDrama = ["vertical-drama", "vertical_drama"].includes(
      (idea.recommended_lane || idea.production_type || "").toLowerCase().replace(/_/g, "-"),
    );

    let laneSpecificRequirements = "";
    if (isVerticalDrama) {
      laneSpecificRequirements = `
VERTICAL DRAMA STRUCTURAL REQUIREMENTS (MANDATORY):
- The story engine MUST support 30+ episodes of short-form mobile-first content.
- There MUST be a REPEATABLE EXTERNAL PRESSURE ENGINE — not just romance, internal conflict, or vibe.
- The season must have durable serial escalation: each episode must be propelled by an external force that generates new conflict.
- A purely contemplative, mood-driven, or romance-only premise is STRUCTURALLY INVALID for vertical drama.
- If you cannot identify a clear external escalation source, the seed is structurally insufficient.`;
    } else if (isEpisodic) {
      laneSpecificRequirements = `
EPISODIC FORMAT REQUIREMENTS:
- The story engine must support recurring episodic conflict across a full season.
- A single event or static situation is insufficient — there must be a renewable source of dramatic tension.`;
    }

    const systemPrompt = `You are IFFY's DevSeed Generator. Given a pitch idea, create a comprehensive development seed document with three sections.

NARRATIVE UNIT STRUCTURAL REQUIREMENTS (NUE-INFORMED — MANDATORY):
Every generated DevSeed MUST explicitly account for ALL of the following narrative architecture elements.
If any element is missing or weak, the seed is structurally insufficient and will be rejected.

1. PROTAGONIST OBJECTIVE: Who is the protagonist and what do they want? Must be concrete and actionable, not vague.
2. ANTAGONIST FORCE: What is the primary opposition source? Must be specific — a person, system, force, or structural threat. "Internal conflict alone" is insufficient for commercial formats.
3. STORY ENGINE: What is the repeatable mechanism that generates conflict and propels the narrative forward? For episodic formats, this must sustain multiple episodes. For features, it must sustain a full dramatic arc.
4. RELATIONSHIP TENSION AXIS: What is the primary relationship that creates dramatic friction? Must involve at least two named characters with opposing needs/values.
5. MARKET HOOK: What makes this commercially distinctive? One sentence that would make a buyer lean forward. Not just genre — the unique angle.
6. LANE FIT: Does the premise genuinely fit the declared format/lane? A feature idea forced into series, or a series idea with no repeatable engine, is a structural failure.
${laneSpecificRequirements}

SECTIONS TO GENERATE:

1. BIBLE STARTER — The foundational creative document:
   - World: Setting, rules, visual palette, period
   - Characters: 3-5 key characters with names, roles, arcs, flaws
   - Tone & Style: Reference points, what this feels like
   - Story Engine: What drives episodes/scenes forward (MUST satisfy NUE story engine requirement above)
   - Protagonist Objective: Explicit statement of protagonist's core goal
   - Antagonist Force: Explicit identification of the opposition source
   - Relationship Tension: The primary dramatic relationship axis
   - Themes: Core thematic pillars

2. NUANCE CONTRACT — Creative guardrails for development:
   - Restraint Level: 1-10 scale with rationale
   - Conflict Mode: primary conflict driver (e.g., interpersonal, systemic, internal, survival)
   - Complexity Cap: max plot threads, max factions, max core characters
   - Melodrama Guard: what emotional beats to avoid overdoing
   - Tone Boundaries: what this show/film IS NOT

3. MARKET RATIONALE — Commercial justification:
   - Market Hook: The single distinctive commercial angle (MUST satisfy NUE market hook requirement above)
   - Comparable Analysis: why each comp is relevant, what to take and avoid
   - Lane Justification: why this lane is optimal, alternatives considered
   - Serial Scalability Note: How the engine sustains across the declared format length
   - Buyer Positioning: which buyers/platforms, pitch angle for each
   - Timing: market window, trend alignment
   - Risk Summary: top 3 risks with mitigations
${convergenceGuidanceBlock}
4. NARRATIVE SPINE — Structural lock object (output as "narrative_spine" key):
   - story_engine: the StoryEngine that best matches this story (pressure_cooker / two_hander / slow_burn_investigation / social_realism / moral_trap / character_spiral / rashomon / anti_plot)
   - pressure_system: the CausalGrammar (accumulation / erosion / exchange / mirror / constraint / misalignment / contagion / revelation_without_facts)
   - central_conflict: the ConflictMode (romance_misalignment / status_reputation / money_time_pressure / family_obligation / workplace_power / moral_trap / identity_shame / legal_procedural)
   - inciting_incident: short phrase for the category of the inciting event
   - resolution_type: how this story ends (open_ended / bittersweet / cathartic_resolution / tragic / pyrrhic / triumphant)
   - stakes_class: scale of stakes (personal / relational / professional / societal / existential)
   - protagonist_arc: transformation shape (redemption / corruption / revelation / survival / transcendence / sacrifice / coming_of_age / revenge)
   - midpoint_reversal: structural midpoint type (false_victory / false_defeat / revelation / mirror_moment / point_of_no_return / betrayal)
   - tonal_gravity: overall emotional register (tragedy / catharsis / triumph / ambiguity / irony / elegy / satire)
   Use null for any axis you genuinely cannot determine from the pitch. Do NOT guess.

Output as a JSON object with keys: bible_starter, nuance_contract, market_rationale, narrative_spine. Each should be a well-structured object.`;

    // Fetch with retry for transient gateway errors (502/503)
    let response: Response | null = null;
    const MAX_RETRIES = 2;
    const aiPayload = JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate a DevSeed for this pitch idea:\n\n${JSON.stringify(ideaContext, null, 2)}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_devseed",
              description: "Submit the generated DevSeed payload",
              parameters: {
                type: "object",
                properties: {
                  bible_starter: {
                    type: "object",
                    properties: {
                      world: { type: "string" },
                      characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, arc: { type: "string" }, flaw: { type: "string" } }, required: ["name", "role", "arc"] } },
                      tone_and_style: { type: "string" },
                      story_engine: { type: "string" },
                      protagonist_objective: { type: "string", description: "Explicit statement of protagonist's core actionable goal" },
                      antagonist_force: { type: "string", description: "Specific opposition source: person, system, or structural threat" },
                      relationship_tension: { type: "string", description: "Primary dramatic relationship axis between named characters" },
                      themes: { type: "array", items: { type: "string" } },
                    },
                    required: ["world", "characters", "tone_and_style", "story_engine", "protagonist_objective", "antagonist_force", "relationship_tension", "themes"],
                  },
                  nuance_contract: {
                    type: "object",
                    properties: {
                      restraint_level: { type: "number" },
                      restraint_rationale: { type: "string" },
                      conflict_mode: { type: "string" },
                      complexity_cap: { type: "object", properties: { max_plot_threads: { type: "number" }, max_factions: { type: "number" }, max_core_characters: { type: "number" } } },
                      melodrama_guard: { type: "string" },
                      tone_boundaries: { type: "string" },
                    },
                    required: ["restraint_level", "conflict_mode", "complexity_cap", "melodrama_guard", "tone_boundaries"],
                  },
                  market_rationale: {
                    type: "object",
                    properties: {
                      market_hook: { type: "string", description: "Single distinctive commercial angle" },
                      serial_scalability_note: { type: "string", description: "How the engine sustains across the declared format length" },
                      comparable_analysis: { type: "array", items: { type: "object", properties: { title: { type: "string" }, relevance: { type: "string" }, take: { type: "string" }, avoid: { type: "string" } }, required: ["title", "relevance"] } },
                      lane_justification: { type: "string" },
                      buyer_positioning: { type: "array", items: { type: "object", properties: { buyer: { type: "string" }, angle: { type: "string" } }, required: ["buyer", "angle"] } },
                      timing: { type: "string" },
                      risk_summary: { type: "array", items: { type: "object", properties: { risk: { type: "string" }, mitigation: { type: "string" } }, required: ["risk", "mitigation"] } },
                    },
                    required: ["market_hook", "serial_scalability_note", "comparable_analysis", "lane_justification", "buyer_positioning", "timing", "risk_summary"],
                  },
                  narrative_spine: {
                    type: "object",
                    description: "9-axis structural lock. Set each field to the best matching value from the allowed list, or null if genuinely uncertain. Do NOT guess — null is correct when unsure.",
                    properties: {
                      story_engine:      { type: ["string", "null"], description: "One of: pressure_cooker, two_hander, slow_burn_investigation, social_realism, moral_trap, character_spiral, rashomon, anti_plot" },
                      pressure_system:   { type: ["string", "null"], description: "One of: accumulation, erosion, exchange, mirror, constraint, misalignment, contagion, revelation_without_facts" },
                      central_conflict:  { type: ["string", "null"], description: "One of: romance_misalignment, status_reputation, money_time_pressure, family_obligation, workplace_power, moral_trap, identity_shame, legal_procedural" },
                      inciting_incident: { type: ["string", "null"], description: "Short phrase describing the category of the inciting event (e.g. 'unexpected inheritance', 'death of a mentor')" },
                      resolution_type:   { type: ["string", "null"], description: "How the story ends (e.g. 'open_ended', 'bittersweet', 'cathartic_resolution', 'tragic')" },
                      stakes_class:      { type: ["string", "null"], description: "Stakes scale (e.g. 'personal', 'relational', 'professional', 'societal', 'existential')" },
                      protagonist_arc:   { type: ["string", "null"], description: "One of: redemption, corruption, revelation, survival, transcendence, sacrifice, coming_of_age, revenge" },
                      midpoint_reversal: { type: ["string", "null"], description: "One of: false_victory, false_defeat, revelation, mirror_moment, point_of_no_return, betrayal" },
                      tonal_gravity:     { type: ["string", "null"], description: "One of: tragedy, catharsis, triumph, ambiguity, irony, elegy, satire" },
                    },
                    required: ["story_engine", "pressure_system", "central_conflict", "inciting_incident", "resolution_type", "stakes_class", "protagonist_arc", "midpoint_reversal", "tonal_gravity"],
                  },
                },
                required: ["bible_starter", "nuance_contract", "market_rationale", "narrative_spine"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_devseed" } },
      });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: aiPayload,
      });

      if (response.ok) break;

      // Retry on transient gateway errors
      if ((response.status === 502 || response.status === 503) && attempt < MAX_RETRIES) {
        const backoffMs = 2000 * (attempt + 1);
        console.warn(`[promote-to-devseed] AI gateway returned ${response.status}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await response.text(); // consume body
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error(`DevSeed generation failed (AI returned ${response.status})`);
    }

    if (!response || !response.ok) {
      throw new Error("DevSeed generation failed after retries");
    }

    const result = await response.json();
    const msg = result.choices?.[0]?.message;
    const toolCall = msg?.tool_calls?.[0];

    let devSeed: any;
    if (toolCall?.function?.arguments) {
      devSeed = JSON.parse(toolCall.function.arguments);
    } else if (msg?.content) {
      const jsonMatch = msg.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) devSeed = JSON.parse(jsonMatch[0]);
      else throw new Error("No structured DevSeed output");
    } else {
      throw new Error("No DevSeed output returned");
    }

    // ── PROPULSION VALIDATOR (deterministic, fail-closed) ──
    function classifyPropulsion(seed: any): { sources: string[]; primary: string | null; durable: boolean; failures: string[] } {
      const bs = seed.bible_starter || {};
      const mr = seed.market_rationale || {};
      const sources: string[] = [];
      const failures: string[] = [];

      // 1. Active protagonist objective
      const po = String(bs.protagonist_objective || "").trim();
      if (po.length >= 15 && !/vague|unclear|undefined/i.test(po)) {
        sources.push("protagonist_objective");
      }

      // 2. External pressure / antagonist engine
      const af = String(bs.antagonist_force || "").trim();
      if (af.length >= 15 && !/internal conflict alone|self-doubt only|purely internal/i.test(af)) {
        sources.push("external_pressure_engine");
      }

      // 3. Relationship escalation engine
      const rt = String(bs.relationship_tension || "").trim();
      const rtHasDurability = rt.length >= 15 && /escala|forbidden|secret|betray|rival|conflict|pressure|scandal|contract|trap|obligation|tension/i.test(rt);
      if (rtHasDurability) {
        sources.push("relationship_escalation_engine");
      }

      // 4. Investigation / mystery engine
      const se = String(bs.story_engine || "").trim();
      if (/investig|mystery|uncover|secret|conspiracy|truth|detective|solve|revelation/i.test(se)) {
        sources.push("investigation_engine");
      }

      // 5. Survival / threat engine
      if (/surviv|threat|danger|siege|escape|hunted|pursuit|trapped|life.or.death/i.test(se)) {
        sources.push("survival_threat_engine");
      }

      // 6. Competition / career / system pressure
      if (/compet|career|system|institution|corporate|political|ambition|power.struggle|status|rank/i.test(se) ||
          /compet|career|system|institution|corporate|political/i.test(af)) {
        sources.push("competition_system_engine");
      }

      // Basic field presence checks
      if (po.length < 10 && !sources.includes("external_pressure_engine") && !sources.includes("relationship_escalation_engine")) {
        failures.push("missing_protagonist_objective");
      }
      if (!mr.market_hook || String(mr.market_hook).trim().length < 10) {
        failures.push("missing_market_hook");
      }
      if (!Array.isArray(bs.characters) || bs.characters.length < 2) {
        failures.push("insufficient_characters");
      }
      if (se.length < 20) {
        failures.push("missing_story_engine");
      }

      // Durability check — lane-aware
      let durable = sources.length > 0;
      if (isVerticalDrama) {
        // VD needs at least one engine that can sustain 30+ episodes
        const hasRepeatableEngine = sources.some(s =>
          s === "external_pressure_engine" || s === "competition_system_engine" ||
          s === "investigation_engine" || s === "survival_threat_engine" ||
          s === "relationship_escalation_engine"
        );
        if (!hasRepeatableEngine) {
          durable = false;
          failures.push("vd_no_durable_serial_propulsion");
        }
        // Check serial scalability note
        if (!mr.serial_scalability_note || String(mr.serial_scalability_note).trim().length < 10) {
          failures.push("missing_serial_scalability");
        }
      } else if (isEpisodic) {
        const hasRepeatableEngine = sources.some(s =>
          s !== "protagonist_objective" // protagonist objective alone is not enough for episodic
        );
        if (!hasRepeatableEngine && sources.length <= 1) {
          durable = false;
          failures.push("episodic_weak_propulsion");
        }
      }

      const primary = sources.length > 0 ? sources[0] : null;
      return { sources, primary, durable, failures };
    }

    let propulsionResult = classifyPropulsion(devSeed);

    console.log(`[promote-to-devseed][IEL] propulsion_validator { pitch_idea_id: "${pitchIdeaId}", lane: "${idea.recommended_lane || "unknown"}", sources: ${JSON.stringify(propulsionResult.sources)}, primary: "${propulsionResult.primary || "none"}", durable: ${propulsionResult.durable}, failures: ${JSON.stringify(propulsionResult.failures)} }`);

    // ── SINGLE STRUCTURAL REPAIR RETRY if propulsion fails ──
    if (!propulsionResult.durable || propulsionResult.failures.length > 0) {
      console.warn(`[promote-to-devseed][IEL] propulsion_repair_triggered { pitch_idea_id: "${pitchIdeaId}", failures: ${JSON.stringify(propulsionResult.failures)} }`);

      const repairInstruction = `STRUCTURAL REPAIR REQUIRED. The previous generation had these failures: ${propulsionResult.failures.join(", ")}.

REPAIR RULES:
- Preserve the promising concept, characters, and world.
- Fix the missing structural propulsion. The seed MUST have at least one DURABLE propulsion source:
  * active protagonist objective
  * external pressure / antagonist engine
  * relationship escalation engine (forbidden love + scandal/system pressure counts)
  * investigation / mystery engine
  * survival / threat engine
  * competition / career / system-pressure engine
- A reactive protagonist is ALLOWED if supported by durable external propulsion.
- Do NOT reject the concept — repair it by strengthening the weakest structural elements.
${isVerticalDrama ? "- VERTICAL DRAMA: Must support 30+ episodes with repeatable external escalation. Pure romance/mood/vibe without external pressure is insufficient." : ""}
${isEpisodic ? "- EPISODIC: Must have a renewable conflict engine beyond a single protagonist goal." : ""}

Return the same JSON schema as before with the structural elements strengthened.`;

      const repairPayload = JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt + "\n\n" + repairInstruction },
          { role: "user", content: `Repair this DevSeed to fix structural propulsion failures:\n\n${JSON.stringify(devSeed, null, 2)}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_devseed",
              description: "Submit the repaired DevSeed payload",
              parameters: {
                type: "object",
                properties: {
                  bible_starter: {
                    type: "object",
                    properties: {
                      world: { type: "string" },
                      characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, arc: { type: "string" }, flaw: { type: "string" } }, required: ["name", "role", "arc"] } },
                      tone_and_style: { type: "string" },
                      story_engine: { type: "string" },
                      protagonist_objective: { type: "string" },
                      antagonist_force: { type: "string" },
                      relationship_tension: { type: "string" },
                      themes: { type: "array", items: { type: "string" } },
                    },
                    required: ["world", "characters", "tone_and_style", "story_engine", "protagonist_objective", "antagonist_force", "relationship_tension", "themes"],
                  },
                  nuance_contract: { type: "object" },
                  market_rationale: {
                    type: "object",
                    properties: {
                      market_hook: { type: "string" },
                      serial_scalability_note: { type: "string" },
                      comparable_analysis: { type: "array", items: { type: "object" } },
                      lane_justification: { type: "string" },
                      buyer_positioning: { type: "array", items: { type: "object" } },
                      timing: { type: "string" },
                      risk_summary: { type: "array", items: { type: "object" } },
                    },
                    required: ["market_hook", "serial_scalability_note"],
                  },
                },
                  narrative_spine: { type: "object" },
                required: ["bible_starter", "nuance_contract", "market_rationale", "narrative_spine"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_devseed" } },
      });

      try {
        const repairResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: repairPayload,
        });

        if (repairResp.ok) {
          const repairResult = await repairResp.json();
          const repairMsg = repairResult.choices?.[0]?.message;
          const repairToolCall = repairMsg?.tool_calls?.[0];
          let repairedSeed: any = null;

          if (repairToolCall?.function?.arguments) {
            repairedSeed = JSON.parse(repairToolCall.function.arguments);
          } else if (repairMsg?.content) {
            const jsonMatch = repairMsg.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) repairedSeed = JSON.parse(jsonMatch[0]);
          }

          if (repairedSeed) {
            const repairPropulsion = classifyPropulsion(repairedSeed);
            console.log(`[promote-to-devseed][IEL] propulsion_repair_result { pitch_idea_id: "${pitchIdeaId}", sources: ${JSON.stringify(repairPropulsion.sources)}, durable: ${repairPropulsion.durable}, failures: ${JSON.stringify(repairPropulsion.failures)} }`);

            if (repairPropulsion.durable && repairPropulsion.failures.length === 0) {
              devSeed = repairedSeed;
              devSeed._structural_repaired = true;
              propulsionResult = repairPropulsion;
            } else {
              console.warn(`[promote-to-devseed][IEL] propulsion_repair_still_failed { pitch_idea_id: "${pitchIdeaId}" }`);
            }
          }
        }
      } catch (repairErr) {
        console.error(`[promote-to-devseed] Repair retry failed:`, repairErr);
      }
    }

    // ── FINAL GATE: block if still structurally weak ──
    devSeed._propulsion_sources = propulsionResult.sources;
    devSeed._propulsion_primary = propulsionResult.primary;
    devSeed._structural_pass = propulsionResult.durable && propulsionResult.failures.length === 0;
    devSeed._structural_failures = propulsionResult.failures;

    if (!devSeed._structural_pass) {
      console.error(`[promote-to-devseed][IEL] propulsion_gate_blocked { pitch_idea_id: "${pitchIdeaId}", failures: ${JSON.stringify(propulsionResult.failures)} }`);
      return new Response(JSON.stringify({
        error: "Seed lacks durable propulsion after repair attempt",
        structural_failures: propulsionResult.failures,
        propulsion_sources: propulsionResult.sources,
        hint: "The concept needs a stronger external pressure engine, antagonist force, or escalation mechanism suitable for " + (idea.recommended_lane || "the target lane"),
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[promote-to-devseed][IEL] propulsion_gate_passed { pitch_idea_id: "${pitchIdeaId}", sources: ${JSON.stringify(propulsionResult.sources)}, repaired: ${devSeed._structural_repaired || false} }`);

    // ── NARRATIVE SPINE: extract and persist to projects table ──
    // ── NARRATIVE SPINE: extract provisional spine (9 axes, no locked_at/locked_by — spine is provisional until CB approval) ──
    const rawSpine = devSeed.narrative_spine || {};
    const narrativeSpineJson = {
      story_engine:      rawSpine.story_engine      || null,
      pressure_system:   rawSpine.pressure_system   || null,
      central_conflict:  rawSpine.central_conflict  || null,
      inciting_incident: rawSpine.inciting_incident || null,
      resolution_type:   rawSpine.resolution_type   || null,
      stakes_class:      rawSpine.stakes_class       || null,
      protagonist_arc:   rawSpine.protagonist_arc   || null,
      midpoint_reversal: rawSpine.midpoint_reversal || null,
      tonal_gravity:     rawSpine.tonal_gravity      || null,
      // NOTE: locked_at/locked_by intentionally omitted — spine is PROVISIONAL here.
      // Constitutional lock occurs when Concept Brief is approved.
    };
    const spineAxesSet = Object.entries(narrativeSpineJson).filter(([, v]) => v !== null).length;
    console.log(`[promote-to-devseed][spine] narrative_spine_extracted { pitch_idea_id: "${pitchIdeaId}", axes_set: ${spineAxesSet}/9, story_engine: "${narrativeSpineJson.story_engine}", pressure_system: "${narrativeSpineJson.pressure_system}", protagonist_arc: "${narrativeSpineJson.protagonist_arc}", tonal_gravity: "${narrativeSpineJson.tonal_gravity}", lifecycle_state: "provisional" }`);

    // Persist spine to projects table if project is linked
    const linkedProjectId: string | null = idea.project_id || null;
    if (linkedProjectId) {
      const { error: spineErr } = await supabase
        .from('projects')
        .update({ narrative_spine_json: narrativeSpineJson })
        .eq('id', linkedProjectId)
        .is('narrative_spine_json', null); // write-once guard: never overwrite existing spine
      if (spineErr) {
        console.warn(`[promote-to-devseed][spine] spine_persist_failed { project_id: "${linkedProjectId}", error: "${spineErr.message}" }`);
      } else {
        console.log(`[promote-to-devseed][spine] spine_persisted { project_id: "${linkedProjectId}", state: "provisional" }`);

        // ── Write decision_ledger entry: pending_lock (awaiting user confirmation + CB approval) ──
        // LIFECYCLE: provisional → confirmed (user action) → locked (CB approval)
        // status='pending_lock', locked=false — NOT locked yet. Locks at Concept Brief approval.
        const { data: ledgerEntry, error: ledgerErr } = await supabase
          .from('decision_ledger')
          .insert({
            project_id:    linkedProjectId,
            decision_key:  'narrative_spine',
            title:         'Narrative Spine (Provisional)',
            decision_text: 'Narrative spine inferred from DevSeed generation — awaiting user confirmation and Concept Brief approval to lock.',
            source:        'promote-to-devseed',
            decision_value: narrativeSpineJson,
            status:        'pending_lock',
            locked:        false,
            meta: {
              confirmed_by:       null,
              confirmed_at:       null,
              amends:             null,
              amendment_severity: null,
              axes_set:           spineAxesSet,
            },
          })
          .select('id')
          .single();
        if (ledgerErr) {
          console.warn(`[promote-to-devseed][spine] decision_ledger_insert_failed { project_id: "${linkedProjectId}", error: "${ledgerErr.message}" }`);
        } else {
          console.log(`[promote-to-devseed][spine] decision_ledger_created { project_id: "${linkedProjectId}", entry_id: "${ledgerEntry?.id}", status: "pending_lock", locked: false }`);
        }
      }
    }

    const { data: expansion, error: expErr } = await supabase
      .from("concept_expansions")
      .insert({
        pitch_idea_id: pitchIdeaId,
        user_id: user.id,
        production_type: idea.production_type,
        treatment: devSeed.bible_starter?.world || "",
        character_bible: JSON.stringify(devSeed.bible_starter?.characters || []),
        tone_doc: devSeed.bible_starter?.tone_and_style || "",
        world_bible: devSeed.bible_starter?.story_engine || "",
        arc_map: JSON.stringify(devSeed.bible_starter?.themes || []),
        raw_response: { ...devSeed, _narrative_spine: narrativeSpineJson },
        version: 1,
      })
      .select("id")
      .single();

    if (expErr) {
      console.error("Failed to store DevSeed:", expErr);
      // Non-fatal — still return the payload
    }

    // Auto-extract episode count from format_summary and persist as devseed canon
    const ideaRawResponse = idea.raw_response || {};
    const formatSummary = ideaRawResponse.format_summary || ideaRawResponse.format || '';
    let extractedEpCount: number | null = null;
    const epMatch = formatSummary.match(/(\d+)\s*x\s*/i) || formatSummary.match(/(\d+)\s*episodes/i);
    if (epMatch) extractedEpCount = parseInt(epMatch[1]);

    const updatePayload: Record<string, any> = { status: "in-development" };
    
    // Persist canon if we extracted an episode count and none is set yet
    const existingCanon = idea.devseed_canon_json || {};
    if (extractedEpCount && extractedEpCount > 0 && !existingCanon.season_episode_count) {
      updatePayload.devseed_canon_json = {
        ...existingCanon,
        season_episode_count: extractedEpCount,
        format: idea.production_type || 'vertical-drama',
        locked: true,
        locked_at: new Date().toISOString(),
        source: 'format_summary_auto',
      };
      console.log(`[promote-to-devseed] Auto-persisted canon episode count: ${extractedEpCount} from format_summary`);
    }

    // Update pitch idea status (and canon if extracted)
    await supabase
      .from("pitch_ideas")
      .update(updatePayload)
      .eq("id", pitchIdeaId);

    return new Response(JSON.stringify({
      devseed: devSeed,
      expansion_id: expansion?.id || null,
      pitch_idea_id: pitchIdeaId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("promote-to-devseed error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
