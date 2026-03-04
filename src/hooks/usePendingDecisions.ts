/**
 * usePendingDecisions — Hook for reading/resolving project pending decisions (Layer 2).
 *
 * Reads from project_pending_decisions table (NOT decision_ledger).
 * Resolution bridges to decision_ledger (Layer 3 / canon) automatically.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface PendingDecision {
  id: string;
  project_id: string;
  decision_key: string;
  question: string;
  options: Array<{ value: string; label: string }> | null;
  recommendation: { value: string; reason: string } | null;
  classification: 'BLOCKING_NOW' | 'DEFERRABLE' | 'NEVER_BLOCKING';
  required_evidence: Array<{ doc_type: string; requires_approval: boolean }>;
  revisit_stage: string | null;
  scope_json: { format?: string; doc_type?: string; lane?: string };
  source: { job_id?: string; generator?: string };
  status: 'pending' | 'resolved' | 'dismissed' | 'expired';
  created_at: string;
  updated_at: string;
}

export function usePendingDecisions(projectId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['pending-decisions', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_pending_decisions')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as PendingDecision[];
    },
    enabled: !!projectId,
  });

  const resolveDecision = useMutation({
    mutationFn: async ({ decisionId, value, canonTitle, canonText }: {
      decisionId: string;
      value: any;
      canonTitle?: string;
      canonText?: string;
    }) => {
      if (!user) throw new Error('Not authenticated');

      // 1. Update pending decision status
      const { data: decision, error: updateErr } = await (supabase as any)
        .from('project_pending_decisions')
        .update({ status: 'resolved' })
        .eq('id', decisionId)
        .select('*')
        .single();
      if (updateErr) throw updateErr;
      if (!decision) throw new Error('Decision not found');

      // 2. Create canon entry in decision_ledger
      // Supersede existing
      await (supabase as any)
        .from('decision_ledger')
        .update({ status: 'superseded' })
        .eq('project_id', decision.project_id)
        .eq('decision_key', decision.decision_key)
        .eq('status', 'active');

      // Insert new
      const { error: insertErr } = await (supabase as any)
        .from('decision_ledger')
        .insert({
          project_id: decision.project_id,
          decision_key: decision.decision_key,
          title: canonTitle || decision.question,
          decision_text: canonText || `Resolved: ${JSON.stringify(value)}`,
          decision_value: value,
          scope: 'project',
          source: 'pending_decision_resolved',
          created_by: user.id,
          status: 'active',
        });
      if (insertErr) throw insertErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions', projectId] });
      qc.invalidateQueries({ queryKey: ['decisions', projectId] });
      toast.success('Decision resolved and locked as canon');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const dismissDecision = useMutation({
    mutationFn: async (decisionId: string) => {
      const { error } = await (supabase as any)
        .from('project_pending_decisions')
        .update({ status: 'dismissed' })
        .eq('id', decisionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions', projectId] });
      toast.success('Decision dismissed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const blockingDecisions = decisions.filter(d => d.classification === 'BLOCKING_NOW');
  const deferrableDecisions = decisions.filter(d => d.classification === 'DEFERRABLE');
  const neverBlockingDecisions = decisions.filter(d => d.classification === 'NEVER_BLOCKING');

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
