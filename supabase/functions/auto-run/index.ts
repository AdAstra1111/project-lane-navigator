import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isLargeRiskDocType } from "../_shared/largeRiskRouter.ts";
import { isAggregate, getRegressionThreshold, getExploreThreshold, getMaxFrontierAttempts, requireDocPolicy } from "../_shared/docPolicyRegistry.ts";
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Document Ladders ──────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH: supabase/functions/_shared/stage-ladders.ts
// Static import — no top-level await, no fetch, no file I/O.
import { STAGE_LADDERS } from "../_shared/stage-ladders.ts";

const FORMAT_LADDERS: Record<string, string[]> = STAGE_LADDERS.FORMAT_LADDERS;
const DOC_TYPE_ALIASES: Record<string, string> = STAGE_LADDERS.DOC_TYPE_ALIASES;

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
      body: JSON.stringify({ action: "regenerate-insufficient-docs", projectId, dryRun: false }),
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
      body: JSON.stringify({ projectId, pitch, lane }),
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
  feature_script: 2000,
  season_master_script: 2000,
  production_draft: 2000,
  documentary_outline: 800,
  deck: 600,
  vertical_episode_beats: 600,
};

const DEFAULT_MIN_CHARS = 600;

function isDownstreamDocSufficient(docType: string, plaintext: string | null | undefined, _approvalStatus?: string): boolean {
  if (!plaintext) return false;
  const text = plaintext.trim();
  const minChars = MIN_CHARS_BY_DOC_TYPE[docType] ?? DEFAULT_MIN_CHARS;
  if (text.length < minChars) return false;
  const lower = text.toLowerCase();
  for (const marker of STUB_MARKERS) {
    if (lower.includes(marker)) return false;
  }
  return true;
}

