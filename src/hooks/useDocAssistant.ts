import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';

export type AssistantScope = 'current_doc' | 'selected_docs' | 'full_package';
export type AssistantMode = 'ask' | 'propose' | 'test' | 'apply';

export interface Citation {
  doc_type: string;
  chunk_index?: number;
  snippet?: string;
  version_id?: string;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
  queryId: string;
}

export interface ProposeResult {
  proposalId: string;
  draftVersionId: string | null;
  draftText: string;
}

export interface TestReport {
  canonical_test?: { pass: boolean; issues: string[] };
  continuity_test?: { pass: boolean; conflicts: string[] };
  style_test?: { pass: boolean; notes: string[] };
  impact_scores?: { clarity: number; stakes: number; pacing: number; overall: number };
  stale_dependencies?: string[];
  summary?: string;
  recommendation?: 'approve' | 'revise' | 'reject';
}

export interface ApplyResult {
  applied: boolean;
  proposalId: string;
  draftVersionId: string | null;
  staleDependencies: string[];
}

async function callAssistant(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/doc-assistant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Assistant error');
  return result;
}

export function useDocAssistant(projectId: string | undefined) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [scope, setScope] = useState<AssistantScope>('current_doc');
  const [lastAnswer, setLastAnswer] = useState<AskResult | null>(null);
  const [lastProposal, setLastProposal] = useState<ProposeResult | null>(null);
  const [lastTestReport, setLastTestReport] = useState<TestReport | null>(null);

  // Chunk a document version for RAG
  const chunkDocument = useMutation({
    mutationFn: async (params: { versionId: string; docType: string; text: string }) =>
      callAssistant('chunk-document', { projectId, ...params }),
    onSuccess: () => toast.success('Document indexed for search'),
    onError: (e: Error) => toast.error(e.message),
  });

  // Ask a question
  const ask = useMutation({
    mutationFn: async (params: {
      queryText: string; docVersionId?: string; docType?: string; selectedSpan?: any;
    }): Promise<AskResult> =>
      callAssistant('ask', { projectId, scope, ...params }),
    onSuccess: (data) => { setLastAnswer(data); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Propose a change
  const propose = useMutation({
    mutationFn: async (params: {
      targetDocType: string; targetVersionId?: string;
      proposalText: string; selectedSpan?: any;
    }): Promise<ProposeResult> =>
      callAssistant('propose-change', { projectId, ...params }),
    onSuccess: (data) => {
      setLastProposal(data);
      toast.success('Draft revision created');
      invalidateDevEngine(qc, { projectId, deep: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Test a proposal
  const testProposal = useMutation({
    mutationFn: async (proposalId: string): Promise<{ report: TestReport }> =>
      callAssistant('test-proposal', { proposalId }),
    onSuccess: (data) => {
      setLastTestReport(data.report);
      toast.success('Test report ready');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Apply a proposal
  const applyProposal = useMutation({
    mutationFn: async (proposalId: string): Promise<ApplyResult> =>
      callAssistant('apply-proposal', { proposalId }),
    onSuccess: (data) => {
      toast.success('Change applied');
      if (data.staleDependencies?.length) {
        toast.info(`${data.staleDependencies.length} document(s) may need regeneration`);
      }
      invalidateDevEngine(qc, { projectId, deep: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Fetch proposal history
  const { data: proposals = [] } = useQuery({
    queryKey: ['doc-proposals', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('doc_change_proposals')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });

  const isProcessing = ask.isPending || propose.isPending || testProposal.isPending || applyProposal.isPending || chunkDocument.isPending;

  const reset = useCallback(() => {
    setLastAnswer(null);
    setLastProposal(null);
    setLastTestReport(null);
  }, []);

  return {
    mode, setMode, scope, setScope,
    ask, propose, testProposal, applyProposal, chunkDocument,
    lastAnswer, lastProposal, lastTestReport,
    proposals, isProcessing, reset,
  };
}
