/**
 * derive — orchestrator for deterministic script change analysis.
 * Creates/updates scene_graph and change_report documents.
 * No LLM calls. All analysis is heuristic.
 */

import { supabase } from '@/integrations/supabase/client';
import { parseScenes } from './sceneParser';
import { computeDiff, mapHunksToScenes } from './diff';
import { computeImpactFlags, computeStaleDocs, computeFixPlan } from './impact';

const SCRIPT_DOC_TYPES = new Set([
  'feature_script', 'episode_script', 'season_master_script', 'production_draft',
  'script', 'pilot_script',
]);

export function isScriptDocType(docType: string): boolean {
  return SCRIPT_DOC_TYPES.has(docType);
}

interface DeriveParams {
  projectId: string;
  sourceDocId: string;
  sourceDocType: string;
  newVersionId: string;
  newPlaintext: string;
  previousPlaintext: string | null;
  previousVersionId: string | null;
  actorUserId: string;
  existingDocTypes: string[];
}

/**
 * Run deterministic script change derivatives.
 * Call after a new script version becomes current.
 * Errors are caught and logged but do not throw.
 */
export async function deriveScriptChangeArtifacts(params: DeriveParams): Promise<void> {
  const {
    projectId, sourceDocId, sourceDocType, newVersionId,
    newPlaintext, previousPlaintext, previousVersionId,
    actorUserId, existingDocTypes,
  } = params;

  if (!isScriptDocType(sourceDocType)) return;
  if (!newPlaintext || newPlaintext.trim().length === 0) return;

  try {
    const normalizedNew = newPlaintext.replace(/\r\n/g, '\n');
    const normalizedOld = previousPlaintext?.replace(/\r\n/g, '\n') || '';

    // Parse scenes
    const newScenes = parseScenes(normalizedNew);
    const oldScenes = previousPlaintext ? parseScenes(normalizedOld) : [];

    // Build scene graph JSON
    const sceneGraphJson = {
      schema_version: '1.0',
      parser_version: 'slugline_v1',
      source_doc_id: sourceDocId,
      source_version_id: newVersionId,
      normalized_length: normalizedNew.length,
      scenes: newScenes,
    };

    // Build change report JSON
    const diff = previousPlaintext
      ? computeDiff(normalizedOld, normalizedNew)
      : { stats: { old_len: 0, new_len: normalizedNew.length, added: normalizedNew.length, removed: 0, change_pct: 100, hunks: 0 }, hunks: [] };

    const changedOrdinals = previousPlaintext
      ? mapHunksToScenes(diff.hunks, newScenes, normalizedOld.split('\n'))
      : newScenes.map(s => s.ordinal);

    const changedScenes = newScenes.filter(s => changedOrdinals.includes(s.ordinal));
    const impactFlags = previousPlaintext
      ? computeImpactFlags(normalizedOld, normalizedNew, oldScenes, newScenes)
      : [];
    const staleDocs = computeStaleDocs(diff.stats.change_pct, impactFlags, changedScenes.length, existingDocTypes);
    const fixPlan = computeFixPlan(impactFlags);

    const changeReportJson = {
      schema_version: '1.0',
      source_doc_id: sourceDocId,
      from_version_id: previousVersionId,
      to_version_id: newVersionId,
      stats: diff.stats,
      diff_hunks: diff.hunks,
      changed_scene_ids: changedScenes.map(s => s.scene_id),
      changed_scenes: changedScenes.map(s => ({ scene_id: s.scene_id, ordinal: s.ordinal, slugline: s.slugline })),
      impact_flags: impactFlags,
      stale_docs: staleDocs,
      fix_plan: fixPlan,
    };

    // Upsert docs and write versions
    await Promise.all([
      upsertDerivedDoc(projectId, 'scene_graph', 'Scene Index', JSON.stringify(sceneGraphJson, null, 2), actorUserId),
      upsertDerivedDoc(projectId, 'change_report', 'Change Report', JSON.stringify(changeReportJson, null, 2), actorUserId),
    ]);
  } catch (err) {
    console.error('[derive] Failed to create script change artifacts:', err);
    // Non-fatal — do not block the save
  }
}

/**
 * Ensure a project doc of the given type exists, then create a new current version.
 */
async function upsertDerivedDoc(
  projectId: string,
  docType: string,
  title: string,
  plaintext: string,
  userId: string,
): Promise<void> {
  // Find or create doc
  const { data: existing } = await (supabase as any)
    .from('project_documents')
    .select('id')
    .eq('project_id', projectId)
    .eq('doc_type', docType)
    .limit(1)
    .maybeSingle();

  let docId: string;

  if (existing) {
    docId = existing.id;
  } else {
    const { data: newDoc, error: docErr } = await (supabase as any)
      .from('project_documents')
      .insert({
        project_id: projectId,
        user_id: userId,
        doc_type: docType,
        title,
        file_name: `${docType}.json`,
        file_path: `${userId}/${projectId}/${docType}.json`,
        extraction_status: 'complete',
        source: 'derived',
      })
      .select('id')
      .single();
    if (docErr || !newDoc) {
      console.error(`[derive] Failed to create ${docType} doc:`, docErr?.message);
      return;
    }
    docId = newDoc.id;
  }

  // Get next version number
  const { data: maxRow } = await (supabase as any)
    .from('project_document_versions')
    .select('version_number')
    .eq('document_id', docId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (maxRow?.version_number ?? 0) + 1;

  // Clear previous is_current
  await (supabase as any)
    .from('project_document_versions')
    .update({ is_current: false })
    .eq('document_id', docId)
    .eq('is_current', true);

  // Insert new version
  const { error: vErr } = await (supabase as any)
    .from('project_document_versions')
    .insert({
      document_id: docId,
      version_number: nextVersion,
      plaintext,
      status: 'draft',
      is_current: true,
      created_by: userId,
      label: `v${nextVersion} (auto)`,
    });

  if (vErr) {
    console.error(`[derive] Failed to create ${docType} version:`, vErr.message);
  }
}
