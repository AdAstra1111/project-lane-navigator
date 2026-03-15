/**
 * doc-os.ts — Canonical Document Operating System helpers.
 * Single source of truth for creating/versioning project documents.
 * ALL edge functions MUST use these helpers for project_documents + project_document_versions writes.
 */

import { buildCanonEntitiesFromDB, validateCanonAlignment } from "./docPolicyRegistry.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";

// ── Deterministic resolver hash (no crypto dependency) ──
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function computeDefaultResolverHash(docType: string, generatorId: string, label: string): string {
  return `auto_${simpleHash(`${docType}:${generatorId}:${label}`)}`;
}

// ── Canonical Doc Type Registry ──

export type DocCategory = "canon" | "support" | "output" | "derived";

export interface DocTypeConfig {
  title: string;
  file_name: string;
  is_seed_core: boolean;
  is_ladder: boolean;
  doc_category?: DocCategory;
}

export const DOC_TYPE_REGISTRY: Record<string, DocTypeConfig> = {
  // Seed core (5) — support category
  project_overview:      { title: "Project Overview",       file_name: "project_overview.md",      is_seed_core: true,  is_ladder: false, doc_category: "support" },
  creative_brief:        { title: "Creative Brief",         file_name: "creative_brief.md",        is_seed_core: true,  is_ladder: false, doc_category: "support" },
  market_positioning:    { title: "Market Positioning",     file_name: "market_positioning.md",     is_seed_core: true,  is_ladder: false, doc_category: "support" },
  canon:                 { title: "Canon & Constraints",    file_name: "canon.md",                 is_seed_core: true,  is_ladder: false, doc_category: "support" },
  nec:                   { title: "Narrative Energy Contract", file_name: "nec.md",                is_seed_core: true,  is_ladder: false, doc_category: "support" },
  // Input docs — canon category (ladder stages)
  idea:                  { title: "Idea",                   file_name: "idea.md",                  is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  concept_brief:         { title: "Concept Brief",          file_name: "concept_brief.md",         is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  // Output documents — NOT ladder stages (parallel outputs)
  market_sheet:          { title: "Market Sheet",           file_name: "market_sheet.md",          is_seed_core: false, is_ladder: false, doc_category: "output" },
  vertical_market_sheet: { title: "Market Sheet (VD)",      file_name: "vertical_market_sheet.md", is_seed_core: false, is_ladder: false, doc_category: "output" },
  deck:                  { title: "Deck",                   file_name: "deck.md",                  is_seed_core: false, is_ladder: false, doc_category: "output" },
  // Ladder deliverables — canon category
  treatment:             { title: "Treatment",              file_name: "treatment.md",             is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  story_outline:         { title: "Story Outline",          file_name: "story_outline.md",         is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  character_bible:       { title: "Character Bible",        file_name: "character_bible.md",       is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  beat_sheet:            { title: "Beat Sheet",             file_name: "beat_sheet.md",            is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  episode_beats:         { title: "Episode Beats",          file_name: "episode_beats.md",         is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  feature_script:        { title: "Feature Script",         file_name: "feature_script.md",        is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  episode_script:        { title: "Episode Script",         file_name: "episode_script.md",        is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  season_script:         { title: "Season Script",          file_name: "season_script.md",         is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  season_master_script:       { title: "Master Season Script",        file_name: "season_master_script.md",       is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  complete_season_script:     { title: "Complete Season Script",      file_name: "complete_season_script.md",     is_seed_core: false, is_ladder: false, doc_category: "canon" },
  production_draft:           { title: "Production Draft",            file_name: "production_draft.md",           is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  documentary_outline:   { title: "Documentary Outline",    file_name: "documentary_outline.md",   is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  format_rules:          { title: "Format Rules",           file_name: "format_rules.md",          is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  season_arc:            { title: "Season Arc",             file_name: "season_arc.md",            is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  episode_grid:          { title: "Episode Grid",           file_name: "episode_grid.md",          is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  vertical_episode_beats:{ title: "Episode Beats (VD)",     file_name: "vertical_episode_beats.md",is_seed_core: false, is_ladder: true,  doc_category: "canon" },
  topline_narrative:     { title: "Topline Narrative",      file_name: "topline_narrative.md",     is_seed_core: false, is_ladder: false, doc_category: "support" },
  trailer_script:        { title: "Trailer Script",         file_name: "trailer_script.md",        is_seed_core: false, is_ladder: false, doc_category: "output" },
  // Derived (non-ladder) doc types
  scene_graph:           { title: "Scene Index",            file_name: "scene_graph.md",           is_seed_core: false, is_ladder: false, doc_category: "derived" },
  change_report:         { title: "Change Report",          file_name: "change_report.md",         is_seed_core: false, is_ladder: false, doc_category: "derived" },
  // Non-deliverable
  other:                 { title: "Document",               file_name: "document.md",              is_seed_core: false, is_ladder: false },
};

export const SEED_CORE_TYPES = Object.entries(DOC_TYPE_REGISTRY)
  .filter(([_, c]) => c.is_seed_core)
  .map(([k]) => k);

/** Legacy alias map — mirrors DOC_TYPE_ALIASES from stage-ladders.json.
 *  IMPORTANT: "script" is format-ambiguous and MUST be resolved via format-aware path.
 *  The alias here is kept ONLY for non-format-aware callers; format-aware callers
 *  MUST pass `format` to resolveDocType() which will reject "script" and require
 *  explicit resolution. */
const DOC_TYPE_ALIASES: Record<string, string> = {
  // "script" deliberately REMOVED — must use format-aware resolution
  draft: "feature_script",
  blueprint: "treatment",
  architecture: "story_outline",
  plot_architecture: "story_outline",
  outline: "treatment",
  series_bible: "treatment",
  season_outline: "treatment",
  logline: "idea",
  one_pager: "concept_brief",
  notes: "concept_brief",
  pilot_script: "episode_script",
  episode_beat_sheet: "beat_sheet",
  coverage: "production_draft",
  episode_1_script: "episode_script",
  writers_room: "other",
};

/** Format-aware script type resolution from stage-ladders */
import { STAGE_LADDERS } from "./stage-ladders.ts";
const FORMAT_SCRIPT_TYPES_PAL: Record<string, string> = STAGE_LADDERS.FORMAT_SCRIPT_TYPES;

/**
 * Resolve a doc_type to its canonical config.
 * 
 * PIPELINE AUTHORITY LAYER (PAL):
 * - If `format` is provided and docType is "script", resolves to the correct
 *   script type for that format (e.g. season_script for vertical-drama).
 * - If `format` is NOT provided and docType is "script", REJECTS with error
 *   (fail-closed: no silent fallback to feature_script).
 * - All other aliases are applied as before.
 */
export function resolveDocType(docType: string, format?: string | null): { key: string; config: DocTypeConfig } {
  let canonical: string;

  // PAL: Handle "script" with format-awareness
  if (docType === "script") {
    const fmtKey = (format ?? '').trim().toLowerCase().replace(/[_ ]+/g, '-');
    if (fmtKey && FORMAT_SCRIPT_TYPES_PAL[fmtKey]) {
      canonical = FORMAT_SCRIPT_TYPES_PAL[fmtKey];
      console.log(`[doc-os][IEL] script_resolved_by_format { format: "${fmtKey}", resolved: "${canonical}" }`);
    } else if (fmtKey) {
      // Format provided but not in FORMAT_SCRIPT_TYPES — fail closed
      throw new Error(`resolveDocType: "script" cannot be resolved for unknown format "${fmtKey}". Provide explicit doc_type.`);
    } else {
      // No format provided — fail closed (no silent fallback to feature_script)
      throw new Error(`resolveDocType: "script" is format-ambiguous. Provide format parameter or use explicit doc_type (feature_script, episode_script, season_script).`);
    }
  } else {
    canonical = DOC_TYPE_ALIASES[docType] ?? docType;
    if (canonical !== docType) {
      console.log(`[doc-os][IEL] alias_resolved { from: "${docType}", to: "${canonical}" }`);
    }
  }

  if (DOC_TYPE_REGISTRY[canonical]) {
    console.log(`[doc-os][IEL] doc_type_resolved { input: "${docType}", canonical: "${canonical}", format: "${format || 'none'}" }`);
    return { key: canonical, config: DOC_TYPE_REGISTRY[canonical] };
  }
  throw new Error(`resolveDocType: unknown doc_type "${docType}" (resolved to "${canonical}"). Must be one of: ${Object.keys(DOC_TYPE_REGISTRY).join(", ")}`);
}

// ── Canonical Doc Slot (upsert) ──

export interface DocSlotResult {
  documentId: string;
  isNew: boolean;
}

/**
 * Ensure exactly one project_documents row exists for (projectId, docType).
 * Returns the existing or newly created document ID.
 */
export async function ensureDocSlot(
  supabase: any,
  projectId: string,
  userId: string,
  docType: string,
  opts?: { title?: string; source?: string; episodeIndex?: number; metaJson?: Record<string, any>; docRole?: string }
): Promise<DocSlotResult> {
  const { key, config } = resolveDocType(docType);

  // Build query for existing slot
  let query = supabase
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", key);

  // Per-episode matching: if episodeIndex provided, match on meta_json->episode_index
  if (opts?.episodeIndex != null) {
    query = query.eq("meta_json->>episode_index", String(opts.episodeIndex));
  }

  const { data: existing } = await query.limit(1);

  if (existing && existing.length > 0) {
    return { documentId: existing[0].id, isNew: false };
  }

  // Build title and file_name for per-episode docs
  const epIdx = opts?.episodeIndex;
  const epSuffix = epIdx != null ? `_e${String(epIdx).padStart(2, "0")}` : "";
  const title = opts?.title || (epIdx != null ? `${config.title} — Episode ${epIdx}` : config.title);
  const fileName = epIdx != null ? config.file_name.replace(".md", `${epSuffix}.md`) : config.file_name;

  // Create new
  const insertPayload: Record<string, any> = {
    project_id: projectId,
    user_id: userId,
    doc_type: key,
    title,
    file_name: fileName,
    file_path: `${projectId}/${fileName}`,
    extraction_status: "complete",
    source: opts?.source || "generated",
    is_primary: false,
    doc_role: opts?.docRole || "creative_primary",
  };

  // Merge meta_json with episode_index
  const meta: Record<string, any> = { ...(opts?.metaJson || {}) };
  if (epIdx != null) meta.episode_index = epIdx;
  if (Object.keys(meta).length > 0) insertPayload.meta_json = meta;

  const { data: newDoc, error } = await supabase
    .from("project_documents")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    const isDuplicateSlot = error.code === "23505" || (error.message || "").includes("uq_project_documents_project_doc_type");
    if (isDuplicateSlot) {
      let retryQuery = supabase
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", key);

      if (epIdx != null) {
        retryQuery = retryQuery.eq("meta_json->>episode_index", String(epIdx));
      }

      const { data: racedExisting, error: retryErr } = await retryQuery.limit(1);
      if (!retryErr && racedExisting && racedExisting.length > 0) {
        return { documentId: racedExisting[0].id, isNew: false };
      }
    }

    throw new Error(`ensureDocSlot(${key}${epSuffix}): ${error.message}`);
  }
  return { documentId: newDoc.id, isNew: true };
}

// ── Canonical Version Creation ──

export interface CreateVersionOpts {
  documentId: string;
  docType: string;
  plaintext: string;
  label: string;
  createdBy: string;
  approvalStatus?: string;
  metaJson?: Record<string, any>;
  changeSummary?: string;
  inheritedCore?: Record<string, any>;
  sourceDocumentIds?: string[];
  deliverableType?: string;
  dependsOn?: string[];
  dependsOnResolverHash?: string;
  generatorId?: string;
  /** PATCH 3: Provenance — inputs_used must be populated for system-generated versions */
  inputsUsed?: Record<string, any>;
  /** PAL: Project format for lane-aware doc_type resolution and canon alignment */
  format?: string | null;
  /** Conflict detection: if provided and this version is no longer current, new version is NOT auto-promoted */
  parentVersionId?: string;
}

// ── Known system generator IDs — versions from these MUST have non-empty inputs_used ──
const SYSTEM_GENERATOR_IDS = new Set([
  "auto-run-convert", "auto-run-setup", "auto-run-seed",
  "dev-engine-v2-convert", "dev-engine-v2-regen-insufficient", "dev-engine-v2-series-scripts",
  "dev-engine-v2-series-autorun", "dev-engine-v2-build-master", "dev-engine-v2-rebase",
  "dev-engine-v2-regen-tick",
  "dev-engine-v2-rewrite", "dev-engine-v2-rewrite-chunked",
  "seed-pack",
  "generate-document", "system",
  "notes-engine", "idea-to-project", "season-package",
]);
// seed-trigger is NOT in the set — it's DB-trigger generated and exempt from provenance
// seed-pack IS in the set — seed-pack outputs should have provenance for auditability

// ── PIPELINE AUTHORITY LAYER: Lane-aware canon alignment control ──
// Canon alignment should ONLY run on doc_types that CONSUME canon (scripts).
// All other types either DEFINE canon or are structural.
//
// Instead of a broad exempt set, we define which doc_types per format SHOULD run alignment.
// Everything else is implicitly exempt.

const CANON_ALIGNMENT_APPLICABLE: Record<string, Set<string>> = {
  "film":               new Set(["feature_script", "production_draft"]),
  "feature":            new Set(["feature_script", "production_draft"]),
  "short":              new Set(["feature_script"]),
  "animation":          new Set(["feature_script"]),
  "tv-series":          new Set(["episode_script", "season_master_script", "production_draft"]),
  "limited-series":     new Set(["episode_script", "season_master_script", "production_draft"]),
  "digital-series":     new Set(["episode_script", "season_master_script", "production_draft"]),
  "anim-series":        new Set(["episode_script", "season_master_script", "production_draft"]),
  "vertical-drama":     new Set(["season_script"]),
  "documentary":        new Set([]),
  "documentary-series": new Set([]),
  "hybrid-documentary": new Set([]),
  "reality":            new Set(["episode_script"]),
};

/**
 * PAL: Determine if canon alignment should run for a given format + doc_type.
 * Returns true ONLY if the doc_type is a canon-consuming type for that format.
 * Fail-closed: if format is unknown, alignment does NOT run (no false positives).
 *
 * Rewrite refinement exception:
 * production_draft chunked rewrites are editing an existing approved script shape,
 * so they must not be blocked by first-pass canon entity coverage heuristics.
 */
export function shouldRunCanonAlignment(
  format: string | null | undefined,
  docType: string,
  generatorId?: string | null,
): boolean {
  const fmtKey = (format ?? '').trim().toLowerCase().replace(/[_ ]+/g, '-');

  if (docType === "production_draft" && generatorId === "dev-engine-v2-rewrite-chunked") {
    console.log(`[doc-os][PAL] canon_alignment_skipped: rewrite_refinement_exempt { format: "${fmtKey || 'unknown'}", doc_type: "${docType}", generator: "${generatorId}" }`);
    return false;
  }

  if (!fmtKey) {
    console.warn(`[doc-os][PAL] canon_alignment_skipped: no format provided for doc_type="${docType}"`);
    return false;
  }
  const applicable = CANON_ALIGNMENT_APPLICABLE[fmtKey];
  if (!applicable) {
    console.warn(`[doc-os][PAL] canon_alignment_skipped: unknown format="${fmtKey}" for doc_type="${docType}"`);
    return false;
  }
  const should = applicable.has(docType);
  console.log(`[doc-os][IEL] canon_alignment_check { format: "${fmtKey}", doc_type: "${docType}", should_run: ${should} }`);
  return should;
}

// Legacy fallback for callers that don't have format context — minimal set
const CANON_ALIGNMENT_EXEMPT_FALLBACK = new Set([
  "canon", "nec", "format_rules", "project_overview", "creative_brief", "market_positioning",
  "idea", "concept_brief", "vertical_market_sheet", "market_sheet",
  "episode_grid", "season_arc", "vertical_episode_beats",
  "character_bible", "beat_sheet", "treatment", "story_outline",
  "documentary_outline", "topline_narrative", "season_master_script",
  "deck", "episode_beats",
]);

/**
 * Create a new version for a document, handling is_current swap atomically.
 * Returns the new version row.
 * 
 * PROVENANCE INVARIANT: System-generated versions (generatorId in SYSTEM_GENERATOR_IDS)
 * MUST provide non-empty inputsUsed or the call will throw PROVENANCE_MISSING.
 * Seed-trigger versions are exempt (they are DB-trigger generated).
 */
export async function createVersion(
  supabase: any,
  opts: CreateVersionOpts
): Promise<any> {
  const { key } = resolveDocType(opts.docType, opts.format);

  // ── PATCH 3: Provenance enforcement hard gate ──
  const effectiveGeneratorId = opts.generatorId || "system";
  const isSystemGenerated = (SYSTEM_GENERATOR_IDS.has(effectiveGeneratorId) || (opts.generatorId && opts.generatorId.length > 0))
    && effectiveGeneratorId !== "seed-trigger";
  const hasProvenance = opts.inputsUsed && Object.keys(opts.inputsUsed).length > 0;

  if (isSystemGenerated && !hasProvenance) {
    const msg = `PROVENANCE_MISSING: System generator "${effectiveGeneratorId}" must provide non-empty inputsUsed for doc_type="${key}"`;
    console.error(`[doc-os] ${msg}`);
    throw new Error(msg);
  }

  // ── PAL: Lane-aware canon alignment gate ──
  // Uses format-aware check if format is available; falls back to legacy exempt set otherwise.
  const runAlignment = (() => {
    if (!isSystemGenerated || !opts.plaintext) return false;
    if (opts.format) {
      return shouldRunCanonAlignment(opts.format, key, effectiveGeneratorId);
    }
    // Legacy fallback: exempt set (for callers that don't pass format)
    return !CANON_ALIGNMENT_EXEMPT_FALLBACK.has(key);
  })();

  if (runAlignment) {
    try {
      const { data: docRow } = await supabase
        .from("project_documents")
        .select("project_id")
        .eq("id", opts.documentId)
        .maybeSingle();

      if (docRow?.project_id) {
        const canon = await buildCanonEntitiesFromDB(supabase, docRow.project_id);
        if (canon && canon.entities.length > 0) {
          const alignResult = validateCanonAlignment(opts.plaintext, canon.entities);
          if (!alignResult.pass) {
            const msg = `CANON_MISMATCH: doc_type="${key}" format="${opts.format || 'unknown'}" generator="${effectiveGeneratorId}" coverage=${alignResult.entityCoverage} missing=[${alignResult.missingEntities.slice(0, 5).join(",")}] foreign=[${alignResult.foreignEntities.slice(0, 5).join(",")}]`;
            console.error(`[doc-os] ${msg}`);
            throw new Error(msg);
          }
          console.log(`[doc-os] canon_alignment_pass doc_type=${key} format=${opts.format || 'unknown'} coverage=${alignResult.entityCoverage}`);
        }
      }
    } catch (err: any) {
      if (err?.message?.startsWith("CANON_MISMATCH:")) throw err;
      console.warn(`[doc-os] canon alignment check skipped (non-fatal): ${err?.message}`);
    }
  }

  // Get next version number
  const { data: maxRow } = await supabase
    .from("project_document_versions")
    .select("version_number")
    .eq("document_id", opts.documentId)
    .order("version_number", { ascending: false })
    .limit(1);

  const nextVersion = (maxRow?.[0]?.version_number || 0) + 1;

  // ── Conflict detection: check if parent version is still current ──
  let shouldPromote = true;
  if (opts.parentVersionId) {
    const { data: parentRow } = await supabase
      .from("project_document_versions")
      .select("id, is_current, version_number")
      .eq("id", opts.parentVersionId)
      .maybeSingle();

    if (parentRow && !parentRow.is_current) {
      // Parent is no longer current — a newer version exists (e.g. from Writers' Room)
      // Create the version but do NOT auto-promote to current
      shouldPromote = false;
      console.warn(`[doc-os] VERSION_CONFLICT: parent ${opts.parentVersionId} (v${parentRow.version_number}) is no longer current. New version v${nextVersion} will NOT be auto-promoted. generator="${opts.generatorId || 'system'}"`);
    }
  }

  if (shouldPromote) {
    // Clear current flag
    await supabase
      .from("project_document_versions")
      .update({ is_current: false })
      .eq("document_id", opts.documentId)
      .eq("is_current", true);
  }

  // ── Deterministic resolver hash default ──
  const resolvedHash = opts.dependsOnResolverHash || computeDefaultResolverHash(key, effectiveGeneratorId, opts.label);

  // Insert new version
  const insertPayload: Record<string, any> = {
    document_id: opts.documentId,
    version_number: nextVersion,
    plaintext: opts.plaintext,
    is_current: shouldPromote,
    status: "draft",
    label: opts.label,
    created_by: opts.createdBy,
    approval_status: opts.approvalStatus || "draft",
    deliverable_type: opts.deliverableType || key,
    meta_json: opts.metaJson || {},
    generator_id: effectiveGeneratorId,
    depends_on_resolver_hash: resolvedHash,
  };

  if (opts.changeSummary) insertPayload.change_summary = opts.changeSummary;
  if (opts.inheritedCore) insertPayload.inherited_core = opts.inheritedCore;
  if (opts.sourceDocumentIds) insertPayload.source_document_ids = opts.sourceDocumentIds;
  if (opts.dependsOn) insertPayload.depends_on = opts.dependsOn;
  if (opts.generatorId) insertPayload.generator_id = opts.generatorId;
  // Persist inputs_used for provenance
  if (hasProvenance) {
    insertPayload.inputs_used = opts.inputsUsed;
  }

  const { data: newVersion, error } = await supabase
    .from("project_document_versions")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw new Error(`createVersion(${key} v${nextVersion}): ${error.message}`);

  // ── PATCH A1: Always set latest_version_id on the parent document ──
  const { error: lvErr } = await supabase
    .from("project_documents")
    .update({ latest_version_id: newVersion.id })
    .eq("id", opts.documentId);
  if (lvErr) {
    console.warn(`[doc-os] failed to set latest_version_id for doc ${opts.documentId}: ${lvErr.message}`);
  } else {
    console.log(`[doc-os] latest_version_id set for doc ${opts.documentId} → version ${newVersion.id}`);
  }

  // ── TRANSITION LEDGER: version_created (fail-closed) ──
  // Resolve project_id from document for ledger context
  let transitionProjectId: string | null = null;
  try {
    const { data: docForProject } = await supabase
      .from("project_documents")
      .select("project_id")
      .eq("id", opts.documentId)
      .maybeSingle();
    transitionProjectId = docForProject?.project_id || null;
  } catch { /* non-fatal for transition lookup */ }

  if (transitionProjectId) {
    await emitTransition(supabase, {
      projectId: transitionProjectId,
      eventType: TRANSITION_EVENTS.VERSION_CREATED,
      docType: key,
      resultingVersionId: newVersion.id,
      sourceVersionId: opts.parentVersionId || undefined,
      generatorId: effectiveGeneratorId,
      trigger: opts.label,
      sourceOfTruth: "doc-os.createVersion",
      resultingState: {
        version_number: nextVersion,
        is_current: shouldPromote,
        approval_status: opts.approvalStatus || "draft",
        has_provenance: !!hasProvenance,
        content_length: opts.plaintext?.length || 0,
      },
      createdBy: opts.createdBy,
    });
  }

  // ── NIT v2.1: Auto entity mention extraction (fail-closed) ──
  // Fires for every successfully created version. Character mentions are extracted
  // deterministically using parseSections + exact canonical_name matching.
  // Unsupported doc types skip silently. Never throws — version write is never blocked.
  if (transitionProjectId && newVersion?.id && opts.plaintext) {
    try {
      const { extractEntityMentionsForVersion } = await import("./narrativeEntityEngine.ts");
      const mentionResult = await extractEntityMentionsForVersion(
        supabase,
        transitionProjectId,
        opts.documentId,
        newVersion.id,
        key,           // resolved canonical doc type
        opts.plaintext, // pass directly — skip extra DB round-trip
      );
      if (mentionResult.skipped_reason) {
        console.log(`[doc-os] NIT v2.1 mention sync skipped version=${newVersion.id} doc_type=${key} reason=${mentionResult.skipped_reason}`);
      } else {
        console.log(`[doc-os] NIT v2.1 mention sync ok version=${newVersion.id} doc_type=${key} mentions=${mentionResult.mentions_upserted}`);
      }
    } catch (nitErr: any) {
      // Non-fatal: mention extraction failure must never block the pipeline
      console.warn(`[doc-os] NIT v2.1 mention sync non-fatal error version=${newVersion?.id}: ${nitErr?.message}`);
    }
  }

  return newVersion;
}

// ── Convenience: ensureDocSlot + createVersion in one call ──

export interface UpsertDocOpts {
  projectId: string;
  userId: string;
  docType: string;
  plaintext: string;
  label: string;
  approvalStatus?: string;
  metaJson?: Record<string, any>;
  source?: string;
  title?: string;
  changeSummary?: string;
  inheritedCore?: Record<string, any>;
  sourceDocumentIds?: string[];
  dependsOnResolverHash?: string;
  generatorId?: string;
  inputsUsed?: Record<string, any>;
}

export async function upsertDoc(
  supabase: any,
  opts: UpsertDocOpts
): Promise<{ documentId: string; versionId: string; isNewDoc: boolean; versionNumber: number }> {
  const slot = await ensureDocSlot(supabase, opts.projectId, opts.userId, opts.docType, {
    title: opts.title,
    source: opts.source,
  });

  const version = await createVersion(supabase, {
    documentId: slot.documentId,
    docType: opts.docType,
    plaintext: opts.plaintext,
    label: opts.label,
    createdBy: opts.userId,
    approvalStatus: opts.approvalStatus,
    metaJson: opts.metaJson,
    changeSummary: opts.changeSummary,
    inheritedCore: opts.inheritedCore,
    sourceDocumentIds: opts.sourceDocumentIds,
    dependsOnResolverHash: opts.dependsOnResolverHash,
    generatorId: opts.generatorId,
    inputsUsed: opts.inputsUsed,
  });

  return {
    documentId: slot.documentId,
    versionId: version.id,
    isNewDoc: slot.isNew,
    versionNumber: version.version_number,
  };
}
