/**
 * useNoteWritersRoom — React Query hook for Writers' Room edge function.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { WritersRoomData, NoteOption } from '@/lib/types/writers-room';

const QUERY_KEY = (docId: string, noteHash: string) => ['writers-room', docId, noteHash];

async function invoke(action: string, params: Record<string, any>) {
  const { data, error } = await supabase.functions.invoke('notes-writers-room', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || 'Writers room call failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useNoteWritersRoom(opts: {
  projectId: string;
  documentId: string;
  noteHash: string;
  versionId?: string;
  noteSnapshot?: any;
  enabled?: boolean;
}) {
  const { projectId, documentId, noteHash, versionId, noteSnapshot, enabled = false } = opts;
  const qc = useQueryClient();
  const key = QUERY_KEY(documentId, noteHash);

  const baseParams = { projectId, documentId, noteHash, versionId, noteSnapshot };

  const query = useQuery<WritersRoomData>({
    queryKey: key,
    queryFn: () => invoke('get', baseParams),
    enabled: enabled && !!projectId && !!documentId && !!noteHash,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const ensureThread = useMutation({
    mutationFn: () => invoke('update_state', baseParams),
    onSuccess: invalidate,
  });

  const postMessage = useMutation({
    mutationFn: (content: string) => invoke('post_message', { ...baseParams, content }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const updateState = useMutation({
    mutationFn: (params: { direction?: any; pinnedConstraints?: string[] }) =>
      invoke('update_state', { ...baseParams, ...params }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const generateOptions = useMutation({
    mutationFn: (scriptContext?: string) => invoke('generate_options', { ...baseParams, scriptContext }),
    onSuccess: (data) => {
      invalidate();
      toast.success(`Generated ${data.options?.length || 0} new options`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectOption = useMutation({
    mutationFn: (option: NoteOption) => invoke('select_option', { ...baseParams, selectedOption: option }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const synthesizeBest = useMutation({
    mutationFn: (scriptContext?: string) => invoke('synthesize_best', { ...baseParams, scriptContext }),
    onSuccess: (data) => {
      invalidate();
      toast.success('Synthesis complete');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    query,
    ensureThread,
    postMessage,
    updateState,
    generateOptions,
    selectOption,
    synthesizeBest,
    invalidate,
  };
}
