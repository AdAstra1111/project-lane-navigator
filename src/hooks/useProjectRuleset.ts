/**
 * useProjectRuleset — Central hook for loading/managing ruleset state per project+lane.
 * Provides: active engine profile, prefs, resolved rules helper, mutation to resolve for a run.
 */
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  loadProjectLaneRulesetPrefs,
  saveProjectLaneRulesetPrefs,
  type RulesetPrefs,
} from '@/lib/rulesets/uiState';
import type { EngineProfile, RuleConflict } from '@/lib/rulesets/types';

export interface ActiveEngineProfile {
  id: string;
  name: string;
  lane: string;
  rules: EngineProfile;
  rules_summary: string;
  conflicts: RuleConflict[];
  created_at: string;
}

const PREFS_KEY = (projectId: string, lane: string) => ['ruleset-prefs', projectId, lane];
const PROFILE_KEY = (projectId: string, lane: string) => ['active-engine-profile', projectId, lane];

export function useProjectRuleset(projectId: string | undefined, lane: string) {
  const qc = useQueryClient();

  // Load prefs
  const prefsQuery = useQuery<RulesetPrefs>({
    queryKey: PREFS_KEY(projectId || '', lane),
    queryFn: () => loadProjectLaneRulesetPrefs(projectId!, lane),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const prefs = prefsQuery.data || {};

  // Load active engine profile
  const profileQuery = useQuery<ActiveEngineProfile | null>({
    queryKey: PROFILE_KEY(projectId || '', lane),
    queryFn: async () => {
      if (!projectId) return null;

      // If prefs specify a profile ID, load that; otherwise load most recent active
      const profileId = prefs.active_engine_profile_id;

      let query = (supabase as any)
        .from('engine_profiles')
        .select('id, name, lane, rules, rules_summary, conflicts, created_at')
        .eq('project_id', projectId)
        .eq('lane', lane)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (profileId) {
        query = (supabase as any)
          .from('engine_profiles')
          .select('id, name, lane, rules, rules_summary, conflicts, created_at')
          .eq('id', profileId)
          .limit(1);
      }

      const { data, error } = await query;
      if (error || !data?.length) return null;
      return data[0] as ActiveEngineProfile;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  // Use a ref to always read the latest prefs (avoids stale closure in rapid mutations)
  const prefsRef = React.useRef(prefs);
  React.useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  // Save prefs mutation — reads latest prefs via ref to avoid stale merges
  const savePrefs = useMutation({
    mutationFn: async (newPrefs: Partial<RulesetPrefs>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !projectId) throw new Error('Not authenticated');
      const merged = { ...prefsRef.current, ...newPrefs };
      await saveProjectLaneRulesetPrefs(projectId, lane, merged, user.id);
      return merged;
    },
    onSuccess: (merged) => {
      qc.setQueryData(PREFS_KEY(projectId || '', lane), merged);
      // Update ref immediately so next rapid mutation sees this result
      prefsRef.current = merged;
    },
  });

  // Resolve rules for a run (calls comps-engine edge function)
  const resolveForRun = useMutation({
    mutationFn: async (params?: { runId?: string; runType?: string }) => {
      if (!projectId) throw new Error('No project');
      const { data, error } = await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'resolve_rules_for_run',
          project_id: projectId,
          lane,
          engine_profile_id: profileQuery.data?.id || null,
          run_id: params?.runId,
          run_type: params?.runType,
        },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onError: (e: Error) => toast.error(`Ruleset resolve failed: ${e.message}`),
  });

  return {
    prefs,
    prefsQuery,
    profileQuery,
    activeProfile: profileQuery.data,
    savePrefs,
    resolveForRun,
    isLocked: prefs.lock_ruleset ?? false,
    autoDiversify: prefs.auto_diversify ?? true,
    invalidateProfile: () => qc.invalidateQueries({ queryKey: PROFILE_KEY(projectId || '', lane) }),
    invalidatePrefs: () => qc.invalidateQueries({ queryKey: PREFS_KEY(projectId || '', lane) }),
  };
}
