/**
 * useGenerateFullShotPlan — Durable one-click orchestration to generate shots for all scenes.
 * Persists job + per-scene progress in DB. Supports pause / resume / reset.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { shotsGenerateForScene } from '@/lib/scene-graph/client';
import type { SceneListItem } from '@/lib/scene-graph/types';

export interface FullShotPlanProgress {
  stage: 'idle' | 'parsing_script' | 'segmenting_scenes' | 'generating_shots' | 'saving_to_database' | 'complete';
  stageIndex: number;
  progress: number;
  etaSeconds: number;
  detail: string;
  inserted: number;
  total: number;
}

export interface ShotPlanJob {
  id: string;
  project_id: string;
  status: 'running' | 'paused' | 'cancelled' | 'completed' | 'failed';
  total_scenes: number;
  completed_scenes: number;
  inserted_shots: number;
  last_scene_id: string | null;
  last_message: string | null;
  started_at: string;
  finished_at: string | null;
}

const STAGES = [
  'Parsing Script',
  'Segmenting Scenes',
  'Generating Shots',
  'Saving to Database',
  'Complete',
];

export function useGenerateFullShotPlan(projectId: string | undefined, scenes: SceneListItem[]) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<FullShotPlanProgress>({
    stage: 'idle', stageIndex: 0, progress: 0, etaSeconds: 0, detail: '', inserted: 0, total: 0,
  });
  const startTimeRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  const pauseRequestedRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  // Fetch active job for this project (running or paused)
  const activeJobQuery = useQuery({
    queryKey: ['shot-plan-job', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data } = await supabase
        .from('shot_plan_jobs')
        .select('*')
        .eq('project_id', projectId)
        .in('status', ['running', 'paused'])
        .order('started_at', { ascending: false })
        .limit(1);
      return (data?.[0] as ShotPlanJob | undefined) ?? null;
    },
    enabled: !!projectId,
  });

  const activeJob = activeJobQuery.data;

  // Restore progress display from active job
  useEffect(() => {
    if (activeJob && !isRunning) {
      const pct = activeJob.total_scenes > 0
        ? 20 + Math.round((activeJob.completed_scenes / activeJob.total_scenes) * 65)
        : 0;
      setProgress({
        stage: activeJob.status === 'paused' ? 'generating_shots' : 'generating_shots',
        stageIndex: 2,
        progress: pct,
        etaSeconds: 0,
        detail: activeJob.status === 'paused'
          ? `Paused — ${activeJob.completed_scenes}/${activeJob.total_scenes} scenes done`
          : `${activeJob.completed_scenes}/${activeJob.total_scenes} scenes`,
        inserted: activeJob.inserted_shots,
        total: activeJob.total_scenes,
      });
      jobIdRef.current = activeJob.id;
    } else if (!activeJob && !isRunning) {
      setProgress({ stage: 'idle', stageIndex: 0, progress: 0, etaSeconds: 0, detail: '', inserted: 0, total: 0 });
      jobIdRef.current = null;
    }
  }, [activeJob, isRunning]);

  const reset = useCallback(() => {
    pauseRequestedRef.current = false;
    setIsRunning(false);
    setProgress({ stage: 'idle', stageIndex: 0, progress: 0, etaSeconds: 0, detail: '', inserted: 0, total: 0 });
  }, []);

  // Helper: update job row
  const updateJob = useCallback(async (jobId: string, patch: Record<string, any>) => {
    await supabase.from('shot_plan_jobs').update(patch).eq('id', jobId);
  }, []);

  // Core generation loop (works for both start and resume)
  const runGeneration = useCallback(async (jobId: string, scenesToProcess: SceneListItem[], totalScenes: number, startedCompleted: number) => {
    setIsRunning(true);
    pauseRequestedRef.current = false;
    startTimeRef.current = Date.now();

    let totalInserted = 0;
    // Fetch already inserted shots count from job
    const { data: jobRow } = await supabase.from('shot_plan_jobs').select('inserted_shots').eq('id', jobId).single();
    totalInserted = jobRow?.inserted_shots ?? 0;

    for (let i = 0; i < scenesToProcess.length; i++) {
      // Check pause
      if (pauseRequestedRef.current) {
        await updateJob(jobId, {
          status: 'paused',
          last_message: `Paused at scene ${startedCompleted + i}/${totalScenes}`,
        });
        setProgress(p => ({
          ...p,
          detail: `Paused — ${startedCompleted + i}/${totalScenes} scenes done`,
        }));
        setIsRunning(false);
        qc.invalidateQueries({ queryKey: ['shot-plan-job', projectId] });
        return { paused: true, inserted: totalInserted };
      }

      const scene = scenesToProcess[i];
      const globalIdx = startedCompleted + i;
      const sceneProgress = 20 + Math.round((globalIdx / totalScenes) * 65);
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const perScene = i > 0 ? elapsed / i : 8;
      const remaining = Math.max(0, Math.round(perScene * (scenesToProcess.length - i)));

      setProgress({
        stage: 'generating_shots',
        stageIndex: 2,
        progress: sceneProgress,
        etaSeconds: remaining,
        detail: `Scene ${globalIdx + 1}/${totalScenes}: ${scene.latest_version?.slugline || scene.display_number}`,
        inserted: totalInserted,
        total: totalScenes,
      });

      let shotCount = 0;
      try {
        const result = await shotsGenerateForScene({
          projectId: projectId!,
          sceneId: scene.scene_id,
          mode: 'coverage',
        });
        shotCount = result.shots?.length || 0;
        totalInserted += shotCount;

        // Mark scene completed in DB
        await supabase.from('shot_plan_job_scenes').update({
          status: 'completed',
          inserted_shots: shotCount,
          finished_at: new Date().toISOString(),
        }).eq('job_id', jobId).eq('scene_id', scene.scene_id);
      } catch (err: any) {
        console.warn(`Shot gen failed for scene ${scene.display_number}:`, err);
        await supabase.from('shot_plan_job_scenes').update({
          status: 'failed',
          error_message: err?.message || 'Unknown error',
          finished_at: new Date().toISOString(),
        }).eq('job_id', jobId).eq('scene_id', scene.scene_id);
      }

      // Update job counters
      await updateJob(jobId, {
        completed_scenes: globalIdx + 1,
        inserted_shots: totalInserted,
        last_scene_id: scene.scene_id,
        last_message: `Completed scene ${globalIdx + 1}/${totalScenes}`,
      });
    }

    // Finalize
    setProgress({
      stage: 'complete', stageIndex: 4, progress: 100, etaSeconds: 0,
      detail: `Generated ${totalInserted} shots across ${totalScenes} scenes`,
      inserted: totalInserted, total: totalScenes,
    });

    await updateJob(jobId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      last_message: `Complete: ${totalInserted} shots across ${totalScenes} scenes`,
    });

    setIsRunning(false);
    qc.invalidateQueries({ queryKey: ['shot-plan-job', projectId] });
    return { paused: false, inserted: totalInserted };
  }, [projectId, qc, updateJob]);

  // Start new job
  const startMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('No project');
      if (scenes.length === 0) throw new Error('No scenes available');

      // Stage 1: Parsing
      setProgress({ stage: 'parsing_script', stageIndex: 0, progress: 5, etaSeconds: scenes.length * 8, detail: 'Validating script scenes…', inserted: 0, total: scenes.length });
      setIsRunning(true);

      // Create job row
      const { data: job, error } = await supabase.from('shot_plan_jobs').insert({
        project_id: projectId,
        status: 'running',
        total_scenes: scenes.length,
        last_message: 'Starting…',
      }).select().single();
      if (error || !job) throw new Error(error?.message || 'Failed to create job');
      jobIdRef.current = job.id;

      // Stage 2: Segmenting — create scene rows
      setProgress(p => ({ ...p, stage: 'segmenting_scenes', stageIndex: 1, progress: 15, detail: `Found ${scenes.length} scenes to process` }));

      const sceneRows = scenes.map(s => ({
        job_id: job.id,
        project_id: projectId,
        scene_id: s.scene_id,
        status: 'pending' as const,
      }));
      await supabase.from('shot_plan_job_scenes').insert(sceneRows);

      // Stage 3: Generate
      const result = await runGeneration(job.id, scenes, scenes.length, 0);
      return { inserted: result.inserted, total: scenes.length, paused: result.paused };
    },
    onSuccess: (data) => {
      if (!data.paused) {
        toast.success(`Shot plan generated: ${data.inserted} shots across ${data.total} scenes`);
        qc.invalidateQueries({ queryKey: ['vp-shots', projectId] });
      } else {
        toast.info('Shot plan paused. You can resume anytime.');
      }
    },
    onError: (e: Error) => {
      toast.error(`Shot plan failed: ${e.message}`);
      reset();
    },
  });

  // Resume existing job
  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!projectId || !activeJob) throw new Error('No active job to resume');

      // Mark job as running
      await updateJob(activeJob.id, { status: 'running', last_message: 'Resuming…' });
      jobIdRef.current = activeJob.id;

      // Find remaining scenes
      const { data: jobScenes } = await supabase
        .from('shot_plan_job_scenes')
        .select('scene_id, status')
        .eq('job_id', activeJob.id);

      const completedSceneIds = new Set(
        (jobScenes || []).filter(s => s.status === 'completed').map(s => s.scene_id)
      );
      const remainingScenes = scenes.filter(s => !completedSceneIds.has(s.scene_id));

      if (remainingScenes.length === 0) {
        await updateJob(activeJob.id, { status: 'completed', finished_at: new Date().toISOString() });
        toast.success('All scenes already completed!');
        qc.invalidateQueries({ queryKey: ['shot-plan-job', projectId] });
        return { inserted: activeJob.inserted_shots, total: activeJob.total_scenes, paused: false };
      }

      setProgress(p => ({ ...p, detail: `Resuming — ${remainingScenes.length} scenes remaining` }));

      const result = await runGeneration(
        activeJob.id,
        remainingScenes,
        activeJob.total_scenes,
        activeJob.completed_scenes,
      );
      return { inserted: result.inserted, total: activeJob.total_scenes, paused: result.paused };
    },
    onSuccess: (data) => {
      if (!data.paused) {
        toast.success(`Shot plan completed: ${data.inserted} shots across ${data.total} scenes`);
        qc.invalidateQueries({ queryKey: ['vp-shots', projectId] });
      } else {
        toast.info('Shot plan paused.');
      }
    },
    onError: (e: Error) => {
      toast.error(`Resume failed: ${e.message}`);
      reset();
    },
  });

  // Pause
  const pause = useCallback(() => {
    pauseRequestedRef.current = true;
  }, []);

  // Reset / cancel
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const jid = jobIdRef.current || activeJob?.id;
      if (jid) {
        await updateJob(jid, { status: 'cancelled', finished_at: new Date().toISOString() });
      }
      pauseRequestedRef.current = true;
    },
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['shot-plan-job', projectId] });
      toast.info('Shot plan cancelled.');
    },
  });

  const isPaused = activeJob?.status === 'paused' && !isRunning;
  const hasActiveJob = !!activeJob && !isRunning;

  return {
    generateFullShotPlan: startMutation,
    resumeShotPlan: resumeMutation,
    cancelShotPlan: cancelMutation,
    pause,
    progress,
    stages: STAGES,
    isRunning,
    isPaused,
    hasActiveJob,
    activeJob,
    reset,
  };
}
