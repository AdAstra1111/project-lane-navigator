/**
 * useDocumentVersions — fetch versions for a document + switch current version.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  is_current: boolean;
  status: string;
  approval_status: string | null;
  change_summary: string | null;
  created_at: string;
}

export function useDocumentVersions(documentId: string | undefined) {
  return useQuery({
    queryKey: ['document-versions', documentId],
    queryFn: async () => {
      if (!documentId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_versions')
        .select('id, document_id, version_number, is_current, status, approval_status, change_summary, created_at')
        .eq('document_id', documentId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DocumentVersion[];
    },
    enabled: !!documentId,
  });
}

export function useSetCurrentVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, versionId }: { documentId: string; versionId: string }) => {
      const { data, error } = await (supabase as any).rpc('set_current_version', {
        p_document_id: documentId,
        p_new_version_id: versionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['document-versions', variables.documentId] });
      queryClient.invalidateQueries({ queryKey: ['project-documents'] });
      toast.success('Version switched');
    },
    onError: (e: Error) => toast.error(`Failed to switch version: ${e.message}`),
  });
}
