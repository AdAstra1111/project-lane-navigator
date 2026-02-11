import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface RecoupmentScenario {
  id: string;
  project_id: string;
  user_id: string;
  scenario_name: string;
  total_revenue_estimate: number;
  currency: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RecoupmentTier {
  id: string;
  scenario_id: string;
  project_id: string;
  user_id: string;
  tier_order: number;
  participant_name: string;
  tier_type: string; // 'fee_pct' | 'expense' | 'recoup' | 'corridor' | 'split'
  percentage: number;
  fixed_amount: number;
  cap: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const TIER_TYPES = [
  { value: 'fee_pct', label: 'Distribution Fee (%)', description: 'Percentage off gross revenue' },
  { value: 'expense', label: 'Expense / P&A', description: 'Fixed cost deducted from revenue' },
  { value: 'recoup', label: 'Recoupment', description: 'Fixed amount recouped (investor, bank)' },
  { value: 'corridor', label: 'Corridor (%)', description: 'Percentage of remaining after prior tiers' },
  { value: 'split', label: 'Profit Split (%)', description: 'Percentage of remaining profits' },
];

// Calculate waterfall flow
export interface WaterfallResult {
  tiers: {
    tier: RecoupmentTier;
    amountReceived: number;
    remainingAfter: number;
    fullyRecouped: boolean;
  }[];
  totalDistributed: number;
  remainingRevenue: number;
}

export function calculateWaterfall(revenue: number, tiers: RecoupmentTier[]): WaterfallResult {
  const sorted = [...tiers].sort((a, b) => a.tier_order - b.tier_order);
  let remaining = revenue;
  const results: WaterfallResult['tiers'] = [];

  for (const tier of sorted) {
    let amount = 0;

    switch (tier.tier_type) {
      case 'fee_pct':
        // Percentage of gross revenue
        amount = revenue * (tier.percentage / 100);
        break;
      case 'expense':
      case 'recoup':
        // Fixed amount deducted
        amount = Math.min(tier.fixed_amount, remaining);
        break;
      case 'corridor':
      case 'split':
        // Percentage of what remains
        amount = remaining * (tier.percentage / 100);
        break;
    }

    // Apply cap if set
    if (tier.cap && tier.cap > 0) {
      amount = Math.min(amount, tier.cap);
    }

    amount = Math.max(0, Math.min(amount, remaining));
    remaining -= amount;

    const fullyRecouped =
      (tier.tier_type === 'expense' || tier.tier_type === 'recoup')
        ? amount >= tier.fixed_amount
        : true;

    results.push({ tier, amountReceived: amount, remainingAfter: remaining, fullyRecouped });
  }

  return {
    tiers: results,
    totalDistributed: revenue - remaining,
    remainingRevenue: remaining,
  };
}

export function useRecoupmentScenarios(projectId: string | undefined) {
  const qc = useQueryClient();
  const key = ['recoupment-scenarios', projectId];

  const { data: scenarios = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_recoupment_scenarios')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as RecoupmentScenario[];
    },
    enabled: !!projectId,
  });

  const addScenario = useMutation({
    mutationFn: async (input: Partial<RecoupmentScenario>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('project_recoupment_scenarios').insert({
        project_id: projectId!,
        user_id: user.id,
        scenario_name: input.scenario_name || 'Base Case',
        total_revenue_estimate: input.total_revenue_estimate || 0,
        currency: input.currency || 'USD',
        notes: input.notes || '',
      } as any).select().single();
      if (error) throw error;
      return data as unknown as RecoupmentScenario;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Scenario created'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateScenario = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RecoupmentScenario> & { id: string }) => {
      const { error } = await supabase.from('project_recoupment_scenarios').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScenario = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_recoupment_scenarios').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Scenario removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { scenarios, isLoading, addScenario, updateScenario, deleteScenario };
}

export function useRecoupmentTiers(scenarioId: string | undefined, projectId: string | undefined) {
  const qc = useQueryClient();
  const key = ['recoupment-tiers', scenarioId];

  const { data: tiers = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!scenarioId) return [];
      const { data, error } = await supabase
        .from('project_recoupment_tiers')
        .select('*')
        .eq('scenario_id', scenarioId)
        .order('tier_order', { ascending: true });
      if (error) throw error;
      return data as unknown as RecoupmentTier[];
    },
    enabled: !!scenarioId,
  });

  const addTier = useMutation({
    mutationFn: async (input: Partial<RecoupmentTier>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const nextOrder = tiers.length > 0 ? Math.max(...tiers.map(t => t.tier_order)) + 1 : 0;
      const { error } = await supabase.from('project_recoupment_tiers').insert({
        scenario_id: scenarioId!,
        project_id: projectId!,
        user_id: user.id,
        tier_order: input.tier_order ?? nextOrder,
        participant_name: input.participant_name || '',
        tier_type: input.tier_type || 'recoup',
        percentage: input.percentage || 0,
        fixed_amount: input.fixed_amount || 0,
        cap: input.cap ?? null,
        notes: input.notes || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateTier = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RecoupmentTier> & { id: string }) => {
      const { error } = await supabase.from('project_recoupment_tiers').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTier = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_recoupment_tiers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  return { tiers, isLoading, addTier, updateTier, deleteTier };
}
