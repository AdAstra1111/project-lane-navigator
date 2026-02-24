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
    mutationFn: async (params: {
      canonPackId: string;
      trailerType?: string;
      genreKey?: string;
      platformKey?: string;
      seed?: string;
      styleOptions?: TrailerStyleOptions;
      inspirationRefs?: { title: string; url?: string; notes?: string }[];
      referenceNotes?: string;
      avoidNotes?: string;
      strictCanonMode?: 'strict' | 'balanced';
      targetLengthMs?: number;
      stylePresetKey?: string;
      onStageChange?: (stage: number) => void;
    }) => {
      const { onStageChange, ...apiParams } = params;

      // Step 1: Create script
      onStageChange?.(0);
      const scriptData = await cinematicApi.createTrailerScript({ projectId: projectId!, ...apiParams });
      if (!scriptData.scriptRunId) throw new Error(scriptData.error || 'Script generation failed');

      // Step 1b: Run initial judge for repair check
      onStageChange?.(1);
      const judgeData1 = await cinematicApi.runJudge({
        projectId: projectId!,
        scriptRunId: scriptData.scriptRunId,
      });

      // Step 1c: Repair if needed
      if (judgeData1.repairActions?.length > 0) {
        await cinematicApi.repairScript({
          projectId: projectId!,
          scriptRunId: scriptData.scriptRunId,
          judgeRunId: judgeData1.judgeRunId,
          canonPackId: params.canonPackId,
        });
      }

      // Step 2: Rhythm grid
      onStageChange?.(2);
      const rhythmData = await cinematicApi.createRhythmGrid({
        projectId: projectId!,
        scriptRunId: scriptData.scriptRunId,
        seed: params.seed ? `${params.seed}-rhythm` : undefined,
      });

      // Step 3: Shot design
      onStageChange?.(3);
      const shotData = await cinematicApi.createShotDesign({
        projectId: projectId!,
        scriptRunId: scriptData.scriptRunId,
        rhythmRunId: rhythmData.rhythmRunId,
        seed: params.seed ? `${params.seed}-shots` : undefined,
      });

      // Step 4: Final judge
      onStageChange?.(4);
      const judgeData = await cinematicApi.runJudge({
        projectId: projectId!,
        scriptRunId: scriptData.scriptRunId,
        rhythmRunId: rhythmData.rhythmRunId,
        shotDesignRunId: shotData.shotDesignRunId,
      });

      return {
        ok: true,
        scriptRunId: scriptData.scriptRunId,
        rhythmRunId: rhythmData.rhythmRunId,
        shotDesignRunId: shotData.shotDesignRunId,
        judgeRunId: judgeData.judgeRunId,
        scores: judgeData.scores,
        gatesPassed: judgeData.gatesPassed,
      };
    },
    onSuccess: async (data) => {
      if (data.ok) {
        toast.success('Cinematic plan created successfully');
        // Auto-export as project document
        if (data.scriptRunId) {
          try {
            await cinematicApi.exportTrailerScriptDocument({
              projectId: projectId!,
              scriptRunId: data.scriptRunId,
            });
            qc.invalidateQueries({ queryKey: ['project-documents', projectId] });
          } catch (e) {
            console.warn('Auto-export trailer script document failed:', e);
          }
        }
      } else {
        toast.warning('Plan partially completed');
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
      inspirationRefs?: { title: string; url?: string; notes?: string }[];
      referenceNotes?: string;
      avoidNotes?: string;
      strictCanonMode?: 'strict' | 'balanced';
      targetLengthMs?: number;
      stylePresetKey?: string;
    }) => cinematicApi.createTrailerScript({ projectId: projectId!, ...params }),
    onSuccess: async (data) => {
      toast.success(`Script created: ${data.beatCount} beats (${data.status})`);
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
      // Auto-export as project document
      if (data.scriptRunId) {
        try {
          await cinematicApi.exportTrailerScriptDocument({
            projectId: projectId!,
            scriptRunId: data.scriptRunId,
          });
          qc.invalidateQueries({ queryKey: ['project-documents', projectId] });
        } catch (e) {
          console.warn('Auto-export trailer script document failed:', e);
        }
      }
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

  const exportTrailerScriptDocument = useMutation({
    mutationFn: (params: { scriptRunId: string; forceNewVersion?: boolean }) =>
      cinematicApi.exportTrailerScriptDocument({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Trailer Script exported as document (${data.beatCount} beats, ${data.chars} chars)`);
      qc.invalidateQueries({ queryKey: ['package-status', projectId] });
      qc.invalidateQueries({ queryKey: ['project-documents', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createScriptVariants = useMutation({
    mutationFn: (params: {
      canonPackId: string;
      trailerType?: string;
      genreKey?: string;
      platformKey?: string;
      seedBase?: string;
      styleOptions?: TrailerStyleOptions;
      variants?: string[];
      inspirationRefs?: { title: string; url?: string; notes?: string }[];
      referenceNotes?: string;
      avoidNotes?: string;
      strictCanonMode?: 'strict' | 'balanced';
      targetLengthMs?: number;
    }) => cinematicApi.createScriptVariants({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      const ok = data.variants?.filter((v: any) => v.scriptRunId).length || 0;
      toast.success(`Generated ${ok} script variant(s)`);
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectScriptRun = useMutation({
    mutationFn: (params: { scriptRunId: string }) =>
      cinematicApi.selectScriptRun({ projectId: projectId!, ...params }),
    onSuccess: () => {
      toast.success('Script run selected as active');
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerateCrescendoMontage = useMutation({
    mutationFn: (params: { scriptRunId: string; shotDesignRunId: string; seed?: string }) =>
      cinematicApi.regenerateCrescendoMontage({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Regenerated ${data.regeneratedSpecs} crescendo montage shots`);
      qc.invalidateQueries({ queryKey: ['cinematic-shot-design-runs'] });
      qc.invalidateQueries({ queryKey: ['cinematic-shot-specs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runTrailerPipeline = useMutation({
    mutationFn: (params: {
      canonPackId: string;
      trailerType?: string;
      genreKey?: string;
      platformKey?: string;
      seed?: string;
      idempotencyKey?: string;
      styleOptions?: TrailerStyleOptions;
      inspirationRefs?: { title: string; url?: string; notes?: string }[];
      referenceNotes?: string;
      avoidNotes?: string;
      strictCanonMode?: 'strict' | 'balanced';
      targetLengthMs?: number;
      stylePresetKey?: string;
    }) => cinematicApi.runTrailerPipeline({ projectId: projectId!, ...params }),
    onSuccess: async (data) => {
      if (data.ok) {
        toast.success(data.status === 'complete' ? 'Pipeline complete — all gates passed' : 'Pipeline finished — review flagged issues');
      } else {
        toast.warning(`Pipeline partially completed: ${data.error}`);
      }
      qc.invalidateQueries({ queryKey: ['cinematic-script-runs', projectId] });
      qc.invalidateQueries({ queryKey: ['cinematic-rhythm-runs'] });
      qc.invalidateQueries({ queryKey: ['cinematic-shot-design-runs'] });
      qc.invalidateQueries({ queryKey: ['cinematic-judge-runs'] });
      qc.invalidateQueries({ queryKey: ['project-documents', projectId] });
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
    exportTrailerScriptDocument,
    createScriptVariants,
    selectScriptRun,
    regenerateCrescendoMontage,
    runTrailerPipeline,
  };
}

// ─── Learning Signals (lightweight direct insert for UI actions) ───

export async function writeLearnSignal(params: {
  projectId: string;
  scriptRunId?: string;
  signalKey: string;
  signalType?: string;
  signalValueNum?: number;
  signalValueJson?: Record<string, any>;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('trailer_learning_signals').insert({
    project_id: params.projectId,
    script_run_id: params.scriptRunId || null,
    signal_type: params.signalType || 'user_action',
    signal_key: params.signalKey,
    signal_value_num: params.signalValueNum ?? null,
    signal_value_json: params.signalValueJson ?? null,
    source: 'timeline_ui',
    created_by: session.user.id,
  } as any);
}

/** Log clip manual selection signal */
export async function logClipSelectionSignal(params: {
  projectId: string;
  clipId: string;
  provider?: string;
  motionScore?: number;
  technicalScore?: number;
  beatPhase?: string;
  generationProfile?: string;
}) {
  await writeLearnSignal({
    projectId: params.projectId,
    signalKey: 'manual_select',
    signalType: 'clip_selection',
    signalValueJson: {
      clip_id: params.clipId,
      provider: params.provider,
      generation_profile: params.generationProfile,
      motion_score: params.motionScore,
      technical_score: params.technicalScore,
      beat_phase: params.beatPhase,
    },
  });
}

/** Log clip override signal */
export async function logClipOverrideSignal(params: {
  projectId: string;
  previousClipId?: string;
  newClipId: string;
  phase?: string;
}) {
  await writeLearnSignal({
    projectId: params.projectId,
    signalKey: 'override_auto_pick',
    signalType: 'clip_override',
    signalValueJson: {
      previous_clip_id: params.previousClipId,
      new_clip_id: params.newClipId,
      phase: params.phase,
    },
  });
}

/** Log variant selection signal */
export async function logVariantSelectionSignal(params: {
  projectId: string;
  scriptRunId: string;
  variantLabel?: string;
  tonePreset?: string;
  cameraStyle?: string;
}) {
  await writeLearnSignal({
    projectId: params.projectId,
    scriptRunId: params.scriptRunId,
    signalKey: 'variant_preference',
    signalType: 'script_variant_selected',
    signalValueJson: {
      variant_label: params.variantLabel,
      tonePreset: params.tonePreset,
      cameraStyle: params.cameraStyle,
    },
  });
}

/** Log cut approval signal */
export async function logCutApprovalSignal(params: {
  projectId: string;
  blueprintId?: string;
  scriptRunId?: string;
  generationProfile?: string;
  averageMotionScore?: number;
  bpm?: number;
  dropTimestampMs?: number;
}) {
  await writeLearnSignal({
    projectId: params.projectId,
    scriptRunId: params.scriptRunId,
    signalKey: 'final_cut',
    signalType: 'cut_approved',
    signalValueJson: {
      blueprint_id: params.blueprintId,
      script_run_id: params.scriptRunId,
      generation_profile: params.generationProfile,
      average_motion_score: params.averageMotionScore,
      bpm: params.bpm,
      drop_timestamp_ms: params.dropTimestampMs,
    },
  });
}
