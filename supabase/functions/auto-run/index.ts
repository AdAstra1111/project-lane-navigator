const BUILD = "AUTORUN_BUILD_MARKER_2026_03_07_TRANSITION_LEDGER_V1";
type DocStage = string;
// CI is the primary quality signal — always weighted 2x over GP
const CI_WEIGHT = 2;
const GP_WEIGHT = 1;
function compositeScore(ci: number, gp: number): number { return ci * CI_WEIGHT + gp * GP_WEIGHT; }
import { emitTransition, TRANSITION_EVENTS } from "../_shared/transitionLedger.ts";
import { spineToPromptBlock } from "../_shared/narrativeSpine.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCPMEnabled, buildCPRepairDirections, CPM_GENERATION_PROMPT_BLOCK, logCPM } from "../_shared/characterPressureMatrix.ts";
import { isLargeRiskDocType } from "../_shared/largeRiskRouter.ts";
import { isDurationEligibleDocType, isDeprecatedTargetDocType } from "../_shared/eligibilityRegistry.ts";
import { getWritingLaneGroup, getDefaultWritingVoiceForLane } from "../_shared/writingVoiceResolver.ts";
import { ensureDocSlot, createVersion } from "../_shared/doc-os.ts";
import { runPendingDecisionGate, checkQualityPlateau } from "../_shared/pendingDecisionGate.ts";
import { isAggregate, getRegressionThreshold, getExploreThreshold, getMaxFrontierAttempts, requireDocPolicy, validateLadderIntegrity, runCanonAlignmentGate, buildCanonEntitiesFromDB } from "../_shared/docPolicyRegistry.ts";
import {
  isCIBlockerGateEnabled, isPlateauV2Enabled, isRewriteTargetingEnabled,
  parseLatestReviewForActiveVersion, evaluateCIBlockerGateFromPayload,
  checkPlateauV2, compileRewriteDirectives, formatDirectivesAsDirections,
} from "../_shared/ciBlockerGate.ts";
import {
  DEFAULT_MAX_TOTAL_STEPS,
  DEFAULT_MAX_STAGE_LOOPS,
  MAX_TOTAL_ATTEMPTS_PER_TARGET,
  getAttemptStrategy,
  selectNotesForStrategy,
  getForkDirections,
  type AttemptStrategy,
} from "../_shared/convergencePolicy.ts";

// ── Unified score extraction helper ──
// dev-engine-v2 "analyze" returns { run, analysis: { ci_score, gp_score, ... } }
// callEdgeFunctionWithRetry wraps that as { result: { run, analysis }, retried }
// This helper must handle all nesting levels and both ci/ci_score naming conventions.
function extractCiGp(res: any): { ci: number | null; gp: number | null } {
  // Unwrap { result, retried } wrapper from callEdgeFunctionWithRetry
  const inner = res?.result !== undefined ? res.result : res;
  // Unwrap { analysis } wrapper from dev-engine-v2 analyze response
  const analysis = inner?.analysis || inner;
  // Try ci_score first (dev-engine-v2 naming), then ci (legacy/direct)
  const ciRaw = analysis?.ci_score ?? analysis?.scores?.ci_score ?? analysis?.scores?.ci ?? analysis?.ci
    ?? inner?.ci_score ?? inner?.ci ?? res?.ci_score ?? res?.ci ?? null;
  const gpRaw = analysis?.gp_score ?? analysis?.scores?.gp_score ?? analysis?.scores?.gp ?? analysis?.gp
    ?? inner?.gp_score ?? inner?.gp ?? res?.gp_score ?? res?.gp ?? null;
  return { ci: typeof ciRaw === "number" ? ciRaw : null, gp: typeof gpRaw === "number" ? gpRaw : null };
}

const SCORE_DOWNGRADE_TOLERANCE = 0;

function toNumericScore(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseVersionScores(metaJson: any): { ci: number | null; gp: number | null; scoreSource: string | null } {
  const meta = metaJson && typeof metaJson === "object" && !Array.isArray(metaJson) ? metaJson : {};
  return {
    ci: toNumericScore(meta?.ci),
    gp: toNumericScore(meta?.gp),
    scoreSource: typeof meta?.score_source === "string" ? meta.score_source : null,
  };
}

function pickBestScoredVersion<T extends { ci: number; gp: number; version_number: number; blockerCount?: number }>(rows: T[]): T | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => {
    const aComposite = compositeScore(a.ci, a.gp);
    const bComposite = compositeScore(b.ci, b.gp);
    if (bComposite !== aComposite) return bComposite - aComposite;
    if (b.ci !== a.ci) return b.ci - a.ci;
    if (b.gp !== a.gp) return b.gp - a.gp;
    return b.version_number - a.version_number;
  });
  return sorted[0];
}

async function getVersionScoreSnapshot(supabase: any, versionId: string): Promise<{ ci: number | null; gp: number | null; scoreSource: string | null; meta: any }> {
  const { data, error } = await supabase
    .from("project_document_versions")
    .select("meta_json")
    .eq("id", versionId)
    .maybeSingle();

  if (error || !data) {
    return { ci: null, gp: null, scoreSource: null, meta: null };
  }

  const parsed = parseVersionScores(data.meta_json);
  return { ci: parsed.ci, gp: parsed.gp, scoreSource: parsed.scoreSource, meta: data.meta_json || {} };
}

async function persistVersionScores(
  supabase: any,
  params: {
    versionId: string;
    ci: number;
    gp: number;
    source: string;
    jobId: string;
    protectHigher?: boolean;
    docType?: string;
  },
): Promise<{ ci: number; gp: number; scoreSource: string; downgradedBlocked: boolean }> {
  const { versionId, ci, gp, source, jobId, protectHigher = true, docType } = params;

  const { data: existingRow, error: existingErr } = await supabase
    .from("project_document_versions")
    .select("meta_json")
    .eq("id", versionId)
    .maybeSingle();

  if (existingErr || !existingRow) {
    throw new Error(`VERSION_SCORE_READ_FAILED: ${existingErr?.message || `version ${versionId} not found`}`);
  }

  const existingMeta = existingRow.meta_json && typeof existingRow.meta_json === "object" && !Array.isArray(existingRow.meta_json)
    ? existingRow.meta_json
    : {};
  const existingScores = parseVersionScores(existingMeta);

  let effectiveCi = ci;
  let effectiveGp = gp;
  let downgradedBlocked = false;

  if (protectHigher && existingScores.ci !== null && existingScores.gp !== null) {
    const existingComposite = compositeScore(existingScores.ci, existingScores.gp);
    const incomingComposite = compositeScore(ci, gp);
    if (existingComposite - incomingComposite > SCORE_DOWNGRADE_TOLERANCE) {
      downgradedBlocked = true;
      effectiveCi = existingScores.ci;
      effectiveGp = existingScores.gp;
      console.warn(`[auto-run][IEL] score_conflict_preserved_higher { job_id: "${jobId}", doc_type: "${docType || 'unknown'}", version_id: "${versionId}", incoming_ci: ${ci}, incoming_gp: ${gp}, existing_ci: ${existingScores.ci}, existing_gp: ${existingScores.gp}, incoming_source: "${source}", existing_source: "${existingScores.scoreSource || 'unknown'}", policy: "preserve_higher" }`);
    }
  }

  const mergedMeta = {
    ...existingMeta,
    ci: effectiveCi,
    gp: effectiveGp,
    score_source: source,
    score_updated_at: new Date().toISOString(),
    score_job_id: jobId,
  };

  const { error: updateErr } = await supabase
    .from("project_document_versions")
    .update({ meta_json: mergedMeta })
    .eq("id", versionId);

  if (updateErr) {
    throw new Error(`VERSION_SCORE_WRITE_FAILED: ${updateErr.message}`);
  }

  // ── TRANSITION LEDGER: ci_gp_scores_computed ──
  try {
    const { data: verDoc } = await supabase
      .from("project_document_versions")
      .select("document_id, project_documents!inner(project_id)")
      .eq("id", versionId)
      .maybeSingle();
    const projId = (verDoc as any)?.project_documents?.project_id;
    if (projId) {
      await emitTransition(supabase, {
        projectId: projId,
        eventType: TRANSITION_EVENTS.CI_GP_SCORES_COMPUTED,
        docType: docType || undefined,
        jobId,
        resultingVersionId: versionId,
        ci: effectiveCi,
        gp: effectiveGp,
        trigger: source,
        sourceOfTruth: "persistVersionScores",
        resultingState: { ci: effectiveCi, gp: effectiveGp, downgraded_blocked: downgradedBlocked, score_source: source },
      }, { critical: false });
    }
  } catch (e: any) {
    console.warn(`[auto-run][transition-ledger] scoring emit failed: ${e?.message}`);
  }

  return {
    ci: effectiveCi,
    gp: effectiveGp,
    scoreSource: source,
    downgradedBlocked,
  };
}

// ── Get current accepted version for a document (fail-closed) ──
async function getCurrentVersionForDoc(supabase: any, documentId: string): Promise<{ id: string; plaintext: string | null } | null> {
  const { data } = await supabase
    .from("project_document_versions")
    .select("id, plaintext")
    .eq("document_id", documentId)
    .eq("is_current", true)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// ── PATCH 5: Completion gate — runs before any status="completed" ──
// Returns null if gates pass, or { stop_reason, details } if they fail.
async function completionGate(
  supabase: any,
  projectId: string,
  targetDocument: string,
  format: string,
): Promise<{ stop_reason: string; details: string } | null> {
  // Gate 1: Ladder integrity
  // getLadderForJob is defined in this same file
  const ladder = getLadderForJob(format);
  if (ladder) {
    const ladderCheck = validateLadderIntegrity(ladder);
    if (!ladderCheck.valid) {
      return {
        stop_reason: "LADDER_REGISTRY_MISMATCH",
        details: `Ladder contains unregistered doc_types: ${ladderCheck.missing.join(", ")}`,
      };
    }
  }

  // Gate 2: Target deliverable existence — doc + version + non-empty content
  {
    const { data: targetDoc } = await supabase
      .from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", targetDocument)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!targetDoc) {
      console.error(`[auto-run][IEL] target_missing_fail_closed { project_id: "${projectId}", target_doc_type: "${targetDocument}", has_doc: false, has_version: false, content_len: 0 }`);
      return {
        stop_reason: "TARGET_DELIVERABLE_MISSING",
        details: `Target document '${targetDocument}' does not exist in project_documents. Cannot declare completion without a persisted deliverable.`,
      };
    }

    const currentVer = await getCurrentVersionForDoc(supabase, targetDoc.id);
    const contentLen = currentVer?.plaintext?.length || 0;

    if (!currentVer || contentLen === 0) {
      console.error(`[auto-run][IEL] target_missing_fail_closed { project_id: "${projectId}", target_doc_type: "${targetDocument}", has_doc: true, has_version: ${!!currentVer}, content_len: ${contentLen} }`);
      return {
        stop_reason: "TARGET_DELIVERABLE_MISSING",
        details: `Target document '${targetDocument}' exists but has no version with content (content_len=${contentLen}). Cannot declare completion without persisted content.`,
      };
    }

    // Gate 3: Canon alignment for target document
    // Skip when allow_defaults=true (autonomous mode) — manually-seeded canon may be sparse
    const { data: _jobRow } = await supabase.from("auto_run_jobs")
      .select("allow_defaults, pinned_inputs").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const _skipCanon = _jobRow?.allow_defaults === true || _jobRow?.pinned_inputs?.skip_canon_alignment === true;
    if (!_skipCanon && currentVer.plaintext) {
      const alignment = await runCanonAlignmentGate(supabase, projectId, currentVer.plaintext);
      if (alignment && !alignment.pass) {
        return {
          stop_reason: "CANON_MISMATCH",
          details: `Canon alignment failed for ${targetDocument}: coverage=${alignment.result.entityCoverage}, missing=${alignment.result.missingEntities.slice(0, 5).join(",")}, foreign=${alignment.result.foreignEntities.slice(0, 5).join(",")}. Sources: ${alignment.sources.join(",")}`,
        };
      }
    }
  }

  return null; // All gates pass
}

function waitUntilSafe(p: Promise<any>): boolean {
  try {
    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(p);
      return true;
    }
  } catch {}
  return false;
}

// Dynamic CORS: echo request origin to support credentials
let _currentReqOrigin = "*";
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": _currentReqOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, prefer, accept, origin, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Max-Age": "86400",
  };
}
// Backwards-compat: corsHeaders used throughout file as a plain object
const corsHeaders = new Proxy({}, { get(_t, prop) { return getCorsHeaders()[prop as keyof ReturnType<typeof getCorsHeaders>]; }, ownKeys() { return Object.keys(getCorsHeaders()); }, getOwnPropertyDescriptor(_t, prop) { const h = getCorsHeaders(); if (prop in h) return { configurable: true, enumerable: true, value: h[prop as keyof typeof h] }; return undefined; }, has(_t, prop) { return prop in getCorsHeaders(); } }) as Record<string, string>;

// ── Document Ladders ──────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH: supabase/functions/_shared/stage-ladders.ts
// Static import — no top-level await, no fetch, no file I/O.
import { STAGE_LADDERS } from "../_shared/stage-ladders.ts";
import { DOC_TYPE_REGISTRY } from "../_shared/doc-os.ts";

const FORMAT_LADDERS: Record<string, string[]> = STAGE_LADDERS.FORMAT_LADDERS;
const DOC_TYPE_ALIASES: Record<string, string> = STAGE_LADDERS.DOC_TYPE_ALIASES;

// ── DRIFT GUARD: Fail fast if any ladder stage is not in DOC_TYPE_REGISTRY ──
// This runs once at module load time — prevents silent runtime crashes.
{
  const registryKeys = new Set(Object.keys(DOC_TYPE_REGISTRY));
  const allLadderTypes = new Set<string>(Object.values(FORMAT_LADDERS).flat());
  const missing = [...allLadderTypes].filter(dt => !registryKeys.has(dt));
  if (missing.length > 0) {
    const msg = `[DRIFT GUARD FATAL] Ladder references ${missing.length} doc type(s) missing from DOC_TYPE_REGISTRY: ${missing.join(", ")}. Fix doc-os.ts before deploying.`;
    console.error(msg);
    throw new Error(msg);
  }
}

// Flat unique set of all stages (for validation)
const ALL_STAGES = new Set<string>(Object.values(FORMAT_LADDERS).flat());

// ── STAGE-SCOPED BEST: derived from auto_run_steps, NOT from job.best_* ──
// job.best_* remains GLOBAL BEST across job lifetime (informational only).
// Stage-local comparisons use getStageBestFromSteps() which queries auto_run_steps.
// getStageBestFromDB() provides cross-job fallback from project_document_versions.meta_json.

// Helper: get stage-scoped best from project_document_versions.meta_json (cross-job, persistent)
async function getStageBestFromDB(
  supabase: any, projectId: string, docType: string,
): Promise<{ version_id: string; ci: number; gp: number; score: number } | null> {
  const { data: doc } = await supabase
    .from("project_documents").select("id")
    .eq("project_id", projectId).eq("doc_type", docType)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!doc) return null;

  const { data: versions } = await supabase
    .from("project_document_versions")
    .select("id, meta_json, version_number, approval_status, is_current")
    .eq("document_id", doc.id)
    .order("version_number", { ascending: false });
  if (!versions || versions.length === 0) return null;

  const scored = versions
    .map((v: any) => {
      const p = parseVersionScores(v.meta_json);
      return { version_id: v.id, ci: p.ci ?? 0, gp: p.gp ?? 0, score: compositeScore(p.ci ?? 0, p.gp ?? 0), approval_status: v.approval_status };
    })
    .filter((v: any) => v.ci > 0 || v.gp > 0)
    .sort((a: any, b: any) => b.score - a.score);

  if (scored.length === 0) return null;
  const best = scored.find((v: any) => v.approval_status === "approved") || scored[0];
  console.log(`[auto-run][IEL] stage_best_from_db { project_id: "${projectId}", doc_type: "${docType}", version_id: "${best.version_id}", ci: ${best.ci}, gp: ${best.gp} }`);
  return best;
}

// Helper: get stage-scoped best from auto_run_steps for a given doc_type
async function getStageBestFromSteps(supabase: any, jobId: string, docType: string, projectId: string | null = null): Promise<{
  version_id: string; ci: number; gp: number; gap: number | null; score: number;
  step_index: number; versions_considered: number; version_id_source: string;
} | null> {
  // ── IEL: Include both 'review' AND 'rewrite_accepted' steps as CI data points ──
  // This ensures promoted candidates' scores are visible to stage-best resolution,
  // matching what the UI displays via job.last_ci/last_gp.
  const CI_SCORED_ACTIONS = ["review", "rewrite_accepted"];
  const { data: reviewSteps } = await supabase
    .from("auto_run_steps")
    .select("step_index, ci, gp, gap, output_ref, action")
    .eq("job_id", jobId)
    .eq("document", docType)
    .in("action", CI_SCORED_ACTIONS)
    .not("ci", "is", null)
    .order("step_index", { ascending: false })
    .limit(200);

  if (!reviewSteps || reviewSteps.length === 0) {
    if (projectId) {
      const dbBest = await getStageBestFromDB(supabase, projectId, docType);
      if (dbBest) {
        console.log(`[auto-run][IEL] stage_best_db_fallback { job_id: "${jobId}", doc_type: "${docType}", ci: ${dbBest.ci}, gp: ${dbBest.gp} }`);
        return { version_id: dbBest.version_id, ci: dbBest.ci, gp: dbBest.gp, gap: null, score: dbBest.score, step_index: -1, versions_considered: 1, version_id_source: "meta_json_fallback" };
      }
    }
    console.log(`[auto-run][IEL] stage_best_missing { job_id: "${jobId}", doc_type: "${docType}", reason: "no_scored_reviews" }`);
    return null;
  }

  // Resolve version_id from output_ref with priority
  function resolveVersionId(step: any): { id: string; source: string } | null {
    const ref = step.output_ref;
    if (ref?.output_version_id) return { id: ref.output_version_id, source: "output_version_id" };
    if (ref?.version_id) return { id: ref.version_id, source: "version_id" };
    if (ref?.input_version_id) return { id: ref.input_version_id, source: "input_version_id" };
    return null;
  }

  // Latest-per-version grouping: keep highest step_index per version
  const byVersion = new Map<string, any>();
  for (const step of reviewSteps) {
    const resolved = resolveVersionId(step);
    if (!resolved) continue;
    if (!byVersion.has(resolved.id) || step.step_index > byVersion.get(resolved.id).step_index) {
      byVersion.set(resolved.id, { ...step, _vid: resolved.id, _vsource: resolved.source });
    }
  }

  if (byVersion.size === 0) {
    console.log(`[auto-run][IEL] stage_best_missing { job_id: "${jobId}", doc_type: "${docType}", reason: "no_resolvable_versions" }`);
    return null;
  }

  // Find best: score = ci + gp, tie-break by step_index (newest)
  let best: any = null;
  for (const entry of byVersion.values()) {
    const score = (entry.ci ?? 0) + (entry.gp ?? 0);
    if (!best || score > best._score || (score === best._score && entry.step_index > best.step_index)) {
      best = { ...entry, _score: score };
    }
  }

  const result = {
    version_id: best._vid,
    ci: best.ci ?? 0,
    gp: best.gp ?? 0,
    gap: best.gap ?? null,
    score: best._score,
    step_index: best.step_index,
    versions_considered: byVersion.size,
    version_id_source: best._vsource,
  };

  // ── IEL: Merge with DB-persisted scores so we never return lower than what's stored ──
  if (projectId) {
    const dbBest = await getStageBestFromDB(supabase, projectId, docType);
    if (dbBest && dbBest.score > result.score) {
      console.log(`[auto-run][IEL] stage_best_db_upgrade { job_id: "${jobId}", doc_type: "${docType}", step_log_ci: ${result.ci}, db_ci: ${dbBest.ci} }`);
      return { version_id: dbBest.version_id, ci: dbBest.ci, gp: dbBest.gp, gap: null, score: dbBest.score, step_index: result.step_index, versions_considered: result.versions_considered + 1, version_id_source: "meta_json_merged" };
    }
  }

  console.log(`[auto-run][IEL] stage_best_resolved { job_id: "${jobId}", doc_type: "${docType}", version_id: "${result.version_id}", ci: ${result.ci}, gp: ${result.gp}, score_formula: "CI+GP", versions_considered: ${result.versions_considered}, version_id_source: "${result.version_id_source}" }`);
  return result;
}

// ── PREREQUISITE QUALITY GATES ──
// Stages that require upstream quality thresholds before they can begin.
// Key: the BLOCKED stage. Value: { prerequisite: the stage that must meet the threshold, thresholds }.
const PREREQUISITE_GATES: Record<string, { prerequisite: string; ci: number; gp: number; composite: number }> = {
  vertical_episode_beats: { prerequisite: "episode_grid", ci: 80, gp: 80, composite: 170 },
  season_script:          { prerequisite: "vertical_episode_beats", ci: 85, gp: 85, composite: 178 },
};

type PrereqGateResult = {
  blocked: boolean;
  prerequisiteStage: string;
  ci: number;
  gp: number;
  composite: number;
  requiredComposite: number;
};

async function checkPrerequisiteGate(
  supabase: any, jobId: string, currentDoc: string, format: string, job: any,
): Promise<PrereqGateResult & { blocked: boolean }> {
  const NOT_BLOCKED: PrereqGateResult & { blocked: false } = {
    blocked: false, prerequisiteStage: "", ci: 0, gp: 0, composite: 0, requiredComposite: 0,
  };

  // Only apply to vertical-drama format
  if (!format.includes("vertical")) return NOT_BLOCKED;

  const gate = PREREQUISITE_GATES[currentDoc];
  if (!gate) return NOT_BLOCKED;

  // Check if the prerequisite stage has been reviewed in this job
  const stageBest = await getStageBestFromSteps(supabase, jobId, gate.prerequisite, job?.project_id ?? null);

  if (!stageBest) {
    // No reviews for prerequisite — block and redirect
    console.log(`[auto-run][IEL] prereq_gate_no_reviews { job_id: "${jobId}", stage: "${currentDoc}", prerequisite: "${gate.prerequisite}" }`);
    return {
      blocked: true,
      prerequisiteStage: gate.prerequisite,
      ci: 0, gp: 0, composite: 0,
      requiredComposite: gate.composite,
    };
  }

  const composite = stageBest.ci + stageBest.gp;
  if (composite < gate.composite || stageBest.ci < gate.ci || stageBest.gp < gate.gp) {
    return {
      blocked: true,
      prerequisiteStage: gate.prerequisite,
      ci: stageBest.ci,
      gp: stageBest.gp,
      composite,
      requiredComposite: gate.composite,
    };
  }

  console.log(`[auto-run][IEL] prereq_gate_passed { job_id: "${jobId}", stage: "${currentDoc}", prerequisite: "${gate.prerequisite}", ci: ${stageBest.ci}, gp: ${stageBest.gp}, composite: ${composite}, required: ${gate.composite} }`);
  return NOT_BLOCKED;
}

// ── Reusable prereq gate enforcer for any transition into a target stage ──
// Returns true if blocked (caller must NOT advance). Handles logging + redirect.
async function enforcePrereqGateBeforeAdvance(
  supabase: any, jobId: string, targetStage: string, format: string, job: any,
  stepCount: number, currentDoc: string, trigger: string,
): Promise<boolean> {
  const prereq = await checkPrerequisiteGate(supabase, jobId, targetStage, format, job);
  if (!prereq.blocked) return false;

  const gate = PREREQUISITE_GATES[targetStage];
  console.error(`[auto-run][IEL] prereq_gate_blocked { job_id: "${jobId}", stage: "${targetStage}", prerequisite_stage: "${prereq.prerequisiteStage}", ci: ${prereq.ci}, gp: ${prereq.gp}, composite: ${prereq.composite}, required_ci: ${gate?.ci ?? 0}, required_gp: ${gate?.gp ?? 0}, required_composite: ${prereq.requiredComposite}, trigger: "${trigger}", result: "blocked" }`);

  await logStep(supabase, jobId, stepCount + 1, targetStage, "prereq_gate_blocked",
    `Advance to "${targetStage}" blocked (trigger: ${trigger}): prerequisite "${prereq.prerequisiteStage}" composite ${prereq.composite} < required ${prereq.requiredComposite}. Redirecting to ${prereq.prerequisiteStage}.`,
    { ci: prereq.ci, gp: prereq.gp }, undefined,
    { prerequisite_stage: prereq.prerequisiteStage, composite: prereq.composite, required_ci: gate?.ci, required_gp: gate?.gp, required_composite: prereq.requiredComposite, trigger });

  await logStep(supabase, jobId, stepCount + 2, prereq.prerequisiteStage, "prereq_block_redirect",
    `Redirected from "${targetStage}" to prerequisite "${prereq.prerequisiteStage}" due to quality gate (trigger: ${trigger}).`,
    {}, undefined, { from: targetStage, to: prereq.prerequisiteStage, trigger });

  console.log(`[auto-run][IEL] prereq_gate_redirect_applied { job_id: "${jobId}", from: "${targetStage}", to: "${prereq.prerequisiteStage}", trigger: "${trigger}" }`);

  await updateJob(supabase, jobId, {
    current_document: prereq.prerequisiteStage,
    stage_loop_count: 0,
    step_count: stepCount + 2,
    stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
    frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
    last_ui_message: `Redirected to ${prereq.prerequisiteStage}: composite ${prereq.composite} below required ${prereq.requiredComposite} for ${targetStage}.`,
  });

  return true; // blocked
}

// ── GLOBAL CI GATE: No promotion / prereq pass unless CI >= target ──
const GLOBAL_MIN_CI = 90; // raised from 85 — each stage must fully converge before promotion
const CI_PLATEAU_WINDOW = 5;   // raised from 2 — require 5 consecutive non-improving ticks before plateau
const CI_MIN_DELTA = 1;        // minimum CI improvement to count as progress

/**
 * Per-doc-type gate overrides.
 *
 * Market-facing and structural docs are NOT narrative-craft documents — grading them
 * on CI (Creative Integrity) is like marking a financial model on its prose style.
 * GP (Green Potential / commercial viability) is the meaningful metric for these types.
 *
 * - market_sheet / vertical_market_sheet: CI lowered to 50, GP required at 72.
 *   These docs are graded on market positioning, comp accuracy, audience targeting.
 * - format_rules: CI lowered to 55, GP required at 65.
 *   Graded on production feasibility and format compliance.
 *
 * All other doc types use the job-level converge_target_json / GLOBAL_MIN_CI.
 */
const DOC_TYPE_GATE_OVERRIDES: Record<string, { ci: number; gp: number }> = {
  market_sheet:          { ci: 50, gp: 72 },
  vertical_market_sheet: { ci: 50, gp: 72 },
  format_rules:          { ci: 55, gp: 65 },
  // Episode grid: structural document — completeness + uniqueness + arc coverage.
  episode_grid:          { ci: 70, gp: 75 },
  // Episode beats: structural document — beat density, typed beats, hook/cliffhanger per episode.
  // CI:72/GP:76: a complete beats doc with correct structure passes. CI:95+ causes thrash.
  vertical_episode_beats: { ci: 72, gp: 76 },
  episode_beats:          { ci: 72, gp: 76 },
};

/** Returns the effective CI+GP gate thresholds for a given doc type and job. */
function resolveDocTypeGates(job: any, docType: string): { ci: number; gp: number } {
  if (DOC_TYPE_GATE_OVERRIDES[docType]) return DOC_TYPE_GATE_OVERRIDES[docType];
  return { ci: resolveTargetCI(job), gp: 0 }; // default: CI-only gate
}
// ── Cost optimisation: max iterations per stage ──
// If a stage has been reviewed this many times without hitting target, force-promote
// the best version rather than burning more Pro ANALYZE tokens. A stage that can't
// converge in MAX_STAGE_ITERATIONS is structurally stuck, not iteratively improvable.
const MAX_STAGE_ITERATIONS = 5;
// NOTE: Promotion is blocked only by blocker + high severity notes. Polish notes do not block.

/**
 * Resolve the effective CI target for a job.
 * Reads converge_target_json.ci from the job; falls back to 100 (aspirational).
 * NOTE: This is the *aspiration* target the rewrite loop drives toward.
 * GLOBAL_MIN_CI (85) is the separate force-promote floor used only when
 * genuinely stuck (plateau + notes exhausted).
 */
function resolveTargetCI(job: any): number {
  const ct = job?.converge_target_json;
  if (ct !== null && ct !== undefined && typeof ct === "object") {
    const ci = Number(ct.ci); // coerce string "81" to number 81
    if (!isNaN(ci) && ci >= 0 && ci <= 100) return ci;
  }
  return 90; // default 90, not 100 — requiring 100 is unrealistic and causes infinite loops
}

/**
 * Evaluate promotion gate for stage advancement.
 *
 * For most doc types: CI-only gate using job converge_target_json / GLOBAL_MIN_CI.
 * For commercially-oriented docs (market_sheet, format_rules, etc.): applies
 * DOC_TYPE_GATE_OVERRIDES — lower CI floor + explicit GP minimum, so these
 * docs are judged on commercial viability rather than narrative craft.
 *
 * Returns { pass, ci, gp, bestCiSoFar, failReason }.
 */
async function evaluateCIGate(
  supabase: any, jobId: string, docType: string, targetCi: number = GLOBAL_MIN_CI,
  projectId: string | null = null,
  job?: any,
): Promise<{ pass: boolean; ci: number; gp: number; bestCiSoFar: number; failReason?: string }> {
  const stageBest = await getStageBestFromSteps(supabase, jobId, docType, projectId);
  const ci = stageBest?.ci ?? 0;
  const gp = stageBest?.gp ?? 0;

  // Check for doc-type-specific overrides (e.g. market_sheet, format_rules)
  const override = DOC_TYPE_GATE_OVERRIDES[docType];
  if (override) {
    const ciPass = ci >= override.ci;
    const gpPass = gp >= override.gp;
    const pass = ciPass && gpPass;
    const failReason = !ciPass && !gpPass
      ? `CI ${ci} < ${override.ci} and GP ${gp} < ${override.gp}`
      : !ciPass ? `CI ${ci} < ${override.ci}`
      : `GP ${gp} < ${override.gp}`;
    console.log(`[auto-run][IEL] doc_type_gate_eval { doc_type: "${docType}", ci: ${ci}, gp: ${gp}, required_ci: ${override.ci}, required_gp: ${override.gp}, pass: ${pass} }`);
    return { pass, ci, gp, bestCiSoFar: ci, failReason: pass ? undefined : failReason };
  }

  // Default: CI-only gate
  return { pass: ci >= targetCi, ci, gp, bestCiSoFar: ci };
}

/**
 * Check monotonic CI improvement for the current stage.
 * Returns: { improving, plateau, plateauCount, bestCi, currentCi }.
 * Reads from auto_run_steps (action=review) for the doc_type, ordered by step_index desc.
 * Falls back to DB-persisted meta_json scores when step log is insufficient.
 */
async function checkMonotonicCIImprovement(
  supabase: any, jobId: string, docType: string, targetCi: number = GLOBAL_MIN_CI,
  projectId: string | null = null,
): Promise<{ improving: boolean; plateau: boolean; plateauCount: number; bestCi: number; currentCi: number }> {
  // ── IEL: Include both 'review' AND 'rewrite_accepted' steps as CI data points ──
  // This ensures promoted candidates' scores are visible to the plateau gate,
  // matching what the UI displays via job.last_ci/last_gp.
  const CI_SCORED_ACTIONS = ["review", "rewrite_accepted"];
  const { data: recentReviews } = await supabase
    .from("auto_run_steps")
    .select("ci, step_index, action")
    .eq("job_id", jobId)
    .eq("document", docType)
    .in("action", CI_SCORED_ACTIONS)
    .not("ci", "is", null)
    .order("step_index", { ascending: false })
    .limit(CI_PLATEAU_WINDOW + 2);

  console.log(`[auto-run][IEL] monotonic_ci_source { job_id: "${jobId}", doc_type: "${docType}", steps_found: ${recentReviews?.length ?? 0}, actions_queried: ${JSON.stringify(CI_SCORED_ACTIONS)}, latest_ci: ${recentReviews?.[0]?.ci ?? 'null'}, latest_action: "${recentReviews?.[0]?.action ?? 'none'}", latest_step_index: ${recentReviews?.[0]?.step_index ?? 'null'} }`);

  if (!recentReviews || recentReviews.length < 2) {
    // Not enough step data — check DB-persisted scores as fallback
    if (projectId) {
      const dbBest = await getStageBestFromDB(supabase, projectId, docType);
      if (dbBest && dbBest.ci >= targetCi) {
        return { improving: true, plateau: false, plateauCount: 0, bestCi: dbBest.ci, currentCi: dbBest.ci };
      }
    }
    // Not enough data — allow continuation
    return { improving: true, plateau: false, plateauCount: 0, bestCi: recentReviews?.[0]?.ci ?? 0, currentCi: recentReviews?.[0]?.ci ?? 0 };
  }

  const currentCi = recentReviews[0].ci;
  const allCIs = recentReviews.map((r: any) => r.ci);
  const bestCi = Math.max(...allCIs);

  // Check if current CI is an improvement over all previous
  const previousBest = Math.max(...allCIs.slice(1));
  const improving = currentCi >= previousBest + CI_MIN_DELTA;

  // Count consecutive non-improving ticks from the front
  let plateauCount = 0;
  for (let i = 0; i < allCIs.length - 1; i++) {
    const laterBest = Math.max(...allCIs.slice(i + 1));
    if (allCIs[i] < laterBest + CI_MIN_DELTA) {
      plateauCount++;
    } else {
      break;
    }
  }

  // ── IEL: Use bestCi (not currentCi) for plateau threshold ──
  // If best CI already meets target, no plateau — even if current regressed.
  return {
    improving,
    plateau: plateauCount >= CI_PLATEAU_WINDOW && bestCi < targetCi,
    plateauCount,
    bestCi,
    currentCi,
  };
}

// ── IEL: ABVR — Active Best Version Resolution ──
// Deterministic resolver: picks the version Auto-Run must treat as current baseline.
// Resolution rules (strict order):
//   A) Authoritative approved+current version (always wins)
//   B) If resume_version_id present AND follow_latest is false → use it (pinned) when still valid
//   C) Else → highest-scoring eligible version (approval_status=approved OR is_current=true) from DB-persisted meta_json.ci/gp
//   D) Fallback → best approved by version_number, then is_current, then latest by version_number
async function resolveActiveVersionForDoc(
  supabase: any,
  job: any,
  documentId: string,
  ctx?: { jobId?: string; docType?: string },
): Promise<{ versionId: string; source: "pinned" | "eligible_best_score" | "best_approved" | "is_current" | "latest_version_number"; reason: string } | null> {
  const { data: versions, error: versionsErr } = await supabase
    .from("project_document_versions")
    .select("id, version_number, approval_status, is_current, created_by, meta_json, approved_at")
    .eq("document_id", documentId)
    .order("version_number", { ascending: false });

  if (versionsErr) {
    console.error(`[auto-run][IEL] abvr_versions_query_failed { document_id: "${documentId}", error: "${versionsErr.message}" }`);
    return null;
  }

  const allVersions = versions || [];
  if (!allVersions.length) {
    console.log(`[auto-run][IEL] abvr_active_version_selected { document_id: "${documentId}", selected_version_id: null, reason: "no_versions" }`);
    return null;
  }

  // A) APPROVED-FIRST RESOLUTION (hard invariant)
  // If any approved version exists, Auto-Run must bind to approved lineage only.
  const approvedVersions = allVersions.filter((v: any) => v.approval_status === "approved");

  // A1) Authoritative approved+current
  const approvedCurrent = approvedVersions.find((v: any) => !!v.is_current);
  if (approvedCurrent) {
    if (!job.follow_latest && job.resume_version_id && job.resume_document_id === documentId && job.resume_version_id !== approvedCurrent.id) {
      console.log(`[auto-run][IEL] pinned_overridden_by_authoritative { job_id: "${ctx?.jobId || 'unknown'}", doc_type: "${ctx?.docType || 'unknown'}", document_id: "${documentId}", pinned_version_id: "${job.resume_version_id}", authoritative_version_id: "${approvedCurrent.id}", reason: "approved_and_current_must_win" }`);
    }

    console.log(`[auto-run][IEL] authoritative_version_resolved { document_id: "${documentId}", version_id: "${approvedCurrent.id}", reason: "approved_and_current", version_number: ${approvedCurrent.version_number}, doc_type: "${ctx?.docType || 'unknown'}" }`);
    // ── TRANSITION LEDGER: authoritative_version_resolved ──
    try {
      const { data: docRow } = await supabase.from("project_documents").select("project_id").eq("id", documentId).maybeSingle();
      if (docRow?.project_id) {
        await emitTransition(supabase, {
          projectId: docRow.project_id,
          eventType: TRANSITION_EVENTS.AUTHORITATIVE_VERSION_RESOLVED,
          docType: ctx?.docType,
          jobId: ctx?.jobId,
          resultingVersionId: approvedCurrent.id,
          trigger: "abvr_resolution",
          sourceOfTruth: "auto-run",
          resultingState: { reason: "approved_and_current", version_number: approvedCurrent.version_number },
        });
      }
    } catch (e: any) {
      console.warn(`[auto-run][transition-ledger] authoritative_version_resolved emit failed: ${e?.message}`);
    }
    return { versionId: approvedCurrent.id, source: "best_approved", reason: "approved_and_current" };
  }

  // A2) Best approved by persisted score (CI+GP)
  const approvedScored = approvedVersions
    .map((v: any) => {
      const parsed = parseVersionScores(v.meta_json);
      return {
        id: v.id,
        version_number: v.version_number,
        approval_status: v.approval_status,
        is_current: !!v.is_current,
        ci: parsed.ci,
        gp: parsed.gp,
        scoreSource: parsed.scoreSource,
      };
    })
    .filter((v: any) => v.ci !== null && v.gp !== null) as any[];

  const bestApprovedScored = pickBestScoredVersion(approvedScored as any);
  if (bestApprovedScored) {
    console.log(`[auto-run][IEL] approved_best_detected { job_id: "${ctx?.jobId || 'unknown'}", doc_type: "${ctx?.docType || 'unknown'}", document_id: "${documentId}", best_version_id: "${bestApprovedScored.id}", best_ci: ${bestApprovedScored.ci}, best_gp: ${bestApprovedScored.gp}, score_source: "${bestApprovedScored.scoreSource || 'unknown'}", reason: "approved_best_score" }`);
    return { versionId: bestApprovedScored.id, source: "best_approved", reason: "approved_best_score" };
  }

  // A3) Fallback to newest approved version
  const newestApproved = approvedVersions[0];
  if (newestApproved) {
    console.log(`[auto-run][IEL] abvr_active_version_selected { document_id: "${documentId}", selected_version_id: "${newestApproved.id}", reason: "best_approved", version_number: ${newestApproved.version_number} }`);
    return { versionId: newestApproved.id, source: "best_approved", reason: "best_approved_by_version" };
  }

  // B) Pinned (only when no approved version exists)
  if (!job.follow_latest && job.resume_version_id && job.resume_document_id === documentId) {
    const pinnedExists = allVersions.some((v: any) => v.id === job.resume_version_id);
    if (pinnedExists) {
      console.log(`[auto-run][IEL] abvr_active_version_selected { document_id: "${documentId}", selected_version_id: "${job.resume_version_id}", reason: "pinned", follow_latest: ${job.follow_latest}, resume_version_id: "${job.resume_version_id}" }`);
      return { versionId: job.resume_version_id, source: "pinned", reason: "pinned" };
    }
    console.warn(`[auto-run][IEL] pinned_version_missing { job_id: "${ctx?.jobId || 'unknown'}", doc_type: "${ctx?.docType || 'unknown'}", document_id: "${documentId}", pinned_version_id: "${job.resume_version_id}" }`);
  }

  // C) No approved version exists: use best scored current candidate
  const eligibleScored = allVersions
    .map((v: any) => {
      const parsed = parseVersionScores(v.meta_json);
      const eligibilityReason = v.is_current ? "is_current" : null;
      return {
        id: v.id,
        version_number: v.version_number,
        approval_status: v.approval_status,
        is_current: !!v.is_current,
        ci: parsed.ci,
        gp: parsed.gp,
        scoreSource: parsed.scoreSource,
        eligibilityReason,
        origin: (v.meta_json?.accepted_by === "auto-run" || `${v.meta_json?.score_source || ""}`.startsWith("auto-run")) ? "auto_run" : "user",
      };
    })
    .filter((v: any) => v.eligibilityReason && v.ci !== null && v.gp !== null) as any[];

  const bestEligible = pickBestScoredVersion(eligibleScored as any);
  if (bestEligible) {
    console.log(`[auto-run][IEL] eligible_best_detected { job_id: "${ctx?.jobId || 'unknown'}", doc_type: "${ctx?.docType || 'unknown'}", document_id: "${documentId}", best_version_id: "${bestEligible.id}", best_ci: ${bestEligible.ci}, best_gp: ${bestEligible.gp}, score_source: "${bestEligible.scoreSource || 'unknown'}", eligibility_reason: "${bestEligible.eligibilityReason}", origin: "${bestEligible.origin}" }`);
    return { versionId: bestEligible.id, source: "eligible_best_score", reason: `eligible_best:${bestEligible.eligibilityReason}` };
  }

  // C1) is_current
  const currentVer = allVersions.find((v: any) => !!v.is_current);
  if (currentVer) {
    console.log(`[auto-run][IEL] abvr_active_version_selected { document_id: "${documentId}", selected_version_id: "${currentVer.id}", reason: "is_current" }`);
    return { versionId: currentVer.id, source: "is_current", reason: "is_current" };
  }

  // C3) latest by version_number (final fallback)
  const latestVer = allVersions[0];
  if (latestVer) {
    console.log(`[auto-run][IEL] abvr_active_version_selected { document_id: "${documentId}", selected_version_id: "${latestVer.id}", reason: "latest_version_number" }`);
    return { versionId: latestVer.id, source: "latest_version_number", reason: "latest_version_number" };
  }

  console.log(`[auto-run][IEL] abvr_active_version_selected { document_id: "${documentId}", selected_version_id: null, reason: "no_versions" }`);
  return null;
}

// ── IEL: Fresh Review Before Plateau Gate ──
// Uses ABVR to determine which version should be reviewed, then checks if that version
// has already been reviewed in this job. Returns needed=true when CI gate must be deferred.
async function needsFreshReview(
  supabase: any, jobId: string, job: any, currentDoc: string,
): Promise<{ needed: boolean; activeVersionId: string | null; activeSource: string | null; lastReviewedVersionId: string | null; reason: string }> {
  const { data: docRow } = await supabase.from("project_documents")
    .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!docRow) return { needed: false, activeVersionId: null, activeSource: null, lastReviewedVersionId: null, reason: "no_document" };

  const resolved = await resolveActiveVersionForDoc(supabase, job, docRow.id, { jobId, docType: currentDoc });
  if (!resolved) return { needed: false, activeVersionId: null, activeSource: null, lastReviewedVersionId: null, reason: "no_versions" };

  const activeVersionId = resolved.versionId;
  const activeSource = resolved.source;

  console.log(`[auto-run][IEL] abvr_active_version_selected { job_id: "${jobId}", doc_type: "${currentDoc}", active_version_id: "${activeVersionId}", source: "${activeSource}", doc_id: "${docRow.id}" }`);

  // ── IEL: Check both 'review' AND 'rewrite_accepted' for last scored version ──
  const { data: lastScoredStep } = await supabase.from("auto_run_steps")
    .select("output_ref, action").eq("job_id", jobId).eq("document", currentDoc)
    .in("action", ["review", "rewrite_accepted"])
    .not("ci", "is", null)
    .order("step_index", { ascending: false }).limit(1).maybeSingle();
  const lastReviewedVersionId = lastScoredStep?.output_ref?.input_version_id
    || lastScoredStep?.output_ref?.version_id
    || lastScoredStep?.output_ref?.output_version_id
    || null;

  if (activeVersionId !== lastReviewedVersionId) {
    return { needed: true, activeVersionId, activeSource, lastReviewedVersionId, reason: "version_mismatch" };
  }
  // IEL: Step-log is ground truth. If step-log confirms this version was reviewed,
  // trust it regardless of job.last_analyzed_version_id (which is cleared on resume
  // and can trigger redundant re-reviews on unchanged versions, causing note churn
  // and CI plateau loops). Only fall back to last_analyzed_mismatch when step-log
  // has no confirmed review for the active version.
  if (lastReviewedVersionId !== null) {
    // Step-log confirmed — version already reviewed, no fresh review needed
    return { needed: false, activeVersionId, activeSource, lastReviewedVersionId, reason: "step_log_confirmed" };
  }
  if (activeVersionId !== job.last_analyzed_version_id) {
    return { needed: true, activeVersionId, activeSource, lastReviewedVersionId, reason: "last_analyzed_mismatch" };
  }
  return { needed: false, activeVersionId, activeSource, lastReviewedVersionId, reason: "up_to_date" };
}

// ── IEL: Version cap per doc_type per job (SAFETY NET ONLY — monotonic CI loop is primary limiter) ──
// Fallback only — per-job value from auto_run_jobs.max_versions_per_doc_per_job takes precedence
const DEFAULT_MAX_VERSIONS_PER_DOC_PER_JOB = 60;
const MIN_VERSION_CAP = 10;
const MAX_VERSION_CAP = 300;

function getEffectiveVersionCap(job: any): number {
  const raw = job?.max_versions_per_doc_per_job;
  if (typeof raw === "number" && raw > 0) {
    return Math.max(MIN_VERSION_CAP, Math.min(MAX_VERSION_CAP, raw));
  }
  return DEFAULT_MAX_VERSIONS_PER_DOC_PER_JOB;
}

// ── IEL: Validate and correct target_document against ladder + deprecated guard ──
function ielValidateTarget(rawTarget: string, format: string): { target: string; corrected: boolean; log: string | null } {
  let target = canonicalDocType(rawTarget);
  let corrected = false;
  let log: string | null = null;

  // Guard 1: deprecated target resolution
  if (isDeprecatedTargetDocType(target)) {
    const resolved = canonicalDocType(target);
    log = `[IEL] Corrected deprecated target_document "${target}" → "${resolved}"`;
    target = resolved;
    corrected = true;
  }

  // Guard 2: ladder membership
  if (!isOnLadder(target, format)) {
    const ladder = getLadderForJob(format);
    const fallback = ladder ? ladder[ladder.length - 1] : target;
    log = (log ? log + " | " : "") + `[IEL] target "${target}" not on ${format} ladder → "${fallback}"`;
    target = fallback;
    corrected = true;
  }

  return { target, corrected, log };
}

// ── Resolve format string to its ladder (with alias / fallback) ──
function getLadderForJob(format: string): string[] | null {
  const key = (format || "").toLowerCase().replace(/_/g, "-");
  if (FORMAT_LADDERS[key]) return FORMAT_LADDERS[key];
  // Check aliases
  const aliased = DOC_TYPE_ALIASES[key];
  if (aliased && FORMAT_LADDERS[aliased]) return FORMAT_LADDERS[aliased];
  // Fallback: try "film"
  return FORMAT_LADDERS["film"] ?? null;
}

// ── Resolve doc-type aliases to canonical names ──
// Canonical doc_type keys use underscores (season_script, feature_script).
// Alias lookup keys use hyphens (matching DOC_TYPE_ALIASES keys from stage-ladders).
// We normalize input to hyphens for lookup, but always return underscore-canonical output.
function canonicalDocType(raw: string): string {
  const hyphenKey = (raw || "").toLowerCase().replace(/[_ ]+/g, "-");
  const resolved = DOC_TYPE_ALIASES[hyphenKey] || hyphenKey;
  // Ensure output uses canonical underscores (ladder values are underscored)
  return resolved.replace(/-/g, "_");
}

function nextDoc(current: string, format: string): string | null {
  const ladder = getLadderForJob(format);
  if (!ladder) return null;
  const idx = ladder.indexOf(current);
  return idx >= 0 && idx < ladder.length - 1 ? ladder[idx + 1] : null;
}

// ── Seed Pack doc types ──
const SEED_DOC_TYPES = ["project_overview", "creative_brief", "market_positioning", "canon", "nec"];

// ── Seed Core Official check ──
interface SeedCoreOfficialResult {
  official: boolean;
  missing: string[];
  unapproved: string[];
}

async function isSeedCoreOfficial(supabase: any, projectId: string): Promise<SeedCoreOfficialResult> {
  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId)
    .in("doc_type", SEED_DOC_TYPES);

  const docMap = new Map<string, string>();
  for (const d of (docs || [])) {
    if (!docMap.has(d.doc_type)) docMap.set(d.doc_type, d.id);
  }

  const missing = SEED_DOC_TYPES.filter(dt => !docMap.has(dt));
  if (missing.length > 0) {
    return { official: false, missing, unapproved: [] };
  }

  const docIds = Array.from(docMap.values());
  const { data: versions } = await supabase
    .from("project_document_versions")
    .select("document_id, approval_status")
    .in("document_id", docIds)
    .eq("is_current", true);

  const approvedDocIds = new Set(
    (versions || [])
      .filter((v: any) => v.approval_status === "approved")
      .map((v: any) => v.document_id)
  );

  const unapproved: string[] = [];
  for (const dt of SEED_DOC_TYPES) {
    const docId = docMap.get(dt)!;
    if (!approvedDocIds.has(docId)) {
      unapproved.push(dt);
    }
  }

  return { official: unapproved.length === 0, missing: [], unapproved };
}

// ── Input readiness thresholds ──
const MIN_IDEA_CHARS = 200;
const MIN_CONCEPT_BRIEF_CHARS = 200;
const MIN_SEED_CHARS_FOR_INPUT = 20; // seed docs just need to exist; short is warning-only
const INPUT_DOC_TYPES = ["idea", "concept_brief", ...SEED_DOC_TYPES];

interface DocCharCount {
  doc_type: string;
  has_doc: boolean;
  has_current_version: boolean;
  char_count: number;
  plaintext: string;
}

/** Check if plaintext contains stub markers */
function containsStubMarker(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const marker of STUB_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

async function getDocCharCounts(supabase: any, projectId: string, docTypes: string[]): Promise<DocCharCount[]> {
  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId)
    .in("doc_type", docTypes);

  const docMap = new Map<string, string>();
  for (const d of (docs || [])) {
    if (!docMap.has(d.doc_type)) docMap.set(d.doc_type, d.id);
  }

  const docIds = Array.from(docMap.values());
  let versions: any[] = [];
  if (docIds.length > 0) {
    const { data: vers } = await supabase
      .from("project_document_versions")
      .select("document_id, plaintext")
      .in("document_id", docIds)
      .eq("is_current", true);
    versions = vers || [];
  }

  return docTypes.map(dt => {
    const docId = docMap.get(dt);
    const ver = docId ? versions.find((v: any) => v.document_id === docId) : null;
    const plaintext = ver?.plaintext?.trim() || "";
    return {
      doc_type: dt,
      has_doc: !!docId,
      has_current_version: !!ver,
      char_count: plaintext.length,
      plaintext,
    };
  });
}

/** Check if project inputs are sufficient to proceed with auto-run */
function checkInputReadiness(counts: DocCharCount[]): { ready: boolean; missing_fields: string[]; summary: string } {
  const missing: string[] = [];

  const idea = counts.find(c => c.doc_type === "idea");
  const brief = counts.find(c => c.doc_type === "concept_brief");

  // Need at least one of idea or concept_brief with sufficient non-stub content
  const ideaOk = idea && idea.has_current_version && idea.char_count >= MIN_IDEA_CHARS && !containsStubMarker(idea.plaintext);
  const briefOk = brief && brief.has_current_version && brief.char_count >= MIN_CONCEPT_BRIEF_CHARS && !containsStubMarker(brief.plaintext);

  if (!ideaOk && !briefOk) {
    if (!idea?.has_doc && !brief?.has_doc) {
      missing.push("idea(missing)", "concept_brief(missing)");
    } else {
      if (idea?.has_doc) {
        const reason = containsStubMarker(idea.plaintext) ? "stub" : `${idea.char_count}chars`;
        missing.push(`idea(${reason})`);
      } else missing.push("idea(missing)");
      if (brief?.has_doc) {
        const reason = containsStubMarker(brief.plaintext) ? "stub" : `${brief.char_count}chars`;
        missing.push(`concept_brief(${reason})`);
      } else missing.push("concept_brief(missing)");
    }
  }

  // Seed docs: require non-stub current versions. Short/placeholder seed docs are insufficient.
  const seedInsufficient = SEED_DOC_TYPES.map(dt => {
    const c = counts.find(cc => cc.doc_type === dt);
    if (!c || !c.has_doc) return `${dt}(missing)`;
    if (!c.has_current_version) return `${dt}(missing_current_version)`;
    if (containsStubMarker(c.plaintext)) return `${dt}(stub)`;
    if (c.char_count < MIN_SEED_CHARS_FOR_INPUT) return `${dt}(${c.char_count}chars)`;
    return null;
  }).filter((v): v is string => !!v);
  missing.push(...seedInsufficient);

  const summary = missing.length > 0
    ? `INPUT_INCOMPLETE | missing=${missing.join(", ")}`
    : "inputs_ready";

  return { ready: missing.length === 0, missing_fields: missing, summary };
}

async function attemptAutoRegenInputs(
  supabase: any,
  supabaseUrl: string,
  token: string,
  jobId: string,
  stepIndex: number,
  currentDoc: string,
  projectId: string,
  insufficients: string[],
  trigger: "start_gate" | "run_next_gate" | "stub_at_current_stage",
): Promise<{ ok: boolean; regenResult: any; error?: string }> {
  try {
    const regenResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "regenerate-insufficient-docs", projectId, dryRun: false, userId: _requestScopedUserId || undefined }),
    });

    const raw = await regenResp.text();
    let regenResult: any = {};
    try {
      regenResult = raw ? JSON.parse(raw) : {};
    } catch {
      regenResult = { parse_error: true, raw: raw.slice(0, 300) };
    }

    const ok = regenResp.ok && regenResult?.success !== false && !regenResult?.error;
    const regeneratedCount = Array.isArray(regenResult?.regenerated) ? regenResult.regenerated.length : 0;

    await logStep(
      supabase,
      jobId,
      stepIndex,
      currentDoc,
      "auto_regen_inputs",
      ok
        ? `Auto-regenerated ${regeneratedCount} docs`
        : `Auto-regeneration attempted but failed (${regenResp.status})`,
      {},
      undefined,
      { trigger, insufficients, regen_result: regenResult, http_status: regenResp.status },
    );

    if (!ok) {
      const err = regenResult?.error || `HTTP ${regenResp.status}`;
      console.error("[auto-run] auto-regen failed", { jobId, trigger, err });
      return { ok: false, regenResult, error: String(err) };
    }

    console.log("[auto-run] auto-regen result", { jobId, trigger, regenerated: regeneratedCount, skipped: regenResult?.skipped?.length || 0 });
    return { ok: true, regenResult };
  } catch (e: any) {
    const err = e?.message || "unknown_error";
    await logStep(
      supabase,
      jobId,
      stepIndex,
      currentDoc,
      "auto_regen_inputs",
      `Auto-regeneration threw error: ${err}`,
      {},
      undefined,
      { trigger, insufficients, error: err },
    );
    console.error("[auto-run] auto-regen threw", { jobId, trigger, err });
    return { ok: false, regenResult: null, error: err };
  }
}

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
  userId?: string | null,
): Promise<{ ensured: boolean; missing: string[]; failed: boolean; fail_type?: 'SEED_PACK_FAILED' | 'SEED_PACK_INCOMPLETE' | 'SEED_PACK_FAILED_HTTP' | 'SEED_PACK_FAILED_LOGIC'; error?: string; warnings?: { doc_type: string; reason: string; chars: number }[]; seed_http_status?: number; seed_debug?: Record<string, any> }> {
  const { data: existingDocs } = await supabase
    .from("project_documents")
    .select("doc_type")
    .eq("project_id", projectId)
    .in("doc_type", SEED_DOC_TYPES);

  const existingSet = new Set((existingDocs || []).map((d: any) => d.doc_type));
  const missing = SEED_DOC_TYPES.filter(dt => !existingSet.has(dt));

  if (missing.length === 0) {
    // Verify all have current versions with non-empty plaintext
    const { data: verifiedDocs } = await supabase
      .from("project_documents")
      .select("id, doc_type")
      .eq("project_id", projectId)
      .in("doc_type", SEED_DOC_TYPES);

    const docIds = (verifiedDocs || []).map((d: any) => d.id);
    if (docIds.length > 0) {
      const { data: currentVersions } = await supabase
        .from("project_document_versions")
        .select("document_id, plaintext")
        .in("document_id", docIds)
        .eq("is_current", true);

      const MIN_SEED_CHARS = 20;
      const docsWithContent = new Set(
        (currentVersions || [])
          .filter((v: any) => v.plaintext && v.plaintext.trim().length >= MIN_SEED_CHARS)
          .map((v: any) => v.document_id)
      );

      // Docs that exist but have no current version at all
      const trulyMissing = SEED_DOC_TYPES.filter(dt => {
        const docId = (verifiedDocs || []).find((d: any) => d.doc_type === dt)?.id;
        if (!docId) return true;
        // Check if doc has ANY current version (even short)
        const hasCurrentVersion = (currentVersions || []).some((v: any) => v.document_id === docId);
        return !hasCurrentVersion;
      });

      // Docs that have a current version but are too short (warning only)
      const shortDocs = SEED_DOC_TYPES
        .filter(dt => !trulyMissing.includes(dt))
        .filter(dt => {
          const docId = (verifiedDocs || []).find((d: any) => d.doc_type === dt)?.id;
          return docId && !docsWithContent.has(docId);
        })
        .map(dt => {
          const docId = (verifiedDocs || []).find((d: any) => d.doc_type === dt)?.id;
          const ver = (currentVersions || []).find((v: any) => v.document_id === docId);
          return { doc_type: dt, reason: "too_short" as const, chars: ver?.plaintext?.trim()?.length || 0 };
        });

      if (trulyMissing.length > 0) {
        console.error(`[auto-run] SEED_PACK docs exist but ${trulyMissing.length} missing current version entirely: ${trulyMissing.join(",")}`);
        return { ensured: false, missing: trulyMissing, failed: true, fail_type: "SEED_PACK_INCOMPLETE", error: `Seed docs missing current version: ${trulyMissing.join(", ")}`, warnings: shortDocs };
      }

      if (shortDocs.length > 0) {
        console.warn(`[auto-run] SEED_PACK ${shortDocs.length} docs are short (< ${MIN_SEED_CHARS} chars): ${shortDocs.map(d => d.doc_type).join(",")}`);
      }
      console.log(`[auto-run] SEED_PACK ensured=false missing=none all_verified`);
      return { ensured: false, missing: [], failed: false, warnings: shortDocs.length > 0 ? shortDocs : undefined };
    }

    console.log(`[auto-run] SEED_PACK ensured=false missing=none (no doc ids found)`);
    return { ensured: false, missing: [], failed: false };
  }

  // Derive pitch from idea doc's current version plaintext, or project title
  const { data: project } = await supabase
    .from("projects")
    .select("title, format, assigned_lane")
    .eq("id", projectId)
    .single();

  let pitch = project?.title || "Untitled project";
  const { data: ideaDocs } = await supabase
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "idea")
    .order("created_at", { ascending: false })
    .limit(1);

  if (ideaDocs?.[0]) {
    const { data: currentVer } = await supabase
      .from("project_document_versions")
      .select("plaintext")
      .eq("document_id", ideaDocs[0].id)
      .eq("is_current", true)
      .limit(1)
      .single();
    const ideaText = currentVer?.plaintext || "";
    if (ideaText.length > 10) pitch = ideaText.slice(0, 2000);
  }

  const lane = project?.assigned_lane || "independent-film";

  console.log("[auto-run] SEED_PACK ensured=true missing=" + missing.join(","));
  console.log("[auto-run] calling generate-seed-pack", { projectId, lane });

  try {
    const seedRes = await fetch(`${supabaseUrl}/functions/v1/generate-seed-pack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId, pitch, lane, userId: userId || undefined }),
    });

    const raw = await seedRes.text();
    const snippet = raw.slice(0, 300);
    console.log("[auto-run] generate-seed-pack http", { status: seedRes.status, snippet });

    if (!seedRes.ok) {
      return {
        ensured: true, missing, failed: true,
        fail_type: "SEED_PACK_FAILED_HTTP",
        error: `generate-seed-pack HTTP ${seedRes.status}: ${snippet}`,
        seed_http_status: seedRes.status,
        seed_debug: { http_status: seedRes.status, response_snippet: snippet, parsed_success: false },
      };
    }

    let seedResult: any;
    try {
      seedResult = JSON.parse(raw);
    } catch (_parseErr) {
      return {
        ensured: true, missing, failed: true,
        fail_type: "SEED_PACK_FAILED_HTTP",
        error: `generate-seed-pack returned invalid JSON: ${snippet}`,
        seed_http_status: seedRes.status,
        seed_debug: { http_status: seedRes.status, response_snippet: snippet, parsed_success: false, parse_error: true },
      };
    }

    console.log("[auto-run] generate-seed-pack json", { success: seedResult.success, insertedCount: seedResult.insertedCount, updatedCount: seedResult.updatedCount, error: seedResult.error });

    if (!seedResult.success) {
      const truncErr = ((seedResult.error || "generate-seed-pack returned success=false") as string).slice(0, 300);
      return {
        ensured: true, missing, failed: true,
        fail_type: "SEED_PACK_FAILED_LOGIC",
        error: truncErr,
        seed_http_status: seedRes.status,
        seed_debug: { http_status: seedRes.status, response_snippet: snippet, parsed_success: false, insertedCount: seedResult.insertedCount, updatedCount: seedResult.updatedCount },
      };
    }

    // Success path — carry debug forward
    var _seedDebugSuccess: Record<string, any> = { http_status: seedRes.status, parsed_success: true, insertedCount: seedResult.insertedCount, updatedCount: seedResult.updatedCount };
  } catch (e: any) {
    const truncErr = ((e.message || "Unknown error") as string).slice(0, 300);
    console.error("[auto-run] SEED_PACK generation failed:", truncErr);
    return { ensured: true, missing, failed: true, fail_type: "SEED_PACK_FAILED_HTTP", error: truncErr, seed_debug: { exception: true, error: truncErr } };
  }

  // Re-verify after generation
  const { data: postDocs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId)
    .in("doc_type", SEED_DOC_TYPES);

  const postDocIds = (postDocs || []).map((d: any) => d.id);
  const { data: postVersions } = postDocIds.length > 0
    ? await supabase
        .from("project_document_versions")
        .select("document_id, plaintext")
        .in("document_id", postDocIds)
        .eq("is_current", true)
    : { data: [] };

  const postMinChars = 20;
  // Docs that truly don't exist or have no current version
  const trulyMissingPost = SEED_DOC_TYPES.filter(dt => {
    const doc = (postDocs || []).find((d: any) => d.doc_type === dt);
    if (!doc) return true;
    const hasCurrentVersion = (postVersions || []).some((v: any) => v.document_id === doc.id);
    return !hasCurrentVersion;
  });

  // Short docs (warning only)
  const shortDocsPost = SEED_DOC_TYPES
    .filter(dt => !trulyMissingPost.includes(dt))
    .filter(dt => {
      const doc = (postDocs || []).find((d: any) => d.doc_type === dt);
      const ver = (postVersions || []).find((v: any) => v.document_id === doc?.id);
      return !ver?.plaintext || ver.plaintext.trim().length < postMinChars;
    })
    .map(dt => {
      const doc = (postDocs || []).find((d: any) => d.doc_type === dt);
      const ver = (postVersions || []).find((v: any) => v.document_id === doc?.id);
      return { doc_type: dt, reason: "too_short" as const, chars: ver?.plaintext?.trim()?.length || 0 };
    });

  if (trulyMissingPost.length > 0) {
    console.error(`[auto-run] SEED_PACK still missing after generation: ${trulyMissingPost.join(",")}`);
    return { ensured: true, missing: trulyMissingPost, failed: true, fail_type: "SEED_PACK_INCOMPLETE", error: `Seed pack missing after generation: ${trulyMissingPost.join(", ")}`, warnings: shortDocsPost, seed_debug: { ..._seedDebugSuccess, post_verify_missing: trulyMissingPost } };
  }

  if (shortDocsPost.length > 0) {
    console.warn(`[auto-run] SEED_PACK ${shortDocsPost.length} docs short after generation: ${shortDocsPost.map(d => d.doc_type).join(",")}`);
  }

  console.log("[auto-run] SEED_PACK verified after generation");
  return { ensured: true, missing: [], failed: false, warnings: shortDocsPost.length > 0 ? shortDocsPost : undefined, seed_debug: _seedDebugSuccess };
}

// ── Downstream Sufficiency Gate ──────────────────────────────────────────────

const STUB_MARKERS = [
  "draft stub",
  "generate full",
  "generate from dev engine",
  "from dev engine",
  "todo",
  "[insert",
  "[1–2 sentences]",
  "[1-2 sentences]",
  "placeholder",
];

const MIN_CHARS_BY_DOC_TYPE: Record<string, number> = {
  concept_brief: 800,
  beat_sheet: 1200,
  character_bible: 1200,
  treatment: 1200,
  story_outline: 1200,
  episode_grid: 800,
  season_arc: 800,
  format_rules: 600,
  market_sheet: 700,
  vertical_market_sheet: 700,
  episode_script: 2000,
  season_script: 2000,
  feature_script: 2000,
  season_master_script: 2000,
  
  production_draft: 2000,
  documentary_outline: 800,
  deck: 600,
  vertical_episode_beats: 600,
};

const DEFAULT_MIN_CHARS = 600;

// ── Feature-length word count gates ──
// feature_script and production_draft must meet a minimum runtime before being
// treated as sufficient. Hard floor = 70 min × 220 wpm = 15,400 words.
// This gate prevents auto-run from promoting a short script (e.g. 25 pages / 6k words)
// that the Feature Length Guardrail would flag as "Below Floor".
// Does NOT apply to episodic scripts (episode_script, season_script) — different runtime targets.
const FEATURE_MIN_WORDS: Record<string, number> = {
  feature_script: 19800,   // 90 min hard floor at 220 wpm (raised from 15400/70min)
  production_draft: 19800, // same — inherits from script
};

function isDownstreamDocSufficient(docType: string, plaintext: string | null | undefined, _approvalStatus?: string): boolean {
  if (!plaintext) return false;
  const text = plaintext.trim();
  const minChars = MIN_CHARS_BY_DOC_TYPE[docType] ?? DEFAULT_MIN_CHARS;
  if (text.length < minChars) return false;
  const lower = text.toLowerCase();
  for (const marker of STUB_MARKERS) {
    if (lower.includes(marker)) return false;
  }
  // ── Feature-length gate ──
  // For feature scripts and production drafts, enforce a word-count floor derived from
  // the 70-minute hard runtime floor. A stub-free but short script (e.g. 6k words / 25 pages)
  // must not be treated as sufficient — auto-run must keep iterating.
  if (FEATURE_MIN_WORDS[docType]) {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < FEATURE_MIN_WORDS[docType]) {
      console.log(`[auto-run] isDownstreamDocSufficient: ${docType} BELOW feature-length floor — ${wordCount} words < ${FEATURE_MIN_WORDS[docType]} required`);
      return false;
    }
  }
  return true;
}

/**
 * Auto-generate a minimal NEC (Narrative Energy Contract) document.
 * Extracted to avoid duplication between initial generation and stale regen.
 */
async function autoGenerateNEC(
  supabase: any, job: any, jobId: string, format: string, gateLabel: string, resolverHash?: string | null,
) {
  const necSlot = await ensureDocSlot(supabase, job.project_id, job.user_id, "nec", {
    source: "generated", docRole: "creative_primary",
  });
  const { data: freshCanon } = await supabase.from("project_canon")
    .select("canon_json").eq("project_id", job.project_id).maybeSingle();
  const fc = (freshCanon?.canon_json || {}) as any;
  const necJson = {
    nec_version: "1.0",
    format_profile: { format: format || "unknown" },
    energy_contract: {
      heat_level_0_10: format === "vertical-drama" ? 7 : 5,
      escalation_velocity: format === "vertical-drama" ? "fast" : "medium",
      reversal_frequency: format === "vertical-drama" ? "high" : "medium",
      cliffhanger_density: format === "vertical-drama" ? "high" : "medium",
      conflict_fuel: [], taboos: [],
    },
    arc_envelope: {
      max_character_shift_0_10: 6,
      emotional_amplitude_cap: "high-but-controlled",
      tone_oscillation_range: format === "vertical-drama" ? "tight" : "moderate",
      allowed_regression: "limited",
      relationship_volatility_cap: format === "vertical-drama" ? "medium" : "low",
      promise_guardrails: [],
    },
    continuity_locks: { immutable_facts: [], character_voice_locks: [], theme_locks: [] },
    acceptance_tests: { must_have: [], must_not_have: [] },
  };
  const necPlaintext = `# Narrative Energy Contract\n\n\`\`\`json\n${JSON.stringify(necJson, null, 2)}\n\`\`\`\n\n## Energy Contract\n- Heat Level: ${necJson.energy_contract.heat_level_0_10}/10\n- Escalation: ${necJson.energy_contract.escalation_velocity}\n- Reversals: ${necJson.energy_contract.reversal_frequency}\n- Cliffhangers: ${necJson.energy_contract.cliffhanger_density}\n\n## Arc Envelope\n- Max Character Shift: ${necJson.arc_envelope.max_character_shift_0_10}/10\n- Emotional Cap: ${necJson.arc_envelope.emotional_amplitude_cap}\n- Tone Range: ${necJson.arc_envelope.tone_oscillation_range}\n- Allowed Regression: ${necJson.arc_envelope.allowed_regression}\n`;

  await createVersion(supabase, {
    documentId: necSlot.documentId,
    docType: "nec",
    plaintext: necPlaintext,
    label: resolverHash ? "auto_regenerated_nec_stale" : "auto_generated_nec",
    createdBy: job.user_id,
    approvalStatus: "draft",
    generatorId: "auto-run-setup",
    dependsOnResolverHash: resolverHash || undefined,
    metaJson: { nec_json: necJson, generated_by: "auto-run-prewrite-setup", stale_regen: !!resolverHash },
    inputsUsed: {
      project_id: job.project_id,
      doc_type: "nec",
      generator_id: "auto-run-setup",
      job_id: jobId,
      selected_template_key: resolverHash ? "prewrite_setup_nec_stale_regen" : "prewrite_setup_nec",
      resolved_prefs_snapshot: { lane: format, format },
      resolver_hash: resolverHash || null,
    },
  });
  console.log(`[auto-run] ${gateLabel}: ${resolverHash ? 'auto-regenerated stale' : 'auto-generated'} NEC document`);
}

/**
 * A stage is "satisfied" if:
 *   - a doc of that type exists with a current version
 *   - the current version passes sufficiency checks (no stubs, min chars)
 *   - for APPROVAL_REQUIRED_STAGES, an approved version is also required
 */
async function nextUnsatisfiedStage(
  supabase: any,
  projectId: string,
  format: string,
  currentStage: string,
  targetStage: string,
  allowDefaults = false,
  userId?: string,
  jobId?: string,
): Promise<string | null> {
  const ladder = getLadderForJob(format);
  if (!ladder) return null;
  const currentIdx = ladder.indexOf(currentStage);
  const targetIdx = ladder.indexOf(targetStage);
  const safeTargetIdx = targetIdx >= 0 ? targetIdx : ladder.length - 1;
  if (currentIdx < 0) return nextDoc(currentStage, format);

  // Fetch all project docs
  const { data: allDocs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId);

  const docsByType = new Map<string, string[]>();
  for (const d of (allDocs || [])) {
    if (!docsByType.has(d.doc_type)) docsByType.set(d.doc_type, []);
    docsByType.get(d.doc_type)!.push(d.id);
  }

  // Collect all doc IDs for batch version fetch
  const allDocIds = (allDocs || []).map((d: any) => d.id);

  // Batch-fetch current versions with plaintext + approval_status + label
  let currentVersions: any[] = [];
  if (allDocIds.length > 0) {
    const { data: vers } = await supabase
      .from("project_document_versions")
      .select("document_id, plaintext, approval_status, label, status, meta_json")
      .in("document_id", allDocIds)
      .eq("is_current", true);
    currentVersions = vers || [];
  }

  const versionByDocId = new Map<string, { plaintext: string | null; approval_status: string; label: string | null; status?: string; bg_generating?: boolean }>();
  for (const v of currentVersions) {
    versionByDocId.set(v.document_id, { plaintext: v.plaintext, approval_status: v.approval_status, label: v.label || null, status: v.status || null, bg_generating: (v.meta_json as any)?.bg_generating === true });
  }

  // ── REVIEWED-IN-JOB GATE: batch-fetch all reviewed stages for this job in one query ──
  let reviewedSet = new Set<string>();
  if (jobId) {
    const { data: reviewedRows } = await supabase
      .from("auto_run_steps")
      .select("document")
      .eq("job_id", jobId)
      .eq("action", "review");
    if (reviewedRows) {
      reviewedSet = new Set(reviewedRows.map((r: any) => r.document));
    }
  }

  const APPROVAL_REQUIRED_STAGES = new Set([
    "episode_grid", "character_bible", "season_arc", "format_rules",
  ]);

  // Walk ladder from current+1 to target, find first unsatisfied
  for (let i = currentIdx + 1; i <= safeTargetIdx; i++) {
    const stage = ladder[i];
    // Skip seed core stages — they have their own gate
    if (SEED_DOC_TYPES.includes(stage)) continue;

    const docIds = docsByType.get(stage);
    if (!docIds || docIds.length === 0) return stage; // no doc at all

    // ── EXPLICIT initial_baseline_seed HANDLING ──
    // If current version is a seed and not reviewed in this job, treat as unsatisfied
    const isSeed = docIds.some(id => {
      const ver = versionByDocId.get(id);
      return ver?.label === "initial_baseline_seed";
    });
    if (isSeed && !reviewedSet.has(stage)) {
      console.log(`[auto-run] stage ${stage} has initial_baseline_seed label and NOT reviewed in job (${jobId}). Routing for evaluation.`);
      return stage;
    }

    // ── Background generation guard: if any doc for this stage has status='generating',
    // treat it as pending (not unsatisfied). Return a special sentinel so the caller
    // can yield and wait for the background task rather than re-triggering generate.
    const hasGenerating = docIds.some(id => {
      const ver = versionByDocId.get(id);
      // bg_generating: true in meta_json flags an in-progress background task (status stays 'draft')
      return ver?.bg_generating === true;
    });
    if (hasGenerating) {
      console.log(`[auto-run] stage ${stage} has a background generation in progress — yielding`);
      return `__generating__:${stage}`;
    }

    // Check sufficiency: at least one doc must have a sufficient current version
    const hasSufficient = docIds.some(id => {
      const ver = versionByDocId.get(id);
      if (!ver) return false;
      return isDownstreamDocSufficient(stage, ver.plaintext, ver.approval_status);
    });

    if (!hasSufficient) {
      console.log(`[auto-run] stage ${stage} unsatisfied: doc exists but content insufficient (stub or too short)`);
      return stage;
    }

    // ── REVIEWED-IN-JOB GATE (uses batch-fetched reviewedSet) ──
    if (jobId && !reviewedSet.has(stage)) {
      console.log(`[auto-run] stage ${stage} sufficient but NOT reviewed in this job (${jobId}). Routing for review.`);
      return stage;
    }

    if (APPROVAL_REQUIRED_STAGES.has(stage)) {
      const hasApproved = docIds.some(id => {
        const ver = versionByDocId.get(id);
        return ver?.approval_status === "approved";
      });
      if (!hasApproved) {
        if (allowDefaults && userId) {
          // Full Autopilot: auto-approve the current version so we can proceed
          for (const docId of docIds) {
            const { data: curVer } = await supabase.from("project_document_versions")
              .select("id").eq("document_id", docId).eq("is_current", true).limit(1);
            if (curVer?.[0]) {
              await supabase.from("project_document_versions").update({
                approval_status: "approved",
                approved_at: new Date().toISOString(),
                approved_by: userId,
              }).eq("id", curVer[0].id);
              console.log(`[auto-run] nextUnsatisfiedStage: auto-approved ${stage} (allow_defaults)`);
            }
          }
          // Stage is now satisfied, continue
        } else {
          return stage;
        }
      }
    }
  }

  return null; // all stages satisfied
}

function isOnLadder(d: string, format?: string): boolean {
  if (format) {
    const ladder = getLadderForJob(format);
    return ladder ? ladder.includes(d) : false;
  }
  return ALL_STAGES.has(d);
}

function ladderIndexOf(d: string, format: string): number {
  const ladder = getLadderForJob(format);
  return ladder ? ladder.indexOf(d) : -1;
}

function resolveTargetForFormat(targetDoc: string, format: string): string {
  if (isOnLadder(targetDoc, format)) return targetDoc;
  const ladder = getLadderForJob(format);
  if (!ladder || ladder.length === 0) return targetDoc; // caller must have validated format already
  return ladder[ladder.length - 1];
}

function isStageAtOrBeforeTarget(stage: string, targetDoc: string, format: string): boolean {
  // Generating sentinel: background task in progress — treat as "still in range" so the job keeps running
  if (isGeneratingSentinel(stage)) return true;
  if (!isOnLadder(stage, format)) return false;
  const stageIdx = ladderIndexOf(stage, format);
  const targetIdx = ladderIndexOf(resolveTargetForFormat(targetDoc, format), format);
  return stageIdx >= 0 && stageIdx <= targetIdx;
}

/** Returns true if nextUnsatisfiedStage returned a background-generation-pending sentinel. */
function isGeneratingSentinel(stage: string | null): boolean {
  return typeof stage === "string" && stage.startsWith("__generating__:");
}

/** Extracts the real stage name from a generating sentinel. */
function stageFromSentinel(stage: string): string {
  return stage.replace(/^__generating__:/, "");
}

// ── Mode Config ──
const MODE_CONFIG: Record<string, { max_stage_loops: number; max_total_steps: number; require_readiness?: number }> = {
  fast: { max_stage_loops: DEFAULT_MAX_STAGE_LOOPS, max_total_steps: DEFAULT_MAX_TOTAL_STEPS },
  balanced: { max_stage_loops: DEFAULT_MAX_STAGE_LOOPS, max_total_steps: DEFAULT_MAX_TOTAL_STEPS },
  premium: { max_stage_loops: DEFAULT_MAX_STAGE_LOOPS, max_total_steps: DEFAULT_MAX_TOTAL_STEPS, require_readiness: 82 },
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

  // ── PRIORITY 0: Read canonical duration from project_canon.canon_json ──
  // This is the HIGHEST priority source — user/devseed-defined, potentially locked.
  let canonDurMin: number | null = null;
  let canonDurMax: number | null = null;
  let canonDurLocked = false;
  let canonDurSource: string | null = null;
  try {
    const { data: canonRow } = await supabase.from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();
    const cj = canonRow?.canon_json;
    if (cj) {
      // Check canon_json.format.episode_duration_seconds (new canonical model)
      const fmtBlock = cj.format;
      if (fmtBlock?.episode_duration_seconds) {
        const eds = fmtBlock.episode_duration_seconds;
        if (typeof eds.min === "number") canonDurMin = eds.min;
        if (typeof eds.max === "number") canonDurMax = eds.max;
        canonDurLocked = !!fmtBlock.episode_duration_locked;
        canonDurSource = fmtBlock.episode_duration_source || "canon";
      }
      // Fallback: legacy canon_json keys (episode_length_seconds_min/max)
      if (canonDurMin == null && canonDurMax == null) {
        const legMin = typeof cj.episode_length_seconds_min === "number" ? cj.episode_length_seconds_min : null;
        const legMax = typeof cj.episode_length_seconds_max === "number" ? cj.episode_length_seconds_max : null;
        if (legMin != null || legMax != null) {
          canonDurMin = legMin;
          canonDurMax = legMax;
          canonDurSource = "canon_legacy";
        }
      }
    }
  } catch { /* canon read failed — continue with lower-priority sources */ }

  const gc = project.guardrails_config || {};
  const quals = gc?.overrides?.qualifications || {};
  const defaults = FORMAT_DEFAULTS[fmt] || {};

  // Duration range resolution: canon_json → project columns → guardrails → defaults
  let durMin: number | null = null;
  let durMax: number | null = null;
  let durScalar: number | null = null;
  let durSource: "canon" | "canon_legacy" | "project_column" | "guardrails" | "defaults" | null = null;
  let durLocked = false;

  // PRIORITY 0: Canon (locked takes absolute precedence)
  if (canonDurMin != null || canonDurMax != null) {
    durMin = canonDurMin;
    durMax = canonDurMax;
    durSource = (canonDurSource as any) || "canon";
    durLocked = canonDurLocked;
    console.log(`[resolveSeriesQualifications] Canon duration: ${durMin}-${durMax}s source=${durSource} locked=${durLocked}`);
  }
  // PRIORITY 1: Project columns (only if canon didn't define it OR canon isn't locked)
  else if (project.episode_target_duration_min_seconds || project.episode_target_duration_max_seconds) {
    durMin = project.episode_target_duration_min_seconds;
    durMax = project.episode_target_duration_max_seconds;
    durSource = "project_column";
  }
  // PRIORITY 2: Guardrails overrides
  else if (quals.episode_target_duration_min_seconds || quals.episode_target_duration_max_seconds) {
    durMin = quals.episode_target_duration_min_seconds;
    durMax = quals.episode_target_duration_max_seconds;
    durSource = "guardrails";
  }
  // PRIORITY 3: Lane defaults (ONLY if nothing else defined)
  else if (defaults.episode_target_duration_min_seconds || defaults.episode_target_duration_max_seconds) {
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
  // IMPORTANT: Never persist-on-resolve if canon is locked — canon is truth
  const needsPersist = !durLocked && (durSource === "defaults" || countSource === "defaults") && SERIES_FORMATS.includes(fmt);
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

  // ── Read canonical duration from project_canon (highest priority) ──
  let canonDurMin: number | undefined;
  let canonDurMax: number | undefined;
  let canonDurScalar: number | undefined;
  let canonDurSource: string | undefined;
  let canonDurLocked = false;
  try {
    const { data: canonRow } = await supabase.from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();
    const cj = canonRow?.canon_json;
    if (cj) {
      const fmtBlock = cj.format;
      if (fmtBlock?.episode_duration_seconds) {
        const eds = fmtBlock.episode_duration_seconds;
        if (typeof eds.min === "number") canonDurMin = eds.min;
        if (typeof eds.max === "number") canonDurMax = eds.max;
        canonDurScalar = Math.round(((canonDurMin ?? 0) + (canonDurMax ?? 0)) / 2) || undefined;
        canonDurLocked = !!fmtBlock.episode_duration_locked;
        canonDurSource = fmtBlock.episode_duration_source || "canon";
        console.log(`[buildCriteriaSnapshot] Canon duration override: ${canonDurMin}-${canonDurMax}s (source=${canonDurSource}, locked=${canonDurLocked})`);
      }
      // Legacy canon keys
      if (canonDurMin == null) {
        const lm = typeof cj.episode_length_seconds_min === "number" ? cj.episode_length_seconds_min : undefined;
        const lx = typeof cj.episode_length_seconds_max === "number" ? cj.episode_length_seconds_max : undefined;
        if (lm != null || lx != null) {
          canonDurMin = lm;
          canonDurMax = lx;
          canonDurScalar = Math.round(((canonDurMin ?? 0) + (canonDurMax ?? 0)) / 2) || undefined;
          canonDurSource = "canon_legacy";
        }
      }
    }
  } catch { /* continue without canon */ }

  // Duration: canon → project columns → guardrails (NO defaults here — resolveSeriesQualifications handles that)
  const durMin = canonDurMin ?? quals.episode_target_duration_min_seconds ?? p.episode_target_duration_min_seconds ?? undefined;
  const durMax = canonDurMax ?? quals.episode_target_duration_max_seconds ?? p.episode_target_duration_max_seconds ?? undefined;
  const durScalar = canonDurScalar ?? quals.episode_target_duration_seconds ?? p.episode_target_duration_seconds ?? undefined;

  // Track source for downstream logging
  const durSource = canonDurMin != null ? (canonDurSource || "canon") : undefined;
  const durLocked = canonDurMin != null ? canonDurLocked : false;

  return {
    format_subtype: quals.format_subtype || fmt,
    season_episode_count: quals.season_episode_count || p.season_episode_count || undefined,
    episode_target_duration_seconds: durScalar,
    episode_target_duration_min_seconds: durMin,
    episode_target_duration_max_seconds: durMax,
    target_runtime_min_low: quals.target_runtime_min_low || undefined,
    target_runtime_min_high: quals.target_runtime_min_high || undefined,
    assigned_lane: p.assigned_lane || quals.assigned_lane || undefined,
    budget_range: p.budget_range || quals.budget_range || undefined,
    development_behavior: p.development_behavior || undefined,
    updated_at: new Date().toISOString(),
    // Extra metadata for duration logging (not in CRITERIA_SNAPSHOT_KEYS but accessible downstream)
    _duration_source: durSource,
    _duration_locked: durLocked,
  } as CriteriaSnapshot;
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

// ── Deterministic Duration Estimator (single source of truth) ──
const DURATION_DIALOGUE_WPS = 2.5;
const DURATION_ACTION_WPS = 1.5;
const DURATION_SLUGLINE_SEC = 2;
const DURATION_PAREN_SEC = 1;
const DURATION_BEAT_SEC = 0.5;
const DURATION_CUE_RE = /^[A-Z][A-Z\s.'()\-]{1,40}[:]\s*/;
const DURATION_SLUG_RE = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s/i;
const DURATION_PAREN_RE = /^\s*\(.*\)\s*$/;

function estimateDurationSeconds(documentText: string): number {
  if (!documentText || documentText.trim().length === 0) return 0;
  const lines = documentText.split('\n');
  let total = 0;
  let inDialogue = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) { total += DURATION_BEAT_SEC; inDialogue = false; continue; }
    if (DURATION_SLUG_RE.test(t)) { total += DURATION_SLUGLINE_SEC; inDialogue = false; continue; }
    if (DURATION_PAREN_RE.test(t)) { total += DURATION_PAREN_SEC; continue; }
    if (DURATION_CUE_RE.test(t)) {
      inDialogue = true; total += 1;
      const after = t.replace(DURATION_CUE_RE, '').trim();
      if (after.length > 0) total += after.split(/\s+/).filter(w => w.length > 0).length / DURATION_DIALOGUE_WPS;
      continue;
    }
    const words = t.split(/\s+/).filter(w => w.length > 0).length;
    total += words / (inDialogue ? DURATION_DIALOGUE_WPS : DURATION_ACTION_WPS);
  }
  return Math.round(total);
}

// ── Criteria hash (stable, deterministic) ──
function computeCriteriaHashEdge(criteria: Record<string, any>): string {
  const sorted = Object.keys(criteria)
    .filter(k => criteria[k] != null && k !== 'updated_at')
    .sort()
    .map(k => `${k}=${JSON.stringify(criteria[k])}`)
    .join('|');
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash + sorted.charCodeAt(i)) & 0xffffffff;
  }
  return `ch_${(hash >>> 0).toString(36)}`;
}

type CriteriaClassification = 'OK' | 'CRITERIA_STALE_PROVENANCE' | 'CRITERIA_FAIL_DURATION';

// Duration eligibility is imported from _shared/eligibilityRegistry.ts
// isDurationEligibleDocType(docType, format) is the canonical check.

function classifyCriteriaEdge(opts: {
  versionCriteriaHash: string | null;
  currentCriteriaHash: string | null;
  measuredDurationSeconds: number;
  targetMin: number | null;
  targetMax: number | null;
  targetScalar: number | null;
  docType?: string | null;
  format?: string | null;
}): { classification: CriteriaClassification; detail: string } {
  // 1. True provenance mismatch
  if (opts.versionCriteriaHash && opts.currentCriteriaHash
      && opts.versionCriteriaHash !== opts.currentCriteriaHash) {
    return { classification: 'CRITERIA_STALE_PROVENANCE', detail: `Criteria hash mismatch: ${opts.versionCriteriaHash} vs ${opts.currentCriteriaHash}` };
  }
  // 2. Duration check — ONLY for runtime-bearing doc types (fail-closed: missing docType = skip)
  if (!isDurationEligibleDocType(opts.docType, opts.format)) {
    return { classification: 'OK', detail: `Duration check skipped: docType '${opts.docType ?? 'null'}' is not runtime-bearing (format=${opts.format ?? 'null'})` };
  }
  const min = opts.targetMin ?? opts.targetScalar ?? 0;
  const max = opts.targetMax ?? opts.targetScalar ?? Infinity;
  if (min > 0 || (max > 0 && max < Infinity)) {
    const tolMin = Math.floor(min * 0.9);
    const tolMax = Math.ceil(max * 1.1);
    if (opts.measuredDurationSeconds < tolMin || opts.measuredDurationSeconds > tolMax) {
      const mid = Math.round((min + max) / 2);
      const delta = opts.measuredDurationSeconds - mid;
      return { classification: 'CRITERIA_FAIL_DURATION', detail: `Duration ${opts.measuredDurationSeconds}s vs target ${min}-${max}s (delta: ${delta > 0 ? '+' : ''}${delta}s)` };
    }
  }
  return { classification: 'OK', detail: 'Criteria met' };
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
  doc: string, blockersCount: number, highImpactCount: number, iterationCount: number,
  allowDefaults = false, targetCi: number = GLOBAL_MIN_CI,
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
  // ── IEL: Relax early-stage high-impact gate when allow_defaults=true AND CI >= GLOBAL_MIN_CI ──
  // Rationale: when Auto-Decide is ON and scores already meet the hard CI gate,
  // remaining high-impact notes are refinement-safe and should not block promotion.
  // This allows the executor to auto-promote after successful stabilise cycles.
  if ((doc === "idea" || doc === "concept_brief") && highImpactCount > 0) {
    if (allowDefaults && ci >= targetCi) {
      risk_flags.push("soft_gate:early_stage_high_impact_relaxed");
      reasons.push(`Early-stage high-impact issues (${highImpactCount}) — relaxed: allow_defaults=true, CI=${ci}≥${targetCi}`);
      console.log(`[auto-run][IEL] early_stage_hi_gate_relaxed { doc: "${doc}", highImpactCount: ${highImpactCount}, ci: ${ci}, allow_defaults: true }`);
      // Don't force stabilise — fall through to normal readiness check
    } else {
      risk_flags.push("hard_gate:early_stage_high_impact");
      reasons.push("Early-stage high-impact issues");
      return { recommendation: "stabilise", readiness_score: readinessScore, confidence, risk_flags, reasons };
    }
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

// Request-scoped userId for forwarding to downstream edge functions
let _requestScopedUserId: string | null = null;

// ── Helper: call another edge function (with retry on qualification errors) ──
async function callEdgeFunction(
  supabaseUrl: string, functionName: string, body: any, token: string, forwardUserId?: string | null
): Promise<any> {
  // Inject userId into body so dev-engine-v2 can use it for created_by/user_id in service_role mode
  const effectiveUserId = forwardUserId ?? _requestScopedUserId;
  const enrichedBody = effectiveUserId ? { ...body, userId: effectiveUserId } : body;
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  // DEBUG: temporary log to verify token forwarding (remove after verification)
  const hasBearer = token && token.length > 20;
  const tokenRole = hasBearer ? (() => { try { const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.role || "unknown"; } catch { return "parse_error"; } })() : "missing";
  console.log(`[auto-run] callEdgeFunction → ${functionName}: token_present=${hasBearer}, role=${tokenRole}, token_prefix=${token?.slice(0, 15)}...`);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(enrichedBody),
    });
  } catch (fetchErr: any) {
    throw Object.assign(new Error(`${functionName} network error: ${fetchErr.message}`), {
      structured: true, code: "EDGE_FUNCTION_NETWORK_ERROR", status: 0, body: fetchErr.message,
    });
  }
  const raw = await resp.text();

  // ── IEL: Detect HTML/non-JSON responses (502/504 gateway timeouts) ──
  const ct = resp.headers.get("content-type") || "";
  const isHtml = raw.trimStart().startsWith("<!") || raw.includes("<html");
  if (isHtml || (!ct.includes("application/json") && raw.length > 0 && !raw.trimStart().startsWith("{"))) {
    const errorCode = isHtml ? "HTML_RESPONSE" : "NON_JSON_RESPONSE";
    console.error(`[auto-run][IEL] non_json_response_detected { function: "${functionName}", status: ${resp.status}, content_type: "${ct}", error_code: "${errorCode}", body_prefix: "${raw.slice(0, 200)}" }`);
    const userMsg = resp.status === 502 || resp.status === 504
      ? `${functionName} timed out (${resp.status}). Will retry.`
      : `${functionName} returned non-JSON (${resp.status}).`;
    throw Object.assign(new Error(userMsg), {
      structured: true, code: errorCode, status: resp.status, body: raw.slice(0, 300),
      retryable: resp.status === 502 || resp.status === 504,
    });
  }

  if (!resp.ok) {
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* use raw snippet */ }
    const snippet = parsed?.error || raw.slice(0, 1000);
    console.error(`[auto-run][IEL] upstream_error_normalized { function: "${functionName}", status: ${resp.status}, error_code: "EDGE_FUNCTION_FAILED" }`);
    throw Object.assign(new Error(`${functionName} error (${resp.status}): ${snippet}`), {
      structured: true, code: "EDGE_FUNCTION_FAILED", status: resp.status, body: raw.slice(0, 1000),
    });
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`[auto-run][IEL] json_parse_failed { function: "${functionName}", status: ${resp.status}, body_prefix: "${raw.slice(0, 200)}" }`);
    throw Object.assign(new Error(`${functionName} returned invalid JSON (${resp.status}): ${raw.slice(0, 500)}`), {
      structured: true, code: "EDGE_FUNCTION_INVALID_JSON", status: resp.status, body: raw.slice(0, 1000),
    });
  }
  return data;
}

async function callEdgeFunctionWithRetry(
  supabase: any, supabaseUrl: string, functionName: string, body: any, token: string,
  projectId: string, format: string, currentDoc: DocStage,
  jobId: string, stepCount: number, forwardUserId?: string | null
): Promise<{ result: any; retried: boolean }> {
  try {
    const result = await callEdgeFunction(supabaseUrl, functionName, body, token, forwardUserId);
    return { result, retried: false };
  } catch (e: any) {
    // ── IEL: Retry on transient 502/504 (gateway timeout) with backoff ──
    if (e.retryable === true) {
      console.log(`[auto-run][IEL] retry_attempt { attempt: 1, error_code: "${e.code}", status: ${e.status}, function: "${functionName}" }`);
      await new Promise(r => setTimeout(r, 3000));
      try {
        const result = await callEdgeFunction(supabaseUrl, functionName, body, token, forwardUserId);
        return { result, retried: true };
      } catch (retryErr: any) {
        console.error(`[auto-run][IEL] escalation_after_retries { attempts: 2, error_code: "${retryErr.code || e.code}", function: "${functionName}" }`);
        throw retryErr;
      }
    }

    if (!isQualificationError(e.message)) throw e;

    // Attempt blockage resolve
    const preflight = await runPreflight(supabase, projectId, format, currentDoc);
    if (preflight.changed) {
      await logStep(supabase, jobId, stepCount, currentDoc, "blockage_resolve",
        `Resolved missing qualifications: ${Object.keys(preflight.resolved).join(", ")}`,
      );
    }

    // Retry once
    const result = await callEdgeFunction(supabaseUrl, functionName, body, token, forwardUserId);
    return { result, retried: true };
  }
}

// ── Helper: log a step + emit auto-run step lifecycle transition ──
// stepIndex: pass null to auto-allocate via atomic DB increment (nextStepIndex).
// Returns the step_index that was used.
// ── TRANSITION LEDGER: emits auto_run_step_started / auto_run_step_completed / auto_run_step_failed ──
const STEP_FAILURE_ACTIONS = new Set(["ci_gate_blocked", "ci_blocker_gate_blocked", "doc_type_unregistered", "error", "failed", "rewrite_failed", "blockage_failed"]);
const STEP_START_ACTIONS = new Set(["start", "restart_from_stage", "seed_pack_ensured", "preflight_resolve", "doc_slots_ensured"]);
async function logStep(
  supabase: any,
  jobId: string,
  stepIndex: number | null,
  document: string,
  action: string,
  summary: string,
  scores: { ci?: number; gp?: number; gap?: number; readiness?: number; confidence?: number; risk_flags?: string[] } = {},
  outputText?: string,
  outputRef?: any
): Promise<number> {
  const idx = stepIndex !== null && stepIndex !== undefined
    ? stepIndex
    : await nextStepIndex(supabase, jobId);
  await supabase.from("auto_run_steps").insert({
    job_id: jobId,
    step_index: idx,
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

  // ── TRANSITION LEDGER: emit step lifecycle event (non-critical complement to auto_run_steps) ──
  try {
    const { data: jobRow } = await supabase.from("auto_run_jobs")
      .select("project_id").eq("id", jobId).maybeSingle();
    if (jobRow?.project_id) {
      const isFailed = STEP_FAILURE_ACTIONS.has(action) || action.endsWith("_failed") || action.endsWith("_error");
      const isStarted = STEP_START_ACTIONS.has(action);
      const eventType = isFailed
        ? TRANSITION_EVENTS.AUTO_RUN_STEP_FAILED
        : isStarted
          ? TRANSITION_EVENTS.AUTO_RUN_STEP_STARTED
          : TRANSITION_EVENTS.AUTO_RUN_STEP_COMPLETED;
      const eventStatus = isFailed ? "failed" : isStarted ? "intent" : "completed";
      await emitTransition(supabase, {
        projectId: jobRow.project_id,
        eventType,
        eventDomain: "auto_run",
        docType: document,
        jobId,
        status: eventStatus,
        trigger: action,
        sourceOfTruth: "auto-run",
        ci: scores.ci,
        gp: scores.gp,
        gap: scores.gap,
        resultingState: { step_index: idx, action, summary: summary?.slice(0, 200) },
      }, { critical: false });
    }
  } catch (e: any) {
    // Non-critical: don't block step persistence
    console.warn(`[auto-run][transition-ledger] step lifecycle emit failed: ${e?.message}`);
  }

  return idx;
}

// ── Helper: emit stage transition to Transition Ledger ──
async function emitStageTransition(
  supabase: any,
  projectId: string,
  jobId: string,
  from: string,
  to: string,
  trigger: string,
  extra: { ci?: number; gp?: number; sourceVersionId?: string; createdBy?: string; lane?: string } = {}
) {
  try {
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.STAGE_TRANSITION_EXECUTED,
      docType: to,
      stage: to,
      lane: extra.lane,
      jobId,
      sourceVersionId: extra.sourceVersionId,
      trigger,
      sourceOfTruth: "auto-run",
      ci: extra.ci,
      gp: extra.gp,
      previousState: { stage: from },
      resultingState: { stage: to },
      createdBy: extra.createdBy,
    }, { critical: false }); // non-critical: stage transition already persisted in job state
  } catch (e: any) {
    console.warn(`[auto-run][transition-ledger] stage_transition emit failed: ${e?.message}`);
  }
}

// ── Helper: emit scoring transition to Transition Ledger ──
async function emitScoringTransition(
  supabase: any,
  projectId: string,
  jobId: string,
  docType: string,
  versionId: string | undefined,
  ci: number | null,
  gp: number | null,
  trigger: string,
) {
  try {
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.CI_GP_SCORES_COMPUTED,
      docType,
      jobId,
      resultingVersionId: versionId,
      ci: ci ?? undefined,
      gp: gp ?? undefined,
      trigger,
      sourceOfTruth: "auto-run",
      resultingState: { ci, gp },
    }, { critical: false });
  } catch (e: any) {
    console.warn(`[auto-run][transition-ledger] scoring emit failed: ${e?.message}`);
  }
}

/**
 * Check if actionable notes remain for a document version.
 * "Actionable" = status in (open, in_progress, reopened), not dismissed/applied/deferred.
 * Returns { hasActionable, count } to gate promotion until notes are exhausted.
 */
/**
 * Returns true if a note requires human intervention.
 * Checks suggested_fixes.requires_human and detail text.
 * Notes without this flag are auto-resolvable by the rewrite loop.
 */
function noteRequiresHuman(note: any): boolean {
  const sf = note?.suggested_fixes;
  const sfFlag =
    (Array.isArray(sf) && sf.some((x: any) => x?.requires_human === true)) ||
    (sf && typeof sf === "object" && !Array.isArray(sf) && (sf as any).requires_human === true);
  const detailFlag =
    typeof note?.detail === "string" &&
    /requires_human\s*:\s*true|"requires_human"\s*:\s*true/i.test(note.detail);
  return sfFlag || detailFlag;
}

/**
 * Returns globalDirections strings for notes that can be auto-resolved.
 * Used to inject note context into the next rewrite so notes are
 * actually addressed in the content before being marked resolved.
 */
async function buildNoteDirectionsForRewrite(
  supabase: any, projectId: string, docType: string,
): Promise<string[]> {
  try {
    const { data: notes } = await supabase
      .from("project_notes")
      .select("id, title, summary, detail, suggested_fixes")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .in("status", ["open", "in_progress", "reopened"])
      .limit(30);
    if (!notes || notes.length === 0) return [];
    return notes
      .filter((n: any) => !noteRequiresHuman(n))
      .map((n: any) => `AUTO-RESOLVE NOTE (${n.id}): ${n.summary || n.title || "untitled"}. Address this fully in the rewrite.`);
  } catch {
    return [];
  }
}

async function checkActionableNoteExhaustion(
  supabase: any, projectId: string, docType: string, versionId: string | null,
): Promise<{ hasActionable: boolean; count: number }> {
  try {
    const actionableStatuses = ["open", "in_progress", "reopened"];
    const { data: notes, error } = await supabase
      .from("project_notes")
      .select("id, title, suggested_fixes, detail")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .in("status", actionableStatuses)
      .limit(50);

    if (error) {
      console.warn(`[auto-run][IEL] actionable_note_check_failed { project_id: "${projectId}", doc_type: "${docType}", error: "${error.message}" }`);
      return { hasActionable: false, count: 0 }; // fail open
    }

    // Only HUMAN-REQUIRED notes block promotion — auto-resolvable notes are handled by rewrite loop
    const humanNotes = (notes || []).filter(noteRequiresHuman);
    const totalCount = (notes || []).length;
    console.log(`[auto-run][IEL] actionable_note_exhaustion_check { project_id: "${projectId}", doc_type: "${docType}", version_id: "${versionId}", actionable_count: ${totalCount}, requires_human_count: ${humanNotes.length} }`);
    return { hasActionable: humanNotes.length > 0, count: humanNotes.length };
  } catch (e: any) {
    console.warn(`[auto-run][IEL] actionable_note_check_exception { error: "${e?.message}" }`);
    return { hasActionable: false, count: 0 }; // fail open
  }
}

/**
 * Auto-resolve actionable project_notes after a successful rewrite.
 * Marks notes as 'resolved' with resolved_by='auto_run' so the note
 * exhaustion gate no longer blocks promotion.
 *
 * Only resolves notes where status is actionable (open/in_progress/reopened).
 * Notes that are 'rejected' or 'dismissed' are untouched.
 * Returns { resolved: number, notes: Array<{id, title}> }
 */
async function autoResolveActionableNotes(
  supabase: any, projectId: string, docType: string, versionId: string | null,
  jobId: string, resolverLabel: string = "auto_run",
): Promise<{ resolved: number; notes: Array<{ id: string; title: string }> }> {
  try {
    const { data: notes, error } = await supabase
      .from("project_notes")
      .select("id, title, summary, severity, suggested_fixes, detail")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .in("status", ["open", "in_progress", "reopened"])
      .limit(50);

    if (error || !notes || notes.length === 0) return { resolved: 0, notes: [] };

    // Only resolve notes that do NOT require human intervention
    const autoNotes = notes.filter((n: any) => !noteRequiresHuman(n));
    if (autoNotes.length === 0) return { resolved: 0, notes: [] };

    const ids = autoNotes.map((n: any) => n.id);
    await supabase
      .from("project_notes")
      .update({ status: "resolved", updated_at: new Date().toISOString() })
      .in("id", ids);

    // Audit via project_note_events
    await supabase.from("project_note_events").insert(
      autoNotes.map((n: any) => ({
        project_id: projectId,
        note_id: n.id,
        event_type: "note_auto_resolved",
        payload: { resolved_by: resolverLabel, job_id: jobId, doc_type: docType, version_id: versionId },
        created_by: null,
      }))
    ).catch((e: any) => console.warn(`[auto-run][IEL] note_event_insert_failed: ${e?.message}`));

    for (const n of autoNotes) {
      console.log(`[auto-run][IEL] note_auto_resolved { note_id: "${n.id}", summary: "${(n.summary || n.title || "").slice(0, 100).replaceAll('"', '\\"')}", job_id: "${jobId}" }`);
    }

    return {
      resolved: autoNotes.length,
      notes: autoNotes.map((n: any) => ({ id: n.id, title: n.title || n.summary?.slice(0, 80) || "untitled" })),
    };
  } catch (e: any) {
    console.warn(`[auto-run][IEL] auto_resolve_notes_failed { error: "${e?.message}" }`);
    return { resolved: 0, notes: [] };
  }
}


async function updateJob(supabase: any, jobId: string, fields: Record<string, any>) {
  // PATCH 5: Intercept completion — run gates before allowing status="completed"
  if (fields.status === "completed") {
    try {
      // Fetch job to get project_id, target_document, format
      const { data: job } = await supabase.from("auto_run_jobs").select("project_id, target_document").eq("id", jobId).single();
      if (job) {
        // Get format
        const { data: proj } = await supabase.from("projects").select("format").eq("id", job.project_id).single();
        const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");

        const gateResult = await completionGate(supabase, job.project_id, job.target_document, fmt);
        if (gateResult) {
          // Gate failed — override to paused
          console.warn(`[auto-run] Completion gate BLOCKED: ${gateResult.stop_reason} — ${gateResult.details}`);
          fields.status = "paused";
          fields.stop_reason = gateResult.stop_reason;
          fields.pause_reason = gateResult.stop_reason;
          fields.error = gateResult.details;
        }
      }
    } catch (gateErr: any) {
      console.error(`[auto-run] Completion gate error (FAIL-CLOSED): ${gateErr.message}`);
      fields.status = "paused";
      fields.stop_reason = "CANON_MISMATCH";
      fields.pause_reason = "CANON_MISMATCH";
      fields.error = `CANON_MISMATCH: completion gate error: ${gateErr.message}`;
    }
  }
  await supabase.from("auto_run_jobs").update(fields).eq("id", jobId);

  // ── TRANSITION LEDGER: auto-emit on stage change (deduplicated) ──
  if (fields.current_document) {
    try {
      // Fetch PREVIOUS job state to compare — only emit if stage actually changed
      const { data: jobRow } = await supabase.from("auto_run_jobs")
        .select("project_id, current_document, last_ci, last_gp, user_id")
        .eq("id", jobId).single();
      // DUPLICATE GUARD: only emit if the stage actually changed (not a no-op update)
      if (jobRow?.project_id && jobRow.current_document !== fields.current_document) {
        await emitStageTransition(
          supabase, jobRow.project_id, jobId,
          jobRow.current_document || "unknown",
          fields.current_document,
          "updateJob",
          { ci: fields.last_ci ?? jobRow.last_ci, gp: fields.last_gp ?? jobRow.last_gp, createdBy: jobRow.user_id }
        );
      }
    } catch (e: any) {
      console.warn(`[auto-run][transition-ledger] updateJob stage emit failed: ${e?.message}`);
    }
  }
}

// ── Helper: buildFormatRulesSeedBlock — deterministic format constraints injected into Format Rules rewrite ──
// Raises cold-start CI from ~20 to ~70+ by seeding known constraints before convergence loop runs.
// Only fires for formats with known deterministic rules. Falls through silently for unknown formats.
function buildFormatRulesSeedBlock(format: string, project: any): string {
  const f = (format || "").toLowerCase().replace(/_/g, "-");

  if (f === "vertical-drama") {
    const title = project?.title || "this project";
    const episodeCount = project?.meta_json?.episode_count || project?.episode_count || 30;
    const episodeDurationMin = project?.meta_json?.episode_duration_min || 90;
    const episodeDurationMax = project?.meta_json?.episode_duration_max || 150;
    return `\n\nFORMAT RULES SEED — BASELINE CONSTRAINTS (deterministic — must be preserved in all rewrites):
This is a Vertical Drama (mobile-first, portrait). The Format Rules document for "${title}" MUST include and correctly define all of the following:

TECHNICAL SPECS:
- Screen ratio: 9:16 (portrait, mobile-first)
- Episode count: ${episodeCount} episodes per season
- Episode duration: ${episodeDurationMin}–${episodeDurationMax} seconds per episode (~${Math.round((episodeDurationMin + episodeDurationMax) / 2 * 1.5)} words of combined action + dialogue)
- Viewing context: single-hand mobile, vertical scroll, fragmented attention — optimise for immediate hook

STRUCTURAL REQUIREMENTS (mandatory per episode):
- Hook rule: audience must be captured within the FIRST 15 SECONDS — cold opens, mid-action, or high-tension dialogue only
- Episode architecture: 3-beat cadence — HOOK / ESCALATION / CLIFFHANGER
- Cliffhanger: mandatory on every episode end (emotional, physical, or revelatory)
- Act breaks: no traditional 3-act structure per episode — use beat-driven micro-escalation

PRODUCTION DISCIPLINE:
- Location rule: 1–2 primary locations per episode (practicals preferred, no complex production moves)
- Cast per episode: 2–4 speaking characters maximum unless justified by scale
- Visual grammar: close-up driven, emotion-forward framing — faces, hands, eyes
- Dialogue style: high emotional density, minimal exposition, subtext-first — no speeches
- Pacing: no slow build — every scene must either escalate tension or deepen character

CONTENT BOUNDARIES (what Format Rules MUST NOT contain):
- No season arc or character backstory → belongs in Season Arc / Character Bible
- No episode summaries or story content → belongs in Episode Grid
- No casting notes or market data → belongs in Character Bible / Market Sheet
All Format Rules content must be operational rules, not narrative content.\n`;
  }

  if (f === "film" || f === "feature") {
    return `\n\nFORMAT RULES SEED — BASELINE CONSTRAINTS (deterministic):
This is a Feature Film. Format Rules must define: target runtime (85–120 minutes), three-act structure with locked act-break page ranges, scene length guidelines, dialogue/action ratio, visual storytelling standards, and production grade (budget tier constraints).\n`;
  }

  if (f === "tv-series" || f === "limited-series" || f === "digital-series") {
    const episodeCount = project?.meta_json?.episode_count || 10;
    return `\n\nFORMAT RULES SEED — BASELINE CONSTRAINTS (deterministic):
This is a TV/Series format. Format Rules must define: episode count (${episodeCount}), episode runtime (43–52 min drama / 22–30 min comedy), act structure with commercial break positions, cold open requirement, series spine vs episodic balance, and broadcast/streaming platform specs.\n`;
  }

  return ""; // unknown format — no seed, fall through to AI generation as before
}

// ── Helper: lockNarrativeSpine — fires when Concept Brief is approved ──
// Transitions the pending_lock decision_ledger spine entry to locked=true, status='active'.
// No-op if already locked or if no pending_lock entry exists (user hasn't confirmed yet — diagnostic only).
async function lockNarrativeSpine(supabase: any, projectId: string, docType: string): Promise<void> {
  if (docType !== 'concept_brief') return; // only fires on CB approval
  try {
    const { data: entries } = await supabase
      .from('decision_ledger')
      .select('id, locked, status')
      .eq('project_id', projectId)
      .eq('decision_key', 'narrative_spine')
      .in('status', ['pending_lock', 'active']);
    if (!entries || entries.length === 0) {
      console.log(`[auto-run][spine] spine_lock_skipped { project_id: "${projectId}", reason: "no_spine_entry" }`);
      return;
    }
    const activeEntry = entries.find((e: any) => e.status === 'active' && e.locked === true);
    if (activeEntry) {
      console.log(`[auto-run][spine] spine_lock_skipped { project_id: "${projectId}", reason: "already_locked", entry_id: "${activeEntry.id}" }`);
      return;
    }
    const pendingEntry = entries.find((e: any) => e.status === 'pending_lock');
    if (!pendingEntry) {
      console.log(`[auto-run][spine] spine_lock_skipped { project_id: "${projectId}", reason: "not_confirmed_by_user" }`);
      return;
    }
    await supabase
      .from('decision_ledger')
      .update({ locked: true, status: 'active' })
      .eq('id', pendingEntry.id);
    console.log(`[auto-run][spine] spine_locked { project_id: "${projectId}", entry_id: "${pendingEntry.id}", trigger: "concept_brief_approved" }`);
  } catch (e: any) {
    console.warn(`[auto-run][spine] spine_lock_error { project_id: "${projectId}", error: "${e?.message}" }`);
  }
}

// ── Helper: finalize-best — promote best_version_id on job end ──
// INVARIANT: is_current only changes via set_current_version after promotion gate OR finalize.
// STAGE-SCOPED: only promotes if best_document_id matches the explicit currentDocId (the doc being finalized).
async function finalizeBest(supabase: any, jobId: string, job: any, explicitCurrentDocId?: string): Promise<boolean> {
  const bestVersionId = job?.best_version_id;
  if (!bestVersionId) return false;

  // Stage-scope check: best must belong to the document we're currently working on
  const bestDocId = job?.best_document_id;
  const currentDocId = explicitCurrentDocId || job?.resume_document_id || null;
  if (bestDocId && currentDocId && bestDocId !== currentDocId) {
    console.log("[auto-run] finalizeBest no-op: best_document_id does not match current doc", { bestDocId, currentDocId, explicitCurrentDocId });
    return false;
  }

  // Find document for this version
  const { data: ver } = await supabase
    .from("project_document_versions")
    .select("document_id, is_current")
    .eq("id", bestVersionId)
    .maybeSingle();
  if (!ver) return false;

  // Double-check version belongs to the current working document
  if (currentDocId && ver.document_id !== currentDocId) {
    console.log("[auto-run] finalizeBest no-op: version document_id mismatch", { versionDocId: ver.document_id, currentDocId, explicitCurrentDocId });
    return false;
  }

  // If already current, no-op
  if (ver.is_current) return false;

  // Promote via set_current_version
  const { error } = await supabase.rpc("set_current_version", {
    p_document_id: ver.document_id,
    p_new_version_id: bestVersionId,
  });
  if (error) {
    console.error("[auto-run] finalize_promote_best failed:", error.message);
    await logStep(supabase, jobId, null, job.current_document || "unknown", "finalize_promote_best_failed",
      `Failed to promote best version ${bestVersionId}: ${error.message}`);
    return false;
  }

  // ── IEL: Mark finalized best as approved + persist CI/GP atomically ──
  try {
    await persistVersionScores(supabase, {
      versionId: bestVersionId,
      ci: job.best_ci ?? 0,
      gp: job.best_gp ?? 0,
      source: "auto-run-finalize-promote",
      jobId,
      protectHigher: true,
      docType: job.current_document,
    });
  } catch (scoreErr: any) {
    console.warn(`[auto-run][IEL] finalize_score_persist_failed { version_id: "${bestVersionId}", error: "${scoreErr?.message}" }`);
  }
  const { error: approvalErr } = await supabase.from("project_document_versions").update({
    approval_status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: job.user_id,
  }).eq("id", bestVersionId);
  if (approvalErr) {
    console.warn(`[auto-run][IEL] finalize_approval_stamp_failed { version_id: "${bestVersionId}", error: "${approvalErr.message}" }`);
  }
  console.log(`[auto-run][IEL] candidate_accepted_persisted { document_id: "${ver.document_id}", accepted_version_id: "${bestVersionId}", approval_status_set: "approved", ci: ${job.best_ci}, gp: ${job.best_gp}, job_id: "${jobId}", source: "finalize_best" }`);
  // ── NARRATIVE SPINE: lock if this is Concept Brief approval ──
  await lockNarrativeSpine(supabase, job.project_id, job.current_document || "");

  await logStep(supabase, jobId, null, job.current_document || "unknown", "finalize_promote_best",
    `Job ending — promoted best version ${bestVersionId} (CI=${job.best_ci}, GP=${job.best_gp}, score=${job.best_score})`,
    { ci: job.best_ci, gp: job.best_gp }, undefined,
    { best_version_id: bestVersionId, best_document_id: bestDocId, best_ci: job.best_ci, best_gp: job.best_gp, best_score: job.best_score, explicitCurrentDocId });

  // Clear frontier fields
  await updateJob(supabase, jobId, {
    frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
  });

  return true;
}

async function resolveBestScoredEligibleVersionForDoc(
  supabase: any,
  projectId: string,
  docType: string,
): Promise<{ documentId: string; versionId: string; ci: number; gp: number } | null> {
  const { data: docRow } = await supabase.from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!docRow?.id) return null;

  const { data: versions, error } = await supabase.from("project_document_versions")
    .select("id, version_number, approval_status, is_current, meta_json")
    .eq("document_id", docRow.id)
    .order("version_number", { ascending: false });

  if (error || !versions?.length) return null;

  const eligibleScored = (versions || [])
    .map((v: any) => {
      const parsed = parseVersionScores(v.meta_json);
      return {
        id: v.id,
        version_number: v.version_number,
        ci: parsed.ci,
        gp: parsed.gp,
        approval_status: v.approval_status,
        is_current: !!v.is_current,
      };
    })
    .filter((v: any) => (v.approval_status === "approved" || v.is_current) && v.ci !== null && v.gp !== null) as Array<{
      id: string;
      version_number: number;
      ci: number;
      gp: number;
      approval_status: string;
      is_current: boolean;
    }>;

  const best = pickBestScoredVersion(eligibleScored as any);
  if (!best) return null;

  return {
    documentId: docRow.id,
    versionId: best.id,
    ci: best.ci,
    gp: best.gp,
  };
}

async function tryPlateauForcePromote(
  supabase: any,
  params: {
    jobId: string;
    job: any;
    currentDoc: string;
    format: string;
    stepCount: number;
    targetCi: number;
    detectedCi: number;
    detectedBestCi: number;
    plateauVersion: "v1" | "v2";
  }
): Promise<Response | null> {
  const { jobId, job, currentDoc, format, stepCount, targetCi, detectedCi, detectedBestCi, plateauVersion } = params;
  if (!job.allow_defaults) return null;

  // ── Note exhaustion gate: do NOT force-promote if actionable notes remain ──
  try {
    const { data: actionableNotes } = await supabase
      .from("project_notes")
      .select("id, title, severity")
      .eq("project_id", job.project_id)
      .eq("doc_type", currentDoc)
      .in("status", ["open", "in_progress", "reopened"])
      .in("severity", ["blocker", "high"])
      .limit(10);

    if (actionableNotes && actionableNotes.length > 0) {
      await logStep(supabase, jobId, stepCount + 1, currentDoc, "force_promote_deferred_notes",
        `Force-promote deferred: ${actionableNotes.length} actionable note(s) remain for ${currentDoc}. Applying notes before promoting.`,
        { ci: detectedCi },
        undefined,
        {
          plateau_version: plateauVersion,
          note_count: actionableNotes.length,
          note_ids: actionableNotes.map((n: any) => n.id).slice(0, 5),
          note_titles: actionableNotes.map((n: any) => n.title).slice(0, 5),
        }
      );
      return null; // Let rewrite loop apply notes first
    }
  } catch (noteCheckErr: any) {
    // Fail OPEN — if note query fails, proceed with force-promote
    console.warn(`[tryPlateauForcePromote] note exhaustion check failed (proceeding): ${noteCheckErr.message}`);
  }

  const bestForDoc = await resolveBestScoredEligibleVersionForDoc(supabase, job.project_id, currentDoc);
  const docBestCi = bestForDoc?.ci ?? -Infinity;
  const effectiveBestCi = Math.max(
    typeof detectedBestCi === "number" ? detectedBestCi : -Infinity,
    docBestCi,
  );

  if (!bestForDoc || effectiveBestCi < GLOBAL_MIN_CI) return null;

  const ciGapFromTarget = targetCi - effectiveBestCi;
  await logStep(supabase, jobId, stepCount + 1, currentDoc, "ci_plateau_auto_promote",
    `CI plateaued at ${detectedCi} (target: ${targetCi}) but best eligible version is CI:${bestForDoc.ci}, GP:${bestForDoc.gp} (>=${GLOBAL_MIN_CI}). allow_defaults=ON → force-promoting.`,
    { ci: detectedCi, gp: bestForDoc.gp },
    undefined,
    {
      action: "force_promote",
      plateau_version: plateauVersion,
      detected_best_ci: detectedBestCi,
      doc_best_ci: bestForDoc.ci,
      doc_best_gp: bestForDoc.gp,
      global_min_ci: GLOBAL_MIN_CI,
      targetCi,
      best_version_id: bestForDoc.versionId,
      best_document_id: bestForDoc.documentId,
      CONVERGENCE_WARNING: `Force-promoted with CI gap of ${ciGapFromTarget} (best: ${effectiveBestCi}, target: ${targetCi}). Stage did not reach full convergence.`,
      ci_gap: ciGapFromTarget,
    }
  );

  // Append CONVERGENCE_WARNING to stage_history for audit trail
  try {
    const { data: jobRow } = await supabase.from("auto_run_jobs").select("stage_history").eq("id", jobId).single();
    const history = Array.isArray(jobRow?.stage_history) ? jobRow.stage_history : [];
    history.push({
      event: "CONVERGENCE_WARNING",
      doc_type: currentDoc,
      ci_gap: ciGapFromTarget,
      best_ci: effectiveBestCi,
      target_ci: targetCi,
      action: "ci_plateau_auto_promote",
      timestamp: new Date().toISOString(),
    });
    await supabase.from("auto_run_jobs").update({ stage_history: history }).eq("id", jobId);
  } catch (shErr: any) {
    console.warn(`[tryPlateauForcePromote] stage_history append failed: ${shErr?.message}`);
  }

  const { error: promoteErr } = await supabase.rpc("set_current_version", {
    p_document_id: bestForDoc.documentId,
    p_new_version_id: bestForDoc.versionId,
  });

  if (promoteErr) {
    await logStep(supabase, jobId, stepCount + 2, currentDoc, "ci_plateau_force_promote_failed",
      `Force-promote failed while setting best version current: ${promoteErr.message}`,
      { ci: bestForDoc.ci, gp: bestForDoc.gp },
      undefined,
      { best_version_id: bestForDoc.versionId, best_document_id: bestForDoc.documentId, plateau_version: plateauVersion }
    );
    return null;
  }

  // Persist CI/GP scores atomically with approval
  try {
    await persistVersionScores(supabase, {
      versionId: bestForDoc.versionId,
      ci: bestForDoc.ci,
      gp: bestForDoc.gp,
      source: "auto-run-plateau-force-promote",
      jobId,
      protectHigher: true,
      docType: currentDoc,
    });
  } catch (scoreErr: any) {
    console.warn(`[tryPlateauForcePromote] score_persist_failed { version_id: "${bestForDoc.versionId}", error: "${scoreErr?.message}" }`);
  }
  await supabase.from("project_document_versions").update({
    approval_status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: job.user_id,
  }).eq("id", bestForDoc.versionId);
  // ── NARRATIVE SPINE: lock if this is Concept Brief approval ──
  await lockNarrativeSpine(supabase, job.project_id, currentDoc);

  await updateJob(supabase, jobId, {
    best_version_id: bestForDoc.versionId,
    best_document_id: bestForDoc.documentId,
    best_ci: bestForDoc.ci,
    best_gp: bestForDoc.gp,
    best_score: bestForDoc.ci + bestForDoc.gp,
  });

  const nextDoc = await nextUnsatisfiedStage(
    supabase,
    job.project_id,
    format,
    currentDoc,
    job.target_document,
    job.allow_defaults,
    job.user_id,
    jobId,
  );

  if (nextDoc && isStageAtOrBeforeTarget(nextDoc, job.target_document, format)) {
    await logStep(supabase, jobId, stepCount + 2, currentDoc, "ci_plateau_force_promoted",
      `Force-promoted ${currentDoc} from best version (CI:${bestForDoc.ci}, GP:${bestForDoc.gp}) after plateau. Skipped hard_gate:blockers (allow_defaults=ON). Advancing to ${nextDoc}.`,
      { ci: bestForDoc.ci, gp: bestForDoc.gp },
      undefined,
      {
        from: currentDoc,
        to: nextDoc,
        bypass: "hard_gate:blockers",
        best_version_id: bestForDoc.versionId,
        best_document_id: bestForDoc.documentId,
        plateau_version: plateauVersion,
      }
    );

    await updateJob(supabase, jobId, {
      current_document: nextDoc,
      stage_loop_count: 0,
      stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
      status: "running",
      stop_reason: null,
      pause_reason: null,
      error: null,
      awaiting_approval: false,
      approval_type: null,
      pending_doc_id: null,
      pending_version_id: null,
      pending_doc_type: null,
      pending_next_doc_type: null,
      frontier_version_id: null,
      frontier_ci: null,
      frontier_gp: null,
      frontier_attempts: 0,
    });

    await releaseProcessingLock(supabase, jobId);
    return respondWithJob(supabase, jobId, "run-next");
  }

  await updateJob(supabase, jobId, {
    status: "completed",
    stop_reason: "All stages satisfied up to target",
    pause_reason: null,
    error: null,
  });
  await logStep(supabase, jobId, stepCount + 2, currentDoc, "stop", "All stages satisfied up to target (after plateau force-promote)");
  await releaseProcessingLock(supabase, jobId);
  return respondWithJob(supabase, jobId);
}

// ── Helper: get job ──
async function getJob(supabase: any, jobId: string) {
  const { data } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
  return data;
}

// ── Helper: acquire single-flight processing lock ──
// Returns the locked job row if acquired, or null if another invocation holds the lock.
// Uses two sequential CAS attempts to avoid PostgREST .or() issues.
// When actor is "service_role", the user_id filter is skipped so self-chaining works.
async function acquireProcessingLock(supabase: any, jobId: string, userId: string | null, isServiceActor = false): Promise<any | null> {
  const now = new Date().toISOString();
  const lockExpires = new Date(Date.now() + 120_000).toISOString(); // 2 min lock
  const isService = isServiceActor || !userId;

  // Attempt A: normal acquire (is_processing = false)
  let qA = supabase
    .from("auto_run_jobs")
    .update({ is_processing: true, processing_started_at: now, lock_expires_at: lockExpires, last_heartbeat_at: now })
    .eq("id", jobId)
    .eq("status", "running")
    .eq("is_processing", false);
  if (!isService) qA = qA.eq("user_id", userId);
  const { data: rowA } = await qA.select("*").maybeSingle();

  if (rowA) return rowA;

  // Attempt B: stale-lock steal (is_processing = true but older than 60s)
  const staleThreshold = new Date(Date.now() - 60_000).toISOString();
  let qB = supabase
    .from("auto_run_jobs")
    .update({ is_processing: true, processing_started_at: now, lock_expires_at: lockExpires, last_heartbeat_at: now })
    .eq("id", jobId)
    .eq("status", "running")
    .eq("is_processing", true)
    .lt("processing_started_at", staleThreshold);
  if (!isService) qB = qB.eq("user_id", userId);
  const { data: rowB } = await qB.select("*").maybeSingle();

  if (rowB) return rowB;

  return null;
}

// ── Helper: release processing lock ──
async function releaseProcessingLock(supabase: any, jobId: string) {
  await supabase
    .from("auto_run_jobs")
    .update({ is_processing: false, processing_started_at: null, lock_expires_at: null, last_step_at: new Date().toISOString() })
    .eq("id", jobId);
}

// ── Helper: atomically increment step_count and return new value as step_index ──
async function nextStepIndex(supabase: any, jobId: string): Promise<number> {
  // Truly atomic: uses a SECURITY DEFINER DB function that does
  // UPDATE ... SET step_count = step_count + 1 RETURNING step_count
  const { data, error } = await supabase.rpc("increment_step_count", { p_job_id: jobId });
  if (error) {
    console.error("[auto-run] increment_step_count RPC failed, falling back", error.message);
    // Fallback: read-then-write (still protected by processing lock)
    const { data: job } = await supabase
      .from("auto_run_jobs")
      .select("step_count")
      .eq("id", jobId)
      .maybeSingle();
    const next = (job?.step_count ?? 0) + 1;
    await supabase
      .from("auto_run_jobs")
      .update({ step_count: next })
      .eq("id", jobId);
    return next;
  }
  return data as number;
}

// ── Helper: detect if an error is a 502/503 upstream outage ──
function isUpstreamOutage(err: any): boolean {
  const status = err?.status;
  if (status === 502 || status === 503) return true;
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("502") || msg.includes("503") || msg.includes("bad gateway") || msg.includes("temporarily unavailable");
}

// ── Helper: normalize pending decisions from dev-engine-v2 options output ──
interface NormalizedDecision {
  id: string;
  question: string;
  options: { value: string; why: string }[];
  recommended?: string;
  impact: "blocking" | "non_blocking";
}

function normalizePendingDecisions(rawDecisions: any[], context: string, jobId?: string, stepIndex?: number): NormalizedDecision[] {
  if (!Array.isArray(rawDecisions) || rawDecisions.length === 0) return [];
  return rawDecisions.map((d: any, i: number) => {
    const baseId = d.note_id || d.id || `decision_${i}`;
    const stableId = jobId && stepIndex != null ? `${jobId}:${stepIndex}:${baseId}` : baseId;
    return {
      id: stableId,
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
    };
  });
}

// ── Helper: create fallback decisions when options generation fails or returns empty ──
function createFallbackDecisions(currentDoc: string, ci: number, gp: number, reason: string): NormalizedDecision[] {
  return [
    {
      id: "force_promote",
      question: `${reason} at ${currentDoc} (CI:${ci} GP:${gp}). How would you like to proceed?`,
      options: [
        { value: "force_promote", why: "Skip remaining issues and advance to the next stage" },
        { value: "retry", why: "Run another development cycle at the current stage" },
        { value: "stop", why: "Stop the auto-run and review manually" },
      ],
      recommended: "force_promote",
      impact: "blocking",
    },
];
}

// ── Helper: auto-accept decisions when allow_defaults is true ──
// Returns the recommended values for all blocking decisions if every blocking decision has a recommended option.
// Returns null if any blocking decision lacks a recommended option (must pause for user).
function tryAutoAcceptDecisions(decisions: NormalizedDecision[], allowDefaults: boolean): Record<string, string> | null {
  if (!allowDefaults) return null;
  const blocking = decisions.filter(d => d.impact === "blocking");
  // No blocking decisions — auto-decide can skip optional ones and continue
  if (blocking.length === 0) return {};
  const selections: Record<string, string> = {};
  for (const d of blocking) {
    if (d.recommended) {
      selections[d.id] = d.recommended;
    } else if (d.options && d.options.length > 0) {
      // Auto-decide: pick first option when no recommendation exists
      selections[d.id] = d.options[0].value;
    } else {
      // Full Autopilot: never block — synthesize a "force_promote" fallback
      console.warn(`[auto-run] tryAutoAcceptDecisions: decision ${d.id} has no options, auto-selecting force_promote`);
      selections[d.id] = "force_promote";
    }
  }
  return selections;
}

// ── Helper: build accepted decisions bundle from most recent auto_decided step ──
// Reads decision_objects + selections from the auto_decided step's output_ref.
// Returns null if no recent auto_decided step exists for this job+document.
interface AcceptedDecisionBundle {
  accepted_decisions: { key: string; chosen_id: string; question: string; chosen_text: string }[];
  accepted_decisions_compact_text: string;
  accepted_decisions_hash: string;
  accepted_decisions_keys: string[];
}

async function buildAcceptedDecisionsBundle(
  supabase: any, jobId: string, currentDoc: string
): Promise<AcceptedDecisionBundle | null> {
  // Find most recent auto_decided step for this job + document
  const { data: decidedStep } = await supabase
    .from("auto_run_steps")
    .select("output_ref")
    .eq("job_id", jobId)
    .eq("document", currentDoc)
    .eq("action", "auto_decided")
    .order("step_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!decidedStep?.output_ref) return null;

  const selections: Record<string, string> = decidedStep.output_ref.selections || {};
  const decisionObjects: NormalizedDecision[] = decidedStep.output_ref.decision_objects || [];

  if (Object.keys(selections).length === 0) return null;

  // Build the bundle by matching selections to decision objects
  const accepted: AcceptedDecisionBundle["accepted_decisions"] = [];
  const sortedKeys = Object.keys(selections).sort();

  for (const key of sortedKeys) {
    const chosenId = selections[key];
    const decObj = decisionObjects.find((d: NormalizedDecision) => d.id === key);
    const chosenOpt = decObj?.options?.find((o: { value: string; why: string }) => o.value === chosenId);
    accepted.push({
      key,
      chosen_id: chosenId,
      question: decObj?.question || key,
      chosen_text: chosenOpt?.why || chosenId,
    });
  }

  const compactLines = accepted.map((a, i) =>
    `${i + 1}) [${a.chosen_id}] ${a.question} → FIX: ${a.chosen_text}`
  );

  // Stable hash: sorted key+chosen_id pairs
  const hashInput = sortedKeys.map(k => `${k}=${selections[k]}`).join("|");
  // Simple string hash
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const chr = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  const hashStr = Math.abs(hash).toString(36);

  return {
    accepted_decisions: accepted,
    accepted_decisions_compact_text: compactLines.join("\n"),
    accepted_decisions_hash: hashStr,
    accepted_decisions_keys: sortedKeys.slice(0, 20),
  };
}

// ── CANON-LOCK: Entity normalization + prioritization helpers ──

const MAX_CANON_ENTITIES_STORED = 300;
// Structural/meta labels that should never be injected as canon entities
const CANON_NOISE_BLOCKLIST = new Set([
  "topline", "logline", "story_pillars", "story pillars", "premise",
  "synopsis", "treatment", "outline", "act one", "act two", "act three",
  "the hook", "the stakes", "the conflict", "the resolution",
  "episode", "scene", "fade in", "fade out", "cut to",
  "int", "ext", "continuous", "later", "meanwhile",
  "format", "genre", "tone", "style", "theme", "world rules",
  "characters", "locations", "timeline", "ongoing threads",
]);

/**
 * Normalize + de-noise canon entity list (deterministic).
 * Trims, deduplicates, removes noise tokens.
 */
function normalizeCanonEntities(raw: string[]): string[] {
  const rawCount = raw.length;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entity of raw) {
    // Trim + collapse whitespace
    const trimmed = entity.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;

    // Drop short entities (< 3 chars)
    if (trimmed.length < 3) continue;

    // Drop purely numeric
    if (/^\d+$/.test(trimmed)) continue;

    // Drop blocklisted structural terms (case-insensitive)
    if (CANON_NOISE_BLOCKLIST.has(trimmed.toLowerCase())) continue;

    // Deduplicate (case-insensitive)
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push(trimmed);
  }

  // Cap to prevent prompt bloat
  const normalized = result.slice(0, MAX_CANON_ENTITIES_STORED);
  const droppedCount = rawCount - normalized.length;
  if (droppedCount > 0) {
    console.log(`[auto-run] normalizeCanonEntities: raw=${rawCount}, normalized=${normalized.length}, dropped=${droppedCount}`);
  }
  return normalized;
}

/**
 * Prioritize entities into core (immutable anchors) vs secondary.
 * Core: Title Case multi-word names (likely characters/places).
 * Secondary: everything else.
 */
function prioritizeCanonEntities(entities: string[]): { core: string[]; secondary: string[] } {
  const core: string[] = [];
  const secondary: string[] = [];

  for (const entity of entities) {
    // Core heuristic: multi-word Title Case (capitalized first letter of each word)
    // e.g., "Sarah Chen", "Old Town District", "Detective Rodriguez"
    const words = entity.split(/\s+/);
    const isTitleCase = words.length >= 2 && words.every(w => /^[A-Z]/.test(w));
    // Also core: single uppercase word >= 4 chars that isn't all-caps noise
    const isSingleProper = words.length === 1 && /^[A-Z][a-z]{3,}/.test(entity);

    if (isTitleCase || isSingleProper) {
      core.push(entity);
    } else {
      secondary.push(entity);
    }
  }

  // Cap core to 30, secondary to 80
  return {
    core: core.slice(0, 30),
    secondary: secondary.slice(0, 80),
  };
}

// ── Chunked rewrite pipeline helper ──
// Falls back to rewrite-plan/rewrite-chunk/rewrite-assemble when a document is too long for single-pass rewrite.
// Returns { candidateVersionId } from the assemble step's newVersion.
async function chunkedRewrite(
  supabase: any, supabaseUrl: string, token: string,
  params: { projectId: string; documentId: string; versionId: string; approvedNotes: any[]; protectItems: any[]; deliverableType: string; developmentBehavior: string; format: string; selectedOptions?: any[]; globalDirections?: string[]; episode_target_duration_seconds?: number; season_episode_count?: number },
  jobId: string, stepCount: number
): Promise<{ candidateVersionId: string | null }> {
  const { projectId, documentId, versionId, approvedNotes, protectItems, deliverableType, format, selectedOptions, globalDirections } = params;

  // Step 1: Plan
  const planResult = await callEdgeFunctionWithRetry(
    supabase, supabaseUrl, "dev-engine-v2", {
      action: "rewrite-plan",
      projectId, documentId, versionId,
      approvedNotes, protectItems,
    }, token, projectId, format, deliverableType, jobId, stepCount
  );
  const planRunId = planResult?.result?.planRunId || planResult?.planRunId;
  const totalChunks = planResult?.result?.totalChunks || planResult?.totalChunks || 1;
  if (!planRunId) throw new Error("Chunked rewrite plan failed: no planRunId returned");

  // Step 2: Rewrite each chunk
  const rewrittenChunks: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const prevEnding = i > 0 ? rewrittenChunks[i - 1].slice(-500) : undefined;
    const chunkResult = await callEdgeFunctionWithRetry(
      supabase, supabaseUrl, "dev-engine-v2", {
        action: "rewrite-chunk",
        planRunId,
        chunkIndex: i,
        previousChunkEnding: prevEnding,
      }, token, projectId, format, deliverableType, jobId, stepCount
    );
    const text = chunkResult?.result?.rewrittenText || chunkResult?.rewrittenText || "";
    rewrittenChunks.push(text);
  }

  // Step 3: Assemble
  const assembledText = rewrittenChunks.join("\n\n");
  const assembleResult = await callEdgeFunctionWithRetry(
    supabase, supabaseUrl, "dev-engine-v2", {
      action: "rewrite-assemble",
      projectId, documentId, versionId,
      planRunId, assembledText,
      deliverableType,
    }, token, projectId, format, deliverableType, jobId, stepCount
  );

  // Extract candidateVersionId from assemble response
  const candidateVersionId = assembleResult?.result?.newVersion?.id || assembleResult?.newVersion?.id || null;
  return { candidateVersionId };
}

// Wrapper: tries single-pass rewrite, falls back to chunked pipeline on needsPipeline error.
// Returns { candidateVersionId } — explicitly extracted from the rewrite response.
// ── TRANSITION LEDGER: emits rewrite_pass_executed / rewrite_pass_failed ──
async function rewriteWithFallback(
  supabase: any, supabaseUrl: string, token: string,
  rewriteBody: Record<string, any>,
  jobId: string, stepCount: number,
  format: string, deliverableType: string
): Promise<{ candidateVersionId: string | null; raw?: any }> {
  const projectId = rewriteBody.projectId;
  const sourceVersionId = rewriteBody.versionId;
  try {
    const result = await callEdgeFunctionWithRetry(
      supabase, supabaseUrl, "dev-engine-v2", {
        action: "rewrite",
        ...rewriteBody,
      }, token, rewriteBody.projectId, format, deliverableType, jobId, stepCount
    );
    // Extract candidateVersionId from single-pass rewrite response
    const candidateVersionId = result?.result?.newVersion?.id || result?.newVersion?.id || null;
    // ── TRANSITION LEDGER: rewrite_pass_executed ──
    if (projectId) {
      await emitTransition(supabase, {
        projectId, eventType: TRANSITION_EVENTS.REWRITE_PASS_EXECUTED,
        docType: deliverableType, stage: deliverableType, jobId,
        sourceVersionId, resultingVersionId: candidateVersionId || undefined,
        trigger: "single_pass", sourceOfTruth: "auto-run",
        resultingState: { mode: "single_pass", candidateVersionId },
      });
    }
    return { candidateVersionId, raw: result };
  } catch (e: any) {
    // Detect needsPipeline from the error message (400 response gets thrown)
    if (e.message && (
      e.message.includes("needsPipeline") ||
      e.message.includes("too long for single-pass") ||
      e.message.toLowerCase().includes("large-risk doc type")
    )) {
      console.log(`[auto-run] Document requires chunked rewrite pipeline, using chunked pipeline`);
      const chunkedResult = await chunkedRewrite(supabase, supabaseUrl, token, {
        projectId: rewriteBody.projectId,
        documentId: rewriteBody.documentId,
        versionId: rewriteBody.versionId,
        approvedNotes: rewriteBody.approvedNotes || [],
        protectItems: rewriteBody.protectItems || [],
        deliverableType,
        developmentBehavior: rewriteBody.developmentBehavior || "market",
        format,
        selectedOptions: rewriteBody.selectedOptions,
        globalDirections: rewriteBody.globalDirections,
      }, jobId, stepCount);
      // ── TRANSITION LEDGER: rewrite_pass_executed (chunked) ──
      if (projectId) {
        await emitTransition(supabase, {
          projectId, eventType: TRANSITION_EVENTS.REWRITE_PASS_EXECUTED,
          docType: deliverableType, stage: deliverableType, jobId,
          sourceVersionId, resultingVersionId: chunkedResult.candidateVersionId || undefined,
          trigger: "chunked_pipeline", sourceOfTruth: "auto-run",
          resultingState: { mode: "chunked_pipeline", candidateVersionId: chunkedResult.candidateVersionId },
        });
      }
      return { candidateVersionId: chunkedResult.candidateVersionId };
    }
    // ── TRANSITION LEDGER: rewrite_pass_failed ──
    if (projectId) {
      try {
        await emitTransition(supabase, {
          projectId, eventType: TRANSITION_EVENTS.REWRITE_PASS_FAILED,
          docType: deliverableType, stage: deliverableType, jobId,
          sourceVersionId, status: "failed", trigger: "rewrite_error", sourceOfTruth: "auto-run",
          resultingState: { error: e?.message?.slice(0, 500) },
        }, { critical: false });
      } catch (_) { /* non-critical */ }
    }
    throw e;
  }
}

// v4 — dynamic CORS with origin echo for credentials support
Deno.serve(async (req) => {
  // Set module-level origin for dynamic CORS headers used everywhere
  _currentReqOrigin = req.headers.get("origin") || "*";

  const pingJson = { ok: true, ts: new Date().toISOString(), function: "auto-run", build: BUILD };

  // 1) CORS preflight — 204 with headers only
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders() });
  }

  // 2) GET → unauthenticated ping (NO body read, NO auth, NO ladder check)
  if (req.method === "GET") {
    return jsonRes(pingJson, 200);
  }

  // 3) Parse body safely ONCE
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || null;

  // 4) POST ping → unauthenticated
  if (action === "ping") {
    return jsonRes(pingJson, 200);
  }

  // 5) All other actions proceed to auth/ladder logic
  console.log("[auto-run] request_in", { method: req.method, origin: req.headers.get("origin"), hasAuth: !!req.headers.get("authorization") });
  console.log("[auto-run] reached_main", { method: req.method, action });

  try {
    if (!FORMAT_LADDERS || typeof FORMAT_LADDERS !== "object" || Object.keys(FORMAT_LADDERS).length === 0) {
      return respond({ error: "STAGE_LADDERS_LOAD_FAILED" }, 500);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ error: "Unauthorized" }, 401);
    }
    const incomingToken = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Use serviceKey for ALL downstream edge function calls.
    // The user JWT may expire during long-running background tasks or self-chained requests.
    // Since auto-run already operates with service_role privileges, this is safe.
    const token = serviceKey;
    console.log("[auto-run] auth: using service_role token for downstream calls, incoming token verified separately");

    // Verify user — allow service_role tokens for internal CI/automation
    let userId: string | null = null;
    let actor: "user" | "service_role" = "user";

    // Check raw service key FIRST (non-JWT keys like sb_secret_...)
    if (incomingToken === serviceKey) {
      actor = "service_role";
      console.log("[auto-run] service_role actor accepted (raw key match)");
    } else if (incomingToken.split(".").length === 3) {
      // JWT path
      try {
        const seg = incomingToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
        const jwtPayload = JSON.parse(atob(padded));
        if (jwtPayload.exp && jwtPayload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
        if (jwtPayload.role === "service_role") {
          actor = "service_role";
          console.log("[auto-run] service_role actor accepted (JWT claim)");
        } else if (jwtPayload.sub) {
          userId = jwtPayload.sub;
        } else {
          throw new Error("Invalid token claims");
        }
      } catch (e: any) {
        console.error("[auto-run] JWT parse failed:", e?.message);
        // Fallback: try getUser for user JWTs
        try {
          const { data: { user }, error: userErr } = await supabase.auth.getUser(incomingToken);
          if (userErr || !user) return respond({ error: "Unauthorized" }, 401);
          userId = user.id;
        } catch {
          return respond({ error: "Unauthorized" }, 401);
        }
      }
    } else {
      // Not a JWT and not the service key
      return respond({ error: "Unauthorized" }, 401);
    }

    // For non-service actors that didn't get userId from JWT, verify via getUser
    if (actor !== "service_role" && !userId) {
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser(incomingToken);
        if (userErr || !user) return respond({ error: "Unauthorized" }, 401);
        userId = user.id;
      } catch {
        return respond({ error: "Unauthorized" }, 401);
      }
    }

    // Body already parsed above (before auth gate)

    // Set request-scoped userId for downstream calls
    // For service_role: use forwarded userId from body, or null (NEVER "service_role")
    if (actor === "service_role") {
      userId = body?.userId || body?.user_id || null;
    }
    _requestScopedUserId = userId;

    const { projectId, jobId, mode, start_document, target_document, max_stage_loops, max_total_steps, decision, new_step_limit } = body;

    console.log("[auto-run] auth", { fn: "auto-run", isServiceRole: actor === "service_role", hasActorUserId: !!userId, hasForwardedUserId: !!(body?.userId || body?.user_id), action });

    // ═══════════════════════════════════════
    // ACTION: debug-completion-gate (ADMIN-ONLY, READ-ONLY)
    // ═══════════════════════════════════════
    if (action === "debug-completion-gate") {
      // Gate: service_role or authenticated user with project access
      if (actor !== "service_role" && !userId) {
        return respond({ error: "Unauthorized: auth required" }, 401);
      }
      const debugProjectId = body.project_id || projectId;
      const debugTarget = body.target_document || "season_master_script";
      if (!debugProjectId) return respond({ error: "project_id required" }, 400);

      const { data: proj } = await supabase.from("projects").select("format").eq("id", debugProjectId).single();
      const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");

      try {
        const gateResult = await completionGate(supabase, debugProjectId, debugTarget, fmt);
        return respond({
          ok: true,
          project_id: debugProjectId,
          target_document: debugTarget,
          format: fmt,
          gateResult: gateResult || null,
        });
      } catch (err: any) {
        return respond({
          ok: false,
          project_id: debugProjectId,
          target_document: debugTarget,
          format: fmt,
          error: err.message,
        }, 500);
      }
    }

    // ═══════════════════════════════════════
    // ACTION: update-step-limit
    // ═══════════════════════════════════════
    if (action === "update-step-limit") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const HARD_MAX_STEPS = 1000;
      const limit = Math.max(1, Math.min(Number(new_step_limit) || 1, HARD_MAX_STEPS));
      const { error: updErr } = await supabase.from("auto_run_jobs")
        .update({ max_total_steps: limit })
        .eq("id", jobId).eq("user_id", userId);
      if (updErr) return respond({ error: updErr.message }, 500);
      return respondWithJob(supabase, jobId, "none");
    }

    // ═══════════════════════════════════════
    // ACTION: update-version-cap
    // ═══════════════════════════════════════
    if (action === "update-version-cap") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const rawCap = Number(body.max_versions_per_doc_per_job);
      if (!rawCap || isNaN(rawCap)) return respond({ error: "max_versions_per_doc_per_job must be a number" }, 400);
      const clamped = Math.max(MIN_VERSION_CAP, Math.min(MAX_VERSION_CAP, rawCap));
      const { error: updErr } = await supabase.from("auto_run_jobs")
        .update({ max_versions_per_doc_per_job: clamped } as any)
        .eq("id", jobId).eq("user_id", userId);
      if (updErr) return respond({ error: updErr.message }, 500);
      console.log(`[IEL] Version cap updated for job ${jobId}: ${clamped} (requested: ${rawCap})`);
      return respondWithJob(supabase, jobId, "none");
    }

    // ═══════════════════════════════════════
    if (action === "status") {
      let job: any = null;
      let statusError: any = null;

      if (jobId) {
        const { data, error } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).maybeSingle();
        job = data; statusError = error;
      } else {
        // Deterministic job selection: priority order running > paused/awaiting > failed > stopped > completed
        const STATUS_PRIORITY = ["running", "paused", "failed", "stopped", "completed"];
        const { data: candidates, error: candErr } = await supabase
          .from("auto_run_jobs").select("*")
          .eq("project_id", projectId).eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(20);
        statusError = candErr;
        if (candidates && candidates.length > 0) {
          // Pick highest-priority status; within same status pick most recent
          for (const status of STATUS_PRIORITY) {
            const match = candidates.find((j: any) => {
              if (status === "paused") return j.status === "paused" || j.awaiting_approval;
              return j.status === status;
            });
            if (match) { job = match; break; }
          }
          if (!job) job = candidates[0]; // fallback to most recent
        }
        console.log(`[auto-run][IEL] job_selected { project_id: "${projectId}", job_id: "${job?.id || "none"}", status: "${job?.status || "none"}", current_document: "${job?.current_document || "none"}", reason: "priority_order" }`);
      }
      if (statusError || !job) return respond({ job: null, latest_steps: [], next_action_hint: "No job found" });

      // Update heartbeat (fire-and-forget, never block status)
      supabase.from("auto_run_jobs").update({ last_heartbeat_at: new Date().toISOString() }).eq("id", job.id).then(() => {});

      // ── Stuck detection: if lock expired and no progress, mark recoverable ──
      if (job.status === "running" && job.is_processing && job.processing_started_at) {
        const lockAge = Date.now() - new Date(job.processing_started_at).getTime();
        if (lockAge > 120_000) { // 2 minutes
          console.warn("[auto-run] stuck detection: releasing stale lock", { jobId: job.id, lockAge });
          await supabase.from("auto_run_jobs").update({
            is_processing: false,
            processing_started_at: null,
            last_error: `Stale lock released after ${Math.round(lockAge / 1000)}s`,
          }).eq("id", job.id);
          job.is_processing = false;
        }
      }

      const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", job.id).order("step_index", { ascending: false }).limit(200);

      // Lightweight seed pack check (just count, no full scan)
      const seedProjectId = job.project_id || projectId;
      let seedPackInfo: { present: number; total: number; missing: string[] } | undefined;
      if (seedProjectId) {
        const { data: seedDocs } = await supabase
          .from("project_documents")
          .select("doc_type")
          .eq("project_id", seedProjectId)
          .in("doc_type", SEED_DOC_TYPES);
        const seedSet = new Set((seedDocs || []).map((d: any) => d.doc_type));
        const seedMissing = SEED_DOC_TYPES.filter(dt => !seedSet.has(dt));
        seedPackInfo = { present: SEED_DOC_TYPES.length - seedMissing.length, total: SEED_DOC_TYPES.length, missing: seedMissing };
      }

      return respond({
        job,
        latest_steps: (steps || []).reverse(),
        next_action_hint: getHint(job),
        seed_pack: seedPackInfo,
        // Diagnostic fields for observability
        server_time: new Date().toISOString(),
        lock_expires_at: job.lock_expires_at,
        last_step_at: job.last_step_at,
        last_heartbeat_at: job.last_heartbeat_at,
        can_run_next: job.status === "running" && !job.is_processing && !job.awaiting_approval,
      });
    }

    // ═══════════════════════════════════════
    // ACTION: start
    // ═══════════════════════════════════════
    if (action === "start") {
      if (!projectId) return respond({ error: "projectId required" }, 400);
      const { data: proj } = await supabase.from("projects").select("format").eq("id", projectId).single();
      const rawFmt = (proj?.format ?? '').trim().toLowerCase().replace(/_/g, "-");
      if (!rawFmt) return respond({ error: "MISSING_FORMAT_FOR_LADDER", format: rawFmt, original_format: proj?.format }, 422);
      const fmt = rawFmt;
      const fmtLadder = getLadderForJob(fmt);
      if (!fmtLadder) return respond({ error: "MISSING_FORMAT_FOR_LADDER", format: fmt, original_format: proj?.format }, 422);

      // PATCH 1b: Validate ladder integrity — all doc_types must be in policy registry
      const ladderCheck = validateLadderIntegrity(fmtLadder);
      if (!ladderCheck.valid) {
        return respond({
          error: "LADDER_REGISTRY_MISMATCH",
          message: `Format "${fmt}" ladder contains unregistered doc_types: ${ladderCheck.missing.join(", ")}`,
          missing: ladderCheck.missing,
          format: fmt,
        }, 422);
      }

      const startDoc = canonicalDocType(start_document || "idea");
      // Sanitize target_document — "draft" and "coverage" are legacy aliases, never real targets
      const rawTarget = target_document || fmtLadder[fmtLadder.length - 1];
      const targetDoc = canonicalDocType(rawTarget);
      // IEL: validate + correct target via unified guard
      const ielResult = ielValidateTarget(targetDoc, fmt);
      if (ielResult.log) console.warn(ielResult.log);
      // Validate both are on the format's ladder (graceful fallback for start_document)
      let effectiveStartDoc = startDoc;
      let effectiveTargetDoc = ielResult.target;
      if (!isOnLadder(startDoc, fmt)) {
        effectiveStartDoc = fmtLadder[0];
        console.warn(`start_document "${startDoc}" not on ${fmt} ladder — using "${effectiveStartDoc}"`);
      }

      const modeConf = MODE_CONFIG[mode || "balanced"] || MODE_CONFIG.balanced;
      const effectiveMaxLoops = max_stage_loops ?? modeConf.max_stage_loops;
      const effectiveMaxSteps = max_total_steps ?? modeConf.max_total_steps;

      // ── Preflight qualification resolver at start ──
      const preflight = await runPreflight(supabase, projectId, fmt, effectiveStartDoc, true);

      // Ensure we have a valid userId for the job insert (NOT NULL column)
      let jobUserId = userId;
      if (!jobUserId) {
        const { data: projOwner } = await supabase.from("projects").select("user_id").eq("id", projectId).single();
        jobUserId = projOwner?.user_id || null;
      }
      if (!jobUserId) return respond({ error: "Cannot determine user_id for job. Provide userId in body." }, 400);
      _requestScopedUserId = jobUserId;

      // ── Ensure seed pack docs exist before downstream generation ──
      const seedResult = await ensureSeedPack(supabase, supabaseUrl, projectId, token, jobUserId);

      // ── Guard: check for existing resumable job before creating a new one ──
      if (!body.force_new_run) {
        const { data: existingJobs } = await supabase
          .from("auto_run_jobs").select("id, status, current_document, step_count, awaiting_approval, created_at")
          .eq("project_id", projectId).eq("user_id", jobUserId)
          .in("status", ["running", "paused"])
          .order("created_at", { ascending: false }).limit(1);
        const resumable = existingJobs?.[0];
        if (resumable) {
          console.log(`[auto-run][IEL] start_vs_resume_decision { project_id: "${projectId}", existing_job_id: "${resumable.id}", existing_status: "${resumable.status}", current_document: "${resumable.current_document}", step_count: ${resumable.step_count}, chosen_action: "blocked_existing_job", reason: "resumable_job_exists" }`);
          return respond({
            error: "RESUMABLE_JOB_EXISTS",
            message: `A resumable job exists at stage '${resumable.current_document}' (step ${resumable.step_count}). Use resume or set force_new_run=true.`,
            existing_job_id: resumable.id,
            existing_status: resumable.status,
            current_document: resumable.current_document,
            step_count: resumable.step_count,
          }, 409);
        }
      }
      console.log(`[auto-run][IEL] start_vs_resume_decision { project_id: "${projectId}", existing_job_id: null, chosen_action: "start_new", reason: "no_resumable_job" }`);

      const insertPayload = {
        user_id: jobUserId,
        project_id: projectId,
        status: "running",
        mode: mode || "balanced",
        start_document: effectiveStartDoc,
        target_document: effectiveTargetDoc,
        current_document: effectiveStartDoc,
        max_stage_loops: effectiveMaxLoops,
        max_total_steps: effectiveMaxSteps,
        converge_target_json: (() => {
          const ct = body.converge_target_json;
          if (ct && typeof ct === "object") {
            const ci = Number(ct.ci); const gp = Number(ct.gp);
            if (!isNaN(ci) && ci >= 0 && ci <= 100) return { ci, gp: !isNaN(gp) ? gp : 85 };
          }
          return { ci: 90, gp: 85 }; // sensible default, not {ci:100,gp:100}
        })(),
        allow_defaults: body.allow_defaults === true,
        follow_latest: body.follow_latest === true ? true : false,
        pipeline_key: fmt,
        max_versions_per_doc_per_job: typeof body.max_versions_per_doc_per_job === "number"
          ? Math.max(MIN_VERSION_CAP, Math.min(MAX_VERSION_CAP, body.max_versions_per_doc_per_job))
          : DEFAULT_MAX_VERSIONS_PER_DOC_PER_JOB,
      };
      console.log(`[IEL] job insert pipeline_key=${insertPayload.pipeline_key} fmt=${fmt}`);
      const { data: job, error } = await supabase.from("auto_run_jobs").insert(insertPayload).select("*").single();

      if (error) throw new Error(`Failed to create job: ${error.message}`);

      // [IEL] Verify pipeline_key persisted — defensive correction if client silently dropped it
      if (!job.pipeline_key && fmt) {
        console.warn(`[IEL] pipeline_key NULL after insert — correcting to ${fmt}`);
        await supabase.from("auto_run_jobs").update({ pipeline_key: fmt }).eq("id", job.id);
        job.pipeline_key = fmt;
      }

      // ── FIX 3c: Set project runtime defaults for film formats if not already set ──
      const FILM_FORMATS = new Set(["film", "narrative-feature", "short-film", "anim-feature"]);
      if (FILM_FORMATS.has(fmt)) {
        try {
          const { data: projRt } = await supabase.from("projects")
            .select("min_runtime_minutes, min_runtime_hard_floor")
            .eq("id", projectId).single();
          if (!projRt?.min_runtime_minutes || projRt.min_runtime_minutes < 95) {
            await supabase.from("projects").update({
              min_runtime_minutes: 95,
              min_runtime_hard_floor: 85,
            }).eq("id", projectId);
            console.log(`[auto-run] film_runtime_defaults_applied { project_id: "${projectId}", min_runtime_minutes: 95, min_runtime_hard_floor: 85 }`);
          }
        } catch (rtErr: any) {
          console.warn(`[auto-run] film_runtime_defaults_failed: ${rtErr?.message}`);
        }
      }

      await logStep(supabase, job.id, 0, effectiveStartDoc, "start", `Auto-run started: ${effectiveStartDoc} → ${effectiveTargetDoc} (${mode || "balanced"} mode)`);

      if (seedResult.ensured) {
        await logStep(supabase, job.id, 0, effectiveStartDoc, "seed_pack_ensured",
          `Seed pack generated for missing docs: ${seedResult.missing.join(", ")}`,
        );
      }

      // ── LADDER DOC-SLOT PREFLIGHT: ensure first N ladder stages have doc slots ──
      {
        const ladder = getLadderForJob(fmt);
        if (ladder && ladder.length > 0) {
          const preflightSlots = ladder.slice(0, Math.min(5, ladder.length));
          const created: string[] = [];
          const existed: string[] = [];
          for (const docType of preflightSlots) {
            try {
              const slotResult = await ensureDocSlot(supabase, projectId, jobUserId, docType, {
                source: "generated", docRole: "creative_primary",
              });
              if (slotResult.isNew) {
                created.push(docType);
              } else {
                existed.push(docType);
              }
            } catch (slotErr: any) {
              console.warn(`[auto-run] ensureDocSlot(${docType}) failed: ${slotErr.message}`);
            }
          }
          if (created.length > 0) {
            console.log(`[auto-run] ladder_doc_slots_ensured created=${created.join(",")} existed=${existed.join(",")}`);
            await logStep(supabase, job.id, 0, effectiveStartDoc, "doc_slots_ensured",
              `Created ${created.length} ladder doc slots: ${created.join(", ")}. Already existed: ${existed.length}.`,
              {}, undefined,
              { created, existed, ladder_length: ladder.length, format: fmt });
          }
        }
      }

      if (preflight.changed) {
        await logStep(supabase, job.id, 0, effectiveStartDoc, "preflight_resolve",
          `Resolved qualifications: ${Object.keys(preflight.resolved).join(", ")} → ${JSON.stringify(preflight.resolved)}`,
        );
      }

      // ── INPUT READINESS CHECK at start (with auto-regen attempt) ──
      {
        const inputCounts = await getDocCharCounts(supabase, projectId, INPUT_DOC_TYPES);
        let inputCheck = checkInputReadiness(inputCounts);
        let regenWasOk = false;
        if (!inputCheck.ready) {
          console.log("[auto-run] INPUT_INCOMPLETE at start — attempting auto-regen", { jobId: job.id, missing: inputCheck.missing_fields });
          const regenAttempt = await attemptAutoRegenInputs(
            supabase,
            supabaseUrl,
            token,
            job.id,
            1,
            effectiveStartDoc,
            projectId,
            inputCheck.missing_fields,
            "start_gate",
          );

          regenWasOk = regenAttempt.ok;
          if (!regenAttempt.ok) {
            console.warn("[auto-run] start auto-regen did not resolve inputs", { jobId: job.id, error: regenAttempt.error });
          }

          // Re-check readiness after regeneration attempt
          const inputCounts2 = await getDocCharCounts(supabase, projectId, INPUT_DOC_TYPES);
          inputCheck = checkInputReadiness(inputCounts2);

          // Log post-regen readiness for debugging
          await logStep(supabase, job.id, 1, effectiveStartDoc, "auto_regen_inputs",
            inputCheck.ready
              ? `Post-regen readiness: READY (all inputs satisfied)`
              : `Post-regen readiness: STILL MISSING ${inputCheck.missing_fields.join(", ")}`,
            {}, undefined, {
              trigger: "start_gate_recheck",
              missing_after_regen: inputCheck.missing_fields,
              ready_after_regen: inputCheck.ready,
              regen_ok: regenAttempt.ok,
              regenerated_count: Array.isArray(regenAttempt.regenResult?.regenerated) ? regenAttempt.regenResult.regenerated.length : 0,
            },
          );

          // HARD GUARD: If regen succeeded and readiness is now satisfied, NEVER pause
          if (regenWasOk && inputCheck.ready) {
            console.log("[auto-run] HARD GUARD: regen succeeded + ready — continuing without pause", { jobId: job.id });
          }
        }
        if (!inputCheck.ready) {
          // DEFENSIVE ASSERTION: regen succeeded + ready must never reach here
          if (regenWasOk && inputCheck.ready) {
            throw new Error("ILLEGAL_PAUSE_AFTER_SUCCESSFUL_REGEN");
          }
          console.warn("[auto-run] INPUT_INCOMPLETE at start (after regen attempt)", { jobId: job.id, missing: inputCheck.missing_fields });
          const compactErr = inputCheck.summary.slice(0, 500);
          await updateJob(supabase, job.id, {
            status: "paused",
            stop_reason: "INPUT_INCOMPLETE",
            error: compactErr,
            awaiting_approval: true,
            approval_type: "input_incomplete",
            last_ui_message: `Cannot proceed: ${inputCheck.missing_fields.join(", ")}. Please add content to the listed documents and resume.`,
          });
          await logStep(supabase, job.id, 1, effectiveStartDoc, "pause_for_input",
            `INPUT_INCOMPLETE: ${compactErr}`,
            {}, undefined, { missing_fields: inputCheck.missing_fields, regen_was_ok: regenWasOk }
          );
          return respond({
            job: { ...job, status: "paused", stop_reason: "INPUT_INCOMPLETE", error: compactErr },
            latest_steps: [],
            next_action_hint: "input-incomplete",
            missing_fields: inputCheck.missing_fields,
          });
        }
      }

      return respond({ job, latest_steps: [], next_action_hint: "run-next" });
    }

    // ═══════════════════════════════════════
    // ACTION: update-target
    // ═══════════════════════════════════════
    if (action === "update-target") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { ci, gp } = body;
      if (typeof ci !== "number" || typeof gp !== "number" || ci < 0 || ci > 100 || gp < 0 || gp > 100) {
        return respond({ error: "ci and gp must be numbers 0-100" }, 400);
      }
      await updateJob(supabase, jobId, { converge_target_json: { ci, gp } });
      const { data: updatedJob } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
      return respond({ job: updatedJob });
    }

    // ═══════════════════════════════════════
    // ACTION: repair-baseline
    // ═══════════════════════════════════════
    if (action === "repair-baseline") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { strategy } = body; // "promote_best_scored" | "promote_latest"
      if (!strategy || !["promote_best_scored", "promote_latest"].includes(strategy)) {
        return respond({ error: "strategy must be 'promote_best_scored' or 'promote_latest'" }, 400);
      }
      const job = await getJob(supabase, jobId);
      if (!job) return respond({ error: "Job not found" }, 404);
      if (job.pause_reason !== "BASELINE_MISSING") {
        return respond({ error: "Job is not paused for BASELINE_MISSING" }, 400);
      }

      // Find the document that's missing a baseline
      const currentDoc = job.current_document;
      const { data: doc } = await supabase.from("project_documents")
        .select("id, doc_type")
        .eq("project_id", job.project_id)
        .eq("doc_type", currentDoc)
        .limit(1).maybeSingle();
      if (!doc) return respond({ error: `No document found for doc_type=${currentDoc}` }, 404);

      // Get all versions for this document
      const { data: versions } = await supabase.from("project_document_versions")
        .select("id, version_number, plaintext")
        .eq("document_id", doc.id)
        .order("version_number", { ascending: false });
      if (!versions || versions.length === 0) {
        return respond({ error: "No versions exist for this document — cannot repair" }, 400);
      }

      let chosenVersionId: string;
      if (strategy === "promote_best_scored") {
        // Try to find the best-scored version from development_runs
        const versionIds = versions.map((v: any) => v.id);
        const { data: runs } = await supabase.from("development_runs")
          .select("version_id, output_json")
          .in("version_id", versionIds)
          .eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false });

        let bestScore = -1;
        let bestId = versions[0].id; // fallback to latest
        for (const run of (runs || [])) {
          const analysis = run.output_json;
          const ci = analysis?.ci_score ?? analysis?.scores?.ci_score ?? 0;
          const gp = analysis?.gp_score ?? analysis?.scores?.gp_score ?? 0;
          const combined = (typeof ci === "number" ? ci : 0) + (typeof gp === "number" ? gp : 0);
          if (combined > bestScore) {
            bestScore = combined;
            bestId = run.version_id;
          }
        }
        chosenVersionId = bestId;
      } else {
        // promote_latest: highest version_number
        chosenVersionId = versions[0].id;
      }

      // Promote via set_current_version
      const { error: promoteErr } = await supabase.rpc("set_current_version", {
        p_document_id: doc.id,
        p_new_version_id: chosenVersionId,
      });
      if (promoteErr) {
        return respond({ error: `Failed to repair baseline: ${promoteErr.message}` }, 500);
      }

      await logStep(supabase, jobId, null, currentDoc, "baseline_repaired",
        `Baseline repaired via ${strategy}: version ${chosenVersionId} set as current.`,
        {}, undefined, { strategy, chosenVersionId, documentId: doc.id, versionCount: versions.length });

      // Resume the job
      await updateJob(supabase, jobId, {
        status: "running",
        pause_reason: null,
        stop_reason: null,
        error: null,
        pending_decisions: null,
        awaiting_approval: false,
      });

      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: pause / stop
    // ═══════════════════════════════════════
    if (action === "pause" || action === "stop") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const newStatus = action === "pause" ? "paused" : "stopped";
      await updateJob(supabase, jobId, { status: newStatus, stop_reason: `User ${action}d` });
      const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
      // Finalize-best on stop: promote best version found during the run
      if (action === "stop" && job?.best_version_id) {
        await finalizeBest(supabase, jobId, job, job.resume_document_id || undefined);
      }
      return respond({ job, latest_steps: [], next_action_hint: action === "pause" ? "resume" : "none" });
    }

    // ═══════════════════════════════════════
    // ACTION: resume
    // ═══════════════════════════════════════
    if (action === "resume") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      // Fetch current job state to check follow_latest
      const { data: preResumeJob } = await supabase.from("auto_run_jobs")
        .select("current_document, follow_latest, resume_version_id")
        .eq("id", jobId).maybeSingle();
      const resumeUpdates: Record<string, any> = {
        status: "running", stop_reason: null, error: null,
        pause_reason: null, pending_decisions: null,
        awaiting_approval: false, approval_type: null, approval_payload: null,
        pending_doc_id: null, pending_version_id: null,
        pending_doc_type: null, pending_next_doc_type: null,
        // IEL: Clear stale processing lock so run-next can acquire immediately
        is_processing: false, processing_started_at: null, lock_expires_at: null,
        // IEL: Force fresh review on next tick by clearing last_analyzed_version_id
        last_analyzed_version_id: null,
      };
      if (body.followLatest === true) {
        resumeUpdates.follow_latest = true;
        resumeUpdates.resume_document_id = null;
        resumeUpdates.resume_version_id = null;
      }
      // IEL: If follow_latest is already true but resume_version_id is stale, clear pinning
      // This prevents the job from staying pinned to an old fork winner after manual improvements
      if (preResumeJob?.follow_latest === true && preResumeJob?.resume_version_id) {
        resumeUpdates.resume_document_id = null;
        resumeUpdates.resume_version_id = null;
        console.log(`[auto-run][IEL] resume_cleared_stale_pinning { job_id: "${jobId}", stale_resume_version_id: "${preResumeJob.resume_version_id}" }`);
      }
      console.log(`[auto-run][IEL] resume_forces_fresh_review { job_id: "${jobId}", doc_type: "${preResumeJob?.current_document || "unknown"}" }`);
      await updateJob(supabase, jobId, resumeUpdates);
      const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
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

      const decision = pending.find((d: any) => d.id === choiceId || d.id.endsWith(`:${choiceId}`));
      if (!decision) {
        // Decision is stale — return 409 with current job state so UI can self-heal
        console.warn(`[auto-run] Stale decision: ${choiceId} not in pending_decisions [${pending.map((d:any)=>d.id).join(",")}]`);
        const { data: freshJob } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
        const { data: freshSteps } = await supabase.from("auto_run_steps").select("*").eq("job_id", jobId).order("step_index", { ascending: false }).limit(200);
        return jsonRes({
          code: "STALE_DECISION",
          job: freshJob,
          latest_steps: (freshSteps || []).reverse(),
          next_action_hint: getHint(freshJob),
        }, 409);
      }
      // Extract the base decision key (last segment after colons) for special-case matching
      const matchedId = decision.id;
      const baseChoiceId = matchedId.includes(":") ? matchedId.split(":").pop()! : matchedId;

      const stepCount = job.step_count + 1;
      const currentDoc = job.current_document as DocStage;

      // ── Handle step-limit choices ──
      if (baseChoiceId === "raise_step_limit_once" && choiceValue === "yes") {
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

      if (baseChoiceId === "raise_step_limit_once" && choiceValue === "no") {
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

      if (baseChoiceId === "run_exec_strategy" && choiceValue === "yes") {
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

          // If strategy produced blocking decisions, try auto-accept or pause
          const blockingDecisions = mustDecide.filter((d: any) => d.impact === "blocking");
          if (blockingDecisions.length > 0) {
            const autoSelections = tryAutoAcceptDecisions(mustDecide, job.allow_defaults !== false);
            if (autoSelections) {
              await logStep(supabase, jobId, stepCount, currentDoc, "auto_decided",
                `Auto-accepted ${Object.keys(autoSelections).length} decisions (allow_defaults)`,
                {}, undefined, { selections: autoSelections }
              );
              // Don't pause — resume with extended steps
            } else {
              await updateJob(supabase, jobId, {
                step_count: stepCount,
                stage_loop_count: 0,
                status: "paused",
                stop_reason: `Approval required: ${blockingDecisions[0].question}`,
                pending_decisions: mustDecide,
                pending_doc_id: doc.id,
                pending_version_id: latestVersion.id,
              });
              return respondWithJob(supabase, jobId, "approve-decision");
            }
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

      if (baseChoiceId === "force_promote" && choiceValue === "yes") {
        const { data: fpProj } = await supabase.from("projects").select("format").eq("id", job.project_id).single();
        const fpFmt = (fpProj?.format || "film").toLowerCase().replace(/_/g, "-");
        const next = await nextUnsatisfiedStage(supabase, job.project_id, fpFmt, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
        if (next) {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            `Force-promoted: ${currentDoc} → ${next}`,
            {}, undefined, { choiceId, choiceValue }
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            current_document: next,
            stage_loop_count: 0,
            stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
                // Clear frontier on stage change (best_* is global, preserved)
                frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
              });
              console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${next}", best_preserved: true, trigger: "force_promote_decision" }`);
          return respondWithJob(supabase, jobId, "run-next");
        } else {
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "completed",
            stop_reason: "All stages satisfied up to target",
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Generic decision handling (original executive-strategy must_decide) ──
      const projectUpdates: Record<string, any> = {};
      const did = baseChoiceId.toLowerCase();
      if (did.includes("lane") || did.includes("positioning")) {
        projectUpdates.assigned_lane = choiceValue;
      } else if (did.includes("budget")) {
        projectUpdates.budget_range = choiceValue;
      } else if (did.includes("format")) {
        // Normalize: never store decision option IDs (B1-A, B2-A) as format
        const FORMAT_NORMALIZE: Record<string, string> = {
          "b1-a": "film", "b1a": "film", "b2-a": "vertical-drama", "b2a": "vertical-drama",
          "vertical_drama": "vertical-drama", "tv_series": "tv-series", "narrative_feature": "film",
          "short_film": "short-film", "limited_series": "limited-series",
        };
        const normalizedFormat = FORMAT_NORMALIZE[choiceValue.toLowerCase()] || choiceValue;
        projectUpdates.format = normalizedFormat;
      } else if (did.includes("episode") || did.includes("duration") || did.includes("runtime")) {
        const num = Number(choiceValue);
        if (!isNaN(num)) {
          const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
          const gc = curProj?.guardrails_config || {};
          gc.overrides = gc.overrides || {};
          gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), [baseChoiceId]: num };
          projectUpdates.guardrails_config = gc;
          if (did.includes("episode_target_duration")) {
            projectUpdates.episode_target_duration_seconds = num;
          }
        }
      } else {
        const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
        const gc = curProj?.guardrails_config || {};
        gc.overrides = gc.overrides || {};
        gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), [baseChoiceId]: choiceValue };
        projectUpdates.guardrails_config = gc;
      }

      if (Object.keys(projectUpdates).length > 0) {
        await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
      }

      const remainingDecisions = pending.filter((d: any) => d.id !== matchedId);
      const hasBlockingRemaining = remainingDecisions.some((d: any) => d.impact === "blocking");

      await logStep(supabase, jobId, stepCount, job.current_document, "decision_applied",
        `${decision.question} → ${choiceValue}`,
        {}, undefined, { decisionId: choiceId, selectedValue: choiceValue, updates: projectUpdates }
      );

      if (hasBlockingRemaining) {
        // When allow_defaults is on, auto-resolve remaining blocking decisions instead of re-pausing
        if (job.allow_defaults) {
          const remainingBlocking = remainingDecisions.filter((d: any) => d.impact === "blocking");
          for (const rd of remainingBlocking) {
            const autoValue = rd.recommended || rd.options?.[0]?.value || "accept";
            await logStep(supabase, jobId, stepCount, job.current_document, "auto_decided_all",
              `Auto-resolved remaining decision: ${rd.question || rd.id} → ${autoValue}`,
              {}, undefined, { decisionId: rd.id, selectedValue: autoValue, source: "allow_defaults_remaining" }
            );
          }
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }
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
      if (!job.awaiting_approval || !job.pending_doc_id) return respond({ pending_doc: null, job }, 200);

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
    // ACTION: approve-seed-core
    // ═══════════════════════════════════════
    if (action === "approve-seed-core") {
      const pId = body.projectId || projectId;
      if (!pId) return respond({ error: "projectId required" }, 400);

      // 1. Find all 5 seed docs
      const { data: seedDocs } = await supabase
        .from("project_documents")
        .select("id, doc_type")
        .eq("project_id", pId)
        .in("doc_type", SEED_DOC_TYPES);

      const docMap = new Map<string, string>();
      for (const d of (seedDocs || [])) {
        if (!docMap.has(d.doc_type)) docMap.set(d.doc_type, d.id);
      }

      const missingDocs = SEED_DOC_TYPES.filter(dt => !docMap.has(dt));
      if (missingDocs.length > 0) {
        return respond({ success: false, stop_reason: "SEED_CORE_MISSING", missing_docs: missingDocs, missing_current_versions: [] });
      }

      // 2. Find current versions
      const docIds = Array.from(docMap.values());
      const { data: curVersions } = await supabase
        .from("project_document_versions")
        .select("id, document_id, approval_status")
        .in("document_id", docIds)
        .eq("is_current", true);

      const versionMap = new Map<string, { id: string; approval_status: string }>();
      for (const v of (curVersions || [])) {
        versionMap.set(v.document_id, { id: v.id, approval_status: v.approval_status });
      }

      const missingCurrentVersions: string[] = [];
      for (const dt of SEED_DOC_TYPES) {
        const docId = docMap.get(dt)!;
        if (!versionMap.has(docId)) missingCurrentVersions.push(dt);
      }

      if (missingCurrentVersions.length > 0) {
        return respond({ success: false, stop_reason: "SEED_CORE_MISSING", missing_docs: [], missing_current_versions: missingCurrentVersions });
      }

      // 3. Approve all 5 current versions
      const approvedVersionIds: string[] = [];
      const approvedDocTypes: string[] = [];
      for (const dt of SEED_DOC_TYPES) {
        const docId = docMap.get(dt)!;
        const ver = versionMap.get(docId)!;
        if (ver.approval_status !== "approved") {
          await supabase
            .from("project_document_versions")
            .update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: userId })
            .eq("id", ver.id);
        }
        approvedVersionIds.push(ver.id);
        approvedDocTypes.push(dt);
      }

      console.log(`[auto-run] approve-seed-core: approved ${approvedDocTypes.length} seed docs for project ${pId}`);

      // 4. If job_id provided, return latest job state and resume when blocked on seed gate
      let resumedJob = null;
      if (jobId) {
        const { data: jRow } = await supabase
          .from("auto_run_jobs")
          .select("*")
          .eq("id", jobId)
          .eq("user_id", userId)
          .single();

        if (jRow) {
          const shouldResumeFromSeedGate =
            jRow.status === "paused" && (
              jRow.stop_reason === "SEED_CORE_NOT_OFFICIAL" ||
              jRow.approval_type === "seed_core_officialize" ||
              jRow.awaiting_approval === true
            );

          if (shouldResumeFromSeedGate) {
            await updateJob(supabase, jobId, {
              status: "running",
              stop_reason: null,
              error: null,
              awaiting_approval: false,
              approval_type: null,
              approval_payload: null,
            });

            const stepCount = (jRow.step_count || 0) + 1;
            await logStep(supabase, jobId, stepCount, jRow.current_document, "seed_core_approved",
              `Seed core officialized — ${approvedDocTypes.length} docs approved`,
              {}, undefined, { approved_doc_types: approvedDocTypes, approved_version_ids: approvedVersionIds }
            );
            await updateJob(supabase, jobId, { step_count: stepCount });

            const { data: updated } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
            resumedJob = updated;
          } else {
            // Still return job so frontend can sync UI and decide next action
            resumedJob = jRow;
          }
        }
      }

      return respond({
        success: true,
        approved_doc_types: approvedDocTypes,
        approved_version_ids: approvedVersionIds,
        job: resumedJob,
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
      if (!job.awaiting_approval) {
        console.warn("[auto-run] approve-next ignored: job is no longer awaiting approval", {
          jobId,
          status: job.status,
          current_document: job.current_document,
        });
        return respondWithJob(supabase, jobId, "wait");
      }
      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count + 1;

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
          step_count: stepCount, status: "running", stop_reason: null, error: null,
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
          // Persist CI/GP scores atomically with approval
          const approveCi = job.last_ci ?? job.best_ci ?? null;
          const approveGp = job.last_gp ?? job.best_gp ?? null;
          if (typeof approveCi === "number" && typeof approveGp === "number") {
            try {
              await persistVersionScores(supabase, {
                versionId: approveVersionId,
                ci: approveCi,
                gp: approveGp,
                source: "auto-run-approve-next",
                jobId,
                protectHigher: true,
                docType: currentDoc,
              });
            } catch (scoreErr: any) {
              console.warn(`[auto-run] approve-next score_persist_failed { version_id: "${approveVersionId}", error: "${scoreErr?.message}" }`);
            }
          }
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
            const isVD = fmt === "vertical-drama";
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
                season_script:"season_script",
                episode_1_script:"episode_script",production_draft:"production_draft",format_rules:"format_rules",
              };
              if (KEY_MAP_LOCAL[norm]) {
                docTypeKey = KEY_MAP_LOCAL[norm];
                // Format-aware script type guard
                if (isVD && docTypeKey === "feature_script") docTypeKey = "season_script";
                else if (isSeries && !isVD && docTypeKey === "feature_script") docTypeKey = "episode_script";
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

      // Resolve format for ladder checks
      const { data: approveProj } = await supabase.from("projects")
        .select("format").eq("id", job.project_id).single();
      const approveFormat = (approveProj?.format || "film").toLowerCase().replace(/_/g, "-");

      await logStep(supabase, jobId, stepCount, currentDoc, "approval_approved",
        `User approved ${job.approval_type}: ${currentDoc} → ${nextStage || "continue"}`
      );

      if (nextStage && isStageAtOrBeforeTarget(nextStage, job.target_document, approveFormat)) {
        await updateJob(supabase, jobId, {
          step_count: stepCount, current_document: nextStage, stage_loop_count: 0,
          stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
          status: "running", stop_reason: null, error: null,
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
            // Clear frontier on stage change (best_* is global, preserved)
            frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
          });
          console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${nextStage}", best_preserved: true, trigger: "approve" }`);
      } else {
        // Target reached
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "completed", stop_reason: "All stages satisfied up to target",
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
        stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
        // Clear frontier on stage change (best_* is global, preserved)
        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
      });
      console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${job.current_document}", to: "${stage}", best_preserved: true, trigger: "set_stage" }`);
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
      const currentDoc = job.current_document as DocStage;

      // ── IEL: Resolve the authoritative promotion source version ──
      // Must resolve the approved/current version of the DEPARTING stage
      // so downstream generation knows exactly which version was promoted.
      const { data: promotingDoc } = await supabase.from("project_documents")
        .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      let promotionSourceVersionId: string | null = null;
      let promotionSourceReason = "no_document";
      if (promotingDoc) {
        const abvr = await resolveActiveVersionForDoc(supabase, job, promotingDoc.id, { jobId, docType: currentDoc });
        if (abvr) {
          promotionSourceVersionId = abvr.versionId;
          promotionSourceReason = abvr.reason;
        } else {
          promotionSourceReason = "no_eligible_version";
        }
      }

      console.log(`[auto-run][IEL] manual_promote_source_resolved { job_id: "${jobId}", doc_type: "${currentDoc}", source_version_id: "${promotionSourceVersionId}", reason: "${promotionSourceReason}", doc_id: "${promotingDoc?.id || 'none'}" }`);

      // Fail-closed: if we cannot resolve the source version, block promotion
      if (!promotionSourceVersionId) {
        console.error(`[auto-run][IEL] rejected_manual_promote { job_id: "${jobId}", doc_type: "${currentDoc}", reason: "${promotionSourceReason}" }`);
        return respond({ error: `Cannot promote: no eligible approved/current version for ${currentDoc} (${promotionSourceReason}). Approve a version first.` }, 400);
      }

      // Persist scores from the promoted version to best_* fields if they're better
      const { data: sourceVer } = await supabase.from("project_document_versions")
        .select("id, meta_json").eq("id", promotionSourceVersionId).single();
      const srcMeta = sourceVer?.meta_json || {};
      const srcCI = typeof srcMeta.ci === "number" ? srcMeta.ci : (job.last_ci ?? 0);
      const srcGP = typeof srcMeta.gp === "number" ? srcMeta.gp : (job.last_gp ?? 0);

      const next = await nextUnsatisfiedStage(supabase, job.project_id, jobFmt, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
      if (!next) {
        const stepCount = job.step_count + 1;
        await logStep(supabase, jobId, stepCount, currentDoc, "force_promote", `All stages satisfied up to target (promoted version: ${promotionSourceVersionId})`);
        await updateJob(supabase, jobId, { step_count: stepCount, status: "completed", stop_reason: "All stages satisfied up to target" });
        return respondWithJob(supabase, jobId);
      }
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, currentDoc, "force_promote",
        `Force-promoted: ${currentDoc} → ${next} (source_version: ${promotionSourceVersionId}, CI:${srcCI}, GP:${srcGP})`,
        {}, undefined, { promotion_source_version_id: promotionSourceVersionId, promotion_source_reason: promotionSourceReason }
      );

      // Update job: advance stage AND persist the promoted-from version in best_* and last_analyzed
      const bestUpdateFields: Record<string, any> = {
        current_document: next, stage_loop_count: 0, step_count: stepCount,
        stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
        status: "running", stop_reason: null,
        awaiting_approval: false, approval_type: null, pending_doc_id: null, pending_version_id: null,
        pending_doc_type: null, pending_next_doc_type: null, pending_decisions: null,
        // Persist promoted version as last_analyzed so downstream knows the source
        last_analyzed_version_id: promotionSourceVersionId,
        // Update best scores if the promoted version is better
        last_ci: srcCI, last_gp: srcGP,
        // Clear frontier on stage change (best_* is global, preserved)
        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
      };
      // Update global best if promoted version scores higher
      if (srcCI + srcGP > ((job.best_ci ?? 0) + (job.best_gp ?? 0))) {
        bestUpdateFields.best_ci = srcCI;
        bestUpdateFields.best_gp = srcGP;
        bestUpdateFields.best_score = srcCI + srcGP;
        bestUpdateFields.best_version_id = promotionSourceVersionId;
        bestUpdateFields.best_document_id = promotingDoc?.id || null;
      }
      await updateJob(supabase, jobId, bestUpdateFields);
      console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${next}", best_preserved: true, trigger: "force_promote", source_version_id: "${promotionSourceVersionId}", source_ci: ${srcCI}, source_gp: ${srcGP} }`);
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
        stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
        status: "running", stop_reason: null, error: null,
        awaiting_approval: false, approval_type: null, approval_payload: null,
        pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        pending_decisions: null,
        // Clear frontier on stage change (best_* is global, preserved)
        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
      });
      console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${job.current_document}", to: "${stage}", best_preserved: true, trigger: "restart_from_stage" }`);
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
        // Fetch format early for ladder lookup (full const declared later at line ~2988)
        const { data: projFmt } = await supabase.from("projects").select("format").eq("id", job.project_id).single();
        const earlyFormat = (projFmt?.format || "film").toLowerCase().replace(/_/g, "-");
        const jobLadder = getLadderForJob(earlyFormat);
        const ladderIdx = jobLadder ? jobLadder.indexOf(currentDoc) : -1;
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

      // ── DOC POLICY GUARD (apply-rewrite) — FAIL CLOSED ──
      {
        let applyPolicy;
        try {
          applyPolicy = requireDocPolicy(currentDoc);
        } catch (regErr: any) {
          await logStep(supabase, jobId, stepCount, currentDoc, "doc_type_unregistered",
            `Doc type "${currentDoc}" is not in the policy registry. Halting.`);
          await updateJob(supabase, jobId, { status: "paused", pause_reason: "DOC_TYPE_UNREGISTERED",
            stop_reason: `Unregistered doc type: ${currentDoc}. Cannot proceed with rewrite.` });
          return respondWithJob(supabase, jobId);
        }
        if (applyPolicy.docClass === "AGGREGATE") {
          await logStep(supabase, jobId, stepCount, currentDoc, "aggregate_skip_advance",
            `AGGREGATE doc "${currentDoc}" is compile-only. Skipping rewrite, advancing to next stage.`);
           const nextAfterAgg = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
          if (nextAfterAgg && isStageAtOrBeforeTarget(nextAfterAgg, job.target_document, format)) {
            // ── PREREQ GATE: check before advancing into nextAfterAgg ──
            const gateBlocked = await enforcePrereqGateBeforeAdvance(supabase, jobId, nextAfterAgg, format, job, stepCount, currentDoc, "aggregate_skip");
            if (gateBlocked) {
              await releaseProcessingLock(supabase, jobId);
              return respondWithJob(supabase, jobId, "run-next");
            }
            await updateJob(supabase, jobId, { current_document: nextAfterAgg, stage_loop_count: 0,
              // Clear frontier on stage change (best_* is global, preserved)
              frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
            });
            console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${nextAfterAgg}", best_preserved: true, trigger: "aggregate_skip" }`);
            return respondWithJob(supabase, jobId, "run-next");
          } else {
            await updateJob(supabase, jobId, { status: "completed", stop_reason: "All stages satisfied (aggregate skip)" });
            return respondWithJob(supabase, jobId);
          }
        }
        if (applyPolicy.docClass === "UNIT" && applyPolicy.requiresEpisodeIndex) {
          const unitDoc = doc;
          const metaJson = unitDoc?.meta_json || {};
          const epIdx = metaJson?.episode_index;
          if (typeof epIdx !== "number" || epIdx < 1 || !Number.isInteger(epIdx)) {
            await logStep(supabase, jobId, stepCount, currentDoc, "unit_identity_missing",
              `UNIT doc "${currentDoc}" requires episode_index but got: ${JSON.stringify(epIdx)}. Halting.`);
            await updateJob(supabase, jobId, { status: "paused", pause_reason: "UNIT_IDENTITY_MISSING",
              stop_reason: `UNIT doc "${currentDoc}" missing valid episode_index in meta_json.` });
            return respondWithJob(supabase, jobId);
          }
        }
      }

      try {
        const { candidateVersionId: newVersionId_raw } = await rewriteWithFallback(
          supabase, supabaseUrl, token, {
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            approvedNotes,
            protectItems,
            deliverableType: currentDoc,
            developmentBehavior: behavior,
            format,
          }, jobId, stepCount, format, currentDoc
        );

        const newVersionId = newVersionId_raw || "unknown";

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
          resume_document_id: null,
          resume_version_id: null,
        });
        console.log(`[auto-run][IEL] follow_latest_pins_cleared { job_id: "${jobId}", source: "manual_rewrite", doc_id: "${doc.id}" }`);
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

        // If blocking decisions exist, try auto-accept or pause for user
        const blockingDecisions = mustDecide.filter((d: any) => d.impact === "blocking");
        if (blockingDecisions.length > 0) {
          const autoSelections = tryAutoAcceptDecisions(mustDecide, job.allow_defaults !== false);
          if (autoSelections) {
            await logStep(supabase, jobId, stepCount, currentDoc, "auto_decided",
              `Auto-accepted ${Object.keys(autoSelections).length} executive strategy decisions`,
              {}, undefined, { selections: autoSelections }
            );
            // Fall through to resume
          } else {
            await updateJob(supabase, jobId, {
              step_count: stepCount,
              status: "paused",
              stop_reason: `Executive strategy decision required: ${blockingDecisions[0].question}`,
              pending_decisions: mustDecide,
              pending_doc_id: doc.id,
              pending_version_id: latestVersion.id,
            });
            return respondWithJob(supabase, jobId, "approve-decision");
          }
        }

        // No blocking decisions — resume (or continue directly if allow_defaults)
        if (job.allow_defaults) {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_mode_skipped",
            `Executive strategy applied — no blocking decisions, allow_defaults=ON → continuing without pause.`
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }
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
      let { selectedOptions, globalDirections } = body;
      if (!selectedOptions || !Array.isArray(selectedOptions)) {
        selectedOptions = [];
      }

      // If no user selections but allow_defaults is on, auto-accept decisions deterministically
      if (selectedOptions.length === 0) {
        const { data: preJob } = await supabase.from("auto_run_jobs").select("allow_defaults, pending_decisions, project_id").eq("id", jobId).eq("user_id", userId).maybeSingle();
        if (preJob?.allow_defaults) {
          // Normalize a decision item to { decision_id, options[], recommended }
          const normalizeDecisionItem = (d: any) => ({
            decision_id: d.id || d.decision_key || d.note_id || null,
            options: Array.isArray(d.options) ? d.options
              : Array.isArray(d.decision_value?.options) ? d.decision_value.options
              : [],
            recommended: d.recommended || d.recommendation?.value || d.decision_value?.recommendation?.value || null,
          });

          let decisionItems: any[] = [];
          let source = "none";

          // Source 1: job.pending_decisions (legacy flow)
          if (Array.isArray(preJob.pending_decisions) && preJob.pending_decisions.length > 0) {
            decisionItems = preJob.pending_decisions.map(normalizeDecisionItem);
            source = "job_pending_decisions";
          }

          // Source 2: decision_ledger workflow_pending rows (decision gate flow)
          if (decisionItems.length === 0 && preJob.project_id) {
            const { data: ledgerRows } = await supabase
              .from("decision_ledger")
              .select("id, decision_key, decision_value")
              .eq("project_id", preJob.project_id)
              .eq("status", "workflow_pending" as any)
              .order("created_at", { ascending: true })
              .limit(50);
            if (ledgerRows && ledgerRows.length > 0) {
              decisionItems = ledgerRows.map((r: any) => normalizeDecisionItem({
                id: r.id,
                decision_key: r.decision_key,
                decision_value: r.decision_value,
                options: r.decision_value?.options,
                recommended: r.decision_value?.recommendation?.value,
              }));
              source = "decision_ledger_workflow_pending";
            }
          }

          if (decisionItems.length > 0) {
            let recommendedCount = 0;
            let fallbackFirstCount = 0;
            let fallbackAcceptCount = 0;

            selectedOptions = decisionItems
              .filter((d: any) => d.decision_id) // skip items with no id
              .map((d: any) => {
                let optionId: string;
                if (d.recommended) {
                  optionId = d.recommended;
                  recommendedCount++;
                } else if (d.options.length > 0 && d.options[0]?.value) {
                  optionId = d.options[0].value;
                  fallbackFirstCount++;
                } else {
                  optionId = "accept";
                  fallbackAcceptCount++;
                }
                return { note_id: d.decision_id, option_id: optionId };
              });

            console.log(`[auto-run][IEL] apply-decisions auto-default: source=${source} total=${decisionItems.length} recommended=${recommendedCount} fallback_first_option=${fallbackFirstCount} fallback_accept=${fallbackAcceptCount} selected=${selectedOptions.length}`);
          }
        }
        if (selectedOptions.length === 0) {
          return respond({ error: "selectedOptions array required" }, 400);
        }
      }

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count + 1;

      const CONTROL_NOTE_IDS = new Set(["raise_step_limit_once", "run_exec_strategy", "force_promote", "fallback_force_promote"]);
      const selectedMap = new Map<string, string>(
        selectedOptions
          .filter((s: any) => s?.note_id && s?.option_id)
          .map((s: any) => [String(s.note_id), String(s.option_id)])
      );
      const raiseChoice = selectedMap.get("raise_step_limit_once");
      const runExecChoice = selectedMap.get("run_exec_strategy");
      // Support both legacy "fallback_force_promote" and new "force_promote" IDs
      const forcePromoteChoice = selectedMap.get("force_promote") || selectedMap.get("fallback_force_promote");
      const selectedContentOptions = selectedOptions.filter((s: any) => !CONTROL_NOTE_IDS.has(String(s.note_id)));

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      // Control-only decisions should not invoke rewrite, otherwise step-limit choices loop forever.
      if (selectedContentOptions.length === 0 && (raiseChoice || runExecChoice || forcePromoteChoice)) {
        // Handle "stop" choice from fallback decisions
        if (raiseChoice === "no" || forcePromoteChoice === "stop") {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            forcePromoteChoice === "stop" ? "User chose to stop and review manually" : "User declined step extension — stopping run",
            {}, undefined, { selectedOptions }
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "stopped",
            stop_reason: forcePromoteChoice === "stop" ? "User stopped for manual review" : "User stopped at step limit",
            pending_decisions: null,
            awaiting_approval: false,
            approval_type: null,
            approval_payload: null,
            pending_doc_id: null,
            pending_version_id: null,
            pending_doc_type: null,
            pending_next_doc_type: null,
          });
          return respondWithJob(supabase, jobId, "none");
        }

        // Handle "retry" choice — reset loop count and continue
        if (forcePromoteChoice === "retry") {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            "User chose to retry current stage",
            {}, undefined, { selectedOptions }
          );
          const maxTotalSteps = Math.max(job.max_total_steps + 6, (job.step_count || 0) + 6);
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            max_total_steps: maxTotalSteps,
            stage_loop_count: 0,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
            awaiting_approval: false,
            approval_type: null,
            approval_payload: null,
            pending_doc_id: null,
            pending_version_id: null,
            pending_doc_type: null,
            pending_next_doc_type: null,
            error: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }

        let maxTotalSteps = job.max_total_steps;
        if (raiseChoice === "yes") {
          // Ensure the raised cap is always ahead of the *current* counter.
          maxTotalSteps = Math.max(job.max_total_steps + 6, (job.step_count || 0) + 6);
        }

        let status: "running" | "completed" = "running";
        let stopReason: string | null = null;
        let nextDoc: DocStage = currentDoc;

        if (forcePromoteChoice === "yes" || forcePromoteChoice === "force_promote") {
          const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
          if (next) {
            nextDoc = next;
          } else {
            status = "completed";
            stopReason = "All stages satisfied up to target";
          }
        }

        const controlSummary = [
          raiseChoice ? `raise_step_limit_once=${raiseChoice}` : null,
          runExecChoice ? `run_exec_strategy=${runExecChoice}` : null,
          forcePromoteChoice ? `force_promote=${forcePromoteChoice}` : null,
        ].filter(Boolean).join(", ");

        await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
          `Applied control decisions: ${controlSummary || "none"}`,
          {}, undefined, { selectedOptions }
        );

        await updateJob(supabase, jobId, {
          step_count: stepCount,
          max_total_steps: maxTotalSteps,
          current_document: nextDoc,
          stage_loop_count: (forcePromoteChoice === "yes" || forcePromoteChoice === "force_promote" || runExecChoice === "yes") ? 0 : job.stage_loop_count,
          stage_exhaustion_remaining: (forcePromoteChoice === "yes" || forcePromoteChoice === "force_promote" || runExecChoice === "yes") ? (job.stage_exhaustion_default ?? 4) : job.stage_exhaustion_remaining,
          status,
          stop_reason: stopReason,
          pending_decisions: null,
          awaiting_approval: false,
          approval_type: null,
          approval_payload: null,
          pending_doc_id: null,
          pending_version_id: null,
          pending_doc_type: null,
          pending_next_doc_type: null,
          error: null,
          // Clear frontier on stage change (best_* is global, preserved)
          ...(nextDoc !== currentDoc ? { frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0 } : {}),
        });

        return respondWithJob(supabase, jobId, status === "running" ? "run-next" : "none");
      }

      // Resolve doc and version — prefer client-supplied source_version_id, then pending, then latest
      const clientSourceVersionId = body.source_version_id || null;
      let docId = job.pending_doc_id;
      let versionId = clientSourceVersionId || job.pending_version_id;

      // If client supplied a source_version_id, resolve its document_id
      if (clientSourceVersionId && !docId) {
        const { data: srcVer } = await supabase.from("project_document_versions")
          .select("document_id").eq("id", clientSourceVersionId).single();
        if (srcVer) docId = srcVer.document_id;
      }

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

      if (clientSourceVersionId) {
        console.log(`[auto-run][IEL] apply_decisions_version_source { job_id: "${jobId}", source: "client_source_version_id", version_id: "${clientSourceVersionId}", doc_id: "${docId}" }`);
      } else if (job.pending_version_id) {
        console.log(`[auto-run][IEL] apply_decisions_version_source { job_id: "${jobId}", source: "job_pending_version_id", version_id: "${job.pending_version_id}", doc_id: "${docId}" }`);
      } else {
        console.log(`[auto-run][IEL] apply_decisions_version_source { job_id: "${jobId}", source: "fallback_latest", version_id: "${versionId}", doc_id: "${docId}" }`);
      }

      // Fallback: if current stage has no versions (empty slot after promotion),
      // try the previous stage's latest doc/version (decisions were made on that stage)
      if (!docId || !versionId) {
        const ladder = getLadderForJob(format);
        if (ladder) {
          const curIdx = ladder.indexOf(currentDoc);
          if (curIdx > 0) {
            const prevStage = ladder[curIdx - 1];
            console.log(`[auto-run] apply-decisions: no version for ${currentDoc}, falling back to previous stage ${prevStage}`);
            const { data: prevDoc } = await supabase.from("project_documents")
              .select("id").eq("project_id", job.project_id).eq("doc_type", prevStage)
              .order("created_at", { ascending: false }).limit(1).single();
            if (prevDoc) {
              docId = prevDoc.id;
              const { data: prevVer } = await supabase.from("project_document_versions")
                .select("id").eq("document_id", prevDoc.id)
                .order("version_number", { ascending: false }).limit(1).single();
              versionId = prevVer?.id || null;
            }
          }
        }
      }
      if (!docId || !versionId) return respond({ error: "No document/version found for current stage" }, 400);

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

      const rewriteSelectedOptions = selectedContentOptions.length > 0 ? selectedContentOptions : selectedOptions;

      // ── DOC POLICY GUARD (apply-decisions-and-continue) — FAIL CLOSED ──
      {
        let decPolicy;
        try {
          decPolicy = requireDocPolicy(currentDoc);
        } catch (regErr: any) {
          await logStep(supabase, jobId, stepCount, currentDoc, "doc_type_unregistered",
            `Doc type "${currentDoc}" is not in the policy registry. Halting.`);
          await updateJob(supabase, jobId, { status: "paused", pause_reason: "DOC_TYPE_UNREGISTERED",
            stop_reason: `Unregistered doc type: ${currentDoc}. Cannot proceed with rewrite.` });
          return respondWithJob(supabase, jobId);
        }
        if (decPolicy.docClass === "AGGREGATE") {
          await logStep(supabase, jobId, stepCount, currentDoc, "aggregate_skip_advance",
            `AGGREGATE doc "${currentDoc}" is compile-only. Skipping rewrite, advancing to next stage.`);
          const nextAfterAgg = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
          if (nextAfterAgg && isStageAtOrBeforeTarget(nextAfterAgg, job.target_document, format)) {
            // ── PREREQ GATE: check before advancing into nextAfterAgg ──
            const gateBlocked = await enforcePrereqGateBeforeAdvance(supabase, jobId, nextAfterAgg, format, job, stepCount, currentDoc, "aggregate_skip_decision");
            if (gateBlocked) {
              await releaseProcessingLock(supabase, jobId);
              return respondWithJob(supabase, jobId, "run-next");
            }
            await updateJob(supabase, jobId, { current_document: nextAfterAgg, stage_loop_count: 0,
              // Clear frontier on stage change (best_* is global, preserved)
              frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
            });
            console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${nextAfterAgg}", best_preserved: true, trigger: "aggregate_skip_decision" }`);
            return respondWithJob(supabase, jobId, "run-next");
          } else {
            await updateJob(supabase, jobId, { status: "completed", stop_reason: "All stages satisfied (aggregate skip)" });
            return respondWithJob(supabase, jobId);
          }
        }
        if (decPolicy.docClass === "UNIT" && decPolicy.requiresEpisodeIndex) {
          // Fetch the doc record to check meta_json
          const { data: unitDocRow } = await supabase.from("project_documents")
            .select("meta_json").eq("id", docId).single();
          const metaJson = unitDocRow?.meta_json || {};
          const epIdx = metaJson?.episode_index;
          if (typeof epIdx !== "number" || epIdx < 1 || !Number.isInteger(epIdx)) {
            await logStep(supabase, jobId, stepCount, currentDoc, "unit_identity_missing",
              `UNIT doc "${currentDoc}" requires episode_index but got: ${JSON.stringify(epIdx)}. Halting.`);
            await updateJob(supabase, jobId, { status: "paused", pause_reason: "UNIT_IDENTITY_MISSING",
              stop_reason: `UNIT doc "${currentDoc}" missing valid episode_index in meta_json.` });
            return respondWithJob(supabase, jobId);
          }
        }
      }

      try {
        await logStep(supabase, jobId, stepCount, currentDoc, "apply_decisions",
          `Applying ${rewriteSelectedOptions.length} decisions with rewrite`,
          {}, undefined, { selectedOptions: rewriteSelectedOptions, globalDirections }
        );

        const { candidateVersionId: newVersionId_raw } = await rewriteWithFallback(
          supabase, supabaseUrl, token, {
            projectId: job.project_id,
            documentId: docId,
            versionId: versionId,
            approvedNotes,
            protectItems,
            deliverableType: currentDoc,
            developmentBehavior: behavior,
            format,
            selectedOptions: rewriteSelectedOptions,
            globalDirections,
          }, jobId, stepCount, format, currentDoc
        );

        const newVersionId = newVersionId_raw || "unknown";

        await logStep(supabase, jobId, stepCount + 1, currentDoc, "decisions_applied_rewrite",
          `Decisions applied, new version: ${newVersionId}`,
          {}, undefined, { docId, newVersionId, selectedOptions: rewriteSelectedOptions.length }
        );

        // ── CRITICAL: Resolve decision_ledger rows from workflow_pending → active ──
        // Without this, the decision gate re-finds the same blocking decisions on next tick.
        const ledgerIdsToResolve = rewriteSelectedOptions
          .map((s: any) => s?.note_id)
          .filter((id: string) => !!id);
        if (ledgerIdsToResolve.length > 0) {
          // Separate UUIDs from string decision_keys
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const uuidIds = ledgerIdsToResolve.filter((id: string) => uuidPattern.test(id));
          const keyIds = ledgerIdsToResolve.filter((id: string) => !uuidPattern.test(id));

          let resolvedCount = 0;
          // Resolve by UUID id
          if (uuidIds.length > 0) {
            const { error: err1 } = await supabase
              .from("decision_ledger")
              .update({ status: "active" })
              .in("id", uuidIds)
              .eq("status", "workflow_pending");
            if (err1) {
              console.warn(`[auto-run][IEL] decision_ledger_resolve_failed_uuid`, JSON.stringify({
                job_id: jobId, ids: uuidIds, error: err1.message,
              }));
            } else {
              resolvedCount += uuidIds.length;
            }
          }
          // Resolve by decision_key for non-UUID keys
          if (keyIds.length > 0) {
            const { error: err2 } = await supabase
              .from("decision_ledger")
              .update({ status: "active" })
              .in("decision_key", keyIds)
              .eq("project_id", job.project_id)
              .eq("status", "workflow_pending");
            if (err2) {
              console.warn(`[auto-run][IEL] decision_ledger_resolve_failed_key`, JSON.stringify({
                job_id: jobId, keys: keyIds, error: err2.message,
              }));
            } else {
              resolvedCount += keyIds.length;
            }
          }
          console.log(`[auto-run][IEL] decision_ledger_resolved`, JSON.stringify({
            job_id: jobId, resolved_count: resolvedCount, uuid_ids: uuidIds, key_ids: keyIds,
          }));
        }

        await updateJob(supabase, jobId, {
          step_count: stepCount + 1,
          status: "running",
          stop_reason: null,
          follow_latest: true,
          resume_document_id: null,
          resume_version_id: null,
          pending_doc_id: null,
          pending_version_id: null,
          pending_decisions: null,
          awaiting_approval: false,
          approval_type: null,
          approval_payload: null,
          error: null,
        });
        console.log(`[auto-run][IEL] follow_latest_pins_cleared { job_id: "${jobId}", source: "decisions_applied_rewrite", doc_id: "${docId}" }`);
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
      console.log("[auto-run] run-next start", { jobId });
      let optionsGeneratedThisStep = false;

      // ── Pre-check: bail early for non-running / approval states ──
      // service_role skips user_id filter (self-chain path)
      let preJobQuery = supabase.from("auto_run_jobs").select("*").eq("id", jobId);
      if (actor !== "service_role") preJobQuery = preJobQuery.eq("user_id", userId);
      const { data: preJobRaw, error: preJobErr } = await preJobQuery.single();
      let preJob: any = preJobRaw;
      if (preJobErr || !preJob) return respond({ error: "Job not found" }, 404);
      if (preJob.awaiting_approval) return respond({ job: preJob, latest_steps: [], next_action_hint: "awaiting-approval" });

      // Auto-resume stale criteria pause when Auto-Decide is ON
      if (preJob.status !== "running"
        && preJob.status === "paused"
        && preJob.pause_reason === "CRITERIA_STALE_PROVENANCE"
        && preJob.allow_defaults === true) {
        console.log(`[auto-run][IEL] auto_resume_stale_criteria_pause { job_id: "${jobId}", pause_reason: "${preJob.pause_reason}" }`);
        await updateJob(supabase, jobId, {
          status: "running",
          pause_reason: null,
          stop_reason: null,
          error: null,
          last_analyzed_version_id: null,
        });
        const { data: resumedJob } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
        if (resumedJob) preJob = resumedJob;
      }

      if (preJob.status !== "running") return respond({ job: preJob, latest_steps: [], next_action_hint: getHint(preJob) });

      // ── SINGLE-FLIGHT LOCK: acquire processing lock ──
      const job = await acquireProcessingLock(supabase, jobId, userId, actor === "service_role");
      if (!job) {
        console.log("[auto-run] run-next lock not acquired (another invocation processing)", { jobId });
        return respondWithJob(supabase, jobId, "wait");
      }

      // ── IEL: clear stale pause_reason/stop_reason on running jobs ──
      // If a prior CAS-failed pause left residual fields, clear them now that we hold the lock.
      if (job.status === "running" && (job.pause_reason || job.stop_reason)) {
        console.warn(`[IEL] Clearing stale pause state on running job ${jobId}: pause_reason=${job.pause_reason}, stop_reason=${job.stop_reason}`);
        await supabase.from("auto_run_jobs").update({
          pause_reason: null,
          stop_reason: null,
        }).eq("id", jobId).eq("status", "running");
        job.pause_reason = null;
        job.stop_reason = null;
      }

      // ── IEL: Defensive cleanup — clear stale resume pins when follow_latest=true ──
      // Prevents dirty state from manual_rewrite/decisions_applied paths that set both
      if (job.follow_latest && (job.resume_version_id || job.resume_document_id)) {
        console.log(`[auto-run][IEL] run_next_cleared_stale_pins { job_id: "${jobId}", stale_resume_version_id: "${job.resume_version_id}", stale_resume_document_id: "${job.resume_document_id}" }`);
        await supabase.from("auto_run_jobs").update({
          resume_document_id: null,
          resume_version_id: null,
        }).eq("id", jobId);
        job.resume_document_id = null;
        job.resume_version_id = null;
      }

      // Ensure downstream calls carry the real user_id from the job
      if (!_requestScopedUserId && job.user_id) {
        _requestScopedUserId = job.user_id;
      }

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count;
      const stageLoopCount = job.stage_loop_count;

      // ── IEL: Sync job.best_version_id with DB reality on every tick ──
      // If the current approved version in project_documents has a higher CI than
      // what the job record remembers, update the job to match. Prevents stale job fields.
      {
        const { data: dbDoc } = await supabase.from("project_documents")
          .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (dbDoc) {
          const { data: dbApproved } = await supabase.from("project_document_versions")
            .select("id, meta_json, version_number")
            .eq("document_id", dbDoc.id)
            .eq("is_current", true)
            .eq("approval_status", "approved")
            .maybeSingle();
          if (dbApproved) {
            const dbMeta = dbApproved.meta_json && typeof dbApproved.meta_json === "object" ? dbApproved.meta_json : {};
            const dbCi = typeof (dbMeta as any)?.ci === "number" ? (dbMeta as any).ci : null;
            const dbGp = typeof (dbMeta as any)?.gp === "number" ? (dbMeta as any).gp : null;
            const jobBestCi = typeof job.best_ci === "number" ? job.best_ci : -Infinity;
            if (dbCi !== null && dbCi > jobBestCi) {
              console.log(`[auto-run][IEL] best_version_sync { job_id: "${jobId}", doc_type: "${currentDoc}", db_version_id: "${dbApproved.id}", db_ci: ${dbCi}, db_gp: ${dbGp}, job_best_ci: ${jobBestCi}, action: "updating_job_best" }`);
              await updateJob(supabase, jobId, {
                best_version_id: dbApproved.id,
                best_document_id: dbDoc.id,
                best_ci: dbCi,
                best_gp: dbGp,
                best_score: (dbCi || 0) + (dbGp || 0),
              });
              job.best_version_id = dbApproved.id;
              job.best_document_id = dbDoc.id;
              job.best_ci = dbCi;
              job.best_gp = dbGp;
              job.best_score = (dbCi || 0) + (dbGp || 0);
            }
          }
        }
      }

      // ── IEL: STAGE ALREADY SATISFIED GUARD ──
      // Prevents re-doing work on a stage already approved in a prior job.
      // getStageBestFromSteps() is job-scoped; this guard checks DB-persisted approval.
      {
        const satisfiedTargetCi = resolveTargetCI(job);
        const { data: satisfiedDoc } = await supabase
          .from("project_documents").select("id")
          .eq("project_id", job.project_id).eq("doc_type", currentDoc)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (satisfiedDoc) {
          const { data: approvedVers } = await supabase
            .from("project_document_versions")
            .select("id, meta_json, version_number")
            .eq("document_id", satisfiedDoc.id)
            .eq("approval_status", "approved")
            .order("version_number", { ascending: false });
          if (approvedVers && approvedVers.length > 0) {
            const best = approvedVers
              .map((v: any) => ({ ...v, _ci: parseVersionScores(v.meta_json).ci ?? 0, _gp: parseVersionScores(v.meta_json).gp ?? 0 }))
              .sort((a: any, b: any) => (b._ci + b._gp) - (a._ci + a._gp))[0];
            if (best._ci >= satisfiedTargetCi) {
              const guardFormat = (job.pipeline_key || "film").toLowerCase().replace(/_/g, "-");
              const nextStage = nextDoc(currentDoc, guardFormat);
              await logStep(supabase, jobId, stepCount, currentDoc, "stage_already_satisfied",
                `Stage ${currentDoc} already has approved version CI:${best._ci}, GP:${best._gp} (target: ${satisfiedTargetCi}). Advancing to ${nextStage ?? "complete"}.`,
                { ci: best._ci, gp: best._gp }, undefined,
                { approved_version_id: best.id, target_ci: satisfiedTargetCi, next_stage: nextStage });
              if (!nextStage) {
                await updateJob(supabase, jobId, { status: "stopped", stop_reason: "All stages complete", last_ci: best._ci, last_gp: best._gp });
                await releaseProcessingLock(supabase, jobId);
                return respondWithJob(supabase, jobId);
              }
              await updateJob(supabase, jobId, { current_document: nextStage, stage_loop_count: 0, last_ci: best._ci, last_gp: best._gp });
              await releaseProcessingLock(supabase, jobId);
              return respondWithJob(supabase, jobId, "run-next");
            }
          }
        }
      }

      // Resolve project metadata once per run-next cycle
      const { data: project } = await supabase.from("projects")
        .select("title, format, development_behavior, episode_target_duration_seconds, season_episode_count, guardrails_config, assigned_lane, budget_range, genres")
        .eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      // [IEL] Backfill pipeline_key if NULL on running job (defensive; covers legacy jobs)
      if (!job.pipeline_key && format) {
        console.warn(`[IEL] Backfilling pipeline_key=${format} on job ${jobId}`);
        await supabase.from("auto_run_jobs").update({ pipeline_key: format }).eq("id", jobId);
        job.pipeline_key = format;
      }

      // PATCH 5: Ladder integrity check in run-next (not just start)
      {
        const runLadder = getLadderForJob(format);
        if (runLadder) {
          const lc = validateLadderIntegrity(runLadder);
          if (!lc.valid) {
            await updateJob(supabase, jobId, {
              status: "paused", stop_reason: "LADDER_REGISTRY_MISMATCH",
              pause_reason: "LADDER_REGISTRY_MISMATCH",
              error: `Ladder contains unregistered doc_types: ${lc.missing.join(", ")}`,
            });
            return respondWithJob(supabase, jobId);
          }
        }
      }

      // ── IEL: re-validate target_document on every run-next ──
      {
        const ielCheck = ielValidateTarget(job.target_document, format);
        if (ielCheck.corrected) {
          console.warn(ielCheck.log);
          await supabase.from("auto_run_jobs").update({ target_document: ielCheck.target }).eq("id", jobId);
          job.target_document = ielCheck.target;
          await logStep(supabase, jobId, null, currentDoc, "iel_target_corrected",
            ielCheck.log || `Target corrected to ${ielCheck.target}`);
        }
      }

      // ── Cost optimisation: MAX STAGE ITERATIONS GUARD ──
      // Count actual review calls (LLM ANALYZE calls) for this stage in this job.
      // If over MAX_STAGE_ITERATIONS and still below target, force-promote the best
      // available version instead of burning more Pro tokens. This fires before the
      // fresh review guard so we never start an extra ANALYZE call unnecessarily.
      {
        const targetCiForIterCap = resolveTargetCI(job);
        const { count: reviewCallCount } = await supabase
          .from("auto_run_steps")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId)
          .eq("document", currentDoc)
          .eq("action", "review");

        const iterCount = reviewCallCount ?? 0;
        if (iterCount >= MAX_STAGE_ITERATIONS) {
          const ciGate = await evaluateCIGate(supabase, jobId, currentDoc, targetCiForIterCap, job.project_id, job);
          if (!ciGate.pass) {
            // Over the iteration cap and still below target — force-promote best or pause
            console.warn(`[auto-run] max_stage_iterations_reached { job_id: "${jobId}", doc_type: "${currentDoc}", iterations: ${iterCount}, best_ci: ${ciGate.bestCiSoFar}, target: ${targetCiForIterCap} }`);
            if (job.allow_defaults && ciGate.bestCiSoFar >= GLOBAL_MIN_CI) {
              const iterCapForcePromote = await tryPlateauForcePromote(supabase, {
                jobId, job, currentDoc, format, stepCount,
                targetCi: targetCiForIterCap,
                detectedCi: ciGate.ci,
                detectedBestCi: ciGate.bestCiSoFar,
                plateauVersion: "v1",
              });
              if (iterCapForcePromote) return iterCapForcePromote;
            } else if (!job.allow_defaults) {
              await logStep(supabase, jobId, stepCount, currentDoc, "stop",
                `MAX_STAGE_ITERATIONS (${MAX_STAGE_ITERATIONS}) reached for ${currentDoc}. Best CI: ${ciGate.bestCiSoFar}, target: ${targetCiForIterCap}. Pausing — manual review required.`
              );
              await updateJob(supabase, jobId, {
                status: "paused", stop_reason: "MAX_ITERATIONS_REACHED",
                pause_reason: "MAX_ITERATIONS_REACHED",
                error: `Stage ${currentDoc} reached max ${MAX_STAGE_ITERATIONS} iterations at CI=${ciGate.bestCiSoFar} (target: ${targetCiForIterCap}).`,
              });
              await releaseProcessingLock(supabase, jobId);
              return respondWithJob(supabase, jobId);
            }
          }
          // If CI already passes target, fall through normally
        }
      }

// ── IEL: FRESH REVIEW GUARD — must review latest version before plateau evaluation ──
      {
        const freshCheck = await needsFreshReview(supabase, jobId, job, currentDoc);
        if (freshCheck.needed) {
          console.log(`[auto-run][IEL] fresh_review_required { job_id: "${jobId}", doc_type: "${currentDoc}", active_version_id: "${freshCheck.activeVersionId}", active_source: "${freshCheck.activeSource}", last_reviewed_version_id: "${freshCheck.lastReviewedVersionId}", last_analyzed_version_id: "${job.last_analyzed_version_id}", reason: "${freshCheck.reason}" }`);
          await logStep(supabase, jobId, stepCount, currentDoc, "fresh_review_required",
            `Skipping CI gate — active version ${freshCheck.activeVersionId} (${freshCheck.activeSource}) not yet reviewed (last reviewed: ${freshCheck.lastReviewedVersionId}). Will review first.`,
            {}, undefined,
            { active_version_id: freshCheck.activeVersionId, active_source: freshCheck.activeSource, last_reviewed_version_id: freshCheck.lastReviewedVersionId, last_analyzed_version_id: job.last_analyzed_version_id, reason: freshCheck.reason });
          // Skip CI gate entirely — fall through to analysis block which will review the active version
        } else {
      // ── IEL: MONOTONIC CI IMPROVEMENT GATE (PRIMARY LIMITER) ──
      // Replaces version cap as the primary stop condition.
      // Allows unlimited stabilise attempts while CI is improving.
      // Fail-closes on plateau below GLOBAL_MIN_CI.
      {
        // ── PILLAR 3: PLATEAU V2 — composite CI + blocker/high-impact trend check ──
        const targetCi = resolveTargetCI(job);
        if (isPlateauV2Enabled()) {
          const plateauV2 = await checkPlateauV2(supabase, jobId, currentDoc, targetCi, CI_PLATEAU_WINDOW);
          console.log(`[auto-run][IEL] plateau_v2_eval ${JSON.stringify({ job_id: jobId, doc_type: currentDoc, ...plateauV2 })}`);

          if (plateauV2.isPlateaued) {
            // ── IEL: When allow_defaults is ON and plateaued, auto-promote best version instead of looping ──
            if (job.allow_defaults) {
              const plateauForcePromote = await tryPlateauForcePromote(supabase, {
                jobId,
                job,
                currentDoc,
                format,
                stepCount,
                targetCi,
                detectedCi: plateauV2.currentCI,
                detectedBestCi: plateauV2.currentCI,
                plateauVersion: "v2",
              });
              if (plateauForcePromote) return plateauForcePromote;

              // ── IEL: tryPlateauForcePromote returned null. Check WHY: blocker/high notes remain or CI too low. ──
              // Only blocker + high severity notes block promotion. Polish notes do not.
              const { data: plateauOpenNotes } = await supabase
                .from("project_notes")
                .select("id")
                .eq("project_id", job.project_id)
                .eq("doc_type", currentDoc)
                .in("status", ["open", "in_progress", "reopened"])
                .in("severity", ["blocker", "high"])
                .limit(5);

              if (plateauOpenNotes && plateauOpenNotes.length > 0) {
                // Blocker/high notes remain — skip plateau gate, let rewrite loop apply them
                console.log(`[auto-run][IEL] note_driven_rewrite_continue { job_id: "${jobId}", doc_type: "${currentDoc}", note_count: ${plateauOpenNotes.length}, plateau_version: "v2" }`);
                await logStep(supabase, jobId, stepCount + 1, currentDoc, "note_driven_rewrite_continue",
                  `CI plateaued (V2) at ${plateauV2.currentCI} but ${plateauOpenNotes.length} blocker/high note(s) remain. Skipping plateau gate → rewrite loop will apply notes.`,
                  { ci: plateauV2.currentCI }, undefined,
                  { plateau_version: "v2", note_count: plateauOpenNotes.length, note_ids: plateauOpenNotes.map((n: any) => n.id) });
                // Fall through to analysis/rewrite block — DO NOT pause
              } else {
                // No blocker/high notes remain (only polish or none) — eligible for force-promote
                // If CI still below target, this is genuinely stuck on quality not notes
                console.warn(`[auto-run][IEL] notes_unresolvable { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${plateauV2.currentCI}, target: ${targetCi}, plateau_version: "v2", reason: "no_blocker_high_notes_remain" }`);
                const bestAvail = await resolveBestScoredEligibleVersionForDoc(supabase, job.project_id, currentDoc);
                await logStep(supabase, jobId, stepCount + 1, currentDoc, "notes_unresolvable",
                  `CI plateaued (V2) at ${plateauV2.currentCI}, no blocker/high notes remain, best CI:${bestAvail?.ci ?? "?"} below target ${targetCi}. Cannot improve further.`,
                  { ci: plateauV2.currentCI }, undefined,
                  { plateau_version: "v2", best_ci: bestAvail?.ci, best_gp: bestAvail?.gp, target_ci: targetCi });
                const { data: docForCap } = await supabase.from("project_documents")
                  .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
                  .order("created_at", { ascending: false }).limit(1).maybeSingle();
                if (docForCap) await finalizeBest(supabase, jobId, job, docForCap.id);

                // In Full Autopilot (allow_defaults=true), auto-force-promote instead of pausing.
                // No notes remain → this is as good as it gets. Promote and keep running.
                if (job.allow_defaults) {
                  const nextStage = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
                  await logStep(supabase, jobId, stepCount + 2, currentDoc, "auto_force_promote",
                    `Full Autopilot: CI=${plateauV2.currentCI} plateaued with no actionable notes — auto-promoting to next stage (${nextStage ?? "complete"}).`,
                    { ci: plateauV2.currentCI }, undefined,
                    { from: currentDoc, to: nextStage, reason: "notes_unresolvable_allow_defaults" });
                  if (nextStage && isStageAtOrBeforeTarget(nextStage, job.target_document, format)) {
                    await updateJob(supabase, jobId, {
                      step_count: stepCount + 2,
                      current_document: nextStage,
                      stage_loop_count: 0,
                      frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
                      status: "running",
                      stop_reason: null,
                      pause_reason: null,
                      error: null,
                    });
                    await releaseProcessingLock(supabase, jobId);
                    return respondWithJob(supabase, jobId, "run-next");
                  } else {
                    await updateJob(supabase, jobId, { step_count: stepCount + 2, status: "completed", stop_reason: "All stages satisfied (auto-promote from plateau)" });
                    await releaseProcessingLock(supabase, jobId);
                    return respondWithJob(supabase, jobId);
                  }
                }

                await updateJob(supabase, jobId, {
                  status: "paused",
                  stop_reason: "NOTES_UNRESOLVABLE",
                  pause_reason: "NOTES_UNRESOLVABLE",
                  error: `No blocker/high notes remain but CI=${plateauV2.currentCI} still below target ${targetCi} for ${currentDoc}. Best available: CI=${bestAvail?.ci ?? "?"}.`,
                });
                await releaseProcessingLock(supabase, jobId);
                return respondWithJob(supabase, jobId);
              }
            } else {
            console.error(`[auto-run][IEL] plateau_v2_stop ${JSON.stringify({ job_id: jobId, doc_type: currentDoc, ...plateauV2 })}`);
            await logStep(supabase, jobId, stepCount + 1, currentDoc, "ci_plateau_stop",
              `PLATEAU V2: CI=${plateauV2.currentCI}, blocker_delta=${plateauV2.blockerCountDelta}, hi_delta=${plateauV2.highImpactCountDelta}. Neither CI improving nor notes shrinking. Fail-closed.`,
              { ci: plateauV2.currentCI }, undefined,
              { ...plateauV2, global_min_ci: targetCi, plateau_version: "v2" });
            const { data: docForCap } = await supabase.from("project_documents")
              .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (docForCap) await finalizeBest(supabase, jobId, job, docForCap.id);
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: "CI_PLATEAU_BELOW_TARGET",
              pause_reason: "CI_PLATEAU_BELOW_TARGET",
              error: `Plateau V2: CI=${plateauV2.currentCI}, blockers not shrinking, high-impact not shrinking for ${currentDoc}. Target: CI>=${targetCi}.`,
            });
            await releaseProcessingLock(supabase, jobId);
            return respondWithJob(supabase, jobId);
            }
          } else if (plateauV2.currentCI >= targetCi) {
            console.log(`[auto-run][IEL] ci_gate_passed { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${plateauV2.currentCI}, plateau_version: "v2" }`);
          } else {
            console.log(`[auto-run][IEL] plateau_v2_continue { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${plateauV2.currentCI}, reason: "${plateauV2.reason}" }`);
          }
        } else {
        // Original V1 plateau logic
        const ciProgress = await checkMonotonicCIImprovement(supabase, jobId, currentDoc, targetCi, job.project_id);
        console.log(`[auto-run][IEL] ci_gate_eval { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciProgress.currentCi}, best_ci: ${ciProgress.bestCi}, min_ci: ${targetCi}, improving: ${ciProgress.improving}, plateau_count: ${ciProgress.plateauCount}, rule: "monotonic_ci_loop" }`);

        if (ciProgress.bestCi >= targetCi) {
          console.log(`[auto-run][IEL] ci_gate_passed { job_id: "${jobId}", doc_type: "${currentDoc}", best_ci: ${ciProgress.bestCi}, current_ci: ${ciProgress.currentCi} }`);
        } else if (ciProgress.plateau) {
          // ── IEL: When allow_defaults is ON and plateaued, auto-promote best version instead of looping ──
          if (job.allow_defaults) {
            const plateauForcePromote = await tryPlateauForcePromote(supabase, {
              jobId,
              job,
              currentDoc,
              format,
              stepCount,
              targetCi,
              detectedCi: ciProgress.currentCi,
              detectedBestCi: ciProgress.bestCi,
              plateauVersion: "v1",
            });
            if (plateauForcePromote) return plateauForcePromote;

            // ── IEL: tryPlateauForcePromote returned null. Check WHY: blocker/high notes remain or CI too low. ──
            // Only blocker + high severity notes block promotion. Polish notes do not.
            const { data: plateauOpenNotesV1 } = await supabase
              .from("project_notes")
              .select("id")
              .eq("project_id", job.project_id)
              .eq("doc_type", currentDoc)
              .in("status", ["open", "in_progress", "reopened"])
              .in("severity", ["blocker", "high"])
              .limit(5);

            if (plateauOpenNotesV1 && plateauOpenNotesV1.length > 0) {
              // Blocker/high notes remain — skip plateau gate, let rewrite loop apply them
              console.log(`[auto-run][IEL] note_driven_rewrite_continue { job_id: "${jobId}", doc_type: "${currentDoc}", note_count: ${plateauOpenNotesV1.length}, plateau_version: "v1" }`);
              await logStep(supabase, jobId, stepCount + 1, currentDoc, "note_driven_rewrite_continue",
                `CI plateaued (V1) at ${ciProgress.currentCi} (best: ${ciProgress.bestCi}) but ${plateauOpenNotesV1.length} blocker/high note(s) remain. Skipping plateau gate → rewrite loop will apply notes.`,
                { ci: ciProgress.currentCi }, undefined,
                { plateau_version: "v1", note_count: plateauOpenNotesV1.length, note_ids: plateauOpenNotesV1.map((n: any) => n.id), plateau_count: ciProgress.plateauCount });
              // Fall through to analysis/rewrite block — DO NOT pause
            } else {
              // No blocker/high notes remain (only polish or none) — genuinely stuck on quality
              console.warn(`[auto-run][IEL] notes_unresolvable { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciProgress.currentCi}, best_ci: ${ciProgress.bestCi}, target: ${targetCi}, plateau_version: "v1", reason: "no_blocker_high_notes_remain" }`);
              const bestAvailV1 = await resolveBestScoredEligibleVersionForDoc(supabase, job.project_id, currentDoc);
              await logStep(supabase, jobId, stepCount + 1, currentDoc, "notes_unresolvable",
                `CI plateaued (V1) at ${ciProgress.currentCi}, no blocker/high notes remain, best CI:${bestAvailV1?.ci ?? "?"} below target ${targetCi}. Cannot improve further.`,
                { ci: ciProgress.currentCi }, undefined,
                { plateau_version: "v1", best_ci: bestAvailV1?.ci, best_gp: bestAvailV1?.gp, target_ci: targetCi, plateau_count: ciProgress.plateauCount });
              const { data: docForCap } = await supabase.from("project_documents")
                .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
              if (docForCap) await finalizeBest(supabase, jobId, job, docForCap.id);

              // In Full Autopilot (allow_defaults=true), auto-force-promote instead of pausing.
              if (job.allow_defaults) {
                const nextStageV1 = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
                await logStep(supabase, jobId, stepCount + 2, currentDoc, "auto_force_promote",
                  `Full Autopilot: CI=${ciProgress.currentCi} plateaued (V1) with no actionable notes — auto-promoting to next stage (${nextStageV1 ?? "complete"}).`,
                  { ci: ciProgress.currentCi }, undefined,
                  { from: currentDoc, to: nextStageV1, reason: "notes_unresolvable_v1_allow_defaults" });
                if (nextStageV1 && isStageAtOrBeforeTarget(nextStageV1, job.target_document, format)) {
                  await updateJob(supabase, jobId, {
                    step_count: stepCount + 2,
                    current_document: nextStageV1,
                    stage_loop_count: 0,
                    frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
                    status: "running",
                    stop_reason: null,
                    pause_reason: null,
                    error: null,
                  });
                  await releaseProcessingLock(supabase, jobId);
                  return respondWithJob(supabase, jobId, "run-next");
                } else {
                  await updateJob(supabase, jobId, { step_count: stepCount + 2, status: "completed", stop_reason: "All stages satisfied (auto-promote from plateau V1)" });
                  await releaseProcessingLock(supabase, jobId);
                  return respondWithJob(supabase, jobId);
                }
              }

              await updateJob(supabase, jobId, {
                status: "paused",
                stop_reason: "NOTES_UNRESOLVABLE",
                pause_reason: "NOTES_UNRESOLVABLE",
                error: `No blocker/high notes remain but CI=${ciProgress.currentCi} (best: ${ciProgress.bestCi}) still below target ${targetCi} for ${currentDoc}.`,
              });
              await releaseProcessingLock(supabase, jobId);
              return respondWithJob(supabase, jobId);
            }
          } else {
          // allow_defaults=false — original pause behavior
          console.error(`[auto-run][IEL] ci_plateau_stop { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciProgress.currentCi}, best_ci: ${ciProgress.bestCi}, plateau_count: ${ciProgress.plateauCount} }`);
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "ci_plateau_stop",
            `CI PLATEAU BELOW ${targetCi}: CI=${ciProgress.currentCi}, best=${ciProgress.bestCi}, ${ciProgress.plateauCount} consecutive non-improving ticks. Fail-closed.`,
            { ci: ciProgress.currentCi }, undefined,
            { best_ci: ciProgress.bestCi, plateau_count: ciProgress.plateauCount, global_min_ci: targetCi });
          const { data: docForCap } = await supabase.from("project_documents")
            .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (docForCap) await finalizeBest(supabase, jobId, job, docForCap.id);
          await updateJob(supabase, jobId, {
            status: "paused",
            stop_reason: "CI_PLATEAU_BELOW_TARGET",
            pause_reason: "CI_PLATEAU_BELOW_TARGET",
            error: `CI plateaued at ${ciProgress.currentCi} (best: ${ciProgress.bestCi}) for ${currentDoc}. ${ciProgress.plateauCount} ticks without improvement. Target: CI>=${targetCi}.`,
          });
          await releaseProcessingLock(supabase, jobId);
          return respondWithJob(supabase, jobId);
          }
        } else if (ciProgress.improving) {
          console.log(`[auto-run][IEL] ci_improvement_detected { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciProgress.currentCi}, best_ci_prior: ${ciProgress.bestCi}, delta: ${ciProgress.currentCi - ciProgress.bestCi} }`);
        } else {
          console.log(`[auto-run][IEL] ci_plateau_tick { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciProgress.currentCi}, best_ci: ${ciProgress.bestCi}, plateau_count: ${ciProgress.plateauCount} }`);
        }
        } // end plateau version branch
      } // end CI gate inner block
      } // end CI gate else branch
      } // end fresh review guard

      // ── IEL: Version cap guard — SAFETY NET ONLY (monotonic CI loop is primary limiter) ──
      {
        const effectiveCap = getEffectiveVersionCap(job);
        const { data: docForCap } = await supabase.from("project_documents")
          .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (docForCap) {
          // Job-scoped counting: only versions created since this job started
          const { count: versionCount } = await supabase.from("project_document_versions")
            .select("id", { count: "exact", head: true })
            .eq("document_id", docForCap.id)
            .gte("created_at", job.created_at);
          console.log(`[IEL] Version cap check for ${currentDoc}: ${versionCount} job-scoped versions, cap=${effectiveCap} (job.created_at=${job.created_at})`);
          if (typeof versionCount === "number" && versionCount >= effectiveCap) {
            console.warn(`[IEL] Version cap reached for ${currentDoc}: ${versionCount} >= ${effectiveCap} (job-scoped since ${job.created_at}) [SAFETY NET]`);
            await finalizeBest(supabase, jobId, job, docForCap.id);
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: "rewrite_cap_reached",
              pause_reason: "rewrite_cap_reached",
              error: `Paused: ${versionCount} versions for ${currentDoc} created since job start (${job.created_at}) exceed cap of ${effectiveCap} (safety net).`,
            });
            await logStep(supabase, jobId, stepCount + 1, currentDoc, "rewrite_cap_reached",
              `Paused: ${versionCount} job-scoped versions for ${currentDoc} exceed cap of ${effectiveCap} [safety net]`);
            await releaseProcessingLock(supabase, jobId);
            return respondWithJob(supabase, jobId);
          }
        }
      }

      // ── PREREQUISITE QUALITY GATE: block downstream stages if upstream quality is insufficient ──
      // Vertical drama ladder enforces minimum composite scores before allowing progression.
      {
        const prereqResult = await checkPrerequisiteGate(supabase, jobId, currentDoc, format, job);
        if (prereqResult.blocked) {
          const prereq = prereqResult;
          console.error(`[auto-run][IEL] prereq_gate_blocked { job_id: "${jobId}", stage: "${currentDoc}", prerequisite_stage: "${prereq.prerequisiteStage}", ci: ${prereq.ci}, gp: ${prereq.gp}, composite: ${prereq.composite}, required_composite: ${prereq.requiredComposite}, action: "redirect_to_prerequisite" }`);
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "prereq_gate_blocked",
            `Stage "${currentDoc}" blocked: prerequisite "${prereq.prerequisiteStage}" composite ${prereq.composite} < required ${prereq.requiredComposite}. Redirecting to ${prereq.prerequisiteStage}.`,
            { ci: prereq.ci, gp: prereq.gp }, undefined,
            { prerequisite_stage: prereq.prerequisiteStage, composite: prereq.composite, required: prereq.requiredComposite });
          // Redirect to the prerequisite stage for further improvement
          await updateJob(supabase, jobId, {
            current_document: prereq.prerequisiteStage,
            stage_loop_count: 0,
            step_count: stepCount + 1,
            stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
            last_ui_message: `Redirected to ${prereq.prerequisiteStage}: composite ${prereq.composite} below required ${prereq.requiredComposite} for ${currentDoc}.`,
          });
          await releaseProcessingLock(supabase, jobId);
          return respondWithJob(supabase, jobId, "run-next");
        }
      }

      // ── PRE-STAGE DECISION GATE (workflow_pending in decision_ledger) ──
      {
        const runLadder = getLadderForJob(format) || [];
        const gateResult = await runPendingDecisionGate(
          supabase, job.project_id, jobId, format, currentDoc, runLadder, job.allow_defaults !== false,
        );
        if (gateResult.shouldPause) {
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "pending_decisions",
            gateResult.logSummary, {}, undefined, { blockingIds: gateResult.blockingIds, deferrableIds: gateResult.deferrableIds });

          // Fetch full decision details for blocking IDs so UI can render question/options
          let enrichedDecisions: any[] = gateResult.blockingIds.map((id: string) => ({ id, impact: "blocking", source: "decision_policy_registry" }));
          if (gateResult.blockingIds.length > 0) {
            const { data: fullRows } = await supabase
              .from("decision_ledger")
              .select("id, decision_key, title, decision_text, decision_value")
              .in("id", gateResult.blockingIds);
            if (fullRows && fullRows.length > 0) {
              enrichedDecisions = fullRows.map((row: any) => {
                const dv = row.decision_value || {};
                return {
                  id: row.id,
                  impact: "blocking",
                  source: "decision_policy_registry",
                  question: dv.question || row.title || row.decision_text || `Decision required: ${row.decision_key}`,
                  options: Array.isArray(dv.options) ? dv.options : [],
                  recommended: dv.recommendation?.value || null,
                  decision_key: row.decision_key,
                  classification: dv.classification || "BLOCKING_NOW",
                  reason: row.decision_text || dv.question || null,
                  provenance: dv.provenance || null,
                  scope_json: dv.scope_json || null,
                };
              });
              console.log(`[auto-run][IEL] pending_decision_emitted`, JSON.stringify({
                job_id: jobId, doc_type: currentDoc,
                count: enrichedDecisions.length,
                has_options: enrichedDecisions.map((d: any) => d.options?.length > 0),
                has_question: enrichedDecisions.map((d: any) => !!d.question),
              }));
            }
          }

          // ── AUTONOMOUS DECISION MODE: auto-apply when allow_defaults=true ──
          const isAutonomous = job.allow_defaults === true || job.meta_json?.auto_decide_all === true || job.full_autopilot === true;
          if (isAutonomous && gateResult.blockingIds.length > 0) {
            let autoApplied = 0;
            const autoAppliedKeys: string[] = [];
            for (const d of enrichedDecisions) {
              const opts = Array.isArray(d.options) ? d.options : [];
              const recommended = opts.find((o: any) => o.is_recommended === true || o.value === d.recommended);
              const selected = recommended || opts[0];
              const selectedVal = selected?.value ?? "accept";
              const selectionReason = recommended ? "is_recommended" : (opts.length > 0 ? "first_option_no_recommendation" : "fallback_accept");
              if (!recommended) {
                console.warn(`[auto-run][IEL] decision_auto_applied_no_recommendation { job_id: "${jobId}", decision_key: "${d.decision_key || d.id}", selected: "${selectedVal}", warning: "no recommended option found, using first" }`);
              }
              console.log(`[auto-run][IEL] decision_auto_applied { job_id: "${jobId}", decision_key: "${d.decision_key || d.id}", selected: "${selectedVal}", reason: "${selectionReason}", action_type: "auto_decided_all" }`);
              await supabase.from("decision_ledger").update({
                status: "active",
                decision_value: { ...(d.options ? { options: d.options } : {}), selected_option: selectedVal, resolved_by: "auto_run", resolved_at: new Date().toISOString() },
              }).eq("id", d.id).catch((e: any) => console.warn(`[auto-run][IEL] decision_auto_apply_failed: ${e?.message}`));
              autoApplied++;
              autoAppliedKeys.push(d.decision_key || d.id);
            }
            await logStep(supabase, jobId, stepCount + 1, currentDoc, "decisions_auto_applied",
              `Auto-applied ${autoApplied} decision(s) (allow_defaults=ON). Continuing run.`,
              {}, undefined, { auto_applied: autoApplied, decision_keys: autoAppliedKeys });
            // ── FIX: Update job state to running and continue immediately ──
            await updateJob(supabase, jobId, {
              status: "running",
              stop_reason: null,
              pause_reason: null,
              pending_decisions: null,
            });
            await releaseProcessingLock(supabase, jobId);
            return respondWithJob(supabase, jobId, "run-next");
          } else {
            await updateJob(supabase, jobId, {
              status: "paused",
              pause_reason: "pending_decisions",
              stop_reason: gateResult.pauseReason,
              pending_decisions: enrichedDecisions,
            });
            await releaseProcessingLock(supabase, jobId);
            return respondWithJob(supabase, jobId, "approve-decision");
          }
        }
        if (gateResult.deferrableIds.length > 0) {
          console.log(`[auto-run] ${gateResult.deferrableIds.length} deferrable decisions for ${currentDoc} — continuing`);
        }
      }

      // bgTask owns the lock once spawned — its own finally releases it.
      // We track whether bgTask was spawned to avoid double-release.
      let bgTaskSpawned = false;
      try {
      // ── Ensure seed pack on resume (hard guard) ──
      console.log("[auto-run] before ensureSeedPack", { projectId: job.project_id });
      const seedResult = await ensureSeedPack(supabase, supabaseUrl, job.project_id, token, job.user_id);
      console.log("[auto-run] after ensureSeedPack", { failed: seedResult.failed, missing: seedResult.missing });
      if (seedResult.failed) {
        const stopReason = seedResult.fail_type || "SEED_PACK_INCOMPLETE";
        const sd = seedResult.seed_debug || {};
        const compactError = `${stopReason} | http=${sd.http_status ?? 'n/a'} | inserted=${sd.insertedCount ?? '?'} updated=${sd.updatedCount ?? '?'} | ${(seedResult.error || seedResult.missing.join(", ")).slice(0, 200)}`;
        console.error(`[auto-run] ${stopReason} — failing job ${jobId}. Missing: ${seedResult.missing.join(", ")}. Error: ${compactError}`);
        await updateJob(supabase, jobId, {
          status: "failed",
          stop_reason: stopReason,
          error: compactError.slice(0, 500),
          last_ui_message: `Seed pack issue: ${compactError.slice(0, 300)}`,
        });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "seed_pack_failed",
          `${stopReason} — cannot proceed. ${compactError.slice(0, 200)}`);
        return respond({
          job: { ...job, status: "failed", stop_reason: stopReason, error: compactError.slice(0, 500) },
          missing_seed_docs: seedResult.missing,
          seed_debug: { ...sd, fail_type: stopReason, error: seedResult.error },
          seed_warnings: seedResult.warnings || [],
          error: compactError,
        });
      }

      // ── LADDER DOC-SLOT PREFLIGHT on resume ──
      {
        const resumeLadder = getLadderForJob(format);
        if (resumeLadder && resumeLadder.length > 0) {
          const preflightSlots = resumeLadder.slice(0, Math.min(5, resumeLadder.length));
          const created: string[] = [];
          for (const docType of preflightSlots) {
            try {
              const slotResult = await ensureDocSlot(supabase, job.project_id, job.user_id, docType, {
                source: "generated", docRole: "creative_primary",
              });
              if (slotResult.isNew) created.push(docType);
            } catch (slotErr: any) {
              console.warn(`[auto-run] ensureDocSlot(${docType}) on resume failed: ${slotErr.message}`);
            }
          }
          if (created.length > 0) {
            console.log(`[auto-run] ladder_doc_slots_ensured (resume) created=${created.join(",")}`);
            await logStep(supabase, jobId, null, currentDoc, "doc_slots_ensured",
              `Resume preflight: created ${created.length} ladder doc slots: ${created.join(", ")}`,
              {}, undefined, { created, format });
          }
        }
      }

      // Attach seed warnings to subsequent responses (non-blocking)
      const _seedWarnings = seedResult.warnings || [];

      // ── INPUT READINESS GATE: prevent spinning on empty/stub inputs (with auto-regen) ──
      {
        const inputCounts = await getDocCharCounts(supabase, job.project_id, INPUT_DOC_TYPES);
        let inputCheck = checkInputReadiness(inputCounts);
        let regenWasOk = false;
        if (!inputCheck.ready) {
          console.log("[auto-run] INPUT_INCOMPLETE — attempting auto-regen", { jobId, missing: inputCheck.missing_fields });
          const regenAttempt = await attemptAutoRegenInputs(
            supabase,
            supabaseUrl,
            token,
            jobId,
            stepCount + 1,
            currentDoc,
            job.project_id,
            inputCheck.missing_fields,
            "run_next_gate",
          );

          regenWasOk = regenAttempt.ok;
          if (!regenAttempt.ok) {
            console.warn("[auto-run] run-next auto-regen did not resolve inputs", { jobId, error: regenAttempt.error });
          }

          // Re-check after regeneration attempt
          const inputCounts2 = await getDocCharCounts(supabase, job.project_id, INPUT_DOC_TYPES);
          inputCheck = checkInputReadiness(inputCounts2);

          // Log post-regen readiness
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "auto_regen_inputs",
            inputCheck.ready
              ? `Post-regen readiness: READY`
              : `Post-regen readiness: STILL MISSING ${inputCheck.missing_fields.join(", ")}`,
            {}, undefined, {
              trigger: "run_next_gate_recheck",
              missing_after_regen: inputCheck.missing_fields,
              ready_after_regen: inputCheck.ready,
              regen_ok: regenAttempt.ok,
              regenerated_count: Array.isArray(regenAttempt.regenResult?.regenerated) ? regenAttempt.regenResult.regenerated.length : 0,
            },
          );

          // HARD GUARD: If regen succeeded and readiness is now satisfied, NEVER pause
          if (regenWasOk && inputCheck.ready) {
            console.log("[auto-run] HARD GUARD: regen succeeded + ready — continuing without pause", { jobId });
          }
        }
        if (!inputCheck.ready) {
          // DEFENSIVE ASSERTION: regen succeeded + ready must never reach here
          if (regenWasOk && inputCheck.ready) {
            throw new Error("ILLEGAL_PAUSE_AFTER_SUCCESSFUL_REGEN");
          }
          console.warn("[auto-run] INPUT_INCOMPLETE (after regen attempt)", { jobId, missing: inputCheck.missing_fields });
          const compactErr = inputCheck.summary.slice(0, 500);
          await updateJob(supabase, jobId, {
            status: "paused",
            stop_reason: "INPUT_INCOMPLETE",
            error: compactErr,
            awaiting_approval: true,
            approval_type: "input_incomplete",
            last_ui_message: `Cannot proceed: ${inputCheck.missing_fields.join(", ")}. Please add content to the listed documents and resume.`,
          });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "pause_for_input",
            `INPUT_INCOMPLETE: ${compactErr}`,
            {}, undefined, { missing_fields: inputCheck.missing_fields, regen_was_ok: regenWasOk }
          );
          return respond({
            job: { ...job, status: "paused", stop_reason: "INPUT_INCOMPLETE", error: compactErr },
            latest_steps: [],
            next_action_hint: "input-incomplete",
            missing_fields: inputCheck.missing_fields,
          });
        }
      }

      // ── EPISODE COUNT GATE: block episode_script / master steps if count unset ──
      {
        const EPISODE_GATED_STAGES = ["episode_script", "season_master_script"];
        if (EPISODE_GATED_STAGES.includes(currentDoc)) {
          const { data: epProj } = await supabase.from("projects")
            .select("season_episode_count, season_episode_count_locked")
            .eq("id", job.project_id).single();
          const epN = epProj?.season_episode_count;
          if (typeof epN !== "number" || epN < 1) {
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: "INPUT_INCOMPLETE",
              error: "season_episode_count not set",
              awaiting_approval: true,
              approval_type: "input_incomplete",
              last_ui_message: "Episode count not set. Set it in Season Scripts panel before continuing.",
            });
            await logStep(supabase, jobId, stepCount + 1, currentDoc, "pause_for_input",
              "Episode count not set — cannot proceed to episode generation");
            return respond({
              job: { ...job, status: "paused", stop_reason: "INPUT_INCOMPLETE", error: "season_episode_count not set" },
              latest_steps: [],
              next_action_hint: "input-incomplete",
              missing_fields: ["season_episode_count"],
            });
          }
        }
      }


      if (stepCount >= job.max_total_steps) {
        // Finalize-best: promote best version before pausing
        await finalizeBest(supabase, jobId, job, job.resume_document_id || undefined);
        // Auto-pause with pause_reason='step_limit' — no decision prompt
        await updateJob(supabase, jobId, {
          status: "paused",
          pause_reason: "step_limit",
          stop_reason: null,
          pending_decisions: null,
          awaiting_approval: false,
        });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "pause_step_limit",
          `Auto-paused: step limit reached`,
          { ci: job.last_ci, gp: job.last_gp, gap: job.last_gap, readiness: job.last_readiness },
        );
        return respondWithJob(supabase, jobId, "step-limit-paused");
      }

      // ── Guard: already at target ──
      // Only stop if the target document has actually been generated with content.
      // Without this check, the pipeline stops BEFORE generating the final doc,
      // causing TARGET_DELIVERABLE_MISSING on the completion gate.
      if (currentDoc === job.target_document && stageLoopCount > 0) {
        const { data: _tgtDocRow } = await supabase.from("project_documents")
          .select("id").eq("project_id", job.project_id).eq("doc_type", job.target_document)
          .maybeSingle();
        const _tgtVer = _tgtDocRow ? await getCurrentVersionForDoc(supabase, _tgtDocRow.id) : null;
        const _tgtLen = _tgtVer?.plaintext?.length || 0;
        const _tgtCi = Number(_tgtVer?.meta_json?.ci ?? 0);
        const _tgtMinCi = resolveTargetCI(job);
        const _ciMet = _tgtCi >= _tgtMinCi || job.allow_defaults === true && _tgtCi >= GLOBAL_MIN_CI;
        if (_tgtLen > 0 && _ciMet) {
          await updateJob(supabase, jobId, { status: "completed", stop_reason: "Reached target document" });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop",
            `Target document reached (CI:${_tgtCi} ≥ ${_tgtMinCi})`);
          return respondWithJob(supabase, jobId);
        }
        if (_tgtLen > 0 && !_ciMet) {
          // Content exists but CI not yet at target — fall through to continue convergence
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "converging",
            `Target doc '${job.target_document}' exists but CI:${_tgtCi} < target:${_tgtMinCi} — continuing convergence`);
        } else {
          // No content yet — fall through to generate
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "target_doc_not_yet_generated",
            `Target doc '${job.target_document}' reached but no content yet — generating`);
        }
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
      // project / format / behavior were resolved earlier in this run-next invocation.

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
            await updateJob(supabase, jobId, { stage_loop_count: 0, stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4 });
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

      // ═══════════════════════════════════════
      // SETUP GATE — ensure canon OS, writing voice, comparables, and NEC
      // exist before ANY engine-profile-dependent or writing stage.
      // Two tiers: PREP_SETUP (market sheets, format rules, etc.) and PREWRITE_SETUP (scripts).
      // Format-aware: VD never uses feature_script.
      // Recovery: no in-request sleeps; persists next_retry_at + attempt count.
      // ═══════════════════════════════════════
      {
        const WRITING_STAGES = new Set([
          "feature_script", "season_script", "episode_script",
          "season_master_script", "production_draft",
        ]);
        const PREP_STAGES = new Set([
          "market_sheet", "vertical_market_sheet", "format_rules",
          "treatment", "story_outline", "character_bible", "beat_sheet",
          "season_arc", "episode_grid", "vertical_episode_beats",
          "documentary_outline", "deck",
        ]);

        const isWritingStage = WRITING_STAGES.has(currentDoc);
        const isPrepStage = PREP_STAGES.has(currentDoc);
        const needsSetup = isWritingStage || isPrepStage;
        const gateLabel = isWritingStage ? "PREWRITE_SETUP" : "PREP_SETUP";

        // ── VD HARD GUARD: if format=vertical-drama and currentDoc=feature_script,
        //    remap to season_script and update job.current_document ──
        if (format === "vertical-drama" && currentDoc === "feature_script") {
          console.warn("[auto-run] VD_GUARD: feature_script illegal for vertical-drama, remapping to season_script", { jobId, currentDoc, format });
          await logStep(supabase, jobId, stepCount, currentDoc, "vd_feature_script_remap",
            `VD guard: remapped feature_script → season_script (feature_script is illegal for vertical-drama)`);
          await updateJob(supabase, jobId, { current_document: "season_script" });
          return respondWithJob(supabase, jobId, "run-next");
        }

        if (needsSetup) {
          console.log(`[auto-run] ${gateLabel} gate entered`, { jobId, currentDoc, format, isWritingStage, isPrepStage });

          // ── Recovery tracking with real backoff ──
          const stageHist = (job.stage_history || {}) as any;
          const setupKey = isWritingStage ? "_prewrite" : "_prep";
          const existingSetupAttempts = stageHist[`${setupKey}_setup_attempts`] ?? 0;
          const nextRetryAt = stageHist[`${setupKey}_setup_next_retry_at`] ?? null;
          const MAX_SETUP_ATTEMPTS = 3;
          const BACKOFF_DELAYS = [5, 15, 30];

          // ── Real backoff: if next_retry_at is in the future, return immediately ──
          if (nextRetryAt) {
            const retryTime = new Date(nextRetryAt).getTime();
            const now = Date.now();
            if (now < retryTime) {
              const waitSec = Math.ceil((retryTime - now) / 1000);
              console.log(`[auto-run] ${gateLabel}: waiting for backoff (${waitSec}s remaining)`, { jobId, nextRetryAt });
              await updateJob(supabase, jobId, {
                status: "recovering",
                last_ui_message: `Recovering: ${gateLabel} retrying in ${waitSec}s (attempt ${existingSetupAttempts}/${MAX_SETUP_ATTEMPTS})`,
              });
              return respondWithJob(supabase, jobId, `${gateLabel.toLowerCase()}-backoff-wait`);
            }
            // Backoff expired — clear next_retry_at, proceed with attempt
            stageHist[`${setupKey}_setup_next_retry_at`] = null;
          }

          const setupMissing: string[] = [];
          const setupResolved: string[] = [];

          // 1) Canon OS — world_rules + logline + premise + characters
          const { data: canonRow } = await supabase.from("project_canon")
            .select("canon_json").eq("project_id", job.project_id).maybeSingle();
          const cj = (canonRow?.canon_json || {}) as any;
          const hasWorldRules = Array.isArray(cj.world_rules) && cj.world_rules.length > 0;
          const hasLogline = typeof cj.logline === "string" && cj.logline.trim().length > 0;
          const hasPremise = typeof cj.premise === "string" && cj.premise.trim().length > 0;
          const hasCharacters = Array.isArray(cj.characters) && cj.characters.length > 0;

          if (!hasWorldRules || !hasLogline || !hasPremise || !hasCharacters) {
            console.log(`[auto-run] ${gateLabel}: canon OS incomplete, attempting extract (attempt ${existingSetupAttempts + 1}/${MAX_SETUP_ATTEMPTS})`, {
              hasWorldRules, hasLogline, hasPremise, hasCharacters,
            });
            let extractOk = false;
            try {
              const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
              const extractResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
                body: JSON.stringify({
                  action: "canon_os_extract_from_seed_docs",
                  projectId: job.project_id,
                  userId: job.user_id,
                }),
              });
              if (extractResp.ok) {
                const extractResult = await extractResp.json();
                console.log(`[auto-run] ${gateLabel}: canon extract result`, extractResult);
                if (extractResult.updated || extractResult.reason === "already_populated") {
                  extractOk = true;
                  setupResolved.push("canon_os");
                }
              }
            } catch (e: any) {
              console.warn(`[auto-run] ${gateLabel}: canon extract attempt failed`, { attempt: existingSetupAttempts, error: e.message });
            }

            if (!extractOk) {
              // Re-check DB in case another process populated it
              const { data: recheck } = await supabase.from("project_canon")
                .select("canon_json").eq("project_id", job.project_id).maybeSingle();
              const rcj = (recheck?.canon_json || {}) as any;
              const recheckOk = (Array.isArray(rcj.world_rules) && rcj.world_rules.length > 0)
                && (typeof rcj.logline === "string" && rcj.logline.trim().length > 0);
              if (recheckOk) {
                setupResolved.push("canon_os_found_on_recheck");
              } else if (existingSetupAttempts + 1 < MAX_SETUP_ATTEMPTS) {
                // Schedule retry with REAL backoff delay
                const retryDelay = BACKOFF_DELAYS[existingSetupAttempts] || 30;
                const nextRetry = new Date(Date.now() + retryDelay * 1000).toISOString();
                console.log(`[auto-run] ${gateLabel}: canon extract failed, scheduling retry`, { attempt: existingSetupAttempts + 1, retryDelay, nextRetry });
                await logStep(supabase, jobId, stepCount, currentDoc, `${gateLabel.toLowerCase()}_retry`,
                  `Canon OS extract failed (attempt ${existingSetupAttempts + 1}/${MAX_SETUP_ATTEMPTS}). Next retry at ${nextRetry}.`,
                  {}, undefined, { attempt: existingSetupAttempts + 1, retryDelaySeconds: retryDelay, nextRetryAt: nextRetry });
                stageHist[`${setupKey}_setup_attempts`] = existingSetupAttempts + 1;
                stageHist[`${setupKey}_setup_next_retry_at`] = nextRetry;
                await updateJob(supabase, jobId, {
                  stage_history: stageHist,
                  last_ui_message: `${gateLabel}: Canon extract failed, retrying in ${retryDelay}s (attempt ${existingSetupAttempts + 1}/${MAX_SETUP_ATTEMPTS})`,
                });
                return respondWithJob(supabase, jobId, "run-next");
              } else {
                setupMissing.push("canon_os_world_rules");
              }
            }
          }

          // 2) Writing Voice — check project_lane_prefs (use canonical shared resolver)
          const lane = project?.assigned_lane || "independent-film";
          const { data: prefsRow } = await supabase.from("project_lane_prefs")
            .select("prefs").eq("project_id", job.project_id).eq("lane", lane).maybeSingle();
          const lanePrefs = prefsRow?.prefs || {};
          const hasVoice = !!(lanePrefs as any).writing_voice?.id || !!(lanePrefs as any).team_voice?.id;

          if (!hasVoice) {
            if (allowDefaults) {
              // Use canonical shared resolver (no hardcoded IDs)
              const defaultVoice = getDefaultWritingVoiceForLane(lane, format);

              // Persist the voice in project_lane_prefs
              const mergedPrefs = { ...lanePrefs, writing_voice: { id: defaultVoice.id, label: defaultVoice.label } };
              await supabase.from("project_lane_prefs").upsert({
                project_id: job.project_id,
                lane,
                prefs: mergedPrefs,
              }, { onConflict: "project_id,lane" });

              setupResolved.push(`writing_voice=${defaultVoice.id}`);
              console.log(`[auto-run] ${gateLabel}: auto-set writing voice via canonical resolver`, defaultVoice);
            } else {
              setupMissing.push("writing_voice");
            }
          }

          // 3) Comparables — check canon_json.comparables or comparable_candidates table
          const hasCanonComps = Array.isArray(cj.comparables) && cj.comparables.length > 0;
          let hasTableComps = false;
          if (!hasCanonComps) {
            const { count } = await supabase.from("comparable_candidates")
              .select("id", { count: "exact", head: true })
              .eq("project_id", job.project_id);
            hasTableComps = (count || 0) > 0;
          }

          if (!hasCanonComps && !hasTableComps) {
            // Check if seed_intel_pack has comparable_candidates to init from
            const packComps = cj.seed_intel_pack?.comparable_candidates;
            if (Array.isArray(packComps) && packComps.length > 0) {
              // Init comparables from pack into canon_json.comparables
              const { data: currentCanon } = await supabase.from("project_canon")
                .select("canon_json").eq("project_id", job.project_id).maybeSingle();
              const updatedCanon = { ...(currentCanon?.canon_json || {}), comparables: packComps.slice(0, 12) };
              await supabase.from("project_canon")
                .update({ canon_json: updatedCanon, updated_by: job.user_id })
                .eq("project_id", job.project_id);
              setupResolved.push(`comparables_from_pack=${packComps.length}`);
              console.log(`[auto-run] ${gateLabel}: init comparables from seed_intel_pack`, { count: packComps.length });
            } else if (allowDefaults) {
              // Auto-generate comparables via LLM (dev-engine-v2 action)
              try {
                const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
                const compResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
                  body: JSON.stringify({
                    action: "auto_generate_comparables",
                    projectId: job.project_id,
                    userId: job.user_id,
                  }),
                });
                if (compResp.ok) {
                  const compResult = await compResp.json();
                  if (compResult.generated) {
                    setupResolved.push(`comparables_auto_generated=${compResult.count}`);
                    console.log(`[auto-run] ${gateLabel}: auto-generated comparables via LLM`, { count: compResult.count });
                  } else if (compResult.reason === "already_exists" || compResult.reason === "table_has_candidates") {
                    setupResolved.push("comparables_already_exist");
                  } else if (compResult.reason === "no_logline_or_premise") {
                    // Need canon extract first — trigger it and retry
                    console.warn(`[auto-run] ${gateLabel}: comparables need logline/premise first, scheduling retry`);
                    if (existingSetupAttempts + 1 < MAX_SETUP_ATTEMPTS) {
                      const retryDelay = BACKOFF_DELAYS[existingSetupAttempts] || 30;
                      const nextRetry = new Date(Date.now() + retryDelay * 1000).toISOString();
                      stageHist[`${setupKey}_setup_attempts`] = existingSetupAttempts + 1;
                      stageHist[`${setupKey}_setup_next_retry_at`] = nextRetry;
                      await updateJob(supabase, jobId, { stage_history: stageHist });
                      return respondWithJob(supabase, jobId, "run-next");
                    }
                    setupMissing.push("comparables");
                  } else {
                    console.warn(`[auto-run] ${gateLabel}: comparables generation returned`, compResult);
                    setupMissing.push("comparables");
                  }
                } else {
                  console.warn(`[auto-run] ${gateLabel}: comparables generation HTTP error`, { status: compResp.status });
                  setupMissing.push("comparables");
                }
              } catch (compErr: any) {
                console.warn(`[auto-run] ${gateLabel}: comparables auto-generate failed`, { error: compErr.message });
                setupMissing.push("comparables");
              }
            } else {
              setupMissing.push("comparables");
            }
          }

          // 4) NEC — Narrative Energy Contract must exist (especially before writing)
          if (isWritingStage) {
            const { data: necDoc } = await supabase.from("project_documents")
              .select("id, latest_version_id")
              .eq("project_id", job.project_id)
              .eq("doc_type", "nec")
              .limit(1)
              .maybeSingle();

            const hasNEC = !!(necDoc?.id && necDoc?.latest_version_id);

            if (!hasNEC) {
              if (allowDefaults) {
                // Auto-generate minimal NEC from canon fields + format
                try {
                  await autoGenerateNEC(supabase, job, jobId, format, gateLabel);
                  setupResolved.push("nec_auto_generated");
                } catch (necErr: any) {
                  console.warn(`[auto-run] ${gateLabel}: NEC generation failed`, { error: necErr.message });
                  setupMissing.push("nec");
                }
              } else {
                setupMissing.push("nec");
              }
            } else if (allowDefaults && resolverHash) {
              // NEC exists — check if stale (resolver hash mismatch OR missing hash)
              const { data: necVer } = await supabase.from("project_document_versions")
                .select("id, depends_on_resolver_hash")
                .eq("document_id", necDoc.id)
                .eq("is_current", true)
                .limit(1)
                .maybeSingle();
              const necHash = necVer?.depends_on_resolver_hash || null;
              // Regenerate if: hash is null (seed NEC never tracked) OR hash differs from current
              const necIsStale = !necHash || necHash !== resolverHash;
              if (necIsStale) {
                console.log(`[auto-run] ${gateLabel}: NEC stale — auto-regenerating (hash ${necHash || "null"} → ${resolverHash})`);
                try {
                  await autoGenerateNEC(supabase, job, jobId, format, gateLabel, resolverHash);
                  setupResolved.push(necHash ? "nec_auto_regenerated_stale" : "nec_auto_regenerated_missing_hash");
                } catch (necErr: any) {
                  console.warn(`[auto-run] ${gateLabel}: NEC stale regen failed (non-fatal)`, { error: necErr.message });
                  // Non-fatal: existing NEC still usable, just stale
                }
              }
            }
          }

          // Log the setup gate result
          if (setupResolved.length > 0 || setupMissing.length > 0) {
            await logStep(supabase, jobId, stepCount, currentDoc, gateLabel.toLowerCase(),
              setupMissing.length > 0
                ? `${gateLabel} incomplete: missing=[${setupMissing.join(",")}] resolved=[${setupResolved.join(",")}]`
                : `${gateLabel} complete: resolved=[${setupResolved.join(",")}]`,
              {}, undefined, { setupMissing, setupResolved },
            );
          }

          // If critical setup is missing and !allowDefaults, pause
          if (setupMissing.length > 0 && !allowDefaults) {
            const stopReasonMap: Record<string, string> = {
              canon_os_world_rules: "NEEDS_WORLD_RULES",
              writing_voice: "NEEDS_WRITING_VOICE",
              comparables: "NEEDS_COMPARABLES",
              nec: "NEEDS_NEC",
            };
            const primaryStop = stopReasonMap[setupMissing[0]] || `PREWRITE_SETUP_INCOMPLETE`;
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: `${primaryStop}: ${setupMissing.join(", ")}`,
              awaiting_approval: true,
              approval_type: "prewrite_setup",
              last_ui_message: `Writing cannot begin: ${setupMissing.join(", ")} must be configured. Set them in the project settings and resume.`,
            });
            return respondWithJob(supabase, jobId, "prewrite-setup-incomplete");
          }

          // If any setup is missing with allowDefaults=true:
          // ── Cost fix: do NOT pause — that causes infinite auto-resume loops ──
          // Log the failure and proceed. These are advisory/contextual inputs;
          // generation can proceed without them (quality may be lower but won't loop).
          if (setupMissing.length > 0 && allowDefaults) {
            const failedItems = setupMissing.join(", ");
            await logStep(supabase, jobId, stepCount, currentDoc, `${gateLabel.toLowerCase()}_setup_skipped`,
              `SETUP_SKIPPED (allow_defaults=true): [${failedItems}] could not be auto-populated after ${MAX_SETUP_ATTEMPTS} attempts. Proceeding without — generation will use available context only.`);
            console.warn(`[auto-run] setup skipped in autonomous mode`, { jobId, currentDoc, failedItems });
            // Fall through to generation — do NOT pause or return
          }

          // Clear retry counters on success
          if (existingSetupAttempts > 0) {
            stageHist[`${setupKey}_setup_attempts`] = 0;
            stageHist[`${setupKey}_setup_next_retry_at`] = null;
            await updateJob(supabase, jobId, { stage_history: stageHist });
          }
        }
      }

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
            stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
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
        // ── SEED CORE OFFICIAL GATE ──
        // Before deriving a downstream doc, ensure seed core is approved
        const seedCheck = await isSeedCoreOfficial(supabase, job.project_id);
        if (!seedCheck.official) {
          if (job.allow_defaults && seedCheck.missing.length === 0) {
            // Auto-approve seed core in Full Autopilot mode (all docs exist, just unapproved)
            const gateStep = stepCount + 1;
            for (const dt of seedCheck.unapproved) {
              const { data: sDocs } = await supabase.from("project_documents").select("id").eq("project_id", job.project_id).eq("doc_type", dt).limit(1);
              const sDocId = sDocs?.[0]?.id;
              if (sDocId) {
                const { data: sVers } = await supabase.from("project_document_versions").select("id").eq("document_id", sDocId).eq("is_current", true).limit(1);
                if (sVers?.[0]) {
                  await supabase.from("project_document_versions").update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: job.user_id }).eq("id", sVers[0].id);
                }
              }
            }
            await logStep(supabase, jobId, gateStep, currentDoc, "seed_core_auto_approved",
              `Seed core auto-approved (allow_defaults) — ${seedCheck.unapproved.join(", ")}`
            );
            await updateJob(supabase, jobId, { step_count: gateStep });
            // Fall through to continue generation
          } else {
            const gateStep = stepCount + 1;
            await logStep(supabase, jobId, gateStep, currentDoc, "seed_core_block",
              `Seed core not official — missing: [${seedCheck.missing.join(",")}], unapproved: [${seedCheck.unapproved.join(",")}]`
            );
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: "SEED_CORE_NOT_OFFICIAL",
              awaiting_approval: true,
              approval_type: "seed_core_officialize",
              step_count: gateStep,
              error: JSON.stringify({ missing_seed_docs: seedCheck.missing, unapproved_seed_docs: seedCheck.unapproved }),
            });
            return respondWithJob(supabase, jobId, "seed-core-not-official");
          }
        }

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

        // Prefer approved+current (authoritative) version; fallback to latest by version_number
        const { data: prevVersions } = await supabase.from("project_document_versions")
          .select("id, approval_status, is_current, version_number")
          .eq("document_id", prevDoc.id)
          .order("version_number", { ascending: false });
        const prevVersionCandidates = prevVersions || [];
        const prevVersion =
          prevVersionCandidates.find((v: any) => v.approval_status === "approved" && v.is_current === true) ||
          prevVersionCandidates.find((v: any) => v.approval_status === "approved") ||
          prevVersionCandidates[0] || null;
        if (!prevVersion) {
          await updateJob(supabase, jobId, { status: "failed", error: `No version for ${prevStage} document` });
          return respondWithJob(supabase, jobId);
        }

        // ── Route large-risk doc types through generate-document (chunked pipeline) ──
        // Also route format_rules through generate-document for vertical-drama (VD_FORMAT_RULES_SEED)
        const EPISODE_DOC_TYPES_SET = new Set(["episode_grid", "vertical_episode_beats", "episode_beats", "season_script"]);
        const isVdFormatRules = currentDoc === "format_rules" && format === "vertical-drama";
        const useChunkedGenerator = EPISODE_DOC_TYPES_SET.has(currentDoc) || isLargeRiskDocType(currentDoc) || isVdFormatRules;

        try {
          let convertedDocId: string | null = null;
          let convertedVersionId: string | null = null;

          if (useChunkedGenerator) {
            // Use generate-document which has the chunked episode beats pipeline
            // This prevents truncation for high episode counts (e.g. 35 episodes)
            console.log("[auto-run] Using generate-document chunked pipeline for", currentDoc, { projectId: job.project_id });

            const genResult = await callEdgeFunction(supabaseUrl, "generate-document", {
              projectId: job.project_id,
              docType: currentDoc,
              userId: job.user_id,
              sourceDocType: prevStage,
              sourceVersionId: prevVersion.id,
            }, token);

            // ── Background generation: if generate-document returned generating:true, the doc
            // is being built in a background task (e.g. episode_beats for 30+ episodes).
            // Log the step and yield — auto-run will re-enter on the next cron tick and check
            // whether the version content has arrived before attempting analysis.
            if (genResult?.generating === true) {
              const bgVersionId = genResult?.version_id || genResult?.versionId || null;
              const bgDocId = genResult?.document_id || genResult?.documentId || null;
              const newStep = stepCount + 1;
              await logStep(supabase, jobId, newStep, currentDoc, "generate",
                `Background generation started for ${currentDoc} (${genResult?.episode_count ?? "?"} episodes) — waiting for completion`,
                {}, bgDocId ? `Doc ${bgDocId}` : undefined,
                bgDocId ? { docId: bgDocId, versionId: bgVersionId, generating: true } : undefined
              );
              await updateJob(supabase, jobId, { step_count: newStep, stage_loop_count: (job.stage_loop_count || 0) });
              // Yield — next cron tick will re-enter and check version status
              return respondWithJob(supabase, jobId);
            }

            convertedDocId = genResult?.documentId || genResult?.document_id || null;
            convertedVersionId = genResult?.versionId || genResult?.version_id || null;

            // If generate-document didn't return IDs, look them up
            if (!convertedDocId) {
              const { data: newDocs } = await supabase.from("project_documents")
                .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
                .order("created_at", { ascending: false }).limit(1);
              convertedDocId = newDocs?.[0]?.id || null;
            }
            if (convertedDocId && !convertedVersionId) {
              const { data: newVers } = await supabase.from("project_document_versions")
                .select("id").eq("document_id", convertedDocId)
                .order("version_number", { ascending: false }).limit(1);
              convertedVersionId = newVers?.[0]?.id || null;
            }
          } else {
            // ── FIX 2: Assimilation Context — fetch approved plaintext of all preceding stages ──
            const ASSIMILATION_STAGES = ["concept_brief", "treatment", "story_outline", "character_bible", "beat_sheet"];
            const ASSIMILATION_TARGETS = new Set(["feature_script", "production_draft", "season_script", "episode_script"]);
            let assimilationContext: Record<string, string> | undefined;
            if (ASSIMILATION_TARGETS.has(currentDoc)) {
              assimilationContext = {};
              for (const stage of ASSIMILATION_STAGES) {
                try {
                  const { data: stageDocs } = await supabase.from("project_documents")
                    .select("id").eq("project_id", job.project_id).eq("doc_type", stage)
                    .order("created_at", { ascending: false }).limit(1);
                  if (stageDocs?.[0]) {
                    const { data: stageVers } = await supabase.from("project_document_versions")
                      .select("plaintext, approval_status, is_current")
                      .eq("document_id", stageDocs[0].id)
                      .order("version_number", { ascending: false });
                    const approved = (stageVers || []).find((v: any) => v.approval_status === "approved" && v.is_current) ||
                      (stageVers || []).find((v: any) => v.approval_status === "approved") ||
                      (stageVers || [])[0];
                    if (approved?.plaintext && approved.plaintext.trim().length > 50) {
                      assimilationContext[stage] = approved.plaintext;
                    }
                  }
                } catch (aErr: any) {
                  console.warn(`[auto-run] assimilation_context_fetch_failed { stage: "${stage}", error: "${aErr?.message}" }`);
                }
              }
              if (Object.keys(assimilationContext).length === 0) assimilationContext = undefined;
              else console.log(`[auto-run] assimilation_context_resolved { doc: "${currentDoc}", stages: ${JSON.stringify(Object.keys(assimilationContext))} }`);
            }

            const { result: convertResult } = await callEdgeFunctionWithRetry(
              supabase, supabaseUrl, "dev-engine-v2", {
                action: "convert",
                projectId: job.project_id,
                documentId: prevDoc.id,
                versionId: prevVersion.id,
                targetOutput: currentDoc.toUpperCase(),
                ...(assimilationContext ? { assimilationContext } : {}),
              }, token, job.project_id, format, currentDoc, jobId, stepCount + 1
            );

            convertedDocId = convertResult?.newDoc?.id || convertResult?.documentId || null;
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
              convertedDocId = newDocRow?.id || null;
              if (newDocRow) {
                const { data: newVers } = await supabase.from("project_document_versions")
                  .select("id").eq("document_id", newDocRow.id)
                  .order("version_number", { ascending: false }).limit(1);
                convertedVersionId = newVers?.[0]?.id || null;
              }
            }
          }

          const newStep = stepCount + 1;
          await logStep(supabase, jobId, newStep, currentDoc, "generate", `Generated ${currentDoc} from ${prevStage}${useChunkedGenerator ? ' (chunked pipeline)' : ''}`, {}, convertedDocId ? `Created doc ${convertedDocId}` : undefined, convertedDocId ? { docId: convertedDocId } : undefined);
          await updateJob(supabase, jobId, { step_count: newStep, stage_loop_count: 0, stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4 });

          // ── APPROVAL GATE: after convert ──
          if (job.allow_defaults) {
            // Full Autopilot: auto-approve the generated doc and continue
            if (convertedVersionId) {
              // Stamp provenance: source_version_id in meta_json + approval fields
              const { data: existingVer } = await supabase.from("project_document_versions")
                .select("meta_json").eq("id", convertedVersionId).maybeSingle();
              const mergedMeta = { ...(existingVer?.meta_json || {}), source_version_id: prevVersion.id };
              await supabase.from("project_document_versions").update({
                approval_status: "approved",
                approved_at: new Date().toISOString(),
                approved_by: job.user_id,
                generator_id: "auto-run-convert",
                meta_json: mergedMeta,
              }).eq("id", convertedVersionId);
            }
            await logStep(supabase, jobId, null, currentDoc, "auto_approved_convert",
              `Auto-approved generated ${currentDoc} (allow_defaults)`,
              {}, undefined, { docId: convertedDocId, versionId: convertedVersionId, doc_type: currentDoc, from_stage: prevStage }
            );
            // Re-fetch doc and latestVersion so downstream code has valid references
            if (convertedDocId) {
              const { data: freshDoc } = await supabase.from("project_documents")
                .select("id, doc_type, plaintext, extracted_text")
                .eq("id", convertedDocId).single();
              if (freshDoc) doc = freshDoc;
            }
            if (convertedVersionId) {
              const { data: freshVer } = await supabase.from("project_document_versions")
                .select("id, plaintext, version_number")
                .eq("id", convertedVersionId).single();
              if (freshVer) latestVersion = freshVer;
            }
            // Continue — don't pause
          } else {
            await logStep(supabase, jobId, null, currentDoc, "approval_required",
              `Review generated ${currentDoc} before continuing`,
              {}, undefined, { docId: convertedDocId, versionId: convertedVersionId, doc_type: currentDoc, from_stage: prevStage }
            );
            await updateJob(supabase, jobId, {
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
          }
        } catch (e: any) {
          await updateJob(supabase, jobId, { status: "failed", error: `Generate failed: ${e.message}` });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", `Generate failed: ${e.message}`);
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Document exists — resolve version via ABVR ──
      if (!latestVersion) {
        const abvr = await resolveActiveVersionForDoc(supabase, job, doc.id);
        if (abvr) {
          const { data: resolvedVer } = await supabase.from("project_document_versions")
            .select("id, plaintext, version_number")
            .eq("id", abvr.versionId).single();
          if (resolvedVer) {
            latestVersion = resolvedVer;
            console.log(`[auto-run][IEL] abvr_version_resolved { job_id: "${jobId}", doc_type: "${currentDoc}", version_id: "${abvr.versionId}", source: "${abvr.source}", version_number: ${resolvedVer.version_number} }`);
          }
        }
        // Fallback: if ABVR returned nothing, try latest by version_number (defensive)
        if (!latestVersion) {
          const { data: versions } = await supabase.from("project_document_versions")
            .select("id, plaintext, version_number")
            .eq("document_id", doc.id)
            .order("version_number", { ascending: false }).limit(1);
          latestVersion = versions?.[0];
        }
      }
      if (!latestVersion) {
        // Doc slot exists but has zero versions — treat as missing and re-enter
        // generation path by clearing doc and restarting this iteration
        console.warn(`[auto-run] Doc slot ${doc.id} (${currentDoc}) has no versions — will generate`);
        doc = null;
        // Re-run the generation logic inline (same as the !doc branch above)
        const seedCheck2 = await isSeedCoreOfficial(supabase, job.project_id);
        if (!seedCheck2.official) {
          if (job.allow_defaults && seedCheck2.missing.length === 0) {
            for (const dt of seedCheck2.unapproved) {
              const { data: sDocs } = await supabase.from("project_documents").select("id").eq("project_id", job.project_id).eq("doc_type", dt).limit(1);
              const sDocId = sDocs?.[0]?.id;
              if (sDocId) {
                const { data: sVers } = await supabase.from("project_document_versions").select("id").eq("document_id", sDocId).eq("is_current", true).limit(1);
                if (sVers?.[0]) {
                  await supabase.from("project_document_versions").update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: job.user_id }).eq("id", sVers[0].id);
                }
              }
            }
            await logStep(supabase, jobId, stepCount, currentDoc, "seed_core_auto_approved", `Seed core auto-approved (allow_defaults, empty-slot) — ${seedCheck2.unapproved.join(", ")}`);
          } else {
            await updateJob(supabase, jobId, {
              status: "paused", stop_reason: "SEED_CORE_NOT_OFFICIAL",
              awaiting_approval: true, approval_type: "seed_core_officialize",
              error: JSON.stringify({ missing_seed_docs: seedCheck2.missing, unapproved_seed_docs: seedCheck2.unapproved }),
            });
            return respondWithJob(supabase, jobId, "seed-core-not-official");
          }
        }
        // Find previous stage to convert from
        const pipeline2 = getLadderForJob(format);
        const stageIdx2 = pipeline2.indexOf(currentDoc);
        const prevStage2 = stageIdx2 > 0 ? pipeline2[stageIdx2 - 1] : null;
        if (!prevStage2) {
          await updateJob(supabase, jobId, { status: "failed", error: `No previous stage to generate ${currentDoc} from (empty doc slot)` });
          return respondWithJob(supabase, jobId);
        }
        const { data: prevDocs2 } = await supabase.from("project_documents")
          .select("id, doc_type, plaintext, extracted_text")
          .eq("project_id", job.project_id).eq("doc_type", prevStage2)
          .order("created_at", { ascending: false }).limit(1);
        const prevDoc2 = prevDocs2?.[0];
        if (!prevDoc2) {
          await updateJob(supabase, jobId, { status: "failed", error: `No ${prevStage2} document for empty-slot recovery` });
          return respondWithJob(supabase, jobId);
        }
        const { data: prevVersions2 } = await supabase.from("project_document_versions")
          .select("id, approval_status, is_current, version_number")
          .eq("document_id", prevDoc2.id)
          .order("version_number", { ascending: false });
        const prevVersion2Candidates = prevVersions2 || [];
        const prevVersion2 =
          prevVersion2Candidates.find((v: any) => v.approval_status === "approved" && v.is_current === true) ||
          prevVersion2Candidates.find((v: any) => v.approval_status === "approved") ||
          prevVersion2Candidates[0] || null;
        if (!prevVersion2) {
          await updateJob(supabase, jobId, { status: "failed", error: `No version for ${prevStage2} in empty-slot recovery` });
          return respondWithJob(supabase, jobId);
        }
        const useChunked2 = new Set(["episode_grid", "vertical_episode_beats", "episode_beats"]).has(currentDoc) || isLargeRiskDocType(currentDoc);
        try {
          let genDocId2: string | null = null;
          let genVerId2: string | null = null;

          if (useChunked2) {
            const genResult2 = await callEdgeFunction(supabaseUrl, "generate-document", {
              projectId: job.project_id,
              docType: currentDoc,
              userId: job.user_id,
              sourceDocType: prevStage2,
              sourceVersionId: prevVersion2.id,
            }, token);

            genDocId2 = genResult2?.documentId || genResult2?.document_id || null;
            genVerId2 = genResult2?.versionId || genResult2?.version_id || null;
          } else {
            const { result: convertResult2 } = await callEdgeFunctionWithRetry(
              supabase, supabaseUrl, "dev-engine-v2", {
                action: "convert",
                projectId: job.project_id,
                documentId: prevDoc2.id,
                versionId: prevVersion2.id,
                targetOutput: currentDoc.toUpperCase(),
              }, token, job.project_id, format, currentDoc, jobId, stepCount + 1
            );
            genDocId2 = convertResult2?.newDoc?.id || convertResult2?.documentId || null;
          }

          if (!genDocId2) {
            const { data: newDocs2 } = await supabase.from("project_documents")
              .select("id")
              .eq("project_id", job.project_id)
              .eq("doc_type", currentDoc)
              .order("created_at", { ascending: false }).limit(1);
            genDocId2 = newDocs2?.[0]?.id || null;
          }
          if (genDocId2 && !genVerId2) {
            const { data: newVers2 } = await supabase.from("project_document_versions")
              .select("id")
              .eq("document_id", genDocId2)
              .order("version_number", { ascending: false }).limit(1);
            genVerId2 = newVers2?.[0]?.id || null;
          }

          if (!genDocId2 || !genVerId2) {
            const reason = `Empty-slot recovery generated no document/version for ${currentDoc}`;
            await logStep(supabase, jobId, stepCount + 1, currentDoc, "empty_slot_recovery_failed", reason,
              {}, undefined, {
                currentDoc,
                targetDoc: currentDoc,
                reason,
                required_inputs_missing: [!genDocId2 ? "generated_document" : null, !genVerId2 ? "generated_version" : null].filter(Boolean),
                job_id: jobId,
                document_id: genDocId2 || prevDoc2.id,
              });
            await updateJob(supabase, jobId, {
              status: "paused",
              pause_reason: "EMPTY_SLOT_RECOVERY_FAILED",
              stop_reason: reason,
              error: reason,
              last_ui_message: reason,
            });
            return respondWithJob(supabase, jobId);
          }

          const ns2 = stepCount + 1;
          await logStep(supabase, jobId, ns2, currentDoc, "generate", `Generated ${currentDoc} from ${prevStage2} (empty-slot recovery)`, {}, genDocId2 ? `Created doc ${genDocId2}` : undefined, genDocId2 ? { docId: genDocId2 } : undefined);
          await updateJob(supabase, jobId, { step_count: ns2, stage_loop_count: 0, stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4 });
          if (job.allow_defaults) {
            if (genVerId2) {
              const { data: existingVer2 } = await supabase.from("project_document_versions")
                .select("meta_json").eq("id", genVerId2).maybeSingle();
              const mergedMeta2 = { ...(existingVer2?.meta_json || {}), source_version_id: prevVersion2.id };
              await supabase.from("project_document_versions").update({
                approval_status: "approved",
                approved_at: new Date().toISOString(),
                approved_by: job.user_id,
                generator_id: "auto-run-convert",
                meta_json: mergedMeta2,
              }).eq("id", genVerId2);
            }
            await logStep(supabase, jobId, null, currentDoc, "auto_approved_convert", `Auto-approved generated ${currentDoc} (allow_defaults, empty-slot)`, {}, undefined, { docId: genDocId2, versionId: genVerId2, doc_type: currentDoc, from_stage: prevStage2 });
            // Continue — don't pause
          } else {
            await logStep(supabase, jobId, null, currentDoc, "approval_required", `Review generated ${currentDoc} before continuing`, {}, undefined, { docId: genDocId2, versionId: genVerId2, doc_type: currentDoc, from_stage: prevStage2 });
            await updateJob(supabase, jobId, { status: "paused", stop_reason: `Approval required: review generated ${currentDoc}`, awaiting_approval: true, approval_type: "convert", pending_doc_id: genDocId2 || prevDoc2.id, pending_version_id: genVerId2, pending_doc_type: currentDoc, pending_next_doc_type: currentDoc });
            return respondWithJob(supabase, jobId, "awaiting-approval");
          }
        } catch (e2: any) {
          // ── CANON_MISMATCH RETRY in empty-slot recovery ──
          if (e2.message?.includes("CANON_MISMATCH")) {
            const MAX_CANON_LOCK_RETRIES = 4;
            const metaJson = (job as any).meta_json || {};
            const canonRetries = metaJson.canon_mismatch_retries || {};
            const retryCount = (canonRetries[currentDoc] || 0) + 1;

            if (retryCount <= MAX_CANON_LOCK_RETRIES) {
              // ── CANON-LOCK: fetch + normalize + prioritize canonical entities ──
              let canonEntityPack: string[] = [];
              let coreEntities: string[] = [];
              let secondaryEntities: string[] = [];
              try {
                const canonData = await buildCanonEntitiesFromDB(supabase, job.project_id);
                const rawEntities = canonData?.entities || [];
                canonEntityPack = normalizeCanonEntities(rawEntities);
                const prioritized = prioritizeCanonEntities(canonEntityPack);
                coreEntities = prioritized.core;
                secondaryEntities = prioritized.secondary;
                console.log(`[auto-run] Canon entity normalization (empty-slot): raw=${rawEntities.length} -> normalized=${canonEntityPack.length}, core=${coreEntities.length}, secondary=${secondaryEntities.length}`);
              } catch (ce: any) {
                console.warn(`[auto-run] canon entity fetch failed for retry (empty-slot): ${ce.message}`);
              }

              const attemptId = (metaJson.canon_lock_attempt_id || 0) + 1;
              await logStep(supabase, jobId, stepCount + 1, currentDoc, "canon_lock_retry",
                `CANON_MISMATCH retry ${retryCount}/${MAX_CANON_LOCK_RETRIES} (empty-slot recovery, core=${coreEntities.length}, secondary=${secondaryEntities.length}, attempt_id=${attemptId}): ${e2.message.slice(0, 200)}`,
                {}, undefined,
                { retry_count: retryCount, max_retries: MAX_CANON_LOCK_RETRIES, entity_count: canonEntityPack.length, core_count: coreEntities.length, secondary_count: secondaryEntities.length, attempt_id: attemptId, error_excerpt: e2.message.slice(0, 300), doc_type: currentDoc, path: "empty_slot_recovery" });

              const updatedRetries = { ...canonRetries, [currentDoc]: retryCount };
              await updateJob(supabase, jobId, {
                step_count: stepCount + 1,
                meta_json: {
                  ...metaJson,
                  canon_mismatch_retries: updatedRetries,
                  canon_lock_core_entities: coreEntities,
                  canon_lock_secondary_entities: secondaryEntities,
                  canon_lock_entities: canonEntityPack,
                  canon_lock_mode: true,
                  canon_lock_attempt_id: attemptId,
                },
              });
              return respondWithJob(supabase, jobId, "run-next");
            }

            // Exhausted retries — pause with specific reason (NOT EMPTY_SLOT_RECOVERY_FAILED)
            await logStep(supabase, jobId, stepCount + 1, currentDoc, "canon_mismatch_stuck",
              `CANON_MISMATCH stuck after ${retryCount - 1} retries (empty-slot recovery): ${e2.message.slice(0, 200)}`,
              {}, undefined,
              { retry_count: retryCount - 1, max_retries: MAX_CANON_LOCK_RETRIES, error_excerpt: e2.message.slice(0, 300) });
            await updateJob(supabase, jobId, {
              status: "paused",
              pause_reason: "canon_mismatch_stuck",
              stop_reason: `Canon alignment failed after ${MAX_CANON_LOCK_RETRIES} retries for ${currentDoc}. ${e2.message.slice(0, 200)}`,
              error: e2.message.slice(0, 500),
            });
            return respondWithJob(supabase, jobId);
          }

          const reason = `Generate failed (empty-slot recovery): ${e2.message}`;
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "empty_slot_recovery_failed", reason,
            {}, undefined, {
              currentDoc,
              targetDoc: currentDoc,
              reason,
              required_inputs_missing: ["generation_call_failed"],
              job_id: jobId,
              document_id: prevDoc2.id,
            });
          await updateJob(supabase, jobId, {
            status: "paused",
            pause_reason: "EMPTY_SLOT_RECOVERY_FAILED",
            stop_reason: reason,
            error: reason,
            last_ui_message: reason,
          });
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Re-fetch doc after empty-slot recovery (doc may have been nulled at line ~5425) ──
      if (!doc) {
        const { data: recoveredDocs } = await supabase.from("project_documents")
          .select("id, doc_type, plaintext, extracted_text")
          .eq("project_id", job.project_id).eq("doc_type", currentDoc)
          .order("created_at", { ascending: false }).limit(1);
        doc = recoveredDocs?.[0] || null;
        if (doc && !latestVersion) {
          const { data: recoveredVers } = await supabase.from("project_document_versions")
            .select("id, plaintext, version_number, criteria_hash")
            .eq("document_id", doc.id)
            .order("version_number", { ascending: false }).limit(1);
          latestVersion = recoveredVers?.[0] || null;
        }
        if (!doc) {
          console.error(`[auto-run][IEL] doc_still_null_after_recovery { currentDoc: "${currentDoc}", jobId: "${jobId}" }`);
          await updateJob(supabase, jobId, { status: "paused", pause_reason: "EMPTY_SLOT_RECOVERY_FAILED", error: `Document ${currentDoc} still missing after empty-slot recovery` });
          return respondWithJob(supabase, jobId);
        }
        console.log(`[auto-run][IEL] doc_refetched_after_recovery { docId: "${doc.id}", currentDoc: "${currentDoc}" }`);
      }

      // Log resume source usage
      if (resumeSourceUsed) {
        await logStep(supabase, jobId, stepCount, currentDoc, "resume_source_used",
          `Using pinned source: doc=${doc.id} ver=${latestVersion?.id}`,
          {}, undefined, { documentId: doc.id, versionId: latestVersion?.id, follow_latest: false }
        );
      }

      // ── Criteria classification: separate STALE_PROVENANCE from FAILS_CRITERIA_DURATION ──
      const reviewTextForDuration = latestVersion?.plaintext || doc?.extracted_text || doc?.plaintext || "";
      const measuredDuration = estimateDurationSeconds(reviewTextForDuration);
      const currentCriteriaHash = computeCriteriaHashEdge(latestCriteriaSnapshot);
      
      // Get version's criteria_hash — fetch from DB if not already in latestVersion
      let versionCriteriaHash: string | null = latestVersion?.criteria_hash || null;
      if (!versionCriteriaHash && latestVersion?.id) {
        const { data: verRow } = await supabase.from("project_document_versions")
          .select("criteria_hash")
          .eq("id", latestVersion.id)
          .maybeSingle();
        versionCriteriaHash = verRow?.criteria_hash || null;
      }
      
      const criteriaResult = classifyCriteriaEdge({
        versionCriteriaHash,
        currentCriteriaHash,
        measuredDurationSeconds: measuredDuration,
        targetMin: latestCriteriaSnapshot.episode_target_duration_min_seconds ?? null,
        targetMax: latestCriteriaSnapshot.episode_target_duration_max_seconds ?? null,
        targetScalar: latestCriteriaSnapshot.episode_target_duration_seconds ?? null,
        docType: currentDoc,
        format,
      });

      if (criteriaResult.classification === 'CRITERIA_STALE_PROVENANCE') {
        // If Auto-Decide is ON, rebase the latest version to current criteria hash and continue.
        // This prevents deadlocks after canon/criteria tweaks during long-running jobs.
        if (job.allow_defaults) {
          if (latestVersion?.id && currentCriteriaHash) {
            const { error: rebaseErr } = await supabase
              .from("project_document_versions")
              .update({ criteria_hash: currentCriteriaHash })
              .eq("id", latestVersion.id);
            if (rebaseErr) {
              console.warn(`[auto-run][IEL] criteria_stale_rebase_failed`, JSON.stringify({
                job_id: jobId,
                version_id: latestVersion.id,
                error: rebaseErr.message,
              }));
            } else {
              console.log(`[auto-run][IEL] criteria_stale_auto_rebased`, JSON.stringify({
                job_id: jobId,
                doc_type: currentDoc,
                version_id: latestVersion.id,
                criteria_hash: currentCriteriaHash,
              }));
            }
          }
        } else {
          // True provenance mismatch — criteria changed mid-run and requires explicit user action
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "criteria_stale_provenance",
            `Criteria provenance mismatch: ${criteriaResult.detail}`,
            { risk_flags: ["criteria_stale_provenance"] },
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount + 1,
            status: "paused",
            pause_reason: "CRITERIA_STALE_PROVENANCE",
            stop_reason: `Criteria changed since last analysis: ${criteriaResult.detail}. Regenerate or approve continuing.`,
            last_risk_flags: [...(job.last_risk_flags || []), "criteria_stale_provenance"],
            last_ui_message: `⚠ Criteria provenance mismatch detected`,
          });
          return respondWithJob(supabase, jobId, "rebase-required");
        }
      }
      
      if (criteriaResult.classification === 'CRITERIA_FAIL_DURATION') {
        // ── Safety brake: never run duration repair on non-runtime doc types ──
        if (!isDurationEligibleDocType(currentDoc, format)) {
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "duration_scope_skipped",
            `Skipped duration criteria/repair for non-runtime doc type: ${currentDoc} (format=${format})`,
            { output_ref: { currentDoc, format, measuredDurationSeconds: measuredDuration, targetMin: latestCriteriaSnapshot.episode_target_duration_min_seconds, targetMax: latestCriteriaSnapshot.episode_target_duration_max_seconds, reason: "NON_DURATION_DOC_TYPE" } },
          );
          await updateJob(supabase, jobId, { step_count: stepCount + 1 });
          // Continue to normal analysis flow — no duration repair
        } else {
        // Duration doesn't meet target — attempt bounded repair (max 2)
        const durationRepairAttempts = (job as any).duration_repair_attempts || 0;
        
        if (durationRepairAttempts >= 2) {
          // Already tried 2 repairs — pause with clear explanation
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "criteria_fail_duration_exhausted",
            `Duration repair exhausted after ${durationRepairAttempts} attempts. ${criteriaResult.detail}`,
            { risk_flags: ["criteria_fail_duration"] },
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount + 1,
            status: "paused",
            pause_reason: "CRITERIA_FAIL_DURATION",
            stop_reason: `Duration target not met after ${durationRepairAttempts} repair attempts. ${criteriaResult.detail}`,
            last_risk_flags: [...(job.last_risk_flags || []), "criteria_fail_duration"],
            last_ui_message: `⚠ Duration ${measuredDuration}s does not meet target — repair attempts exhausted`,
          });
          return respondWithJob(supabase, jobId, "criteria-fail-duration");
        }
        
        // Attempt duration repair rewrite
        const targetMin = latestCriteriaSnapshot.episode_target_duration_min_seconds ?? latestCriteriaSnapshot.episode_target_duration_seconds ?? 0;
        const targetMax = latestCriteriaSnapshot.episode_target_duration_max_seconds ?? latestCriteriaSnapshot.episode_target_duration_seconds ?? 0;
        const targetMid = Math.round((targetMin + targetMax) / 2);
        const targetWordCount = Math.round(targetMid * DURATION_ACTION_WPS); // approximate words needed
        
        // Determine source label for logging
        const durSourceLabel = (() => {
          try {
            const snap = latestCriteriaSnapshot as any;
            return snap._duration_source ? `source=${snap._duration_source}${snap._duration_locked ? ', locked' : ''}` : '';
          } catch { return ''; }
        })();
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "duration_repair_attempt",
          `Duration repair #${durationRepairAttempts + 1}: measured=${measuredDuration}s target=${targetMin}-${targetMax}s delta=${measuredDuration - targetMid}s${durSourceLabel ? ` (${durSourceLabel})` : ''}`,
          { risk_flags: ["criteria_fail_duration", "duration_repair"] },
        );
        
        // Update repair count — continue to rewrite with duration guidance
        await updateJob(supabase, jobId, {
          step_count: stepCount + 1,
          last_ui_message: `Duration repair #${durationRepairAttempts + 1}: ${measuredDuration}s → target ${targetMin}-${targetMax}s`,
        });
        // Store repair count in job metadata (using approval_payload as scratch)
        await supabase.from("auto_run_jobs").update({
          approval_payload: { ...(job.approval_payload || {}), duration_repair_attempts: durationRepairAttempts + 1, duration_target: { min: targetMin, max: targetMax, measured: measuredDuration } },
        }).eq("id", jobId);
        // Fall through to normal analysis+rewrite flow — the rewrite will include duration guidance
        }
      }

      // Store measured metrics on the version for future reference (always, even if duration=0)
      if (latestVersion?.id) {
        await supabase.from("project_document_versions").update({
          criteria_hash: currentCriteriaHash,
          criteria_json: latestCriteriaSnapshot,
          measured_metrics_json: { measured_duration_seconds: measuredDuration, estimated_at: new Date().toISOString(), estimator: 'edge_deterministic' },
        }).eq("id", latestVersion.id);
      }

      // Resolve the actual text being fed into analysis (version plaintext > doc extracted_text > doc plaintext)
      let reviewText = latestVersion?.plaintext || doc?.extracted_text || doc?.plaintext || "";
      let reviewCharCount = reviewText.length;

      // ── C0) Background generation guard: if current version status='generating', yield and wait ──
      // A 'generating' version was created by a background task (e.g. episode_beats for 30+ episodes).
      // Do NOT attempt auto-regen or analysis — just yield and let the background task finish.
      if (reviewCharCount === 0 && latestVersion?.id) {
        const { data: versionStatusRow } = await supabase.from("project_document_versions")
          .select("meta_json")
          .eq("id", latestVersion.id)
          .maybeSingle();
        if ((versionStatusRow?.meta_json as any)?.bg_generating === true) {
          const newStep = stepCount + 1;
          await logStep(supabase, jobId, newStep, currentDoc, "generate",
            `Background generation in progress for ${currentDoc} — yielding until complete`,
            {}, undefined, { versionId: latestVersion.id, status: "generating" }
          );
          await updateJob(supabase, jobId, { step_count: newStep, stage_loop_count: (job.stage_loop_count || 0) });
          return respondWithJob(supabase, jobId);
        }
      }

      // ── C) AUTO-REGEN if current doc is stub or empty ──
      const docIsStub = reviewCharCount === 0 || !isDownstreamDocSufficient(currentDoc, reviewText);
      if (docIsStub) {
        console.log(`[auto-run] current doc ${currentDoc} is stub/insufficient (${reviewCharCount} chars) — attempting auto-regen`);

        const stageInsufficients = [
          `${currentDoc}(${reviewCharCount === 0 ? "missing_current_version" : "stub_or_too_short"})`,
        ];

        const regenAttempt = await attemptAutoRegenInputs(
          supabase,
          supabaseUrl,
          token,
          jobId,
          stepCount + 1,
          currentDoc,
          job.project_id,
          stageInsufficients,
          "stub_at_current_stage",
        );

        if (!regenAttempt.ok) {
          console.warn("[auto-run] auto-regen for current stub doc failed", { jobId, currentDoc, error: regenAttempt.error });
        }

        // Re-fetch the doc's current version after regen
        const { data: regenVers } = await supabase.from("project_document_versions")
          .select("id, plaintext, version_number")
          .eq("document_id", doc.id)
          .eq("is_current", true)
          .limit(1);
        if (regenVers?.[0]) {
          latestVersion = regenVers[0];
          reviewText = latestVersion.plaintext || "";
          reviewCharCount = reviewText.length;
        }
      }

      // If still empty after regen attempt, fail
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
      // ── Background execution pattern to avoid edge function timeout ──
      const _t0 = Date.now();
      const bgTask = (async () => {
       try {
        console.log("[auto-run] dev-engine analyze (bg) START", { jobId, currentDoc, docId: doc.id });
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
        console.log("[auto-run] dev-engine analyze (bg) DONE", { jobId });

        // ── Guard: dev-engine-v2 returned structured failure ──
        if (!rawAnalyzeResult || rawAnalyzeResult.success === false) {
          const errMsg = (rawAnalyzeResult?.error ? String(rawAnalyzeResult.error) : "DEV_ENGINE_RETURNED_FAILURE").slice(0, 300);
          const where = rawAnalyzeResult?.where ? String(rawAnalyzeResult.where) : "dev-engine-v2/analyze";
          const attempt = rawAnalyzeResult?.attempt ? String(rawAnalyzeResult.attempt) : "1";
          const snippet = (rawAnalyzeResult?.snippet || "").slice(0, 200);
          const hint = rawAnalyzeResult?.hint ? String(rawAnalyzeResult.hint) : "";
          const fullErr = `${errMsg} | where=${where} | attempt=${attempt}${hint ? " | hint=" + hint : ""}${snippet ? " | " + snippet : ""}`;
          console.error("[auto-run] dev-engine analyze returned failure", { jobId, errMsg, where });
          await updateJob(supabase, jobId, {
            status: "failed",
            stop_reason: "DEV_ENGINE_FAILED",
            error: fullErr.slice(0, 500),
          });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop",
            `DEV_ENGINE_FAILED: ${fullErr}`.slice(0, 500)
          );
          return; // exit bgTask — do not proceed to notes/rewrite/promote
        }

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

        const newStep = await nextStepIndex(supabase, jobId);
        const analyzeShapeKeys = Object.keys(analyzeResult || {});

        // Store step_resolver_hash for hash-based invalidation
        // newStep is already from nextStepIndex (atomic)
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
        const promo = computePromotion(ci, gp, gap, trajectory, currentDoc, blockersCount, highImpactCount, stageLoopCount + 1, job.allow_defaults !== false, resolveTargetCI(job));

        await logStep(supabase, jobId, null, currentDoc, "promotion_check",
          `${promo.recommendation} (readiness: ${promo.readiness_score}, flags: ${promo.risk_flags.join(",") || "none"})`,
          { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags }
        );

        // Persist analysis scores to the version's meta_json so best-version sync can find them
        try {
          await persistVersionScores(supabase, {
            versionId: latestVersion.id,
            ci, gp,
            source: `auto-run-analyze-${currentDoc}`,
            jobId,
            protectHigher: true,
            docType: currentDoc,
          });
          console.log(`[auto-run][IEL] analyze_scores_persisted { job_id: "${jobId}", version_id: "${latestVersion.id}", ci: ${ci}, gp: ${gp}, doc_type: "${currentDoc}" }`);
        } catch (persistErr: any) {
          console.error(`[auto-run] analyze_score_persist_failed { version_id: "${latestVersion.id}", error: "${persistErr?.message}" }`);
        }

        // Update job scores + last_analyzed_version_id + blocker tracking
        await updateJob(supabase, jobId, {
          last_ci: ci, last_gp: gp, last_gap: gap, last_blocker_count: blockersCount,
          last_readiness: promo.readiness_score, last_confidence: promo.confidence,
          last_risk_flags: promo.risk_flags,
          last_analyzed_version_id: latestVersion.id,
        });

        // ── HARD STOPS ──
        if (promo.risk_flags.includes("hard_gate:thrash")) {
          await updateJob(supabase, jobId, { status: "stopped", stop_reason: "Thrash detected — run Executive Strategy Loop" });
          await logStep(supabase, jobId, null, currentDoc, "stop", "Thrash detected");
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
              }, token, job.project_id, format, currentDoc, jobId, newStep
            );

            const optionsData = optionsResult?.result?.options || optionsResult?.result || {};

            const normalizedDecisions = normalizePendingDecisions(optionsData.decisions || [], escalateReason, jobId, newStep);

            await logStep(supabase, jobId, null, currentDoc, "escalate_options_generated",
              `${escalateReason}. Generated ${normalizedDecisions.length} decision sets.`,
              { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags },
            );

            const finalEscDecisions = normalizedDecisions.length > 0 ? normalizedDecisions : createFallbackDecisions(currentDoc, ci, gp, escalateReason);
            const autoSelections = tryAutoAcceptDecisions(finalEscDecisions, job.allow_defaults !== false);
            if (autoSelections) {
              await logStep(supabase, jobId, null, currentDoc, "auto_decided",
                `Auto-accepted ${Object.keys(autoSelections).length} escalation decisions`,
                { ci, gp, gap }, undefined, { selections: autoSelections }
              );
              // Fall through — don't pause
            } else {
              optionsGeneratedThisStep = true;
              await updateJob(supabase, jobId, {
                status: "paused",
                stop_reason: `Decisions required: ${escalateReason}`,
                pending_decisions: finalEscDecisions,
                awaiting_approval: false,
                approval_type: null,
                pending_doc_id: doc.id,
                pending_version_id: latestVersion.id,
              });
              return respondWithJob(supabase, jobId, "decisions-required");
            }
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

            const autoSelections = tryAutoAcceptDecisions(escalateDecisions, job.allow_defaults !== false);
            if (autoSelections) {
              await logStep(supabase, jobId, null, currentDoc, "auto_decided",
                `Auto-accepted escalation decisions (allow_defaults)`,
                { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence },
                undefined, { selections: autoSelections }
              );
              // Fall through — don't pause
            } else {
              await logStep(supabase, jobId, null, currentDoc, "pause_for_approval",
                `${escalateReason} — options generation failed, awaiting user decision`,
                { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags },
              );
              await updateJob(supabase, jobId, {
                status: "paused",
                stop_reason: `Approval required: ${escalateReason}`,
                pending_decisions: escalateDecisions,
                pending_doc_id: doc.id,
                pending_version_id: latestVersion.id,
              });
              return respondWithJob(supabase, jobId, "approve-decision");
            }
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

              const stabiliseDecisions = normalizePendingDecisions(optionsData.decisions || [], "Stabilise: blockers/high-impact", jobId, newStep + 2);

              await logStep(supabase, jobId, null, currentDoc, "options_generated",
                `Generated ${stabiliseDecisions.length} decision sets for ${blockersCount} blockers + ${highImpactCount} high-impact notes`,
                { ci, gp, gap, readiness: promo.readiness_score },
                undefined, { optionsRunId, decisions: stabiliseDecisions.length, global_directions: optionsData.global_directions?.length || 0, decision_objects: stabiliseDecisions }
              );

              const finalDecisions = stabiliseDecisions.length > 0 ? stabiliseDecisions : createFallbackDecisions(currentDoc, ci, gp, "Blockers/high-impact issues");
              const autoSelections = tryAutoAcceptDecisions(finalDecisions, job.allow_defaults !== false);
              if (autoSelections) {
                await logStep(supabase, jobId, null, currentDoc, "auto_decided",
                  `Auto-accepted ${Object.keys(autoSelections).length} stabilise decisions`,
                  { ci, gp, gap }, undefined, { selections: autoSelections, decision_objects: finalDecisions }
                );
                // ── IEL: EARLY CONVERGENCE PROMOTION after auto-decided stabilise bundle ──
                // If scores already meet promotion thresholds, skip unnecessary rewrite and promote directly.
                // This is the "executor completion" path: the system has already identified and auto-applied
                // the correct fixes; scores confirm readiness; no need for another rewrite cycle.
                // Uses stage best CI (not current review CI) to prevent regression blocking.
                const earlyTargetCi = resolveTargetCI(job);
                const earlyStageBest = await getStageBestFromSteps(supabase, jobId, currentDoc, job.project_id);
                const earlyBestCi = earlyStageBest?.ci ?? ci;
                if (earlyBestCi >= earlyTargetCi && blockersCount === 0 && job.allow_defaults !== false) {
                  const earlyNext = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
                  if (earlyNext && isStageAtOrBeforeTarget(earlyNext, job.target_document, format)) {
                    try {
                      await supabase.from("project_document_versions").update({
                        approval_status: "approved",
                        approved_at: new Date().toISOString(),
                        approved_by: job.user_id,
                      }).eq("id", latestVersion.id);
                    } catch (e: any) {
                      console.warn("[auto-run] non-fatal early-converge auto-approve failed:", e?.message || e);
                    }
                    await logStep(supabase, jobId, null, currentDoc, "auto_approved_promote",
                      `Early convergence after auto-decided stabilise: best_CI=${earlyBestCi}≥${earlyTargetCi}, blockers=0. Auto-promoting ${currentDoc} → ${earlyNext} (allow_defaults).`,
                      { ci, gp, gap }, undefined,
                      { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: earlyNext, trigger: "early_convergence_after_auto_decided" }
                    );
                    await updateJob(supabase, jobId, {
                      stage_loop_count: 0, current_document: earlyNext,
                      stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
                      status: "running", stop_reason: null,
                      awaiting_approval: false, approval_type: null,
                      pending_doc_id: null, pending_version_id: null,
                      pending_doc_type: null, pending_next_doc_type: null,
                      pending_decisions: null,
                      frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
                    });
                    console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${earlyNext}", best_preserved: true, trigger: "early_convergence_after_auto_decided" }`);
                    return respondWithJob(supabase, jobId, "run-next");
                  }
                }
                // Don't pause — fall through to rewrite
              } else {
                optionsGeneratedThisStep = true;
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  status: "paused",
                  stop_reason: "Decisions required",
                  pending_decisions: finalDecisions,
                  awaiting_approval: false,
                  approval_type: null,
                  pending_doc_id: doc.id,
                  pending_version_id: latestVersion.id,
                });
                return respondWithJob(supabase, jobId, "decisions-required");
              }
            } catch (optErr: any) {
              // If options generation fails, fall through to regular rewrite
              console.error("Options generation failed, falling back to rewrite:", optErr.message);
              await logStep(supabase, jobId, null, currentDoc, "options_failed",
                `Options generation failed: ${optErr.message}. Falling back to rewrite.`);
            }
          }

          // ── DECISION-PRIORITY GUARD: skip max-loops approval if decisions were just set ──
          const jobAfterOptions = await getJob(supabase, jobId);
          const hasActiveDecisions = Array.isArray(jobAfterOptions?.pending_decisions) && (jobAfterOptions.pending_decisions as any[]).length > 0;

          // ── SOFT MAX-LOOPS: if past max loops, check convergence ──
          if (!optionsGeneratedThisStep && !hasActiveDecisions && newLoopCount >= job.max_stage_loops) {
            // Parse convergence targets
            const convergeTarget = (typeof job.converge_target_json === 'object' && job.converge_target_json) 
              ? job.converge_target_json as { ci: number; gp: number }
              : { ci: GLOBAL_MIN_CI, gp: 100 };
            const convergedEnough = (ci >= convergeTarget.ci) && (gp >= convergeTarget.gp);

            if (!convergedEnough) {
              // Step budget is the only limit — if steps remain, keep going
              if (job.step_count < job.max_total_steps) {
                await updateJob(supabase, jobId, { stage_loop_count: newLoopCount });
                await logStep(supabase, jobId, null, currentDoc, "soft_max_loops_continue",
                  `Soft limit exceeded; continuing until CI>=${convergeTarget.ci} and GP>=${convergeTarget.gp} or step budget exhausted (CI=${ci}, GP=${gp})`
                );
                // Fall through to rewrite below
              }
              // If step budget exhausted, the step-limit guard at the top of run-next will catch it
            } else {
              // Converged enough — apply CI hard gate before promotion (uses job target_ci)
              const promoteTargetCi = resolveTargetCI(job);
              const ciGate = await evaluateCIGate(supabase, jobId, currentDoc, promoteTargetCi, job.project_id, job);
              const docOverride = DOC_TYPE_GATE_OVERRIDES[currentDoc];
              console.log(`[auto-run][IEL] ci_gate_eval { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciGate.ci}, gp: ${ciGate.gp}, min_ci: ${docOverride ? docOverride.ci : promoteTargetCi}, min_gp: ${docOverride ? docOverride.gp : 0}, override: ${!!docOverride}, rule: "converge_promote_gate" }`);
              if (!ciGate.pass) {
                // Gate failed — CI below target (or GP below target for overridden doc types)
                const blockReason = ciGate.failReason || `CI=${ciGate.ci} < ${promoteTargetCi}`;
                console.warn(`[auto-run][IEL] ci_gate_blocked_promote { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciGate.ci}, gp: ${ciGate.gp}, reason: "${blockReason}", trigger: "converge_promote" }`);
                // ── TRANSITION LEDGER: promotion_gate_evaluated (blocked) ──
                await emitTransition(supabase, {
                  projectId: job.project_id, eventType: TRANSITION_EVENTS.PROMOTION_GATE_EVALUATED,
                  docType: currentDoc, stage: currentDoc, jobId, resultingVersionId: latestVersion?.id,
                  status: "failed", trigger: "ci_hard_gate", sourceOfTruth: "auto-run",
                  ci: ciGate.ci, previousState: { min_ci: docOverride ? docOverride.ci : promoteTargetCi, min_gp: docOverride?.gp ?? 0 },
                  resultingState: { pass: false, reason: docOverride ? "doc_type_gate_failed" : "ci_below_threshold", detail: blockReason },
                });
                await logStep(supabase, jobId, null, currentDoc, "ci_gate_blocked",
                  `Promotion blocked: ${blockReason}. Continuing stabilise.`,
                  { ci: ciGate.ci, gp: ciGate.gp }, undefined, { min_ci: docOverride ? docOverride.ci : promoteTargetCi, min_gp: docOverride?.gp ?? 0, trigger: "converge_promote", doc_type_override: !!docOverride });
                await updateJob(supabase, jobId, { stage_loop_count: newLoopCount });
                // Fall through to rewrite below
              }
              // ── PILLAR 1: CI BLOCKER GATE V1 — block promotion if unresolved blockers/high-impact ──
              else if (isCIBlockerGateEnabled()) {
                const reviewPayload = await parseLatestReviewForActiveVersion(supabase, jobId, currentDoc, latestVersion?.id || null);
                const blockerGate = evaluateCIBlockerGateFromPayload(reviewPayload, promoteTargetCi);
                console.log(`[auto-run][IEL] ci_blocker_gate_eval { job_id: "${jobId}", doc_type: "${currentDoc}", pass: ${blockerGate.pass}, ci: ${blockerGate.ci}, blockers: ${blockerGate.blockerCount}, high_impact: ${blockerGate.highImpactCount}, reasons: ${JSON.stringify(blockerGate.blockReasons)} }`);
                // ── TRANSITION LEDGER: promotion_gate_evaluated (blocker gate) ──
                await emitTransition(supabase, {
                  projectId: job.project_id, eventType: TRANSITION_EVENTS.PROMOTION_GATE_EVALUATED,
                  docType: currentDoc, stage: currentDoc, jobId, resultingVersionId: latestVersion?.id,
                  status: blockerGate.pass ? "completed" : "failed",
                  trigger: "ci_blocker_gate", sourceOfTruth: "auto-run",
                  ci: blockerGate.ci, gp: blockerGate.gp,
                  previousState: { blockerCount: blockerGate.blockerCount, highImpactCount: blockerGate.highImpactCount },
                  resultingState: { pass: blockerGate.pass, blockReasons: blockerGate.blockReasons },
                });
                if (!blockerGate.pass) {
                  console.warn(`[auto-run][IEL] ci_blocker_gate_blocked { job_id: "${jobId}", doc_type: "${currentDoc}", reasons: ${JSON.stringify(blockerGate.blockReasons)} }`);
                  await logStep(supabase, jobId, null, currentDoc, "ci_blocker_gate_blocked",
                    `Promotion blocked by CI Blocker Gate: ${blockerGate.blockReasons.join(", ")}. Continuing stabilise.`,
                    { ci: blockerGate.ci, gp: blockerGate.gp }, undefined,
                    { blockerCount: blockerGate.blockerCount, highImpactCount: blockerGate.highImpactCount, blockReasons: blockerGate.blockReasons });
                  await updateJob(supabase, jobId, { stage_loop_count: newLoopCount });
                  // Fall through to rewrite below
                } else {
                  console.log(`[auto-run][IEL] ci_blocker_gate_passed { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${blockerGate.ci} }`);
                  // ── IEL: ACTIONABLE NOTE EXHAUSTION GATE — block promotion if notes remain ──
                  const noteExhaust = await checkActionableNoteExhaustion(supabase, job.project_id, currentDoc, latestVersion?.id || null);
                  if (noteExhaust.hasActionable) {
                    console.warn(`[auto-run][IEL] note_exhaustion_blocked_promote { job_id: "${jobId}", doc_type: "${currentDoc}", actionable_notes: ${noteExhaust.count} }`);
                    await logStep(supabase, jobId, null, currentDoc, "note_exhaustion_blocked",
                      `Promotion blocked: ${noteExhaust.count} actionable note(s) remain for ${currentDoc}. Continuing stabilise to apply/resolve notes.`,
                      { ci: blockerGate.ci, gp: blockerGate.gp }, undefined,
                      { actionable_count: noteExhaust.count, trigger: "blocker_gate_promote" });
                    await updateJob(supabase, jobId, { stage_loop_count: newLoopCount });
                    // Fall through to rewrite below
                  } else {
                  // Proceed to promotion
                  const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
                  if (next && isStageAtOrBeforeTarget(next, job.target_document, format)) {
                    if (job.allow_defaults) {
                      try {
                        await supabase.from("project_document_versions").update({
                          approval_status: "approved",
                          approved_at: new Date().toISOString(),
                          approved_by: job.user_id,
                        }).eq("id", latestVersion.id);
                      } catch (e: any) {
                        console.warn("[auto-run] non-fatal auto-approve failed before promote:", e?.message || e);
                      }
                      await logStep(supabase, jobId, null, currentDoc, "auto_approved_promote",
                        `Converged (CI=${ci}, GP=${gp}). Auto-promoting ${currentDoc} → ${next} (allow_defaults, blocker_gate_passed)`,
                        {}, undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
                      );
                      await updateJob(supabase, jobId, {
                        stage_loop_count: 0, current_document: next,
                        stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
                        status: "running", stop_reason: null,
                        awaiting_approval: false, approval_type: null,
                        pending_doc_id: null, pending_version_id: null,
                        pending_doc_type: null, pending_next_doc_type: null,
                        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
                      });
                      console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${next}", best_preserved: true, trigger: "blocker_gate_promote" }`);
                      return respondWithJob(supabase, jobId, "run-next");
                    }
                    await logStep(supabase, jobId, null, currentDoc, "approval_required",
                      `Converged (CI=${ci}, GP=${gp}). Review ${currentDoc} before promoting to ${next}`,
                      {}, undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
                    );
                    await updateJob(supabase, jobId, {
                      stage_loop_count: newLoopCount,
                      status: "paused", stop_reason: `Converged — review ${currentDoc} before promoting to ${next}`,
                      awaiting_approval: true, approval_type: "promote",
                      pending_doc_id: doc.id, pending_version_id: latestVersion.id,
                      pending_doc_type: currentDoc, pending_next_doc_type: next,
                    });
                    return respondWithJob(supabase, jobId, "awaiting-approval");
                  }
                  } // close note exhaustion else
                }
              } else {
              // Flag off — original promotion path
              console.log(`[auto-run][IEL] ci_gate_passed { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciGate.ci} }`);
              // ── IEL: ACTIONABLE NOTE EXHAUSTION GATE (flag-off path) ──
              const noteExhaustOrig = await checkActionableNoteExhaustion(supabase, job.project_id, currentDoc, latestVersion?.id || null);
              if (noteExhaustOrig.hasActionable) {
                console.warn(`[auto-run][IEL] note_exhaustion_blocked_promote { job_id: "${jobId}", doc_type: "${currentDoc}", actionable_notes: ${noteExhaustOrig.count}, path: "flag_off" }`);
                await logStep(supabase, jobId, null, currentDoc, "note_exhaustion_blocked",
                  `Promotion blocked: ${noteExhaustOrig.count} actionable note(s) remain for ${currentDoc}. Continuing stabilise.`,
                  { ci: ciGate.ci }, undefined,
                  { actionable_count: noteExhaustOrig.count, trigger: "converge_promote_flag_off" });
                await updateJob(supabase, jobId, { stage_loop_count: newLoopCount });
                // Fall through to rewrite below
              } else {
              const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
              if (next && isStageAtOrBeforeTarget(next, job.target_document, format)) {
                if (job.allow_defaults) {
                  // Full Autopilot: auto-approve and promote without pausing
                  try {
                    await supabase.from("project_document_versions").update({
                      approval_status: "approved",
                      approved_at: new Date().toISOString(),
                      approved_by: job.user_id,
                    }).eq("id", latestVersion.id);
                  } catch (e: any) {
                    console.warn("[auto-run] non-fatal auto-approve failed before promote:", e?.message || e);
                  }
                  await logStep(supabase, jobId, null, currentDoc, "auto_approved_promote",
                    `Converged (CI=${ci}, GP=${gp}). Auto-promoting ${currentDoc} → ${next} (allow_defaults)`,
                    {}, undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
                  );
                  await updateJob(supabase, jobId, {
                    stage_loop_count: 0,
                    current_document: next,
                    stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
                    status: "running",
                    stop_reason: null,
                    awaiting_approval: false,
                    approval_type: null,
                    pending_doc_id: null,
                    pending_version_id: null,
                    pending_doc_type: null,
                    pending_next_doc_type: null,
                    // Clear frontier on stage change (best_* is global, preserved)
                    frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
                  });
                  console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${next}", best_preserved: true, trigger: "auto_approved_promote_prep" }`);
                  return respondWithJob(supabase, jobId, "run-next");
                }
                await logStep(supabase, jobId, null, currentDoc, "approval_required",
                  `Converged (CI=${ci}, GP=${gp}). Review ${currentDoc} before promoting to ${next}`,
                  {}, undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
                );
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  status: "paused", stop_reason: `Converged — review ${currentDoc} before promoting to ${next}`,
                  awaiting_approval: true, approval_type: "promote",
                  pending_doc_id: doc.id, pending_version_id: latestVersion.id,
                  pending_doc_type: currentDoc, pending_next_doc_type: next,
                });
                return respondWithJob(supabase, jobId, "awaiting-approval");
              }
              } // close note exhaustion else (flag-off path)
              } // close else (flag off — original promotion)
            } // close else (convergedEnough)
          } // close if (newLoopCount >= max_stage_loops)

          // ── DOC POLICY GUARD: fail closed on unknown doc types ──
          try {
            requireDocPolicy(currentDoc);
          } catch (regErr: any) {
            await logStep(supabase, jobId, null, currentDoc, "doc_type_unregistered",
              `Doc type "${currentDoc}" is not in the policy registry. Halting.`,
              { ci, gp, gap });
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              status: "paused",
              pause_reason: "DOC_TYPE_UNREGISTERED",
              stop_reason: `Unregistered doc type: ${currentDoc}. Cannot proceed with rewrite.`,
            });
            return respondWithJob(supabase, jobId);
          }

          // ── AGGREGATE GUARD: skip LLM rewrites, compile-only with caching ──
          if (isAggregate(currentDoc)) {
            // Compute source version key — current versions of all UNIT docs in this project
            const { data: unitDocs } = await supabase.from("project_documents")
              .select("id, doc_type")
              .eq("project_id", job.project_id)
              .in("doc_type", ["episode_outline", "episode_script"]);
            const unitDocIds = (unitDocs || []).map((d: any) => d.id);
            let sourceVersionKey = "[]";
            if (unitDocIds.length > 0) {
              const { data: unitVersions } = await supabase.from("project_document_versions")
                .select("id, document_id")
                .in("document_id", unitDocIds)
                .eq("is_current", true)
                .order("document_id");
              const sortedIds = (unitVersions || []).map((v: any) => v.id).sort();
              sourceVersionKey = JSON.stringify(sortedIds);
            }

            // Check if current aggregate version was compiled with this same source key
            const aggCurrentVer = await getCurrentVersionForDoc(supabase, doc.id);
            const aggMeta = aggCurrentVer ? (aggCurrentVer as any).meta_json : null;
            const cachedKey = aggMeta?.source_version_key;

            if (cachedKey === sourceVersionKey && aggCurrentVer) {
              await logStep(supabase, jobId, null, currentDoc, "aggregate_compile_skipped",
                `Aggregate "${currentDoc}" already compiled with current source versions. Skipping.`,
                { ci, gp, gap }, undefined, { sourceVersionKey });
            } else {
              await logStep(supabase, jobId, null, currentDoc, "aggregate_skip_advance",
                `Doc type "${currentDoc}" is AGGREGATE (compile-only). Skipping LLM rewrite, advancing to next stage.`,
                { ci, gp, gap });
            }

            const nextAfterAggregate = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
            if (nextAfterAggregate && isStageAtOrBeforeTarget(nextAfterAggregate, job.target_document, format)) {
              // ── PREREQ GATE: check before advancing into nextAfterAggregate ──
              const gateBlocked = await enforcePrereqGateBeforeAdvance(supabase, jobId, nextAfterAggregate, format, job, stepCount, currentDoc, "aggregate_skip_writing");
              if (gateBlocked) {
                await releaseProcessingLock(supabase, jobId);
                return respondWithJob(supabase, jobId, "run-next");
              }
              await updateJob(supabase, jobId, {
                current_document: nextAfterAggregate,
                stage_loop_count: 0,
                // Clear frontier on stage change (best_* is global, preserved)
                frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
              });
              console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${nextAfterAggregate}", best_preserved: true, trigger: "aggregate_skip_writing" }`);
              return respondWithJob(supabase, jobId, "run-next");
            } else {
              await updateJob(supabase, jobId, { status: "completed", stop_reason: "All stages satisfied up to target (aggregate skip)" });
              await logStep(supabase, jobId, null, currentDoc, "stop", "All stages satisfied up to target after aggregate skip");
              return respondWithJob(supabase, jobId);
            }
          }

          // ── IEL: UPSTREAM NOTE DEBT GATE (UNIFIED — reads all 3 note systems) ──
          {
            const { getUnifiedUpstreamNoteBlockers } = await import("../_shared/unifiedNoteControl.ts");
            const upstreamBlockers = await getUnifiedUpstreamNoteBlockers(supabase, job.project_id, currentDoc);
            if (upstreamBlockers.length > 0) {
              const sourceDocs = [...new Set(upstreamBlockers.map((n: any) => n.source_doc_type).filter(Boolean))];
              const byTable = {
                deferred: upstreamBlockers.filter((b: any) => b.source_table === "project_deferred_notes").length,
                notes: upstreamBlockers.filter((b: any) => b.source_table === "project_notes").length,
                dev_state: upstreamBlockers.filter((b: any) => b.source_table === "project_dev_note_state").length,
              };

              // When allow_defaults is ON (Full Autonomous), auto-resolve upstream note debt instead of pausing
              if (job.allow_defaults) {
                // Auto-resolve project_notes upstream blockers
                const noteBlockerIds = upstreamBlockers
                  .filter((b: any) => b.source_table === "project_notes")
                  .map((b: any) => b.id);
                if (noteBlockerIds.length > 0) {
                  await supabase.from("project_notes")
                    .update({ status: "resolved", updated_by: "auto_run_upstream_debt", updated_at: new Date().toISOString() })
                    .in("id", noteBlockerIds);
                }
                // Auto-resolve deferred note blockers
                const deferredBlockerIds = upstreamBlockers
                  .filter((b: any) => b.source_table === "project_deferred_notes")
                  .map((b: any) => b.id);
                if (deferredBlockerIds.length > 0) {
                  await supabase.from("project_deferred_notes")
                    .update({ status: "resolved" })
                    .in("id", deferredBlockerIds);
                }
                // Auto-resolve dev note state blockers
                const devNoteBlockerIds = upstreamBlockers
                  .filter((b: any) => b.source_table === "project_dev_note_state")
                  .map((b: any) => b.id);
                if (devNoteBlockerIds.length > 0) {
                  await supabase.from("project_dev_note_state")
                    .update({ status: "resolved" })
                    .in("id", devNoteBlockerIds);
                }

                console.log(`[auto-run][IEL] upstream_note_debt_auto_resolved { job_id: "${jobId}", doc_type: "${currentDoc}", total: ${upstreamBlockers.length}, notes: ${noteBlockerIds.length}, deferred: ${deferredBlockerIds.length}, dev_state: ${devNoteBlockerIds.length} }`);
                await logStep(supabase, jobId, null, currentDoc, "note_auto_resolved",
                  `Auto-resolved ${upstreamBlockers.length} upstream note debt blocker(s) from [${sourceDocs.join(", ")}] (allow_defaults=true). Continuing rewrite. (notes=${noteBlockerIds.length}, deferred=${deferredBlockerIds.length}, dev_state=${devNoteBlockerIds.length})`,
                  { ci, gp, gap }, undefined,
                  { upstreamBlockerCount: upstreamBlockers.length, sourceDocs, byTable, resolver: "auto_run_upstream_debt", auto_resolved: true });
                // Fall through to rewrite — do NOT pause
              } else {
                console.warn(`[auto-run][IEL] upstream_note_debt_gate_unified { job_id: "${jobId}", doc_type: "${currentDoc}", total_blockers: ${upstreamBlockers.length}, by_table: ${JSON.stringify(byTable)}, source_docs: ${JSON.stringify(sourceDocs)} }`);
                await logStep(supabase, jobId, null, currentDoc, "upstream_note_debt_paused",
                  `${upstreamBlockers.length} unresolved upstream note(s) from [${sourceDocs.join(", ")}] target ${currentDoc}. Repair upstream docs first. (unified: deferred=${byTable.deferred}, notes=${byTable.notes}, dev_state=${byTable.dev_state})`,
                  { ci, gp, gap }, undefined,
                  { upstreamBlockerCount: upstreamBlockers.length, sourceDocs, byTable, noteKeys: upstreamBlockers.map((n: any) => n.note_key_or_fingerprint) });
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  status: "paused",
                  pause_reason: "UPSTREAM_NOTE_DEBT",
                  stop_reason: `${upstreamBlockers.length} unresolved upstream note(s) from [${sourceDocs.join(", ")}] block rewriting ${currentDoc}. Resolve upstream issues first.`,
                });
                return respondWithJob(supabase, jobId);
              }
            }
          }

          // No blockers or options already handled — apply rewrite with convergence policy
          const notesResult = await supabase.from("development_runs").select("output_json").eq("document_id", doc.id).eq("run_type", "NOTES").order("created_at", { ascending: false }).limit(1).maybeSingle();
          const notes = notesResult.data?.output_json;

          // ── IEL: Inject actionable project_notes into rewrite strategy ──
          // This ensures project_notes (which gate promotion) are actually addressed in rewrites
          let injectedProjectNotes: any[] = [];
          try {
            const { data: pnotes } = await supabase
              .from("project_notes")
              .select("id, title, summary, detail, severity, suggested_fixes, category")
              .eq("project_id", job.project_id)
              .eq("doc_type", currentDoc)
              .in("status", ["open", "in_progress", "reopened"])
              .limit(30);
            if (pnotes && pnotes.length > 0) {
              injectedProjectNotes = pnotes.map((n: any) => ({
                id: n.id,
                note: n.summary || n.title,
                severity: n.severity === "blocker" ? "blocker" : n.severity === "high" ? "high" : "med",
                category: n.category || "general",
                why_it_matters: n.detail || n.summary,
                suggested_fix: n.suggested_fixes ? (Array.isArray(n.suggested_fixes) ? n.suggested_fixes[0]?.description : n.suggested_fixes) : undefined,
              }));
              console.log(`[auto-run][IEL] project_notes_injected_into_rewrite { doc_type: "${currentDoc}", count: ${injectedProjectNotes.length}, severities: ${JSON.stringify(pnotes.map((n: any) => n.severity))} }`);
            }
          } catch (e: any) {
            console.warn(`[auto-run][IEL] project_notes_injection_failed: ${e?.message}`);
          }

          const allNotesForStrategy = {
            blocking_issues: [...(notes?.blocking_issues || analyzeResult?.blocking_issues || []), ...injectedProjectNotes.filter(n => n.severity === "blocker")],
            high_impact_notes: [...(notes?.high_impact_notes || analyzeResult?.high_impact_notes || []), ...injectedProjectNotes.filter(n => n.severity === "high")],
            polish_notes: [...(notes?.polish_notes || analyzeResult?.polish_notes || []), ...injectedProjectNotes.filter(n => n.severity !== "blocker" && n.severity !== "high")],
          };
          const protectItems = notes?.protect || analyzeResult?.protect || [];

          // ── 0) ATTEMPT LADDER: select strategy based on loop count ──
          const attemptNumber = newLoopCount; // 1-indexed
          const strategy = getAttemptStrategy(attemptNumber);

          // ── TARGET-LEVEL CAP ──
          if (attemptNumber > MAX_TOTAL_ATTEMPTS_PER_TARGET) {
            await logStep(supabase, jobId, null, currentDoc, "max_target_attempts_reached",
              `Exceeded max target attempts (${MAX_TOTAL_ATTEMPTS_PER_TARGET}). Halting.`,
              { ci, gp, gap }, undefined, { attemptNumber, strategy });
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              status: "paused",
              pause_reason: "MAX_TARGET_ATTEMPTS_REACHED",
              stop_reason: `Exceeded ${MAX_TOTAL_ATTEMPTS_PER_TARGET} attempts for ${currentDoc}. Manual review required.`,
            });
            return respondWithJob(supabase, jobId);
          }

          const { approvedNotes: strategyNotes, globalDirections: strategyDirections } = selectNotesForStrategy(strategy, allNotesForStrategy);

          await logStep(supabase, jobId, null, currentDoc, "convergence_strategy_selected",
            `Attempt ${attemptNumber}: strategy=${strategy}, notes=${strategyNotes.length}, directions=${strategyDirections.length}`,
            { ci, gp, gap }, undefined, { attemptNumber, strategy, noteCount: strategyNotes.length });

          // ── 1) BASELINE PINNING: ensure current accepted baseline exists (auto-repair/seed once) ──
          let currentAccepted = await getCurrentVersionForDoc(supabase, doc.id);
          if (!currentAccepted) {
            const { data: latestAnyVersion } = await supabase.from("project_document_versions")
              .select("id, version_number")
              .eq("document_id", doc.id)
              .order("version_number", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (latestAnyVersion?.id) {
              const { error: repairErr } = await supabase.rpc("set_current_version", {
                p_document_id: doc.id,
                p_new_version_id: latestAnyVersion.id,
              });
              if (!repairErr) {
                await logStep(supabase, jobId, null, currentDoc, "baseline_repaired",
                  `Repaired missing baseline by promoting latest version ${latestAnyVersion.id} as current.`,
                  { ci, gp, gap }, undefined, { documentId: doc.id, docType: currentDoc, chosenVersionId: latestAnyVersion.id });
                currentAccepted = await getCurrentVersionForDoc(supabase, doc.id);
              }
            }
          }

          if (!currentAccepted) {
            const seedText = (doc?.plaintext || doc?.extracted_text || "").trim();
            if (seedText.length > 0) {
              const { data: maxRow } = await supabase.from("project_document_versions")
                .select("version_number")
                .eq("document_id", doc.id)
                .order("version_number", { ascending: false })
                .limit(1)
                .maybeSingle();
              const nextVersion = (maxRow?.version_number || 0) + 1;

              const seededVersion = await createVersion(supabase, {
                documentId: doc.id,
                docType: currentDoc,
                plaintext: seedText,
                label: "baseline_seed",
                createdBy: job.user_id,
                approvalStatus: "draft",
                deliverableType: currentDoc,
                metaJson: { seed_source: "auto_run_baseline_seed", seeded_at: new Date().toISOString() },
                generatorId: "auto-run-seed",
                inputsUsed: { generator_id: "auto-run-seed", document_id: doc.id, doc_type: currentDoc, project_id: job.project_id, job_id: jobId },
              });

              if (seededVersion?.id) {
                await supabase.from("project_documents").update({ latest_version_id: seededVersion.id }).eq("id", doc.id);
                await logStep(supabase, jobId, null, currentDoc, "baseline_seeded",
                  `Seeded baseline from document plaintext and set version ${seededVersion.id} as current.`,
                  { ci, gp, gap }, undefined, { documentId: doc.id, docType: currentDoc, seededVersionId: seededVersion.id });
                currentAccepted = await getCurrentVersionForDoc(supabase, doc.id);
              }
            }
          }

          if (!currentAccepted) {
            const { count: versionCount } = await supabase.from("project_document_versions")
              .select("id", { count: "exact", head: true })
              .eq("document_id", doc.id);
            const hasSeedText = (doc?.plaintext || doc?.extracted_text || "").trim().length > 0;

            if (!hasSeedText && (!versionCount || versionCount === 0)) {
              await logStep(supabase, jobId, null, currentDoc, "baseline_missing_no_text",
                `No baseline exists and no plaintext source is available for ${currentDoc}.`,
                { ci, gp, gap }, undefined, { documentId: doc.id, docType: currentDoc, versionCount: versionCount ?? 0 });
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                status: "paused",
                pause_reason: "BASELINE_MISSING_NO_TEXT",
                stop_reason: `No baseline and no plaintext source for ${currentDoc}. Create content first, then resume.`,
                approval_payload: { documentId: doc.id, docType: currentDoc, versionCount: versionCount ?? 0 },
              });
              return respondWithJob(supabase, jobId);
            }

            await logStep(supabase, jobId, null, currentDoc, "baseline_missing",
              `No current accepted version found for document ${doc.id} (${versionCount ?? 0} versions exist).`,
              { ci, gp, gap }, undefined, { documentId: doc.id, docType: currentDoc, versionCount: versionCount ?? 0 });
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              status: "paused",
              pause_reason: "BASELINE_MISSING",
              stop_reason: `No current accepted version for ${currentDoc}. Cannot establish baseline.`,
              approval_payload: { documentId: doc.id, docType: currentDoc, versionCount: versionCount ?? 0 },
            });
            return respondWithJob(supabase, jobId);
          }
          const abvrResolved = await resolveActiveVersionForDoc(supabase, job, doc.id, { jobId, docType: currentDoc });
          if (!abvrResolved?.versionId) {
            await logStep(supabase, jobId, null, currentDoc, "baseline_resolution_failed",
              `ABVR could not resolve an active version for ${currentDoc}. Failing closed.`,
              {}, undefined, { documentId: doc.id, docType: currentDoc, reason: "abvr_no_version" });
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              status: "paused",
              pause_reason: "BASELINE_RESOLUTION_FAILED",
              stop_reason: `ABVR could not resolve active baseline for ${currentDoc}.`,
            });
            return respondWithJob(supabase, jobId);
          }

          let baselineVersionId = abvrResolved.versionId;
          const baselineSourceLabel = abvrResolved.source;

          if (job.follow_latest && currentAccepted?.id && baselineVersionId !== currentAccepted.id) {
            console.log(`[auto-run][IEL] abvr_baseline_divergence { job_id: "${jobId}", doc_type: "${currentDoc}", document_id: "${doc.id}", abvr_version_id: "${baselineVersionId}", abvr_reason: "${abvrResolved.reason}", current_version_id: "${currentAccepted.id}", note: "ABVR and is_current differ while follow_latest=true" }`);
          }

          console.log(`[auto-run][IEL] baseline_selected { job_id: "${jobId}", doc_type: "${currentDoc}", baseline_version_id: "${baselineVersionId}", baseline_source: "${baselineSourceLabel}", baseline_reason: "${abvrResolved.reason}" }`);

          // ── BASELINE SCORE RESOLUTION (DB-PERSISTED source-of-truth) ──
          let baselineCI: number;
          let baselineGP: number;
          {
            const jobLastAnalyzed2 = (job as any).last_analyzed_version_id;
            const jobLastCI2 = (job as any).last_ci;
            const jobLastGP2 = (job as any).last_gp;
            const canReuseFromJob = jobLastAnalyzed2 === baselineVersionId
              && typeof jobLastCI2 === "number" && typeof jobLastGP2 === "number";

            const persisted = await getVersionScoreSnapshot(supabase, baselineVersionId);

            if (persisted.ci !== null && persisted.gp !== null) {
              baselineCI = persisted.ci;
              baselineGP = persisted.gp;
              console.log(`[auto-run][IEL] baseline_score_branch { job_id: "${jobId}", doc_type: "${currentDoc}", action: "reuse", baseline_version_id: "${baselineVersionId}", last_analyzed_version_id: "${jobLastAnalyzed2 || 'null'}", source: "version_meta_json", score_source: "${persisted.scoreSource || 'unknown'}" }`);
              await logStep(supabase, jobId, null, currentDoc, "baseline_score_reused",
                `Reused DB-persisted scores for baseline ${baselineVersionId}: CI=${baselineCI} GP=${baselineGP}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { source: "version_meta_json", score_source: persisted.scoreSource, baselineVersionId, last_analyzed_version_id: jobLastAnalyzed2 });

              if (jobLastAnalyzed2 !== baselineVersionId || jobLastCI2 !== baselineCI || jobLastGP2 !== baselineGP) {
                await updateJob(supabase, jobId, {
                  last_analyzed_version_id: baselineVersionId,
                  last_ci: baselineCI,
                  last_gp: baselineGP,
                });
              }
            } else if (canReuseFromJob) {
              baselineCI = jobLastCI2;
              baselineGP = jobLastGP2;
              console.log(`[auto-run][IEL] baseline_score_branch { job_id: "${jobId}", doc_type: "${currentDoc}", action: "reuse", baseline_version_id: "${baselineVersionId}", last_analyzed_version_id: "${jobLastAnalyzed2}", source: "job_cache_backfill" }`);

              const persistedFromJob = await persistVersionScores(supabase, {
                versionId: baselineVersionId,
                ci: baselineCI,
                gp: baselineGP,
                source: "auto-run-job-cache-sync",
                jobId,
                protectHigher: false,
                docType: currentDoc,
              });
              baselineCI = persistedFromJob.ci;
              baselineGP = persistedFromJob.gp;

              await logStep(supabase, jobId, null, currentDoc, "baseline_score_reused",
                `Reused job cache and backfilled version scores for baseline ${baselineVersionId}: CI=${baselineCI} GP=${baselineGP}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { source: "job_cache_backfill", baselineVersionId, last_analyzed_version_id: jobLastAnalyzed2 });
            } else {
              await logStep(supabase, jobId, null, currentDoc, "baseline_score_rescored",
                `Re-scoring baseline ${baselineVersionId} (last_analyzed=${jobLastAnalyzed2 || 'null'}, mismatch=${jobLastAnalyzed2 !== baselineVersionId})`,
                {}, undefined,
                { baselineVersionId, last_analyzed_version_id: jobLastAnalyzed2, reason: jobLastAnalyzed2 !== baselineVersionId ? "version_mismatch" : "scores_missing" });
              console.log(`[auto-run][IEL] baseline_score_branch { job_id: "${jobId}", doc_type: "${currentDoc}", action: "analyze", baseline_version_id: "${baselineVersionId}", last_analyzed_version_id: "${jobLastAnalyzed2 || 'null'}", source: "dev-engine-v2" }`);
              try {
                const baselineScoreResult = await callEdgeFunctionWithRetry(
                  supabase, supabaseUrl, "dev-engine-v2", {
                    action: "analyze",
                    projectId: job.project_id,
                    documentId: doc.id,
                    versionId: baselineVersionId,
                    deliverableType: currentDoc,
                    developmentBehavior: behavior,
                    format,
                  }, token, job.project_id, format, currentDoc, jobId, newStep + 2
                );
                const baselineScores = extractCiGp(baselineScoreResult);
                if (baselineScores.ci === null || baselineScores.gp === null) {
                  throw new Error(`Baseline scoring returned nulls (CI=${baselineScores.ci}, GP=${baselineScores.gp})`);
                }

                const persistedFromAnalyze = await persistVersionScores(supabase, {
                  versionId: baselineVersionId,
                  ci: baselineScores.ci,
                  gp: baselineScores.gp,
                  source: "auto-run-analyze",
                  jobId,
                  protectHigher: true,
                  docType: currentDoc,
                });

                baselineCI = persistedFromAnalyze.ci;
                baselineGP = persistedFromAnalyze.gp;

                await updateJob(supabase, jobId, {
                  last_analyzed_version_id: baselineVersionId,
                  last_ci: baselineCI,
                  last_gp: baselineGP,
                });
              } catch (bsErr: any) {
                await logStep(supabase, jobId, null, currentDoc, "baseline_score_failed",
                  `Baseline scoring failed: ${bsErr.message}. Halting.`,
                  {}, undefined, { baselineVersionId, error: bsErr.message });
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  status: "paused",
                  pause_reason: "BASELINE_SCORE_FAILED",
                  stop_reason: `Baseline scoring failed for ${currentDoc}: ${bsErr.message}`,
                });
                return respondWithJob(supabase, jobId);
              }
            }
          }

          console.log(`[auto-run][IEL] baseline_selected { job_id: "${jobId}", doc_type: "${currentDoc}", baseline_version_id: "${baselineVersionId}", baseline_ci: ${baselineCI}, baseline_gp: ${baselineGP}, baseline_source: "${baselineSourceLabel}" }`);

          const BASE_REGRESSION_THRESHOLD = getRegressionThreshold(currentDoc); // PROMOTE_DELTA — unchanged
          const BASE_EXPLORE_THRESHOLD = getExploreThreshold(currentDoc);       // EXPLORE_DELTA
          const BASE_MAX_FRONTIER_ATTEMPTS = getMaxFrontierAttempts(currentDoc);

          // ── BLOCKER-AWARE THRESHOLD WIDENING ──
          // When hard_gate blockers are present, allow wider exploration to remove them
          // PROMOTE threshold stays strict — only explore gets widened
          const hasBlockers = blockersCount > 0;
          const REGRESSION_THRESHOLD = BASE_REGRESSION_THRESHOLD; // NEVER widened
          const EXPLORE_THRESHOLD = hasBlockers ? BASE_EXPLORE_THRESHOLD + 10 : BASE_EXPLORE_THRESHOLD;
          const MAX_FRONTIER_ATTEMPTS = hasBlockers ? BASE_MAX_FRONTIER_ATTEMPTS + 5 : BASE_MAX_FRONTIER_ATTEMPTS;

          if (hasBlockers) {
            console.log(`[auto-run] blocker-aware widening: EXPLORE ${BASE_EXPLORE_THRESHOLD}→${EXPLORE_THRESHOLD}, MAX_FRONTIER ${BASE_MAX_FRONTIER_ATTEMPTS}→${MAX_FRONTIER_ATTEMPTS}, blockers=${blockersCount}`);
          }

          // ── Helper: score a candidate version (returns CI/GP + blocker count) ──
          async function scoreCandidate(candVersionId: string, label: string): Promise<{ ci: number; gp: number; blockerCount: number } | null> {
            const scorePayloadMeta = {
              action: "analyze",
              projectId: job.project_id,
              documentId: doc.id,
              versionId: candVersionId,
              deliverableType: currentDoc,
              format,
              label,
            };

            const doScoreCall = async (): Promise<{ ci: number; gp: number; blockerCount: number } | null> => {
              const postScoreResult = await callEdgeFunctionWithRetry(
                supabase, supabaseUrl, "dev-engine-v2", {
                  action: "analyze",
                  projectId: job.project_id,
                  documentId: doc.id,
                  versionId: candVersionId,
                  deliverableType: currentDoc,
                  developmentBehavior: behavior,
                  format,
                }, token, job.project_id, format, currentDoc, jobId, newStep + 3
              );
              const scores = extractCiGp(postScoreResult);
              if (scores.ci === null || scores.gp === null) {
                console.error(`[auto-run] scoreCandidate(${label}) returned null scores from response:`, JSON.stringify(postScoreResult).slice(0, 500));
                return null;
              }
              const inner = postScoreResult?.result !== undefined ? postScoreResult.result : postScoreResult;
              const analysisObj = inner?.analysis || inner || {};
              const candBlockers = pickArray(analysisObj, ["blocking_issues", "blockers", "scores.blocking_issues"]);
              return { ci: scores.ci, gp: scores.gp, blockerCount: candBlockers.length };
            };

            try {
              return await doScoreCall();
            } catch (e: any) {
              const errStatus = (e as any).status ?? 0;
              const errBody = ((e as any).body ?? e.message ?? "").slice(0, 300);
              const is5xx = errStatus >= 500 || errStatus === 0;

              // Single retry ONLY for 5xx / network errors
              if (is5xx) {
                console.warn(`[auto-run] scoreCandidate(${label}) 5xx/network error (status=${errStatus}), retrying once after 3s...`);
                await new Promise(r => setTimeout(r, 3000));
                try {
                  return await doScoreCall();
                } catch (retryErr: any) {
                  const retryStatus = (retryErr as any).status ?? 0;
                  const retryBody = ((retryErr as any).body ?? retryErr.message ?? "").slice(0, 300);
                  console.error(`[auto-run] scoreCandidate(${label}) retry also failed: status=${retryStatus} body=${retryBody}`);
                  await logStep(supabase, jobId, null, currentDoc, "post_score_failed_detail",
                    `Scoring failed after retry: status=${retryStatus}, deliverableType=${currentDoc}, versionId=${candVersionId}`,
                    { ci: baselineCI, gp: baselineGP }, undefined,
                    { ...scorePayloadMeta, error_status: retryStatus, response_excerpt: retryBody, retried: true });
                  return null;
                }
              }

              // 4xx — do NOT retry, log diagnostic detail
              console.error(`[auto-run] scoreCandidate(${label}) failed: status=${errStatus} body=${errBody}`);
              await logStep(supabase, jobId, null, currentDoc, "post_score_failed_detail",
                `Scoring failed (${errStatus}): deliverableType=${currentDoc}, versionId=${candVersionId}. ${errBody.slice(0, 120)}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { ...scorePayloadMeta, error_status: errStatus, response_excerpt: errBody, retried: false });
              return null;
            }
          }

          // ── Three-way decision: PROMOTE vs EXPLORE vs REJECT ──
          type GateDecision = "PROMOTE" | "EXPLORE" | "REJECT";
          function threeWayGate(candCI: number, candGP: number): { decision: GateDecision; ciDrop: number; gpDrop: number; worstDrop: number } {
            const ciDrop = baselineCI - candCI;
            const gpDrop = baselineGP - candGP;
            const worstDrop = Math.max(ciDrop, gpDrop);
            if (worstDrop <= REGRESSION_THRESHOLD) return { decision: "PROMOTE", ciDrop, gpDrop, worstDrop };
            if (worstDrop <= EXPLORE_THRESHOLD) return { decision: "EXPLORE", ciDrop, gpDrop, worstDrop };
            return { decision: "REJECT", ciDrop, gpDrop, worstDrop };
          }

          // ── Helper: promote a candidate (ONLY called when gate says PROMOTE) ──
          async function promoteCandidate(candVersionId: string, candCI: number, candGP: number, meta: Record<string, any>, candBlockerCount?: number): Promise<boolean> {
            const { error: promoteErr } = await supabase.rpc("set_current_version", {
              p_document_id: doc.id,
              p_new_version_id: candVersionId,
            });
            if (promoteErr) {
              await logStep(supabase, jobId, null, currentDoc, "promote_failed",
                `set_current_version failed: ${promoteErr.message}. Failing closed.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { ...meta, error: promoteErr.message });
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                status: "paused",
                pause_reason: "PROMOTE_FAILED",
                stop_reason: `Promotion failed for ${currentDoc}: ${promoteErr.message}`,
              });
              return false;
            }

            let acceptedCI = candCI;
            let acceptedGP = candGP;

            try {
              const persistedForkScore = await persistVersionScores(supabase, {
                versionId: candVersionId,
                ci: candCI,
                gp: candGP,
                source: "auto-run-fork",
                jobId,
                protectHigher: true,
                docType: currentDoc,
              });

              acceptedCI = persistedForkScore.ci;
              acceptedGP = persistedForkScore.gp;

              const latestScoreSnapshot = await getVersionScoreSnapshot(supabase, candVersionId);
              const latestMeta = latestScoreSnapshot.meta && typeof latestScoreSnapshot.meta === "object" && !Array.isArray(latestScoreSnapshot.meta)
                ? latestScoreSnapshot.meta
                : {};

              const approvalPayloadMeta = {
                ...latestMeta,
                accepted_by: "auto-run",
                accepted_from: meta.strategy || "fork",
                accepted_at: new Date().toISOString(),
                accepted_job_id: jobId,
              };

              const { error: approvalErr } = await supabase.from("project_document_versions").update({
                approval_status: "approved",
                approved_at: new Date().toISOString(),
                approved_by: job.user_id,
                meta_json: approvalPayloadMeta,
              }).eq("id", candVersionId);

              if (approvalErr) {
                throw new Error(approvalErr.message);
              }
            } catch (approvalStampErr: any) {
              console.warn(`[auto-run][IEL] candidate_approval_stamp_failed { version_id: "${candVersionId}", error: "${approvalStampErr?.message || 'unknown'}" }`);
              await logStep(supabase, jobId, null, currentDoc, "candidate_approval_stamp_failed",
                `Approval/score persistence failed for accepted candidate ${candVersionId}. Failing closed.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { job_id: jobId, document_id: doc.id, version_id: candVersionId, error: approvalStampErr?.message || "unknown", rls_hint: "verify UPDATE policy/service role write path" });
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                status: "paused",
                pause_reason: "CANDIDATE_APPROVAL_STAMP_FAILED",
                stop_reason: `Accepted version stamp failed for ${currentDoc}.`,
                error: approvalStampErr?.message || "candidate_approval_stamp_failed",
              });
              return false;
            }

            console.log(`[auto-run][IEL] candidate_accepted_persisted { document_id: "${doc.id}", accepted_version_id: "${candVersionId}", approval_status_set: "approved", job_id: "${jobId}", step_index: ${newStep}, ci: ${acceptedCI}, gp: ${acceptedGP} }`);

            // ── BLOCKER-AWARE BEST-OF TRACKING (STAGE-SCOPED from auto_run_steps + GLOBAL best update) ──
            // Stage-scoped best is derived from DB; global best_* on job is informational only.
            const stageBest = await getStageBestFromSteps(supabase, jobId, currentDoc, job.project_id);
            const candidateComposite = acceptedCI + acceptedGP;
            const cbc = candBlockerCount ?? 0;

            // Compare against stage-scoped best for [NEW BEST] label
            let isStageBest = false;
            if (!stageBest) {
              isStageBest = true; // first scored review for this stage
            } else if (candidateComposite > stageBest.score) {
              isStageBest = true;
            }

            // Also check if this is a new GLOBAL best (informational)
            const globalBestCI = (job as any).best_ci ?? null;
            const globalBestGP = (job as any).best_gp ?? null;
            const globalBestComposite = (globalBestCI ?? -1) + (globalBestGP ?? -1);
            const isGlobalBest = globalBestCI === null || candidateComposite > globalBestComposite;

            // ── STAGNATION TRACKING ──
            const lastBlockerCount = (job as any).last_blocker_count ?? null;
            const prevStagnation = (job as any).stagnation_no_blocker_count ?? 0;
            const blockersImproved = lastBlockerCount !== null && cbc < lastBlockerCount;
            const stagnationCount = (hasBlockers && !blockersImproved && lastBlockerCount !== null) ? prevStagnation + 1 : 0;

            await logStep(supabase, jobId, null, currentDoc, "rewrite_accepted",
              `Candidate accepted (attempt ${attemptNumber}, ${strategy}). CI: ${baselineCI}→${acceptedCI}, GP: ${baselineGP}→${acceptedGP}. Blockers: ${blockersCount}→${cbc}${blockersImproved ? ' ✓ improved' : ''}${isStageBest ? ' [STAGE BEST]' : ''}${isGlobalBest ? ' [GLOBAL BEST]' : ''}`,
              { ci: acceptedCI, gp: acceptedGP }, undefined,
              { ...meta, attemptNumber, strategy, isStageBest, isGlobalBest, blocker_count_before: blockersCount, blocker_count_after: cbc, blockers_improved: blockersImproved, stagnation_count: stagnationCount, accepted_version_id: candVersionId, score_source: "auto-run-fork" });

            const jobUpdate: Record<string, any> = {
              stage_loop_count: newLoopCount,
              follow_latest: true,
              resume_document_id: doc.id,
              resume_version_id: candVersionId,
              last_analyzed_version_id: candVersionId,
              last_ci: acceptedCI,
              last_gp: acceptedGP,
              last_blocker_count: cbc,
              stagnation_no_blocker_count: stagnationCount,
              // Clear frontier on successful promotion
              frontier_version_id: null,
              frontier_ci: null,
              frontier_gp: null,
              frontier_attempts: 0,
            };
            // Update global best_* (informational only — never used for stage decisions)
            if (isGlobalBest) {
              jobUpdate.best_version_id = candVersionId;
              jobUpdate.best_ci = acceptedCI;
              jobUpdate.best_gp = acceptedGP;
              jobUpdate.best_score = candidateComposite;
              jobUpdate.best_document_id = doc.id;
              jobUpdate.best_blocker_count = cbc;
              jobUpdate.best_blocker_score = cbc;
              console.log(`[auto-run][IEL] global_best_updated { job_id: "${jobId}", doc_type: "${currentDoc}", version_id: "${candVersionId}", ci: ${acceptedCI}, gp: ${acceptedGP}, composite: ${candidateComposite}, note: "informational_only" }`);
            }
            if (isStageBest) {
              console.log(`[auto-run][IEL] promote_selected { job_id: "${jobId}", doc_type: "${currentDoc}", promoted_version_id: "${candVersionId}", ci: ${acceptedCI}, gp: ${acceptedGP}, composite: ${candidateComposite}, source: "stage_best_from_steps" }`);
            }
            await updateJob(supabase, jobId, jobUpdate);

            // ── IEL: AUTO-RESOLVE actionable project_notes after successful rewrite ──
            const noteResolution = await autoResolveActionableNotes(supabase, job.project_id, currentDoc, candVersionId, jobId, "auto_run_rewrite");
            if (noteResolution.resolved > 0) {
              await logStep(supabase, jobId, null, currentDoc, "note_auto_resolved",
                `Resolved ${noteResolution.resolved} note(s) on ${currentDoc} after rewrite: [${noteResolution.notes.map(n => n.title).join("; ")}]. All notes exhausted — ready to promote.`,
                { ci: acceptedCI, gp: acceptedGP }, undefined,
                { resolved_count: noteResolution.resolved, resolved_notes: noteResolution.notes, resolver: "auto_run_rewrite", version_id: candVersionId });
            }

            console.log(`[auto-run][IEL] acceptance_anchor_set { job_id: "${jobId}", doc_type: "${currentDoc}", document_id: "${doc.id}", accepted_version_id: "${candVersionId}", last_analyzed_version_id: "${candVersionId}", last_ci: ${acceptedCI}, last_gp: ${acceptedGP}, score_source: "auto-run-fork", eligibility_reason: "approved_after_accept" }`);
            return true;
          }

          // ── Helper: set frontier (EXPLORE path — does NOT change is_current) ──
          // INVARIANT: best_* is NOT mutated on EXPLORE. Only PROMOTE updates best_*.
          // Frontier attempts are read from persisted DB state (not stale in-memory job).
          async function setFrontier(candVersionId: string, candCI: number, candGP: number, meta: Record<string, any>): Promise<void> {
            // Read latest persisted frontier state to avoid stale in-memory data
            const { data: freshJob } = await supabase
              .from("auto_run_jobs")
              .select("frontier_version_id, frontier_attempts")
              .eq("id", jobId)
              .maybeSingle();
            const prevFrontierVersionId = freshJob?.frontier_version_id ?? null;
            const prevAttempts = freshJob?.frontier_attempts ?? 0;
            const isNewFrontier = prevFrontierVersionId !== candVersionId;
            const newAttempts = isNewFrontier ? 1 : prevAttempts + 1;

            await logStep(supabase, jobId, null, currentDoc, "frontier_set",
              `Frontier set (attempt ${attemptNumber}, ${strategy}): CI=${candCI}, GP=${candGP}. Baseline preserved (CI=${baselineCI}, GP=${baselineGP}). is_current unchanged. frontier_attempts=${newAttempts}`,
              { ci: candCI, gp: candGP }, undefined,
              { ...meta, attemptNumber, strategy, frontier_version_id: candVersionId, frontier_attempts: newAttempts, prevAttempts, isNewFrontier });

            const jobUpdate: Record<string, any> = {
              stage_loop_count: newLoopCount,
              follow_latest: false,
              resume_document_id: doc.id,
              resume_version_id: candVersionId, // next rewrite reads from frontier
              frontier_version_id: candVersionId,
              frontier_ci: candCI,
              frontier_gp: candGP,
              frontier_attempts: newAttempts,
              last_ci: candCI,
              last_gp: candGP,
            };
            // NOTE: best_* is NOT updated on EXPLORE — only PROMOTE updates best_*
            await updateJob(supabase, jobId, jobUpdate);
          }

          // ── STAGNATION DETECTION: if blockers haven't decreased in 4 attempts, pause ──
          const prevStagnationCount = (job as any).stagnation_no_blocker_count ?? 0;
          const STAGNATION_LIMIT = 4;
          if (hasBlockers && prevStagnationCount >= STAGNATION_LIMIT) {
            await logStep(supabase, jobId, null, currentDoc, "stagnation_no_blocker_progress",
              `Blocker count has not decreased in ${prevStagnationCount} consecutive attempts (blockers=${blockersCount}). Pausing for review.`,
              { ci: baselineCI, gp: baselineGP }, undefined,
              { blockersCount, stagnation_count: prevStagnationCount, STAGNATION_LIMIT });
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              status: "paused",
              pause_reason: "STAGNATION_NO_BLOCKER_PROGRESS",
              stop_reason: `Blockers (${blockersCount}) have not decreased in ${prevStagnationCount} attempts. Consider structural changes or manual editing.`,
            });
            return respondWithJob(supabase, jobId);
          }

          // ── PATCH 4: STUCK_BLOCKER_LOOP detector for early-stage docs ──
          const EARLY_STAGE_DOCS = new Set(["idea", "concept_brief"]);
          if (EARLY_STAGE_DOCS.has(currentDoc) && hasBlockers && newLoopCount >= 3) {
            // Check if the last 3 auto_decided steps have the same decision hash
            const { data: recentDecidedSteps } = await supabase
              .from("auto_run_steps")
              .select("output_ref")
              .eq("job_id", jobId)
              .eq("document", currentDoc)
              .eq("action", "auto_decided")
              .order("step_index", { ascending: false })
              .limit(3);
            
            if (recentDecidedSteps && recentDecidedSteps.length >= 3) {
              const hashes = recentDecidedSteps.map((s: any) => {
                const sel = s.output_ref?.selections || {};
                const keys = Object.keys(sel).sort();
                return keys.map(k => `${k}=${sel[k]}`).join("|");
              });
              const allSame = hashes.every((h: string) => h === hashes[0]) && hashes[0].length > 0;
              if (allSame) {
                const blockerKeys = Object.keys(recentDecidedSteps[0]?.output_ref?.selections || {}).slice(0, 10);
                await logStep(supabase, jobId, null, currentDoc, "stuck_blocker_loop",
                  `STUCK_BLOCKER_LOOP: Same decisions repeated 3+ times for ${currentDoc}. Blocker keys: ${blockerKeys.join(", ")}`,
                  { ci: baselineCI, gp: baselineGP }, undefined,
                  { blockersCount, repeating_keys: blockerKeys, loop_count: newLoopCount });
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  status: "paused",
                  pause_reason: `STUCK_BLOCKER_LOOP: repeating blocker keys: ${blockerKeys.join(", ")}`,
                  stop_reason: `Same blockers repeated 3+ rewrite cycles for ${currentDoc}. Manual intervention required. Blocker keys: ${blockerKeys.join(", ")}`,
                });
                return respondWithJob(supabase, jobId);
              }
            }
          }

          // ── PATCH 2: Build accepted decisions bundle and inject into rewrite ──
          const decisionBundle = await buildAcceptedDecisionsBundle(supabase, jobId, currentDoc);
          let decisionDirections: string[] = [];
          if (decisionBundle && decisionBundle.accepted_decisions.length > 0) {
            decisionDirections = [
              "CRITICAL — MUST FIX (accepted stabilise decisions):",
              decisionBundle.accepted_decisions_compact_text,
              "You MUST apply ALL of the above fixes in this rewrite. Do not ignore them.",
            ];
            console.log(`[auto-run] injected_accepted_decisions count=${decisionBundle.accepted_decisions.length} hash=${decisionBundle.accepted_decisions_hash} doc=${currentDoc} job=${jobId}`);
            await logStep(supabase, jobId, null, currentDoc, "decisions_injected",
              `Injected ${decisionBundle.accepted_decisions.length} accepted decisions into rewrite (hash=${decisionBundle.accepted_decisions_hash})`,
              { ci: baselineCI, gp: baselineGP }, undefined, {
                accepted_decisions_hash: decisionBundle.accepted_decisions_hash,
                accepted_decisions_count: decisionBundle.accepted_decisions.length,
                accepted_decisions_keys: decisionBundle.accepted_decisions_keys,
              }
            );
          }
          // Merge decision directions with strategy directions
          const mergedDirections = [...decisionDirections, ...strategyDirections];

          // ── AUTO-RESOLVE NOTES: inject non-human note summaries so rewrite addresses them ──
          try {
            const noteDirs = await buildNoteDirectionsForRewrite(supabase, job.project_id, currentDoc);
            if (noteDirs.length > 0) {
              mergedDirections.push(...noteDirs);
              console.log(`[auto-run][IEL] note_directions_injected { job_id: "${jobId}", doc_type: "${currentDoc}", count: ${noteDirs.length} }`);
            }
          } catch (ndErr: any) {
            console.warn(`[auto-run][IEL] note_directions_failed: ${ndErr?.message}`);
          }

          // ── EPISODE BEATS SEED: inject structural requirements for vertical_episode_beats stage ──
          if (currentDoc === "vertical_episode_beats" || currentDoc === "episode_beats") {
            try {
              const { data: ebProj } = await supabase.from("projects")
                .select("meta_json").eq("id", job.project_id).maybeSingle();
              const epDurMin = ebProj?.meta_json?.episode_duration_min || 90;
              const epDurMax = ebProj?.meta_json?.episode_duration_max || 150;
              mergedDirections.push(`\n\nEPISODE BEATS REQUIREMENTS (mandatory — non-negotiable structural rules):

HOOK-FIRST MANDATE (most common failure — fix this first):
- Beat 1 of EVERY episode MUST be a new, forward-moving hook FOR THIS EPISODE.
- Beat 1 MUST NOT resolve, re-explain, or recap the previous episode's cliffhanger.
- The viewer carries the tension from the prior cliffhanger INTO this episode. Beat 1 exploits that tension with something NEW — a surprising action, a new arrival, an unexpected revelation — NOT by resolving what came before.
- If Beat 1 begins with "Rin finally discovers...", "The mystery of..." or "picking up from..." — REWRITE IT.
- CORRECT Beat 1 pattern: drop the viewer into a new high-tension moment that makes them need to keep watching.

REQUIRED BEAT FORMAT PER EPISODE:
BEAT 1 — TYPE: Hook | CHARACTER: [who acts] | ACTION: [what happens] | SHIFT: [emotional/status change]
BEAT 2 — TYPE: Escalation | CHARACTER: | ACTION: | SHIFT:
BEAT 3 — TYPE: [Reversal/Revelation/Complication] | CHARACTER: | ACTION: | SHIFT:
BEAT 4+ — TYPE: [Escalation/Climax] | CHARACTER: | ACTION: | SHIFT:
FINAL BEAT — TYPE: Cliffhanger | CHARACTER: | ACTION: | SHIFT: [creates urgency for next episode]

EPISODE DURATION: ${epDurMin}–${epDurMax} seconds. Minimum 4 beats per episode. Target 1 beat per ~${Math.round((epDurMin + epDurMax) / 2 / 5)} seconds.

CHARACTER ARC INTEGRITY:
- Protagonist and romantic lead must remain emotionally recoverable throughout.
- Actions like sustained gaslighting, forgery, or emotional manipulation without story consequence make characters irredeemable. These are blockers.
- Character mistakes and flaws are VALID. Unaddressed, consequence-free moral violations are NOT.

CONTINUITY:
- Each episode must flow cleanly from the previous without jarring logic breaks.
- If a continuity issue exists between specific episodes, RESOLVE it explicitly in the beats — do not ignore it.\n`);
              console.log(`[auto-run][ep-beats-seed] episode_beats_seed_injected { job_id: "${jobId}", doc_type: "${currentDoc}" }`);
            } catch (ebSeedErr: any) {
              console.warn(`[auto-run][ep-beats-seed] episode_beats_seed_failed (non-fatal): ${ebSeedErr?.message}`);
            }
          }

          // ── EPISODE GRID SEED: inject structural requirements for episode_grid stage ──
          if (currentDoc === "episode_grid") {
            try {
              const { data: egProj } = await supabase.from("projects")
                .select("title, meta_json").eq("id", job.project_id).maybeSingle();
              const epCount = egProj?.meta_json?.episode_count || 30;
              mergedDirections.push(`\n\nEPISODE GRID REQUIREMENTS (mandatory — apply to every rewrite):

EPISODE COUNT: This grid MUST contain exactly ${epCount} episode entries — one for every episode from 1 to ${epCount}. Missing episodes are blockers.

REQUIRED FORMAT PER EPISODE ENTRY:
## EPISODE N: <Specific Episode Title>
PREMISE: <one sentence — the specific events of THIS episode>
HOOK: <what captures the viewer in the first 15 seconds>
CORE MOVE: <the single most important story change or revelation>
CHARACTER FOCUS: <whose arc or decision drives this episode>
CLIFFHANGER: <exactly how this episode ends to pull to the next>
ARC POSITION: <setup / escalation / midpoint / complication / pre-climax / climax / resolution>
TONE: <emotional register of this episode>

CRITICAL BLOCKERS (any of these will fail evaluation):
1. Any episode number missing from the grid
2. PREMISE that doesn't describe THIS episode's specific events (generic or "follows pattern")
3. Range summaries ("Episodes 1-7 establish..." or "follows same structure")
4. Entries that describe season structure instead of episode-specific events
5. Missing required fields (PREMISE/HOOK/CORE MOVE/CHARACTER FOCUS/CLIFFHANGER/ARC POSITION/TONE)

SCOPE: Episode Grid is a structural overview — NOT a beat breakdown. Do NOT include:
- Sub-beats or micro-beats (→ belongs in Episode Beats)
- Character backstory (→ belongs in Character Bible)
- Season-wide arc text (→ belongs in Season Arc)
- Dialogue or scripted content (→ belongs in Season Script)\n`);
              console.log(`[auto-run][ep-grid-seed] episode_grid_seed_injected { job_id: "${jobId}", ep_count: ${epCount} }`);
            } catch (egSeedErr: any) {
              console.warn(`[auto-run][ep-grid-seed] episode_grid_seed_failed (non-fatal): ${egSeedErr?.message}`);
            }
          }

          // ── FORMAT RULES SEED: inject deterministic format constraints for format_rules stage ──
          if (currentDoc === "format_rules") {
            try {
              const { data: fmtProj } = await supabase.from("projects")
                .select("title, format, meta_json, episode_count").eq("id", job.project_id).maybeSingle();
              const fmtSeedBlock = buildFormatRulesSeedBlock(format, fmtProj);
              if (fmtSeedBlock) {
                mergedDirections.push(fmtSeedBlock);
                console.log(`[auto-run][fmt-seed] format_rules_seed_injected { job_id: "${jobId}", format: "${format}" }`);
              }
            } catch (fmtSeedErr: any) {
              console.warn(`[auto-run][fmt-seed] format_rules_seed_failed (non-fatal): ${fmtSeedErr?.message}`);
            }
          }

          // ── NARRATIVE SPINE: inject locked structural constraints into all stages after concept_brief ──
          const SPINE_ELIGIBLE_STAGES = ["character_bible", "season_arc", "episode_grid", "episode_beats", "season_scripts", "episode_script", "treatment", "story_outline", "beat_sheet", "feature_script", "production_draft"];
          if (SPINE_ELIGIBLE_STAGES.includes(currentDoc)) {
            try {
              const { data: spineProj } = await supabase.from("projects")
                .select("narrative_spine_json").eq("id", job.project_id).maybeSingle();
              const spineBlock = spineToPromptBlock(spineProj?.narrative_spine_json);
              if (spineBlock) {
                mergedDirections.push(spineBlock);
                console.log(`[auto-run][spine] spine_injected { job_id: "${jobId}", doc_type: "${currentDoc}", project_id: "${job.project_id}" }`);
              }
            } catch (spineErr: any) {
              console.warn(`[auto-run][spine] spine_read_failed { job_id: "${jobId}", error: "${spineErr?.message}" }`);
            }
          }

          // ── CPM_V1: inject Character Pressure Matrix repair targeting for episode_grid ──
          if (isCPMEnabled() && currentDoc === "episode_grid") {
            const cpRepair = buildCPRepairDirections(
              allNotesForStrategy.blocking_issues || [],
              allNotesForStrategy.high_impact_notes || [],
            );
            if (cpRepair.failClosed) {
              logCPM("cpm_v1_repair_blocked_missing_blockers", { job_id: jobId, doc_type: currentDoc });
              await logStep(supabase, jobId, null, currentDoc, "cpm_repair_blocked",
                `CPM repair blocked: ${cpRepair.reason}. No freeform rewrite for CP fields.`,
                { ci: baselineCI, gp: baselineGP }, undefined, { reason: cpRepair.reason });
            } else {
              mergedDirections.push(...cpRepair.directions);
              logCPM("cpm_v1_applied", { job_id: jobId, doc_type: "episode_grid", repair_directions: cpRepair.directions.length });
            }
            // Also inject the generation prompt block so rewrites maintain CP structure
            mergedDirections.push(CPM_GENERATION_PROMPT_BLOCK);
          }

          // ── PILLAR 2: REWRITE TARGETING V1 — deterministic note-to-directions compiler ──
          if (isRewriteTargetingEnabled()) {
            const compiled = compileRewriteDirectives(
              allNotesForStrategy.blocking_issues || [],
              allNotesForStrategy.high_impact_notes || [],
              currentDoc,
            );
            if (compiled.failClosed) {
              console.warn(`[dev-engine-v2][IEL] rewrite_targeting_fail_closed_missing_notes { job_id: "${jobId}", doc_type: "${currentDoc}", reason: "${compiled.reason}" }`);
              await logStep(supabase, jobId, null, currentDoc, "rewrite_targeting_fail_closed",
                `Rewrite targeting fail-closed: ${compiled.reason}`, { ci: baselineCI, gp: baselineGP });
            } else if (compiled.directives.length > 0) {
              const targetedLines = formatDirectivesAsDirections(compiled.directives, currentDoc);
              mergedDirections.push(...targetedLines);
              console.log(`[dev-engine-v2][IEL] rewrite_targeting_compiled { job_id: "${jobId}", doc_type: "${currentDoc}", directive_count: ${compiled.directives.length}, categories: ${JSON.stringify([...new Set(compiled.directives.map(d => d.category))])} }`);
              await logStep(supabase, jobId, null, currentDoc, "rewrite_targeting_compiled",
                `Compiled ${compiled.directives.length} targeted rewrite directives`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { directive_count: compiled.directives.length, categories: [...new Set(compiled.directives.map(d => d.category))] });
            }
          }

          // ── CANON-LOCK INJECTION: if retrying after CANON_MISMATCH, inject entity constraints ──
          const jobMeta = (job as any).meta_json || {};
          let canonLockWasApplied = false;
          let canonLockAttemptId: number | null = null;
          if (jobMeta.canon_lock_mode && (Array.isArray(jobMeta.canon_lock_core_entities) || Array.isArray(jobMeta.canon_lock_entities))) {
            const coreEntities: string[] = jobMeta.canon_lock_core_entities || [];
            const secondaryEntities: string[] = jobMeta.canon_lock_secondary_entities || [];
            // Back-compat: if split lists empty, fall back to legacy flat list
            const hasStructured = coreEntities.length > 0 || secondaryEntities.length > 0;
            canonLockAttemptId = (jobMeta.canon_lock_attempt_id || 0);

            if (hasStructured) {
              const coreList = coreEntities.slice(0, 30).join(", ");
              const secondaryList = secondaryEntities.slice(0, 50).join(", ");
              if (coreList) {
                mergedDirections.push(
                  `CANON-LOCK: You MUST preserve all CORE canonical entities exactly as named and not contradict them: ${coreList}`,
                  `Do NOT rename, omit, or mutate any CORE entity.`,
                );
              }
              if (secondaryList) {
                mergedDirections.push(
                  `Increase canon coverage by weaving in these SECONDARY entities naturally where appropriate (do not force): ${secondaryList}`,
                );
              }
              mergedDirections.push(
                `You may introduce minor new entities only if narratively required — do not invent major new named characters, locations, or concepts not in the canon.`,
              );
            } else {
              // Legacy flat list fallback
              const entityList = (jobMeta.canon_lock_entities || []).slice(0, 80).join(", ");
              mergedDirections.push(
                `CANON-LOCK: Preserve these canonical entities and increase coverage naturally: ${entityList}`,
                `Do NOT rename or omit canonical entities. Do not invent major new named entities.`,
              );
            }
            canonLockWasApplied = true;
            console.log(`[auto-run] Canon-lock mode active (attempt_id=${canonLockAttemptId}): core=${coreEntities.length}, secondary=${secondaryEntities.length}`);
            // NOTE: canon_lock_mode is cleared AFTER successful rewrite, not here
          }

          // ── PHASE 2C: REWRITE ELIGIBILITY GATE (delta-based churn prevention) ──
          {
            const { buildEligibilityInput, getRewriteEligibility, readPreviousEligibility, computeEligibilityFingerprint, buildEligibilityPersistPatch, buildEligibilityScopeKey } = await import("../_shared/rewriteEligibility.ts");
            const eligScopeKey = buildEligibilityScopeKey(currentDoc, strategy);
            const eligInput = await buildEligibilityInput(supabase, job.project_id, currentDoc, baselineVersionId, {
              blockers: blockers,
              highImpactNotes: highImpact,
              resolverHash,
              acceptedDecisionsHash: decisionBundle?.accepted_decisions_hash || null,
              strategy,
              frontierVersionId: (job as any).frontier_version_id || null,
            });
            const prevElig = readPreviousEligibility(jobMeta, eligScopeKey);
            const eligResult = getRewriteEligibility(eligInput, prevElig.fingerprint, prevElig.input, "auto");

            console.log(`[auto-run][IEL] rewrite_eligibility_eval ${JSON.stringify({
              job_id: jobId, doc_type: currentDoc, scope_key: eligScopeKey, eligible: eligResult.eligible,
              fingerprint: eligResult.fingerprint, prev_fingerprint: eligResult.previousFingerprint,
              material_changes: eligResult.materialChanges, reason: eligResult.reason,
            })}`);

            if (!eligResult.eligible) {
              await logStep(supabase, jobId, null, currentDoc, "rewrite_eligibility_denied",
                `Rewrite denied: ${eligResult.reason}. No material delta since last attempt. [scope=${eligScopeKey}]`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { fingerprint: eligResult.fingerprint, previousFingerprint: eligResult.previousFingerprint, unchangedInputs: eligResult.unchangedInputs, blockingFactors: eligResult.blockingFactors, scopeKey: eligScopeKey });
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                status: "paused",
                pause_reason: "REWRITE_ELIGIBILITY_DENIED",
                stop_reason: `No material delta for ${currentDoc}: ${eligResult.reason}. Resolve upstream issues or change inputs to continue.`,
                last_ui_message: `Rewrite skipped: no material change detected since last attempt. Modify inputs or resolve issues to continue.`,
              });
              return respondWithJob(supabase, jobId);
            }

            // Persist scoped fingerprint for next comparison
            const eligPatch = buildEligibilityPersistPatch(jobMeta, eligResult.fingerprint, eligInput, eligScopeKey);
            await supabase.from("auto_run_jobs").update({ meta_json: eligPatch }).eq("id", jobId);

            await logStep(supabase, jobId, null, currentDoc, "rewrite_eligibility_approved",
              `Rewrite eligible: ${eligResult.materialChanges.join(", ")}`,
              { ci: baselineCI, gp: baselineGP }, undefined,
              { fingerprint: eligResult.fingerprint, materialChanges: eligResult.materialChanges });
          }

          try {
            // ── FORK PATH: FORK_CONSERVATIVE_AGGRESSIVE ──
            if (strategy === "FORK_CONSERVATIVE_AGGRESSIVE") {
              const forkDirs = getForkDirections();
              // Use frontier as input if available, compare against baseline
              const forkInputVersionId = (job as any).frontier_version_id ?? baselineVersionId;
              const rewriteBase = {
                projectId: job.project_id,
                documentId: doc.id,
                versionId: forkInputVersionId,
                approvedNotes: strategyNotes,
                protectItems,
                deliverableType: currentDoc,
                developmentBehavior: behavior,
                format,
                episode_target_duration_seconds: episodeDuration,
                season_episode_count: seasonEpisodeCount,
              };

              // Generate two candidates in parallel
              const [conservativeResult, aggressiveResult] = await Promise.allSettled([
                rewriteWithFallback(supabase, supabaseUrl, token,
                  { ...rewriteBase, globalDirections: [...decisionDirections, ...forkDirs.conservative] },
                  jobId, newStep + 2, format, currentDoc),
                rewriteWithFallback(supabase, supabaseUrl, token,
                  { ...rewriteBase, globalDirections: [...decisionDirections, ...forkDirs.aggressive] },
                  jobId, newStep + 3, format, currentDoc),
              ]);

              const candA = conservativeResult.status === "fulfilled" ? conservativeResult.value.candidateVersionId : null;
              const candB = aggressiveResult.status === "fulfilled" ? aggressiveResult.value.candidateVersionId : null;

              // Stamp criteria on fork candidates
              for (const forkCandId of [candA, candB].filter(Boolean)) {
                try {
                  const candText = await supabase.from("project_document_versions").select("plaintext").eq("id", forkCandId).maybeSingle();
                  const candMeasured = estimateDurationSeconds(candText?.data?.plaintext || "");
                  await supabase.from("project_document_versions").update({
                    criteria_hash: currentCriteriaHash,
                    criteria_json: latestCriteriaSnapshot,
                    measured_metrics_json: { measured_duration_seconds: candMeasured, estimated_at: new Date().toISOString(), estimator: 'edge_deterministic' },
                  }).eq("id", forkCandId);
                } catch (stampErr: any) {
                  console.warn(`[auto-run] fork candidate stamp failed for ${forkCandId}:`, stampErr?.message);
                }
              }

              await logStep(supabase, jobId, null, currentDoc, "fork_candidates_created",
                `Fork: conservative=${candA || 'FAILED'}, aggressive=${candB || 'FAILED'}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { baselineVersionId, forkInputVersionId, candA, candB, attemptNumber, strategy });

              // Score both candidates
              const scoreA = candA ? await scoreCandidate(candA, "conservative") : null;
              const scoreB = candB ? await scoreCandidate(candB, "aggressive") : null;

              await logStep(supabase, jobId, null, currentDoc, "fork_candidates_scored",
                `Conservative: CI=${scoreA?.ci ?? 'N/A'} GP=${scoreA?.gp ?? 'N/A'}, Aggressive: CI=${scoreB?.ci ?? 'N/A'} GP=${scoreB?.gp ?? 'N/A'}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { scoreA, scoreB, baselineCI, baselineGP });

              // Three-way gate on each (compared to BASELINE, not frontier)
              const gateA = scoreA ? threeWayGate(scoreA.ci, scoreA.gp) : null;
              const gateB = scoreB ? threeWayGate(scoreB.ci, scoreB.gp) : null;

              // Collect all scored candidates with their gate decisions
              type ForkCandidate = { versionId: string; ci: number; gp: number; blockerCount: number; label: string; decision: GateDecision };
              const allCandidates: ForkCandidate[] = [];
              if (candA && scoreA && gateA) allCandidates.push({ versionId: candA, ci: scoreA.ci, gp: scoreA.gp, blockerCount: scoreA.blockerCount, label: "conservative", decision: gateA.decision });
              if (candB && scoreB && gateB) allCandidates.push({ versionId: candB, ci: scoreB.ci, gp: scoreB.gp, blockerCount: scoreB.blockerCount, label: "aggressive", decision: gateB.decision });

              // ── IEL: Deterministic fork winner selection ──
              // Policy: 1) highest composite (ci+gp), 2) highest ci, 3) highest gp, 4) fewest blockers, 5) prefer aggressive (stable tiebreak)
              const FORK_SELECTION_POLICY = "composite_first_v1";
              function chooseForkWinner(candidates: ForkCandidate[]): { winner: ForkCandidate; loser: ForkCandidate | null; reason: string } {
                if (candidates.length === 0) return { winner: candidates[0], loser: null, reason: "no_candidates" };
                if (candidates.length === 1) return { winner: candidates[0], loser: null, reason: "single_candidate" };
                const sorted = [...candidates].sort((a, b) => {
                  const compositeA = a.ci + a.gp, compositeB = b.ci + b.gp;
                  if (compositeB !== compositeA) return compositeB - compositeA; // higher composite first
                  if (b.ci !== a.ci) return b.ci - a.ci; // higher ci first
                  if (b.gp !== a.gp) return b.gp - a.gp; // higher gp first
                  if (a.blockerCount !== b.blockerCount) return a.blockerCount - b.blockerCount; // fewer blockers first
                  // Stable tiebreak: prefer aggressive
                  return a.label === "aggressive" ? -1 : b.label === "aggressive" ? 1 : 0;
                });
                const w = sorted[0], l = sorted.length > 1 ? sorted[1] : null;
                const wComp = w.ci + w.gp, lComp = l ? l.ci + l.gp : -1;
                const reason = wComp > lComp ? "higher_composite" : w.ci > (l?.ci ?? -1) ? "higher_ci" : w.gp > (l?.gp ?? -1) ? "higher_gp" : w.blockerCount < (l?.blockerCount ?? Infinity) ? "fewer_blockers" : "tiebreak_aggressive";
                return { winner: w, loser: l, reason };
              }

              console.log(`[auto-run][IEL] fork_scored { conservative: { id: "${candA}", ci: ${scoreA?.ci ?? 'null'}, gp: ${scoreA?.gp ?? 'null'}, blockers: ${scoreA?.blockerCount ?? 'null'} }, aggressive: { id: "${candB}", ci: ${scoreB?.ci ?? 'null'}, gp: ${scoreB?.gp ?? 'null'}, blockers: ${scoreB?.blockerCount ?? 'null'} }, baseline: { ci: ${baselineCI}, gp: ${baselineGP} } }`);

              // Try PROMOTE first
              const promotable = allCandidates.filter(c => c.decision === "PROMOTE");
              if (promotable.length > 0) {
                const { winner, loser, reason } = chooseForkWinner(promotable);
                console.log(`[auto-run][IEL] fork_winner_selected { winner_id: "${winner.versionId}", winner_label: "${winner.label}", winner_ci: ${winner.ci}, winner_gp: ${winner.gp}, winner_composite: ${winner.ci + winner.gp}, loser_id: "${loser?.versionId ?? 'none'}", loser_ci: ${loser?.ci ?? 'N/A'}, loser_gp: ${loser?.gp ?? 'N/A'}, reason: "${reason}", policy: "${FORK_SELECTION_POLICY}" }`);
                const promoted = await promoteCandidate(
                  winner.versionId, winner.ci, winner.gp,
                  { baselineVersionId, forkInputVersionId, candA, candB, forkWinner: winner.label, forkLoser: loser?.label, winner_version_id: winner.versionId, loser_version_id: loser?.versionId, winner_scores: { ci: winner.ci, gp: winner.gp, blockers: winner.blockerCount }, loser_scores: loser ? { ci: loser.ci, gp: loser.gp, blockers: loser.blockerCount } : null, selection_reason: reason, policy: FORK_SELECTION_POLICY, scoreA, scoreB, gateA, gateB },
                  winner.blockerCount
                );
                if (!promoted) {
                  return respondWithJob(supabase, jobId);
                }
                return respondWithJob(supabase, jobId, "run-next");
              }

              // Try EXPLORE (frontier) — pick best explorable using same deterministic policy
              // Read persisted frontier state for deterministic attempt counting
              const explorable = allCandidates.filter(c => c.decision === "EXPLORE");
              if (explorable.length > 0) {
                const { data: freshJobFork } = await supabase
                  .from("auto_run_jobs")
                  .select("frontier_attempts")
                  .eq("id", jobId)
                  .maybeSingle();
                const frontierAttempts = freshJobFork?.frontier_attempts ?? 0;
                if (frontierAttempts < MAX_FRONTIER_ATTEMPTS) {
                  const { winner: best, loser: explorLoser, reason: explorReason } = chooseForkWinner(explorable);
                  console.log(`[auto-run][IEL] fork_winner_selected { winner_id: "${best.versionId}", winner_label: "${best.label}", winner_ci: ${best.ci}, winner_gp: ${best.gp}, winner_composite: ${best.ci + best.gp}, loser_id: "${explorLoser?.versionId ?? 'none'}", reason: "${explorReason}", policy: "${FORK_SELECTION_POLICY}", gate: "EXPLORE" }`);
                  await setFrontier(best.versionId, best.ci, best.gp,
                    { baselineVersionId, forkInputVersionId, candA, candB, forkWinner: best.label, winner_version_id: best.versionId, loser_version_id: explorLoser?.versionId, selection_reason: explorReason, policy: FORK_SELECTION_POLICY, scoreA, scoreB, gateA, gateB });
                  return respondWithJob(supabase, jobId, "run-next");
                }
                // Frontier exhausted — clear and fall through to reject
                await logStep(supabase, jobId, null, currentDoc, "frontier_cleared",
                  `Frontier exhausted after ${frontierAttempts} attempts. Clearing frontier, returning to baseline.`,
                  { ci: baselineCI, gp: baselineGP }, undefined,
                  { frontierAttempts, MAX_FRONTIER_ATTEMPTS });
                await updateJob(supabase, jobId, {
                  frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
                });
              }

              // All REJECT or frontier exhausted
              await logStep(supabase, jobId, null, currentDoc, "fork_both_rejected",
                `Both fork candidates rejected/frontier exhausted. Baseline preserved.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { gateA, gateB, attemptNumber, strategy });

              const shouldHalt = newLoopCount >= job.max_stage_loops;
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                follow_latest: false,
                resume_document_id: doc.id,
                resume_version_id: baselineVersionId,
                last_ci: baselineCI, last_gp: baselineGP,
                ...(shouldHalt ? {
                  status: "paused",
                  pause_reason: "REGRESSION_MAX_ATTEMPTS",
                  stop_reason: `Fork rejected ${newLoopCount} times. Manual review required.`,
                } : {}),
              });
              return respondWithJob(supabase, jobId, shouldHalt ? undefined : "run-next");
            }

            // ── PHASE 2D-B: EPISODIC BLOCK REPAIR TARGETING ──
            let episodicRepairMeta: Record<string, unknown> | null = null;
            let episodicTargetEpisode: number | null = null;
            let originalFullContent: string | null = null;
            {
              try {
                const { isEpisodicBlockRepairSupported, getEpisodeRepairTarget } = await import("../_shared/episodicBlockRegistry.ts");

                if (isEpisodicBlockRepairSupported(currentDoc)) {
                  const { data: verContent } = await supabase
                    .from("project_document_versions")
                    .select("plaintext")
                    .eq("id", baselineVersionId)
                    .maybeSingle();

                  const docContent = verContent?.plaintext || "";
                  if (docContent.length > 100) {
                    originalFullContent = docContent;
                    const primaryIssue = (blockers && blockers.length > 0)
                      ? { episodeIndex: (blockers[0] as any)?.episodeIndex, category: blockers[0]?.category, title: blockers[0]?.title || blockers[0]?.objective, summary: blockers[0]?.summary || blockers[0]?.detail, anchor: (blockers[0] as any)?.anchor, constraint_key: (blockers[0] as any)?.constraint_key }
                      : (highImpact && highImpact.length > 0)
                        ? { episodeIndex: (highImpact[0] as any)?.episodeIndex, category: highImpact[0]?.category, title: highImpact[0]?.title || highImpact[0]?.objective, summary: highImpact[0]?.summary || highImpact[0]?.detail, anchor: (highImpact[0] as any)?.anchor, constraint_key: (highImpact[0] as any)?.constraint_key }
                        : null;

                    if (primaryIssue) {
                      const target = getEpisodeRepairTarget(primaryIssue, currentDoc, docContent);
                      episodicRepairMeta = {
                        repair_target_type: target.repair_target_type,
                        episode_number: target.episode_number,
                        total_episodes: target.total_episodes,
                        reason: target.reason,
                        fallback_reason: target.fallback_reason,
                        block_execution_mode: target.repair_target_type === "episode_block" ? "true_block_patch" : "full_doc_rewrite",
                      };

                      if (target.repair_target_type === "episode_block" && target.episode_number != null) {
                        episodicTargetEpisode = target.episode_number;
                        mergedDirections.push(
                          `EPISODE-TARGETED REPAIR: Focus ALL changes on Episode ${target.episode_number}. Preserve ALL other episodes EXACTLY as they are — do not modify, reorder, rename, or paraphrase any content outside Episode ${target.episode_number}.`
                        );
                        console.log(`[auto-run][Phase2D-B] episode_block_targeted: doc=${currentDoc} episode=${target.episode_number} total=${target.total_episodes} reason=${target.reason}`);
                      } else {
                        console.log(`[auto-run][Phase2D-B] episode_block_fallback: doc=${currentDoc} reason=${target.reason} fallback=${target.fallback_reason}`);
                      }
                    }
                  }
                }
              } catch (e: any) {
                console.warn(`[auto-run][Phase2D-B] episode_block_error: ${e?.message}`);
                episodicTargetEpisode = null; // fail closed
              }
            }

            // ── PHASE 2E: SCENE-LEVEL REPAIR TARGETING ──
            let sceneRepairMeta: Record<string, unknown> | null = null;
            let sceneTargetNumber: number | null = null;
            // Only attempt scene repair if episodic block repair is NOT active
            if (!episodicTargetEpisode) {
              try {
                const { isSceneRepairSupported, getSceneRepairTarget } = await import("../_shared/sceneRepairRegistry.ts");

                if (isSceneRepairSupported(currentDoc)) {
                  if (!originalFullContent) {
                    const { data: verContent } = await supabase
                      .from("project_document_versions")
                      .select("plaintext")
                      .eq("id", baselineVersionId)
                      .maybeSingle();
                    originalFullContent = verContent?.plaintext || "";
                  }

                  if (originalFullContent && originalFullContent.length > 100) {
                    const primaryIssue = (blockers && blockers.length > 0)
                      ? { scene_number: (blockers[0] as any)?.scene_number, scene_numbers: (blockers[0] as any)?.scene_numbers || (blockers[0] as any)?.target?.scene_numbers, category: blockers[0]?.category, title: blockers[0]?.title || blockers[0]?.objective, summary: blockers[0]?.summary || blockers[0]?.detail, anchor: (blockers[0] as any)?.anchor, constraint_key: (blockers[0] as any)?.constraint_key }
                      : (highImpact && highImpact.length > 0)
                        ? { scene_number: (highImpact[0] as any)?.scene_number, scene_numbers: (highImpact[0] as any)?.scene_numbers || (highImpact[0] as any)?.target?.scene_numbers, category: highImpact[0]?.category, title: highImpact[0]?.title || highImpact[0]?.objective, summary: highImpact[0]?.summary || highImpact[0]?.detail, anchor: (highImpact[0] as any)?.anchor, constraint_key: (highImpact[0] as any)?.constraint_key }
                        : null;

                    if (primaryIssue) {
                      const target = getSceneRepairTarget(primaryIssue, currentDoc, originalFullContent);
                      sceneRepairMeta = {
                        repair_target_type: target.repair_target_type,
                        scene_number: target.scene_number,
                        scene_heading: target.scene_heading,
                        total_scenes: target.total_scenes,
                        reason: target.reason,
                        fallback_reason: target.fallback_reason,
                        scene_execution_mode: target.repair_target_type === "scene" ? "true_scene_patch" : "full_doc_rewrite",
                      };

                      if (target.repair_target_type === "scene" && target.scene_number != null) {
                        sceneTargetNumber = target.scene_number;
                        mergedDirections.push(
                          `SCENE-TARGETED REPAIR: Focus ALL changes on Scene ${target.scene_number} (${target.scene_heading || ""}). Preserve ALL other scenes EXACTLY as they are — do not modify, reorder, rename, or paraphrase any content outside Scene ${target.scene_number}.`
                        );
                        console.log(`[auto-run][Phase2E] scene_repair_targeted: doc=${currentDoc} scene=${target.scene_number} heading="${target.scene_heading}" total=${target.total_scenes} reason=${target.reason}`);
                      } else {
                        console.log(`[auto-run][Phase2E] scene_repair_fallback: doc=${currentDoc} reason=${target.reason} fallback=${target.fallback_reason}`);
                      }
                    }
                  }
                }
              } catch (e: any) {
                console.warn(`[auto-run][Phase2E] scene_repair_error: ${e?.message}`);
                sceneTargetNumber = null; // fail closed
              }
            }

            // ── PHASE 2D: SECTION-LEVEL REPAIR TARGETING + TRUE PARTIAL EXECUTION ──
            let sectionRepairMeta: Record<string, unknown> | null = null;
            let sectionTargetKey: string | null = null;
            // Only attempt section repair if neither episodic block nor scene repair is active
            if (!episodicTargetEpisode && !sceneTargetNumber) {
              try {
                const { getRepairTarget } = await import("../_shared/sectionRepairEngine.ts");
                const { isSectionRepairSupported } = await import("../_shared/deliverableSectionRegistry.ts");

                if (isSectionRepairSupported(currentDoc)) {
                  if (!originalFullContent) {
                    const { data: verContent } = await supabase
                      .from("project_document_versions")
                      .select("plaintext")
                      .eq("id", baselineVersionId)
                      .maybeSingle();
                    originalFullContent = verContent?.plaintext || "";
                  }

                  if (originalFullContent && originalFullContent.length > 100) {
                    const primaryIssue = (blockers && blockers.length > 0)
                      ? { category: blockers[0]?.category, title: blockers[0]?.title || blockers[0]?.objective, summary: blockers[0]?.summary || blockers[0]?.detail }
                      : (highImpact && highImpact.length > 0)
                        ? { category: highImpact[0]?.category, title: highImpact[0]?.title || highImpact[0]?.objective, summary: highImpact[0]?.summary || highImpact[0]?.detail }
                        : null;

                    if (primaryIssue) {
                      const target = getRepairTarget(primaryIssue, currentDoc, originalFullContent);
                      sectionRepairMeta = {
                        repair_target_type: target.repair_target_type,
                        section_key: target.section_key,
                        section_label: target.section_label,
                        reason: target.reason,
                        fallback_reason: target.fallback_reason,
                        section_execution_mode: target.repair_target_type === "section" ? "true_partial_patch" : "full_doc_rewrite",
                      };

                      if (target.repair_target_type === "section" && target.section_key) {
                        sectionTargetKey = target.section_key;
                        mergedDirections.push(
                          `SECTION-TARGETED REPAIR: Focus ALL changes on the "${target.section_label || target.section_key}" section. Preserve ALL other sections EXACTLY as they are — do not modify, reorder, rename, or paraphrase any content outside this section.`
                        );
                        console.log(`[auto-run][Phase2D] section_repair_targeted: doc=${currentDoc} section=${target.section_key} mode=true_partial_patch reason=${target.reason}`);
                      } else {
                        console.log(`[auto-run][Phase2D] section_repair_fallback: doc=${currentDoc} reason=${target.reason} fallback=${target.fallback_reason}`);
                      }
                    }
                  }
                }
              } catch (e: any) {
                console.warn(`[auto-run][Phase2D] section_repair_error: ${e?.message}`);
                sectionTargetKey = null; // fail closed
              }
            }

            // ── SINGLE CANDIDATE PATH (all other strategies) ──
            // Use frontier as input if available; compare against BASELINE
            const singleInputVersionId = (job as any).frontier_version_id ?? baselineVersionId;
            const { candidateVersionId } = await rewriteWithFallback(
              supabase, supabaseUrl, token, {
                projectId: job.project_id,
                documentId: doc.id,
                versionId: singleInputVersionId,
                approvedNotes: strategyNotes,
                protectItems,
                deliverableType: currentDoc,
                developmentBehavior: behavior,
                format,
                episode_target_duration_seconds: episodeDuration,
                season_episode_count: seasonEpisodeCount,
                globalDirections: mergedDirections.length > 0 ? mergedDirections : undefined,
              }, jobId, newStep + 2, format, currentDoc
            );

            // ── PHASE 2D-B: TRUE EPISODIC BLOCK PATCH EXECUTION ──
            // After rewrite, if episode targeting was active, enforce episode-block integrity:
            // Merge only the target episode from rewritten output; preserve all others from original.
            if (episodicTargetEpisode != null && originalFullContent && candidateVersionId) {
              try {
                const { enforceEpisodeBlockIntegrity } = await import("../_shared/episodicBlockRegistry.ts");

                const { data: candidateVer } = await supabase
                  .from("project_document_versions")
                  .select("plaintext")
                  .eq("id", candidateVersionId)
                  .maybeSingle();

                const rewrittenContent = candidateVer?.plaintext || "";
                if (rewrittenContent.length > 0) {
                  const integrity = enforceEpisodeBlockIntegrity(originalFullContent, rewrittenContent, episodicTargetEpisode);

                  if (integrity.ok && integrity.target_episode_found) {
                    // Write the deterministically merged content
                    await supabase.from("project_document_versions")
                      .update({ plaintext: integrity.merged_content })
                      .eq("id", candidateVersionId);

                    console.log(`[auto-run][Phase2D-B] episode_integrity_enforced: target_ep=${episodicTargetEpisode} preserved=${integrity.episodes_preserved} corrected=${integrity.episodes_corrected} reason=${integrity.reason}`);
                  } else if (integrity.target_episode_found) {
                    // Integrity issues but target was found — still use merged content as best effort
                    await supabase.from("project_document_versions")
                      .update({ plaintext: integrity.merged_content })
                      .eq("id", candidateVersionId);

                    console.warn(`[auto-run][Phase2D-B] episode_integrity_partial: target_ep=${episodicTargetEpisode} missing=${integrity.episodes_missing.join(",")} reason=${integrity.reason}`);
                  } else {
                    // Target episode not found — fall back to full rewrite (don't replace)
                    console.warn(`[auto-run][Phase2D-B] episode_integrity_fallback: target_ep=${episodicTargetEpisode} not found in rewritten output`);
                  }

                  if (episodicRepairMeta) {
                    episodicRepairMeta.episodes_preserved = integrity.episodes_preserved;
                    episodicRepairMeta.episodes_corrected = integrity.episodes_corrected;
                    episodicRepairMeta.episodes_missing = integrity.episodes_missing;
                    episodicRepairMeta.integrity_ok = integrity.ok;
                    episodicRepairMeta.target_episode_found = integrity.target_episode_found;
                  }
                }
              } catch (integrityErr: any) {
                console.warn(`[auto-run][Phase2D-B] episode_integrity_error: ${integrityErr?.message}`);
                if (episodicRepairMeta) {
                  episodicRepairMeta.integrity_ok = false;
                  episodicRepairMeta.integrity_error = integrityErr?.message;
                }
              }
            }

            // ── PHASE 2E: TRUE SCENE-LEVEL PATCH EXECUTION ──
            // After rewrite, if scene targeting was active, enforce scene integrity:
            // Take only the target scene from rewritten output; preserve all others from original.
            if (sceneTargetNumber != null && originalFullContent && candidateVersionId) {
              try {
                const { enforceSceneIntegrity } = await import("../_shared/sceneRepairRegistry.ts");

                const { data: candidateVer } = await supabase
                  .from("project_document_versions")
                  .select("plaintext")
                  .eq("id", candidateVersionId)
                  .maybeSingle();

                const rewrittenContent = candidateVer?.plaintext || "";
                if (rewrittenContent.length > 0) {
                  const integrity = enforceSceneIntegrity(originalFullContent, rewrittenContent, sceneTargetNumber);

                  if (integrity.target_scene_found) {
                    // Write the deterministically merged content
                    await supabase.from("project_document_versions")
                      .update({ plaintext: integrity.merged_content })
                      .eq("id", candidateVersionId);

                    console.log(`[auto-run][Phase2E] scene_integrity_enforced: target_scene=${sceneTargetNumber} preserved=${integrity.scenes_preserved} corrected=${integrity.scenes_corrected} ok=${integrity.ok} reason=${integrity.reason}`);
                  } else {
                    // Target scene not found — fall back (don't replace)
                    console.warn(`[auto-run][Phase2E] scene_integrity_fallback: target_scene=${sceneTargetNumber} not found in rewritten output`);
                  }

                  if (sceneRepairMeta) {
                    sceneRepairMeta.scenes_preserved = integrity.scenes_preserved;
                    sceneRepairMeta.scenes_corrected = integrity.scenes_corrected;
                    sceneRepairMeta.scenes_missing_from_rewrite = integrity.scenes_missing_from_rewrite;
                    sceneRepairMeta.integrity_ok = integrity.ok;
                    sceneRepairMeta.target_scene_found = integrity.target_scene_found;
                  }
                }
              } catch (integrityErr: any) {
                console.warn(`[auto-run][Phase2E] scene_integrity_error: ${integrityErr?.message}`);
                if (sceneRepairMeta) {
                  sceneRepairMeta.integrity_ok = false;
                  sceneRepairMeta.integrity_error = integrityErr?.message;
                }
              }
            }

            // After rewrite, if section targeting was active, enforce section integrity:
            // Replace untouched sections with original verbatim content to guarantee preservation.
            if (sectionTargetKey && originalFullContent && candidateVersionId) {
              try {
                const { parseSections, replaceSection: replaceSec } = await import("../_shared/sectionRepairEngine.ts");

                const { data: candidateVer } = await supabase
                  .from("project_document_versions")
                  .select("plaintext")
                  .eq("id", candidateVersionId)
                  .maybeSingle();

                const rewrittenContent = candidateVer?.plaintext || "";
                if (rewrittenContent.length > 0) {
                  const originalSections = parseSections(originalFullContent, currentDoc);
                  const rewrittenSections = parseSections(rewrittenContent, currentDoc);

                  const targetInRewritten = rewrittenSections.find(s => s.section_key === sectionTargetKey);

                  if (targetInRewritten && originalSections.length >= 2 && rewrittenSections.length >= 2) {
                    let mergedContent = rewrittenContent;
                    let sectionsPreserved = 0;
                    let sectionsCorrected = 0;

                    for (const origSec of originalSections) {
                      if (origSec.section_key === sectionTargetKey || origSec.section_key === "__preamble") continue;
                      const rewrittenSec = rewrittenSections.find(s => s.section_key === origSec.section_key);
                      if (!rewrittenSec) continue;
                      if (rewrittenSec.content.trim() !== origSec.content.trim()) {
                        const result = replaceSec(mergedContent, currentDoc, origSec.section_key, origSec.content);
                        if (result.success) {
                          mergedContent = result.new_content;
                          sectionsCorrected++;
                        }
                      } else {
                        sectionsPreserved++;
                      }
                    }

                    if (sectionsCorrected > 0) {
                      await supabase.from("project_document_versions")
                        .update({ plaintext: mergedContent })
                        .eq("id", candidateVersionId);
                      console.log(`[auto-run][Phase2D] section_integrity_enforced: corrected=${sectionsCorrected} preserved=${sectionsPreserved} target=${sectionTargetKey}`);
                    } else {
                      console.log(`[auto-run][Phase2D] section_integrity_clean: all_preserved=${sectionsPreserved} target=${sectionTargetKey}`);
                    }

                    if (sectionRepairMeta) {
                      sectionRepairMeta.sections_corrected = sectionsCorrected;
                      sectionRepairMeta.sections_preserved = sectionsPreserved;
                      sectionRepairMeta.integrity_enforced = sectionsCorrected > 0;
                    }
                  } else {
                    console.warn(`[auto-run][Phase2D] section_integrity_skip: target_found=${!!targetInRewritten} orig_sections=${originalSections.length} rewritten_sections=${rewrittenSections.length}`);
                    if (sectionRepairMeta) {
                      sectionRepairMeta.integrity_enforced = false;
                      sectionRepairMeta.integrity_skip_reason = "target_not_found_or_insufficient_sections";
                    }
                  }
                }
              } catch (integrityErr: any) {
                console.warn(`[auto-run][Phase2D] section_integrity_error: ${integrityErr?.message}`);
                if (sectionRepairMeta) {
                  sectionRepairMeta.integrity_enforced = false;
                  sectionRepairMeta.integrity_error = integrityErr?.message;
                }
              }
            }

            // Log episodic block repair metadata for provenance
            if (episodicRepairMeta) {
              await logStep(supabase, jobId, null, currentDoc, "episode_block_repair_execution",
                `Episode block repair: ${episodicRepairMeta.repair_target_type} [ep=${episodicRepairMeta.episode_number || "none"}] exec=${episodicRepairMeta.block_execution_mode} preserved=${episodicRepairMeta.episodes_preserved || 0}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                episodicRepairMeta);
            }

            // Log scene repair metadata for provenance
            if (sceneRepairMeta) {
              await logStep(supabase, jobId, null, currentDoc, "scene_repair_execution",
                `Scene repair: ${sceneRepairMeta.repair_target_type} [scene=${sceneRepairMeta.scene_number || "none"}] exec=${sceneRepairMeta.scene_execution_mode} preserved=${sceneRepairMeta.scenes_preserved || 0} corrected=${sceneRepairMeta.scenes_corrected || 0}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                sceneRepairMeta);
            }

            if (sectionRepairMeta) {
              await logStep(supabase, jobId, null, currentDoc, "section_repair_execution",
                `Section repair: ${sectionRepairMeta.repair_target_type} [${sectionRepairMeta.section_key || "full_doc"}] exec=${sectionRepairMeta.section_execution_mode} corrected=${sectionRepairMeta.sections_corrected || 0}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                sectionRepairMeta);
            }

            // ── Clear canon_lock_mode AFTER successful rewrite ──
            if (canonLockWasApplied) {
              const postRewriteMeta = { ...(job as any).meta_json || {}, canon_lock_mode: false, canon_lock_applied_at_step: newStep + 2 };
              await updateJob(supabase, jobId, { meta_json: postRewriteMeta });
              console.log(`[auto-run] Canon-lock cleared after successful rewrite (attempt_id=${canonLockAttemptId}, applied_at_step=${newStep + 2})`);
            }

            if (!candidateVersionId || candidateVersionId === baselineVersionId) {
              // ── FAIL CLOSED: no candidate produced ──
              await logStep(supabase, jobId, null, currentDoc, "rewrite_no_candidate",
                `Rewrite did not produce a new version id (attempt ${attemptNumber}, ${strategy}). Baseline preserved. Halting.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { baselineVersionId, singleInputVersionId, reason: "CANDIDATE_ID_MISSING", loopCount: newLoopCount, attemptNumber, strategy });
              // CAS-protected pause: only apply if step_count hasn't advanced (prevents stale pause on concurrent progress)
              const casStepCount = job.step_count;
              const { data: casRow } = await supabase.from("auto_run_jobs")
                .update({
                  stage_loop_count: newLoopCount,
                  follow_latest: false,
                  resume_document_id: doc.id,
                  resume_version_id: baselineVersionId,
                  last_ci: baselineCI,
                  last_gp: baselineGP,
                  status: "paused",
                  pause_reason: "CANDIDATE_ID_MISSING",
                  stop_reason: "Rewrite produced no candidate version id; refusing to promote or continue.",
                })
                .eq("id", jobId)
                .eq("status", "running")
                .eq("step_count", casStepCount)
                .select("id")
                .maybeSingle();
              if (!casRow) {
                console.warn(`[IEL] CANDIDATE_ID_MISSING pause CAS failed (job progressed past step_count=${casStepCount}). Skipping stale pause.`);
              }
              return respondWithJob(supabase, jobId);
            }

            // Stamp criteria on new candidate version
            if (candidateVersionId) {
              const candText = await supabase.from("project_document_versions").select("plaintext").eq("id", candidateVersionId).maybeSingle();
              const candMeasured = estimateDurationSeconds(candText?.data?.plaintext || "");
              await supabase.from("project_document_versions").update({
                criteria_hash: currentCriteriaHash,
                criteria_json: latestCriteriaSnapshot,
                measured_metrics_json: { measured_duration_seconds: candMeasured, estimated_at: new Date().toISOString(), estimator: 'edge_deterministic' },
              }).eq("id", candidateVersionId);
            }

            await logStep(supabase, jobId, null, currentDoc, "rewrite_candidate_created",
              `Candidate ${candidateVersionId} created (attempt ${attemptNumber}, ${strategy}). Input=${singleInputVersionId}. Scoring before acceptance.`,
              { ci: baselineCI, gp: baselineGP }, undefined,
              { baselineVersionId, singleInputVersionId, candidateVersionId, attemptNumber, strategy });

            // ── POST-REWRITE SCORING (MANDATORY — fail closed) ──
            const candScore = await scoreCandidate(candidateVersionId, "single");
            if (!candScore) {
              await logStep(supabase, jobId, null, currentDoc, "post_score_failed",
                `Post-rewrite scoring failed (attempt ${attemptNumber}, ${strategy}). Candidate rejected. Baseline preserved.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { baselineVersionId, candidateVersionId, attemptNumber, strategy });
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                follow_latest: false,
                resume_document_id: doc.id,
                resume_version_id: baselineVersionId,
                last_ci: baselineCI,
                last_gp: baselineGP,
                pause_reason: "POST_SCORE_FAILED",
                status: "paused",
                stop_reason: `Post-rewrite scoring failed. Baseline version preserved.`,
              });
              return respondWithJob(supabase, jobId);
            }

            const candidateCI = candScore.ci;
            const candidateGP = candScore.gp;
            const candidateBlockerCount = candScore.blockerCount;

            await logStep(supabase, jobId, null, currentDoc, "rewrite_candidate_scored",
              `Candidate scored: CI=${candidateCI}, GP=${candidateGP}, blockers=${candidateBlockerCount} (baseline CI=${baselineCI}, GP=${baselineGP}, blockers=${blockersCount}). Blockers ${candidateBlockerCount < blockersCount ? 'improved ✓' : candidateBlockerCount === blockersCount ? 'unchanged' : 'worsened ✗'}`,
              { ci: candidateCI, gp: candidateGP }, undefined,
              { baselineVersionId, singleInputVersionId, candidateVersionId, baselineCI, baselineGP, candidateCI, candidateGP,
                blocker_count_before: blockersCount, blocker_count_after: candidateBlockerCount, blockers_improved: candidateBlockerCount < blockersCount,
                attemptNumber, strategy });

            // ── THREE-WAY ACCEPTANCE GATE ──
            const { decision: gateDecision, ciDrop, gpDrop, worstDrop } = threeWayGate(candidateCI, candidateGP);

            await logStep(supabase, jobId, null, currentDoc, "gate_decision",
              `Gate: ${gateDecision} | CI ${baselineCI}→${candidateCI} (drop ${ciDrop}), GP ${baselineGP}→${candidateGP} (drop ${gpDrop}) | blockers ${blockersCount}→${candidateBlockerCount} | PROMOTE_DELTA=${REGRESSION_THRESHOLD}, EXPLORE_DELTA=${EXPLORE_THRESHOLD}`,
              { ci: candidateCI, gp: candidateGP }, undefined,
              { decision: gateDecision, ciDrop, gpDrop, worstDrop, REGRESSION_THRESHOLD, EXPLORE_THRESHOLD,
                blocker_count_before: blockersCount, blocker_count_after: candidateBlockerCount, blockers_improved: candidateBlockerCount < blockersCount,
                hasBlockers, attemptNumber, strategy });

            if (gateDecision === "PROMOTE") {
              // ── PROMOTE: candidate passed tight threshold — change is_current ──
              const promoted = await promoteCandidate(
                candidateVersionId,
                candidateCI,
                candidateGP,
                { baselineVersionId, singleInputVersionId, candidateVersionId, baselineCI, baselineGP, candidateCI, candidateGP, ciDrop, gpDrop },
                candidateBlockerCount
              );
              if (!promoted) {
                return respondWithJob(supabase, jobId);
              }
              return respondWithJob(supabase, jobId, "run-next");
            }

            if (gateDecision === "EXPLORE") {
              // ── EXPLORE: quality search — set frontier, do NOT change is_current ──
              // Read persisted frontier state for deterministic attempt counting
              const { data: freshJobSingle } = await supabase
                .from("auto_run_jobs")
                .select("frontier_attempts")
                .eq("id", jobId)
                .maybeSingle();
              const frontierAttempts = freshJobSingle?.frontier_attempts ?? 0;
              if (frontierAttempts < MAX_FRONTIER_ATTEMPTS) {
                await setFrontier(candidateVersionId, candidateCI, candidateGP,
                  { baselineVersionId, singleInputVersionId, candidateVersionId, baselineCI, baselineGP, candidateCI, candidateGP, ciDrop, gpDrop, worstDrop });
                return respondWithJob(supabase, jobId, "run-next");
              }
              // Frontier exhausted — clear and reject
              await logStep(supabase, jobId, null, currentDoc, "frontier_cleared",
                `Frontier exhausted after ${frontierAttempts} attempts (max ${MAX_FRONTIER_ATTEMPTS}). Clearing frontier, returning to baseline.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { frontierAttempts, MAX_FRONTIER_ATTEMPTS, candidateVersionId, candidateCI, candidateGP });
              await updateJob(supabase, jobId, {
                frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
              });
              // Fall through to REJECT behavior
            }

            // ── REJECT: candidate regressed beyond explore threshold ──
            await logStep(supabase, jobId, null, currentDoc, "rewrite_rejected_regression",
              `Candidate rejected (attempt ${attemptNumber}, ${strategy}): CI ${baselineCI}→${candidateCI} (drop ${ciDrop}), GP ${baselineGP}→${candidateGP} (drop ${gpDrop}). worstDrop=${worstDrop}, PROMOTE_DELTA=${REGRESSION_THRESHOLD}, EXPLORE_DELTA=${EXPLORE_THRESHOLD}. Baseline preserved.`,
              { ci: baselineCI, gp: baselineGP }, undefined,
              { baselineVersionId, candidateVersionId, baselineCI, baselineGP, candidateCI, candidateGP, ciDrop, gpDrop, worstDrop, REGRESSION_THRESHOLD, EXPLORE_THRESHOLD, attemptNumber, strategy });

            const shouldHalt = newLoopCount >= job.max_stage_loops;
            await updateJob(supabase, jobId, {
              stage_loop_count: newLoopCount,
              follow_latest: false,
              resume_document_id: doc.id,
              resume_version_id: baselineVersionId,
              last_ci: baselineCI,
              last_gp: baselineGP,
              ...(shouldHalt ? {
                status: "paused",
                pause_reason: "REGRESSION_MAX_ATTEMPTS",
                stop_reason: `Rewrite rejected ${newLoopCount} times due to score regression. Manual review required.`,
              } : {}),
            });
            return respondWithJob(supabase, jobId, shouldHalt ? undefined : "run-next");
          } catch (e: any) {
            // ── CANON_MISMATCH RETRY GATE ──
            // If CANON_MISMATCH, retry with canon entity injection instead of failing.
            // EXCEPTION: when allow_defaults=true, canon is advisory only — skip retry loop,
            // log as warning, and continue. Entity injection hurts quality more than it helps
            // when the project canon is sparse or manually seeded.
            if (e.message?.includes("CANON_MISMATCH")) {
              if (job.allow_defaults === true) {
                await logStep(supabase, jobId, null, currentDoc, "canon_mismatch_advisory",
                  `CANON_MISMATCH suppressed in autonomous mode (allow_defaults=true) — treating as advisory, not blocking`,
                  { ci: baselineCI, gp: baselineGP });
                return respondWithJob(supabase, jobId, "run-next");
              }
              const MAX_CANON_LOCK_RETRIES = 4;
              const metaJson = (job as any).meta_json || {};
              const canonRetries = metaJson.canon_mismatch_retries || {};
              const retryCount = (canonRetries[currentDoc] || 0) + 1;

              if (retryCount <= MAX_CANON_LOCK_RETRIES) {
                // ── CANON-LOCK: fetch + normalize + prioritize canonical entities ──
                let canonEntityPack: string[] = [];
                let coreEntities: string[] = [];
                let secondaryEntities: string[] = [];
                try {
                  const canonData = await buildCanonEntitiesFromDB(supabase, job.project_id);
                  const rawEntities = canonData?.entities || [];
                  canonEntityPack = normalizeCanonEntities(rawEntities);
                  const prioritized = prioritizeCanonEntities(canonEntityPack);
                  coreEntities = prioritized.core;
                  secondaryEntities = prioritized.secondary;
                  console.log(`[auto-run] Canon entity normalization: raw=${rawEntities.length} -> normalized=${canonEntityPack.length}, core=${coreEntities.length}, secondary=${secondaryEntities.length}`);
                } catch (ce: any) {
                  console.warn(`[auto-run] canon entity fetch failed for retry: ${ce.message}`);
                }

                const attemptId = (metaJson.canon_lock_attempt_id || 0) + 1;
                // Log the retry with entity counts + attempt_id
                await logStep(supabase, jobId, null, currentDoc, "canon_lock_retry",
                  `CANON_MISMATCH retry ${retryCount}/${MAX_CANON_LOCK_RETRIES} (core=${coreEntities.length}, secondary=${secondaryEntities.length}, attempt_id=${attemptId}): ${e.message.slice(0, 200)}`,
                  { ci: baselineCI, gp: baselineGP }, undefined,
                  { retry_count: retryCount, max_retries: MAX_CANON_LOCK_RETRIES, entity_count: canonEntityPack.length, core_count: coreEntities.length, secondary_count: secondaryEntities.length, attempt_id: attemptId, error_excerpt: e.message.slice(0, 300), doc_type: currentDoc });

                // Persist retry counter + normalized entity pack for injection
                const updatedRetries = { ...canonRetries, [currentDoc]: retryCount };
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  meta_json: {
                    ...metaJson,
                    canon_mismatch_retries: updatedRetries,
                    canon_lock_core_entities: coreEntities,
                    canon_lock_secondary_entities: secondaryEntities,
                    canon_lock_entities: canonEntityPack,
                    canon_lock_mode: true,
                    canon_lock_attempt_id: attemptId,
                  },
                });

                // Continue — next iteration picks up canon_lock_mode from meta_json
                return respondWithJob(supabase, jobId, "run-next");
              }

              // Exhausted retries — pause with specific reason
              await logStep(supabase, jobId, null, currentDoc, "canon_mismatch_stuck",
                `CANON_MISMATCH stuck after ${retryCount - 1} retries: ${e.message.slice(0, 200)}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { retry_count: retryCount - 1, max_retries: MAX_CANON_LOCK_RETRIES, error_excerpt: e.message.slice(0, 300) });
              await updateJob(supabase, jobId, {
                status: "paused",
                pause_reason: "canon_mismatch_stuck",
                stop_reason: `Canon alignment failed after ${MAX_CANON_LOCK_RETRIES} retries for ${currentDoc}. ${e.message.slice(0, 200)}`,
                error: e.message.slice(0, 500),
                stage_loop_count: newLoopCount,
              });
              return respondWithJob(supabase, jobId);
            }

            await updateJob(supabase, jobId, { status: "failed", error: `Rewrite failed: ${e.message}` });
            return respondWithJob(supabase, jobId);
          }
        }

        // ── PROMOTE ──
        if (promo.recommendation === "promote") {
          // ── CI HARD GATE: no promotion unless CI meets job target (default 90) ──
          const writeTargetCi = resolveTargetCI(job);
          const ciGate = await evaluateCIGate(supabase, jobId, currentDoc, writeTargetCi, job.project_id, job);
          console.log(`[auto-run][IEL] ci_gate_eval { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciGate.ci}, min_ci: ${writeTargetCi}, rule: "promote_gate_writing" }`);
          if (!ciGate.pass) {
            console.warn(`[auto-run][IEL] ci_gate_blocked_promote { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciGate.ci}, min_ci: ${writeTargetCi}, trigger: "promote_writing" }`);
            await logStep(supabase, jobId, null, currentDoc, "ci_gate_blocked",
              `Promotion blocked: CI=${ciGate.ci} < ${writeTargetCi}. Continuing stabilise despite readiness ${promo.readiness_score}.`,
              { ci: ciGate.ci, gp }, undefined, { min_ci: writeTargetCi, readiness: promo.readiness_score, trigger: "promote_writing" });
            await updateJob(supabase, jobId, { stage_loop_count: stageLoopCount + 1 });
            return respondWithJob(supabase, jobId, "run-next");
          }
          console.log(`[auto-run][IEL] ci_gate_passed { job_id: "${jobId}", doc_type: "${currentDoc}", ci: ${ciGate.ci} }`);

          const modeConf = MODE_CONFIG[job.mode] || MODE_CONFIG.balanced;
          if (modeConf.require_readiness && promo.readiness_score < modeConf.require_readiness) {
            await updateJob(supabase, jobId, { stage_loop_count: stageLoopCount + 1 });
            await logStep(supabase, jobId, null, currentDoc, "stabilise", `Readiness ${promo.readiness_score} < ${modeConf.require_readiness} (premium threshold)`);
            return respondWithJob(supabase, jobId, "run-next");
          }

          // ── IEL: ACTIONABLE NOTE EXHAUSTION GATE (writing promote path) ──
          const writeNoteExhaust = await checkActionableNoteExhaustion(supabase, job.project_id, currentDoc, latestVersion?.id || null);
          if (writeNoteExhaust.hasActionable) {
            console.warn(`[auto-run][IEL] note_exhaustion_blocked_promote { job_id: "${jobId}", doc_type: "${currentDoc}", actionable_notes: ${writeNoteExhaust.count}, path: "writing_promote" }`);
            await logStep(supabase, jobId, null, currentDoc, "note_exhaustion_blocked",
              `Promotion blocked: ${writeNoteExhaust.count} actionable note(s) remain for ${currentDoc}. Continuing stabilise.`,
              { ci: ciGate.ci, gp }, undefined,
              { actionable_count: writeNoteExhaust.count, trigger: "writing_promote" });
            await updateJob(supabase, jobId, { stage_loop_count: stageLoopCount + 1 });
            return respondWithJob(supabase, jobId, "run-next");
          }

          const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document, job.allow_defaults, job.user_id, jobId);
          if (next && isStageAtOrBeforeTarget(next, job.target_document, format)) {
            if (job.allow_defaults) {
              // Full Autopilot: auto-approve and promote without pausing
              try {
                await supabase.from("project_document_versions").update({
                  approval_status: "approved",
                  approved_at: new Date().toISOString(),
                  approved_by: job.user_id,
                }).eq("id", latestVersion.id);
              } catch (e: any) {
                console.warn("[auto-run] non-fatal auto-approve failed before promote:", e?.message || e);
              }
              await logStep(supabase, jobId, null, currentDoc, "auto_approved_promote",
                `Promote recommended: ${currentDoc} → ${next}. Auto-promoting (allow_defaults). CI=${ciGate.ci}≥${writeTargetCi}✓`,
                { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence },
                undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
              );
              await updateJob(supabase, jobId, {
                current_document: next,
                stage_loop_count: 0,
                stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
                status: "running",
                stop_reason: null,
                awaiting_approval: false,
                approval_type: null,
                pending_doc_id: null,
                pending_version_id: null,
                pending_doc_type: null,
                pending_next_doc_type: null,
                // Clear frontier on stage change (best_* is global, preserved)
                frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
              });
              console.log(`[auto-run][IEL] stage_transition { job_id: "${jobId}", from: "${currentDoc}", to: "${next}", best_preserved: true, trigger: "auto_approved_promote_writing" }`);
              return respondWithJob(supabase, jobId, "run-next");
            }
            // ── APPROVAL GATE: pause before promoting to next stage ──
            await logStep(supabase, jobId, null, currentDoc, "approval_required",
              `Promote recommended: ${currentDoc} → ${next}. Review before advancing.`,
              { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence },
              undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
            );
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: `Approval required: review ${currentDoc} before promoting to ${next}`,
              awaiting_approval: true, approval_type: "promote",
              pending_doc_id: doc.id, pending_version_id: latestVersion.id,
              pending_doc_type: currentDoc, pending_next_doc_type: next,
            });
            return respondWithJob(supabase, jobId, "awaiting-approval");
          } else {
            await updateJob(supabase, jobId, { status: "completed", stop_reason: "All stages satisfied up to target" });
            await logStep(supabase, jobId, null, currentDoc, "stop", "All stages satisfied up to target");
            return respondWithJob(supabase, jobId);
          }
        }
       } catch (e: any) {
        console.error("[auto-run] dev-engine analyze (bg) ERROR", e?.message || e);
        if (isUpstreamOutage(e)) {
          // ── 502/503: retry up to 3 times with exponential backoff before pausing ──
          const MAX_RETRIES = 3;
          const RETRY_DELAYS = [5000, 15000, 30000];
          let retried = false;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            console.log(`[auto-run] DEV_ENGINE_UNAVAILABLE retry ${attempt + 1}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt]}ms`);
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            try {
              // Re-check job status — user may have stopped it during retry wait
              const { data: checkJob } = await supabase.from("auto_run_jobs").select("status").eq("id", jobId).maybeSingle();
              if (!checkJob || checkJob.status !== "running") {
                console.log("[auto-run] job no longer running during retry, aborting retry loop");
                retried = true; // Don't fall through to pause
                break;
              }
              // Attempt self-chain to retry the step
              const selfUrl = `${supabaseUrl}/functions/v1/auto-run`;
              const retryResp = await fetch(selfUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                body: JSON.stringify({ action: "run-next", jobId }),
              });
              if (retryResp.ok) {
                console.log(`[auto-run] DEV_ENGINE_UNAVAILABLE retry ${attempt + 1} succeeded`);
                retried = true;
                break;
              }
            } catch (retryErr: any) {
              console.warn(`[auto-run] DEV_ENGINE_UNAVAILABLE retry ${attempt + 1} failed:`, retryErr?.message);
            }
          }
          if (!retried) {
            // All retries exhausted — pause with clear reason
            const errStep = await nextStepIndex(supabase, jobId);
            const compactErr = `DEV_ENGINE_UNAVAILABLE (${e.status || '?'}): ${(e.message || '').slice(0, 300)} [after ${MAX_RETRIES} retries]`;
            await updateJob(supabase, jobId, {
              status: "paused",
              stop_reason: "DEV_ENGINE_UNAVAILABLE",
              error: compactErr.slice(0, 500),
              awaiting_approval: false,
              approval_type: null,
            });
            await logStep(supabase, jobId, errStep, currentDoc, "dev_engine_unavailable",
              compactErr.slice(0, 500));
          }
        } else {
          const errIdx = await nextStepIndex(supabase, jobId);
          await updateJob(supabase, jobId, { status: "failed", error: `Step failed: ${(e.message || '').slice(0, 500)}` });
          await logStep(supabase, jobId, errIdx, currentDoc, "stop", `Error: ${(e.message || '').slice(0, 500)}`);
        }
       } finally {
        // ── ALWAYS release the processing lock ──
        await releaseProcessingLock(supabase, jobId);

        // ── SELF-CHAIN: if job is still running and not awaiting approval,
        // fire the next step immediately instead of relying on client polling.
        try {
          const { data: postJob } = await supabase
            .from("auto_run_jobs")
            .select("status, awaiting_approval, is_processing, step_count, max_total_steps")
            .eq("id", jobId)
            .maybeSingle();
          if (postJob && postJob.status === "running" && !postJob.awaiting_approval && !postJob.is_processing) {
            // Guard: don't chain if step budget exhausted
            if (postJob.step_count < postJob.max_total_steps) {
              console.log("[auto-run] self-chaining run-next after bg task", { jobId, step: postJob.step_count, max: postJob.max_total_steps });
              const selfUrl = `${supabaseUrl}/functions/v1/auto-run`;
              const chainPromise = fetch(selfUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${serviceKey}`,
                },
                body: JSON.stringify({ action: "run-next", jobId }),
              }).then((r: Response) => {
                if (!r.ok) console.error("[auto-run] self-chain HTTP error", { status: r.status, jobId });
                else console.log("[auto-run] self-chain success", { jobId, status: r.status });
              }).catch((e: any) => console.error("[auto-run] self-chain fetch failed", { jobId, error: e?.message }));
              // Track the chain fetch in waitUntil so isolate stays alive
              waitUntilSafe(chainPromise);
            } else {
              console.log("[auto-run] self-chain skipped: step budget exhausted", { jobId, step: postJob.step_count, max: postJob.max_total_steps });
            }
          }
        } catch (chainErr: any) {
          console.error("[auto-run] self-chain check failed", chainErr?.message);
        }
       }
      })(); // end bgTask

      // bgTask now owns the lock — mark so outer finally doesn't release
      bgTaskSpawned = true;

      // Attempt non-blocking background execution
      const scheduled = waitUntilSafe(bgTask);

      if (scheduled) {
        console.log("[auto-run] run-next returning early (bg scheduled via waitUntil)", { jobId });
      } else {
        // No waitUntil available — fire-and-forget; bgTask writes to DB,
        // polling client will pick up results. Catch errors so unhandled
        // rejection doesn't crash the isolate.
        bgTask.catch((e: any) => console.error("[auto-run] bgTask unhandled", e?.message || e));
        console.log("[auto-run] run-next returning early (fire-and-forget, no waitUntil)", { jobId });
      }
      // Always return immediately — heavy work continues in background
      return respondWithJob(supabase, jobId);
      } finally {
        // Only release lock if bgTask was NOT spawned.
        // If bgTask was spawned, it owns the lock and releases in its own finally.
        if (!bgTaskSpawned) {
          await releaseProcessingLock(supabase, jobId);
        }
      }
    }

    return respond({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    return jsonRes(
      {
        error: e?.message || "Internal error",
        stack_hint: e?.stack ? String(e.stack).split("\n")[0] : undefined,
      },
      500,
    );
  }
});

// ── Response Helpers ──

function jsonRes(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const respond = jsonRes;

async function respondWithJob(supabase: any, jobId: string, hint?: string): Promise<Response> {
  const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
  const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", jobId).order("step_index", { ascending: false }).limit(200);

  // ── Retro-enrich legacy pending_decisions (id-only payloads from before enrichment patch) ──
  if (job && job.pause_reason === "pending_decisions" && Array.isArray(job.pending_decisions) && job.pending_decisions.length > 0) {
    const needsEnrichment = job.pending_decisions.some((d: any) => !d.question && !d.options);
    if (needsEnrichment) {
      const legacyCount = job.pending_decisions.filter((d: any) => !d.question && !d.options).length;
      console.log(`[auto-run][IEL] pending_decisions_legacy_detected`, JSON.stringify({
        job_id: jobId, doc_type: job.current_document, count: job.pending_decisions.length, legacy_count: legacyCount,
      }));
      try {
        const idsToFetch = job.pending_decisions
          .filter((d: any) => !d.question && !d.options && d.id)
          .map((d: any) => d.id);
        if (idsToFetch.length > 0) {
          const { data: fullRows, error: fetchErr } = await supabase
            .from("decision_ledger")
            .select("id, decision_key, title, decision_text, decision_value")
            .in("id", idsToFetch);
          if (fetchErr) {
            console.error(`[auto-run][IEL] pending_decisions_enrich_failed`, JSON.stringify({ job_id: jobId, error: fetchErr.message }));
          } else {
            const rowMap = new Map((fullRows || []).map((r: any) => [r.id, r]));
            const enriched = job.pending_decisions.map((d: any) => {
              if (d.question && d.options) return d; // already enriched
              const row = rowMap.get(d.id);
              if (!row) {
                return {
                  ...d,
                  question: "Decision details unavailable (missing decision_ledger row)",
                  options: [],
                  reason: "MISSING_DECISION_LEDGER_ROW",
                };
              }
              const dv = row.decision_value || {};
              return {
                ...d,
                question: dv.question || row.title || row.decision_text || `Decision required: ${row.decision_key}`,
                options: Array.isArray(dv.options) ? dv.options : [],
                recommended: dv.recommendation?.value || null,
                decision_key: row.decision_key,
                classification: dv.classification || "BLOCKING_NOW",
                reason: row.decision_text || dv.question || null,
                provenance: dv.provenance || null,
                scope_json: dv.scope_json || null,
              };
            });
            // NOTE: Legacy enrichment write kept for backward compat with pre-enrichment jobs.
            // TODO: Move to a dedicated action handler to make respondWithJob fully read-only.
            await supabase.from("auto_run_jobs").update({ pending_decisions: enriched }).eq("id", jobId);
            job.pending_decisions = enriched;
            console.log(`[auto-run][IEL] pending_decisions_enriched`, JSON.stringify({
              job_id: jobId, enriched_count: idsToFetch.length,
              missing_rows: idsToFetch.filter((id: string) => !rowMap.has(id)),
              option_counts: enriched.map((d: any) => (d.options || []).length),
            }));
          }
        }
      } catch (e: any) {
        console.error(`[auto-run][IEL] pending_decisions_enrich_failed`, JSON.stringify({ job_id: jobId, error: e?.message }));
      }
    }
  }

  // ── Normalize recommended field shape (object→string) — READ-ONLY, in-memory only ──
  // Canon-injection happens at creation time in pendingDecisionGate.ts.
  // This normalization ensures frontend always receives recommended as a string.
  if (job && Array.isArray(job.pending_decisions)) {
    job.pending_decisions = job.pending_decisions.map((d: any) => {
      if (d.recommended && typeof d.recommended === "object" && d.recommended.value) {
        return { ...d, recommended: String(d.recommended.value) };
      }
      return d;
    });
  }

  return respond({
    job,
    latest_steps: (steps || []).reverse(),
    next_action_hint: hint || getHint(job),
  });
}

function getHint(job: any): string {
  if (!job) return "none";
  if (job.awaiting_approval) return "awaiting-approval";
  if (job.status === "running") {
    // If another invocation is processing, tell caller to wait
    if (job.is_processing) return "wait";
    return "run-next";
  }
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
