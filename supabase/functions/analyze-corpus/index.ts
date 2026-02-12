import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANALYSIS_MODEL = "google/gemini-2.5-flash";

async function callAIWithTools(apiKey: string, systemPrompt: string, userPrompt: string, tools: any[], toolChoice: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: toolChoice,
      }),
    });
    if (!resp.ok) {
      if (resp.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (resp.status === 402) throw new Error("AI usage limit reached. Please add credits.");
      throw new Error(`AI error ${resp.status}`);
    }
    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) return JSON.parse(toolCall.function.arguments);
    const content = data.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } finally {
    clearTimeout(timeout);
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildBaselinePattern(scripts: any[]) {
  const nums = (key: string) => scripts.map(s => s[key]).filter((v: any) => v != null && v !== 0) as number[];
  const pageNums = nums('page_count');
  const sceneNums = nums('scene_count');
  const dialogueNums = nums('avg_dialogue_ratio');
  const runtimeNums = nums('runtime_est');
  const castNums = nums('cast_count');
  const locationNums = nums('location_count');
  const sceneLenNums = nums('avg_scene_length');
  const midpointNums = nums('midpoint_position');
  const climaxNums = nums('climax_position');
  const qualityNums = nums('quality_score_est');
  const intExtNums = nums('int_ext_ratio');
  const dayNightNums = nums('day_night_ratio');

  return {
    sample_size: scripts.length,
    // Core metrics with ranges
    median_page_count: median(pageNums),
    min_page_count: pageNums.length ? Math.min(...pageNums) : 0,
    max_page_count: pageNums.length ? Math.max(...pageNums) : 0,
    p25_page_count: percentile(pageNums, 25),
    p75_page_count: percentile(pageNums, 75),
    median_scene_count: median(sceneNums),
    min_scene_count: sceneNums.length ? Math.min(...sceneNums) : 0,
    max_scene_count: sceneNums.length ? Math.max(...sceneNums) : 0,
    p25_scene_count: percentile(sceneNums, 25),
    p75_scene_count: percentile(sceneNums, 75),
    median_runtime: median(runtimeNums),
    median_dialogue_ratio: median(dialogueNums),
    p25_dialogue_ratio: percentile(dialogueNums, 25),
    p75_dialogue_ratio: percentile(dialogueNums, 75),
    median_cast_size: median(castNums),
    p25_cast_size: percentile(castNums, 25),
    p75_cast_size: percentile(castNums, 75),
    median_location_count: median(locationNums),
    p25_location_count: percentile(locationNums, 25),
    p75_location_count: percentile(locationNums, 75),
    // Structure
    median_midpoint_position: median(midpointNums),
    median_climax_position: median(climaxNums),
    median_avg_scene_length: median(sceneLenNums),
    median_quality_score: median(qualityNums),
    // Feasibility
    median_int_ext_ratio: median(intExtNums),
    median_day_night_ratio: median(dayNightNums),
    vfx_rate: scripts.filter(s => s.vfx_flag).length / scripts.length,
    budget_distribution: scripts.reduce((acc: Record<string, number>, s: any) => {
      const tier = s.budget_tier_est || "unknown";
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {}),
    // Style profile (derived from metrics)
    style_profile: {
      avg_scene_length: median(sceneLenNums),
      dialogue_action_ratio: median(dialogueNums),
      pacing_density: sceneNums.length && pageNums.length ? median(sceneNums) / median(pageNums) : 0,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const db = createClient(supabaseUrl, supabaseKey);
    const { action, ...params } = await req.json();

    // ═══ ACTION: ANALYZE (single script) ═══
    if (action === "analyze") {
      const { script_id } = params;
      if (!script_id) throw new Error("script_id required");

      const { data: script, error: sErr } = await db
        .from("corpus_scripts")
        .select("*, approved_sources(title)")
        .eq("id", script_id)
        .eq("user_id", user.id)
        .single();
      if (sErr || !script) throw new Error("Script not found");

      await db.from("corpus_scripts").update({ analysis_status: "analyzing" }).eq("id", script_id);

      const { data: chunks } = await db
        .from("corpus_chunks")
        .select("chunk_text")
        .eq("script_id", script_id)
        .order("chunk_index", { ascending: true });

      const fullText = (chunks || []).map((c: any) => c.chunk_text).join("\n");
      const excerpt = fullText.slice(0, 20000);
      const title = script.approved_sources?.title || "Unknown";

      const systemPrompt = `You are a professional screenplay analyst. Analyze the provided screenplay "${title}" and extract structured intelligence. Be precise with numbers. Base all metrics on the actual text provided.`;

      const userPrompt = `Analyze this screenplay excerpt and extract all structural intelligence:

SCREENPLAY TEXT:
${excerpt}

Extract: format type, genre, subgenre, page count, estimated runtime, scene count, word count, average scene length (in pages), dialogue-to-action ratio (0-1), cast count (speaking roles), location count, INT/EXT ratio, DAY/NIGHT ratio, VFX intensity (boolean), budget tier (micro/low/medium/high/mega), quality score (0-100), market success likelihood, midpoint position (fraction 0-1), climax position (fraction 0-1).

Also extract up to 30 scene patterns and up to 15 character profiles.`;

      const tools = [{
        type: "function",
        function: {
          name: "store_analysis",
          description: "Store the structured analysis results",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              production_type: { type: "string", enum: ["film", "tv-series", "short-film", "documentary", "tv-pilot"] },
              format_subtype: { type: "string" },
              genre: { type: "string" },
              subgenre: { type: "string" },
              page_count: { type: "integer" },
              runtime_est: { type: "number" },
              scene_count: { type: "integer" },
              word_count: { type: "integer" },
              avg_scene_length: { type: "number" },
              avg_dialogue_ratio: { type: "number" },
              cast_count: { type: "integer" },
              location_count: { type: "integer" },
              int_ext_ratio: { type: "number" },
              day_night_ratio: { type: "number" },
              vfx_flag: { type: "boolean" },
              budget_tier_est: { type: "string" },
              quality_score_est: { type: "number" },
              market_success_flag: { type: "boolean" },
              midpoint_position: { type: "number" },
              climax_position: { type: "number" },
              scene_patterns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scene_number: { type: "integer" },
                    act_estimate: { type: "integer" },
                    has_turn: { type: "boolean" },
                    conflict_type: { type: "string" },
                    scene_length_est: { type: "number" },
                  },
                  required: ["scene_number", "act_estimate"],
                },
              },
              character_profiles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    character_name: { type: "string" },
                    dialogue_ratio: { type: "number" },
                    arc_type: { type: "string" },
                    protagonist_flag: { type: "boolean" },
                  },
                  required: ["character_name"],
                },
              },
            },
            required: ["production_type", "genre", "page_count", "scene_count", "avg_dialogue_ratio"],
          },
        },
      }];

      const result = await callAIWithTools(lovableKey, systemPrompt, userPrompt, tools, {
        type: "function", function: { name: "store_analysis" },
      });

      await db.from("corpus_scripts").update({
        title: result.title || title,
        production_type: result.production_type || "film",
        format_subtype: result.format_subtype || "",
        genre: result.genre || "",
        subgenre: result.subgenre || "",
        page_count: result.page_count || null,
        runtime_est: result.runtime_est || null,
        scene_count: result.scene_count || null,
        word_count: result.word_count || null,
        avg_scene_length: result.avg_scene_length || null,
        avg_dialogue_ratio: result.avg_dialogue_ratio || null,
        cast_count: result.cast_count || null,
        location_count: result.location_count || null,
        int_ext_ratio: result.int_ext_ratio || null,
        day_night_ratio: result.day_night_ratio || null,
        vfx_flag: result.vfx_flag || false,
        budget_tier_est: result.budget_tier_est || null,
        quality_score_est: result.quality_score_est || null,
        market_success_flag: result.market_success_flag || false,
        midpoint_position: result.midpoint_position || null,
        climax_position: result.climax_position || null,
        analysis_status: "complete",
      }).eq("id", script_id);

      if (result.scene_patterns?.length) {
        await db.from("corpus_scene_patterns").delete().eq("corpus_script_id", script_id);
        const rows = result.scene_patterns.map((sp: any) => ({
          corpus_script_id: script_id,
          user_id: user.id,
          scene_number: sp.scene_number,
          act_estimate: sp.act_estimate,
          has_turn: sp.has_turn || false,
          conflict_type: sp.conflict_type || "",
          scene_length_est: sp.scene_length_est || null,
        }));
        await db.from("corpus_scene_patterns").insert(rows);
      }

      if (result.character_profiles?.length) {
        await db.from("corpus_character_profiles").delete().eq("corpus_script_id", script_id);
        const rows = result.character_profiles.map((cp: any) => ({
          corpus_script_id: script_id,
          user_id: user.id,
          character_name: cp.character_name,
          dialogue_ratio: cp.dialogue_ratio || null,
          arc_type: cp.arc_type || "",
          protagonist_flag: cp.protagonist_flag || false,
        }));
        await db.from("corpus_character_profiles").insert(rows);
      }

      return new Response(JSON.stringify({ success: true, script_id, analysis: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ ACTION: AGGREGATE (build calibration + baseline models) ═══
    if (action === "aggregate") {
      const { data: allCompleted } = await db
        .from("corpus_scripts")
        .select("*")
        .eq("user_id", user.id)
        .eq("analysis_status", "complete");

      if (!allCompleted?.length) throw new Error("No completed analyses to aggregate");

      // ─── Normalization: clean word counts + detect transcripts ───
      const NOISE_PATTERNS = [
        /^\s*\d+\s*$/,                            // bare page/scene numbers
        /^\s*\(?cont(?:inued)?\.?\)?\s*$/i,       // CONTINUED
        /^\s*\(more\)\s*$/i,                      // (MORE)
        /^\s*\(?cont['']d\)?\s*$/i,               // (CONT'D)
        /^\s*revision\s+.*/i,                     // revision headers
        /^\s*\d+\/\d+\/\d+/,                      // date headers
      ];

      function normalizeWordCount(rawText: string | null): { cleanWordCount: number; removedLines: number } {
        if (!rawText) return { cleanWordCount: 0, removedLines: 0 };
        const lines = rawText.split('\n');
        // Count line frequency for header/footer detection
        const lineFreq: Record<string, number> = {};
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0 && trimmed.length < 60) {
            lineFreq[trimmed] = (lineFreq[trimmed] || 0) + 1;
          }
        }
        const repeatedLines = new Set(Object.entries(lineFreq).filter(([, count]) => count > 8).map(([line]) => line));

        let removedLines = 0;
        const cleanLines: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { cleanLines.push(line); continue; }
          if (repeatedLines.has(trimmed)) { removedLines++; continue; }
          if (NOISE_PATTERNS.some(p => p.test(trimmed))) { removedLines++; continue; }
          cleanLines.push(line);
        }
        const cleanText = cleanLines.join(' ');
        const cleanWordCount = cleanText.split(/\s+/).filter(Boolean).length;
        return { cleanWordCount, removedLines };
      }

      function detectTranscript(script: any): { isTranscript: boolean; confidence: number } {
        const sc = script.scene_count || 0;
        const wc = script.word_count || 0;
        const dialogueRatio = script.avg_dialogue_ratio || 0;
        let score = 0;
        // Very high dialogue ratio (>0.8) suggests transcript
        if (dialogueRatio > 0.8) score += 0.3;
        // Very few sluglines relative to word count
        if (sc < 5 && wc > 15000) score += 0.3;
        // No scene headings but long text
        if (sc === 0 && wc > 10000) score += 0.4;
        // Contains timestamp patterns (checked via ingestion_log or format)
        if ((script.ingestion_source || '').toLowerCase().includes('transcript')) score += 0.3;
        return { isTranscript: score >= 0.5, confidence: Math.min(score, 1) };
      }

      // ─── Fix page count distortion + detect truncation + normalize ───
      const truncationThresholds: Record<string, number> = {
        "film": 12000, "feature": 12000, "short-film": 3000,
        "tv-series": 7000, "tv-pilot": 7000, "documentary": 5000,
      };

      // LENGTH CLAMP constants for features
      const LENGTH_CLAMP: Record<string, { minMax: number; medianMax: number; p75Max: number }> = {
        'film': { minMax: 110, medianMax: 115, p75Max: 130 },
        'feature': { minMax: 110, medianMax: 115, p75Max: 130 },
        'tv-pilot': { minMax: 55, medianMax: 60, p75Max: 70 },
        'tv-series': { minMax: 55, medianMax: 60, p75Max: 70 },
        'tv_30': { minMax: 35, medianMax: 38, p75Max: 42 },
        'documentary': { minMax: 60, medianMax: 70, p75Max: 85 },
      };

      let transcriptExcluded = 0;
      let manualExcluded = 0;

      for (const s of allCompleted) {
        // Normalize word count (use chunks text if available, else estimate from raw word_count)
        // For aggregate we use the stored word_count and apply noise ratio heuristic
        const rawWc = s.word_count || 0;
        // Estimate ~8% noise for IMSDB sources, ~3% for PDF/FDX
        const noiseRatio = (s.ingestion_source || '').toLowerCase().includes('imsdb') ? 0.92 : 0.97;
        const cleanWc = Math.round(rawWc * noiseRatio);
        s._clean_word_count = cleanWc;
        s._raw_page_est = rawWc > 0 ? Math.ceil(rawWc / 250) : s.page_count || 0;
        s._normalized_page_est = cleanWc > 0 ? Math.ceil(cleanWc / 250) : s.page_count || 0;

        // Use normalized page est for aggregation
        s.page_count = s._normalized_page_est || s.page_count || 0;

        // Recalculate runtime
        if (s.page_count && (!s.runtime_est || s.runtime_est < s.page_count * 0.7)) {
          s.runtime_est = s.page_count;
        }

        // Mark truncation
        const minWords = truncationThresholds[s.production_type || "film"] || 12000;
        s._is_truncated = rawWc < minWords;

        // Detect transcripts
        const td = detectTranscript(s);
        s._is_transcript = td.isTranscript;
        s._transcript_confidence = td.confidence;
        if (td.isTranscript) transcriptExcluded++;

        // Manual exclusion
        if (s.exclude_from_baselines) manualExcluded++;

        // Persist normalization fields
        db.from("corpus_scripts").update({
          clean_word_count: s._clean_word_count,
          raw_page_est: s._raw_page_est,
          normalized_page_est: s._normalized_page_est,
          is_transcript: s._is_transcript,
          transcript_confidence: s._transcript_confidence,
        }).eq("id", s.id).then(() => {});
      }

      // Filter: only eligible scripts for baselines
      const completed = allCompleted.filter((s: any) =>
        !s._is_truncated && !s._is_transcript && !s.exclude_from_baselines
      );
      const truncatedCount = allCompleted.filter((s: any) => s._is_truncated).length;

      // If filtering leaves too few scripts, fall back to non-truncated only
      const useAll = completed.length < 3;
      const effectiveCompleted = useAll ? allCompleted.filter((s: any) => !s._is_truncated) : completed;
      // If still too few, use all
      const finalCompleted = effectiveCompleted.length < 3 ? allCompleted : effectiveCompleted;

      // Clear existing insights for this user
      await db.from("corpus_insights").delete()
        .eq("user_id", user.id)
        .in("insight_type", ["calibration", "baseline_profile", "style_profile", "lane_norm", "gold_baseline"]);

      const insights: any[] = [];

      // ─── 1) CALIBRATION by production_type (backward compat) ───
      const ptGroups: Record<string, any[]> = {};
      for (const s of finalCompleted) {
        const key = s.production_type || "film";
        if (!ptGroups[key]) ptGroups[key] = [];
        ptGroups[key].push(s);
      }

      for (const [prodType, scripts] of Object.entries(ptGroups)) {
        const pattern = buildBaselinePattern(scripts);
        pattern.truncated_excluded_count = truncatedCount;
        pattern.transcript_excluded_count = transcriptExcluded;
        pattern.manual_excluded_count = manualExcluded;
        pattern.used_fallback = useAll;
        // Apply length clamps
        const clamp = LENGTH_CLAMP[prodType] || LENGTH_CLAMP['film'];
        if (clamp) {
          pattern.median_page_count_raw = pattern.median_page_count;
          pattern.median_page_count = Math.min(pattern.median_page_count, clamp.medianMax);
          pattern.p25_page_count = Math.min(pattern.p25_page_count, clamp.minMax);
          pattern.p75_page_count = Math.min(pattern.p75_page_count, clamp.p75Max);
        }
        insights.push({
          user_id: user.id,
          insight_type: "calibration",
          production_type: prodType,
          lane: null,
          pattern,
          weight: scripts.length,
        });
      }

      // ─── 2) BASELINE_PROFILE by production_type + genre ───
      const genreGroups: Record<string, any[]> = {};
      for (const s of finalCompleted) {
        const pt = s.production_type || "film";
        const genre = (s.genre || "unknown").toLowerCase();
        const key = `${pt}::${genre}`;
        if (!genreGroups[key]) genreGroups[key] = [];
        genreGroups[key].push(s);
      }

      for (const [key, scripts] of Object.entries(genreGroups)) {
        if (scripts.length < 2) continue;
        const [prodType, genre] = key.split("::");
        const pattern = buildBaselinePattern(scripts);
        insights.push({
          user_id: user.id,
          insight_type: "baseline_profile",
          production_type: prodType,
          lane: genre,
          pattern: { ...pattern, genre },
          weight: scripts.length,
        });
      }

      // ─── 3) STYLE_PROFILE by production_type ───
      for (const [prodType, scripts] of Object.entries(ptGroups)) {
        const dialogueNums = scripts.map(s => s.avg_dialogue_ratio).filter(Boolean) as number[];
        const sceneLenNums = scripts.map(s => s.avg_scene_length).filter(Boolean) as number[];
        const sceneNums = scripts.map(s => s.scene_count).filter(Boolean) as number[];
        const pageNums = scripts.map(s => s.page_count).filter(Boolean) as number[];

        const medDialogue = median(dialogueNums);
        const medSceneLen = median(sceneLenNums);
        const pacingDensity = sceneNums.length && pageNums.length ? median(sceneNums) / median(pageNums) : 0;

        // Classify into style archetypes
        const styles: any[] = [];
        // "Lean & fast"
        styles.push({
          name: "Lean & Fast",
          description: "Short scenes, high pacing density, action-forward",
          target_scene_length: percentile(sceneLenNums, 25),
          target_dialogue_ratio: percentile(dialogueNums, 25),
          target_pacing_density: percentile(sceneNums.length ? sceneNums.map((sc, i) => pageNums[i] ? sc / pageNums[i] : 0).filter(Boolean) : [0], 75),
        });
        // "Character-forward"
        styles.push({
          name: "Character-Forward",
          description: "Longer scenes, higher dialogue ratio, character-driven",
          target_scene_length: percentile(sceneLenNums, 75),
          target_dialogue_ratio: percentile(dialogueNums, 75),
          target_pacing_density: percentile(sceneNums.length ? sceneNums.map((sc, i) => pageNums[i] ? sc / pageNums[i] : 0).filter(Boolean) : [0], 25),
        });
        // "Balanced"
        styles.push({
          name: "Balanced",
          description: "Median pacing and dialogue density",
          target_scene_length: medSceneLen,
          target_dialogue_ratio: medDialogue,
          target_pacing_density: pacingDensity,
        });
        // "Action-Forward"
        styles.push({
          name: "Action-Forward",
          description: "Low dialogue, high scene turnover, visual storytelling",
          target_scene_length: percentile(sceneLenNums, 30),
          target_dialogue_ratio: percentile(dialogueNums, 15),
          target_pacing_density: percentile(sceneNums.length ? sceneNums.map((sc, i) => pageNums[i] ? sc / pageNums[i] : 0).filter(Boolean) : [0], 80),
        });

        insights.push({
          user_id: user.id,
          insight_type: "style_profile",
          production_type: prodType,
          lane: null,
          pattern: { styles },
          weight: scripts.length,
        });
      }

      // ─── 4) LANE_NORM: approximate lane classification ───
      // Use budget tier + quality to approximate lanes
      const laneMapping: Record<string, (s: any) => boolean> = {
        "prestige": (s) => (s.quality_score_est || 0) >= 75 && ["high", "mega"].includes(s.budget_tier_est || ""),
        "indie": (s) => ["micro", "low"].includes(s.budget_tier_est || ""),
        "genre_market": (s) => ["action", "horror", "thriller", "sci-fi", "comedy"].includes((s.genre || "").toLowerCase()),
        "streamer": (s) => (s.production_type || "").includes("tv") || (s.production_type || "").includes("series"),
      };

      for (const [lane, filter] of Object.entries(laneMapping)) {
        const laneScripts = finalCompleted.filter(filter);
        if (laneScripts.length < 2) continue;
        const pattern = buildBaselinePattern(laneScripts);
        insights.push({
          user_id: user.id,
          insight_type: "lane_norm",
          production_type: null,
          lane,
          pattern: { ...pattern, lane_name: lane },
          weight: laneScripts.length,
        });
      }

      // ─── 5) GOLD BASELINE: separate profile from gold-flagged scripts ───
      // For gold, also exclude truncated
      const goldScripts = finalCompleted.filter((s: any) => s.gold_flag);
      if (goldScripts.length >= 1) {
        // Overall gold baseline
        const goldPattern = buildBaselinePattern(goldScripts);
        insights.push({
          user_id: user.id,
          insight_type: "gold_baseline",
          production_type: "all",
          lane: null,
          pattern: { ...goldPattern, is_gold: true },
          weight: goldScripts.length,
        });

        // Gold baselines by production_type + genre
        const goldByType: Record<string, any[]> = {};
        for (const s of goldScripts) {
          const key = `${s.production_type || 'film'}::${(s.genre || 'unknown').toLowerCase()}`;
          if (!goldByType[key]) goldByType[key] = [];
          goldByType[key].push(s);
        }
        for (const [key, scripts] of Object.entries(goldByType)) {
          const [gProdType, gGenre] = key.split("::");
          const gPattern = buildBaselinePattern(scripts);
          insights.push({
            user_id: user.id,
            insight_type: "gold_baseline",
            production_type: gProdType,
            lane: gGenre,
            pattern: { ...gPattern, genre: gGenre, is_gold: true },
            weight: scripts.length,
          });
        }
      }

      if (insights.length > 0) {
        await db.from("corpus_insights").insert(insights);
      }

      // Count by type
      const counts: Record<string, number> = {};
      for (const i of insights) {
        counts[i.insight_type] = (counts[i.insight_type] || 0) + 1;
      }

      return new Response(JSON.stringify({
        success: true,
        groups: Object.keys(ptGroups).length,
        total: allCompleted.length,
        used_for_baselines: finalCompleted.length,
        truncated_excluded: truncatedCount,
        transcript_excluded: transcriptExcluded,
        manual_excluded: manualExcluded,
        used_fallback: useAll,
        insights_generated: counts,
        gold_count: goldScripts.length,
        length_clamps_applied: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ ACTION: GENERATE-PLAYBOOKS ═══
    if (action === "generate-playbooks") {
      const { data: topScripts } = await db
        .from("corpus_scripts")
        .select("*")
        .eq("user_id", user.id)
        .eq("analysis_status", "complete")
        .gte("quality_score_est", 70)
        .order("quality_score_est", { ascending: false })
        .limit(20);

      if (!topScripts?.length) throw new Error("No high-quality scripts analyzed yet");

      // Fetch baselines to inform playbook triggers
      const { data: baselines } = await db
        .from("corpus_insights")
        .select("pattern, production_type")
        .eq("user_id", user.id)
        .eq("insight_type", "calibration");

      const baselineContext = baselines?.length
        ? `\n\nCORPUS BASELINES:\n${baselines.map((b: any) => `${b.production_type}: pages=${b.pattern?.median_page_count}, scenes=${b.pattern?.median_scene_count}, dialogue=${Math.round((b.pattern?.median_dialogue_ratio || 0) * 100)}%, cast=${b.pattern?.median_cast_size}, locations=${b.pattern?.median_location_count}`).join('\n')}`
        : '';

      const scriptSummaries = topScripts.map(s =>
        `"${s.title}" (${s.production_type}, ${s.genre}) — pages: ${s.page_count}, scenes: ${s.scene_count}, dialogue: ${Math.round((s.avg_dialogue_ratio || 0) * 100)}%, midpoint: ${s.midpoint_position}, quality: ${s.quality_score_est}`
      ).join("\n");

      const systemPrompt = "You are a screenplay development strategist. Extract rewrite playbooks from patterns in successful scripts. Each playbook should include specific DEVIATION TRIGGERS — conditions under which the playbook should automatically activate.";
      const userPrompt = `From these top-scoring scripts and corpus baselines, extract 8-12 rewrite playbooks:
${baselineContext}

TOP SCRIPTS:
${scriptSummaries}

Each playbook should have:
- name: short descriptive name
- description: what it fixes
- operations: array of specific rewrite steps
- applicable_production_types: which formats it applies to
- priority: 1-3 (1=critical)
- trigger_conditions: array of deviation conditions that trigger this playbook, e.g. ["hook_page > baseline_range", "dialogue_ratio > p75", "scene_count < p25"]
- target_scores: which quality scores this improves (structural, dialogue, economy, budget, lane_alignment)`;

      const tools = [{
        type: "function",
        function: {
          name: "store_playbooks",
          description: "Store extracted rewrite playbooks",
          parameters: {
            type: "object",
            properties: {
              playbooks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    operations: { type: "array", items: { type: "string" } },
                    applicable_production_types: { type: "array", items: { type: "string" } },
                    priority: { type: "integer" },
                    trigger_conditions: { type: "array", items: { type: "string" } },
                    target_scores: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "description", "operations"],
                },
              },
            },
            required: ["playbooks"],
          },
        },
      }];

      const result = await callAIWithTools(lovableKey, systemPrompt, userPrompt, tools, {
        type: "function", function: { name: "store_playbooks" },
      });

      await db.from("corpus_insights").delete().eq("user_id", user.id).eq("insight_type", "playbook");

      if (result.playbooks?.length) {
        const rows = result.playbooks.map((pb: any) => ({
          user_id: user.id,
          insight_type: "playbook",
          production_type: (pb.applicable_production_types || []).join(","),
          lane: null,
          pattern: pb,
          weight: pb.priority || 2,
        }));
        await db.from("corpus_insights").insert(rows);
      }

      return new Response(JSON.stringify({ success: true, playbooks: result.playbooks?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ ACTION: TOGGLE-GOLD ═══
    if (action === "toggle-gold") {
      const { script_id, gold } = params;
      if (!script_id) throw new Error("script_id required");
      await db.from("corpus_scripts").update({ gold_flag: !!gold }).eq("id", script_id).eq("user_id", user.id);
      return new Response(JSON.stringify({ success: true, gold_flag: !!gold }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("analyze-corpus error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
