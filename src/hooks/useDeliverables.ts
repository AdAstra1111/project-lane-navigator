import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectDeliverable {
  id: string;
  project_id: string;
  user_id: string;
  territory: string;
  buyer_name: string;
  deliverable_type: string;
  item_name: string;
  status: string;
  due_date: string | null;
  notes: string;
  rights_window: string;
  format_spec: string;
  created_at: string;
  updated_at: string;
}

export const DELIVERABLE_TYPES = [
  { value: 'technical', label: 'Technical' },
  { value: 'legal', label: 'Legal / Rights' },
  { value: 'creative', label: 'Creative Asset' },
  { value: 'financial', label: 'Financial' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'other', label: 'Other' },
];

export const DELIVERABLE_STATUSES = [
  { value: 'pending', label: 'Pending', color: 'bg-muted text-muted-foreground border-border' },
  { value: 'in-progress', label: 'In Progress', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { value: 'blocked', label: 'Blocked', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  { value: 'waived', label: 'Waived', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
];

export interface DeliveryReadiness {
  score: number;
  total: number;
  completed: number;
  blocked: number;
  byTerritory: Record<string, { total: number; completed: number; score: number }>;
}

export function calculateDeliveryReadiness(deliverables: ProjectDeliverable[]): DeliveryReadiness {
  const total = deliverables.length;
  const completed = deliverables.filter(d => d.status === 'completed' || d.status === 'waived').length;
  const blocked = deliverables.filter(d => d.status === 'blocked').length;
  const score = total > 0 ? Math.round((completed / total) * 100) : 0;

  const byTerritory: Record<string, { total: number; completed: number; score: number }> = {};
  for (const d of deliverables) {
    const key = d.territory || 'Unassigned';
    if (!byTerritory[key]) byTerritory[key] = { total: 0, completed: 0, score: 0 };
    byTerritory[key].total++;
    if (d.status === 'completed' || d.status === 'waived') byTerritory[key].completed++;
  }
  for (const key of Object.keys(byTerritory)) {
    const t = byTerritory[key];
    t.score = t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0;
  }

  return { score, total, completed, blocked, byTerritory };
}

export function useProjectDeliverables(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-deliverables', projectId];

  const { data: deliverables = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_deliverables')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectDeliverable[];
    },
    enabled: !!projectId,
  });

  const addDeliverable = useMutation({
    mutationFn: async (input: Partial<ProjectDeliverable>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_deliverables').insert({
        project_id: projectId!,
        user_id: user.id,
        territory: input.territory || '',
        buyer_name: input.buyer_name || '',
        deliverable_type: input.deliverable_type || 'technical',
        item_name: input.item_name || '',
        status: input.status || 'pending',
        due_date: input.due_date || null,
        notes: input.notes || '',
        rights_window: input.rights_window || '',
        format_spec: input.format_spec || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deliverable added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateDeliverable = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectDeliverable> & { id: string }) => {
      const { error } = await supabase.from('project_deliverables').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDeliverable = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_deliverables').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deliverable removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { deliverables, isLoading, addDeliverable, updateDeliverable, deleteDeliverable };
}
