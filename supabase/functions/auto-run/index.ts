import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Document Ladders ──────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH: supabase/_shared/stage-ladders.json
// Loaded at runtime via import.meta.url so the edge function always reads the
// exact same file that the frontend registry.ts imports. No duplication needed.

const _jsonUrl = new URL("../_shared/stage-ladders.json", import.meta.url);
const _laddersJson = await (await fetch(_jsonUrl)).json();

const FORMAT_LADDERS: Record<string, string[]> = _laddersJson.FORMAT_LADDERS;
const DOC_TYPE_ALIASES: Record<string, string> = _laddersJson.DOC_TYPE_ALIASES;

/**
 * Sanitize a doc_type before persisting — maps legacy aliases to canonical stages.
 * "draft" → "script", "coverage" → "production_draft", etc.
 */
function canonicalDocType(raw: string): string {
  const key = (raw || "").toLowerCase().replace(/[-\s]+/g, "_");
  return DOC_TYPE_ALIASES[key] || key;
}


type DocStage = string;

function getLadderForJob(format: string): string[] {
  const key = (format || "film").toLowerCase().replace(/[_ ]+/g, "-");
  return FORMAT_LADDERS[key] ?? FORMAT_LADDERS["film"];
}

// Flat unique set of all stages (for validation)
const ALL_STAGES = new Set<string>(Object.values(FORMAT_LADDERS).flat());

function nextDoc(current: string, format: string): string | null {
  const ladder = getLadderForJob(format);
  const idx = ladder.indexOf(current);
  return idx >= 0 && idx < ladder.length - 1 ? ladder[idx + 1] : null;
}

// ── Seed Pack doc types ──
const SEED_DOC_TYPES = ["project_overview", "creative_brief", "market_positioning", "canon", "nec"];

/**
 * Ensure seed pack documents exist for a project.
 * If any are missing, calls generate-seed-pack to create them.
 * Idempotent: seed pack deduplicates by (project_id, doc_type).
 */
