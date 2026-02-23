/**
 * useDeferredNotes — Fetches & manages deferred notes for a project.
 * 
 * Features:
 *  - Fetch all open deferred notes
 *  - Pin/unpin (show now without changing target)
 *  - Resurface: flip deferred→open when target stage is reached
 *  - Dismiss / resolve
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DeferredNote {
  id: string;
  project_id: string;
  note_key: string;
  note_json: any;
  source_doc_type: string;
  target_deliverable_type: string;
  status: string;
  due_when: any;
  suggested_fixes: any;
  severity: string | null;
  category: string | null;
  pinned: boolean;
  created_at: string;
  last_checked_at: string | null;
  resolution_method: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
}

const KEY = (pid: string) => ['deferred-notes', pid];

export function useDeferredNotes(projectId: string | undefined) {
  const qc = useQueryClient();

  const { data: deferredNotes = [], isLoading } = useQuery<DeferredNote[]>({
    queryKey: KEY(projectId!),
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_deferred_notes')
        .select('*')
        .eq('project_id', projectId)
        .in('status', ['open', 'pinned'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as DeferredNote[];
    },
    enabled: !!projectId,
    staleTime: 15_000,
  });

  // Dismissed notes — available for re-pinning
  const { data: dismissedNotes = [], isLoading: isDismissedLoading } = useQuery<DeferredNote[]>({
    queryKey: [...KEY(projectId!), 'dismissed'],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_deferred_notes')
        .select('*')
        .eq('project_id', projectId)
        .in('status', ['dismissed', 'resolved'])
        .order('resolved_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as DeferredNote[];
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: KEY(projectId!) });
    qc.invalidateQueries({ queryKey: [...KEY(projectId!), 'dismissed'] });
  }

  // Pin a deferred note (show in current stage UI without changing target)
  const pinNote = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await (supabase as any)
        .from('project_deferred_notes')
        .update({ pinned: true })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Note pinned — visible now'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Unpin
  const unpinNote = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await (supabase as any)
        .from('project_deferred_notes')
        .update({ pinned: false })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Re-pin a dismissed/resolved note — reopens it and pins it
  const repinNote = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await (supabase as any)
        .from('project_deferred_notes')
        .update({ status: 'open', pinned: true, resolved_at: null, resolution_method: null, resolution_summary: null })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Note re-pinned — visible again'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Dismiss a deferred note
  const dismissNote = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await (supabase as any)
        .from('project_deferred_notes')
        .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolution_method: 'dismissed' })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deferred note dismissed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Resolve a deferred note
  const resolveNote = useMutation({
    mutationFn: async (params: { noteId: string; method?: string; summary?: string }) => {
      const { error } = await (supabase as any)
        .from('project_deferred_notes')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution_method: params.method || 'manual',
          resolution_summary: params.summary || null,
        })
        .eq('id', params.noteId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deferred note resolved'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Resurface: check all deferred notes whose due_when matches the current stage.
   * Called on stage entry.
   */
  const resurfaceForStage = useMutation({
    mutationFn: async (currentDocType: string) => {
      if (!projectId) return { resurfaced: 0 };
      // Find deferred notes targeting this doc type
      const { data: candidates, error } = await (supabase as any)
        .from('project_deferred_notes')
        .select('id, due_when, target_deliverable_type')
        .eq('project_id', projectId)
        .eq('status', 'open')
        .eq('target_deliverable_type', currentDocType);
      if (error) throw error;
      if (!candidates || candidates.length === 0) return { resurfaced: 0 };

      // Flip all matching to status='resurfaced' (treated as open by UI)
      const ids = candidates.map((c: any) => c.id);
      const { error: updateError } = await (supabase as any)
        .from('project_deferred_notes')
        .update({ status: 'resurfaced', last_checked_at: new Date().toISOString() })
        .in('id', ids);
      if (updateError) throw updateError;
      return { resurfaced: ids.length };
    },
    onSuccess: (data) => {
      if (data.resurfaced > 0) {
        toast.info(`${data.resurfaced} deferred note(s) resurfaced for this stage`);
      }
      invalidate();
    },
  });

  // Bulk dismiss all open deferred notes for this project
  const bulkDismissAll = useMutation({
    mutationFn: async () => {
      if (!projectId) return;
      const { error } = await (supabase as any)
        .from('project_deferred_notes')
        .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolution_method: 'bulk_dismissed', resolution_summary: 'Bulk dismissed by user' })
        .eq('project_id', projectId)
        .in('status', ['open', 'pinned']);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('All old notes cleared'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Filtered views
  const pinnedNotes = deferredNotes.filter(n => n.pinned);
  const unpinnedNotes = deferredNotes.filter(n => !n.pinned);

  return {
    deferredNotes,
    dismissedNotes,
    pinnedNotes,
    unpinnedNotes,
    isLoading,
    pinNote,
    unpinNote,
    repinNote,
    dismissNote,
    resolveNote,
    resurfaceForStage,
    bulkDismissAll,
    invalidate,
  };
}
