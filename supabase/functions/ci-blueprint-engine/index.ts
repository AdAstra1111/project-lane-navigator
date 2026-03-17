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
      } = body;

      console.log(`[ci-blueprint] build start: format=${format} lane=${lane} genre=${genre} count=${candidateCount}`);

      // 1. Create run record
      const { data: run, error: runErr } = await svcClient
        .from("idea_blueprint_runs")
        .insert({
          user_id: user.id,
          status: "running",
          config: { format, lane, genre, engine, budgetBand, candidateCount, useTrends, useExemplars, ciMin },
        })
        .select("id")
        .single();
      if (runErr) throw new Error(`Run creation failed: ${runErr.message}`);
      const runId = run.id;

      // 2. Fetch high-CI exemplar ideas for structural patterns
      let exemplarQuery = svcClient
        .from("pitch_ideas")
        .select("id, title, production_type, recommended_lane, genre, source_engine_key, budget_band, score_total, score_market_heat, score_feasibility, score_lane_fit, score_saturation_risk, score_company_fit, logline, comps, packaging_suggestions, risks_mitigations")
        .gte("score_total", ciMin)
        .order("score_total", { ascending: false })
        .limit(30);

      if (format) exemplarQuery = exemplarQuery.eq("production_type", format);
      if (lane) exemplarQuery = exemplarQuery.eq("recommended_lane", lane);
      if (genre) exemplarQuery = exemplarQuery.ilike("genre", `%${genre}%`);
      if (useExemplars) exemplarQuery = exemplarQuery.eq("is_exemplar", true);

      const { data: exemplars, error: exErr } = await exemplarQuery;
      if (exErr) console.warn(`[ci-blueprint] exemplar fetch error: ${exErr.message}`);
      const sourceIdeas = exemplars || [];
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

      // 5. Create blueprint record
      const { data: blueprint, error: bpErr } = await svcClient
        .from("idea_blueprints")
        .insert({
          run_id: runId,
          user_id: user.id,
          format,
          lane: lane || scorePatterns.common_lanes[0] || "",
          genre: genre || scorePatterns.common_genres[0] || "",
          engine: engine || null,
          budget_band: budgetBand || scorePatterns.common_budget_bands[0] || "",
          structural_patterns: scorePatterns,
          market_design: { useTrends, trendCount: trendSignalIds.length },
          derived_from_idea_ids: sourceIdeas.map((i: any) => i.id),
          trend_inputs: trendSignalIds.map((id: string) => ({ signal_id: id })),
          exemplar_inputs: sourceIdeas.map((i: any) => ({ id: i.id, title: i.title, score_total: i.score_total })),
          score_pattern: scorePatterns,
        })
        .select("id")
        .single();
      if (bpErr) throw new Error(`Blueprint creation failed: ${bpErr.message}`);

      // 6. Generate candidates via LLM
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
- Score each idea honestly on the same 0-100 scale used for the source patterns.
- Prioritize: hook clarity, protagonist distinctiveness, conflict engine strength, market positioning, and feasibility.
${structuralContext}${trendContext}

Format: ${format}
Lane: ${lane || "best fit"}
Genre: ${genre || "best fit"}
Budget band: ${budgetBand || "flexible"}
${engine ? `Engine: ${engine}` : ""}`;

      const userPrompt = `Generate exactly ${Math.min(candidateCount, 10)} original pitch idea candidates. Each must be structurally strong and market-aligned.`;

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
                    protagonist_archetype: { type: "string" },
                    conflict_engine: { type: "string" },
                    hook_clarity: { type: "string" },
                    market_positioning: { type: "string" },
                    score_market_heat: { type: "number" },
                    score_feasibility: { type: "number" },
                    score_lane_fit: { type: "number" },
                    score_saturation_risk: { type: "number" },
                    score_company_fit: { type: "number" },
                    score_total: { type: "number" },
                  },
                  required: ["title", "logline", "one_page_pitch", "genre", "format", "lane", "budget_band", "score_market_heat", "score_feasibility", "score_lane_fit", "score_saturation_risk", "score_company_fit", "score_total"],
                  additionalProperties: false,
                },
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      }];

      console.log(`[ci-blueprint] calling AI for ${candidateCount} candidates`);
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
        else throw new Error("No structured output");
      } else {
        throw new Error("No structured output");
      }

      const candidates = parsed.candidates || parsed.ideas || [];
      console.log(`[ci-blueprint] generated ${candidates.length} candidates`);

      // 7. Persist candidates
      const savedCandidates = [];
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
            engine: engine || null,
            budget_band: c.budget_band || budgetBand || "",
            score_market_heat: c.score_market_heat || 0,
            score_feasibility: c.score_feasibility || 0,
            score_lane_fit: c.score_lane_fit || 0,
            score_saturation_risk: c.score_saturation_risk || 0,
            score_company_fit: c.score_company_fit || 0,
            score_total: c.score_total || 0,
            raw_response: c,
            provenance: {
              blueprint_id: blueprint.id,
              run_id: runId,
              source_idea_count: sourceIdeas.length,
              trend_signal_count: trendSignalIds.length,
              promotion_source: "ci_blueprint_engine",
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

      // 8. Update run
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

      console.log(`[ci-blueprint] completed: ${savedCandidates.length} candidates saved`);

      return new Response(JSON.stringify({
        run_id: runId,
        blueprint_id: blueprint.id,
        candidates: savedCandidates,
        source_idea_count: sourceIdeas.length,
        trend_count: trendSignalIds.length,
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
          raw_response: {
            ...candidate.raw_response,
            promotion_source: "ci_blueprint_engine",
            blueprint_candidate_id: candidate.id,
            blueprint_id: candidate.blueprint_id,
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
