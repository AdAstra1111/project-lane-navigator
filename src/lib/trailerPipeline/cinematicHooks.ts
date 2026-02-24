/**
 * Trailer Cinematic Engine — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cinematicApi, type TrailerStyleOptions } from './cinematicApi';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─── Queries ───

export function useScriptRuns(projectId: string | undefined) {
  return useQuery({
    queryKey: ['cinematic-script-runs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_script_runs')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });
}

export function useScriptBeats(scriptRunId: string | undefined) {
  return useQuery({
    queryKey: ['cinematic-script-beats', scriptRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_script_beats')
        .select('*')
        .eq('script_run_id', scriptRunId!)
        .order('beat_index');
      if (error) throw error;
      return data || [];
    },
    enabled: !!scriptRunId,
  });
}

export function useRhythmRuns(scriptRunId: string | undefined) {
  return useQuery({
    queryKey: ['cinematic-rhythm-runs', scriptRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_rhythm_runs')
        .select('*')
        .eq('script_run_id', scriptRunId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!scriptRunId,
  });
}

export function useShotDesignRuns(scriptRunId: string | undefined) {
  return useQuery({
    queryKey: ['cinematic-shot-design-runs', scriptRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_shot_design_runs')
        .select('*')
        .eq('script_run_id', scriptRunId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!scriptRunId,
  });
}

export function useShotSpecs(shotDesignRunId: string | undefined) {
  return useQuery({
    queryKey: ['cinematic-shot-specs', shotDesignRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_shot_specs')
        .select('*')
        .eq('shot_design_run_id', shotDesignRunId!)
        .order('shot_index');
      if (error) throw error;
      return data || [];
    },
    enabled: !!shotDesignRunId,
  });
}

export function useJudgeRuns(scriptRunId: string | undefined) {
  return useQuery({
    queryKey: ['cinematic-judge-runs', scriptRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_judge_v2_runs')
        .select('*')
        .eq('script_run_id', scriptRunId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!scriptRunId,
  });
}

// ─── Mutations ───

export function useCinematicMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const createFullPlan = useMutation({
    mutationFn: (params: {
      canonPackId: string;
      trailerType?: string;
      genreKey?: string;
      platformKey?: string;
      seed?: string;
      styleOptions?: TrailerStyleOptions;
    }) => cinematicApi.createFullPlan({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(`Cinematic plan created: ${data.steps?.length || 0} steps completed`);
      } else {
        toast.warning(data.error || 'Plan partially completed');
      }
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createScript = useMutation({
    mutationFn: (params: {
      canonPackId: string;
      trailerType?: string;
      genreKey?: string;
      platformKey?: string;
      seed?: string;
      styleOptions?: TrailerStyleOptions;
    }) => cinematicApi.createTrailerScript({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Script created: ${data.beatCount} beats (${data.status})`);
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRhythmGrid = useMutation({
    mutationFn: (params: { scriptRunId: string; seed?: string }) =>
      cinematicApi.createRhythmGrid({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Rhythm grid created: ${data.bpm} BPM`);
      qc.invalidateQueries({ queryKey: ['cinematic-rhythm-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createShotDesign = useMutation({
    mutationFn: (params: { scriptRunId: string; rhythmRunId?: string; seed?: string }) =>
      cinematicApi.createShotDesign({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Shot design created: ${data.shotCount} specs`);
      qc.invalidateQueries({ queryKey: ['cinematic-shot-design-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runJudge = useMutation({
    mutationFn: (params: { scriptRunId: string; rhythmRunId?: string; shotDesignRunId?: string }) =>
      cinematicApi.runJudge({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      if (data.gatesPassed) {
        toast.success('Judge passed — ready for clips');
      } else {
        toast.warning(`Judge flagged issues: ${data.blockers?.join(', ')}`);
      }
      qc.invalidateQueries({ queryKey: ['cinematic-judge-runs'] });
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repairScript = useMutation({
    mutationFn: (params: { scriptRunId: string; judgeRunId?: string; canonPackId?: string }) =>
      cinematicApi.repairScript({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Repaired ${data.updatedBeats} beats (${data.status})`);
      qc.invalidateQueries({ queryKey: ['cinematic-script-beats'] });
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startClipGeneration = useMutation({
    mutationFn: (params: { scriptRunId: string; shotDesignRunId: string }) =>
      cinematicApi.startClipGeneration({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Clip generation ready: ${data.shotSpecCount} specs across ${data.beatCount} beats`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    createFullPlan,
    createScript,
    createRhythmGrid,
    createShotDesign,
    runJudge,
    repairScript,
    startClipGeneration,
  };
}

// ─── Learning Signals (lightweight direct insert for UI actions) ───

export async function writeLearnSignal(params: {
  projectId: string;
  scriptRunId?: string;
  signalKey: string;
  signalValueNum?: number;
  signalValueJson?: Record<string, any>;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('trailer_learning_signals').insert({
    project_id: params.projectId,
    script_run_id: params.scriptRunId || null,
    signal_type: 'user_action',
    signal_key: params.signalKey,
    signal_value_num: params.signalValueNum ?? null,
    signal_value_json: params.signalValueJson ?? null,
    source: 'timeline_ui',
    created_by: session.user.id,
  } as any);
}