async function ensureSeedPack(
  supabase: any,
  supabaseUrl: string,
  projectId: string,
  token: string,
): Promise<{ ensured: boolean; missing: string[] }> {
  const { data: existingDocs } = await supabase
    .from("project_documents")
    .select("doc_type")
    .eq("project_id", projectId)
    .in("doc_type", SEED_DOC_TYPES);

  const existingSet = new Set((existingDocs || []).map((d: any) => d.doc_type));
  const missing = SEED_DOC_TYPES.filter(dt => !existingSet.has(dt));

  if (missing.length === 0) {
    console.log(`[auto-run] SEED_PACK ensured=false missing=`);
    return { ensured: false, missing: [] };
  }

  // Derive pitch from idea doc or project title
  const { data: project } = await supabase
    .from("projects")
    .select("title, format, assigned_lane")
    .eq("id", projectId)
    .single();

  let pitch = project?.title || "Untitled project";
  const { data: ideaDocs } = await supabase
    .from("project_documents")
    .select("id, extracted_text, plaintext")
    .eq("project_id", projectId)
    .eq("doc_type", "idea")
    .order("created_at", { ascending: false })
    .limit(1);

  if (ideaDocs?.[0]) {
    const ideaText = ideaDocs[0].extracted_text || ideaDocs[0].plaintext || "";
    if (ideaText.length > 10) pitch = ideaText.slice(0, 2000);
  }

  const lane = project?.assigned_lane || "independent-film";

  console.log(`[auto-run] SEED_PACK ensured=true missing=${missing.join(",")}`);

  try {
    await fetch(`${supabaseUrl}/functions/v1/generate-seed-pack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId, pitch, lane }),
    });
  } catch (e: any) {
    console.error("[auto-run] SEED_PACK generation failed (non-fatal):", e.message);
  }

  return { ensured: true, missing };
}

/**
 * Find the next unsatisfied stage on the ladder between startIdx and targetIdx.
 * A stage is "satisfied" if a doc of that type exists. For script stages
 * (feature_script, episode_script) an approved version is also required.
 */
async function nextUnsatisfiedStage(
  supabase: any,
  projectId: string,
  format: string,
  currentStage: string,
  targetStage: string,
): Promise<string | null> {
  const ladder = getLadderForJob(format);
  const currentIdx = ladder.indexOf(currentStage);
  const targetIdx = ladder.indexOf(targetStage);
  if (currentIdx < 0 || targetIdx < 0) return nextDoc(currentStage, format);

  // Fetch all project docs and their approval status in one pass
  const { data: allDocs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId);

  const docsByType = new Map<string, string[]>();
  for (const d of (allDocs || [])) {
    if (!docsByType.has(d.doc_type)) docsByType.set(d.doc_type, []);
    docsByType.get(d.doc_type)!.push(d.id);
  }

  // Stages that require an approved version to be considered satisfied
  const APPROVAL_REQUIRED_STAGES = new Set([
    "feature_script", "episode_script", "production_draft",
    "season_master_script",
  ]);

  // Collect doc IDs for approval-required stages that have docs
  const approvalCheckIds: string[] = [];
  for (const stage of APPROVAL_REQUIRED_STAGES) {
    const ids = docsByType.get(stage);
    if (ids) approvalCheckIds.push(...ids);
  }

  // Batch-fetch approved status
  const approvedDocIds = new Set<string>();
  if (approvalCheckIds.length > 0) {
    const { data: approvedVersions } = await supabase
      .from("project_document_versions")
      .select("document_id")
      .in("document_id", approvalCheckIds)
      .eq("approval_status", "approved");
    for (const v of (approvedVersions || [])) {
      approvedDocIds.add(v.document_id);
    }
  }

  // Walk ladder from current+1 to target, find first unsatisfied
  for (let i = currentIdx + 1; i <= targetIdx; i++) {
    const stage = ladder[i];
    const docIds = docsByType.get(stage);
    if (!docIds || docIds.length === 0) return stage; // no doc at all
    if (APPROVAL_REQUIRED_STAGES.has(stage)) {
      // Need at least one approved version
      const hasApproved = docIds.some(id => approvedDocIds.has(id));
      if (!hasApproved) return stage;
    }
    // Otherwise doc exists → satisfied, continue
  }

  return null; // all stages satisfied
}

function isOnLadder(d: string, format?: string): boolean {
  if (format) return getLadderForJob(format).includes(d);
  return ALL_STAGES.has(d);
}

function ladderIndexOf(d: string, format: string): number {
  return getLadderForJob(format).indexOf(d);
}

// ── Mode Config ──
const MODE_CONFIG: Record<string, { max_stage_loops: number; max_total_steps: number; require_readiness?: number }> = {
  fast: { max_stage_loops: 1, max_total_steps: 8 },
  balanced: { max_stage_loops: 2, max_total_steps: 12 },
  premium: { max_stage_loops: 3, max_total_steps: 18, require_readiness: 82 },
};

// ── Format Normalization (canonical) ──

function normalizeFormat(format: string): string {
  return (format || "film").toLowerCase().replace(/[_ ]+/g, "-");
}

// ── Qualification Resolver ──

interface QualificationDefaults {
  episode_target_duration_seconds?: number;
  episode_target_duration_min_seconds?: number;
  episode_target_duration_max_seconds?: number;
  season_episode_count?: number;
  target_runtime_min_low?: number;
  target_runtime_min_high?: number;
}

const FORMAT_DEFAULTS: Record<string, QualificationDefaults> = {
  "vertical-drama": { episode_target_duration_min_seconds: 45, episode_target_duration_max_seconds: 90, episode_target_duration_seconds: 60, season_episode_count: 30 },
  "limited-series": { episode_target_duration_min_seconds: 2700, episode_target_duration_max_seconds: 3600, episode_target_duration_seconds: 3300, season_episode_count: 8 },
  "tv-series": { episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3300, episode_target_duration_seconds: 2700, season_episode_count: 10 },
  "anim-series": { episode_target_duration_min_seconds: 1200, episode_target_duration_max_seconds: 1500, episode_target_duration_seconds: 1320, season_episode_count: 10 },
  "documentary-series": { episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3300, episode_target_duration_seconds: 2700, season_episode_count: 6 },
  "digital-series": { episode_target_duration_min_seconds: 480, episode_target_duration_max_seconds: 720, episode_target_duration_seconds: 600, season_episode_count: 10 },
  "reality": { episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3300, episode_target_duration_seconds: 2700, season_episode_count: 10 },
  "film": { target_runtime_min_low: 85, target_runtime_min_high: 110 },
  "anim-feature": { target_runtime_min_low: 80, target_runtime_min_high: 100 },
  "short-film": { target_runtime_min_low: 5, target_runtime_min_high: 20 },
};

const SERIES_FORMATS = ["vertical-drama", "tv-series", "limited-series", "anim-series", "documentary-series", "digital-series", "reality"];

// Stages where episode qualifications become required (indexes in the film ladder for reference only)
const SERIES_STAGE_THRESHOLD = FORMAT_LADDERS["film"].indexOf("concept_brief"); // concept_brief+
const FILM_STAGE_THRESHOLD = FORMAT_LADDERS["film"].indexOf("script"); // script+

function needsEpisodeQuals(format: string, _stageIdx: number): boolean {
  return SERIES_FORMATS.includes(normalizeFormat(format));
}

// ── resolveSeriesQualifications — single canonical resolver ──

interface ResolvedQualifications {
  episode_target_duration_seconds: number | null;
  episode_target_duration_min_seconds: number | null;
  episode_target_duration_max_seconds: number | null;
  season_episode_count: number | null;
  source: {
    duration: "project_column" | "guardrails" | "defaults" | null;
    count: "project_column" | "guardrails" | "defaults" | null;
  };
}

async function resolveSeriesQualifications(
  supabase: any,
  projectId: string,
  format: string
): Promise<ResolvedQualifications> {
  const fmt = normalizeFormat(format);
  const { data: project } = await supabase.from("projects")
    .select("episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, guardrails_config")
    .eq("id", projectId).single();
  if (!project) return { episode_target_duration_seconds: null, episode_target_duration_min_seconds: null, episode_target_duration_max_seconds: null, season_episode_count: null, source: { duration: null, count: null } };

  const gc = project.guardrails_config || {};
  const quals = gc?.overrides?.qualifications || {};
  const defaults = FORMAT_DEFAULTS[fmt] || {};

  // Duration range resolution: project columns → guardrails → defaults → legacy scalar fallback
  let durMin: number | null = null;
  let durMax: number | null = null;
  let durScalar: number | null = null;
  let durSource: "project_column" | "guardrails" | "defaults" | null = null;

  if (project.episode_target_duration_min_seconds || project.episode_target_duration_max_seconds) {
    durMin = project.episode_target_duration_min_seconds;
    durMax = project.episode_target_duration_max_seconds;
    durSource = "project_column";
  } else if (quals.episode_target_duration_min_seconds || quals.episode_target_duration_max_seconds) {
    durMin = quals.episode_target_duration_min_seconds;
    durMax = quals.episode_target_duration_max_seconds;
    durSource = "guardrails";
  } else if (defaults.episode_target_duration_min_seconds || defaults.episode_target_duration_max_seconds) {
    durMin = defaults.episode_target_duration_min_seconds ?? null;
    durMax = defaults.episode_target_duration_max_seconds ?? null;
    durSource = "defaults";
  }

  // Legacy scalar fallback
  if (durMin == null && durMax == null) {
    const scalar = project.episode_target_duration_seconds ?? quals.episode_target_duration_seconds ?? defaults.episode_target_duration_seconds ?? null;
    if (scalar) {
      durMin = scalar;
      durMax = scalar;
      durScalar = scalar;
      durSource = project.episode_target_duration_seconds ? "project_column" : quals.episode_target_duration_seconds ? "guardrails" : "defaults";
    }
  }

  // Normalize: mirror if one side missing
  if (durMin != null && durMax == null) durMax = durMin;
  if (durMax != null && durMin == null) durMin = durMax;

  durScalar = (durMin != null && durMax != null) ? Math.round((durMin + durMax) / 2) : null;

  // Count resolution: project column → guardrails → defaults
  let count: number | null = null;
  let countSource: "project_column" | "guardrails" | "defaults" | null = null;
  if (project.season_episode_count) {
    count = project.season_episode_count;
    countSource = "project_column";
  } else if (quals.season_episode_count) {
    count = quals.season_episode_count;
    countSource = "guardrails";
  } else if (defaults.season_episode_count) {
    count = defaults.season_episode_count;
    countSource = "defaults";
  }

  // Persist-on-resolve: write defaults back so engine never re-asks
  const needsPersist = (durSource === "defaults" || countSource === "defaults") && SERIES_FORMATS.includes(fmt);
  if (needsPersist) {
    const newGc = { ...gc };
    newGc.overrides = newGc.overrides || {};
    newGc.overrides.qualifications = { ...(newGc.overrides.qualifications || {}) };
    if (durSource === "defaults" && durMin != null) {
      newGc.overrides.qualifications.episode_target_duration_min_seconds = durMin;
      newGc.overrides.qualifications.episode_target_duration_max_seconds = durMax;
      newGc.overrides.qualifications.episode_target_duration_seconds = durScalar;
    }
    if (countSource === "defaults" && count != null) {
      newGc.overrides.qualifications.season_episode_count = count;
    }

    const updates: Record<string, any> = { guardrails_config: newGc };
    if (durSource === "defaults" && durMin != null) {
      updates.episode_target_duration_min_seconds = durMin;
      updates.episode_target_duration_max_seconds = durMax;
      updates.episode_target_duration_seconds = durScalar;
    }

    await supabase.from("projects").update(updates).eq("id", projectId);
  }

  return { episode_target_duration_seconds: durScalar, episode_target_duration_min_seconds: durMin, episode_target_duration_max_seconds: durMax, season_episode_count: count, source: { duration: durSource, count: countSource } };
}

function needsFilmQuals(format: string, stageIdx: number): boolean {
  const filmFormats = ["film", "anim-feature", "short-film"];
  return filmFormats.includes(format) && stageIdx >= FILM_STAGE_THRESHOLD;
}

interface PreflightResult {
  resolved: Record<string, any>;
  changed: boolean;
  missing_required: string[];
}

// ── Criteria Snapshot ──
const CRITERIA_SNAPSHOT_KEYS = [
  "format_subtype", "season_episode_count", "episode_target_duration_seconds",
  "episode_target_duration_min_seconds", "episode_target_duration_max_seconds",
  "target_runtime_min_low", "target_runtime_min_high", "assigned_lane",
  "budget_range", "development_behavior"
] as const;

interface CriteriaSnapshot {
  format_subtype?: string;
  season_episode_count?: number;
  episode_target_duration_seconds?: number;
  episode_target_duration_min_seconds?: number;
  episode_target_duration_max_seconds?: number;
  target_runtime_min_low?: number;
  target_runtime_min_high?: number;
  assigned_lane?: string;
  budget_range?: string;
  development_behavior?: string;
  updated_at?: string;
}

async function buildCriteriaSnapshot(supabase: any, projectId: string): Promise<CriteriaSnapshot> {
  const { data: p } = await supabase.from("projects")
    .select("format, assigned_lane, budget_range, development_behavior, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, guardrails_config")
    .eq("id", projectId).single();
  if (!p) return {};
  const gc = p.guardrails_config || {};
  const quals = gc?.overrides?.qualifications || {};
  const fmt = normalizeFormat(p.format);
  return {
    format_subtype: quals.format_subtype || fmt,
    season_episode_count: quals.season_episode_count || p.season_episode_count || undefined,
    episode_target_duration_seconds: quals.episode_target_duration_seconds || p.episode_target_duration_seconds || undefined,
    episode_target_duration_min_seconds: quals.episode_target_duration_min_seconds || p.episode_target_duration_min_seconds || undefined,
    episode_target_duration_max_seconds: quals.episode_target_duration_max_seconds || p.episode_target_duration_max_seconds || undefined,
    target_runtime_min_low: quals.target_runtime_min_low || undefined,
    target_runtime_min_high: quals.target_runtime_min_high || undefined,
    assigned_lane: p.assigned_lane || quals.assigned_lane || undefined,
    budget_range: p.budget_range || quals.budget_range || undefined,
    development_behavior: p.development_behavior || undefined,
    updated_at: new Date().toISOString(),
  };
}

function compareSnapshots(a: CriteriaSnapshot | null, b: CriteriaSnapshot | null): string[] {
  if (!a || !b) return [];
  const diffs: string[] = [];
  for (const key of CRITERIA_SNAPSHOT_KEYS) {
    const va = a[key as keyof CriteriaSnapshot];
    const vb = b[key as keyof CriteriaSnapshot];
    if (va != null && vb != null && String(va) !== String(vb)) {
      diffs.push(key);
    }
  }
  return diffs;
}

async function runPreflight(
  supabase: any, projectId: string, format: string, currentDoc: DocStage, allowDefaults = true
): Promise<PreflightResult> {
  const { data: project } = await supabase.from("projects")
    .select("episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, assigned_lane, budget_range, guardrails_config")
    .eq("id", projectId).single();

  if (!project) return { resolved: {}, changed: false, missing_required: [] };

  const stageIdx = ladderIndexOf(currentDoc, format);
  const defaults = FORMAT_DEFAULTS[format] || {};
  const updates: Record<string, any> = {};
  const resolved: Record<string, any> = {};
  const missing_required: string[] = [];

  // ── PRECEDENCE: 1) derived_from_idea criteria, 2) overrides.qualifications, 3) project columns, 4) FORMAT_DEFAULTS ──
  const gc = project.guardrails_config || {};
  const ideaCriteria = gc.derived_from_idea?.criteria || {};
  const overrideQuals = gc.overrides?.qualifications || {};

  // Helper: resolve a value with precedence
  function resolveValue(field: string, projectCol?: any): any {
    return ideaCriteria[field] ?? overrideQuals[field] ?? projectCol ?? null;
  }

  // Episode qualifications for series formats (range-aware)
  if (needsEpisodeQuals(format, stageIdx)) {
    const epDurMin = resolveValue("episode_target_duration_min_seconds", project.episode_target_duration_min_seconds);
    const epDurMax = resolveValue("episode_target_duration_max_seconds", project.episode_target_duration_max_seconds);
    const epDurScalar = resolveValue("episode_target_duration_seconds", project.episode_target_duration_seconds);

    if (!epDurMin && !epDurMax && !epDurScalar) {
      if (allowDefaults && (defaults.episode_target_duration_min_seconds || defaults.episode_target_duration_seconds)) {
        const defMin = defaults.episode_target_duration_min_seconds ?? defaults.episode_target_duration_seconds!;
        const defMax = defaults.episode_target_duration_max_seconds ?? defaults.episode_target_duration_seconds!;
        const defMid = Math.round((defMin + defMax) / 2);
        updates.episode_target_duration_min_seconds = defMin;
        updates.episode_target_duration_max_seconds = defMax;
        updates.episode_target_duration_seconds = defMid;
        resolved.episode_target_duration_min_seconds = defMin;
        resolved.episode_target_duration_max_seconds = defMax;
        resolved.episode_target_duration_seconds = defMid;
      } else {
        missing_required.push("episode_target_duration_min_seconds");
      }
    }

    const epCount = resolveValue("season_episode_count", project.season_episode_count);
    if (!epCount) {
      if (allowDefaults && defaults.season_episode_count) {
        const newGc = updates.guardrails_config || { ...gc };
        newGc.overrides = newGc.overrides || {};
        newGc.overrides.qualifications = { ...(newGc.overrides.qualifications || {}), season_episode_count: defaults.season_episode_count };
        updates.guardrails_config = newGc;
        resolved.season_episode_count = defaults.season_episode_count;
      } else {
        missing_required.push("season_episode_count");
      }
    }
  }

  // Film qualifications
  if (needsFilmQuals(format, stageIdx)) {
    const rtLow = resolveValue("target_runtime_min_low");
    if (!rtLow) {
      if (allowDefaults && defaults.target_runtime_min_low) {
        const newGc = updates.guardrails_config || { ...gc };
        newGc.overrides = newGc.overrides || {};
        newGc.overrides.qualifications = {
          ...(newGc.overrides.qualifications || {}),
          target_runtime_min_low: defaults.target_runtime_min_low,
          target_runtime_min_high: defaults.target_runtime_min_high,
        };
        updates.guardrails_config = newGc;
        resolved.target_runtime_min_low = defaults.target_runtime_min_low;
        resolved.target_runtime_min_high = defaults.target_runtime_min_high;
      } else {
        missing_required.push("target_runtime_min_low");
      }
    }
  }

  // Lane fallback
  const lane = resolveValue("assigned_lane", project.assigned_lane);
  if (!lane) {
    if (allowDefaults) {
      updates.assigned_lane = "independent-film";
      resolved.assigned_lane = "independent-film";
    } else {
      missing_required.push("assigned_lane");
    }
  }

  // Budget fallback
  const budget = resolveValue("budget_range", project.budget_range);
  if (!budget) {
    if (allowDefaults) {
      updates.budget_range = "low";
      resolved.budget_range = "low";
    } else {
      missing_required.push("budget_range");
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from("projects").update(updates).eq("id", projectId);
    return { resolved, changed: true, missing_required };
  }

  return { resolved, changed: false, missing_required };
}

// Patterns that indicate a missing qualification error
const QUAL_ERROR_PATTERNS = [
  "missing qualification", "episode_target_duration", "episode_target_duration_seconds",
  "episodetargetdurationseconds", "season_episode_count", "seasonepisodecount",
  "required", "episode duration", "episode count", "target_runtime",
  "missing episode duration", "missing episode count",
];

function isQualificationError(msg: string): boolean {
  const lower = msg.toLowerCase().replace(/[\s_-]/g, "");
  return QUAL_ERROR_PATTERNS.some(p => lower.includes(p.replace(/[\s_-]/g, "")));
}

// ── Promotion Intel (inline) ──
const WEIGHTS: Record<string, { ci: number; gp: number; gap: number; traj: number; hi: number; pen: number }> = {
  idea:             { ci: 0.20, gp: 0.30, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  concept_brief:    { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  blueprint:        { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  architecture:     { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  // NOTE: "draft" was a legacy alias for "script" — renamed to canonical key
  script:           { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  production_draft: { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ── Helper: robust score extraction ──
function pickNumberRaw(obj: any, paths: string[]): number | null {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) break;
      cur = cur[p];
    }
    if (cur != null && typeof cur === "number" && isFinite(cur)) return cur;
  }
  return null;
}

function pickNumber(obj: any, paths: string[], fallback: number, riskFlags?: string[]): number {
  const v = pickNumberRaw(obj, paths);
  if (v != null) return v;
  if (riskFlags) riskFlags.push("score_missing_fallback");
  return fallback;
}

function pickArray(obj: any, paths: string[]): any[] {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) break;
      cur = cur[p];
    }
    if (Array.isArray(cur) && cur.length > 0) return cur;
  }
  return [];
}

function trajectoryScore(t: string | null): number {
  const n = (t || "").toLowerCase().replace(/[_-]/g, "");
  if (n === "converging") return 90;
  if (n === "strengthened") return 85;
  if (n === "overoptimised" || n === "overoptimized") return 60;
  if (n === "stalled") return 55;
  if (n === "eroding") return 25;
  return 55;
}

interface PromotionResult {
  recommendation: "promote" | "stabilise" | "escalate";
  readiness_score: number;
  confidence: number;
  risk_flags: string[];
  reasons: string[];
}

function computePromotion(
  ci: number, gp: number, gap: number, trajectory: string | null,
  doc: string, blockersCount: number, highImpactCount: number, iterationCount: number
): PromotionResult {
  const w = WEIGHTS[doc] || WEIGHTS.concept_brief;
  const gapScore = 100 - clamp(gap * 2, 0, 100);
  const trajScore = trajectoryScore(trajectory);
  const hiScore = 100 - clamp(highImpactCount * 10, 0, 60);
  const iterPenalty = clamp((iterationCount - 2) * 4, 0, 20);

  let readinessScore = Math.round(
    ci * w.ci + gp * w.gp + gapScore * w.gap + trajScore * w.traj + hiScore * w.hi - iterPenalty * w.pen
  );
  readinessScore = clamp(readinessScore, 0, 100);

  let conf = 70;
  if (iterationCount <= 1) conf -= 10;
  if (highImpactCount >= 5) conf -= 10;
  if (gap >= 20) conf -= 15;
  const tn = (trajectory || "").toLowerCase().replace(/[_-]/g, "");
  if (tn === "converging" || tn === "strengthened") conf += 10;
  const confidence = clamp(conf, 0, 100);

  const risk_flags: string[] = [];
  const reasons: string[] = [];

  // Hard Gates
  if (blockersCount > 0) {
    risk_flags.push("hard_gate:blockers");
    reasons.push(`Blockers active (${blockersCount})`);
    return { recommendation: "stabilise", readiness_score: readinessScore, confidence, risk_flags, reasons };
  }
  if (tn === "eroding") {
    risk_flags.push("hard_gate:eroding_trajectory");
    reasons.push("Trajectory eroding");
    return { recommendation: "escalate", readiness_score: readinessScore, confidence, risk_flags, reasons };
  }
  if ((doc === "idea" || doc === "concept_brief") && highImpactCount > 0) {
    risk_flags.push("hard_gate:early_stage_high_impact");
    reasons.push("Early-stage high-impact issues");
    return { recommendation: "stabilise", readiness_score: readinessScore, confidence, risk_flags, reasons };
  }

  let recommendation: "promote" | "stabilise" | "escalate";
  if (readinessScore >= 78) recommendation = "promote";
  else if (readinessScore >= 65) recommendation = "stabilise";
  else recommendation = "escalate";

  if (tn === "overoptimised" && blockersCount === 0 && gp >= 60 && readinessScore >= 72) {
    recommendation = "promote";
    reasons.push("Over-optimised nudge");
  }

  reasons.push(`Readiness: ${readinessScore}/100`);
  return { recommendation, readiness_score: readinessScore, confidence, risk_flags, reasons };
}

// ── Helper: call another edge function (with retry on qualification errors) ──
async function callEdgeFunction(
  supabaseUrl: string, functionName: string, body: any, token: string
): Promise<any> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${functionName} error: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function callEdgeFunctionWithRetry(
  supabase: any, supabaseUrl: string, functionName: string, body: any, token: string,
  projectId: string, format: string, currentDoc: DocStage,
  jobId: string, stepCount: number
): Promise<{ result: any; retried: boolean }> {
  try {
    const result = await callEdgeFunction(supabaseUrl, functionName, body, token);
    return { result, retried: false };
  } catch (e: any) {
    if (!isQualificationError(e.message)) throw e;

    // Attempt blockage resolve
    const preflight = await runPreflight(supabase, projectId, format, currentDoc);
    if (preflight.changed) {
      await logStep(supabase, jobId, stepCount, currentDoc, "blockage_resolve",
        `Resolved missing qualifications: ${Object.keys(preflight.resolved).join(", ")}`,
      );
    }

    // Retry once
    const result = await callEdgeFunction(supabaseUrl, functionName, body, token);
    return { result, retried: true };
  }
}

// ── Helper: log a step ──
async function logStep(
  supabase: any,
  jobId: string,
  stepIndex: number,
  document: string,
  action: string,
  summary: string,
  scores: { ci?: number; gp?: number; gap?: number; readiness?: number; confidence?: number; risk_flags?: string[] } = {},
  outputText?: string,
  outputRef?: any
) {
  await supabase.from("auto_run_steps").insert({
    job_id: jobId,
    step_index: stepIndex,
    document,
    action,
    summary,
    ci: scores.ci ?? null,
    gp: scores.gp ?? null,
    gap: scores.gap ?? null,
    readiness: scores.readiness ?? null,
    confidence: scores.confidence ?? null,
    risk_flags: scores.risk_flags || [],
    output_text: outputText ? outputText.slice(0, 4000) : null,
    output_ref: outputRef || null,
  });
}

// ── Helper: update job ──
async function updateJob(supabase: any, jobId: string, fields: Record<string, any>) {
  await supabase.from("auto_run_jobs").update(fields).eq("id", jobId);
}

// ── Helper: get job ──
async function getJob(supabase: any, jobId: string) {
  const { data } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
  return data;
}

// ── Helper: normalize pending decisions from dev-engine-v2 options output ──
interface NormalizedDecision {
  id: string;
  question: string;
  options: { value: string; why: string }[];
  recommended?: string;
  impact: "blocking" | "non_blocking";
}

function normalizePendingDecisions(rawDecisions: any[], context: string): NormalizedDecision[] {
  if (!Array.isArray(rawDecisions) || rawDecisions.length === 0) return [];
  return rawDecisions.map((d: any, i: number) => ({
    id: d.note_id || d.id || `decision_${i}`,
    question: d.note || d.question || d.description || `Decision ${i + 1}: ${context}`,
    options: Array.isArray(d.options) ? d.options.map((o: any) => ({
      value: o.option_id || o.value || o.title || `opt_${i}`,
      why: o.what_changes ? (Array.isArray(o.what_changes) ? o.what_changes.join("; ") : String(o.what_changes)) : o.why || o.title || "",
    })) : [
      { value: "accept", why: "Apply the recommended fix" },
      { value: "skip", why: "Skip this issue" },
    ],
    recommended: d.recommended_option_id || d.recommended || undefined,
    impact: d.severity === "blocker" ? "blocking" : "non_blocking",
  }));
}

// ── Helper: create fallback decisions when options generation fails or returns empty ──
function createFallbackDecisions(currentDoc: string, ci: number, gp: number, reason: string): NormalizedDecision[] {
  return [
    {
      id: "fallback_force_promote",
      question: `${reason} at ${currentDoc} (CI:${ci} GP:${gp}). How would you like to proceed?`,
      options: [
        { value: "force_promote", why: "Skip remaining issues and advance to the next stage" },
        { value: "retry", why: "Run another development cycle at the current stage" },
        { value: "stop", why: "Stop the auto-run and review manually" },
      ],
      impact: "blocking",
    },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return respond({ error: "Unauthorized" }, 401);
    const userId = user.id;

    const body = await req.json();
    const { action, projectId, jobId, mode, start_document, target_document, max_stage_loops, max_total_steps, decision } = body;

    // ═══════════════════════════════════════
    // ACTION: status
    // ═══════════════════════════════════════
    if (action === "status") {
      const query = jobId
        ? supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single()
        : supabase.from("auto_run_jobs").select("*").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(1).single();
      const { data: job, error } = await query;
      if (error || !job) return respond({ job: null, latest_steps: [], next_action_hint: "No job found" });

      const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", job.id).order("step_index", { ascending: false }).limit(10);
      return respond({ job, latest_steps: (steps || []).reverse(), next_action_hint: getHint(job) });
    }

    // ═══════════════════════════════════════
    // ACTION: start
    // ═══════════════════════════════════════
    if (action === "start") {
      if (!projectId) return respond({ error: "projectId required" }, 400);
      const { data: proj } = await supabase.from("projects").select("format").eq("id", projectId).single();
      const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");
      const startDoc = canonicalDocType(start_document || "idea");
      // Sanitize target_document — "draft" and "coverage" are legacy aliases, never real targets
      const rawTarget = target_document || "production_draft";
      const targetDoc = canonicalDocType(rawTarget);
      // Validate both are on the format's ladder
      if (!isOnLadder(startDoc, fmt)) return respond({ error: `Invalid start_document: ${startDoc} (not on ${fmt} ladder)` }, 400);
      if (!isOnLadder(targetDoc, fmt)) {
        // Graceful fallback: use last stage on the ladder
        const ladder = getLadderForJob(fmt);
        const fallbackTarget = ladder[ladder.length - 1];
        console.warn(`target_document "${targetDoc}" not on ${fmt} ladder — using "${fallbackTarget}"`);
      }

      const modeConf = MODE_CONFIG[mode || "balanced"] || MODE_CONFIG.balanced;
      const effectiveMaxLoops = max_stage_loops ?? modeConf.max_stage_loops;
      const effectiveMaxSteps = max_total_steps ?? modeConf.max_total_steps;

      // ── Preflight qualification resolver at start ──
      const preflight = await runPreflight(supabase, projectId, fmt, startDoc, true);

      // ── Ensure seed pack docs exist before downstream generation ──
      const seedResult = await ensureSeedPack(supabase, supabaseUrl, projectId, token);

      const { data: job, error } = await supabase.from("auto_run_jobs").insert({
        user_id: userId,
        project_id: projectId,
        status: "running",
        mode: mode || "balanced",
        start_document: startDoc,
        target_document: targetDoc,
        current_document: startDoc,
        max_stage_loops: effectiveMaxLoops,
        max_total_steps: effectiveMaxSteps,
      }).select("*").single();

      if (error) throw new Error(`Failed to create job: ${error.message}`);

      await logStep(supabase, job.id, 0, startDoc, "start", `Auto-run started: ${startDoc} → ${targetDoc} (${mode || "balanced"} mode)`);

      if (seedResult.ensured) {
        await logStep(supabase, job.id, 0, startDoc, "seed_pack_ensured",
          `Seed pack generated for missing docs: ${seedResult.missing.join(", ")}`,
        );
      }

      if (preflight.changed) {
        await logStep(supabase, job.id, 0, startDoc, "preflight_resolve",
          `Resolved qualifications: ${Object.keys(preflight.resolved).join(", ")} → ${JSON.stringify(preflight.resolved)}`,
        );
      }

      return respond({ job, latest_steps: [], next_action_hint: "run-next" });
    }

    // ═══════════════════════════════════════
    // ACTION: pause / stop
    // ═══════════════════════════════════════
    if (action === "pause" || action === "stop") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const newStatus = action === "pause" ? "paused" : "stopped";
      await updateJob(supabase, jobId, { status: newStatus, stop_reason: `User ${action}d` });
      const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
      return respond({ job, latest_steps: [], next_action_hint: action === "pause" ? "resume" : "none" });
    }

    // ═══════════════════════════════════════
    // ACTION: resume
    // ═══════════════════════════════════════
    if (action === "resume") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const resumeUpdates: Record<string, any> = {
        status: "running", stop_reason: null, error: null,
        awaiting_approval: false, approval_type: null, approval_payload: null,
        pending_doc_id: null, pending_version_id: null,
        pending_doc_type: null, pending_next_doc_type: null,
      };
      if (body.followLatest === true) {
        resumeUpdates.follow_latest = true;
        resumeUpdates.resume_document_id = null;
        resumeUpdates.resume_version_id = null;
      }
      await updateJob(supabase, jobId, resumeUpdates);
      const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
      return respond({ job, latest_steps: [], next_action_hint: "run-next" });
    }

    // ═══════════════════════════════════════
    // ACTION: set-resume-source
    // ═══════════════════════════════════════
    if (action === "set-resume-source") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { documentId, versionId } = body;
      if (!documentId || !versionId) return respond({ error: "documentId and versionId required" }, 400);

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      await updateJob(supabase, jobId, {
        follow_latest: false,
        resume_document_id: documentId,
        resume_version_id: versionId,
      });

      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, job.current_document, "resume_source_set",
        `Pinned resume source: doc=${documentId} ver=${versionId}`,
        {}, undefined, { documentId, versionId, follow_latest: false }
      );
      await updateJob(supabase, jobId, { step_count: stepCount });

      return respondWithJob(supabase, jobId);
    }

    // ═══════════════════════════════════════
    // ACTION: approve-decision
    // ═══════════════════════════════════════
    if (action === "approve-decision") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { decisionId, selectedValue } = body;
      if (!decisionId || !selectedValue) return respond({ error: "decisionId and selectedValue required" }, 400);

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      const pending = job.pending_decisions || [];
      // Support both old format (decisionId + selectedValue) and new choice format (choiceId)
      const choiceId = body.choiceId || decisionId;
      const choiceValue = body.selectedValue || "yes";

      const decision = pending.find((d: any) => d.id === choiceId);
      if (!decision) return respond({ error: `Decision ${choiceId} not found in pending_decisions` }, 404);

      const stepCount = job.step_count + 1;
      const currentDoc = job.current_document as DocStage;

      // ── Handle step-limit choices ──
      if (choiceId === "raise_step_limit_once" && choiceValue === "yes") {
        const newMax = job.max_total_steps + 6;
        await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
          `Step limit raised: ${job.max_total_steps} → ${newMax}`,
          {}, undefined, { choiceId, choiceValue }
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          max_total_steps: newMax,
          status: "running",
          stop_reason: null,
          pending_decisions: null,
        });
        return respondWithJob(supabase, jobId, "run-next");
      }

      if (choiceId === "raise_step_limit_once" && choiceValue === "no") {
        await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
          "User declined step extension — stopping run",
          {}, undefined, { choiceId, choiceValue }
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          status: "stopped",
          stop_reason: "User stopped at step limit",
          pending_decisions: null,
        });
        return respondWithJob(supabase, jobId, "none");
      }

      if (choiceId === "run_exec_strategy" && choiceValue === "yes") {
        // Run executive strategy inline
        try {
          const { data: project } = await supabase.from("projects")
            .select("format, development_behavior")
            .eq("id", job.project_id).single();
          const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
          const behavior = project?.development_behavior || "market";

          const { data: docs } = await supabase.from("project_documents")
            .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
            .order("created_at", { ascending: false }).limit(1);
          const doc = docs?.[0];
          if (!doc) throw new Error("No document found for executive strategy");

          const { data: versions } = await supabase.from("project_document_versions")
            .select("id").eq("document_id", doc.id)
            .order("version_number", { ascending: false }).limit(1);
          const latestVersion = versions?.[0];
          if (!latestVersion) throw new Error("No version found");

          const stratResult = await callEdgeFunctionWithRetry(
            supabase, supabaseUrl, "dev-engine-v2", {
              action: "executive-strategy",
              projectId: job.project_id,
              documentId: doc.id,
              versionId: latestVersion.id,
              deliverableType: currentDoc,
              format,
              developmentBehavior: behavior,
            }, token, job.project_id, format, currentDoc, jobId, stepCount
          );

          const strat = stratResult?.result || stratResult || {};
          const autoFixes = strat.auto_fixes || {};
          const mustDecide = Array.isArray(strat.must_decide) ? strat.must_decide : [];

          // Apply auto_fixes
          const projectUpdates: Record<string, any> = {};
          if (autoFixes.assigned_lane) projectUpdates.assigned_lane = autoFixes.assigned_lane;
          if (autoFixes.budget_range) projectUpdates.budget_range = autoFixes.budget_range;
          const qualFixes = autoFixes.qualifications || {};
          if (Object.keys(qualFixes).length > 0) {
            const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
            const gc = curProj?.guardrails_config || {};
            gc.overrides = gc.overrides || {};
            gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), ...qualFixes };
            projectUpdates.guardrails_config = gc;
            if (qualFixes.episode_target_duration_seconds) {
              projectUpdates.episode_target_duration_seconds = qualFixes.episode_target_duration_seconds;
            }
          }
          if (Object.keys(projectUpdates).length > 0) {
            await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
          }

          await logStep(supabase, jobId, stepCount, currentDoc, "executive_strategy",
            strat.summary || `Auto-fixes applied: ${Object.keys(projectUpdates).join(", ") || "none"}`,
            {}, undefined, { strategy: strat, updates: projectUpdates }
          );

          // If strategy produced blocking decisions, pause again
          const blockingDecisions = mustDecide.filter((d: any) => d.impact === "blocking");
          if (blockingDecisions.length > 0) {
            await updateJob(supabase, jobId, {
              step_count: stepCount,
              stage_loop_count: 0,
              status: "paused",
              stop_reason: `Approval required: ${blockingDecisions[0].question}`,
              pending_decisions: mustDecide,
            });
            return respondWithJob(supabase, jobId, "approve-decision");
          }

          // Resume with extended steps
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            stage_loop_count: 0,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        } catch (stratErr: any) {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            `Executive strategy failed: ${stratErr.message}`,
          );
          // Fall through to just raise step limit
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }
      }

      if (choiceId === "force_promote" && choiceValue === "yes") {
        const { data: fpProj } = await supabase.from("projects").select("format").eq("id", job.project_id).single();
        const fpFmt = (fpProj?.format || "film").toLowerCase().replace(/_/g, "-");
        const next = nextDoc(currentDoc, fpFmt);
        if (next && ladderIndexOf(next, fpFmt) <= ladderIndexOf(job.target_document, fpFmt)) {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            `Force-promoted: ${currentDoc} → ${next}`,
            {}, undefined, { choiceId, choiceValue }
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            current_document: next,
            stage_loop_count: 0,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        } else {
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "completed",
            stop_reason: "Reached target document (force-promoted)",
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Generic decision handling (original executive-strategy must_decide) ──
      const projectUpdates: Record<string, any> = {};
      const did = choiceId.toLowerCase();
      if (did.includes("lane") || did.includes("positioning")) {
        projectUpdates.assigned_lane = choiceValue;
      } else if (did.includes("budget")) {
        projectUpdates.budget_range = choiceValue;
      } else if (did.includes("format")) {
        projectUpdates.format = choiceValue;
      } else if (did.includes("episode") || did.includes("duration") || did.includes("runtime")) {
        const num = Number(choiceValue);
        if (!isNaN(num)) {
          const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
          const gc = curProj?.guardrails_config || {};
          gc.overrides = gc.overrides || {};
          gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), [choiceId]: num };
          projectUpdates.guardrails_config = gc;
          if (did.includes("episode_target_duration")) {
            projectUpdates.episode_target_duration_seconds = num;
          }
        }
      } else {
        const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
        const gc = curProj?.guardrails_config || {};
        gc.overrides = gc.overrides || {};
        gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), [choiceId]: choiceValue };
        projectUpdates.guardrails_config = gc;
      }

      if (Object.keys(projectUpdates).length > 0) {
        await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
      }

      const remainingDecisions = pending.filter((d: any) => d.id !== choiceId);
      const hasBlockingRemaining = remainingDecisions.some((d: any) => d.impact === "blocking");

      await logStep(supabase, jobId, stepCount, job.current_document, "decision_applied",
        `${decision.question} → ${choiceValue}`,
        {}, undefined, { decisionId: choiceId, selectedValue: choiceValue, updates: projectUpdates }
      );

      if (hasBlockingRemaining) {
        const nextBlocking = remainingDecisions.find((d: any) => d.impact === "blocking");
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          pending_decisions: remainingDecisions,
          stop_reason: `Approval required: ${nextBlocking?.question || "pending decisions"}`,
        });
        return respondWithJob(supabase, jobId, "approve-decision");
      }

      await updateJob(supabase, jobId, {
        step_count: stepCount,
        status: "running",
        stop_reason: null,
        pending_decisions: null,
      });
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: get-pending-doc
    // ═══════════════════════════════════════
    if (action === "get-pending-doc") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (!job.awaiting_approval || !job.pending_doc_id) return respond({ error: "No pending document" }, 400);

      // Fetch version plaintext
      let docText = "";
      if (job.pending_version_id) {
        const { data: ver } = await supabase.from("project_document_versions")
          .select("plaintext").eq("id", job.pending_version_id).single();
        docText = ver?.plaintext || "";
      }
      if (!docText && job.pending_doc_id) {
        const { data: docRow } = await supabase.from("project_documents")
          .select("extracted_text, plaintext").eq("id", job.pending_doc_id).single();
        docText = docRow?.extracted_text || docRow?.plaintext || "";
      }

      return respond({
        job,
        pending_doc: {
          doc_id: job.pending_doc_id,
          version_id: job.pending_version_id,
          doc_type: job.pending_doc_type,
          next_doc_type: job.pending_next_doc_type,
          approval_type: job.approval_type,
          char_count: docText.length,
          text: docText,
          preview: docText.slice(0, 500),
        },
      });
    }

    // ═══════════════════════════════════════
    // ACTION: approve-next
    // ═══════════════════════════════════════
    if (action === "approve-next") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const approvalDecision = decision || body.approvalDecision;
      if (!approvalDecision || !["approve", "revise", "stop"].includes(approvalDecision)) {
        return respond({ error: "decision required: approve | revise | stop" }, 400);
      }

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (!job.awaiting_approval) return respond({ error: "Job is not awaiting approval" }, 400);

      const stepCount = job.step_count + 1;
      const currentDoc = job.current_document as DocStage;

      if (approvalDecision === "stop") {
        await logStep(supabase, jobId, stepCount, currentDoc, "approval_stop", "User stopped at approval gate");
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "stopped", stop_reason: "User stopped at approval gate",
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        });
        return respondWithJob(supabase, jobId, "none");
      }

      if (approvalDecision === "revise") {
        await logStep(supabase, jobId, stepCount, currentDoc, "approval_revise", "User requested another rewrite pass");
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "running", stop_reason: null,
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
          stage_loop_count: Math.max(0, job.stage_loop_count - 1), // allow one more loop
        });
        return respondWithJob(supabase, jobId, "run-next");
      }

      // approve — advance stage + approve+activate the pending version
      const nextStage = job.pending_next_doc_type as DocStage | null;

      // Approve the document version in project_document_versions + active folder
      const approveVersionId = job.pending_version_id || null;
      if (approveVersionId) {
        try {
          await supabase.from("project_document_versions").update({
            approval_status: "approved",
            approved_at: new Date().toISOString(),
            approved_by: userId,
          }).eq("id", approveVersionId);

          // Resolve doc_type_key and upsert active folder
          const { data: ver } = await supabase.from("project_document_versions")
            .select("id, deliverable_type, label, stage, document_id")
            .eq("id", approveVersionId).single();
          if (ver) {
            const { data: parentDoc } = await supabase.from("project_documents")
              .select("id, doc_type, title, file_name")
              .eq("id", ver.document_id).single();
            const { data: proj } = await supabase.from("projects")
              .select("format").eq("id", job.project_id).single();
            const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");
            const isSeries = ["tv-series","limited-series","vertical-drama","digital-series","documentary-series","anim-series"].includes(fmt);

            const keys = [ver.deliverable_type, parentDoc?.doc_type].filter(Boolean);
            let docTypeKey = "other";
            for (const k of keys) {
              const norm = (k as string).toLowerCase().replace(/[-\s]/g, "_");
              const KEY_MAP_LOCAL: Record<string,string> = {
                concept_brief:"concept_brief",concept:"concept_brief",market_sheet:"market_sheet",market:"market_sheet",
                deck:"deck",blueprint:"blueprint",series_bible:"blueprint",beat_sheet:"beat_sheet",
                character_bible:"character_bible",character:"character_bible",episode_grid:"episode_grid",
                season_arc:"season_arc",documentary_outline:"documentary_outline",script:"feature_script",
                feature_script:"feature_script",pilot_script:"episode_script",episode_script:"episode_script",
                episode_1_script:"episode_script",production_draft:"production_draft",format_rules:"format_rules",
              };
              if (KEY_MAP_LOCAL[norm]) {
                docTypeKey = KEY_MAP_LOCAL[norm];
                if (isSeries && docTypeKey === "feature_script") docTypeKey = "episode_script";
                break;
              }
            }

            if (docTypeKey !== "other") {
              await supabase.from("project_active_docs").upsert({
                project_id: job.project_id,
                doc_type_key: docTypeKey,
                document_version_id: approveVersionId,
                approved_at: new Date().toISOString(),
                approved_by: userId,
                source_flow: "auto_run",
              }, { onConflict: "project_id,doc_type_key" });
            }
          }
        } catch (e: any) {
          console.error("Auto-run approve+activate failed (non-fatal):", e.message);
        }
      }

      await logStep(supabase, jobId, stepCount, currentDoc, "approval_approved",
        `User approved ${job.approval_type}: ${currentDoc} → ${nextStage || "continue"}`
      );

      if (nextStage && isOnLadder(nextStage, format) && ladderIndexOf(nextStage, format) <= ladderIndexOf(job.target_document, format)) {
        await updateJob(supabase, jobId, {
          step_count: stepCount, current_document: nextStage, stage_loop_count: 0,
          status: "running", stop_reason: null,
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        });
      } else {
        // Target reached
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "completed", stop_reason: "Reached target document (approved)",
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        });
      }
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: set-stage
    // ═══════════════════════════════════════
    if (action === "set-stage") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { stage } = body;
      if (!stage || !isOnLadder(stage)) return respond({ error: `Invalid stage: ${stage}` }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, stage, "set_stage", `Manual stage set: ${job.current_document} → ${stage}`);
      await updateJob(supabase, jobId, {
        current_document: stage, stage_loop_count: 0, step_count: stepCount,
      });
      return respondWithJob(supabase, jobId);
    }

    // ═══════════════════════════════════════
    // ACTION: force-promote
    // ═══════════════════════════════════════
    if (action === "force-promote") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      // Fetch format for format-aware ladder
      const { data: jobProj } = await supabase.from("projects").select("format").eq("id", job.project_id).single();
      const jobFmt = (jobProj?.format || "film").toLowerCase().replace(/_/g, "-");
      const next = nextDoc(current, jobFmt);
      if (!next) return respond({ error: `Already at final stage: ${current}` }, 400);
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, current, "force_promote", `Force-promoted: ${current} → ${next}`);
      const targetIdx = ladderIndexOf(job.target_document, jobFmt);
      const nextIdx = ladderIndexOf(next, jobFmt);
      if (nextIdx > targetIdx) {
        await updateJob(supabase, jobId, { step_count: stepCount, status: "completed", stop_reason: `Force-promoted past target` });
      } else {
        await updateJob(supabase, jobId, {
          current_document: next, stage_loop_count: 0, step_count: stepCount,
          status: "running", stop_reason: null,
          awaiting_approval: false, approval_type: null, pending_doc_id: null, pending_version_id: null,
          pending_doc_type: null, pending_next_doc_type: null, pending_decisions: null,
        });
      }
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: restart-from-stage
    // ═══════════════════════════════════════
    if (action === "restart-from-stage") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { stage } = body;
      if (!stage || !isOnLadder(stage)) return respond({ error: `Invalid stage: ${stage}` }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, stage, "restart_from_stage", `Restarted from ${stage}`);
      await updateJob(supabase, jobId, {
        current_document: stage, stage_loop_count: 0, step_count: stepCount,
        status: "running", stop_reason: null, error: null,
        awaiting_approval: false, approval_type: null, approval_payload: null,
        pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        pending_decisions: null,
      });
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: apply-rewrite (manual rewrite from Promotion Intelligence)
    // ═══════════════════════════════════════
    if (action === "apply-rewrite") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count + 1;

      // Fetch latest doc + version for current stage (fallback to previous stage)
      let doc: any = null;
      const { data: docs } = await supabase.from("project_documents")
        .select("id, doc_type, plaintext, extracted_text")
        .eq("project_id", job.project_id).eq("doc_type", currentDoc)
        .order("created_at", { ascending: false }).limit(1);
      doc = docs?.[0];
      if (!doc) {
        // Fallback: find the closest previous stage document
        const jobLadder = getLadderForJob(format);
        const ladderIdx = jobLadder.indexOf(currentDoc);
        for (let i = ladderIdx - 1; i >= 0; i--) {
          const { data: fallbackDocs } = await supabase.from("project_documents")
            .select("id, doc_type, plaintext, extracted_text")
            .eq("project_id", job.project_id).eq("doc_type", jobLadder[i])
            .order("created_at", { ascending: false }).limit(1);
          if (fallbackDocs?.[0]) { doc = fallbackDocs[0]; break; }
        }
        if (!doc) return respond({ error: `No document found for stage ${currentDoc} or any prior stage` }, 400);
      }

      const { data: versions } = await supabase.from("project_document_versions")
        .select("id, plaintext, version_number")
        .eq("document_id", doc.id)
        .order("version_number", { ascending: false }).limit(1);
      const latestVersion = versions?.[0];
      if (!latestVersion) return respond({ error: "No version found" }, 400);

      // Fetch latest notes
      const notesResult = await supabase.from("development_runs")
        .select("output_json").eq("document_id", doc.id).eq("run_type", "NOTES")
        .order("created_at", { ascending: false }).limit(1).single();
      const notes = notesResult.data?.output_json;
      const approvedNotes = [
        ...(notes?.blocking_issues || []),
        ...(notes?.high_impact_notes || []),
      ];
      const protectItems = notes?.protect || [];

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      try {
        const rewriteResult = await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "rewrite",
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            approvedNotes,
            protectItems,
            deliverableType: currentDoc,
            developmentBehavior: behavior,
            format,
          }, token, job.project_id, format, currentDoc, jobId, stepCount
        );

        // Re-fetch latest version after rewrite
        const { data: postRewriteVersions } = await supabase.from("project_document_versions")
          .select("id, version_number")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false }).limit(1);
        const newVersionId = postRewriteVersions?.[0]?.id || "unknown";

        const newLoopCount = job.stage_loop_count + 1;
        await logStep(supabase, jobId, stepCount, currentDoc, "manual_rewrite",
          `Manual rewrite applied (loop ${newLoopCount}). New version: ${newVersionId}`,
          {}, undefined, { docId: doc.id, newVersionId }
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          stage_loop_count: newLoopCount,
          status: "running",
          stop_reason: null,
          follow_latest: true,
          resume_document_id: doc.id,
          resume_version_id: newVersionId !== "unknown" ? newVersionId : null,
        });
        return respondWithJob(supabase, jobId, "run-next");
      } catch (e: any) {
        await logStep(supabase, jobId, stepCount, currentDoc, "manual_rewrite_failed", `Rewrite failed: ${e.message}`);
        return respond({ error: `Rewrite failed: ${e.message}` }, 500);
      }
    }

    // ═══════════════════════════════════════
    // ACTION: run-strategy (manual executive strategy from Promotion Intelligence)
    // ═══════════════════════════════════════
    if (action === "run-strategy") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count + 1;

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      let doc: any = null;
      const { data: docs } = await supabase.from("project_documents")
        .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
        .order("created_at", { ascending: false }).limit(1);
      doc = docs?.[0];
      if (!doc) {
        const jobLadder2 = getLadderForJob(format);
        const ladderIdx = jobLadder2.indexOf(currentDoc);
        for (let i = ladderIdx - 1; i >= 0; i--) {
          const { data: fallbackDocs } = await supabase.from("project_documents")
            .select("id").eq("project_id", job.project_id).eq("doc_type", jobLadder2[i])
            .order("created_at", { ascending: false }).limit(1);
          if (fallbackDocs?.[0]) { doc = fallbackDocs[0]; break; }
        }
        if (!doc) return respond({ error: `No document found for stage ${currentDoc} or any prior stage` }, 400);
      }

      const { data: vers } = await supabase.from("project_document_versions")
        .select("id").eq("document_id", doc.id)
        .order("version_number", { ascending: false }).limit(1);
      const latestVersion = vers?.[0];
      if (!latestVersion) return respond({ error: "No version found" }, 400);

      try {
        const stratResult = await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "executive-strategy",
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            deliverableType: currentDoc,
            format,
            developmentBehavior: behavior,
          }, token, job.project_id, format, currentDoc, jobId, stepCount
        );

        const strat = stratResult?.result || stratResult || {};
        const autoFixes = strat.auto_fixes || {};
        const mustDecide = Array.isArray(strat.must_decide) ? strat.must_decide : [];

        // Apply auto_fixes to project
        const projectUpdates: Record<string, any> = {};
        if (autoFixes.assigned_lane) projectUpdates.assigned_lane = autoFixes.assigned_lane;
        if (autoFixes.budget_range) projectUpdates.budget_range = autoFixes.budget_range;
        const qualFixes = autoFixes.qualifications || {};
        if (Object.keys(qualFixes).length > 0) {
          const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
          const gc = curProj?.guardrails_config || {};
          gc.overrides = gc.overrides || {};
          gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), ...qualFixes };
          projectUpdates.guardrails_config = gc;
        }
        if (Object.keys(projectUpdates).length > 0) {
          await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
        }

        await logStep(supabase, jobId, stepCount, currentDoc, "manual_strategy",
          strat.summary || `Executive strategy: auto-fixes=${Object.keys(projectUpdates).join(",")||"none"}, decisions=${mustDecide.length}`,
          {}, undefined, { strategy: strat, updates: projectUpdates }
        );

        // If blocking decisions exist, pause for user
        const blockingDecisions = mustDecide.filter((d: any) => d.impact === "blocking");
        if (blockingDecisions.length > 0) {
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "paused",
            stop_reason: `Executive strategy decision required: ${blockingDecisions[0].question}`,
            pending_decisions: mustDecide,
          });
          return respondWithJob(supabase, jobId, "approve-decision");
        }

        // No blocking decisions — resume
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          status: "paused",
          stop_reason: "Executive strategy complete — review applied changes",
        });
        return respondWithJob(supabase, jobId, "resume");
      } catch (e: any) {
        await logStep(supabase, jobId, stepCount, currentDoc, "manual_strategy_failed", `Strategy failed: ${e.message}`);
        return respond({ error: `Strategy failed: ${e.message}` }, 500);
      }
    }

    // ═══════════════════════════════════════
    // ACTION: apply-decisions-and-continue
    // ═══════════════════════════════════════
    if (action === "apply-decisions-and-continue") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { selectedOptions, globalDirections } = body;
      if (!selectedOptions || !Array.isArray(selectedOptions) || selectedOptions.length === 0) {
        return respond({ error: "selectedOptions array required" }, 400);
      }

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count + 1;

      // Resolve doc and version — use pending or fall back to latest
      let docId = job.pending_doc_id;
      let versionId = job.pending_version_id;

      // Fallback: resolve latest document/version for current stage if pending not set
      if (!docId || !versionId) {
        const { data: latestDoc } = await supabase.from("project_documents")
          .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
          .order("created_at", { ascending: false }).limit(1).single();
        if (latestDoc) {
          docId = latestDoc.id;
          const { data: latestVer } = await supabase.from("project_document_versions")
            .select("id").eq("document_id", latestDoc.id)
            .order("version_number", { ascending: false }).limit(1).single();
          versionId = latestVer?.id || null;
        }
      }
      if (!docId || !versionId) return respond({ error: "No document/version found for current stage" }, 400);

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      // Fetch latest notes for protect items
      const notesResult = await supabase.from("development_runs")
        .select("output_json").eq("document_id", docId).eq("run_type", "NOTES")
        .order("created_at", { ascending: false }).limit(1).single();
      const notes = notesResult.data?.output_json;

      // Build approved notes from selected options
      const approvedNotes = [
        ...(notes?.blocking_issues || []),
        ...(notes?.high_impact_notes || []),
      ];
      const protectItems = notes?.protect || [];

      try {
        await logStep(supabase, jobId, stepCount, currentDoc, "apply_decisions",
          `Applying ${selectedOptions.length} decisions with rewrite`,
          {}, undefined, { selectedOptions, globalDirections }
        );

        const rewriteResult = await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "rewrite",
            projectId: job.project_id,
            documentId: docId,
            versionId: versionId,
            approvedNotes,
            protectItems,
            deliverableType: currentDoc,
            developmentBehavior: behavior,
            format,
            selectedOptions,
            globalDirections,
          }, token, job.project_id, format, currentDoc, jobId, stepCount
        );

        // Re-fetch latest version after rewrite
        const { data: postRewriteVersions } = await supabase.from("project_document_versions")
          .select("id, version_number")
          .eq("document_id", docId)
          .order("version_number", { ascending: false }).limit(1);
        const newVersionId = postRewriteVersions?.[0]?.id || "unknown";

        await logStep(supabase, jobId, stepCount + 1, currentDoc, "decisions_applied_rewrite",
          `Decisions applied, new version: ${newVersionId}`,
          {}, undefined, { docId, newVersionId, selectedOptions: selectedOptions.length }
        );

        await updateJob(supabase, jobId, {
          step_count: stepCount + 1,
          status: "running",
          stop_reason: null,
          follow_latest: true,
          resume_document_id: docId,
          resume_version_id: newVersionId !== "unknown" ? newVersionId : null,
          pending_doc_id: null,
          pending_version_id: null,
          pending_decisions: null,
          awaiting_approval: false,
          approval_type: null,
          approval_payload: null,
          error: null,
        });
        return respondWithJob(supabase, jobId, "run-next");
      } catch (e: any) {
        await logStep(supabase, jobId, stepCount, currentDoc, "decisions_rewrite_failed", `Rewrite with decisions failed: ${e.message}`);
        return respond({ error: `Decisions rewrite failed: ${e.message}` }, 500);
      }
    }

    // ═══════════════════════════════════════
    // ACTION: run-next (core state machine step)
    // ═══════════════════════════════════════
    if (action === "run-next") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      let optionsGeneratedThisStep = false;

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (job.awaiting_approval) return respond({ job, latest_steps: [], next_action_hint: "awaiting-approval" });
      if (job.status !== "running") return respond({ job, latest_steps: [], next_action_hint: getHint(job) });

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count;
      const stageLoopCount = job.stage_loop_count;

      // ── Guard: max steps — pause with actionable choices ──
      if (stepCount >= job.max_total_steps) {
        const stepLimitDecisions = [
          {
            id: "raise_step_limit_once",
            question: `Step limit (${job.max_total_steps}) reached. Continue with 6 more steps?`,
            options: [
              { value: "yes", why: "Add 6 more steps and continue the current development cycle" },
              { value: "no", why: "Stop the run here" },
            ],
            recommended: "yes",
            impact: "blocking" as const,
          },
          {
            id: "run_exec_strategy",
            question: "Run Executive Strategy to diagnose and reposition?",
            options: [
              { value: "yes", why: "Recommended when progress has stalled — analyses lane, budget, and qualifications" },
              { value: "no", why: "Skip strategic review" },
            ],
            recommended: "yes",
            impact: "non_blocking" as const,
          },
          {
            id: "force_promote",
            question: "Force-promote to the next document stage?",
            options: [
              { value: "yes", why: "Skip remaining loops and advance to the next stage immediately" },
              { value: "no", why: "Stay at current stage" },
            ],
            impact: "non_blocking" as const,
          },
        ];

        const pendingBundle = {
          reason: "step_limit_reached",
          current_document: currentDoc,
          last_ci: job.last_ci,
          last_gp: job.last_gp,
          last_gap: job.last_gap,
          last_readiness: job.last_readiness,
          last_risk_flags: job.last_risk_flags,
          choices: stepLimitDecisions,
        };

        await updateJob(supabase, jobId, {
          status: "paused",
          stop_reason: "Approval required to continue",
          pending_decisions: stepLimitDecisions,
        });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "pause_for_approval",
          `Step limit (${job.max_total_steps}) reached — awaiting user decision`,
          { ci: job.last_ci, gp: job.last_gp, gap: job.last_gap, readiness: job.last_readiness },
          undefined, pendingBundle
        );
        return respondWithJob(supabase, jobId, "approve-decision");
      }

      // ── Guard: already at target ──
      if (currentDoc === job.target_document && stageLoopCount > 0) {
        await updateJob(supabase, jobId, { status: "completed", stop_reason: "Reached target document" });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", "Target document reached");
        return respondWithJob(supabase, jobId);
      }

      // ── SERIES WRITER HARD GATE ──
      // For episodic formats the "script" stage is owned by Series Writer, not AutoRun.
      // AutoRun generates everything up through the last pre-script stage (e.g. episode_grid /
      // vertical_episode_beats), then hands off to Series Writer for versioned episode generation.
      // AutoRun must NEVER create a new project_document of doc_type "script" for episodic formats.
      {
        const _fmtCheck = (job as any)._cached_format_for_guard;  // may be undefined — safe
        const { data: _projFmtRow } = await supabase.from("projects")
          .select("format").eq("id", job.project_id).single();
        const _fmtNorm = (_projFmtRow?.format || "film").toLowerCase().replace(/_/g, "-");
        const EPISODIC_FORMATS = ["tv-series","limited-series","vertical-drama","digital-series","anim-series"];
        if (EPISODIC_FORMATS.includes(_fmtNorm) && currentDoc === "script") {
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "series_writer_handoff",
            `Episodic format (${_fmtNorm}): "script" stage is owned by Series Writer. AutoRun paused — open Series Writer to generate/revise episodes.`,
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount + 1,
            status: "paused",
            stop_reason: "series_writer_required: Episode scripts must be generated via Series Writer to maintain version continuity. Click 'Open Series Writer' to continue.",
            awaiting_approval: true,
            approval_type: "series_writer",
            pending_doc_type: "script",
            pending_next_doc_type: "series_writer",
          });
          return respondWithJob(supabase, jobId, "awaiting-approval");
        }
      }

      // ── Preflight qualification resolver before every cycle ──
      const { data: project } = await supabase.from("projects")
        .select("title, format, development_behavior, episode_target_duration_seconds, season_episode_count, guardrails_config, assigned_lane, budget_range, genres")
        .eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      const allowDefaults = job.allow_defaults !== false; // default true for backward compat
      const preflight = await runPreflight(supabase, job.project_id, format, currentDoc, allowDefaults);
      if (preflight.changed) {
        await logStep(supabase, jobId, stepCount, currentDoc, "preflight_resolve",
          `Resolved: ${Object.keys(preflight.resolved).join(", ")}`,
        );
      }

      // ── PAUSE if missing required criteria and allow_defaults is false ──
      if (preflight.missing_required.length > 0 && !allowDefaults) {
        const missingStr = preflight.missing_required.join(", ");
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "pause_missing_criteria",
          `Missing required criteria: ${missingStr}. Please fill in Criteria panel.`,
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount + 1,
          status: "paused",
          stop_reason: `Missing required criteria: ${missingStr}. Please approve/fill in Criteria panel.`,
        });
        return respondWithJob(supabase, jobId, "fix-criteria");
      }

      // ── Canonical Qualification Resolver — call edge function ──
      let resolvedQuals: any = null;
      let resolverHash: string | null = null;
      try {
        const resolverResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId: job.project_id }),
        });
        if (resolverResp.ok) {
          const resolverResult = await resolverResp.json();
          resolvedQuals = resolverResult.resolvedQualifications || {};
          resolverHash = resolverResult.resolver_hash || null;

          // Check hash change mid-run — detect stale episode count
          // Look at last review step's stored resolver hash
          const { data: lastStepWithHash } = await supabase.from("auto_run_steps")
            .select("step_resolver_hash")
            .eq("job_id", jobId)
            .not("step_resolver_hash", "is", null)
            .order("step_index", { ascending: false })
            .limit(1)
            .single();

          const prevStepHash = lastStepWithHash?.step_resolver_hash || null;
          if (prevStepHash && resolverHash && prevStepHash !== resolverHash) {
            // Invalidate cached context fields that depend on episode count
            await logStep(supabase, jobId, stepCount, currentDoc, "qualification_hash_changed",
              `Resolver hash changed: ${prevStepHash} → ${resolverHash}. Episode count/duration may have changed. Invalidating cached context and re-analyzing with canonical values.`,
              { risk_flags: ["qualification_hash_changed", "episode_count_invalidated"] }
            );
            // Reset stage loop count so a fresh analysis cycle starts
            await updateJob(supabase, jobId, { stage_loop_count: 0 });
          }
        } else {
          const errText = await resolverResp.text();
          console.warn("[auto-run] resolve-qualifications failed:", errText);
        }
      } catch (resolverErr: any) {
        console.warn("[auto-run] resolve-qualifications call failed:", resolverErr.message);
      }

      // Fallback to old resolver if edge function failed
      if (!resolvedQuals) {
        const fallbackQuals = await resolveSeriesQualifications(supabase, job.project_id, format);
        resolvedQuals = fallbackQuals;
      }

      const episodeDuration = resolvedQuals.episode_target_duration_seconds;
      const seasonEpisodeCount = resolvedQuals.season_episode_count;

      // ── IDEA auto-upshift: skip thin ideas directly to concept_brief ──
      if (currentDoc === "idea") {
        const { data: ideaDocs } = await supabase.from("project_documents")
          .select("id, plaintext, extracted_text")
          .eq("project_id", job.project_id).eq("doc_type", "idea")
          .order("created_at", { ascending: false }).limit(1);
        const ideaDoc = ideaDocs?.[0];
        const ideaText = ideaDoc?.extracted_text || ideaDoc?.plaintext || "";
        const wordCount = ideaText.trim().split(/\s+/).filter(Boolean).length;

        if (ideaText.length < 400 || wordCount < 80) {
          // Thin idea — convert to concept brief directly
          if (ideaDoc) {
            const { data: ideaVersions } = await supabase.from("project_document_versions")
              .select("id").eq("document_id", ideaDoc.id)
              .order("version_number", { ascending: false }).limit(1);
            const ideaVersion = ideaVersions?.[0];

            if (ideaVersion) {
              try {
                await callEdgeFunctionWithRetry(
                  supabase, supabaseUrl, "dev-engine-v2", {
                    action: "convert",
                    projectId: job.project_id,
                    documentId: ideaDoc.id,
                    versionId: ideaVersion.id,
                    targetOutput: "CONCEPT_BRIEF",
                  }, token, job.project_id, format, currentDoc, jobId, stepCount + 1
                );
              } catch (_e) {
                // conversion failed — continue anyway at concept_brief
              }
            }
          }

          const upshiftStep = stepCount + 1;
          await logStep(supabase, jobId, upshiftStep, "idea", "auto_skip_thin_idea",
            `Idea too thin (${wordCount} words, ${ideaText.length} chars); converting to concept brief`
          );
          await updateJob(supabase, jobId, {
            current_document: "concept_brief",
            stage_loop_count: 0,
            step_count: upshiftStep,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }
      }

      // ── Staleness check: compare current doc's criteria_snapshot vs latest ──
      const latestCriteriaSnapshot = await buildCriteriaSnapshot(supabase, job.project_id);

      // ── Fetch document for current stage (respecting follow_latest / pinned source) ──
      let doc: any = null;
      let latestVersion: any = null;
      let resumeSourceUsed = false;
      const resumeRiskFlags: string[] = [];

      if (!job.follow_latest && job.resume_document_id && job.resume_version_id) {
        // Pinned source — validate it
        const { data: pinnedDoc } = await supabase.from("project_documents")
          .select("id, doc_type, plaintext, extracted_text")
          .eq("id", job.resume_document_id)
          .eq("project_id", job.project_id)
          .single();
        const { data: pinnedVer } = await supabase.from("project_document_versions")
          .select("id, plaintext, version_number")
          .eq("id", job.resume_version_id)
          .eq("document_id", job.resume_document_id)
          .single();

        if (pinnedDoc && pinnedVer && pinnedDoc.doc_type === currentDoc) {
          doc = pinnedDoc;
          latestVersion = pinnedVer;
          resumeSourceUsed = true;
        } else {
          // Invalid pinned source — fall back to latest
          resumeRiskFlags.push("resume_source_invalid_fallback");
          await updateJob(supabase, jobId, { follow_latest: true, resume_document_id: null, resume_version_id: null });
        }
      }

      if (!doc) {
        const { data: docs } = await supabase.from("project_documents")
          .select("id, doc_type, plaintext, extracted_text")
          .eq("project_id", job.project_id).eq("doc_type", currentDoc)
          .order("created_at", { ascending: false }).limit(1);
        doc = docs?.[0];
      }

      // If no document exists for current stage, generate one
      if (!doc) {
        const runNextLadder = getLadderForJob(format);
        const ladderIdx = runNextLadder.indexOf(currentDoc);
        if (ladderIdx <= 0) {
          await updateJob(supabase, jobId, { status: "failed", error: "No source document found for initial stage" });
          return respondWithJob(supabase, jobId);
        }

        const prevStage = runNextLadder[ladderIdx - 1];
        const { data: prevDocs } = await supabase.from("project_documents").select("id").eq("project_id", job.project_id).eq("doc_type", prevStage).order("created_at", { ascending: false }).limit(1);
        const prevDoc = prevDocs?.[0];
        if (!prevDoc) {
          await updateJob(supabase, jobId, { status: "failed", error: `No document for ${prevStage} to convert from` });
          return respondWithJob(supabase, jobId);
        }

        const { data: prevVersions } = await supabase.from("project_document_versions").select("id").eq("document_id", prevDoc.id).order("version_number", { ascending: false }).limit(1);
        const prevVersion = prevVersions?.[0];
        if (!prevVersion) {
          await updateJob(supabase, jobId, { status: "failed", error: `No version for ${prevStage} document` });
          return respondWithJob(supabase, jobId);
        }

        try {
          const { result: convertResult } = await callEdgeFunctionWithRetry(
            supabase, supabaseUrl, "dev-engine-v2", {
              action: "convert",
              projectId: job.project_id,
              documentId: prevDoc.id,
              versionId: prevVersion.id,
              targetOutput: currentDoc.toUpperCase(),
            }, token, job.project_id, format, currentDoc, jobId, stepCount + 1
          );

          const newStep = stepCount + 1;
          await logStep(supabase, jobId, newStep, currentDoc, "generate", `Generated ${currentDoc} from ${prevStage}`, {}, convertResult?.newDoc?.id ? `Created doc ${convertResult.newDoc.id}` : undefined, convertResult?.newDoc ? { docId: convertResult.newDoc.id } : undefined);
          await updateJob(supabase, jobId, { step_count: newStep, stage_loop_count: 0 });

          // ── APPROVAL GATE: after convert, pause for user to review ──
          const convertedDocId = convertResult?.newDoc?.id || convertResult?.documentId || null;
          let convertedVersionId: string | null = null;
          if (convertedDocId) {
            const { data: cvs } = await supabase.from("project_document_versions")
              .select("id").eq("document_id", convertedDocId)
              .order("version_number", { ascending: false }).limit(1);
            convertedVersionId = cvs?.[0]?.id || null;
          }
          if (!convertedDocId) {
            const { data: newDocs } = await supabase.from("project_documents")
              .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
              .order("created_at", { ascending: false }).limit(1);
            const newDocRow = newDocs?.[0];
            if (newDocRow) {
              const { data: newVers } = await supabase.from("project_document_versions")
                .select("id").eq("document_id", newDocRow.id)
                .order("version_number", { ascending: false }).limit(1);
              convertedVersionId = newVers?.[0]?.id || null;
            }
          }

          await logStep(supabase, jobId, newStep + 1, currentDoc, "approval_required",
            `Review generated ${currentDoc} before continuing`,
            {}, undefined, { docId: convertedDocId, versionId: convertedVersionId, doc_type: currentDoc, from_stage: prevStage }
          );
          await updateJob(supabase, jobId, {
            step_count: newStep + 1,
            status: "paused",
            stop_reason: `Approval required: review generated ${currentDoc}`,
            awaiting_approval: true,
            approval_type: "convert",
            pending_doc_id: convertedDocId || prevDoc.id,
            pending_version_id: convertedVersionId,
            pending_doc_type: currentDoc,
            pending_next_doc_type: currentDoc,
          });
          return respondWithJob(supabase, jobId, "awaiting-approval");
        } catch (e: any) {
          await updateJob(supabase, jobId, { status: "failed", error: `Generate failed: ${e.message}` });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", `Generate failed: ${e.message}`);
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Document exists — resolve version ──
      if (!latestVersion) {
        const { data: versions } = await supabase.from("project_document_versions")
          .select("id, plaintext, version_number")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false }).limit(1);
        latestVersion = versions?.[0];
      }
      if (!latestVersion) {
        await updateJob(supabase, jobId, { status: "failed", error: "No version for current document" });
        return respondWithJob(supabase, jobId);
      }

      // Log resume source usage
      if (resumeSourceUsed) {
        await logStep(supabase, jobId, stepCount, currentDoc, "resume_source_used",
          `Using pinned source: doc=${doc.id} ver=${latestVersion.id}`,
          {}, undefined, { documentId: doc.id, versionId: latestVersion.id, follow_latest: false }
        );
      }

      // ── Staleness detection: check if doc's last analysis snapshot differs from current ──
      const { data: lastAnalyzeRun } = await supabase.from("development_runs")
        .select("output_json").eq("document_id", doc.id).eq("run_type", "ANALYZE")
        .order("created_at", { ascending: false }).limit(1).single();
      const docSnapshot = lastAnalyzeRun?.output_json?.criteria_snapshot || null;
      const staleDiffKeys = compareSnapshots(docSnapshot, latestCriteriaSnapshot);

      if (staleDiffKeys.length > 0) {
        const diffStr = staleDiffKeys.join(", ");
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stale_document_detected",
          `Document stale vs current criteria: ${diffStr}`,
          { risk_flags: ["stale_document"] },
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount + 1,
          status: "paused",
          stop_reason: `Document stale vs current criteria: ${diffStr}. Regenerate or approve continuing.`,
          last_risk_flags: [...(job.last_risk_flags || []), "stale_document"],
        });
        return respondWithJob(supabase, jobId, "rebase-required");
      }

      // Resolve the actual text being fed into analysis (version plaintext > doc extracted_text > doc plaintext)
      const reviewText = latestVersion.plaintext || doc.extracted_text || doc.plaintext || "";
      const reviewCharCount = reviewText.length;

      // ── C) STOP if input text is empty ──
      if (reviewCharCount === 0) {
        await updateJob(supabase, jobId, {
          status: "failed",
          error: `Input text empty for stage ${currentDoc} — cannot score. Open document and regenerate.`,
        });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop",
          `Input text empty for ${currentDoc} (docId=${doc.id} verId=${latestVersion.id}). Cannot proceed.`,
        );
        return respondWithJob(supabase, jobId);
      }

      // ── review_input visibility step ──
      const simpleHash = reviewCharCount > 0
        ? reviewText.slice(0, 64).replace(/\s+/g, " ").trim()
        : "(empty)";
      await logStep(supabase, jobId, stepCount, currentDoc, "review_input",
        `Reviewing ${currentDoc} docId=${doc.id} versionId=${latestVersion.id} chars=${reviewCharCount}`,
        {}, reviewText.slice(0, 500),
        { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, char_count: reviewCharCount, preview_hash: simpleHash }
      );

      // Step A: Run review (analyze + notes) with retry
      try {
        const { result: rawAnalyzeResult } = await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "analyze",
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            deliverableType: currentDoc,
            developmentBehavior: behavior,
            format,
            episode_target_duration_seconds: episodeDuration,
            season_episode_count: seasonEpisodeCount,
          }, token, job.project_id, format, currentDoc, jobId, stepCount
        );

        // dev-engine-v2 wraps analysis under { run, analysis }
        const analyzeResult = rawAnalyzeResult?.analysis || rawAnalyzeResult || {};

        const scoreRiskFlags: string[] = [...resumeRiskFlags];
        const ciRaw = pickNumberRaw(analyzeResult, ["ci_score", "scores.ci_score", "scores.ci", "ci"]);
        const gpRaw = pickNumberRaw(analyzeResult, ["gp_score", "scores.gp_score", "scores.gp", "gp"]);
        const used_fallback_scores = ciRaw == null && gpRaw == null;
        const ci = ciRaw ?? 0;
        const gp = gpRaw ?? 0;
        if (used_fallback_scores) scoreRiskFlags.push("used_fallback_scores");
        const gap = pickNumber(analyzeResult, ["gap", "scores.gap"], Math.abs(ci - gp));
        const trajectory = analyzeResult?.trajectory ?? analyzeResult?.convergence?.trajectory ?? null;
        const blockers = pickArray(analyzeResult, ["blocking_issues", "blockers", "scores.blocking_issues"]);
        const highImpact = pickArray(analyzeResult, ["high_impact_notes", "high_impact"]);
        const blockersCount = blockers.length;
        const highImpactCount = highImpact.length;

        const newStep = stepCount + 1;
        const analyzeShapeKeys = Object.keys(analyzeResult || {});

        // Store step_resolver_hash for hash-based invalidation
        const stepInsertResult = await supabase.from("auto_run_steps").insert({
          job_id: jobId,
          step_index: newStep,
          document: currentDoc,
          action: "review",
          summary: `CI:${ci} GP:${gp} Gap:${gap} Traj:${trajectory || "?"} B:${blockersCount} HI:${highImpactCount}`,
          ci, gp, gap, readiness: 0, confidence: 0,
          risk_flags: scoreRiskFlags,
          output_text: (analyzeResult?.executive_snapshot || analyzeResult?.verdict || "").slice(0, 4000) || null,
          output_ref: {
            input_doc_id: doc.id,
            input_version_id: latestVersion.id,
            input_text_len: reviewCharCount,
            analyze_output_ci: ci,
            analyze_output_gp: gp,
            analyze_output_gap: gap,
            analyze_output_shape_keys: analyzeShapeKeys,
            used_fallback_scores,
          },
          step_resolver_hash: resolverHash,
        });

        // Step B: Generate notes with retry
        await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "notes",
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            analysisJson: analyzeResult,
          }, token, job.project_id, format, currentDoc, jobId, newStep
        );

        // Step C: Compute promotion intelligence
        const promo = computePromotion(ci, gp, gap, trajectory, currentDoc, blockersCount, highImpactCount, stageLoopCount + 1);

        await logStep(supabase, jobId, newStep + 1, currentDoc, "promotion_check",
          `${promo.recommendation} (readiness: ${promo.readiness_score}, flags: ${promo.risk_flags.join(",") || "none"})`,
          { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags }
        );

        // Update job scores
        await updateJob(supabase, jobId, {
          step_count: newStep + 1,
          last_ci: ci, last_gp: gp, last_gap: gap,
          last_readiness: promo.readiness_score, last_confidence: promo.confidence,
          last_risk_flags: promo.risk_flags,
        });

        // ── HARD STOPS ──
        if (promo.risk_flags.includes("hard_gate:thrash")) {
          await updateJob(supabase, jobId, { status: "stopped", stop_reason: "Thrash detected — run Executive Strategy Loop" });
          await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "Thrash detected");
          return respondWithJob(supabase, jobId);
        }
        if (promo.risk_flags.includes("hard_gate:eroding_trajectory") || promo.recommendation === "escalate") {
          // Generate options for escalation — no session-based strategy needed
          const escalateReason = promo.risk_flags.includes("hard_gate:eroding_trajectory")
            ? "Trajectory eroding"
            : `Escalation: readiness ${promo.readiness_score}/100`;

          try {
            // Call dev-engine-v2 "options" to generate decision options for escalation
            const optionsResult = await callEdgeFunctionWithRetry(
              supabase, supabaseUrl, "dev-engine-v2", {
                action: "options",
                projectId: job.project_id,
                documentId: doc.id,
                versionId: latestVersion.id,
                deliverableType: currentDoc,
                developmentBehavior: behavior,
                format,
              }, token, job.project_id, format, currentDoc, jobId, newStep + 2
            );

            const optionsData = optionsResult?.result?.options || optionsResult?.result || {};

            const normalizedDecisions = normalizePendingDecisions(optionsData.decisions || [], escalateReason);

            await logStep(supabase, jobId, newStep + 2, currentDoc, "escalate_options_generated",
              `${escalateReason}. Generated ${normalizedDecisions.length} decision sets.`,
              { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags },
            );

            optionsGeneratedThisStep = true;
            await updateJob(supabase, jobId, {
              step_count: newStep + 2,
              status: "paused",
              stop_reason: `Decisions required: ${escalateReason}`,
              pending_decisions: normalizedDecisions.length > 0 ? normalizedDecisions : createFallbackDecisions(currentDoc, ci, gp, escalateReason),
              awaiting_approval: false,
              approval_type: null,
              pending_doc_id: doc.id,
              pending_version_id: latestVersion.id,
            });
            return respondWithJob(supabase, jobId, "decisions-required");
          } catch (optErr: any) {
            // Fallback: pause with simple decisions if options generation fails
            console.error("Escalate options failed:", optErr.message);
            const escalateDecisions = [
              {
                id: "force_promote",
                question: `Escalation at ${currentDoc} (CI:${ci} GP:${gp}). Force-promote to next stage?`,
                options: [
                  { value: "yes", why: "Skip remaining loops and advance to the next document stage" },
                  { value: "no", why: "Stay at current stage" },
                ],
                recommended: currentDoc === "idea" ? "yes" : undefined,
                impact: "blocking" as const,
              },
              {
                id: "raise_step_limit_once",
                question: "Add 6 more steps and continue?",
                options: [
                  { value: "yes", why: "Continue the current development cycle with more steps" },
                  { value: "no", why: "Stop the run" },
                ],
                impact: "non_blocking" as const,
              },
            ];

            await logStep(supabase, jobId, newStep + 2, currentDoc, "pause_for_approval",
              `${escalateReason} — options generation failed, awaiting user decision`,
              { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags },
            );
            await updateJob(supabase, jobId, {
              step_count: newStep + 2,
              status: "paused",
              stop_reason: `Approval required: ${escalateReason}`,
              pending_decisions: escalateDecisions,
              pending_doc_id: doc.id,
              pending_version_id: latestVersion.id,
            });
            return respondWithJob(supabase, jobId, "approve-decision");
          }
        }

        // ── STABILISE: if blockers/high-impact present, generate options and pause for decisions ──
        if (promo.recommendation === "stabilise") {
          const newLoopCount = stageLoopCount + 1;

          // If blockers exist, generate options and pause for user decisions
          if (blockersCount > 0 || (newLoopCount <= 1 && highImpactCount > 0)) {
            try {
              // Call dev-engine-v2 "options" to generate decision options
              const optionsResult = await callEdgeFunctionWithRetry(
                supabase, supabaseUrl, "dev-engine-v2", {
                  action: "options",
                  projectId: job.project_id,
                  documentId: doc.id,
                  versionId: latestVersion.id,
                  deliverableType: currentDoc,
                  developmentBehavior: behavior,
                  format,
                }, token, job.project_id, format, currentDoc, jobId, newStep + 2
              );

              const optionsData = optionsResult?.result?.options || optionsResult?.result || {};
              const optionsRunId = optionsResult?.result?.run?.id || null;

              const stabiliseDecisions = normalizePendingDecisions(optionsData.decisions || [], "Stabilise: blockers/high-impact");

              await logStep(supabase, jobId, newStep + 2, currentDoc, "options_generated",
                `Generated ${stabiliseDecisions.length} decision sets for ${blockersCount} blockers + ${highImpactCount} high-impact notes`,
                { ci, gp, gap, readiness: promo.readiness_score },
                undefined, { optionsRunId, decisions: stabiliseDecisions.length, global_directions: optionsData.global_directions?.length || 0 }
              );

              optionsGeneratedThisStep = true;
              await updateJob(supabase, jobId, {
                step_count: newStep + 2,
                stage_loop_count: newLoopCount,
                status: "paused",
                stop_reason: "Decisions required",
                pending_decisions: stabiliseDecisions.length > 0 ? stabiliseDecisions : createFallbackDecisions(currentDoc, ci, gp, "Blockers/high-impact issues"),
                awaiting_approval: false,
                approval_type: null,
                pending_doc_id: doc.id,
                pending_version_id: latestVersion.id,
              });
              return respondWithJob(supabase, jobId, "decisions-required");
            } catch (optErr: any) {
              // If options generation fails, fall through to regular rewrite
              console.error("Options generation failed, falling back to rewrite:", optErr.message);
              await logStep(supabase, jobId, newStep + 2, currentDoc, "options_failed",
                `Options generation failed: ${optErr.message}. Falling back to rewrite.`);
            }
          }

          // ── DECISION-PRIORITY GUARD: skip max-loops approval if decisions were just set ──
          const jobAfterOptions = await getJob(supabase, jobId);
          const hasActiveDecisions = Array.isArray(jobAfterOptions?.pending_decisions) && (jobAfterOptions.pending_decisions as any[]).length > 0;

          if (!optionsGeneratedThisStep && !hasActiveDecisions && newLoopCount >= job.max_stage_loops) {
            if (blockersCount > 0) {
              const fallback = createFallbackDecisions(currentDoc, ci, gp, "Blockers persist after max loops");
              await updateJob(supabase, jobId, { status: "paused", stop_reason: "Blockers persist — manual decision required", stage_loop_count: newLoopCount, pending_decisions: fallback });
              await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "Blockers persist after max loops");
              return respondWithJob(supabase, jobId);
            }
            const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
            if (next && ladderIndexOf(next, format) <= ladderIndexOf(job.target_document, format)) {
              // ── APPROVAL GATE: pause before force-promoting after max loops ──
              await logStep(supabase, jobId, newStep + 2, currentDoc, "approval_required",
                `Max loops reached. Review ${currentDoc} before promoting to ${next}`,
                {}, undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
              );
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount, step_count: newStep + 2,
                status: "paused", stop_reason: `Approval required: review ${currentDoc} before promoting to ${next}`,
                awaiting_approval: true, approval_type: "promote",
                pending_doc_id: doc.id, pending_version_id: latestVersion.id,
                pending_doc_type: currentDoc, pending_next_doc_type: next,
              });
              return respondWithJob(supabase, jobId, "awaiting-approval");
            }
          }

          // No blockers or options already handled — apply rewrite with all notes (with retry)
          const notesResult = await supabase.from("development_runs").select("output_json").eq("document_id", doc.id).eq("run_type", "NOTES").order("created_at", { ascending: false }).limit(1).single();
          const notes = notesResult.data?.output_json;
          const approvedNotes = [
            ...(notes?.blocking_issues || analyzeResult?.blocking_issues || []),
            ...(notes?.high_impact_notes || analyzeResult?.high_impact_notes || []),
          ];
          const protectItems = notes?.protect || analyzeResult?.protect || [];

          try {
            const rewriteResult = await callEdgeFunctionWithRetry(
              supabase, supabaseUrl, "dev-engine-v2", {
                action: "rewrite",
                projectId: job.project_id,
                documentId: doc.id,
                versionId: latestVersion.id,
                approvedNotes,
                protectItems,
                deliverableType: currentDoc,
                developmentBehavior: behavior,
                format,
                episode_target_duration_seconds: episodeDuration,
                season_episode_count: seasonEpisodeCount,
              }, token, job.project_id, format, currentDoc, jobId, newStep + 2
            );

            // Re-fetch latest version after rewrite to track new versionId
            const { data: postRewriteVersions } = await supabase.from("project_document_versions")
              .select("id, version_number")
              .eq("document_id", doc.id)
              .order("version_number", { ascending: false }).limit(1);
            const newVersionId = postRewriteVersions?.[0]?.id || rewriteResult?.result?.newVersion?.id || "unknown";

            // D) After rewrite, update job to use new version for next cycle
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              step_count: newStep + 2,
              follow_latest: true,
              resume_document_id: doc.id,
              resume_version_id: newVersionId !== "unknown" ? newVersionId : null,
            });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "rewrite", `Applied rewrite (loop ${newLoopCount}/${job.max_stage_loops})`);
            await logStep(supabase, jobId, newStep + 3, currentDoc, "rewrite_output_ref",
              `Rewrite created new versionId=${newVersionId}`,
              {}, undefined, { docId: doc.id, newVersionId, advanced_to_new_version: true }
            );
            return respondWithJob(supabase, jobId, "run-next");
          } catch (e: any) {
            await updateJob(supabase, jobId, { status: "failed", error: `Rewrite failed: ${e.message}` });
            return respondWithJob(supabase, jobId);
          }
        }

        // ── PROMOTE ──
        if (promo.recommendation === "promote") {
          const modeConf = MODE_CONFIG[job.mode] || MODE_CONFIG.balanced;
          if (modeConf.require_readiness && promo.readiness_score < modeConf.require_readiness) {
            await updateJob(supabase, jobId, { stage_loop_count: stageLoopCount + 1, step_count: newStep + 1 });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "stabilise", `Readiness ${promo.readiness_score} < ${modeConf.require_readiness} (premium threshold)`);
            return respondWithJob(supabase, jobId, "run-next");
          }

          const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
          if (next && ladderIndexOf(next, format) <= ladderIndexOf(job.target_document, format)) {
            // ── APPROVAL GATE: pause before promoting to next stage ──
            await logStep(supabase, jobId, newStep + 2, currentDoc, "approval_required",
              `Promote recommended: ${currentDoc} → ${next}. Review before advancing.`,
              { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence },
              undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
            );
            await updateJob(supabase, jobId, {
              step_count: newStep + 2, status: "paused",
              stop_reason: `Approval required: review ${currentDoc} before promoting to ${next}`,
              awaiting_approval: true, approval_type: "promote",
              pending_doc_id: doc.id, pending_version_id: latestVersion.id,
              pending_doc_type: currentDoc, pending_next_doc_type: next,
            });
            return respondWithJob(supabase, jobId, "awaiting-approval");
          } else {
            await updateJob(supabase, jobId, { status: "completed", stop_reason: "All stages satisfied up to target" });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "All stages satisfied up to target");
            return respondWithJob(supabase, jobId);
          }
        }
      } catch (e: any) {
        await updateJob(supabase, jobId, { status: "failed", error: `Step failed: ${e.message}` });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", `Error: ${e.message}`);
        return respondWithJob(supabase, jobId);
      }

      return respondWithJob(supabase, jobId);
    }

    return respond({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    return respond({ error: e.message || "Internal error" }, 500);
  }
});

// ── Response Helpers ──

function respond(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function respondWithJob(supabase: any, jobId: string, hint?: string): Promise<Response> {
  const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
  const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", jobId).order("step_index", { ascending: false }).limit(10);
  return respond({
    job,
    latest_steps: (steps || []).reverse(),
    next_action_hint: hint || getHint(job),
  });
}

function getHint(job: any): string {
  if (!job) return "none";
  if (job.awaiting_approval) return "awaiting-approval";
  if (job.status === "running") return "run-next";
  if (job.status === "paused") {
    if (job.pending_decisions && Array.isArray(job.pending_decisions) && job.pending_decisions.length > 0) {
      return "approve-decision";
    }
    return "resume";
  }
  if (job.status === "completed") return "none";
  if (job.status === "stopped") return "none";
  if (job.status === "failed") return "none";
  return "run-next";
}
