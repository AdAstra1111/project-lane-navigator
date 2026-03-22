/**
 * actorIntelligence — Phase 15: Cross-Project Actor Intelligence.
 *
 * READ-ONLY aggregation layer that computes reusability metrics
 * for global AI actors across projects.
 *
 * No mutations. No bindings. No generation.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ActorIntelligenceProfile {
  actor_id: string;
  actor_name: string;
  roster_ready: boolean;
  promotion_status: string | null;
  approved_version_id: string | null;
  tags: string[];
  /** Number of distinct projects using this actor */
  project_count: number;
  /** Number of distinct characters bound to this actor */
  character_count: number;
  /** Projects this actor is used in */
  projects: Array<{ project_id: string; project_title: string; character_key: string }>;
  /** Quality score from latest validation (null if never validated) */
  quality_score: number | null;
  /** Score band from latest validation */
  quality_band: string | null;
  /** Whether actor is promotable based on latest validation */
  promotable: boolean | null;
  /** Reusability tier derived from quality + usage */
  reusability_tier: 'signature' | 'reliable' | 'emerging' | 'unvalidated';
}

export interface ActorIntelligenceSummary {
  total_actors: number;
  roster_ready_count: number;
  multi_project_count: number;
  by_tier: Record<string, number>;
  actors: ActorIntelligenceProfile[];
}

// ── Core ────────────────────────────────────────────────────────────────────

export async function buildActorIntelligence(): Promise<ActorIntelligenceSummary> {
  // 1. Fetch all actors
  const { data: actors, error: actorsErr } = await supabase
    .from('ai_actors')
    .select('id, name, roster_ready, promotion_status, approved_version_id, tags')
    .order('name');

  if (actorsErr) throw actorsErr;
  if (!actors || actors.length === 0) {
    return { total_actors: 0, roster_ready_count: 0, multi_project_count: 0, by_tier: {}, actors: [] };
  }

  // 2. Fetch all cast bindings for usage tracking
  const { data: castRows } = await (supabase as any)
    .from('project_ai_cast')
    .select('ai_actor_id, project_id, character_key');

  // 3. Fetch project titles
  const projectIds = [...new Set((castRows || []).map((r: any) => r.project_id))] as string[];
  const titleMap = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, title')
      .in('id', projectIds);
    for (const p of projects || []) {
      titleMap.set(p.id, p.title || 'Untitled');
    }
  }

  // 4. Build usage map
  const usageMap = new Map<string, Array<{ project_id: string; project_title: string; character_key: string }>>();
  for (const row of castRows || []) {
    const list = usageMap.get(row.ai_actor_id) || [];
    list.push({
      project_id: row.project_id,
      project_title: titleMap.get(row.project_id) || 'Unknown',
      character_key: normalizeCharacterKey(row.character_key || ''),
    });
    usageMap.set(row.ai_actor_id, list);
  }

  // 5. Fetch latest validation results (batch)
  const actorIds = actors.map(a => a.id);
  const { data: validationRuns } = await supabase
    .from('actor_validation_runs')
    .select('actor_id, id, status')
    .in('actor_id', actorIds)
    .eq('status', 'scored')
    .order('created_at', { ascending: false });

  // Get latest scored run per actor
  const latestRunMap = new Map<string, string>();
  for (const run of validationRuns || []) {
    if (!latestRunMap.has(run.actor_id)) {
      latestRunMap.set(run.actor_id, run.id);
    }
  }

  // Fetch results for latest runs
  const runIds = [...latestRunMap.values()];
  const qualityMap = new Map<string, { score: number | null; band: string | null; promotable: boolean }>();
  if (runIds.length > 0) {
    const { data: results } = await supabase
      .from('actor_validation_results')
      .select('validation_run_id, overall_score, score_band, promotable')
      .in('validation_run_id', runIds);

    // Map back to actor_id
    for (const [actorId, runId] of latestRunMap.entries()) {
      const result = (results || []).find(r => r.validation_run_id === runId);
      if (result) {
        qualityMap.set(actorId, {
          score: result.overall_score,
          band: result.score_band,
          promotable: result.promotable,
        });
      }
    }
  }

  // 6. Build profiles
  const profiles: ActorIntelligenceProfile[] = actors.map(actor => {
    const usage = usageMap.get(actor.id) || [];
    const projectSet = new Set(usage.map(u => u.project_id));
    const characterSet = new Set(usage.map(u => u.character_key));
    const quality = qualityMap.get(actor.id);

    // Derive reusability tier
    let reusability_tier: ActorIntelligenceProfile['reusability_tier'] = 'unvalidated';
    if (quality?.score != null) {
      if (quality.score >= 90 && actor.roster_ready) {
        reusability_tier = 'signature';
      } else if (quality.score >= 70 && actor.roster_ready) {
        reusability_tier = 'reliable';
      } else if (quality.score >= 50) {
        reusability_tier = 'emerging';
      }
    }

    return {
      actor_id: actor.id,
      actor_name: actor.name,
      roster_ready: actor.roster_ready,
      promotion_status: actor.promotion_status,
      approved_version_id: actor.approved_version_id,
      tags: actor.tags || [],
      project_count: projectSet.size,
      character_count: characterSet.size,
      projects: usage,
      quality_score: quality?.score ?? null,
      quality_band: quality?.band ?? null,
      promotable: quality?.promotable ?? null,
      reusability_tier,
    };
  });

  // 7. Summary
  const by_tier: Record<string, number> = {};
  for (const p of profiles) {
    by_tier[p.reusability_tier] = (by_tier[p.reusability_tier] || 0) + 1;
  }

  return {
    total_actors: profiles.length,
    roster_ready_count: profiles.filter(p => p.roster_ready).length,
    multi_project_count: profiles.filter(p => p.project_count > 1).length,
    by_tier,
    actors: profiles,
  };
}

/**
 * Get roster-ready actors suitable for casting, with intelligence data.
 */
export async function getRosterActorsForCasting(): Promise<ActorIntelligenceProfile[]> {
  const summary = await buildActorIntelligence();
  return summary.actors
    .filter(a => a.roster_ready && a.approved_version_id)
    .sort((a, b) => {
      // Sort by tier (signature first), then by project count, then name
      const tierOrder = { signature: 0, reliable: 1, emerging: 2, unvalidated: 3 };
      const ta = tierOrder[a.reusability_tier] ?? 3;
      const tb = tierOrder[b.reusability_tier] ?? 3;
      if (ta !== tb) return ta - tb;
      if (b.project_count !== a.project_count) return b.project_count - a.project_count;
      return a.actor_name.localeCompare(b.actor_name);
    });
}
