/**
 * continuityDiagnostics — Phase 11: Character Continuity Intelligence.
 *
 * READ-ONLY layer that detects identity/version drift across outputs
 * for the SAME character over time.
 *
 * Distinct from Phase 10 consistency (which checks current binding match).
 * Continuity checks whether a character is represented by one stable
 * actor_version_id or many across all generated outputs.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

export interface CharacterContinuityResult {
  character_key: string;
  outputs_checked: number;
  distinct_actor_version_ids: string[];
  dominant_actor_version_id: string | null;
  dominant_count: number;
  continuity_score: number; // 0–100
  drift_detected: boolean;
  status: 'stable' | 'mixed' | 'broken' | 'unknown';
}

export interface ProjectContinuitySummary {
  total_characters: number;
  stable_count: number;
  mixed_count: number;
  broken_count: number;
  unknown_count: number;
  overall_status: 'stable' | 'mixed' | 'broken';
  characters: Record<string, CharacterContinuityResult>;
}

/**
 * Evaluate per-character continuity across all generated outputs.
 */
export async function evaluateCharacterContinuity(
  projectId: string,
): Promise<Record<string, CharacterContinuityResult>> {
  const { data: media } = await supabase
    .from('ai_generated_media')
    .select('id, generation_params')
    .eq('project_id', projectId)
    .limit(500);

  // Collect per-character version occurrences
  const charVersions: Record<string, (string | null)[]> = {};

  for (const item of media || []) {
    const params = item.generation_params as any;
    const provenance = params?.cast_provenance || params?.cast_context;
    if (!Array.isArray(provenance) || provenance.length === 0) continue;

    for (const p of provenance) {
      const rawKey = p?.character_key;
      if (!rawKey || typeof rawKey !== 'string') continue;
      const charKey = normalizeCharacterKey(rawKey);
      if (!charKey) continue;

      if (!charVersions[charKey]) charVersions[charKey] = [];
      charVersions[charKey].push(p.actor_version_id || null);
    }
  }

  const results: Record<string, CharacterContinuityResult> = {};

  for (const [charKey, versions] of Object.entries(charVersions)) {
    const outputsChecked = versions.length;

    // Filter to non-null version ids
    const nonNullVersions = versions.filter((v): v is string => v !== null);
    const distinctIds = [...new Set(nonNullVersions)];

    // If no usable version ids at all → unknown
    if (nonNullVersions.length === 0) {
      results[charKey] = {
        character_key: charKey,
        outputs_checked: outputsChecked,
        distinct_actor_version_ids: [],
        dominant_actor_version_id: null,
        dominant_count: 0,
        continuity_score: 0,
        drift_detected: false,
        status: 'unknown',
      };
      continue;
    }

    // Find dominant version
    const freq: Record<string, number> = {};
    for (const v of nonNullVersions) {
      freq[v] = (freq[v] || 0) + 1;
    }
    let dominantId: string | null = null;
    let dominantCount = 0;
    for (const [vid, count] of Object.entries(freq)) {
      if (count > dominantCount) {
        dominantId = vid;
        dominantCount = count;
      }
    }

    const continuityScore = Math.round((dominantCount / outputsChecked) * 100);

    let status: CharacterContinuityResult['status'];
    if (distinctIds.length === 1) {
      status = 'stable';
    } else if (continuityScore >= 50) {
      status = 'mixed';
    } else {
      status = 'broken';
    }

    results[charKey] = {
      character_key: charKey,
      outputs_checked: outputsChecked,
      distinct_actor_version_ids: distinctIds,
      dominant_actor_version_id: dominantId,
      dominant_count: dominantCount,
      continuity_score: continuityScore,
      drift_detected: status === 'mixed' || status === 'broken',
      status,
    };
  }

  return results;
}

/**
 * Full project-level continuity summary.
 */
export async function evaluateProjectContinuity(
  projectId: string,
): Promise<ProjectContinuitySummary> {
  const characters = await evaluateCharacterContinuity(projectId);
  const entries = Object.values(characters);

  const stable_count = entries.filter((e) => e.status === 'stable').length;
  const mixed_count = entries.filter((e) => e.status === 'mixed').length;
  const broken_count = entries.filter((e) => e.status === 'broken').length;
  const unknown_count = entries.filter((e) => e.status === 'unknown').length;

  let overall_status: ProjectContinuitySummary['overall_status'];
  if (broken_count > 0) {
    overall_status = 'broken';
  } else if (mixed_count > 0) {
    overall_status = 'mixed';
  } else {
    overall_status = 'stable';
  }

  return {
    total_characters: entries.length,
    stable_count,
    mixed_count,
    broken_count,
    unknown_count,
    overall_status,
    characters,
  };
}
