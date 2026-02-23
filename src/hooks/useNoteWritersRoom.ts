/**
 * useNoteWritersRoom — React Query hook for Writers' Room edge function.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { WritersRoomData, NoteOption, ChangePlan, ChangePlanRow } from '@/lib/types/writers-room';

const QUERY_KEY = (docId: string, noteHash: string) => ['writers-room', docId, noteHash];
const PLAN_KEY = (threadId: string) => ['writers-room-plan', threadId];

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

  const threadId = query.data?.thread?.id;

  const planQuery = useQuery<ChangePlanRow | null>({
    queryKey: PLAN_KEY(threadId || ''),
    queryFn: async () => {
      if (!threadId) return null;
      const res = await invoke('get_latest_plan', { threadId });
      return res.plan || null;
    },
    enabled: !!threadId,
    staleTime: 10_000,
  });

  const invalidatePlan = () => {
    if (threadId) qc.invalidateQueries({ queryKey: PLAN_KEY(threadId) });
  };

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
    onSuccess: () => {
      invalidate();
      toast.success('Synthesis complete');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposeChangePlan = useMutation({
    mutationFn: () => {
      if (!threadId) throw new Error('No thread');
      return invoke('propose_change_plan', { threadId });
    },
    onSuccess: () => {
      invalidatePlan();
      toast.success('Change plan generated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmChangePlan = useMutation({
    mutationFn: ({ planId, planPatch }: { planId: string; planPatch?: ChangePlan }) =>
      invoke('confirm_change_plan', { planId, planPatch }),
    onSuccess: () => {
      invalidatePlan();
      toast.success('Plan confirmed — ready to apply');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyChangePlan = useMutation({
    mutationFn: (planId: string) => invoke('apply_change_plan', { planId }),
    onSuccess: (data) => {
      invalidatePlan();
      invalidate();
      toast.success(`Applied! New version created.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    query,
    planQuery,
    ensureThread,
    postMessage,
    updateState,
    generateOptions,
    selectOption,
    synthesizeBest,
    proposeChangePlan,
    confirmChangePlan,
    applyChangePlan,
    invalidate,
    invalidatePlan,
    threadId,
  };
}
