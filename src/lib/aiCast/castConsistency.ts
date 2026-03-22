/**
 * castConsistency — Phase 10: Cast Consistency Verification.
 *
 * READ-ONLY layer that verifies whether generated outputs are aligned
 * with current project cast bindings (project_ai_cast).
 *
 * Compares stored cast_provenance on ai_generated_media against
 * current binding truth. No mutations.
 *
 * Classification rules (in order):
 * 1. unknown — provenance missing or malformed
 * 2. unbound — provenance references character with no current binding
 * 3. aligned — stored actor_version_id === current binding actor_version_id
 * 4. misaligned — stored actor_version_id !== current binding actor_version_id
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

export type CastConsistencyStatus =
  | 'aligned'
  | 'misaligned'
  | 'unbound'
  | 'unknown';

export interface OutputConsistencyResult {
  output_id: string;
  output_type: string;
  character_key: string;
  expected_actor_version_id: string | null;
  actual_actor_version_id: string | null;
  status: CastConsistencyStatus;
}

export interface CastConsistencySummary {
  total_results: number;
  aligned_count: number;
  misaligned_count: number;
  unbound_count: number;
  unknown_count: number;
  by_character: Record<string, OutputConsistencyResult[]>;
  overall_status: 'aligned' | 'partial' | 'broken';
}

/**
 * Evaluate per-output consistency against current project cast bindings.
 */
export async function evaluateOutputConsistency(
  projectId: string,
): Promise<OutputConsistencyResult[]> {
  // 1. Fetch current bindings
  const { data: bindings } = await (supabase as any)
    .from('project_ai_cast')
    .select('character_key, ai_actor_version_id')
    .eq('project_id', projectId);

  const bindingMap: Record<string, string | null> = {};
  for (const b of bindings || []) {
    bindingMap[normalizeCharacterKey(b.character_key || '')] =
      b.ai_actor_version_id;
  }

  // 2. Fetch generated media
  const { data: media } = await supabase
    .from('ai_generated_media')
    .select('id, generation_params')
    .eq('project_id', projectId)
    .limit(500);

  const results: OutputConsistencyResult[] = [];

  for (const item of media || []) {
    const params = item.generation_params as any;
    const provenance = params?.cast_provenance || params?.cast_context;

    if (!Array.isArray(provenance) || provenance.length === 0) {
      // Missing or malformed provenance → unknown
      results.push({
        output_id: item.id,
        output_type: 'ai_generated_media',
        character_key: '',
        expected_actor_version_id: null,
        actual_actor_version_id: null,
        status: 'unknown',
      });
      continue;
    }

    for (const p of provenance) {
      const rawKey = p?.character_key;
      if (!rawKey || typeof rawKey !== 'string') {
        results.push({
          output_id: item.id,
          output_type: 'ai_generated_media',
          character_key: '',
          expected_actor_version_id: null,
          actual_actor_version_id: null,
          status: 'unknown',
        });
        continue;
      }

      const charKey = normalizeCharacterKey(rawKey);
      if (!charKey) {
        results.push({
          output_id: item.id,
          output_type: 'ai_generated_media',
          character_key: '',
          expected_actor_version_id: null,
          actual_actor_version_id: null,
          status: 'unknown',
        });
        continue;
      }

      const storedVersion = p.actor_version_id || null;
      const currentVersion = bindingMap[charKey];

      let status: CastConsistencyStatus;

      if (currentVersion === undefined) {
        // No binding exists for this character
        status = 'unbound';
      } else if (storedVersion === currentVersion) {
        status = 'aligned';
      } else {
        status = 'misaligned';
      }

      results.push({
        output_id: item.id,
        output_type: 'ai_generated_media',
        character_key: charKey,
        expected_actor_version_id: currentVersion ?? null,
        actual_actor_version_id: storedVersion,
        status,
      });
    }
  }

  return results;
}

/**
 * Summarize consistency results into project-level view.
 */
export function summarizeConsistency(
  results: OutputConsistencyResult[],
): CastConsistencySummary {
  const aligned_count = results.filter((r) => r.status === 'aligned').length;
  const misaligned_count = results.filter(
    (r) => r.status === 'misaligned',
  ).length;
  const unbound_count = results.filter((r) => r.status === 'unbound').length;
  const unknown_count = results.filter((r) => r.status === 'unknown').length;

  const by_character: Record<string, OutputConsistencyResult[]> = {};
  for (const r of results) {
    const key = r.character_key || '__unknown__';
    if (!by_character[key]) by_character[key] = [];
    by_character[key].push(r);
  }

  let overall_status: 'aligned' | 'partial' | 'broken';
  if (results.length === 0) {
    overall_status = 'aligned';
  } else if (misaligned_count === 0 && unbound_count === 0) {
    overall_status = 'aligned';
  } else if (aligned_count === 0) {
    overall_status = 'broken';
  } else {
    overall_status = 'partial';
  }

  return {
    total_results: results.length,
    aligned_count,
    misaligned_count,
    unbound_count,
    unknown_count,
    by_character,
    overall_status,
  };
}

/**
 * Full project-level consistency evaluation (convenience).
 */
export async function evaluateProjectCastConsistency(
  projectId: string,
): Promise<CastConsistencySummary> {
  const results = await evaluateOutputConsistency(projectId);
  return summarizeConsistency(results);
}
