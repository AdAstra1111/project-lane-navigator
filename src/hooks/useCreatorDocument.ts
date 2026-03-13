/**
 * useCreatorDocument — fetches document content + version for the Creator UI.
 * Finds the document by doc_type within a project, loads the current version's
 * plaintext, and exposes approve/regenerate actions.
 */
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { approveAndActivate } from '@/lib/active-folder/approveAndActivate';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';
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

  // 1. Find the document row by stage — doc_type in DB may differ from stage key,
  //    so fetch all project docs and find the one whose mapped stage matches.
  const { data: document, isLoading: docLoading } = useQuery({
    queryKey: ['creator-doc', projectId, docType],
    queryFn: async () => {
      if (!projectId || !docType) return null;

      // First try exact match
      const { data: exact } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title, plaintext, latest_version_id, bg_generating')
        .eq('project_id', projectId)
        .eq('doc_type', docType)
        .maybeSingle();

      if (exact) return exact;

      // Fallback: fetch all docs and find by stage mapping
      const { data: allDocs, error } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, title, plaintext, latest_version_id, bg_generating')
        .eq('project_id', projectId);

      if (error) throw error;

      const match = (allDocs || []).find(
        (d: any) => d.doc_type && mapDocTypeToLadderStage(d.doc_type) === docType
      );

      return match ?? null;
    },
    enabled: !!projectId && !!docType,
    refetchInterval: (query) => {
      return query.state.data?.bg_generating ? 8000 : false;
    },
  });

  // 2. Fetch the best version — priority: approved > is_current > latest_version_id > highest number
  const { data: version, isLoading: versionLoading } = useQuery({
    queryKey: ['creator-version', document?.id],
    queryFn: async () => {
      if (!document?.id) return null;

      // Fetch all versions for this document
      const { data: allVersions, error } = await (supabase as any)
        .from('project_document_versions')
        .select('id, version_number, plaintext, is_current, approval_status, meta_json, bg_generating, created_at')
        .eq('document_id', document.id)
        .order('version_number', { ascending: false });

      if (error) throw error;
      if (!allVersions || allVersions.length === 0) return null;

      // 1. Prefer approved version (the converged one)
      const approved = allVersions.find((v: any) => v.approval_status === 'approved');
      if (approved) return approved;

      // 2. Prefer is_current
      const current = allVersions.find((v: any) => v.is_current === true);
      if (current) return current;

      // 3. Match latest_version_id if set on document
      if (document.latest_version_id) {
        const pinned = allVersions.find((v: any) => v.id === document.latest_version_id);
        if (pinned) return pinned;
      }

      // 4. Highest version_number (first in desc-sorted list)
      return allVersions[0];
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
