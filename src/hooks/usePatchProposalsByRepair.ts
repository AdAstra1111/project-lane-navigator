/**
 * usePatchProposalsByRepair — Fetches a single patch proposal for a repair.
 * Uses TanStack Query + Supabase realtime with 2s debounce.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NarrativePatchProposal {
  proposal_id: string;
  project_id: string;
  repair_id: string;
  source_diagnostic_id: string;
  patch_type: 'repair_relation_graph' | 'repair_structural_beats';
  patch_layer: 'layer_5b_entity_relations' | 'layer_7_beats';
  proposed_patch: {
    entity_relations?: Array<{
      source_entity_key: string;
      relation_type: string;
      target_entity_key: string;
    }>;
    beats?: Array<{
      beat_key: string;
      beat_description: string;
      narrative_axis_reference?: string;
      expected_turn?: string;
    }>;
  };
  seed_context_snapshot: Record<string, unknown> | null;
  rationale: string | null;
  proposal_hash: string | null;
  generator_model: string | null;
  seed_snapshot_at: string;
  status: 'proposed' | 'applied' | 'rejected' | 'stale';
  created_at: string;
  applied_at: string | null;
}

async function fetchProposal(repairId: string): Promise<NarrativePatchProposal | null> {
  const { data, error } = await supabase
    .from('narrative_patch_proposals' as any)
    .select('*')
    .eq('repair_id', repairId)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as unknown as NarrativePatchProposal) ?? null;
}

export function usePatchProposalsByRepair(repairId: string | undefined) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryKey = ['narrative-patch-proposals', repairId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchProposal(repairId!),
    enabled: !!repairId,
    staleTime: 10_000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Realtime subscription with 2s debounce
  useEffect(() => {
    if (!repairId) return;

    const channel = supabase
      .channel(`patch-proposals-${repairId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'narrative_patch_proposals',
          filter: `repair_id=eq.${repairId}`,
        },
        () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['narrative-patch-proposals', repairId] });
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [repairId, queryClient]);

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refetch,
  };
}
