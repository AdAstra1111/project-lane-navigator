/**
 * usePipelineState — compute authoritative pipeline state from pipeline-brain.
 * Uses project format + existing documents to derive current stage, next steps, etc.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProject, useProjectDocuments } from '@/hooks/useProjects';
import { computePipelineState, type PipelineState } from '@/lib/pipeline-brain';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';
import { supabase } from '@/integrations/supabase/client';

export function usePipelineState(projectId: string | undefined) {
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { documents, isLoading: docsLoading } = useProjectDocuments(projectId);

  const docIds = useMemo(() => (documents || []).map(d => d.id), [documents]);
  const { data: approvedDocIds = new Set<string>(), isLoading: approvalsLoading } = useQuery({
    queryKey: ['pipeline-approved', projectId, docIds],
    queryFn: async () => {
      if (!projectId || docIds.length === 0) return new Set<string>();
      const { data, error } = await (supabase as any)
        .from('project_document_versions')
        .select('document_id')
        .in('document_id', docIds)
        .eq('approval_status', 'approved');
      if (error) throw error;
      return new Set<string>((data || []).map((v: any) => v.document_id));
    },
    enabled: !!projectId && docIds.length > 0,
  });

  const pipelineState = useMemo<PipelineState | null>(() => {
    if (!project || !documents) return null;

    const format = (project as any).deliverable_type || (project as any).format || 'film';

    // Map documents to ExistingDoc shape for pipeline-brain
    const existingDocs = documents
      .filter(d => d.doc_type)
      .map(d => ({
        docType: d.doc_type as string,
        hasApproved: approvedDocIds.has(d.id),
        activeVersionId: null,
      }));

    // Deduplicate by mapped stage
    const seen = new Set<string>();
    const dedupedDocs = existingDocs.filter(d => {
      const stage = mapDocTypeToLadderStage(d.docType);
      if (seen.has(stage)) return false;
      seen.add(stage);
      return true;
    });

    const criteria = {
      episodeCount: (project as any).season_episode_count ?? null,
      episodeLengthMin: (project as any).episode_length_min ?? null,
      episodeLengthMax: (project as any).episode_length_max ?? null,
      seasonEpisodeCount: (project as any).season_episode_count ?? null,
    };

    return computePipelineState(format, dedupedDocs, criteria);
  }, [project, documents, approvedDocIds]);

  return {
    pipelineState,
    isLoading: projectLoading || docsLoading || approvalsLoading,
  };
}
