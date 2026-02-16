import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DAMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, any>;
  created_by: string;
  created_at: string;
}

export interface DATestRun {
  id: string;
  action_id: string;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'passed' | 'failed' | 'error';
  summary: string | null;
  details: Record<string, any>;
  logs: string;
}

export interface DAAction {
  id: string;
  thread_id: string;
  proposed_by_message_id: string | null;
  action_type: string;
  target_ref: Record<string, any>;
  patch: Record<string, any>;
  human_summary: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  document_assistant_test_runs?: DATestRun[];
}

export function useDocAssistantPersistent(projectId: string | undefined) {
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);

  // Load thread for project
  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ['da-thread', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data } = await (supabase as any)
        .from('document_assistant_threads')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      return data as { id: string } | null;
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    if (thread?.id) setThreadId(thread.id);
  }, [thread]);

  // Load messages
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ['da-messages', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const { data, error } = await (supabase as any)
        .from('document_assistant_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data || []) as DAMessage[];
    },
    enabled: !!threadId,
    refetchInterval: 5000, // poll for updates while sims run
  });

  // Load actions with test runs
  const { data: actions = [], isLoading: actionsLoading } = useQuery({
    queryKey: ['da-actions', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const { data, error } = await (supabase as any)
        .from('document_assistant_actions')
        .select('*, document_assistant_test_runs(*)')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as DAAction[];
    },
    enabled: !!threadId,
    refetchInterval: 5000,
  });

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async (userMessage: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-assistant-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId, threadId, userMessage }),
      });

      if (resp.status === 429) throw new Error('Rate limit exceeded. Please try again shortly.');
      if (resp.status === 402) throw new Error('Credits required. Please add funds.');
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Request failed');
      }

      const result = await resp.json();
      if (result.threadId && !threadId) setThreadId(result.threadId);
      return result;
    },
    onSuccess: (result: any) => {
      console.log('[DocAssistant] Send success:', {
        threadId: result?.threadId,
        messageCount: result?.messages?.length ?? 0,
        actionCount: result?.actions?.length ?? 0,
      });
      if (result?.messages?.length === 0) {
        toast.error('No messages returned — check backend logs.');
      }
      qc.invalidateQueries({ queryKey: ['da-messages', threadId] });
      qc.invalidateQueries({ queryKey: ['da-actions', threadId] });
      qc.invalidateQueries({ queryKey: ['da-thread', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLoading = threadLoading || msgsLoading || actionsLoading;
  const hasRunningTests = actions.some(a => a.status === 'testing' ||
    a.document_assistant_test_runs?.some(tr => tr.status === 'running'));

  return {
    threadId,
    messages,
    actions,
    sendMessage,
    isLoading,
    isSending: sendMessage.isPending,
    hasRunningTests,
  };
}
