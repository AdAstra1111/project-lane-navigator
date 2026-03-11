/**
 * useImportPipelineStatus
 *
 * Queries real database tables to derive the pipeline readiness status
 * for projects created via the Script Drop Zone.
 *
 * Detects "imported" projects by checking for a project_documents record
 * with source='drop'. Then queries downstream tables for counts to derive
 * which enrichment stages completed successfully.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PipelineStageStatus = 'done' | 'missing' | 'unknown';

export interface PipelineStageInfo {
  key: string;
  label: string;
  status: PipelineStageStatus;
  count?: number;
}

export interface ImportPipelineResult {
  /** Whether the project was created via script drop */
  isImported: boolean;
  /** Whether all stages completed */
  isFullyReady: boolean;
  /** Individual stage statuses */
  stages: PipelineStageInfo[];
  /** Count of completed stages */
  completedCount: number;
  /** Total stages */
  totalStages: number;
  /** Loading state */
  isLoading: boolean;
}

export function useImportPipelineStatus(projectId: string | undefined): ImportPipelineResult {
  const { data, isLoading } = useQuery({
    queryKey: ['import-pipeline-status', projectId],
    queryFn: async (): Promise<Omit<ImportPipelineResult, 'isLoading'>> => {
      if (!projectId) return emptyResult();

      // 1. Check if this is an imported project (source='drop')
      const { data: dropDoc } = await (supabase as any)
        .from('project_documents')
        .select('id, extraction_status')
        .eq('project_id', projectId)
        .eq('source', 'drop')
        .limit(1)
        .maybeSingle();

      if (!dropDoc) return emptyResult();

      // It's an imported project — query all downstream tables in parallel
      const [
        scenesResult,
        versionsWithRolesResult,
        spineLinksResult,
        unitLinksResult,
      ] = await Promise.all([
        // Scenes extracted
        (supabase as any)
          .from('scene_graph_scenes')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .is('deprecated_at', null),

        // Scene versions with scene_roles populated (role classification)
        (supabase as any)
          .from('scene_graph_versions')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .not('scene_roles', 'eq', '[]'),

        // Spine links
        (supabase as any)
          .from('scene_spine_links')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId),

        // Script unit links (NIT entity links + blueprint bindings)
        (supabase as any)
          .from('script_unit_links')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId),
      ]);

      const sceneCount = scenesResult.count ?? 0;
      const rolesCount = versionsWithRolesResult.count ?? 0;
      const spineCount = spineLinksResult.count ?? 0;
      const unitLinkCount = unitLinksResult.count ?? 0;

      const ingested = dropDoc.extraction_status === 'done' || dropDoc.extraction_status === 'ready';

      const stages: PipelineStageInfo[] = [
        { key: 'uploaded', label: 'Script uploaded', status: 'done' },
        { key: 'ingested', label: 'Text extracted', status: ingested ? 'done' : 'missing' },
        { key: 'scenes', label: 'Scenes extracted', status: sceneCount > 0 ? 'done' : 'missing', count: sceneCount },
        { key: 'entity_sync', label: 'Entity links created', status: unitLinkCount > 0 ? 'done' : 'missing', count: unitLinkCount },
        { key: 'roles', label: 'Scene roles classified', status: rolesCount > 0 ? 'done' : 'missing', count: rolesCount },
        { key: 'spine', label: 'Spine links mapped', status: spineCount > 0 ? 'done' : 'missing', count: spineCount },
      ];

      const completedCount = stages.filter(s => s.status === 'done').length;
      const isFullyReady = completedCount === stages.length;

      return { isImported: true, isFullyReady, stages, completedCount, totalStages: stages.length };
    },
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (!data || isLoading) {
    return { isImported: false, isFullyReady: false, stages: [], completedCount: 0, totalStages: 0, isLoading };
  }

  return { ...data, isLoading };
}

function emptyResult(): Omit<ImportPipelineResult, 'isLoading'> {
  return { isImported: false, isFullyReady: false, stages: [], completedCount: 0, totalStages: 0 };
}