/**
 * Find the next unsatisfied stage on the ladder between startIdx and targetIdx.
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
): Promise<string | null> {
  const ladder = getLadderForJob(format);
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

  // Batch-fetch current versions with plaintext + approval_status
  let currentVersions: any[] = [];
  if (allDocIds.length > 0) {
    const { data: vers } = await supabase
      .from("project_document_versions")
      .select("document_id, plaintext, approval_status")
      .in("document_id", allDocIds)
      .eq("is_current", true);
    currentVersions = vers || [];
  }

  const versionByDocId = new Map<string, { plaintext: string | null; approval_status: string }>();
  for (const v of currentVersions) {
    versionByDocId.set(v.document_id, { plaintext: v.plaintext, approval_status: v.approval_status });
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

    if (APPROVAL_REQUIRED_STAGES.has(stage)) {
      const hasApproved = docIds.some(id => {
        const ver = versionByDocId.get(id);
        return ver?.approval_status === "approved";
      });
      if (!hasApproved) return stage;
    }
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

function resolveTargetForFormat(targetDoc: string, format: string): string {
  if (isOnLadder(targetDoc, format)) return targetDoc;
  const ladder = getLadderForJob(format);
  return ladder[ladder.length - 1];
}

function isStageAtOrBeforeTarget(stage: string, targetDoc: string, format: string): boolean {
  if (!isOnLadder(stage, format)) return false;
  const stageIdx = ladderIndexOf(stage, format);
  const targetIdx = ladderIndexOf(resolveTargetForFormat(targetDoc, format), format);
  return stageIdx >= 0 && stageIdx <= targetIdx;
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

function classifyCriteriaEdge(opts: {
  versionCriteriaHash: string | null;
  currentCriteriaHash: string | null;
  measuredDurationSeconds: number;
  targetMin: number | null;
  targetMax: number | null;
  targetScalar: number | null;
}): { classification: CriteriaClassification; detail: string } {
  // 1. True provenance mismatch
  if (opts.versionCriteriaHash && opts.currentCriteriaHash
      && opts.versionCriteriaHash !== opts.currentCriteriaHash) {
    return { classification: 'CRITERIA_STALE_PROVENANCE', detail: `Criteria hash mismatch: ${opts.versionCriteriaHash} vs ${opts.currentCriteriaHash}` };
  }
  // 2. Duration check (with 10% tolerance)
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
  if (!resp.ok) {
    // Truncate HTML blobs to something useful
    const snippet = raw.slice(0, 1000);
    throw Object.assign(new Error(`${functionName} error (${resp.status}): ${snippet}`), {
      structured: true, code: "EDGE_FUNCTION_FAILED", status: resp.status, body: snippet,
    });
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
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

// ── Helper: log a step ──
// stepIndex: pass null to auto-allocate via atomic DB increment (nextStepIndex).
// Returns the step_index that was used.
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
  return idx;
}

// ── Helper: update job ──
async function updateJob(supabase: any, jobId: string, fields: Record<string, any>) {
  await supabase.from("auto_run_jobs").update(fields).eq("id", jobId);
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
      return null; // No options at all — must pause for user
    }
  }
  return selections;
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
    }, token, projectId, format, deliverableType, jobId, stepCount
  );

  // Extract candidateVersionId from assemble response
  const candidateVersionId = assembleResult?.result?.newVersion?.id || assembleResult?.newVersion?.id || null;
  return { candidateVersionId };
}

// Wrapper: tries single-pass rewrite, falls back to chunked pipeline on needsPipeline error.
// Returns { candidateVersionId } — explicitly extracted from the rewrite response.
async function rewriteWithFallback(
  supabase: any, supabaseUrl: string, token: string,
  rewriteBody: Record<string, any>,
  jobId: string, stepCount: number,
  format: string, deliverableType: string
): Promise<{ candidateVersionId: string | null; raw?: any }> {
  try {
    const result = await callEdgeFunctionWithRetry(
      supabase, supabaseUrl, "dev-engine-v2", {
        action: "rewrite",
        ...rewriteBody,
      }, token, rewriteBody.projectId, format, deliverableType, jobId, stepCount
    );
    // Extract candidateVersionId from single-pass rewrite response
    const candidateVersionId = result?.result?.newVersion?.id || result?.newVersion?.id || null;
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
      return { candidateVersionId: chunkedResult.candidateVersionId };
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // GET → unauthenticated ping
  if (req.method === "GET") {
    return respond({ ok: true, ts: new Date().toISOString(), function: "auto-run" });
  }

  // Parse body safely
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action || null;

  // Unauthenticated ping action
  if (action === "ping") {
    return respond({ ok: true, ts: new Date().toISOString(), function: "auto-run" });
  }

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

    const { action, projectId, jobId, mode, start_document, target_document, max_stage_loops, max_total_steps, decision, new_step_limit } = body;

    console.log("[auto-run] auth", { fn: "auto-run", isServiceRole: actor === "service_role", hasActorUserId: !!userId, hasForwardedUserId: !!(body?.userId || body?.user_id), action });

    // ═══════════════════════════════════════
    // ACTION: ping (reachability check)
    // ═══════════════════════════════════════
    if (action === "ping") {
      return respond({ ok: true, function: "auto-run" });
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
    if (action === "status") {
      const query = jobId
        ? supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).maybeSingle()
        : supabase.from("auto_run_jobs").select("*").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: job, error } = await query;
      if (error || !job) return respond({ job: null, latest_steps: [], next_action_hint: "No job found" });

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
      const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");
      const startDoc = canonicalDocType(start_document || "idea");
      // Sanitize target_document — "draft" and "coverage" are legacy aliases, never real targets
      const rawTarget = target_document || "production_draft";
      const targetDoc = canonicalDocType(rawTarget);
      // Validate both are on the format's ladder (graceful fallback for start_document)
      let effectiveStartDoc = startDoc;
      let effectiveTargetDoc = targetDoc;
      if (!isOnLadder(startDoc, fmt)) {
        const ladder = getLadderForJob(fmt);
        // Find nearest valid stage: walk all stages, pick the last one whose conceptual position <= startDoc
        // Fallback: use the first stage on the ladder
        effectiveStartDoc = ladder[0];
        console.warn(`start_document "${startDoc}" not on ${fmt} ladder — using "${effectiveStartDoc}"`);
      }
      if (!isOnLadder(effectiveTargetDoc, fmt)) {
        // Graceful fallback: use last stage on the ladder
        const ladder = getLadderForJob(fmt);
        const fallbackTarget = ladder[ladder.length - 1];
        console.warn(`target_document "${effectiveTargetDoc}" not on ${fmt} ladder — using "${fallbackTarget}"`);
        effectiveTargetDoc = fallbackTarget;
      }

      const modeConf = MODE_CONFIG[mode || "balanced"] || MODE_CONFIG.balanced;
      const effectiveMaxLoops = max_stage_loops ?? modeConf.max_stage_loops;
      const effectiveMaxSteps = max_total_steps ?? modeConf.max_total_steps;

      // ── Preflight qualification resolver at start ──
      const preflight = await runPreflight(supabase, projectId, fmt, effectiveStartDoc, true);

      // ── Ensure seed pack docs exist before downstream generation ──
      const seedResult = await ensureSeedPack(supabase, supabaseUrl, projectId, token);

      // Ensure we have a valid userId for the job insert (NOT NULL column)
      let jobUserId = userId;
      if (!jobUserId) {
        const { data: projOwner } = await supabase.from("projects").select("user_id").eq("id", projectId).single();
        jobUserId = projOwner?.user_id || null;
      }
      if (!jobUserId) return respond({ error: "Cannot determine user_id for job. Provide userId in body." }, 400);

      const { data: job, error } = await supabase.from("auto_run_jobs").insert({
        user_id: jobUserId,
        project_id: projectId,
        status: "running",
        mode: mode || "balanced",
        start_document: effectiveStartDoc,
        target_document: effectiveTargetDoc,
        current_document: effectiveStartDoc,
        max_stage_loops: effectiveMaxLoops,
        max_total_steps: effectiveMaxSteps,
        converge_target_json: body.converge_target_json || { ci: 100, gp: 100 },
      }).select("*").single();

      if (error) throw new Error(`Failed to create job: ${error.message}`);

      await logStep(supabase, job.id, 0, effectiveStartDoc, "start", `Auto-run started: ${effectiveStartDoc} → ${effectiveTargetDoc} (${mode || "balanced"} mode)`);

      if (seedResult.ensured) {
        await logStep(supabase, job.id, 0, effectiveStartDoc, "seed_pack_ensured",
          `Seed pack generated for missing docs: ${seedResult.missing.join(", ")}`,
        );
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
      const resumeUpdates: Record<string, any> = {
        status: "running", stop_reason: null, error: null,
        pause_reason: null, pending_decisions: null,
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
        return new Response(JSON.stringify({
          code: "STALE_DECISION",
          job: freshJob,
          latest_steps: (freshSteps || []).reverse(),
          next_action_hint: getHint(freshJob),
        }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        const next = await nextUnsatisfiedStage(supabase, job.project_id, fpFmt, currentDoc, job.target_document);
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
            // Clear frontier on stage change — frontier is scoped per document stage
            frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
          });
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
          // Clear frontier on stage change — frontier is scoped per document stage
          frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
        });
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
        // Clear frontier on stage change — frontier is scoped per document stage
        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
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
      const currentDoc = job.current_document as DocStage;
      const next = await nextUnsatisfiedStage(supabase, job.project_id, jobFmt, currentDoc, job.target_document);
      if (!next) {
        const stepCount = job.step_count + 1;
        await logStep(supabase, jobId, stepCount, currentDoc, "force_promote", "All stages satisfied up to target");
        await updateJob(supabase, jobId, { step_count: stepCount, status: "completed", stop_reason: "All stages satisfied up to target" });
        return respondWithJob(supabase, jobId);
      }
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, currentDoc, "force_promote", `Force-promoted: ${currentDoc} → ${next}`);
      await updateJob(supabase, jobId, {
        current_document: next, stage_loop_count: 0, step_count: stepCount,
        stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4,
        status: "running", stop_reason: null,
        awaiting_approval: false, approval_type: null, pending_doc_id: null, pending_version_id: null,
        pending_doc_type: null, pending_next_doc_type: null, pending_decisions: null,
        // Clear frontier on stage change — frontier is scoped per document stage
        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
      });
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
        // Clear frontier on stage change — frontier is scoped per document stage
        frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
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
          const nextAfterAgg = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
          if (nextAfterAgg && isStageAtOrBeforeTarget(nextAfterAgg, job.target_document, format)) {
            await updateJob(supabase, jobId, { current_document: nextAfterAgg, stage_loop_count: 0,
              // Clear frontier on stage change — frontier is scoped per document stage
              frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
            });
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
            });
            return respondWithJob(supabase, jobId, "approve-decision");
          }
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
      let { selectedOptions, globalDirections } = body;
      if (!selectedOptions || !Array.isArray(selectedOptions)) {
        selectedOptions = [];
      }

      // If no user selections but allow_defaults is on, auto-accept from pending_decisions
      if (selectedOptions.length === 0) {
        const { data: preJob } = await supabase.from("auto_run_jobs").select("allow_defaults, pending_decisions").eq("id", jobId).eq("user_id", userId).maybeSingle();
        if (preJob?.allow_defaults && Array.isArray(preJob.pending_decisions) && preJob.pending_decisions.length > 0) {
          selectedOptions = preJob.pending_decisions
            .filter((d: any) => d.recommended)
            .map((d: any) => ({ note_id: d.id, option_id: d.recommended }));
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
          const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
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
          // Clear frontier on stage change — frontier is scoped per document stage
          ...(nextDoc !== currentDoc ? { frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0 } : {}),
        });

        return respondWithJob(supabase, jobId, status === "running" ? "run-next" : "none");
      }

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
          const nextAfterAgg = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
          if (nextAfterAgg && isStageAtOrBeforeTarget(nextAfterAgg, job.target_document, format)) {
            await updateJob(supabase, jobId, { current_document: nextAfterAgg, stage_loop_count: 0,
              // Clear frontier on stage change — frontier is scoped per document stage
              frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
            });
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
      console.log("[auto-run] run-next start", { jobId });
      let optionsGeneratedThisStep = false;

      // ── Pre-check: bail early for non-running / approval states ──
      // service_role skips user_id filter (self-chain path)
      let preJobQuery = supabase.from("auto_run_jobs").select("*").eq("id", jobId);
      if (actor !== "service_role") preJobQuery = preJobQuery.eq("user_id", userId);
      const { data: preJob, error: preJobErr } = await preJobQuery.single();
      if (preJobErr || !preJob) return respond({ error: "Job not found" }, 404);
      if (preJob.awaiting_approval) return respond({ job: preJob, latest_steps: [], next_action_hint: "awaiting-approval" });
      if (preJob.status !== "running") return respond({ job: preJob, latest_steps: [], next_action_hint: getHint(preJob) });

      // ── SINGLE-FLIGHT LOCK: acquire processing lock ──
      const job = await acquireProcessingLock(supabase, jobId, userId, actor === "service_role");
      if (!job) {
        console.log("[auto-run] run-next lock not acquired (another invocation processing)", { jobId });
        return respondWithJob(supabase, jobId, "wait");
      }

      // Ensure downstream calls carry the real user_id from the job
      if (!_requestScopedUserId && job.user_id) {
        _requestScopedUserId = job.user_id;
      }

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count;
      const stageLoopCount = job.stage_loop_count;


      // bgTask owns the lock once spawned — its own finally releases it.
      // We track whether bgTask was spawned to avoid double-release.
      let bgTaskSpawned = false;
      try {
      // ── Ensure seed pack on resume (hard guard) ──
      console.log("[auto-run] before ensureSeedPack", { projectId: job.project_id });
      const seedResult = await ensureSeedPack(supabase, supabaseUrl, job.project_id, token);
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

        // ── Route large-risk doc types through generate-document (chunked pipeline) ──
        const EPISODE_DOC_TYPES_SET = new Set(["episode_grid", "vertical_episode_beats", "episode_beats"]);
        const useChunkedGenerator = EPISODE_DOC_TYPES_SET.has(currentDoc) || isLargeRiskDocType(currentDoc);

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
            }, token);

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
            const { result: convertResult } = await callEdgeFunctionWithRetry(
              supabase, supabaseUrl, "dev-engine-v2", {
                action: "convert",
                projectId: job.project_id,
                documentId: prevDoc.id,
                versionId: prevVersion.id,
                targetOutput: currentDoc.toUpperCase(),
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

          // ── APPROVAL GATE: after convert, pause for user to review ──
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
        // Doc slot exists but has zero versions — treat as missing and re-enter
        // generation path by clearing doc and restarting this iteration
        console.warn(`[auto-run] Doc slot ${doc.id} (${currentDoc}) has no versions — will generate`);
        doc = null;
        // Re-run the generation logic inline (same as the !doc branch above)
        const seedCheck2 = await isSeedCoreOfficial(supabase, job.project_id);
        if (!seedCheck2.official) {
          await updateJob(supabase, jobId, {
            status: "paused", stop_reason: "SEED_CORE_NOT_OFFICIAL",
            awaiting_approval: true, approval_type: "seed_core_officialize",
            error: JSON.stringify({ missing_seed_docs: seedCheck2.missing, unapproved_seed_docs: seedCheck2.unapproved }),
          });
          return respondWithJob(supabase, jobId, "seed-core-not-official");
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
          await updateJob(supabase, jobId, { status: "failed", error: `Cannot generate ${currentDoc}: predecessor ${prevStage2} missing` });
          return respondWithJob(supabase, jobId);
        }
        try {
          const useChunked2 = CHUNKED_DOC_TYPES.includes(currentDoc);
          const { docId: genDocId2, versionId: genVerId2 } = await convertDocument(supabase, { projectId: job.project_id, userId: job.user_id, sourceDocId: prevDoc2.id, targetDocType: currentDoc, mode: job.mode || "balanced", useChunkedGenerator: useChunked2, format, lane, behavior });
          const ns2 = stepCount + 1;
          await logStep(supabase, jobId, ns2, currentDoc, "generate", `Generated ${currentDoc} from ${prevStage2} (empty-slot recovery)`, {}, genDocId2 ? `Created doc ${genDocId2}` : undefined, genDocId2 ? { docId: genDocId2 } : undefined);
          await updateJob(supabase, jobId, { step_count: ns2, stage_loop_count: 0, stage_exhaustion_remaining: job.stage_exhaustion_default ?? 4 });
          await logStep(supabase, jobId, null, currentDoc, "approval_required", `Review generated ${currentDoc} before continuing`, {}, undefined, { docId: genDocId2, versionId: genVerId2, doc_type: currentDoc, from_stage: prevStage2 });
          await updateJob(supabase, jobId, { status: "paused", stop_reason: `Approval required: review generated ${currentDoc}`, awaiting_approval: true, approval_type: "convert", pending_doc_id: genDocId2 || prevDoc2.id, pending_version_id: genVerId2, pending_doc_type: currentDoc, pending_next_doc_type: currentDoc });
          return respondWithJob(supabase, jobId, "awaiting-approval");
        } catch (e2: any) {
          await updateJob(supabase, jobId, { status: "failed", error: `Generate failed (empty-slot recovery): ${e2.message}` });
          return respondWithJob(supabase, jobId);
        }
      }

      // Log resume source usage
      if (resumeSourceUsed) {
        await logStep(supabase, jobId, stepCount, currentDoc, "resume_source_used",
          `Using pinned source: doc=${doc.id} ver=${latestVersion.id}`,
          {}, undefined, { documentId: doc.id, versionId: latestVersion.id, follow_latest: false }
        );
      }

      // ── Criteria classification: separate STALE_PROVENANCE from FAILS_CRITERIA_DURATION ──
      const reviewTextForDuration = latestVersion?.plaintext || doc.extracted_text || doc.plaintext || "";
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
      });

      if (criteriaResult.classification === 'CRITERIA_STALE_PROVENANCE') {
        // True provenance mismatch — criteria actually changed mid-run
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
      
      if (criteriaResult.classification === 'CRITERIA_FAIL_DURATION') {
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
        
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "duration_repair_attempt",
          `Duration repair #${durationRepairAttempts + 1}: measured=${measuredDuration}s target=${targetMin}-${targetMax}s delta=${measuredDuration - targetMid}s`,
          { risk_flags: ["criteria_fail_duration", "duration_repair"] },
        );
        
        // Update repair count — continue to rewrite with duration guidance
        // The rewrite will happen in the normal flow below with duration context injected
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

      // Store measured metrics on the version for future reference (always, even if duration=0)
      if (latestVersion?.id) {
        await supabase.from("project_document_versions").update({
          criteria_hash: currentCriteriaHash,
          criteria_json: latestCriteriaSnapshot,
          measured_metrics_json: { measured_duration_seconds: measuredDuration, estimated_at: new Date().toISOString(), estimator: 'edge_deterministic' },
        }).eq("id", latestVersion.id);
      }

      // Resolve the actual text being fed into analysis (version plaintext > doc extracted_text > doc plaintext)
      let reviewText = latestVersion.plaintext || doc.extracted_text || doc.plaintext || "";
      let reviewCharCount = reviewText.length;

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
        const promo = computePromotion(ci, gp, gap, trajectory, currentDoc, blockersCount, highImpactCount, stageLoopCount + 1);

        await logStep(supabase, jobId, null, currentDoc, "promotion_check",
          `${promo.recommendation} (readiness: ${promo.readiness_score}, flags: ${promo.risk_flags.join(",") || "none"})`,
          { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags }
        );

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
                undefined, { optionsRunId, decisions: stabiliseDecisions.length, global_directions: optionsData.global_directions?.length || 0 }
              );

              const finalDecisions = stabiliseDecisions.length > 0 ? stabiliseDecisions : createFallbackDecisions(currentDoc, ci, gp, "Blockers/high-impact issues");
              const autoSelections = tryAutoAcceptDecisions(finalDecisions, job.allow_defaults !== false);
              if (autoSelections) {
                await logStep(supabase, jobId, null, currentDoc, "auto_decided",
                  `Auto-accepted ${Object.keys(autoSelections).length} stabilise decisions`,
                  { ci, gp, gap }, undefined, { selections: autoSelections }
                );
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
              : { ci: 100, gp: 100 };
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
              // Converged enough — proceed to promotion normally
              const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
              if (next && isStageAtOrBeforeTarget(next, job.target_document, format)) {
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
            }
          }

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

            const nextAfterAggregate = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
            if (nextAfterAggregate && isStageAtOrBeforeTarget(nextAfterAggregate, job.target_document, format)) {
              await updateJob(supabase, jobId, {
                current_document: nextAfterAggregate,
                stage_loop_count: 0,
                // Clear frontier on stage change — frontier is scoped per document stage
                frontier_version_id: null, frontier_ci: null, frontier_gp: null, frontier_attempts: 0,
              });
              return respondWithJob(supabase, jobId, "run-next");
            } else {
              await updateJob(supabase, jobId, { status: "completed", stop_reason: "All stages satisfied up to target (aggregate skip)" });
              await logStep(supabase, jobId, null, currentDoc, "stop", "All stages satisfied up to target after aggregate skip");
              return respondWithJob(supabase, jobId);
            }
          }

          // No blockers or options already handled — apply rewrite with convergence policy
          const notesResult = await supabase.from("development_runs").select("output_json").eq("document_id", doc.id).eq("run_type", "NOTES").order("created_at", { ascending: false }).limit(1).maybeSingle();
          const notes = notesResult.data?.output_json;
          const allNotesForStrategy = {
            blocking_issues: notes?.blocking_issues || analyzeResult?.blocking_issues || [],
            high_impact_notes: notes?.high_impact_notes || analyzeResult?.high_impact_notes || [],
            polish_notes: notes?.polish_notes || analyzeResult?.polish_notes || [],
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
            const seedText = (doc.plaintext || doc.extracted_text || "").trim();
            if (seedText.length > 0) {
              const { data: maxRow } = await supabase.from("project_document_versions")
                .select("version_number")
                .eq("document_id", doc.id)
                .order("version_number", { ascending: false })
                .limit(1)
                .maybeSingle();
              const nextVersion = (maxRow?.version_number || 0) + 1;

              const { data: seededVersion, error: seedErr } = await supabase.from("project_document_versions").insert({
                document_id: doc.id,
                version_number: nextVersion,
                plaintext: seedText,
                is_current: true,
                status: "draft",
                label: "baseline_seed",
                created_by: job.user_id,
                approval_status: "draft",
                deliverable_type: currentDoc,
                meta_json: { seed_source: "auto_run_baseline_seed", seeded_at: new Date().toISOString() },
              }).select("id").single();

              if (!seedErr && seededVersion?.id) {
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
            const hasSeedText = (doc.plaintext || doc.extracted_text || "").trim().length > 0;

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
          let baselineVersionId = currentAccepted.id;

          // ── BASELINE REANCHOR TO BEST (READ-ONLY — never mutates is_current) ──
          // If job.best_version_id exists for this document and the baseline has collapsed,
          // re-anchor baselineVersionId in-memory only to prevent regression loops.
          {
            const bestVersionId = (job as any).best_version_id;
            const bestDocId = (job as any).best_document_id;
            const bestCI = (job as any).best_ci;
            const bestGP = (job as any).best_gp;
            
            if (bestVersionId && bestDocId === doc.id && bestVersionId !== baselineVersionId
                && typeof bestCI === "number" && typeof bestGP === "number") {
              // We need baseline scores. If last_analyzed doesn't match baseline, we must
              // re-score baseline first (handled in BASELINE SCORE REUSE below).
              // For re-anchor check, use job cache if available, otherwise skip (will be caught after scoring).
              const jobLastAnalyzed = (job as any).last_analyzed_version_id;
              const jobLastCI = (job as any).last_ci;
              const jobLastGP = (job as any).last_gp;
              
              if (typeof jobLastCI === "number" && typeof jobLastGP === "number") {
                // Use cached scores as proxy (even if from different version — conservative check)
                const baselineComposite = jobLastCI + jobLastGP;
                const bestComposite = bestCI + bestGP;
                const REANCHOR_MARGIN = 20; // composite must be this much worse
                
                if (bestComposite - baselineComposite >= REANCHOR_MARGIN) {
                  // READ-ONLY re-anchor: only change in-memory variable, NOT is_current in DB
                  await logStep(supabase, jobId, null, currentDoc, "baseline_reanchored_to_best",
                    `Baseline collapsed (CI=${jobLastCI} GP=${jobLastGP}, composite=${baselineComposite}) below best (CI=${bestCI} GP=${bestGP}, composite=${bestComposite}). Read-only re-anchor to best version ${bestVersionId}. is_current NOT changed.`,
                    { ci: bestCI, gp: bestGP }, undefined,
                    { old_baseline: baselineVersionId, new_baseline: bestVersionId, old_ci: jobLastCI, old_gp: jobLastGP, best_ci: bestCI, best_gp: bestGP, margin: bestComposite - baselineComposite, REANCHOR_MARGIN, reason: 'read_only_reanchor' });
                  baselineVersionId = bestVersionId;
                  // Do NOT call set_current_version — is_current stays unchanged
                  // Do NOT reload currentAccepted — we're using bestVersionId as read-anchor only
                }
              }
            }
          }

          // ── BASELINE SCORE REUSE OPTIMIZATION ──
          // Reuse cached scores ONLY if last_analyzed_version_id === baselineVersionId AND scores are present
          let baselineCI: number;
          let baselineGP: number;
          {
            const jobLastAnalyzed2 = (job as any).last_analyzed_version_id;
            const jobLastCI2 = (job as any).last_ci;
            const jobLastGP2 = (job as any).last_gp;
            const canReuseFromJob = jobLastAnalyzed2 === baselineVersionId
              && typeof jobLastCI2 === "number" && typeof jobLastGP2 === "number";

            if (canReuseFromJob) {
              baselineCI = jobLastCI2;
              baselineGP = jobLastGP2;
              await logStep(supabase, jobId, null, currentDoc, "baseline_score_reused",
                `Reused job-cached scores for baseline ${baselineVersionId}: CI=${baselineCI} GP=${baselineGP}`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { source: "job_cache", baselineVersionId, last_analyzed_version_id: jobLastAnalyzed2 });
            } else {
              // Must re-score baseline (mismatch or missing scores)
              await logStep(supabase, jobId, null, currentDoc, "baseline_score_rescored",
                `Re-scoring baseline ${baselineVersionId} (last_analyzed=${jobLastAnalyzed2 || 'null'}, mismatch=${jobLastAnalyzed2 !== baselineVersionId})`,
                {}, undefined,
                { baselineVersionId, last_analyzed_version_id: jobLastAnalyzed2, reason: jobLastAnalyzed2 !== baselineVersionId ? 'version_mismatch' : 'scores_missing' });
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
                baselineCI = baselineScores.ci;
                baselineGP = baselineScores.gp;

                // Update job cache with fresh baseline scores
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
            try {
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
              if (scores.ci === null || scores.gp === null) return null;
              // Extract blocker count from analyze result
              const inner = postScoreResult?.result !== undefined ? postScoreResult.result : postScoreResult;
              const analysisObj = inner?.analysis || inner || {};
              const candBlockers = pickArray(analysisObj, ["blocking_issues", "blockers", "scores.blocking_issues"]);
              return { ci: scores.ci, gp: scores.gp, blockerCount: candBlockers.length };
              
            } catch (e: any) {
              console.error(`[auto-run] scoreCandidate(${label}) failed:`, e.message);
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
                `set_current_version failed: ${promoteErr.message}. Baseline preserved.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { ...meta, error: promoteErr.message });
              return false;
            }

            // ── BLOCKER-AWARE BEST-OF TRACKING (only on PROMOTE) ──
            // Priority: lower blocker_count first, then higher (ci+gp) composite
            const bestCI = (job as any).best_ci ?? null;
            const bestGP = (job as any).best_gp ?? null;
            const bestBlockerCount = (job as any).best_blocker_count ?? null;
            const candidateComposite = candCI + candGP;
            const bestComposite = (bestCI ?? -1) + (bestGP ?? -1);
            const cbc = candBlockerCount ?? 0;

            let isBest = false;
            if (bestCI === null) {
              isBest = true; // first promotion
            } else if (bestBlockerCount !== null && cbc < bestBlockerCount) {
              isBest = true; // fewer blockers wins
            } else if ((bestBlockerCount === null || cbc === bestBlockerCount) && candidateComposite > bestComposite) {
              isBest = true; // same blockers, higher score wins
            }

            // ── STAGNATION TRACKING ──
            const lastBlockerCount = (job as any).last_blocker_count ?? null;
            const prevStagnation = (job as any).stagnation_no_blocker_count ?? 0;
            const blockersImproved = lastBlockerCount !== null && cbc < lastBlockerCount;
            const stagnationCount = (hasBlockers && !blockersImproved && lastBlockerCount !== null) ? prevStagnation + 1 : 0;

            await logStep(supabase, jobId, null, currentDoc, "rewrite_accepted",
              `Candidate accepted (attempt ${attemptNumber}, ${strategy}). CI: ${baselineCI}→${candCI}, GP: ${baselineGP}→${candGP}. Blockers: ${blockersCount}→${cbc}${blockersImproved ? ' ✓ improved' : ''}${isBest ? ' [NEW BEST]' : ''}`,
              { ci: candCI, gp: candGP }, undefined,
              { ...meta, attemptNumber, strategy, isBest, blocker_count_before: blockersCount, blocker_count_after: cbc, blockers_improved: blockersImproved, stagnation_count: stagnationCount });

            const jobUpdate: Record<string, any> = {
              stage_loop_count: newLoopCount,
              follow_latest: true,
              resume_document_id: doc.id,
              resume_version_id: candVersionId,
              last_ci: candCI,
              last_gp: candGP,
              last_blocker_count: cbc,
              stagnation_no_blocker_count: stagnationCount,
              // Clear frontier on successful promotion
              frontier_version_id: null,
              frontier_ci: null,
              frontier_gp: null,
              frontier_attempts: 0,
            };
            if (isBest) {
              jobUpdate.best_version_id = candVersionId;
              jobUpdate.best_ci = candCI;
              jobUpdate.best_gp = candGP;
              jobUpdate.best_score = candidateComposite;
              jobUpdate.best_document_id = doc.id;
              jobUpdate.best_blocker_count = cbc;
              jobUpdate.best_blocker_score = cbc; // simple weight = count for now
            }
            await updateJob(supabase, jobId, jobUpdate);
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
                  { ...rewriteBase, globalDirections: forkDirs.conservative },
                  jobId, newStep + 2, format, currentDoc),
                rewriteWithFallback(supabase, supabaseUrl, token,
                  { ...rewriteBase, globalDirections: forkDirs.aggressive },
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

              // Sort: fewer blockers first, then higher composite score
              allCandidates.sort((a, b) => (a.blockerCount - b.blockerCount) || ((b.ci + b.gp) - (a.ci + a.gp)) || a.label.localeCompare(b.label));

              // Try PROMOTE first
              const promotable = allCandidates.filter(c => c.decision === "PROMOTE");
              if (promotable.length > 0) {
                const winner = promotable[0];
                const promoted = await promoteCandidate(
                  winner.versionId, winner.ci, winner.gp,
                  { baselineVersionId, forkInputVersionId, candA, candB, forkWinner: winner.label, scoreA, scoreB, gateA, gateB },
                  winner.blockerCount
                );
                if (!promoted) {
                  await updateJob(supabase, jobId, {
                    stage_loop_count: newLoopCount,
                    follow_latest: false,
                    resume_document_id: doc.id,
                    resume_version_id: baselineVersionId,
                    last_ci: baselineCI, last_gp: baselineGP,
                  });
                }
                return respondWithJob(supabase, jobId, "run-next");
              }

              // Try EXPLORE (frontier) — pick best explorable
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
                  const best = explorable[0];
                  await setFrontier(best.versionId, best.ci, best.gp,
                    { baselineVersionId, forkInputVersionId, candA, candB, forkWinner: best.label, scoreA, scoreB, gateA, gateB });
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
                globalDirections: strategyDirections.length > 0 ? strategyDirections : undefined,
              }, jobId, newStep + 2, format, currentDoc
            );

            if (!candidateVersionId || candidateVersionId === baselineVersionId) {
              // ── FAIL CLOSED: no candidate produced ──
              await logStep(supabase, jobId, null, currentDoc, "rewrite_no_candidate",
                `Rewrite did not produce a new version id (attempt ${attemptNumber}, ${strategy}). Baseline preserved. Halting.`,
                { ci: baselineCI, gp: baselineGP }, undefined,
                { baselineVersionId, singleInputVersionId, reason: "CANDIDATE_ID_MISSING", loopCount: newLoopCount, attemptNumber, strategy });
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount,
                follow_latest: false,
                resume_document_id: doc.id,
                resume_version_id: baselineVersionId,
                last_ci: baselineCI,
                last_gp: baselineGP,
                status: "paused",
                pause_reason: "CANDIDATE_ID_MISSING",
                stop_reason: "Rewrite produced no candidate version id; refusing to promote or continue.",
              });
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
                await updateJob(supabase, jobId, {
                  stage_loop_count: newLoopCount,
                  follow_latest: false,
                  resume_document_id: doc.id,
                  resume_version_id: baselineVersionId,
                  last_ci: baselineCI, last_gp: baselineGP,
                });
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
            await updateJob(supabase, jobId, { status: "failed", error: `Rewrite failed: ${e.message}` });
            return respondWithJob(supabase, jobId);
          }
        }

        // ── PROMOTE ──
        if (promo.recommendation === "promote") {
          const modeConf = MODE_CONFIG[job.mode] || MODE_CONFIG.balanced;
          if (modeConf.require_readiness && promo.readiness_score < modeConf.require_readiness) {
            await updateJob(supabase, jobId, { stage_loop_count: stageLoopCount + 1 });
            await logStep(supabase, jobId, null, currentDoc, "stabilise", `Readiness ${promo.readiness_score} < ${modeConf.require_readiness} (premium threshold)`);
            return respondWithJob(supabase, jobId, "run-next");
          }

          const next = await nextUnsatisfiedStage(supabase, job.project_id, format, currentDoc, job.target_document);
          if (next && isStageAtOrBeforeTarget(next, job.target_document, format)) {
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
          // ── 502/503: deterministic pause, not fail ──
          const errStep = await nextStepIndex(supabase, jobId);
          const compactErr = `DEV_ENGINE_UNAVAILABLE (${e.status || '?'}): ${(e.message || '').slice(0, 300)}`;
          await updateJob(supabase, jobId, {
            status: "paused",
            stop_reason: "DEV_ENGINE_UNAVAILABLE",
            error: compactErr.slice(0, 500),
            awaiting_approval: false,
            approval_type: null,
          });
          await logStep(supabase, jobId, errStep, currentDoc, "dev_engine_unavailable",
            compactErr.slice(0, 500));
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
  const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).maybeSingle();
  const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", jobId).order("step_index", { ascending: false }).limit(200);
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
