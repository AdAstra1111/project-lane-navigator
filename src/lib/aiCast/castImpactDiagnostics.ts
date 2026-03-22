/**
 * castImpactDiagnostics — Evaluates which generated outputs are out of sync
 * with current project cast bindings.
 *
 * Compares stored cast_provenance in generation outputs against
 * current project_ai_cast bindings.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

export interface ImpactEntry {
  output_id: string;
  output_type: string;
  character_key: string;
  stored_actor_version_id: string | null;
  current_actor_version_id: string | null;
  status: 'in_sync' | 'out_of_sync_with_current_cast' | 'unbound';
}

export interface CastImpactResult {
  total_outputs: number;
  out_of_sync_count: number;
  entries_by_character: Record<string, ImpactEntry[]>;
}

/**
 * Evaluate cast impact for a project by comparing generation provenance
 * against current bindings.
 */
export async function evaluateCastImpact(projectId: string): Promise<CastImpactResult> {
  // Fetch current bindings
  const { data: bindings } = await (supabase as any)
    .from('project_ai_cast')
    .select('character_key, ai_actor_version_id')
    .eq('project_id', projectId);

  const bindingMap: Record<string, string | null> = {};
  for (const b of bindings || []) {
    bindingMap[normalizeCharacterKey(b.character_key || '')] = b.ai_actor_version_id;
  }

  // Fetch generated media with provenance
  const { data: media } = await supabase
    .from('ai_generated_media')
    .select('id, generation_params')
    .eq('project_id', projectId)
    .limit(500);

  const entries: ImpactEntry[] = [];

  for (const item of media || []) {
    const params = item.generation_params as any;
    const provenance = params?.cast_provenance || params?.cast_context;
    if (!Array.isArray(provenance)) continue;

    for (const p of provenance) {
      const charKey = normalizeCharacterKey(p.character_key || '');
      if (!charKey) continue;

      const currentVersion = bindingMap[charKey];
      const storedVersion = p.actor_version_id || null;

      let status: ImpactEntry['status'];
      if (currentVersion === undefined) {
        status = 'unbound';
      } else if (storedVersion === currentVersion) {
        status = 'in_sync';
      } else {
        status = 'out_of_sync_with_current_cast';
      }

      entries.push({
        output_id: item.id,
        output_type: 'ai_generated_media',
        character_key: charKey,
        stored_actor_version_id: storedVersion,
        current_actor_version_id: currentVersion ?? null,
        status,
      });
    }
  }

  // Group by character
  const byChar: Record<string, ImpactEntry[]> = {};
  for (const e of entries) {
    if (!byChar[e.character_key]) byChar[e.character_key] = [];
    byChar[e.character_key].push(e);
  }

  return {
    total_outputs: entries.length,
    out_of_sync_count: entries.filter(e => e.status === 'out_of_sync_with_current_cast').length,
    entries_by_character: byChar,
  };
}
