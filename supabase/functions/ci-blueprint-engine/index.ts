import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPitchScoringRubric, normalizePitchScores, calculatePitchScoreTotal, checkScoreDrift, PITCH_SCORE_WEIGHTS } from "../_shared/pitchScoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const svcClient = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { action } = body;

    // ── ACTION: build ──
    if (action === "build") {
      const {
        format = "film", lane = "", genre = "", engine = "", budgetBand = "",
        candidateCount = 5, useTrends = false, useExemplars = false, ciMin = 95,
        sourceDnaProfileId = null,
      } = body;

      console.log(`[ci-blueprint] build start: format=${format} lane=${lane} genre=${genre} count=${candidateCount} dna=${sourceDnaProfileId || 'none'}`);

      // ── DNA RETRIEVAL ──
      let dnaProfile: any = null;
      let dnaConstraintMode = "none";
      let dnaEngineKey: string | null = null;
      let dnaPromptBlock = "";

      if (sourceDnaProfileId) {
        const { data: profile, error: dnaErr } = await svcClient
          .from("narrative_dna_profiles")
          .select("id, source_title, source_type, status, spine_json, thematic_spine, escalation_architecture, antagonist_pattern, emotional_cadence, world_logic_rules, set_piece_grammar, ending_logic, power_dynamic, forbidden_carryovers, mutable_variables, primary_engine_key, secondary_engine_key, extraction_confidence")
          .eq("id", sourceDnaProfileId)
          .eq("user_id", user.id)
          .single();

        if (dnaErr || !profile) {
          console.warn(`[ci-blueprint] DNA profile not found or not owned: ${sourceDnaProfileId}`);
        } else if (profile.status !== "locked") {
          console.warn(`[ci-blueprint] DNA profile not locked: ${sourceDnaProfileId} status=${profile.status}`);
        } else {
          dnaProfile = profile;
          dnaConstraintMode = "dna_profile";
          dnaEngineKey = profile.primary_engine_key || null;
          console.log(`[ci-blueprint] DNA loaded: "${profile.source_title}" engine=${dnaEngineKey || 'none'} confidence=${profile.extraction_confidence}`);

          // Build structured DNA constraint block for prompt
          const spineAxes = profile.spine_json || {};
          const spineLines = Object.entries(spineAxes)
            .filter(([_, v]) => v)
            .map(([k, v]) => `  - ${k}: ${v}`)
            .join("\n");

          const dnaLines: string[] = [
            `NARRATIVE DNA CONSTRAINTS (from "${profile.source_title}"):`,
            `These constraints define the STRUCTURAL IDENTITY of the story DNA. Generated ideas must preserve these narrative patterns while creating COMPLETELY ORIGINAL stories. Do NOT reproduce the source story's plot, characters, or setting.`,
            ``,
            `ORIGINALITY GUARDRAIL: You are extracting structural DNA patterns only. Generated ideas must be wholly original — new characters, new world, new plot. The DNA provides narrative architecture, not content to clone.`,
          ];
          if (spineLines) dnaLines.push(``, `NARRATIVE SPINE:`, spineLines);
          if (profile.thematic_spine) dnaLines.push(`THEMATIC SPINE: ${profile.thematic_spine}`);
          if (profile.escalation_architecture) dnaLines.push(`ESCALATION ARCHITECTURE: ${profile.escalation_architecture}`);
          if (profile.antagonist_pattern) dnaLines.push(`ANTAGONIST PATTERN: ${profile.antagonist_pattern}`);
          if (profile.power_dynamic) dnaLines.push(`POWER DYNAMIC: ${profile.power_dynamic}`);
          if (profile.ending_logic) dnaLines.push(`ENDING LOGIC: ${profile.ending_logic}`);
          if (profile.set_piece_grammar) dnaLines.push(`SET PIECE GRAMMAR: ${profile.set_piece_grammar}`);
          if (profile.emotional_cadence?.length) dnaLines.push(`EMOTIONAL CADENCE: ${profile.emotional_cadence.join(" → ")}`);
          if (profile.world_logic_rules?.length) dnaLines.push(`WORLD LOGIC RULES:`, ...profile.world_logic_rules.map((r: string) => `  - ${r}`));
          if (profile.forbidden_carryovers?.length) dnaLines.push(`FORBIDDEN CARRYOVERS (do NOT use these from the source):`, ...profile.forbidden_carryovers.map((f: string) => `  - ${f}`));
          if (profile.mutable_variables?.length) dnaLines.push(`MUTABLE VARIABLES (may be adapted freely):`, ...profile.mutable_variables.map((m: string) => `  - ${m}`));
          if (dnaEngineKey) dnaLines.push(`ENGINE PATTERN: ${dnaEngineKey}`);

          dnaPromptBlock = "\n\n" + dnaLines.join("\n");
        }
      }

      const optimizerMode = dnaProfile ? "dna_informed" : "ci_pattern";

      // 1. Create run record
      const { data: run, error: runErr } = await svcClient
        .from("idea_blueprint_runs")
        .insert({
          user_id: user.id,
          status: "running",
          config: { format, lane, genre, engine, budgetBand, candidateCount, useTrends, useExemplars, ciMin, sourceDnaProfileId },
          source_dna_profile_id: sourceDnaProfileId || null,
          dna_inputs: dnaProfile ? [{
            profile_id: dnaProfile.id,
            source_title: dnaProfile.source_title,
            engine_key: dnaEngineKey,
            thematic_spine: dnaProfile.thematic_spine,
            confidence: dnaProfile.extraction_confidence,
          }] : [],
          optimizer_mode: optimizerMode,
        })
        .select("id")
        .single();
      if (runErr) throw new Error(`Run creation failed: ${runErr.message}`);
      const runId = run.id;

      // 2. Fetch high-CI exemplar ideas for structural patterns
      // When DNA is active, prefer ideas with matching engine key
      let exemplarQuery = svcClient
        .from("pitch_ideas")
        .select("id, title, production_type, recommended_lane, genre, source_engine_key, source_dna_profile_id, budget_band, score_total, score_market_heat, score_feasibility, score_lane_fit, score_saturation_risk, score_company_fit, logline, comps, packaging_suggestions, risks_mitigations")
        .gte("score_total", ciMin)
        .order("score_total", { ascending: false })
        .limit(30);

      if (format) exemplarQuery = exemplarQuery.eq("production_type", format);
      if (lane) exemplarQuery = exemplarQuery.eq("recommended_lane", lane);
      if (genre) exemplarQuery = exemplarQuery.ilike("genre", `%${genre}%`);
      if (useExemplars) exemplarQuery = exemplarQuery.eq("is_exemplar", true);

      const { data: exemplars, error: exErr } = await exemplarQuery;
      if (exErr) console.warn(`[ci-blueprint] exemplar fetch error: ${exErr.message}`);
      let sourceIdeas = exemplars || [];

      // DNA-aware source idea biasing: staged retrieval policy
      // Tier 1: exact DNA profile match (boost +3)
      // Tier 2: engine key match (boost +2)
      // Tier 3: generic CI fallback (boost 0)
      if (dnaProfile && sourceIdeas.length > 0) {
        const scored = sourceIdeas.map((idea: any) => {
          let boost = 0;
          let tier = "generic";
          if (sourceDnaProfileId && idea.source_dna_profile_id === sourceDnaProfileId) {
            boost += 3;
            tier = "dna_exact";
          } else if (dnaEngineKey && idea.source_engine_key === dnaEngineKey) {
            boost += 2;
            tier = "engine_match";
          }
          return { ...idea, _dna_boost: boost, _dna_tier: tier };
        });
        scored.sort((a: any, b: any) => {
          if (b._dna_boost !== a._dna_boost) return b._dna_boost - a._dna_boost;
          return (Number(b.score_total) || 0) - (Number(a.score_total) || 0);
        });
        sourceIdeas = scored;

        // Explicit tier breakdown logging
        const dnaExact = scored.filter((s: any) => s._dna_tier === "dna_exact").length;
        const engineMatch = scored.filter((s: any) => s._dna_tier === "engine_match").length;
        const generic = scored.filter((s: any) => s._dna_tier === "generic").length;
        console.log(`[ci-blueprint] DNA retrieval breakdown: dna_exact=${dnaExact} engine_match=${engineMatch} generic_fallback=${generic} total=${sourceIdeas.length}`);

        if (dnaExact === 0 && engineMatch === 0) {
          console.warn(`[ci-blueprint] DNA_FALLBACK: no DNA or engine-matched source ideas found. All ${sourceIdeas.length} ideas are generic CI fallback. DNA constraints will rely on prompt only.`);
        }
      } else if (dnaProfile && sourceIdeas.length === 0) {
        console.warn(`[ci-blueprint] DNA_FALLBACK: DNA profile selected but 0 source ideas found at CI>=${ciMin}. Blueprint will rely entirely on DNA prompt constraints.`);
      }

      console.log(`[ci-blueprint] found ${sourceIdeas.length} source ideas`);

      // 3. Fetch trend signals if requested
      let trendContext = "";
      let trendSignalIds: string[] = [];
      if (useTrends) {
        let tq = svcClient
          .from("trend_signals")
          .select("id, name, category, strength, velocity, explanation, genre_tags, tone_tags, cycle_phase, saturation_risk")
          .eq("status", "active")
          .order("strength", { ascending: false })
          .limit(15);
        if (format) tq = tq.eq("production_type", format);
        const { data: signals } = await tq;
        if (signals && signals.length > 0) {
          trendSignalIds = signals.map((s: any) => s.id);
          trendContext = `\n\nACTIVE MARKET TRENDS (use to inform market positioning, NOT to copy):\n${signals.map((s: any) =>
            `- ${s.name} (strength: ${s.strength}, velocity: ${s.velocity}, cycle: ${s.cycle_phase}): ${s.explanation}`
          ).join("\n")}`;
        }
        console.log(`[ci-blueprint] trend signals: ${trendSignalIds.length}`);
      }

      // 4. Derive structural patterns (metadata only, no text copying)
      const scorePatterns = {
        avg_total: sourceIdeas.length ? sourceIdeas.reduce((s: number, i: any) => s + (Number(i.score_total) || 0), 0) / sourceIdeas.length : 0,
        avg_market_heat: sourceIdeas.length ? sourceIdeas.reduce((s: number, i: any) => s + (Number(i.score_market_heat) || 0), 0) / sourceIdeas.length : 0,
        avg_feasibility: sourceIdeas.length ? sourceIdeas.reduce((s: number, i: any) => s + (Number(i.score_feasibility) || 0), 0) / sourceIdeas.length : 0,
        avg_lane_fit: sourceIdeas.length ? sourceIdeas.reduce((s: number, i: any) => s + (Number(i.score_lane_fit) || 0), 0) / sourceIdeas.length : 0,
        common_budget_bands: [...new Set(sourceIdeas.map((i: any) => i.budget_band).filter(Boolean))],
        common_lanes: [...new Set(sourceIdeas.map((i: any) => i.recommended_lane).filter(Boolean))],
        common_genres: [...new Set(sourceIdeas.map((i: any) => i.genre).filter(Boolean))],
        idea_count: sourceIdeas.length,
      };

      // 5. Create blueprint record with enriched design schema
      const { data: blueprint, error: bpErr } = await svcClient
        .from("idea_blueprints")
        .insert({
          run_id: runId,
          user_id: user.id,
          format,
          lane: lane || scorePatterns.common_lanes[0] || "",
          genre: genre || scorePatterns.common_genres[0] || "",
          engine: engine || dnaEngineKey || null,
          budget_band: budgetBand || scorePatterns.common_budget_bands[0] || "",
          source_dna_profile_id: sourceDnaProfileId || null,
          source_engine_key: dnaEngineKey || null,
          dna_constraint_mode: dnaConstraintMode,
          blueprint_mode: optimizerMode,
          structural_patterns: scorePatterns,
          market_design: {
            useTrends,
            trendCount: trendSignalIds.length,
            trend_signal_ids: trendSignalIds,
            positioning_strategy: lane ? `${lane}-optimized` : "best-fit",
            dna_informed: !!dnaProfile,
          },
          protagonist_design: {
            instruction: "Protagonist must have a clear want, a deep need, and a defining flaw that drives conflict.",
            archetypes_observed: sourceIdeas.length > 0 ? "derived_from_elite_patterns" : "unconstrained",
          },
          conflict_design: {
            instruction: "Conflict engine must sustain a full season/feature arc. Avoid single-revelation plots.",
            escalation_required: true,
          },
          hook_type: "",
          feasibility_design: {
            budget_band: budgetBand || scorePatterns.common_budget_bands[0] || "mid",
            location_constraint: "minimize",
            cast_scale: budgetBand === "micro" ? "small" : budgetBand === "tentpole" ? "large" : "medium",
          },
          novelty_constraints: {
            no_clone_from_exemplars: true,
            differentiation_required: true,
            source_idea_count: sourceIdeas.length,
            dna_originality_guardrail: !!dnaProfile,
          },
          derived_from_idea_ids: sourceIdeas.map((i: any) => i.id),
          trend_inputs: trendSignalIds.map((id: string) => ({ signal_id: id })),
          exemplar_inputs: sourceIdeas.map((i: any) => ({ id: i.id, title: i.title, score_total: i.score_total })),
          score_pattern: scorePatterns,
        })
        .select("id")
        .single();
      if (bpErr) throw new Error(`Blueprint creation failed: ${bpErr.message}`);

      // 6. Generate candidates via LLM (generation only, no self-scoring)
      const structuralContext = sourceIdeas.length > 0
        ? `\nHIGH-PERFORMING IDEA STRUCTURAL PATTERNS (use as design signals, do NOT copy text or plots):
- Average CI Score: ${scorePatterns.avg_total.toFixed(1)}
- Average Market Heat: ${scorePatterns.avg_market_heat.toFixed(1)}
- Average Feasibility: ${scorePatterns.avg_feasibility.toFixed(1)}
- Common lanes: ${scorePatterns.common_lanes.join(", ")}
- Common genres: ${scorePatterns.common_genres.join(", ")}
- Common budget bands: ${scorePatterns.common_budget_bands.join(", ")}
- Source count: ${sourceIdeas.length} elite ideas analyzed`
        : "";

      const systemPrompt = `You are a world-class film/TV concept architect. Your job is to design ORIGINAL pitch ideas that structurally match the success patterns of elite concepts.

CRITICAL RULES:
- Generate completely ORIGINAL concepts. Do NOT copy, paraphrase, or closely resemble any existing titles.
- Use the structural patterns (format, lane, genre, score targets) as design constraints, NOT as content to clone.
- Each idea must have a distinctive hook, original characters, and fresh premise.
- Do NOT self-score. Scores will be evaluated independently by a separate system.
- Prioritize: hook clarity, protagonist distinctiveness, conflict engine strength, market positioning, and feasibility.
- For each idea, explicitly describe: protagonist_design, conflict_design, hook_type, market_positioning, feasibility_notes.
${structuralContext}${trendContext}${dnaPromptBlock}

Format: ${format}
Lane: ${lane || "best fit"}
Genre: ${genre || "best fit"}
Budget band: ${budgetBand || "flexible"}
${engine ? `Engine: ${engine}` : dnaEngineKey ? `Engine (from DNA): ${dnaEngineKey}` : ""}
${dnaProfile ? `\nBLUEPRINT MODE: DNA-Informed — ideas must structurally align with the DNA constraints above while being completely original.` : ""}`;

      const userPrompt = `Generate exactly ${Math.min(candidateCount, 10)} original pitch idea candidates. Each must be structurally strong and market-aligned. Include rich design metadata for each.`;

      const toolsDef = [{
        type: "function" as const,
        function: {
          name: "submit_candidates",
          description: "Submit generated candidate ideas",
          parameters: {
            type: "object",
            properties: {
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    logline: { type: "string" },
                    one_page_pitch: { type: "string" },
                    genre: { type: "string" },
                    format: { type: "string" },
                    lane: { type: "string" },
                    budget_band: { type: "string" },
                    protagonist_design: { type: "string", description: "Who is the protagonist, their want/need/flaw" },
                    conflict_design: { type: "string", description: "Core conflict engine and escalation path" },
                    hook_type: { type: "string", description: "What type of hook: mystery, irony, stakes, moral dilemma, etc." },
                    market_positioning: { type: "string", description: "Target audience, comp positioning, buyer angle" },
                    feasibility_notes: { type: "string", description: "Budget, location, cast, VFX considerations" },
                    novelty_claim: { type: "string", description: "What makes this genuinely fresh vs existing market" },
                  },
                  required: ["title", "logline", "one_page_pitch", "genre", "format", "lane", "budget_band", "protagonist_design", "conflict_design", "hook_type", "market_positioning", "feasibility_notes"],
                  additionalProperties: false,
                },
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      }];

      console.log(`[ci-blueprint] calling AI for ${candidateCount} candidates (mode=${optimizerMode})`);
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: toolsDef,
          tool_choice: { type: "function", function: { name: "submit_candidates" } },
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error(`[ci-blueprint] AI error: ${resp.status} ${t}`);
        await svcClient.from("idea_blueprint_runs").update({ status: "failed", error: `AI error: ${resp.status}` }).eq("id", runId);
        throw new Error("AI generation failed");
      }

      const result = await resp.json();
      if (result.error) {
        await svcClient.from("idea_blueprint_runs").update({ status: "failed", error: result.error?.message || "AI error" }).eq("id", runId);
        throw new Error(result.error?.message || "AI generation failed");
      }

      const msg = result.choices?.[0]?.message;
      const toolCall = msg?.tool_calls?.[0];
      let parsed: any;

      if (toolCall?.function?.arguments) {
        parsed = JSON.parse(toolCall.function.arguments);
      } else if (msg?.content) {
        const jsonMatch = msg.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        else throw new Error("No structured output from generation");
      } else {
        throw new Error("No structured output from generation");
      }

      const candidates = parsed.candidates || parsed.ideas || [];
      console.log(`[ci-blueprint] generated ${candidates.length} candidates, starting independent scoring`);

      // 7. Persist candidates with zero scores (pre-evaluation)
      const savedCandidates: any[] = [];
      for (const c of candidates) {
        const { data: saved, error: saveErr } = await svcClient
          .from("idea_blueprint_candidates")
          .insert({
            blueprint_id: blueprint.id,
            run_id: runId,
            user_id: user.id,
            title: c.title || "Untitled",
            logline: c.logline || "",
            one_page_pitch: c.one_page_pitch || "",
            genre: c.genre || genre || "",
            format: c.format || format || "",
            lane: c.lane || lane || "",
            engine: engine || dnaEngineKey || null,
            budget_band: c.budget_band || budgetBand || "",
            // Scores start at 0 — will be filled by independent evaluation
            score_market_heat: 0,
            score_feasibility: 0,
            score_lane_fit: 0,
            score_saturation_risk: 0,
            score_company_fit: 0,
            score_total: 0,
            scoring_method: "pending",
            raw_response: c,
            provenance: {
              blueprint_id: blueprint.id,
              run_id: runId,
              source_idea_count: sourceIdeas.length,
              trend_signal_count: trendSignalIds.length,
              promotion_source: "ci_blueprint_engine",
              optimizer_mode: optimizerMode,
              source_dna_profile_id: sourceDnaProfileId || null,
              source_engine_key: dnaEngineKey || null,
              dna_source_title: dnaProfile?.source_title || null,
              design_metadata: {
                protagonist_design: c.protagonist_design || null,
                conflict_design: c.conflict_design || null,
                hook_type: c.hook_type || null,
                market_positioning: c.market_positioning || null,
                feasibility_notes: c.feasibility_notes || null,
                novelty_claim: c.novelty_claim || null,
              },
            },
          })
          .select("*")
          .single();
        if (saveErr) {
          console.warn(`[ci-blueprint] save error: ${saveErr.message}`);
        } else {
          savedCandidates.push(saved);
        }
      }

      // 8. INDEPENDENT SCORING PASS — evaluate candidates through authoritative scoring
      console.log(`[ci-blueprint] running independent scoring for ${savedCandidates.length} candidates`);

      const scoringPrompt = `You are an authoritative pitch idea evaluator for the film/TV industry. Score each candidate idea on the following dimensions (0-100 each):

SCORING RUBRIC:
${buildPitchScoringRubric({ includeFormulaWarning: true })}

Evaluate these candidates:
${savedCandidates.map((c: any, i: number) => `
[CANDIDATE ${i + 1}] id=${c.id}
Title: ${c.title}
Logline: ${c.logline}
Format: ${c.format} | Lane: ${c.lane} | Genre: ${c.genre} | Budget: ${c.budget_band}
One-page pitch: ${c.one_page_pitch}
`).join("\n---\n")}`;

      const scoringTools = [{
        type: "function" as const,
        function: {
          name: "submit_scores",
          description: "Submit evaluated scores for each candidate",
          parameters: {
            type: "object",
            properties: {
              scores: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    candidate_id: { type: "string" },
                    score_market_heat: { type: "number" },
                    score_feasibility: { type: "number" },
                    score_lane_fit: { type: "number" },
                    score_saturation_risk: { type: "number" },
                    score_company_fit: { type: "number" },
                    score_total: { type: "number" },
                    scoring_rationale: { type: "string" },
                  },
                  required: ["candidate_id", "score_market_heat", "score_feasibility", "score_lane_fit", "score_saturation_risk", "score_company_fit", "score_total"],
                  additionalProperties: false,
                },
              },
            },
            required: ["scores"],
            additionalProperties: false,
          },
        },
      }];

      const scoreResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are a rigorous, independent pitch idea evaluator. Score honestly — do not inflate." },
            { role: "user", content: scoringPrompt },
          ],
          tools: scoringTools,
          tool_choice: { type: "function", function: { name: "submit_scores" } },
        }),
      });

      if (scoreResp.ok) {
        const scoreResult = await scoreResp.json();
        const scoreMsg = scoreResult.choices?.[0]?.message;
        const scoreToolCall = scoreMsg?.tool_calls?.[0];
        let scoreParsed: any;

        if (scoreToolCall?.function?.arguments) {
          scoreParsed = JSON.parse(scoreToolCall.function.arguments);
        } else if (scoreMsg?.content) {
          const jsonMatch = scoreMsg.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) scoreParsed = JSON.parse(jsonMatch[0]);
        }

        const evaluatedScores = scoreParsed?.scores || [];
        console.log(`[ci-blueprint] received ${evaluatedScores.length} independent scores`);

        // Update each candidate with evaluated scores
        for (const es of evaluatedScores) {
          const candidateId = es.candidate_id;
          const candidate = savedCandidates.find((c: any) => c.id === candidateId);
          if (!candidate) continue;

          // Recalculate total using shared canonical scorer
          const normalizedScores = normalizePitchScores(es);
          const recalcTotal = normalizedScores.score_total;
          const drift = checkScoreDrift(normalizedScores, Number(es.score_total) || 0);
          if (drift) console.warn(`[ci-blueprint] ${drift} candidate=${candidateId}`);

          await svcClient
            .from("idea_blueprint_candidates")
            .update({
              score_market_heat: normalizedScores.score_market_heat,
              score_feasibility: normalizedScores.score_feasibility,
              score_lane_fit: normalizedScores.score_lane_fit,
              score_saturation_risk: normalizedScores.score_saturation_risk,
              score_company_fit: normalizedScores.score_company_fit,
              score_total: recalcTotal,
              scoring_method: "independent_evaluation",
              evaluated_scores: {
                raw_llm_scores: es,
                recalculated_total: recalcTotal,
                scoring_module: "pitchScoring.ts",
                evaluator_model: "google/gemini-2.5-flash",
                evaluated_at: new Date().toISOString(),
                rationale: es.scoring_rationale || null,
                drift_warning: drift || null,
              },
            })
            .eq("id", candidateId);

          // Update in-memory for response
          candidate.score_market_heat = normalizedScores.score_market_heat;
          candidate.score_feasibility = normalizedScores.score_feasibility;
          candidate.score_lane_fit = normalizedScores.score_lane_fit;
          candidate.score_saturation_risk = normalizedScores.score_saturation_risk;
          candidate.score_company_fit = normalizedScores.score_company_fit;
          candidate.score_total = recalcTotal;
          candidate.scoring_method = "independent_evaluation";
        }
      } else {
        console.error(`[ci-blueprint] scoring pass failed: ${scoreResp.status}`);
        // Mark candidates as scoring_failed but don't block
        for (const c of savedCandidates) {
          await svcClient.from("idea_blueprint_candidates")
            .update({ scoring_method: "scoring_failed" })
            .eq("id", c.id);
          c.scoring_method = "scoring_failed";
        }
      }

      // 9. Update run
      await svcClient
        .from("idea_blueprint_runs")
        .update({
          status: "completed",
          blueprint_count: 1,
          candidate_count: savedCandidates.length,
          exemplar_ids: sourceIdeas.map((i: any) => i.id),
          trend_signal_ids: trendSignalIds,
          source_idea_ids: sourceIdeas.map((i: any) => i.id),
        })
        .eq("id", runId);

      console.log(`[ci-blueprint] completed: ${savedCandidates.length} candidates saved and scored (mode=${optimizerMode})`);

      return new Response(JSON.stringify({
        run_id: runId,
        blueprint_id: blueprint.id,
        candidates: savedCandidates,
        source_idea_count: sourceIdeas.length,
        trend_count: trendSignalIds.length,
        optimizer_mode: optimizerMode,
        dna_profile_title: dnaProfile?.source_title || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ACTION: promote ──
    if (action === "promote") {
      const { candidateId } = body;
      if (!candidateId) throw new Error("candidateId required");

      const { data: candidate, error: cErr } = await svcClient
        .from("idea_blueprint_candidates")
        .select("*")
        .eq("id", candidateId)
        .single();
      if (cErr || !candidate) throw new Error("Candidate not found");
      if (candidate.user_id !== user.id) throw new Error("Forbidden");

      // Reject if scoring was not completed
      if (candidate.scoring_method !== "independent_evaluation") {
        return new Response(JSON.stringify({
          error: "Cannot promote: candidate was not independently scored",
          scoring_method: candidate.scoring_method,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Threshold check
      const thresholds = { score_total: 95, score_market_heat: 80, score_feasibility: 75, score_lane_fit: 80 };
      const failures: string[] = [];
      if (Number(candidate.score_total) < thresholds.score_total) failures.push(`score_total ${candidate.score_total} < ${thresholds.score_total}`);
      if (Number(candidate.score_market_heat) < thresholds.score_market_heat) failures.push(`score_market_heat ${candidate.score_market_heat} < ${thresholds.score_market_heat}`);
      if (Number(candidate.score_feasibility) < thresholds.score_feasibility) failures.push(`score_feasibility ${candidate.score_feasibility} < ${thresholds.score_feasibility}`);
      if (Number(candidate.score_lane_fit) < thresholds.score_lane_fit) failures.push(`score_lane_fit ${candidate.score_lane_fit} < ${thresholds.score_lane_fit}`);

      if (failures.length > 0) {
        return new Response(JSON.stringify({ error: "Below promotion thresholds", failures }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract DNA provenance from candidate
      const provenance = (candidate.provenance as Record<string, any>) || {};

      // Create pitch idea from candidate
      const { data: pitchIdea, error: piErr } = await svcClient
        .from("pitch_ideas")
        .insert({
          user_id: user.id,
          mode: "greenlight",
          status: "draft",
          production_type: candidate.format || "",
          title: candidate.title,
          logline: candidate.logline,
          one_page_pitch: candidate.one_page_pitch,
          comps: [],
          recommended_lane: candidate.lane || "",
          lane_confidence: 0,
          budget_band: candidate.budget_band || "",
          packaging_suggestions: [],
          development_sprint: [],
          risks_mitigations: [],
          why_us: "",
          genre: candidate.genre || "",
          region: "",
          platform_target: "",
          risk_level: "medium",
          score_market_heat: candidate.score_market_heat,
          score_feasibility: candidate.score_feasibility,
          score_lane_fit: candidate.score_lane_fit,
          score_saturation_risk: candidate.score_saturation_risk,
          score_company_fit: candidate.score_company_fit,
          score_total: candidate.score_total,
          source_engine_key: provenance.source_engine_key || candidate.engine || null,
          source_dna_profile_id: provenance.source_dna_profile_id || null,
          raw_response: {
            ...((candidate.raw_response as Record<string, unknown>) || {}),
            promotion_source: "ci_blueprint_engine",
            blueprint_candidate_id: candidate.id,
            blueprint_id: candidate.blueprint_id,
            blueprint_run_id: candidate.run_id,
            scoring_method: candidate.scoring_method,
            evaluated_scores: candidate.evaluated_scores,
            optimizer_mode: provenance.optimizer_mode || "ci_pattern",
            source_dna_profile_id: provenance.source_dna_profile_id || null,
            source_engine_key: provenance.source_engine_key || null,
            dna_source_title: provenance.dna_source_title || null,
            generation_mode: provenance.optimizer_mode || "ci_pattern",
          },
        })
        .select("id")
        .single();
      if (piErr) throw new Error(`Pitch idea creation failed: ${piErr.message}`);

      // Update candidate
      await svcClient
        .from("idea_blueprint_candidates")
        .update({
          promotion_status: "promoted",
          promotion_source: "ci_blueprint_engine",
          promoted_at: new Date().toISOString(),
          promoted_pitch_idea_id: pitchIdea.id,
          pitch_idea_id: pitchIdea.id,
        })
        .eq("id", candidateId);

      console.log(`[ci-blueprint] promoted candidate ${candidateId} → pitch_idea ${pitchIdea.id}`);

      return new Response(JSON.stringify({ pitch_idea_id: pitchIdea.id, candidate_id: candidateId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ci-blueprint] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
