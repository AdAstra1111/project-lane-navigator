/**
 * Ruleset UI State — Persist and load per-project, per-lane preferences.
 * Uses DB (project_lane_prefs) with localStorage fallback.
 */
import { supabase } from '@/integrations/supabase/client';

export interface RulesetPrefs {
  active_engine_profile_id?: string | null;
  auto_diversify?: boolean;
  lock_ruleset?: boolean;
  pacing_feel?: string;
  style_benchmark?: string | null;
  last_ui?: {
    restraint?: number;
    conflict_mode?: string;
    story_engine?: string;
    causal_grammar?: string;
  };
  comps?: {
    include_films?: boolean;
    include_series?: boolean;
    include_vertical?: boolean;
  };
}

const LS_KEY = (projectId: string, lane: string) =>
  `iffy_ruleset_prefs_${projectId}_${lane}`;

function readLocalCache(projectId: string, lane: string): RulesetPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY(projectId, lane));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalCache(projectId: string, lane: string, prefs: RulesetPrefs) {
  try {
    localStorage.setItem(LS_KEY(projectId, lane), JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export async function loadProjectLaneRulesetPrefs(
  projectId: string,
  lane: string,
): Promise<RulesetPrefs> {
  try {
    const { data, error } = await (supabase as any)
      .from('project_lane_prefs')
      .select('prefs')
      .eq('project_id', projectId)
      .eq('lane', lane)
      .maybeSingle();

    if (!error && data?.prefs) {
      const prefs = data.prefs as RulesetPrefs;
      writeLocalCache(projectId, lane, prefs);
      return prefs;
    }
  } catch {
    // fall through to localStorage
  }
  return readLocalCache(projectId, lane);
}

export async function saveProjectLaneRulesetPrefs(
  projectId: string,
  lane: string,
  prefs: RulesetPrefs,
  userId: string,
): Promise<void> {
  writeLocalCache(projectId, lane, prefs);
  try {
    await (supabase as any)
      .from('project_lane_prefs')
      .upsert(
        {
          project_id: projectId,
          lane,
          prefs,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,lane' },
      );
  } catch (err) {
    console.warn('Failed to persist ruleset prefs to DB:', err);
  }
}
