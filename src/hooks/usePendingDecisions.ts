/**
 * usePendingDecisions — Hook for reading/resolving workflow pending decisions.
 *
 * Uses decision_ledger with status='workflow_pending' (namespaced keys).
 * Resolution creates a canon row (status='active') via edge function / auto-run approve flow.
 * NO client-side direct INSERT into decision_ledger for canon rows.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PendingDecision {
  id: string;
  project_id: string;
  decision_key: string;
  title: string;
  decision_text: string;
  decision_value: {
    question?: string;
    options?: Array<{ value: string; label: string }>;
    recommendation?: { value: string; reason: string } | null;
    classification: 'BLOCKING_NOW' | 'DEFERRABLE' | 'NEVER_BLOCKING';
    required_evidence?: Array<{ doc_type: string; requires_approval: boolean }>;
    revisit_stage?: string | null;
    scope_json?: { format?: string; doc_type?: string; lane?: string };
    provenance?: { job_id?: string; generator?: string };
  } | null;
  status: string;
  created_at: string;
}

export function usePendingDecisions(projectId: string | undefined) {
  const qc = useQueryClient();

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['pending-decisions', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('decision_ledger')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'workflow_pending' as any)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PendingDecision[];
    },
    enabled: !!projectId,
  });

  // Resolution goes through auto-run approve-decision flow (edge function).
  // This mutation only marks the workflow row as resolved — canon promotion
  // happens server-side in the approve-decision handler.
  const resolveDecision = useMutation({
    mutationFn: async ({ decisionId, value }: {
      decisionId: string;
      value: any;
    }) => {
      if (!projectId) throw new Error('No project');

      // Call auto-run approve-decision which handles canon promotion server-side
      const { error } = await supabase.functions.invoke('auto-run', {
        body: {
          action: 'approve-decision',
          projectId,
          decisionId,
          resolvedValue: value,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions', projectId] });
      qc.invalidateQueries({ queryKey: ['decisions', projectId] });
      toast.success('Decision resolved');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const dismissDecision = useMutation({
    mutationFn: async (decisionId: string) => {
      // Mark workflow_pending as dismissed (not canon — just workflow cleanup)
      const { error } = await supabase
        .from('decision_ledger')
        .update({ status: 'dismissed' as any })
        .eq('id', decisionId)
        .eq('status', 'workflow_pending' as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions', projectId] });
      toast.success('Decision dismissed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const classify = (d: PendingDecision) => d.decision_value?.classification || 'DEFERRABLE';

  const blockingDecisions = decisions.filter(d => classify(d) === 'BLOCKING_NOW');
  const deferrableDecisions = decisions.filter(d => classify(d) === 'DEFERRABLE');
  const neverBlockingDecisions = decisions.filter(d => classify(d) === 'NEVER_BLOCKING');

  return {
    decisions,
    blockingDecisions,
    deferrableDecisions,
    neverBlockingDecisions,
    isLoading,
    resolveDecision,
    dismissDecision,
  };
}
