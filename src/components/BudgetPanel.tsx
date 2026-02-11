import { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DollarSign, Plus, Trash2, Check, X, Upload, FileSpreadsheet, Lock, Unlock, ChevronDown, Info, ArrowLeftRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  useProjectBudgets,
  useBudgetLines,
  getTemplateForLane,
  parseCSVBudget,
  BUDGET_CATEGORIES,
  type ProjectBudget,
} from '@/hooks/useBudgets';
import { BudgetCompareView } from '@/components/BudgetCompareView';

// ---- Template options ----
const TEMPLATE_OPTIONS = [
  { value: 'studio-streamer', label: 'Studio / Streamer', desc: 'High-budget studio or streaming platform project with significant VFX and top-tier cast.' },
  { value: 'independent-film', label: 'Independent Film', desc: 'Mid-range indie with balanced crew spend, moderate cast, and room for deferrals.' },
  { value: 'low-budget', label: 'Low Budget / Micro', desc: 'Lean production relying on skeleton crew, deferred pay, and higher contingency.' },
  { value: 'genre-market', label: 'Genre / Market-Driven', desc: 'Commercial genre title prioritising cast name-value and VFX/practical effects.' },
  { value: 'default', label: 'General Purpose', desc: 'Balanced default split suitable for any format or lane.' },
];

