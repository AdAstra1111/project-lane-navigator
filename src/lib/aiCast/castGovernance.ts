/**
 * castGovernance — Deterministic cast governance engine.
 *
 * Read-only layer that classifies severity and recommends actions
 * based on Phase 7 freshness + impact data.
 *
 * NO mutations. NO automatic actions. Classify + recommend only.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';
import {
  evaluateCastBindingFreshness,
  type BindingFreshness,
} from './castBindingDiagnostics';
import {
  evaluateCastImpact,
  type CastImpactResult,
  type ImpactEntry,
} from './castImpactDiagnostics';

// ── Types ───────────────────────────────────────────────────────────────────

export type GovernanceSeverity = 'healthy' | 'warning' | 'critical';

export type GovernanceRecommendation =
  | 'no_action'
  | 'update_to_latest_version'
  | 'rebind_required'
  | 'regenerate_outputs'
  | 'investigate_missing_binding';

export interface CharacterGovernanceState {
  character_key: string;
  freshness: BindingFreshness;
  severity: GovernanceSeverity;
  recommendations: GovernanceRecommendation[];
  impact_total: number;
  impact_out_of_sync: number;
  bound_actor_id: string | null;
  bound_version_id: string | null;
}

export interface CastGovernanceResult {
  overall_health: GovernanceSeverity;
  total_characters: number;
  severity_counts: Record<GovernanceSeverity, number>;
  characters: Record<string, CharacterGovernanceState>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const OUT_OF_SYNC_CRITICAL_THRESHOLD = 5;

// ── Classification ──────────────────────────────────────────────────────────

export function classifySeverity(
  freshness: BindingFreshness,
  outOfSyncCount: number,
  hasUnboundOutputs: boolean
): GovernanceSeverity {
  // Critical conditions
  if (freshness === 'stale_roster_revoked') return 'critical';
  if (freshness === 'invalid_missing_version') return 'critical';
  if (outOfSyncCount >= OUT_OF_SYNC_CRITICAL_THRESHOLD) return 'critical';
  if (hasUnboundOutputs) return 'critical';

  // Warning conditions
  if (freshness === 'stale_newer_version_available') return 'warning';
  if (outOfSyncCount > 0) return 'warning';

  // Unbound with no outputs is just unbound, not critical
  if (freshness === 'unbound') return 'warning';

  return 'healthy';
}

export function deriveRecommendations(
  freshness: BindingFreshness,
  outOfSyncCount: number,
  hasUnboundOutputs: boolean
): GovernanceRecommendation[] {
  const recs: GovernanceRecommendation[] = [];

  if (freshness === 'stale_newer_version_available') {
    recs.push('update_to_latest_version');
  }
  if (freshness === 'stale_roster_revoked' || freshness === 'invalid_missing_version') {
    recs.push('rebind_required');
  }
  if (outOfSyncCount > 0) {
    recs.push('regenerate_outputs');
  }
  if (hasUnboundOutputs) {
    recs.push('investigate_missing_binding');
  }

  if (recs.length === 0) {
    recs.push('no_action');
  }

  return recs;
}

function deriveOverallHealth(counts: Record<GovernanceSeverity, number>): GovernanceSeverity {
  if (counts.critical > 0) return 'critical';
  if (counts.warning > 0) return 'warning';
  return 'healthy';
}

// ── Project-Level Evaluator ─────────────────────────────────────────────────

export async function evaluateProjectCastHealth(
  projectId: string
): Promise<CastGovernanceResult> {
  // 1. Fetch current bindings
  const { data: bindings } = await (supabase as any)
    .from('project_ai_cast')
    .select('character_key, ai_actor_id, ai_actor_version_id')
    .eq('project_id', projectId) as { data: any[] | null };

  // 2. Fetch actors for freshness evaluation
  const actorIds = [...new Set((bindings || []).map((b: any) => b.ai_actor_id).filter(Boolean))];
  let actorMap: Record<string, { approved_version_id: string | null; roster_ready: boolean }> = {};

  if (actorIds.length > 0) {
    const { data: actorRows } = await supabase
      .from('ai_actors')
      .select('id, approved_version_id, roster_ready')
      .in('id', actorIds);

    for (const a of actorRows || []) {
      actorMap[a.id] = {
        approved_version_id: a.approved_version_id,
        roster_ready: a.roster_ready,
      };
    }
  }

  // 3. Get impact data
  const impactResult = await evaluateCastImpact(projectId);

  // 4. Get all known characters (bindings + impact entries)
  const allKeys = new Set<string>();
  for (const b of bindings || []) {
    allKeys.add(normalizeCharacterKey(b.character_key || ''));
  }
  for (const key of Object.keys(impactResult.entries_by_character)) {
    allKeys.add(key);
  }

  // 5. Classify each character
  const characters: Record<string, CharacterGovernanceState> = {};
  const counts: Record<GovernanceSeverity, number> = { healthy: 0, warning: 0, critical: 0 };

  for (const charKey of allKeys) {
    const binding = (bindings || []).find(
      (b: any) => normalizeCharacterKey(b.character_key || '') === charKey
    );

    const actor = binding?.ai_actor_id ? actorMap[binding.ai_actor_id] || null : null;

    const freshness = evaluateCastBindingFreshness({
      binding: binding ? { ai_actor_version_id: binding.ai_actor_version_id } : null,
      actor,
    });

    const charEntries = impactResult.entries_by_character[charKey] || [];
    const outOfSyncCount = charEntries.filter(
      (e) => e.status === 'out_of_sync_with_current_cast'
    ).length;
    const hasUnboundOutputs = charEntries.some((e) => e.status === 'unbound');

    const severity = classifySeverity(freshness, outOfSyncCount, hasUnboundOutputs);
    const recommendations = deriveRecommendations(freshness, outOfSyncCount, hasUnboundOutputs);

    characters[charKey] = {
      character_key: charKey,
      freshness,
      severity,
      recommendations,
      impact_total: charEntries.length,
      impact_out_of_sync: outOfSyncCount,
      bound_actor_id: binding?.ai_actor_id || null,
      bound_version_id: binding?.ai_actor_version_id || null,
    };

    counts[severity]++;
  }

  return {
    overall_health: deriveOverallHealth(counts),
    total_characters: allKeys.size,
    severity_counts: counts,
    characters,
  };
}

/**
 * Get impacted outputs for a specific character in a project.
 */
export async function getImpactedOutputs(
  projectId: string,
  characterKey: string
): Promise<{ out_of_sync: ImpactEntry[]; unbound: ImpactEntry[] }> {
  const impact = await evaluateCastImpact(projectId);
  const normKey = normalizeCharacterKey(characterKey);
  const entries = impact.entries_by_character[normKey] || [];

  return {
    out_of_sync: entries.filter((e) => e.status === 'out_of_sync_with_current_cast'),
    unbound: entries.filter((e) => e.status === 'unbound'),
  };
}
