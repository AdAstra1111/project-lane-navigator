/**
 * useCreatorDocument — fetches document content + version for the Creator UI.
 * Finds the document by doc_type within a project, loads the current version's
 * plaintext, and exposes approve/regenerate actions.
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { approveAndActivate } from '@/lib/active-folder/approveAndActivate';
import { toast } from 'sonner';

export interface CreatorDocumentState {
  documentId: string | null;
  versionId: string | null;
  content: string | null;
  versionNumber: number | null;
  isApproved: boolean;
  isGenerating: boolean;
  isLoading: boolean;
  error: string | null;
  approve: () => Promise<void>;
  isApproving: boolean;
  metaJson: Record<string, any> | null;
}

export function useCreatorDocument(
  projectId: string | undefined,
  docType: string | undefined,
): CreatorDocumentState {
  const queryClient = useQueryClient();

  // 1. Find the document row by doc_type
  const { data: document, isLoading: docLoading } = useQuery({
    queryKey: ['creator-doc', projectId, docType],
    queryFn: async () => {
      if (!projectId || !docType) return null;
      const { data, error } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title, plaintext, latest_version_id, bg_generating')
        .eq('project_id', projectId)
        .eq('doc_type', docType)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId && !!docType,
    refetchInterval: (query) => {
      // Poll while generating
      return query.state.data?.bg_generating ? 8000 : false;
    },
  });

  // 2. Fetch the current version's content
  const { data: version, isLoading: versionLoading } = useQuery({
    queryKey: ['creator-version', document?.id],
    queryFn: async () => {
      if (!document?.id) return null;

      // Prefer latest_version_id, then is_current, then highest version_number
      let query = (supabase as any)
        .from('project_document_versions')
        .select('id, version_number, plaintext, is_current, approval_status, meta_json, bg_generating, created_at')
        .eq('document_id', document.id);

      if (document.latest_version_id) {
        const { data } = await query.eq('id', document.latest_version_id).maybeSingle();
        if (data) return data;
      }

      // Fallback: current version
      const { data, error } = await query
        .eq('is_current', true)
        .maybeSingle();
      if (error) throw error;

      // Last fallback: highest version
      if (!data) {
        const { data: last } = await (supabase as any)
          .from('project_document_versions')
          .select('id, version_number, plaintext, is_current, approval_status, meta_json, bg_generating, created_at')
          .eq('document_id', document.id)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        return last;
      }
      return data;
    },
    enabled: !!document?.id,
    refetchInterval: (query) => {
      return query.state.data?.bg_generating ? 8000 : false;
    },
  });

  // 3. Approve mutation
  const [isApproving, setIsApproving] = useState(false);

  const approve = useCallback(async () => {
    if (!projectId || !version?.id) {
      toast.error('Nothing to approve yet.');
      return;
    }
    setIsApproving(true);
    try {
      await approveAndActivate({
        projectId,
        documentVersionId: version.id,
        sourceFlow: 'creator-ui',
      });
      toast.success('Approved ✓');
      // Invalidate pipeline state + document caches
      queryClient.invalidateQueries({ queryKey: ['creator-doc', projectId, docType] });
      queryClient.invalidateQueries({ queryKey: ['creator-version', document?.id] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-approved', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
    } catch (e: any) {
      toast.error(e?.message || 'Approval failed');
    } finally {
      setIsApproving(false);
    }
  }, [projectId, version?.id, document?.id, docType, queryClient]);

  const isGenerating =
    document?.bg_generating === true || version?.bg_generating === true;

  return {
    documentId: document?.id ?? null,
    versionId: version?.id ?? null,
    content: version?.plaintext ?? document?.plaintext ?? null,
    versionNumber: version?.version_number ?? null,
    isApproved: version?.approval_status === 'approved',
    isGenerating,
    isLoading: docLoading || versionLoading,
    error: null,
    approve,
    isApproving,
    metaJson: version?.meta_json ?? null,
  };
}
