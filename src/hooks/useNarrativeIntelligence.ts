/**
 * useNarrativeIntelligence — Read-only hook for NDG nodes + NUE units.
 * Feature-flagged: returns empty data when NARRATIVE_INTELLIGENCE_V0 is false.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { NARRATIVE_INTELLIGENCE_V0, type NdgNode, type NuePayload } from '@/lib/narrativeIntelligence';

export function useNdgNodes(projectId: string | undefined) {
  return useQuery({
    queryKey: ['ndg-nodes', projectId],
    queryFn: async () => {
      if (!projectId || !NARRATIVE_INTELLIGENCE_V0) return [];
      const { data, error } = await (supabase as any)
        .from('decision_ledger')
        .select('decision_key, title, decision_text, decision_value, status, created_at')
        .eq('project_id', projectId)
        .eq('source', 'ndg_v0')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || [])
        .map((r: any) => r.decision_value?.ndg as NdgNode)
        .filter(Boolean);
    },
    enabled: !!projectId && NARRATIVE_INTELLIGENCE_V0,
  });
}

export function useNueUnits(versionId: string | undefined) {
  return useQuery({
    queryKey: ['nue-units', versionId],
    queryFn: async () => {
      if (!versionId || !NARRATIVE_INTELLIGENCE_V0) return null;
      const { data, error } = await supabase
        .from('project_document_versions')
        .select('meta_json')
        .eq('id', versionId)
        .maybeSingle();
      if (error) throw error;
      return (data?.meta_json as any)?.nue as NuePayload | null;
    },
    enabled: !!versionId && NARRATIVE_INTELLIGENCE_V0,
  });
}

export function useNarrativeIntelligence(projectId: string | undefined, versionId: string | undefined) {
  const ndgQuery = useNdgNodes(projectId);
  const nueQuery = useNueUnits(versionId);

  return {
    ndgNodes: ndgQuery.data || [],
    ndgLoading: ndgQuery.isLoading,
    nuePayload: nueQuery.data || null,
    nueLoading: nueQuery.isLoading,
    isEnabled: NARRATIVE_INTELLIGENCE_V0,
  };
}
