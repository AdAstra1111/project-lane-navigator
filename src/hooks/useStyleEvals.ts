import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StyleEvalRow {
  id: string;
  project_id: string;
  document_id: string;
  version_id: string;
  lane: string;
  voice_source: string;
  team_voice_id: string | null;
  team_voice_label: string | null;
  writing_voice_id: string | null;
  writing_voice_label: string | null;
  score: number;
  drift_level: string;
  fingerprint: any;
  target: any;
  deltas: any;
  attempt: number;
  created_at: string;
}

export function useStyleEvals(projectId: string | undefined, documentId: string | undefined) {
  return useQuery({
    queryKey: ['style-evals', projectId, documentId],
    queryFn: async () => {
      if (!projectId || !documentId) return [];
      const { data, error } = await (supabase as any)
        .from('style_evals')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as StyleEvalRow[];
    },
    enabled: !!projectId && !!documentId,
  });
}
