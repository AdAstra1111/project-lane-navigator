/**
 * sceneConsistency — Phase 12: Multi-Character Scene Governance.
 *
 * READ-ONLY diagnostic layer that evaluates per-output (scene-level)
 * consistency across ALL characters present in each generated output.
 *
 * Distinct from Phase 10 (per-output, per-character vs current binding)
 * and Phase 11 (per-character cross-output drift).
 *
 * This layer answers: within a single output, are all characters
 * aligned with current cast truth simultaneously?
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

export type SceneCharacterStatus = 'aligned' | 'misaligned' | 'unbound' | 'unknown';

export interface SceneCharacterCheck {
  character_key: string;
  expected_actor_version_id: string | null;
  actual_actor_version_id: string | null;
  status: SceneCharacterStatus;
}

export interface SceneConsistencyResult {
  output_id: string;
  characters: SceneCharacterCheck[];
  overall_status: 'aligned' | 'partial' | 'broken';
}

export interface ProjectSceneConsistencySummary {
  total_outputs: number;
  aligned_count: number;
  partial_count: number;
  broken_count: number;
  outputs: SceneConsistencyResult[];
}

/**
 * Evaluate scene-level consistency for all multi-character outputs.
 */
export async function evaluateSceneConsistency(
  projectId: string,
): Promise<SceneConsistencyResult[]> {
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

  // 2. Fetch generated outputs
  const { data: media } = await supabase
    .from('ai_generated_media')
    .select('id, generation_params')
    .eq('project_id', projectId)
    .limit(500);

  const results: SceneConsistencyResult[] = [];

  for (const item of media || []) {
    const params = item.generation_params as any;
    const provenance = params?.cast_provenance || params?.cast_context;

    // Build character checks for this output
    const characters: SceneCharacterCheck[] = [];

    if (!Array.isArray(provenance) || provenance.length === 0) {
      // No provenance → single unknown entry, output is broken
      characters.push({
        character_key: '',
        expected_actor_version_id: null,
        actual_actor_version_id: null,
        status: 'unknown',
      });
    } else {
      for (const p of provenance) {
        const rawKey = p?.character_key;
        if (!rawKey || typeof rawKey !== 'string') {
          characters.push({
            character_key: '',
            expected_actor_version_id: null,
            actual_actor_version_id: null,
            status: 'unknown',
          });
          continue;
        }

        const charKey = normalizeCharacterKey(rawKey);
        if (!charKey) {
          characters.push({
            character_key: '',
            expected_actor_version_id: null,
            actual_actor_version_id: null,
            status: 'unknown',
          });
          continue;
        }

        const storedVersion = p.actor_version_id || null;
        const currentVersion = bindingMap[charKey];

        let status: SceneCharacterStatus;

        if (currentVersion === undefined) {
          status = 'unbound';
        } else if (currentVersion !== null && storedVersion === currentVersion) {
          status = 'aligned';
        } else if (currentVersion !== null && storedVersion !== currentVersion) {
          status = 'misaligned';
        } else {
          // currentVersion is null (binding exists but version is null)
          status = 'unknown';
        }

        characters.push({
          character_key: charKey,
          expected_actor_version_id: currentVersion ?? null,
          actual_actor_version_id: storedVersion,
          status,
        });
      }
    }

    // Classify scene overall status
    const allAligned = characters.every((c) => c.status === 'aligned');
    const anyAligned = characters.some((c) => c.status === 'aligned');

    let overall_status: SceneConsistencyResult['overall_status'];
    if (allAligned && characters.length > 0) {
      overall_status = 'aligned';
    } else if (anyAligned) {
      overall_status = 'partial';
    } else {
      overall_status = 'broken';
    }

    results.push({
      output_id: item.id,
      characters,
      overall_status,
    });
  }

  return results;
}

/**
 * Full project-level scene consistency summary.
 */
export async function evaluateProjectSceneConsistency(
  projectId: string,
): Promise<ProjectSceneConsistencySummary> {
  const outputs = await evaluateSceneConsistency(projectId);

  const aligned_count = outputs.filter((o) => o.overall_status === 'aligned').length;
  const partial_count = outputs.filter((o) => o.overall_status === 'partial').length;
  const broken_count = outputs.filter((o) => o.overall_status === 'broken').length;

  return {
    total_outputs: outputs.length,
    aligned_count,
    partial_count,
    broken_count,
    outputs,
  };
}
