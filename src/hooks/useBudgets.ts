import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

export interface ProjectBudget {
  id: string;
  project_id: string;
  user_id: string;
  version_label: string;
  total_amount: number;
  currency: string;
  lane_template: string;
  status: string;
  notes: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectBudgetLine {
  id: string;
  budget_id: string;
  project_id: string;
  user_id: string;
  category: string;
  line_name: string;
  amount: number;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---- Lane-aware budget templates ----

export const BUDGET_CATEGORIES = [
  { value: 'atl', label: 'Above the Line' },
  { value: 'btl', label: 'Below the Line' },
  { value: 'post', label: 'Post-Production' },
  { value: 'vfx', label: 'VFX & Digital' },
  { value: 'logistics', label: 'Logistics & Travel' },
  { value: 'schedule', label: 'Schedule / Shoot' },
  { value: 'contingency', label: 'Contingency' },
  { value: 'soft-money', label: 'Soft Money Offsets' },
  { value: 'other', label: 'Other' },
];

interface TemplateLine {
  category: string;
  line_name: string;
  pct: number; // percentage of total
}

const LANE_TEMPLATES: Record<string, TemplateLine[]> = {
  'studio-streamer': [
    { category: 'atl', line_name: 'Writer / Showrunner', pct: 5 },
    { category: 'atl', line_name: 'Director', pct: 5 },
    { category: 'atl', line_name: 'Lead Cast', pct: 15 },
    { category: 'atl', line_name: 'Producers', pct: 5 },
    { category: 'btl', line_name: 'Crew & Departments', pct: 25 },
    { category: 'post', line_name: 'Editorial & Sound', pct: 8 },
    { category: 'vfx', line_name: 'VFX & Digital', pct: 12 },
    { category: 'logistics', line_name: 'Locations & Travel', pct: 10 },
    { category: 'schedule', line_name: 'Stage & Equipment', pct: 5 },
    { category: 'contingency', line_name: 'Contingency (10%)', pct: 10 },
  ],
  'independent-film': [
    { category: 'atl', line_name: 'Writer', pct: 3 },
    { category: 'atl', line_name: 'Director', pct: 5 },
    { category: 'atl', line_name: 'Cast', pct: 10 },
    { category: 'atl', line_name: 'Producers', pct: 7 },
    { category: 'btl', line_name: 'Crew', pct: 30 },
    { category: 'post', line_name: 'Post-Production', pct: 12 },
    { category: 'logistics', line_name: 'Locations & Transport', pct: 13 },
    { category: 'schedule', line_name: 'Equipment & Facilities', pct: 8 },
    { category: 'contingency', line_name: 'Contingency (10%)', pct: 10 },
    { category: 'soft-money', line_name: 'Deferrals & In-Kind', pct: 2 },
  ],
  'low-budget': [
    { category: 'atl', line_name: 'Writer/Director', pct: 5 },
    { category: 'atl', line_name: 'Cast (deferred)', pct: 5 },
    { category: 'btl', line_name: 'Skeleton Crew', pct: 35 },
    { category: 'post', line_name: 'Post-Production', pct: 15 },
    { category: 'logistics', line_name: 'Locations', pct: 10 },
    { category: 'schedule', line_name: 'Equipment Rental', pct: 10 },
    { category: 'contingency', line_name: 'Contingency (15%)', pct: 15 },
    { category: 'soft-money', line_name: 'Deferrals & Favours', pct: 5 },
  ],
  'genre-market': [
    { category: 'atl', line_name: 'Cast (name value)', pct: 15 },
    { category: 'atl', line_name: 'Writer/Director', pct: 5 },
    { category: 'btl', line_name: 'Crew & Stunts', pct: 25 },
    { category: 'post', line_name: 'Post & Sound Design', pct: 10 },
    { category: 'vfx', line_name: 'VFX / Practical FX', pct: 15 },
    { category: 'logistics', line_name: 'Locations & Travel', pct: 10 },
    { category: 'schedule', line_name: 'Equipment & Stage', pct: 8 },
    { category: 'contingency', line_name: 'Contingency (10%)', pct: 10 },
    { category: 'soft-money', line_name: 'Tax Incentive Offset', pct: 2 },
  ],
  'default': [
    { category: 'atl', line_name: 'Above the Line', pct: 20 },
    { category: 'btl', line_name: 'Below the Line', pct: 30 },
    { category: 'post', line_name: 'Post-Production', pct: 12 },
    { category: 'vfx', line_name: 'VFX', pct: 8 },
    { category: 'logistics', line_name: 'Logistics', pct: 10 },
    { category: 'schedule', line_name: 'Schedule', pct: 5 },
    { category: 'contingency', line_name: 'Contingency', pct: 10 },
    { category: 'other', line_name: 'Other', pct: 5 },
  ],
};

export function getTemplateForLane(lane: string): TemplateLine[] {
  return LANE_TEMPLATES[lane] || LANE_TEMPLATES['default'];
}

// ---- CSV Import ----

export function parseCSVBudget(csv: string): { category: string; line_name: string; amount: number }[] {
  const lines = csv.trim().split('\n');
  const results: { category: string; line_name: string; amount: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const row = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && row.some(c => /category|name|amount/i.test(c))) continue; // skip header

    const [cat, name, amtStr] = row;
    if (!name) continue;
    const amount = parseFloat((amtStr || '0').replace(/[^0-9.-]/g, '')) || 0;
    const category = BUDGET_CATEGORIES.find(b => b.value === cat?.toLowerCase() || b.label.toLowerCase() === cat?.toLowerCase())?.value || 'other';
    results.push({ category, line_name: name, amount });
  }

  return results;
}

// ---- Hooks ----

export function useProjectBudgets(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-budgets', projectId];

  const { data: budgets = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_budgets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ProjectBudget[];
    },
    enabled: !!projectId,
  });

  const addBudget = useMutation({
    mutationFn: async (input: Partial<ProjectBudget>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('project_budgets').insert({
        project_id: projectId!,
        user_id: user.id,
        version_label: input.version_label || `Budget v${budgets.length + 1}`,
        total_amount: input.total_amount || 0,
        currency: input.currency || 'USD',
        lane_template: input.lane_template || '',
        status: input.status || 'draft',
        notes: input.notes || '',
      } as any).select().single();
      if (error) throw error;
      return data as unknown as ProjectBudget;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Budget created'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateBudget = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectBudget> & { id: string }) => {
      const { error } = await supabase.from('project_budgets').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBudget = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_budgets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Budget removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { budgets, isLoading, addBudget, updateBudget, deleteBudget };
}

export function useBudgetLines(budgetId: string | undefined, projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['budget-lines', budgetId];

  const { data: lines = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!budgetId) return [];
      const { data, error } = await supabase
        .from('project_budget_lines')
        .select('*')
        .eq('budget_id', budgetId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectBudgetLine[];
    },
    enabled: !!budgetId,
  });

  const addLine = useMutation({
    mutationFn: async (input: Partial<ProjectBudgetLine>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const nextOrder = lines.length > 0 ? Math.max(...lines.map(l => l.sort_order)) + 1 : 0;
      const { error } = await supabase.from('project_budget_lines').insert({
        budget_id: budgetId!,
        project_id: projectId!,
        user_id: user.id,
        category: input.category || 'other',
        line_name: input.line_name || '',
        amount: input.amount || 0,
        notes: input.notes || '',
        sort_order: input.sort_order ?? nextOrder,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const addLines = useMutation({
    mutationFn: async (inputs: Partial<ProjectBudgetLine>[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const rows = inputs.map((input, i) => ({
        budget_id: budgetId!,
        project_id: projectId!,
        user_id: user.id,
        category: input.category || 'other',
        line_name: input.line_name || '',
        amount: input.amount || 0,
        notes: input.notes || '',
        sort_order: i,
      }));
      const { error } = await supabase.from('project_budget_lines').insert(rows as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Lines imported'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLine = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectBudgetLine> & { id: string }) => {
      const { error } = await supabase.from('project_budget_lines').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_budget_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  return { lines, isLoading, addLine, addLines, updateLine, deleteLine };
}
