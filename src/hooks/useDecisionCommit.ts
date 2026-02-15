import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectDecision {
  id: string;
  project_id: string;
  user_id: string;
  decision_type: string;
  field_path: string;
  new_value: any;
  status: 'proposed' | 'confirmed' | 'rejected';
  confirmed_by: string | null;
  confirmed_at: string | null;
  applied_to_metadata_at: string | null;
  resulting_resolver_hash: string | null;
  created_at: string;
}

export function useDecisionCommit(projectId: string | undefined) {
  const qc = useQueryClient();

  // Fetch all decisions for this project
  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['project-decisions', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_decisions')
        .select('*')
        .eq('project_id', projectId!)
        .not('field_path', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectDecision[];
    },
    enabled: !!projectId,
  });

  // Fetch project qualifications + locked_fields + resolved
  const { data: projectMeta } = useQuery({
    queryKey: ['project-qualifications', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('projects')
        .select('qualifications, locked_fields, resolved_qualifications, resolved_qualifications_hash, resolved_qualifications_version')
        .eq('id', projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  // Propose a decision
  const propose = useMutation({
    mutationFn: async (params: { fieldPath: string; newValue: any; decisionType?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase as any).from('project_decisions').insert({
        project_id: projectId,
        user_id: user.id,
        decision_type: params.decisionType || 'qualifications_update',
        field_path: params.fieldPath,
        new_value: params.newValue,
        status: 'proposed',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-decisions', projectId] });
      toast.success('Decision proposed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Confirm a decision (calls edge function)
  const confirm = useMutation({
    mutationFn: async (decisionId: string) => {
      const { data, error } = await supabase.functions.invoke('confirm-decision', {
        body: { decision_id: decisionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['project-decisions', projectId] });
      qc.invalidateQueries({ queryKey: ['project-qualifications', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
      toast.success(`Decision confirmed — hash: ${data.resolver_hash}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Reject a decision
  const reject = useMutation({
    mutationFn: async (decisionId: string) => {
      const { error } = await (supabase as any).from('project_decisions')
        .update({ status: 'rejected' })
        .eq('id', decisionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-decisions', projectId] });
      toast.success('Decision rejected');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Toggle field lock
  const toggleLock = useMutation({
    mutationFn: async (fieldPath: string) => {
      const currentLocks = projectMeta?.locked_fields || {};
      const newLocks = { ...currentLocks, [fieldPath]: !currentLocks[fieldPath] };
      const { error } = await (supabase as any).from('projects')
        .update({ locked_fields: newLocks })
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-qualifications', projectId] });
      toast.success('Lock toggled');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Detect conflicts between proposed and current values
  const conflicts = decisions
    .filter(d => d.status === 'proposed')
    .map(d => {
      const cleanField = d.field_path.replace(/^qualifications\./, '');
      const currentValue = projectMeta?.qualifications?.[cleanField]
        ?? projectMeta?.resolved_qualifications?.[cleanField];
      const isLocked = projectMeta?.locked_fields?.[d.field_path]
        || projectMeta?.locked_fields?.[cleanField];
      const proposedValue = typeof d.new_value === 'object' && d.new_value !== null && 'value' in d.new_value
        ? d.new_value.value : d.new_value;

      if (isLocked && proposedValue !== currentValue) {
        return { decision: d, currentValue, proposedValue, isLocked: true, type: 'locked_conflict' as const };
      }
      if (currentValue != null && proposedValue !== currentValue) {
        return { decision: d, currentValue, proposedValue, isLocked: false, type: 'value_conflict' as const };
      }
      return null;
    })
    .filter(Boolean);

  return {
    decisions,
    isLoading,
    projectMeta,
    conflicts,
    propose,
    confirm,
    reject,
    toggleLock,
  };
}