function TemplatePreviewDialog({ open, onOpenChange, templateKey }: { open: boolean; onOpenChange: (v: boolean) => void; templateKey: string }) {
  const template = getTemplateForLane(templateKey);
  const opt = TEMPLATE_OPTIONS.find(t => t.value === templateKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{opt?.label || templateKey} Template</DialogTitle>
          <DialogDescription className="text-xs">{opt?.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 mt-2">
          {template.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ${CAT_STYLES[t.category] || CAT_STYLES.other}`}>
                {BUDGET_CATEGORIES.find(b => b.value === t.category)?.label || t.category}
              </Badge>
              <span className="text-xs text-foreground flex-1">{t.line_name}</span>
              <span className="text-xs font-semibold text-foreground">{t.pct}%</span>
            </div>
          ))}
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden flex mt-3">
          {template.map((t, i) => (
            <div
              key={i}
              className="h-full"
              style={{
                width: `${t.pct}%`,
                background: t.category === 'atl' ? 'hsl(270,60%,60%)'
                  : t.category === 'btl' ? 'hsl(200,70%,55%)'
                  : t.category === 'post' ? 'hsl(35,80%,55%)'
                  : t.category === 'vfx' ? 'hsl(340,65%,55%)'
                  : t.category === 'contingency' ? 'hsl(25,85%,55%)'
                  : t.category === 'soft-money' ? 'hsl(80,60%,50%)'
                  : 'hsl(var(--primary))',
              }}
              title={`${t.line_name}: ${t.pct}%`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Category Colors ----
const CAT_STYLES: Record<string, string> = {
  atl: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  btl: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  post: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  vfx: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  logistics: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  schedule: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  contingency: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'soft-money': 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  other: 'bg-muted text-muted-foreground border-border',
};

// ---- Budget Detail View ----
function BudgetDetailView({
  budget,
  projectId,
  onBack,
}: {
  budget: ProjectBudget;
  projectId: string;
  onBack: () => void;
}) {
  const { lines, addLine, addLines, updateLine, deleteLine } = useBudgetLines(budget.id, projectId);
  const { updateBudget } = useProjectBudgets(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ category: 'atl', line_name: '', amount: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const totalFromLines = useMemo(() => lines.reduce((s, l) => s + Number(l.amount), 0), [lines]);
  const byCategory = useMemo(() => {
    const cats: Record<string, { total: number; count: number }> = {};
    for (const l of lines) {
      if (!cats[l.category]) cats[l.category] = { total: 0, count: 0 };
      cats[l.category].total += Number(l.amount);
      cats[l.category].count += 1;
    }
    return cats;
  }, [lines]);

  const handleAdd = () => {
    if (!form.line_name.trim()) return;
    addLine.mutate({ category: form.category, line_name: form.line_name, amount: parseFloat(form.amount) || 0 });
    setForm({ category: 'atl', line_name: '', amount: '' });
    setAdding(false);
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSVBudget(text);
      if (parsed.length === 0) return;
      addLines.mutate(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLockToggle = () => {
    updateBudget.mutate({
      id: budget.id,
      status: budget.status === 'locked' ? 'draft' : 'locked',
      total_amount: totalFromLines,
    });
  };

  const isLocked = budget.status === 'locked';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">← All Budgets</Button>
          <span className="text-sm font-medium text-foreground">{budget.version_label}</span>
          <Badge className={`text-[10px] px-1.5 py-0 border ${isLocked ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border'}`}>
            {isLocked ? 'Locked' : 'Draft'}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          {!isLocked && (
            <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3 w-3" /> CSV
            </Button>
          )}
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleLockToggle}>
            {isLocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {isLocked ? 'Unlock' : 'Lock'}
          </Button>
        </div>
      </div>

      {/* Total */}
      <div className="bg-muted/30 rounded-lg px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Total Budget</span>
          <span className="text-lg font-bold text-foreground">
            {budget.currency} {totalFromLines.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {/* Category breakdown bar */}
      {lines.length > 0 && totalFromLines > 0 && (
        <div className="space-y-2">
          <div className="h-3 rounded-full bg-muted overflow-hidden flex">
            {Object.entries(byCategory)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([cat, { total }]) => (
                <div
                  key={cat}
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${(total / totalFromLines) * 100}%`,
                    background: cat === 'atl' ? 'hsl(270, 60%, 60%)'
                      : cat === 'btl' ? 'hsl(200, 70%, 55%)'
                      : cat === 'post' ? 'hsl(35, 80%, 55%)'
                      : cat === 'vfx' ? 'hsl(340, 65%, 55%)'
                      : cat === 'contingency' ? 'hsl(25, 85%, 55%)'
                      : 'hsl(var(--primary))',
                  }}
                  title={`${BUDGET_CATEGORIES.find(b => b.value === cat)?.label || cat}: ${((total / totalFromLines) * 100).toFixed(1)}%`}
                />
              ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(byCategory)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([cat, { total }]) => (
                <span key={cat} className="text-[10px] text-muted-foreground">
                  {BUDGET_CATEGORIES.find(b => b.value === cat)?.label || cat}: {((total / totalFromLines) * 100).toFixed(0)}%
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="space-y-1">
        {lines.map(l => (
          <div key={l.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-1.5">
            <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ${CAT_STYLES[l.category] || CAT_STYLES.other}`}>
              {BUDGET_CATEGORIES.find(b => b.value === l.category)?.label || l.category}
            </Badge>
            <span className="text-xs text-foreground flex-1 truncate">{l.line_name}</span>
            <span className="text-xs font-medium text-foreground shrink-0">
              {Number(l.amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            {totalFromLines > 0 && (
              <span className="text-[10px] text-muted-foreground w-10 text-right">
                {((Number(l.amount) / totalFromLines) * 100).toFixed(0)}%
              </span>
            )}
            {!isLocked && (
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => deleteLine.mutate(l.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add line */}
      {!isLocked && (
        adding ? (
          <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUDGET_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Line item name" value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} className="h-8 text-sm flex-1" />
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="Amount" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-8 text-sm w-28" type="number" />
              <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.line_name.trim()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Line Item
          </Button>
        )
      )}
    </div>
  );
}

// ---- Main Panel ----
interface Props {
  projectId: string;
  assignedLane?: string | null;
}

export function BudgetPanel({ projectId, assignedLane }: Props) {
  const { budgets, addBudget, deleteBudget } = useProjectBudgets(projectId);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [form, setForm] = useState({ version_label: '', total_amount: '', selectedTemplate: assignedLane || 'default' });
  const [previewTemplate, setPreviewTemplate] = useState<string | null>(null);

  const selectedBudget = budgets.find(b => b.id === selectedBudgetId);

  const handleCreate = () => {
    const total = parseFloat(form.total_amount) || 0;
    const templateKey = form.selectedTemplate === 'none' ? '' : form.selectedTemplate;

    addBudget.mutate(
      {
        version_label: form.version_label || `Budget v${budgets.length + 1}`,
        total_amount: total,
        lane_template: templateKey || '',
      },
      {
        onSuccess: async (newBudget: any) => {
          setCreating(false);
          setForm({ version_label: '', total_amount: '', selectedTemplate: assignedLane || 'default' });
          setSelectedBudgetId(newBudget.id);
          // Auto-generate template lines
          if (templateKey && total > 0) {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const template = getTemplateForLane(templateKey);
            const rows = template.map((t, i) => ({
              budget_id: newBudget.id,
              project_id: projectId,
              user_id: user.id,
              category: t.category,
              line_name: t.line_name,
              amount: Math.round(total * (t.pct / 100)),
              sort_order: i,
            }));
            await supabase.from('project_budget_lines').insert(rows as any);
          }
        },
      },
    );
  };

  // Compare view
  if (comparing) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <BudgetCompareView budgets={budgets} projectId={projectId} onBack={() => setComparing(false)} />
      </motion.div>
    );
  }

  // If a budget is selected, show detail view
  if (selectedBudget) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <BudgetDetailView
          budget={selectedBudget}
          projectId={projectId}
          onBack={() => setSelectedBudgetId(null)}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="space-y-3"
    >
      {/* Budget versions list */}
      {budgets.map(b => (
        <div
          key={b.id}
          className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setSelectedBudgetId(b.id)}
        >
          <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{b.version_label}</span>
              <Badge className={`text-[10px] px-1.5 py-0 border ${b.status === 'locked' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border'}`}>
                {b.status}
              </Badge>
              {b.lane_template && (
                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{b.lane_template}</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {b.currency} {Number(b.total_amount).toLocaleString()} · {new Date(b.created_at).toLocaleDateString()}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={e => { e.stopPropagation(); deleteBudget.mutate(b.id); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {/* Create form */}
      {creating ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input
            placeholder="Version label (e.g. Budget v1)"
            value={form.version_label}
            onChange={e => setForm(f => ({ ...f, version_label: e.target.value }))}
            className="h-8 text-sm"
          />
          <Input
            placeholder="Total budget amount"
            value={form.total_amount}
            onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))}
            className="h-8 text-sm"
            type="number"
          />
          <div className="flex items-center gap-2">
            <Select value={form.selectedTemplate} onValueChange={v => setForm(f => ({ ...f, selectedTemplate: v }))}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Choose a template…" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {TEMPLATE_OPTIONS.map(t => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
                <SelectItem value="none" className="text-xs text-muted-foreground">No template (blank)</SelectItem>
              </SelectContent>
            </Select>
            {form.selectedTemplate && form.selectedTemplate !== 'none' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                onClick={() => setPreviewTemplate(form.selectedTemplate)}
                type="button"
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleCreate} className="text-xs">Create Budget</Button>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} className="text-xs">Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {budgets.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <DollarSign className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Project Budgets</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Create versioned budgets with lane-aware templates. Import from CSV or build line items manually. Each version becomes a snapshot you can compare against financing assumptions.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setCreating(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Budget Version
          </Button>
          {budgets.length >= 2 && (
            <Button variant="outline" size="sm" onClick={() => setComparing(true)} className="w-full">
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" /> Compare Versions
            </Button>
          )}
        </div>
      )}

      {/* Template preview dialog */}
      <TemplatePreviewDialog
        open={!!previewTemplate}
        onOpenChange={() => setPreviewTemplate(null)}
        templateKey={previewTemplate || 'default'}
      />
    </motion.div>
  );
}
