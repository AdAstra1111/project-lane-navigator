/**
 * useCreatorDocument — fetches document content + approval state for the Creator UI.
 * Uses useProjectDocuments (already cached) to find the doc, then fetches the
 * approved version's plaintext directly.
 */
import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { approveAndActivate } from '@/lib/active-folder/approveAndActivate';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';
import { useProjectDocuments } from '@/hooks/useProjects';
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

  // Use the cached project documents (same query that powers the pipeline timeline)
  const { documents, isLoading: docsLoading } = useProjectDocuments(projectId);

  // Find this document by stage key or doc_type
  const document = useMemo(() => {
    if (!documents || !docType) return null;
    return (documents as any[]).find(d => {
      if (!d.doc_type) return false;
      if (d.doc_type === docType) return true;
      return mapDocTypeToLadderStage(d.doc_type) === docType;
    }) ?? null;
  }, [documents, docType]);

  // Fetch all versions to find the approved one (for content + approval state)
  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ['creator-versions', document?.id],
    queryFn: async () => {
      if (!document?.id) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_versions')
        .select('id, version_number, plaintext, is_current, approval_status, meta_json, bg_generating, created_at')
        .eq('document_id', document.id)
        .order('version_number', { ascending: false });
      if (error) {
        console.warn('[useCreatorDocument] version fetch error:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!document?.id,
    staleTime: 30_000,
  });

  // Pick best version: approved > is_current > highest version number
  const version = useMemo(() => {
    if (!versions || versions.length === 0) return null;
    return (
      versions.find((v: any) => v.approval_status === 'approved') ||
      versions.find((v: any) => v.is_current === true) ||
      versions[0]
    );
  }, [versions]);

  // Content: version plaintext > doc.version_plaintext (pre-fetched) > doc.extracted_text
  const content = useMemo(() => {
    if (version?.plaintext) return version.plaintext;
    if ((document as any)?.version_plaintext) return (document as any).version_plaintext;
    if ((document as any)?.extracted_text) return (document as any).extracted_text;
    return null;
  }, [version, document]);

  // Approval state
  const isApproved = version?.approval_status === 'approved';
  const isGenerating = version?.bg_generating === true || (document as any)?.bg_generating === true;

  // Approve action
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
      queryClient.invalidateQueries({ queryKey: ['creator-versions', document?.id] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-approved', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
    } catch (e: any) {
      toast.error(e?.message || 'Approval failed');
    } finally {
      setIsApproving(false);
    }
  }, [projectId, version?.id, document?.id, queryClient]);

  return {
    documentId: document?.id ?? null,
    versionId: version?.id ?? null,
    content,
    versionNumber: version?.version_number ?? null,
    isApproved,
    isGenerating,
    isLoading: docsLoading || versionsLoading,
    error: null,
    approve,
    isApproving,
    metaJson: version?.meta_json ?? null,
  };
}
