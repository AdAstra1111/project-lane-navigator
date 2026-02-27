/**
 * doc-os.ts — Canonical Document Operating System helpers.
 * Single source of truth for creating/versioning project documents.
 * ALL edge functions MUST use these helpers for project_documents + project_document_versions writes.
 */

// ── Canonical Doc Type Registry ──

export interface DocTypeConfig {
  title: string;
  file_name: string;
  is_seed_core: boolean;
  is_ladder: boolean;
}

export const DOC_TYPE_REGISTRY: Record<string, DocTypeConfig> = {
  // Seed core (5)
  project_overview:      { title: "Project Overview",       file_name: "project_overview.md",      is_seed_core: true,  is_ladder: false },
  creative_brief:        { title: "Creative Brief",         file_name: "creative_brief.md",        is_seed_core: true,  is_ladder: false },
  market_positioning:    { title: "Market Positioning",     file_name: "market_positioning.md",     is_seed_core: true,  is_ladder: false },
  canon:                 { title: "Canon & Constraints",    file_name: "canon.md",                 is_seed_core: true,  is_ladder: false },
  nec:                   { title: "Narrative Energy Contract", file_name: "nec.md",                is_seed_core: true,  is_ladder: false },
  // Input docs
  idea:                  { title: "Idea",                   file_name: "idea.md",                  is_seed_core: false, is_ladder: true },
  concept_brief:         { title: "Concept Brief",          file_name: "concept_brief.md",         is_seed_core: false, is_ladder: true },
  // Ladder deliverables
  market_sheet:          { title: "Market Sheet",           file_name: "market_sheet.md",          is_seed_core: false, is_ladder: true },
  vertical_market_sheet: { title: "Market Sheet (VD)",      file_name: "vertical_market_sheet.md", is_seed_core: false, is_ladder: true },
  treatment:             { title: "Treatment",              file_name: "treatment.md",             is_seed_core: false, is_ladder: true },
  story_outline:         { title: "Story Outline",          file_name: "story_outline.md",         is_seed_core: false, is_ladder: true },
  character_bible:       { title: "Character Bible",        file_name: "character_bible.md",       is_seed_core: false, is_ladder: true },
  beat_sheet:            { title: "Beat Sheet",             file_name: "beat_sheet.md",            is_seed_core: false, is_ladder: true },
  feature_script:        { title: "Feature Script",         file_name: "feature_script.md",        is_seed_core: false, is_ladder: true },
  episode_script:        { title: "Episode Script",         file_name: "episode_script.md",        is_seed_core: false, is_ladder: true },
  season_master_script:  { title: "Master Season Script",   file_name: "season_master_script.md",  is_seed_core: false, is_ladder: true },
  production_draft:      { title: "Production Draft",       file_name: "production_draft.md",      is_seed_core: false, is_ladder: true },
  deck:                  { title: "Deck",                   file_name: "deck.md",                  is_seed_core: false, is_ladder: true },
  documentary_outline:   { title: "Documentary Outline",    file_name: "documentary_outline.md",   is_seed_core: false, is_ladder: true },
  format_rules:          { title: "Format Rules",           file_name: "format_rules.md",          is_seed_core: false, is_ladder: true },
  season_arc:            { title: "Season Arc",             file_name: "season_arc.md",            is_seed_core: false, is_ladder: true },
  episode_grid:          { title: "Episode Grid",           file_name: "episode_grid.md",          is_seed_core: false, is_ladder: true },
  vertical_episode_beats:{ title: "Episode Beats (VD)",     file_name: "vertical_episode_beats.md",is_seed_core: false, is_ladder: true },
  topline_narrative:     { title: "Topline Narrative",      file_name: "topline_narrative.md",     is_seed_core: false, is_ladder: false },
  trailer_script:        { title: "Trailer Script",         file_name: "trailer_script.md",        is_seed_core: false, is_ladder: false },
  // Non-deliverable
  other:                 { title: "Document",               file_name: "document.md",              is_seed_core: false, is_ladder: false },
};

export const SEED_CORE_TYPES = Object.entries(DOC_TYPE_REGISTRY)
  .filter(([_, c]) => c.is_seed_core)
  .map(([k]) => k);

/** Resolve a doc_type to its canonical config. Throws for unknown types to prevent stray slots. */
export function resolveDocType(docType: string): { key: string; config: DocTypeConfig } {
  if (DOC_TYPE_REGISTRY[docType]) {
    return { key: docType, config: DOC_TYPE_REGISTRY[docType] };
  }
  throw new Error(`resolveDocType: unknown doc_type "${docType}". Must be one of: ${Object.keys(DOC_TYPE_REGISTRY).join(", ")}`);
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
  opts?: { title?: string; source?: string; episodeIndex?: number; metaJson?: Record<string, any> }
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

  if (error) throw new Error(`ensureDocSlot(${key}${epSuffix}): ${error.message}`);
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
}

/**
 * Create a new version for a document, handling is_current swap atomically.
 * Returns the new version row.
 */
export async function createVersion(
  supabase: any,
  opts: CreateVersionOpts
): Promise<any> {
  const { key } = resolveDocType(opts.docType);

  // Get next version number
  const { data: maxRow } = await supabase
    .from("project_document_versions")
    .select("version_number")
    .eq("document_id", opts.documentId)
    .order("version_number", { ascending: false })
    .limit(1);

  const nextVersion = (maxRow?.[0]?.version_number || 0) + 1;

  // Clear current flag
  await supabase
    .from("project_document_versions")
    .update({ is_current: false })
    .eq("document_id", opts.documentId)
    .eq("is_current", true);

  // Insert new version
  const insertPayload: Record<string, any> = {
    document_id: opts.documentId,
    version_number: nextVersion,
    plaintext: opts.plaintext,
    is_current: true,
    status: "draft",
    label: opts.label,
    created_by: opts.createdBy,
    approval_status: opts.approvalStatus || "draft",
    deliverable_type: opts.deliverableType || key,
    meta_json: opts.metaJson || {},
  };

  if (opts.changeSummary) insertPayload.change_summary = opts.changeSummary;
  if (opts.inheritedCore) insertPayload.inherited_core = opts.inheritedCore;
  if (opts.sourceDocumentIds) insertPayload.source_document_ids = opts.sourceDocumentIds;
  if (opts.dependsOn) insertPayload.depends_on = opts.dependsOn;
  if (opts.dependsOnResolverHash) insertPayload.depends_on_resolver_hash = opts.dependsOnResolverHash;

  const { data: newVersion, error } = await supabase
    .from("project_document_versions")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw new Error(`createVersion(${key} v${nextVersion}): ${error.message}`);
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
  });

  return {
    documentId: slot.documentId,
    versionId: version.id,
    isNewDoc: slot.isNew,
    versionNumber: version.version_number,
  };
}
