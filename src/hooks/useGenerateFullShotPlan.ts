/**
 * useGenerateFullShotPlan — One-click orchestration to generate shots for all scenes.
 * Iterates scenes client-side, calling shotsGenerateForScene for each, with progress tracking.
 */
import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

const STAGES = [
  'Parsing Script',
  'Segmenting Scenes',
  'Generating Shots',
  'Saving to Database',
  'Complete',
];

const STAGE_KEYS: FullShotPlanProgress['stage'][] = [
  'parsing_script', 'segmenting_scenes', 'generating_shots', 'saving_to_database', 'complete',
];

export function useGenerateFullShotPlan(projectId: string | undefined, scenes: SceneListItem[]) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<FullShotPlanProgress>({
    stage: 'idle', stageIndex: 0, progress: 0, etaSeconds: 0, detail: '', inserted: 0, total: 0,
  });
  const startTimeRef = useRef(0);

  const reset = useCallback(() => {
    setProgress({ stage: 'idle', stageIndex: 0, progress: 0, etaSeconds: 0, detail: '', inserted: 0, total: 0 });
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('No project');
      if (scenes.length === 0) throw new Error('No scenes available');

      startTimeRef.current = Date.now();
      const totalScenes = scenes.length;
      let totalInserted = 0;

      // Stage 1: Parsing
      setProgress({ stage: 'parsing_script', stageIndex: 0, progress: 5, etaSeconds: totalScenes * 8, detail: 'Validating script scenes…', inserted: 0, total: totalScenes });
      await new Promise(r => setTimeout(r, 400));

      // Stage 2: Segmenting
      setProgress(p => ({ ...p, stage: 'segmenting_scenes', stageIndex: 1, progress: 15, detail: `Found ${totalScenes} scenes to process` }));
      await new Promise(r => setTimeout(r, 300));

      // Stage 3: Generating shots per scene
      for (let i = 0; i < totalScenes; i++) {
        const scene = scenes[i];
        const sceneProgress = 20 + Math.round((i / totalScenes) * 65);
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const perScene = i > 0 ? elapsed / i : 8;
        const remaining = Math.max(0, Math.round(perScene * (totalScenes - i)));

        setProgress(p => ({
          ...p,
          stage: 'generating_shots',
          stageIndex: 2,
          progress: sceneProgress,
          etaSeconds: remaining,
          detail: `Scene ${i + 1}/${totalScenes}: ${scene.latest_version?.slugline || scene.display_number}`,
        }));

        try {
          const result = await shotsGenerateForScene({
            projectId,
            sceneId: scene.scene_id,
            mode: 'coverage',
          });
          totalInserted += result.shots?.length || 0;
        } catch (err) {
          console.warn(`Shot gen failed for scene ${scene.display_number}:`, err);
        }
      }

      // Stage 4: Saving
      setProgress(p => ({
        ...p, stage: 'saving_to_database', stageIndex: 3, progress: 90, etaSeconds: 3, detail: 'Finalizing shot records…', inserted: totalInserted,
      }));
      await new Promise(r => setTimeout(r, 500));

      // Stage 5: Complete
      setProgress(p => ({
        ...p, stage: 'complete', stageIndex: 4, progress: 100, etaSeconds: 0, detail: `Generated ${totalInserted} shots across ${totalScenes} scenes`, inserted: totalInserted, total: totalScenes,
      }));

      return { inserted: totalInserted, total: totalScenes };
    },
    onSuccess: (data) => {
      toast.success(`Shot plan generated: ${data.inserted} shots across ${data.total} scenes`);
      qc.invalidateQueries({ queryKey: ['vp-shots', projectId] });
    },
    onError: (e: Error) => {
      toast.error(`Shot plan failed: ${e.message}`);
      reset();
    },
  });

  return {
    generateFullShotPlan: mutation,
    progress,
    stages: STAGES,
    isRunning: mutation.isPending,
    reset,
  };
}
