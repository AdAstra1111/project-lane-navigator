import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * comps-style-fingerprint — Compute writing style metrics from uploaded/referenced scripts.
 * Stores ONLY derived metrics + provenance (never full text) in project_lane_prefs.
 */

// ── Metric computation (runs server-side) ────────────────────────────

const SLUGLINE_RE = /^\s*(?:\d+\s+)?(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;
const CHARACTER_CUE_RE = /^\s{10,}[A-Z][A-Z\s.''`\-]{1,40}(?:\s*\(.*\))?\s*$/;

interface StyleMetrics {
  sentence_len_avg: number;
  sentence_len_p50: number;
  sentence_len_p90: number;
  dialogue_ratio: number;
  avg_dialogue_line_len: number;
  slugline_density: number;
  word_count: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeMetrics(text: string): StyleMetrics {
  const lines = text.split("\n");
  const totalLines = lines.length || 1;

  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 2);
  const sentenceLens = sentences.map(s => s.trim().split(/\s+/).length).sort((a, b) => a - b);
  const sentAvg = sentenceLens.length > 0
    ? sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length : 0;

  let dialogueLines = 0;
  const dialogueLineLens: number[] = [];
  let inDialogue = false;

  for (const line of lines) {
    if (CHARACTER_CUE_RE.test(line)) { inDialogue = true; continue; }
    if (inDialogue) {
      const trimmed = line.trim();
      if (trimmed === "" || SLUGLINE_RE.test(line)) { inDialogue = false; }
      else if (!trimmed.startsWith("(")) {
        dialogueLines++;
        dialogueLineLens.push(trimmed.split(/\s+/).length);
      }
    }
  }

  const sluglineCount = lines.filter(l => SLUGLINE_RE.test(l)).length;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    sentence_len_avg: Math.round(sentAvg * 10) / 10,
    sentence_len_p50: percentile(sentenceLens, 50),
    sentence_len_p90: percentile(sentenceLens, 90),
    dialogue_ratio: Math.round((dialogueLines / totalLines) * 1000) / 1000,
    avg_dialogue_line_len: dialogueLineLens.length > 0
      ? Math.round((dialogueLineLens.reduce((a, b) => a + b, 0) / dialogueLineLens.length) * 10) / 10 : 0,
    slugline_density: Math.round((sluglineCount / totalLines) * 100 * 100) / 100,
    word_count: wordCount,
  };
}

function generateRules(targets: Record<string, { min: number; max: number }>): { do: string[]; dont: string[] } {
  const doRules: string[] = [];
  const dontRules: string[] = [];

  if (targets.dialogue_ratio?.max > 0.35) {
    doRules.push("Keep dialogue-heavy scenes; aim for 35%+ dialogue content");
  } else if (targets.dialogue_ratio?.max < 0.2) {
    doRules.push("Favor action/description over dialogue; keep dialogue under 20%");
  }

  if (targets.sentence_len_avg?.max < 12) {
    doRules.push("Use short, punchy sentences (avg under 12 words)");
    dontRules.push("Avoid long compound sentences over 20 words");
  } else if (targets.sentence_len_avg?.min > 15) {
    doRules.push("Use flowing, literary sentences (avg 15+ words)");
    dontRules.push("Avoid choppy one-word fragments as style");
  }

  if (targets.avg_dialogue_line_len?.max < 8) {
    doRules.push("Keep dialogue lines sharp and brief (under 8 words avg)");
    dontRules.push("Avoid monologue-length dialogue lines");
  } else if (targets.avg_dialogue_line_len?.min > 10) {
    doRules.push("Allow characters to speak in longer, more developed lines");
  }

  if (targets.slugline_density?.max > 3) {
    doRules.push("Use frequent scene transitions (high slugline density)");
    dontRules.push("Avoid scenes that run longer than 2 pages without a transition");
  } else if (targets.slugline_density?.max < 1.5) {
    doRules.push("Use extended scenes with fewer transitions");
  }

  while (doRules.length < 3) doRules.push("Match the tonal register of the reference scripts");
  while (dontRules.length < 3) dontRules.push("Avoid deviating from the established pacing pattern");

  return { do: doRules.slice(0, 5), dont: dontRules.slice(0, 5) };
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { project_id, lane, user_id, source_ids } = await req.json();
    if (!project_id || !lane || !user_id) {
      return new Response(JSON.stringify({ error: "project_id, lane, user_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load script sources
    const { data: sources, error: srcErr } = await supa
      .from("comparable_script_sources")
      .select("id, comp_title, source_type, storage_path, project_doc_id")
      .eq("project_id", project_id)
      .eq("lane", lane);

    if (srcErr) throw srcErr;

    const filteredSources = source_ids?.length
      ? (sources || []).filter((s: any) => source_ids.includes(s.id))
      : sources || [];

    if (filteredSources.length === 0) {
      return new Response(JSON.stringify({ error: "No script sources found for this project/lane" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load text for each source
    const metricsArr: StyleMetrics[] = [];
    const provenanceArr: Array<{ comp_title: string; source_id: string; char_count: number }> = [];

    for (const src of filteredSources) {
      let text = "";

      if (src.source_type === "project_doc" && src.project_doc_id) {
        // Load from project_documents
        const { data: doc } = await supa
          .from("project_documents")
          .select("extracted_text, plaintext")
          .eq("id", src.project_doc_id)
          .maybeSingle();
        text = doc?.extracted_text || doc?.plaintext || "";
      } else if (src.source_type === "upload" && src.storage_path) {
        // Download from storage
        const { data: fileData, error: dlErr } = await supa.storage
          .from("comp-scripts")
          .download(src.storage_path);
        if (!dlErr && fileData) {
          text = await fileData.text();
        }
      }

      if (text.length < 100) {
        console.warn(`[comps-style-fingerprint] Skipping source ${src.id}: only ${text.length} chars`);
        continue;
      }

      // Truncate to avoid memory issues (200k chars max)
      if (text.length > 200000) text = text.slice(0, 200000);

      const metrics = computeMetrics(text);
      metricsArr.push(metrics);
      provenanceArr.push({ comp_title: src.comp_title, source_id: src.id, char_count: text.length });
    }

    if (metricsArr.length === 0) {
      return new Response(JSON.stringify({ error: "No usable text found in script sources" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Build bands (min/max across all sources)
    const band = (key: keyof StyleMetrics) => {
      const vals = metricsArr.map(m => m[key]);
      return { min: Math.round(Math.min(...vals) * 100) / 100, max: Math.round(Math.max(...vals) * 100) / 100 };
    };

    const targets = {
      sentence_len_avg: band("sentence_len_avg"),
      sentence_len_p50: band("sentence_len_p50"),
      sentence_len_p90: band("sentence_len_p90"),
      dialogue_ratio: band("dialogue_ratio"),
      avg_dialogue_line_len: band("avg_dialogue_line_len"),
      slugline_density: band("slugline_density"),
    };

    const rules = generateRules(targets);

    const fingerprint = {
      source: "comp_scripts",
      sources: provenanceArr,
      targets,
      rules,
      metrics_detail: metricsArr,
      updated_at: new Date().toISOString(),
    };

    // 4. Merge-save into project_lane_prefs
    const { data: existingPrefs } = await supa
      .from("project_lane_prefs")
      .select("prefs")
      .eq("project_id", project_id)
      .eq("lane", lane)
      .maybeSingle();

    const merged = { ...(existingPrefs?.prefs || {}), style_fingerprint: fingerprint };

    await supa.from("project_lane_prefs").upsert(
      { project_id, lane, prefs: merged, updated_by: user_id, updated_at: new Date().toISOString() },
      { onConflict: "project_id,lane" },
    );

    return new Response(JSON.stringify({ fingerprint, sources_processed: provenanceArr.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[comps-style-fingerprint] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
