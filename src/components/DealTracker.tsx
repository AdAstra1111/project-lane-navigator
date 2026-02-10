import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Handshake, TrendingUp, X, ChevronDown, ChevronUp, DollarSign, Landmark, Gift, PiggyBank, CreditCard, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useProjectDeals,
  DEAL_STATUSES,
  DEAL_CATEGORIES,
  DEAL_TYPES_BY_CATEGORY,
  getCategoryForDealType,
  type ProjectDeal,
  type DealCategory,
} from '@/hooks/useDeals';

const STATUS_COLORS: Record<string, string> = {
  offered: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  negotiating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'term-sheet': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  closed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  passed: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const CATEGORY_ICONS: Record<DealCategory, React.ElementType> = {
  sales: Handshake,
  equity: DollarSign,
  incentive: Landmark,
  'soft-money': Gift,
  gap: CreditCard,
  other: Package,
};

// Labels for buyer/source field per category
const SOURCE_LABELS: Record<DealCategory, string> = {
  sales: 'Buyer / Distributor',
  equity: 'Investor / Fund',
  incentive: 'Program / Authority',
  'soft-money': 'Funder / Broadcaster',
  gap: 'Lender / Bank',
  other: 'Source / Partner',
};

// Labels for territory/jurisdiction per category
const TERRITORY_LABELS: Record<DealCategory, string> = {
  sales: 'Territory',
  equity: 'Territory / Region',
  incentive: 'Jurisdiction',
  'soft-money': 'Territory / Region',
  gap: 'Region',
  other: 'Territory',
};

// Label for amount per category
const AMOUNT_LABELS: Record<DealCategory, string> = {
  sales: 'MG / Amount',
  equity: 'Investment Amount',
  incentive: 'Estimated Benefit',
  'soft-money': 'Grant / Amount',
  gap: 'Loan / Amount',
  other: 'Amount',
};

interface DealFormState {
  territory: string;
  buyer_name: string;
  deal_type: string;
  minimum_guarantee: string;
  currency: string;
  notes: string;
}

const emptyForm = (category: DealCategory): DealFormState => ({
  territory: '',
  buyer_name: '',
  deal_type: DEAL_TYPES_BY_CATEGORY[category][0]?.value || 'other',
  minimum_guarantee: '',
  currency: 'USD',
  notes: '',
});

function DealRow({
  deal,
  onUpdate,
  onDelete,
}: {
  deal: ProjectDeal;
  onUpdate: (data: Partial<ProjectDeal> & { id: string }) => void;
  onDelete: (id: string) => void;
}) {
  const cat = getCategoryForDealType(deal.deal_type);
  const typeLabel = DEAL_TYPES_BY_CATEGORY[cat]?.find(t => t.value === deal.deal_type)?.label || deal.deal_type.replace(/-/g, ' ');

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground truncate">
              {deal.territory || '—'}
            </span>
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">{deal.buyer_name}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0">{typeLabel}</Badge>
            {deal.notes && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{deal.notes}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {deal.minimum_guarantee && (
          <span className="text-xs font-medium text-foreground">${deal.minimum_guarantee}</span>
        )}
        <Select
          value={deal.status}
          onValueChange={v =>
            onUpdate({
              id: deal.id,
              status: v,
              ...(v === 'closed' ? { closed_at: new Date().toISOString() } : {}),
            })
          }
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEAL_STATUSES.map(s => (
              <SelectItem key={s} value={s}>
                {s.replace(/-/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100"
          onClick={() => onDelete(deal.id)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function CategorySection({
  category,
  deals,
  total,
  onUpdate,
  onDelete,
  onAdd,
}: {
  category: (typeof DEAL_CATEGORIES)[number];
  deals: ProjectDeal[];
  total: number;
  onUpdate: (data: Partial<ProjectDeal> & { id: string }) => void;
  onDelete: (id: string) => void;
  onAdd: (cat: DealCategory) => void;
}) {
  const Icon = CATEGORY_ICONS[category.value];
  const closedCount = deals.filter(d => d.status === 'closed').length;
  const activeCount = deals.filter(d => !['closed', 'passed'].includes(d.status)).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">{category.label}</h4>
          {deals.length > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {activeCount} active · {closedCount} closed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-xs font-medium text-emerald-400">
              ${(total / 1000).toFixed(0)}K secured
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAdd(category.value)}>
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {deals.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-6 py-1">{category.description}</p>
      ) : (
        <div className="space-y-0.5">
          {deals.map(deal => (
            <DealRow key={deal.id} deal={deal} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DealTracker({ projectId }: { projectId: string }) {
  const { deals, addDeal, updateDeal, deleteDeal, totalMG, dealsByCategory, categoryTotals } =
    useProjectDeals(projectId);
  const [addingCategory, setAddingCategory] = useState<DealCategory | null>(null);
  const [form, setForm] = useState<DealFormState>(emptyForm('sales'));

  const handleAdd = () => {
    addDeal.mutate(form);
    setForm(emptyForm(addingCategory || 'sales'));
    setAddingCategory(null);
  };

  const openAddForm = (cat: DealCategory) => {
    setAddingCategory(cat);
    setForm(emptyForm(cat));
  };

  const closedTotal = deals
    .filter(d => d.status === 'closed' && d.minimum_guarantee)
    .reduce((sum, d) => sum + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);
  const pipelineTotal = deals
    .filter(d => !['closed', 'passed'].includes(d.status) && d.minimum_guarantee)
    .reduce((sum, d) => sum + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Finance Tracker</h3>
        </div>
      </div>

      {/* Summary */}
      {deals.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{deals.length}</p>
            <p className="text-xs text-muted-foreground">Total Entries</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">
              {closedTotal > 0 ? `$${(closedTotal / 1000).toFixed(0)}K` : '—'}
            </p>
            <p className="text-xs text-muted-foreground">Secured</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">
              {pipelineTotal > 0 ? `$${(pipelineTotal / 1000).toFixed(0)}K` : '—'}
            </p>
            <p className="text-xs text-muted-foreground">In Pipeline</p>
          </div>
        </div>
      )}

      {/* Add Form */}
      <AnimatePresence>
        {addingCategory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-border rounded-lg p-4 mb-4 space-y-3 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">
                New {DEAL_CATEGORIES.find(c => c.value === addingCategory)?.label} Entry
              </h4>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingCategory(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder={TERRITORY_LABELS[addingCategory]}
                value={form.territory}
                onChange={e => setForm(f => ({ ...f, territory: e.target.value }))}
              />
              <Input
                placeholder={SOURCE_LABELS[addingCategory]}
                value={form.buyer_name}
                onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select value={form.deal_type} onValueChange={v => setForm(f => ({ ...f, deal_type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_TYPES_BY_CATEGORY[addingCategory].map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder={AMOUNT_LABELS[addingCategory]}
                value={form.minimum_guarantee}
                onChange={e => setForm(f => ({ ...f, minimum_guarantee: e.target.value }))}
              />
            </div>
            <Input
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAddingCategory(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!form.territory && !form.buyer_name}>
                Add Entry
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Sections */}
      <div className="space-y-5">
        {DEAL_CATEGORIES.map(cat => (
          <CategorySection
            key={cat.value}
            category={cat}
            deals={dealsByCategory[cat.value] || []}
            total={categoryTotals[cat.value] || 0}
            onUpdate={data => updateDeal.mutate(data)}
            onDelete={id => deleteDeal.mutate(id)}
            onAdd={openAddForm}
          />
        ))}
      </div>

      {deals.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4 mt-2">
          Track all financing sources — from territory sales to tax incentives, equity, and gap finance.
        </p>
      )}
    </motion.div>
  );
}
