/**
 * useDocumentVersions — fetch versions for a document + switch current version.
 * Supports bg_generating polling: when any version has meta_json.bg_generating === true,
 * auto-refetches every 20s until generation completes.
 */
import { useMemo } from 'react';
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
  plaintext: string | null;
  meta_json: Record<string, any> | null;
  /** Derived: true when meta_json.bg_generating === true and plaintext is empty */
  bg_generating: boolean;
}

export function useDocumentVersions(documentId: string | undefined) {
  const query = useQuery({
    queryKey: ['document-versions', documentId],
    queryFn: async () => {
      if (!documentId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_versions')
        .select('id, document_id, version_number, is_current, status, approval_status, change_summary, created_at, plaintext, meta_json')
        .eq('document_id', documentId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((v): DocumentVersion => ({
        ...v,
        plaintext: v.plaintext || null,
        meta_json: v.meta_json || null,
        bg_generating: !!(v.meta_json?.bg_generating) && !v.plaintext,
      }));
    },
    enabled: !!documentId,
  });

  // If any version is generating, poll every 20s
  const hasGenerating = useMemo(
    () => (query.data ?? []).some(v => v.bg_generating),
    [query.data],
  );

  // Re-run query with interval when generating
  useQuery({
    queryKey: ['document-versions-poll', documentId],
    queryFn: async () => {
      // This triggers a refetch of the main query
      query.refetch();
      return null;
    },
    enabled: hasGenerating,
    refetchInterval: hasGenerating ? 20_000 : false,
  });

  return query;
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
