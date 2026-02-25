/**
 * useWorkflowDocSets — Shared hook for Trailer / Storyboard / Analysis doc set resolution.
 * Loads doc sets + items, resolves includeDocumentIds deterministically using docSetResolver.
 */
import { useMemo } from 'react';
import { useDocSets, type DocSet, type DocSetItem } from '@/hooks/useDocSets';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  resolveContextDocumentIds,
  type WorkflowMode,
  type ResolvedContext,
} from '@/lib/docSetResolver';

/**
 * useWorkflowDocSets — deterministic doc set resolution for any workflow.
 * 
 * Returns:
 * - docSetsList: all doc sets for the project
 * - resolved: { includeDocumentIds, resolutionReason }
 * - isLoading: whether data is still being fetched
 * 
 * @param projectId - project UUID
 * @param mode - workflow mode (trailer, storyboard, analysis, writers_room)
 * @param explicitDocSetId - optional explicit doc set override (user-selected)
 * @param explicitIncludeDocumentIds - optional legacy include IDs
 */
export function useWorkflowDocSets(
  projectId: string | undefined,
  mode: WorkflowMode,
  explicitDocSetId?: string | null,
  explicitIncludeDocumentIds?: string[] | null,
) {
  const docSets = useDocSets(projectId);
  const docSetsList = docSets.listQuery.data || [];

  // Fetch items for all doc sets in one query
  const allItemsQuery = useQuery<DocSetItem[]>({
    queryKey: ['doc-set-all-items', projectId],
    enabled: !!projectId && docSetsList.length > 0,
    queryFn: async () => {
      const setIds = docSetsList.map(s => s.id);
      const { data, error } = await (supabase as any)
        .from('project_doc_set_items')
        .select('*')
        .in('doc_set_id', setIds)
        .order('sort_order');
      if (error) throw error;
      return data || [];
    },
  });

  const docSetItemsBySetId = useMemo(() => {
    const items = allItemsQuery.data || [];
    const map: Record<string, DocSetItem[]> = {};
    for (const item of items) {
      if (!map[item.doc_set_id]) map[item.doc_set_id] = [];
      map[item.doc_set_id].push(item);
    }
    return map;
  }, [allItemsQuery.data]);

  const resolved: ResolvedContext = useMemo(() => {
    return resolveContextDocumentIds({
      docSets: docSetsList,
      docSetItemsBySetId,
      explicitDocSetId,
      explicitIncludeDocumentIds,
      mode,
    });
  }, [docSetsList, docSetItemsBySetId, explicitDocSetId, explicitIncludeDocumentIds, mode]);

  const isLoading = docSets.listQuery.isLoading || allItemsQuery.isLoading;

  return {
    docSetsList,
    resolved,
    isLoading,
  };
}
