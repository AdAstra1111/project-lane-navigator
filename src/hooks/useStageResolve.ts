import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Stage-entry re-resolve: calls resolve-qualifications edge function
 * on entering a pipeline stage. If the hash has changed, updates the
 * project's resolved_qualifications + hash.
 */
export function useStageResolve(projectId: string | undefined) {
  const qc = useQueryClient();

  const resolveOnEntry = useCallback(async () => {
    if (!projectId) return null;
    try {
      const { data, error } = await supabase.functions.invoke('resolve-qualifications', {
        body: { projectId },
      });
      if (error) {
        console.warn('[useStageResolve] resolve-qualifications failed:', error);
        return null;
      }
      // Invalidate project queries so UI reflects latest resolved quals
      qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
      qc.invalidateQueries({ queryKey: ['project-qualifications', projectId] });
      return data;
    } catch (e) {
      console.warn('[useStageResolve] error:', e);
      return null;
    }
  }, [projectId, qc]);

  return { resolveOnEntry };
}
