/**
 * useNoteWritersRoom — React Query hook for Writers' Room edge function.
 * Now includes context pack management (list docs, load packs, pass to LLM).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { WritersRoomData, NoteOption, ChangePlan, ChangePlanRow } from '@/lib/types/writers-room';

const QUERY_KEY = (docId: string, noteHash: string) => ['writers-room', docId, noteHash];
const PLAN_KEY = (threadId: string) => ['writers-room-plan', threadId];
const DOCS_KEY = (projectId: string) => ['writers-room-docs', projectId];

export interface ContextPackDoc {
  documentId: string;
  docType: string;
  title: string;
  versionId: string;
  versionNumber: number;
  label?: string;
  updatedAt: string;
  excerptChars: number;
  totalChars: number;
  excerptText: string;
}

export interface ContextPack {
  presetKey: string;
  mode: string;
  versionPreference?: string;
  totalChars: number;
  project?: {
    title: string;
    format: string;
    genres?: string[];
    tone?: string;
  };
  docs: ContextPackDoc[];
}

export interface ProjectDocInfo {
  documentId: string;
  docType: string;
  title: string;
  updatedAt: string;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  approvedVersionId: string | null;
  versionCount: number;
}

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

  // List all project documents
  const docsQuery = useQuery<ProjectDocInfo[]>({
    queryKey: DOCS_KEY(projectId),
    queryFn: async () => {
      const res = await invoke('list_project_documents', { projectId });
      return res.docs || [];
    },
    enabled: enabled && !!projectId,
    staleTime: 120_000,
  });

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

  // Load context pack
  const loadContextPack = useMutation({
    mutationFn: (params: {
      presetKey?: string;
      includeDocTypes?: string[];
      includeDocumentIds?: string[];
      versionPreference?: string;
      mode?: string;
      charsPerDoc?: number;
      maxTotalChars?: number;
    }) => invoke('load_context_pack', { projectId, ...params }),
    onError: (e: Error) => toast.error(`Context load failed: ${e.message}`),
  });

  const postMessage = useMutation({
    mutationFn: (params: { content: string; contextPack?: ContextPack }) =>
      invoke('post_message', { ...baseParams, content: params.content, contextPack: params.contextPack }),
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
    mutationFn: (contextPack?: ContextPack) =>
      invoke('generate_options', { ...baseParams, contextPack }),
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
    mutationFn: (contextPack?: ContextPack) =>
      invoke('synthesize_best', { ...baseParams, contextPack }),
    onSuccess: () => {
      invalidate();
      toast.success('Synthesis complete');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposeChangePlan = useMutation({
    mutationFn: (contextPack?: ContextPack) => {
      if (!threadId) throw new Error('No thread');
      return invoke('propose_change_plan', { threadId, contextPack });
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
    onSuccess: () => {
      invalidatePlan();
      invalidate();
      toast.success(`Applied! New version created.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    query,
    planQuery,
    docsQuery,
    ensureThread,
    loadContextPack,
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
