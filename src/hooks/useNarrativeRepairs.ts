/**
 * useNarrativeRepairs — Fetches and subscribes to narrative_repairs for a project.
 * Read-only query via Supabase RLS. Realtime updates debounced at 2s.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NarrativeRepair {
  repair_id: string;
  project_id: string;
  source_diagnostic_id: string;
  source_system: string | null;
  diagnostic_type: string | null;
  repair_type: string;
  scope_type: string;
  scope_key: string | null;
  strategy: string | null;
  priority_score: number;
  repairability: 'auto' | 'guided' | 'manual' | 'investigatory' | 'unknown';
  status: 'pending' | 'planned' | 'approved' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'dismissed';
  summary: string | null;
  recommended_action: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  skipped_reason: string | null;
  dismissed_at: string | null;
  created_at: string;
}

async function fetchRepairs(projectId: string): Promise<NarrativeRepair[]> {
  const { data, error } = await supabase
    .from('narrative_repairs' as any)
    .select('*')
    .eq('project_id', projectId)
    .order('priority_score', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as NarrativeRepair[];
}

export function useNarrativeRepairs(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryKey = ['narrative-repairs', projectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchRepairs(projectId!),
    enabled: !!projectId,
    staleTime: 10_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Realtime subscription with 2s debounce
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`narrative-repairs-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'narrative_repairs',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['narrative-repairs', projectId] });
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [projectId, queryClient]);

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
  };
}
