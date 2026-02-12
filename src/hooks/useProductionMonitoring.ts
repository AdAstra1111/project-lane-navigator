import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

export interface DailyReport {
  id: string;
  project_id: string;
  user_id: string;
  report_date: string;
  scenes_shot: number;
  pages_shot: number;
  setup_count: number;
  call_time: string;
  wrap_time: string;
  notes: string;
  incidents: string;
  incident_severity: string;
  weather: string;
  created_at: string;
  updated_at: string;
}

export interface CostActual {
  id: string;
  project_id: string;
  user_id: string;
  department: string;
  budgeted: number;
  actual: number;
  variance: number;
  variance_pct: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ---- Daily Reports ----

export function useDailyReports(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['daily-reports', projectId];

  const { data: reports = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('production_daily_reports')
        .select('*')
        .eq('project_id', projectId)
        .order('report_date', { ascending: false });
      if (error) throw error;
      return (data || []) as DailyReport[];
    },
    enabled: !!projectId,
  });

  const addReport = useMutation({
    mutationFn: async (input: Partial<DailyReport>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('production_daily_reports')
        .insert({ ...input, project_id: projectId!, user_id: user.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as DailyReport;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Daily report saved');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateReport = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DailyReport> & { id: string }) => {
      const { error } = await supabase
        .from('production_daily_reports')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteReport = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('production_daily_reports')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Report deleted');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return { reports, isLoading, addReport, updateReport, deleteReport };
}

// ---- Cost Actuals ----

export function useCostActuals(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['cost-actuals', projectId];

  const { data: actuals = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('production_cost_actuals')
        .select('*')
        .eq('project_id', projectId)
        .order('department', { ascending: true });
      if (error) throw error;
      return (data || []) as CostActual[];
    },
    enabled: !!projectId,
  });

  const addActual = useMutation({
    mutationFn: async (input: Partial<CostActual>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('production_cost_actuals')
        .insert({ ...input, project_id: projectId!, user_id: user.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as CostActual;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Cost entry saved');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateActual = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CostActual> & { id: string }) => {
      const { error } = await supabase
        .from('production_cost_actuals')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteActual = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('production_cost_actuals')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Cost entry deleted');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return { actuals, isLoading, addActual, updateActual, deleteActual };
}
