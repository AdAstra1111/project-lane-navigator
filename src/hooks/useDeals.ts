import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectDeal {
  id: string;
  project_id: string;
  user_id: string;
  territory: string;
  buyer_name: string;
  deal_type: string;
  status: string;
  minimum_guarantee: string;
  currency: string;
  notes: string;
  offered_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Finance categories ───
export type DealCategory = 'sales' | 'equity' | 'incentive' | 'soft-money' | 'gap' | 'other';

export const DEAL_CATEGORIES: { value: DealCategory; label: string; description: string }[] = [
  { value: 'sales', label: 'Sales & Distribution', description: 'Pre-sales, MGs, territory deals' },
  { value: 'equity', label: 'Equity & Investment', description: 'Private equity, co-finance, studio investment' },
  { value: 'incentive', label: 'Tax Incentives', description: 'Tax credits, rebates, secured incentives' },
  { value: 'soft-money', label: 'Soft Money', description: 'Grants, funds, broadcaster pre-buys' },
  { value: 'gap', label: 'Gap & Debt', description: 'Gap finance, bridge loans, bank debt' },
  { value: 'other', label: 'Other', description: 'Deferments, in-kind, product placement' },
];

// Maps deal_type values → category
export const DEAL_TYPE_CATEGORY: Record<string, DealCategory> = {
  // Sales
  'all-rights': 'sales',
  'theatrical': 'sales',
  'streaming': 'sales',
  'broadcast': 'sales',
  'home-ent': 'sales',
  'airline': 'sales',
  'presale': 'sales',
  // Equity
  'equity': 'equity',
  'co-finance': 'equity',
  'studio-deal': 'equity',
  // Incentive
  'tax-credit': 'incentive',
  'rebate': 'incentive',
  'cash-grant': 'incentive',
  // Soft money
  'fund-grant': 'soft-money',
  'broadcaster-prebuy': 'soft-money',
  'development-fund': 'soft-money',
  // Gap
  'gap-finance': 'gap',
  'bridge-loan': 'gap',
  'bank-debt': 'gap',
  // Other
  'deferment': 'other',
  'in-kind': 'other',
  'product-placement': 'other',
  'other': 'other',
};

export const DEAL_TYPES_BY_CATEGORY: Record<DealCategory, { value: string; label: string }[]> = {
  sales: [
    { value: 'all-rights', label: 'All Rights' },
    { value: 'presale', label: 'Pre-Sale' },
    { value: 'theatrical', label: 'Theatrical' },
    { value: 'streaming', label: 'Streaming' },
    { value: 'broadcast', label: 'Broadcast' },
    { value: 'home-ent', label: 'Home Entertainment' },
    { value: 'airline', label: 'Airline' },
  ],
  equity: [
    { value: 'equity', label: 'Private Equity' },
    { value: 'co-finance', label: 'Co-Finance' },
    { value: 'studio-deal', label: 'Studio Deal' },
  ],
  incentive: [
    { value: 'tax-credit', label: 'Tax Credit' },
    { value: 'rebate', label: 'Rebate' },
    { value: 'cash-grant', label: 'Cash Grant' },
  ],
  'soft-money': [
    { value: 'fund-grant', label: 'Fund / Grant' },
    { value: 'broadcaster-prebuy', label: 'Broadcaster Pre-Buy' },
    { value: 'development-fund', label: 'Development Fund' },
  ],
  gap: [
    { value: 'gap-finance', label: 'Gap Finance' },
    { value: 'bridge-loan', label: 'Bridge Loan' },
    { value: 'bank-debt', label: 'Bank Debt' },
  ],
  other: [
    { value: 'deferment', label: 'Deferment' },
    { value: 'in-kind', label: 'In-Kind' },
    { value: 'product-placement', label: 'Product Placement' },
    { value: 'other', label: 'Other' },
  ],
};

const DEAL_STATUSES = ['offered', 'negotiating', 'term-sheet', 'closed', 'passed'] as const;
// Keep legacy export for backward compat
const DEAL_TYPES = Object.values(DEAL_TYPES_BY_CATEGORY).flat().map(t => t.value);

export { DEAL_STATUSES, DEAL_TYPES };

export function getCategoryForDealType(dealType: string): DealCategory {
  return DEAL_TYPE_CATEGORY[dealType] || 'other';
}

export function useProjectDeals(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-deals', projectId];

  const { data: deals = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_deals')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ProjectDeal[];
    },
    enabled: !!projectId,
  });

  const addDeal = useMutation({
    mutationFn: async (input: Partial<ProjectDeal>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_deals').insert({
        project_id: projectId!,
        user_id: user.id,
        territory: input.territory || '',
        buyer_name: input.buyer_name || '',
        deal_type: input.deal_type || 'all-rights',
        status: input.status || 'offered',
        minimum_guarantee: input.minimum_guarantee || '',
        currency: input.currency || 'USD',
        notes: input.notes || '',
        offered_at: input.offered_at || new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deal added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateDeal = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectDeal> & { id: string }) => {
      const { error } = await supabase.from('project_deals').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deal updated'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_deals').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deal removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalMG = deals
    .filter(d => d.status === 'closed' && d.minimum_guarantee)
    .reduce((sum, d) => sum + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);

  // Group deals by category
  const dealsByCategory = deals.reduce<Record<DealCategory, ProjectDeal[]>>((acc, deal) => {
    const cat = getCategoryForDealType(deal.deal_type);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(deal);
    return acc;
  }, {} as Record<DealCategory, ProjectDeal[]>);

  // Per-category totals (closed deals)
  const categoryTotals = DEAL_CATEGORIES.reduce<Record<DealCategory, number>>((acc, cat) => {
    const catDeals = dealsByCategory[cat.value] || [];
    acc[cat.value] = catDeals
      .filter(d => d.status === 'closed' && d.minimum_guarantee)
      .reduce((sum, d) => sum + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);
    return acc;
  }, {} as Record<DealCategory, number>);

  return { deals, isLoading, addDeal, updateDeal, deleteDeal, totalMG, dealsByCategory, categoryTotals };
}
