/**
 * useDocSets — React Query hooks for project doc set CRUD.
 * Typed helpers for project_doc_sets + project_doc_set_items.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/* ── Types ── */

export interface DocSet {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocSetItem {
  id: string;
  doc_set_id: string;
  document_id: string;
  sort_order: number;
  created_at: string;
}

export interface DocSetWithItems extends DocSet {
  items: DocSetItem[];
}

/* ── Pure helpers (exported for tests) ── */

/** Given doc set items, return document IDs in deterministic sort_order. */
export function docSetItemOrder(items: DocSetItem[]): string[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order).map(i => i.document_id);
}

/** Enforce at most one default: returns updated list with only targetId as default. */
export function enforceOneDefault(sets: DocSet[], targetId: string): DocSet[] {
  return sets.map(s => ({ ...s, is_default: s.id === targetId }));
}

/* ── Query Keys ── */

const DOC_SETS_KEY = (projectId: string) => ['doc-sets', projectId];
const DOC_SET_KEY = (docSetId: string) => ['doc-set', docSetId];

/* ── Hooks ── */

export function useDocSets(projectId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    if (projectId) qc.invalidateQueries({ queryKey: DOC_SETS_KEY(projectId) });
  };

  const listQuery = useQuery<DocSet[]>({
    queryKey: DOC_SETS_KEY(projectId || ''),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_doc_sets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const getDocSet = useQuery<DocSetWithItems | null>({
    queryKey: DOC_SET_KEY(''),
    enabled: false, // manually fetched
    queryFn: async () => null,
  });

  const fetchDocSet = async (docSetId: string): Promise<DocSetWithItems> => {
    const [{ data: ds, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      (supabase as any).from('project_doc_sets').select('*').eq('id', docSetId).single(),
      (supabase as any).from('project_doc_set_items').select('*').eq('doc_set_id', docSetId).order('sort_order'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return { ...ds, items: items || [] };
  };

  const createDocSet = useMutation({
    mutationFn: async (params: { name: string; description?: string }) => {
      const { data, error } = await (supabase as any)
        .from('project_doc_sets')
        .insert({ project_id: projectId, name: params.name, description: params.description || null })
        .select()
        .single();
      if (error) throw error;
      return data as DocSet;
    },
    onSuccess: () => { invalidate(); toast.success('Doc set created'); },
    onError: (e: any) => toast.error('Failed to create doc set: ' + e.message),
  });

  const updateDocSet = useMutation({
    mutationFn: async (params: { id: string; name?: string; description?: string }) => {
      const patch: any = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.description !== undefined) patch.description = params.description;
      const { error } = await (supabase as any)
        .from('project_doc_sets')
        .update(patch)
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Doc set updated'); },
    onError: (e: any) => toast.error('Update failed: ' + e.message),
  });

  const deleteDocSet = useMutation({
    mutationFn: async (docSetId: string) => {
      const { error } = await (supabase as any)
        .from('project_doc_sets')
        .delete()
        .eq('id', docSetId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Doc set deleted'); },
    onError: (e: any) => toast.error('Delete failed: ' + e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (docSetId: string) => {
      // Clear existing default first
      if (projectId) {
        await (supabase as any)
          .from('project_doc_sets')
          .update({ is_default: false })
          .eq('project_id', projectId)
          .eq('is_default', true);
      }
      const { error } = await (supabase as any)
        .from('project_doc_sets')
        .update({ is_default: true })
        .eq('id', docSetId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Default doc set updated'); },
    onError: (e: any) => toast.error('Failed to set default: ' + e.message),
  });

  const upsertItems = useMutation({
    mutationFn: async (params: { docSetId: string; documentIds: string[] }) => {
      // Delete existing items
      await (supabase as any)
        .from('project_doc_set_items')
        .delete()
        .eq('doc_set_id', params.docSetId);
      // Insert new items with sort_order
      if (params.documentIds.length > 0) {
        const rows = params.documentIds.map((docId, i) => ({
          doc_set_id: params.docSetId,
          document_id: docId,
          sort_order: i,
        }));
        const { error } = await (supabase as any)
          .from('project_doc_set_items')
          .insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); toast.success('Doc set items saved'); },
    onError: (e: any) => toast.error('Failed to save items: ' + e.message),
  });

  return {
    listQuery,
    fetchDocSet,
    createDocSet,
    updateDocSet,
    deleteDocSet,
    setDefault,
    upsertItems,
    invalidate,
  };
}
