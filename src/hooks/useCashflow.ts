import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getCategoryForDealType } from '@/hooks/useDeals';

export interface CashflowSource {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  source_type: 'inflow' | 'outflow';
  amount: number;
  start_month: number;
  duration_months: number;
  timing: 'upfront' | 'monthly' | 'backend' | 'milestone';
  origin: string;
  origin_ref_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type NewSource = Omit<CashflowSource, 'id' | 'project_id' | 'user_id' | 'created_at' | 'updated_at'>;

export function useCashflowSources(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['cashflow-sources', projectId];

  const { data: sources = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_cashflow_sources')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data as any[]).map(d => ({
        ...d,
        amount: Number(d.amount),
      })) as CashflowSource[];
    },
    enabled: !!projectId,
  });

  const addSource = useMutation({
    mutationFn: async (input: NewSource) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_cashflow_sources').insert({
        project_id: projectId!,
        user_id: user.id,
        ...input,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateSource = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CashflowSource> & { id: string }) => {
      const { error } = await supabase.from('project_cashflow_sources').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_cashflow_sources').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkReplace = useMutation({
    mutationFn: async (newSources: NewSource[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !projectId) throw new Error('Not authenticated');
      // Delete existing synced sources
      await supabase
        .from('project_cashflow_sources')
        .delete()
        .eq('project_id', projectId)
        .neq('origin', 'manual');
      // Insert new
      if (newSources.length > 0) {
        const rows = newSources.map(s => ({
          project_id: projectId,
          user_id: user.id,
          ...s,
        }));
        const { error } = await supabase.from('project_cashflow_sources').insert(rows as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Cashflow synced from project data');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { sources, isLoading, addSource, updateSource, deleteSource, bulkReplace };
}

/**
 * Generates cashflow sources from project deals, budgets, schedule, and incentives.
 */
export async function fetchBudgetLinesForSync(projectId: string, budgetId: string) {
  const { data, error } = await supabase
    .from('project_budget_lines')
    .select('*')
    .eq('budget_id', budgetId);
  if (error) return [];
  return data || [];
}

export function generateSyncedSources(
  deals: any[],
  budgets: any[],
  budgetLines: any[],
  incentiveScenarios: any[],
  shootDayCount: number,
): NewSource[] {
  const sources: NewSource[] = [];
  let order = 0;

  // ── Inflows from closed deals ──
  const closedDeals = deals.filter(d => d.status === 'closed' && d.minimum_guarantee);
  for (const deal of closedDeals) {
    const amount = parseFloat(deal.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0;
    if (amount <= 0) continue;
    const cat = getCategoryForDealType(deal.deal_type);
    // Timing heuristics by category
    let startMonth = 0;
    let timing: NewSource['timing'] = 'upfront';
    if (cat === 'sales') { startMonth = 2; timing = 'milestone'; }
    if (cat === 'incentive') { startMonth = 8; timing = 'backend'; }
    if (cat === 'gap') { startMonth = 1; timing = 'upfront'; }
    if (cat === 'soft-money') { startMonth = 0; timing = 'milestone'; }

    sources.push({
      name: `${deal.buyer_name || deal.territory || cat} (${deal.deal_type})`,
      source_type: 'inflow',
      amount,
      start_month: startMonth,
      duration_months: timing === 'milestone' ? 3 : 1,
      timing,
      origin: 'deal-sync',
      origin_ref_id: deal.id,
      sort_order: order++,
    });
  }

  // ── Inflows from incentive scenarios ──
  for (const scenario of incentiveScenarios) {
    const amount = parseFloat(String(scenario.estimated_benefit).replace(/[^0-9.]/g, '')) || 0;
    if (amount <= 0) continue;
    sources.push({
      name: `Tax Credit: ${scenario.jurisdiction}`,
      source_type: 'inflow',
      amount,
      start_month: 8,
      duration_months: 1,
      timing: 'backend',
      origin: 'incentive-sync',
      origin_ref_id: scenario.id,
      sort_order: order++,
    });
  }

  // ── Outflows from budget categories ──
  const activeBudget = budgets.find(b => b.status === 'locked') || budgets[0];
  if (activeBudget) {
    const lines = budgetLines.filter(l => l.budget_id === activeBudget.id);
    // Group by category
    const cats: Record<string, number> = {};
    for (const l of lines) {
      cats[l.category] = (cats[l.category] || 0) + Number(l.amount);
    }

    // Map categories to production phases
    const PHASE_MAP: Record<string, { start: number; dur: number; label: string }> = {
      atl: { start: 0, dur: 3, label: 'Above the Line' },
      btl: { start: 2, dur: 4, label: 'Below the Line (Production)' },
      post: { start: 5, dur: 4, label: 'Post-Production' },
      vfx: { start: 5, dur: 4, label: 'VFX' },
      logistics: { start: 1, dur: 5, label: 'Logistics & Travel' },
      schedule: { start: 2, dur: 3, label: 'Stage & Equipment' },
      contingency: { start: 0, dur: 10, label: 'Contingency' },
      'soft-money': { start: 0, dur: 1, label: 'Soft Money Offset' },
    };

    for (const [cat, total] of Object.entries(cats)) {
      if (total <= 0) continue;
      const phase = PHASE_MAP[cat] || { start: 0, dur: 6, label: cat };
      // Adjust production timing based on schedule length
      const scheduleMonths = shootDayCount > 0 ? Math.max(1, Math.ceil(shootDayCount / 22)) : 3;

      let start = phase.start;
      let dur = phase.dur;
      // Scale BTL/logistics to actual shoot duration
      if (cat === 'btl' || cat === 'logistics' || cat === 'schedule') {
        start = 2;
        dur = scheduleMonths;
      }

      sources.push({
        name: phase.label,
        source_type: cat === 'soft-money' ? 'inflow' : 'outflow',
        amount: total,
        start_month: start,
        duration_months: dur,
        timing: 'monthly',
        origin: 'budget-sync',
        origin_ref_id: activeBudget.id,
        sort_order: order++,
      });
    }
  }

  return sources;
}
