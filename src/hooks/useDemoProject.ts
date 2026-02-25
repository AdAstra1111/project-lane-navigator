/**
 * useDemoProject — Deterministic demo project + doc set selection.
 * No randomness. Same user state → same selection.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getDefaultDocSetId, getDocSetDocumentIds } from '@/lib/docSetResolver';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

export interface DemoProjectSelection {
  projectId: string;
  projectTitle: string;
  lane: string;
  documentId: string | null;
  includeDocumentIds: string[] | null;
  docSetId: string | null;
}

/**
 * selectDemoProject — Pure deterministic selection from a list of projects.
 * Chooses oldest project by created_at, tiebreak by id asc.
 */
export function selectDemoProject(
  projects: Array<{ id: string; title: string; assigned_lane: string | null; created_at: string }>
): { id: string; title: string; lane: string } | undefined {
  if (projects.length === 0) return undefined;
  const sorted = [...projects].sort((a, b) => {
    const td = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (td !== 0) return td;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const p = sorted[0];
  return { id: p.id, title: p.title || 'Untitled Project', lane: p.assigned_lane || 'feature_film' };
}

/**
 * selectDemoDocument — Choose the primary document for the demo project.
 * Deterministic: if includeDocumentIds exist, use first; else oldest doc by created_at.
 */
export function selectDemoDocument(
  docs: Array<{ id: string; created_at: string }>,
  includeDocumentIds: string[] | null
): string | null {
  if (includeDocumentIds && includeDocumentIds.length > 0) return includeDocumentIds[0];
  if (docs.length === 0) return null;
  const sorted = [...docs].sort((a, b) => {
    const td = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (td !== 0) return td;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0].id;
}

/**
 * resolveDemoDocSet — Resolve doc set + includeDocumentIds for demo project.
 */
export function resolveDemoDocSet(
  docSets: DocSet[],
  docSetItems: DocSetItem[]
): { docSetId: string | null; includeDocumentIds: string[] | null } {
  const docSetId = getDefaultDocSetId(docSets) || null;
  if (!docSetId) return { docSetId: null, includeDocumentIds: null };
  const items = docSetItems.filter(i => i.doc_set_id === docSetId);
  return { docSetId, includeDocumentIds: getDocSetDocumentIds(items) };
}

/**
 * useDemoProject — Hook that deterministically selects a demo project.
 */
export function useDemoProject() {
  // Fetch user's projects
  const projectsQuery = useQuery({
    queryKey: ['demo-project-selection'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { projects: [], docSets: [], docSetItems: [], docs: [] };
      const { data: projects } = await supabase
        .from('projects')
        .select('id, title, assigned_lane, created_at')
        .order('created_at', { ascending: true })
        .limit(20);
      if (!projects || projects.length === 0) {
        return { projects: [], docSets: [], docSetItems: [], docs: [] };
      }
      const selected = selectDemoProject(projects);
      if (!selected) return { projects, docSets: [], docSetItems: [], docs: [] };
      // Fetch doc sets for the selected project
      const { data: docSets } = await (supabase as any)
        .from('project_doc_sets')
        .select('*')
        .eq('project_id', selected.id)
        .order('created_at', { ascending: true });
      const { data: docSetItems } = await (supabase as any)
        .from('project_doc_set_items')
        .select('*')
        .in('doc_set_id', (docSets || []).map((s: any) => s.id));
      // Fetch project documents
      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, created_at')
        .eq('project_id', selected.id)
        .order('created_at', { ascending: true });
      return {
        projects,
        docSets: (docSets || []) as DocSet[],
        docSetItems: (docSetItems || []) as DocSetItem[],
        docs: (docs || []) as Array<{ id: string; created_at: string }>,
      };
    },
  });

  const data = projectsQuery.data;
  if (!data || data.projects.length === 0) {
    return { selection: null, isLoading: projectsQuery.isLoading };
  }

  const project = selectDemoProject(data.projects);
  if (!project) return { selection: null, isLoading: false };

  const { docSetId, includeDocumentIds } = resolveDemoDocSet(data.docSets, data.docSetItems);
  const documentId = selectDemoDocument(data.docs, includeDocumentIds);

  const selection: DemoProjectSelection = {
    projectId: project.id,
    projectTitle: project.title,
    lane: project.lane,
    documentId,
    includeDocumentIds,
    docSetId,
  };

  return { selection, isLoading: projectsQuery.isLoading };
}
