/**
 * Animatic hooks — React Query + render orchestration
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { animaticApi } from './animaticApi';
import { renderAnimatic } from './renderAnimatic';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useCallback, useRef } from 'react';

export function useAnimaticRuns(projectId: string | undefined, storyboardRunId: string | undefined) {
  return useQuery({
    queryKey: ['animatic-runs', projectId, storyboardRunId],
    queryFn: () => animaticApi.listRuns(projectId!, storyboardRunId),
    enabled: !!projectId && !!storyboardRunId,
    refetchInterval: 5000,
  });
}

export function useAnimaticRun(projectId: string | undefined, animaticRunId: string | undefined) {
  return useQuery({
    queryKey: ['animatic-run', projectId, animaticRunId],
    queryFn: () => animaticApi.getRun(projectId!, animaticRunId!),
    enabled: !!projectId && !!animaticRunId,
    refetchInterval: 3000,
  });
}

export function useAnimaticMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const createRun = useMutation({
    mutationFn: (params: { storyboardRunId: string; options?: any }) =>
      animaticApi.createRun(projectId!, params.storyboardRunId, params.options),
    onSuccess: () => {
      toast.success('Animatic run created');
      qc.invalidateQueries({ queryKey: ['animatic-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createRun };
}

/**
 * Hook that orchestrates the full client-side render + upload flow.
 */
export function useAnimaticRenderer(projectId: string | undefined) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const cancelRef = useRef(false);

  const render = useCallback(async (storyboardRunId: string, animaticRunId: string) => {
    if (!projectId || isRendering) return;
    setIsRendering(true);
    cancelRef.current = false;
    setProgress(null);

    try {
      // 1. Set status rendering
      await animaticApi.setStatus(projectId, animaticRunId, 'rendering');

      // 2. Get assets
      const { assets, options, missingCount } = await animaticApi.getAssets(projectId, storyboardRunId, animaticRunId);
      if (!assets || assets.length === 0) throw new Error('No assets to render');
      if (missingCount > 0) toast.warning(`${missingCount} panels missing frames — using placeholders`);

      // 3. Render video client-side
      const blob = await renderAnimatic(assets, options, (done, total) => {
        setProgress({ done, total });
        // Report progress every 10 panels
        if (done % 10 === 0 || done === total) {
          animaticApi.setStatus(projectId, animaticRunId, 'rendering', { payload: { done, total } }).catch(() => {});
        }
      }, () => cancelRef.current);

      if (cancelRef.current) {
        await animaticApi.setStatus(projectId, animaticRunId, 'canceled');
        toast.info('Animatic render cancelled');
        return;
      }

      // 4. Upload
      await animaticApi.setStatus(projectId, animaticRunId, 'uploading');
      const storagePath = `${projectId}/animatics/${storyboardRunId}/${animaticRunId}.webm`;

      const { error: uploadErr } = await supabase.storage
        .from('storyboards')
        .upload(storagePath, blob, { contentType: 'video/webm', upsert: true });
      if (uploadErr) throw new Error('Upload failed: ' + uploadErr.message);

      // 5. Get signed URL
      const { data: signedData, error: signedErr } = await supabase.storage
        .from('storyboards')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
      if (signedErr || !signedData?.signedUrl) throw new Error('Failed to create signed URL');

      // 6. Complete
      await animaticApi.completeUpload(projectId, animaticRunId, storagePath, signedData.signedUrl);
      toast.success('Animatic ready!');
      qc.invalidateQueries({ queryKey: ['animatic-runs', projectId] });
      qc.invalidateQueries({ queryKey: ['animatic-run', projectId] });
    } catch (err: any) {
      if (!cancelRef.current) {
        console.error('Animatic render error:', err);
        await animaticApi.setStatus(projectId, animaticRunId, 'failed', { error: err.message }).catch(() => {});
        toast.error('Animatic failed: ' + err.message);
      }
    } finally {
      setIsRendering(false);
      setProgress(null);
    }
  }, [projectId, isRendering, qc]);

  const cancelRender = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { render, cancelRender, isRendering, progress };
}
