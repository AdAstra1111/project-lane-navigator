/**
 * usePipelineState — compute authoritative pipeline state from pipeline-brain.
 * Uses project format + existing documents to derive current stage, next steps, etc.
 */
import { useMemo } from 'react';
import { useProject, useProjectDocuments } from '@/hooks/useProjects';
import { computePipelineState, type PipelineState } from '@/lib/pipeline-brain';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';

export function usePipelineState(projectId: string | undefined) {
  const { project, isLoading: projectLoading } = useProject(projectId);
  const { documents, isLoading: docsLoading } = useProjectDocuments(projectId);

  const pipelineState = useMemo<PipelineState | null>(() => {
    if (!project || !documents) return null;

    const format = (project as any).deliverable_type || (project as any).format || 'film';

    // Map documents to ExistingDoc shape for pipeline-brain
    const existingDocs = documents
      .filter(d => d.doc_type)
      .map(d => ({
        docType: d.doc_type as string,
        hasApproved: false, // We don't have approval info at this level; could be enhanced
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
  }, [project, documents]);

  return {
    pipelineState,
    isLoading: projectLoading || docsLoading,
  };
}
