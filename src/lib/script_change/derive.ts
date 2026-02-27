/**
 * derive — orchestrator for deterministic script change analysis.
 * Creates/updates scene_graph and change_report documents keyed by source doc type.
 * No LLM calls. All analysis is heuristic.
 */

import { supabase } from '@/integrations/supabase/client';
import { parseScenes, extractCharacterCues, extractLocations } from './sceneParser';
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
 * Derived doc_types are keyed by source doc ID to avoid collisions:
 *   scene_graph__<docId>, change_report__<docId>
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

    // Keyed derived doc types by SOURCE DOC ID
    const sceneGraphDocType = `scene_graph__${sourceDocId}`;
    const changeReportDocType = `change_report__${sourceDocId}`;

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

    // Map hunks → old scenes → new scenes
    const changedOldOrdinals = previousPlaintext
      ? mapHunksToScenes(diff.hunks, oldScenes, normalizedOld.split('\n'))
      : [];

    // Map old ordinals to new scenes by slugline match or nearest ordinal
    const changedNewScenes = previousPlaintext
      ? mapOldOrdinalsToNewScenes(changedOldOrdinals, oldScenes, newScenes)
      : newScenes; // first version: all scenes are "changed"

    // Entity deltas
    const oldChars = previousPlaintext ? extractCharacterCues(normalizedOld) : [];
    const newChars = extractCharacterCues(normalizedNew);
    const oldLocs = previousPlaintext ? extractLocations(oldScenes) : [];
    const newLocs = extractLocations(newScenes);

    const removedCharacters = oldChars.filter(c => !newChars.includes(c));
    const addedCharacters = newChars.filter(c => !oldChars.includes(c));
    const removedLocations = oldLocs.filter(l => !newLocs.includes(l));
    const addedLocations = newLocs.filter(l => !oldLocs.includes(l));

    const impactFlags = previousPlaintext
      ? computeImpactFlags(normalizedOld, normalizedNew, oldScenes, newScenes)
      : [];
    const staleDocs = computeStaleDocs(diff.stats.change_pct, impactFlags, changedNewScenes.length, existingDocTypes);
    const fixPlan = computeFixPlan(impactFlags);

    const changeReportJson = {
      schema_version: '1.0',
      source_doc_id: sourceDocId,
      source_doc_type: sourceDocType,
      from_version_id: previousVersionId,
      to_version_id: newVersionId,
      stats: diff.stats,
      diff_hunks: diff.hunks,
      changed_scene_ids: changedNewScenes.map(s => s.scene_id),
      changed_scenes: changedNewScenes.map(s => ({ scene_id: s.scene_id, ordinal: s.ordinal, slugline: s.slugline })),
      impact_flags: impactFlags,
      stale_docs: staleDocs,
      fix_plan: fixPlan,
      added_characters: addedCharacters,
      removed_characters: removedCharacters,
      added_locations: addedLocations,
      removed_locations: removedLocations,
    };

    // Upsert docs keyed by source doc ID
    await Promise.all([
      upsertDerivedDoc(projectId, sceneGraphDocType, 'Scene Index', JSON.stringify(sceneGraphJson, null, 2), actorUserId),
      upsertDerivedDoc(projectId, changeReportDocType, 'Change Report', JSON.stringify(changeReportJson, null, 2), actorUserId),
    ]);
  } catch (err) {
    console.error('[derive] Failed to create script change artifacts:', err);
  }
}

/**
 * Map old scene ordinals to corresponding new scenes.
 * Match by slugline + anchor similarity, then slugline alone, then nearest ordinal.
 */
function mapOldOrdinalsToNewScenes(
  oldOrdinals: number[],
  oldScenes: Array<{ ordinal: number; slugline: string; anchor?: string }>,
  newScenes: Array<{ ordinal: number; slugline: string; scene_id: string; anchor?: string }>,
) {
  const matched = new Set<number>();
  const result: typeof newScenes = [];

  for (const ord of oldOrdinals) {
    const oldScene = oldScenes.find(s => s.ordinal === ord);
    if (!oldScene) continue;

    const slugUpper = oldScene.slugline.toUpperCase();
    const oldAnchor = oldScene.anchor || '';

    // 1) Slugline + anchor prefix match
    let best = oldAnchor
      ? newScenes.find(s =>
          s.slugline.toUpperCase() === slugUpper &&
          !matched.has(s.ordinal) &&
          (s.anchor || '').startsWith(oldAnchor.slice(0, 40))
        )
      : undefined;

    // 2) Slugline match only
    if (!best) {
      best = newScenes.find(s => s.slugline.toUpperCase() === slugUpper && !matched.has(s.ordinal));
    }

    // 3) Nearest ordinal fallback
    if (!best) {
      best = newScenes
        .filter(s => !matched.has(s.ordinal))
        .sort((a, b) => Math.abs(a.ordinal - ord) - Math.abs(b.ordinal - ord))[0];
    }

    if (best && !matched.has(best.ordinal)) {
      matched.add(best.ordinal);
      result.push(best);
    }
  }

  return result.sort((a, b) => a.ordinal - b.ordinal);
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

  const { data: maxRow } = await (supabase as any)
    .from('project_document_versions')
    .select('version_number')
    .eq('document_id', docId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (maxRow?.version_number ?? 0) + 1;

  await (supabase as any)
    .from('project_document_versions')
    .update({ is_current: false })
    .eq('document_id', docId)
    .eq('is_current', true);

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
