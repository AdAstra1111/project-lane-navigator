/**
 * Cost Actuals Tracker
 *
 * UI for tracking actual spend vs budget per department.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useCostActuals, type CostActual } from '@/hooks/useProductionMonitoring';

interface Props {
  projectId: string;
}

const DEFAULT_DEPARTMENTS = [
  'Above the Line', 'Production', 'Art & Design', 'Camera & Lighting',
  'Sound', 'Wardrobe & Makeup', 'VFX & Post', 'Music',
  'Locations', 'Insurance & Legal', 'Contingency',
];

export function CostActualsTracker({ projectId }: Props) {
  const { actuals, addActual, updateActual, deleteActual } = useCostActuals(projectId);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ department: '', budgeted: 0, actual: 0, notes: '' });
  const [editForm, setEditForm] = useState({ budgeted: 0, actual: 0, notes: '' });

  const handleAdd = () => {
    if (!form.department) return;
    addActual.mutate({
      department: form.department,
      budgeted: form.budgeted,
      actual: form.actual,
      notes: form.notes,
    }, {
      onSuccess: () => {
        setAdding(false);
        setForm({ department: '', budgeted: 0, actual: 0, notes: '' });
      },
    });
  };

  const handleSaveEdit = (id: string) => {
    updateActual.mutate({
      id,
      budgeted: editForm.budgeted,
      actual: editForm.actual,
      notes: editForm.notes,
    } as any);
    setEditingId(null);
  };

  const startEdit = (a: CostActual) => {
    setEditingId(a.id);
    setEditForm({ budgeted: Number(a.budgeted), actual: Number(a.actual), notes: a.notes });
  };

  // Unused departments for quick-add
  const usedDepts = new Set(actuals.map(a => a.department));
  const availableDepts = DEFAULT_DEPARTMENTS.filter(d => !usedDepts.has(d));

  const totalBudgeted = actuals.reduce((s, a) => s + Number(a.budgeted), 0);
  const totalActual = actuals.reduce((s, a) => s + Number(a.actual), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">Cost Actuals</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Department
        </Button>
      </div>

      {/* Summary */}
      {actuals.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Budgeted</div>
            <div className="text-sm font-bold text-foreground">{fmt(totalBudgeted)}</div>
          </div>
          <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Actual</div>
            <div className="text-sm font-bold text-foreground">{fmt(totalActual)}</div>
          </div>
          <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Variance</div>
            <div className={`text-sm font-bold ${totalActual > totalBudgeted ? 'text-red-400' : 'text-emerald-400'}`}>
              {totalActual > totalBudgeted ? '+' : ''}{fmt(totalActual - totalBudgeted)}
            </div>
          </div>
        </div>
      )}

      {adding && (
        <div className="bg-muted/20 rounded-lg p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-muted-foreground uppercase">Department</label>
              <select
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                className="w-full h-8 text-xs rounded-md bg-background border border-border px-2"
              >
                <option value="">Select…</option>
                {availableDepts.map(d => <option key={d} value={d}>{d}</option>)}
                <option value="__custom">Custom…</option>
              </select>
            </div>
            {form.department === '__custom' && (
              <div>
                <label className="text-[10px] text-muted-foreground uppercase">Name</label>
                <Input className="h-8 text-xs" onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
              </div>
            )}
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Budgeted</label>
              <Input type="number" min={0} value={form.budgeted} onChange={e => setForm(f => ({ ...f, budgeted: parseFloat(e.target.value) || 0 }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Actual</label>
              <Input type="number" min={0} value={form.actual} onChange={e => setForm(f => ({ ...f, actual: parseFloat(e.target.value) || 0 }))} className="h-8 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!form.department || addActual.isPending}>Save</Button>
          </div>
        </div>
      )}

      {/* Department List */}
      {actuals.length > 0 ? (
        <div className="space-y-1.5">
          {actuals.map(a => {
            const variance = Number(a.variance);
            const variancePct = Number(a.variance_pct);
            const isOver = variance > 0;
            const isEditing = editingId === a.id;

            return (
              <div key={a.id} className={`flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2 ${isOver && variancePct > 10 ? 'border-l-2 border-red-500' : isOver && variancePct > 5 ? 'border-l-2 border-amber-500' : ''}`}>
                {isEditing ? (
                  <>
                    <span className="text-xs font-medium text-foreground flex-1 truncate">{a.department}</span>
                    <Input type="number" value={editForm.budgeted} onChange={e => setEditForm(f => ({ ...f, budgeted: parseFloat(e.target.value) || 0 }))} className="h-6 w-20 text-[10px]" />
                    <Input type="number" value={editForm.actual} onChange={e => setEditForm(f => ({ ...f, actual: parseFloat(e.target.value) || 0 }))} className="h-6 w-20 text-[10px]" />
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleSaveEdit(a.id)}><Check className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-medium text-foreground flex-1 truncate">{a.department}</span>
                    <span className="text-[10px] text-muted-foreground">{fmt(Number(a.budgeted))}</span>
                    <span className="text-[10px] text-muted-foreground">→</span>
                    <span className="text-[10px] text-foreground font-medium">{fmt(Number(a.actual))}</span>
                    {Number(a.budgeted) > 0 && (
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${isOver ? variancePct > 10 ? 'text-red-400 border-red-400/30' : 'text-amber-400 border-amber-500/30' : 'text-emerald-400 border-emerald-500/30'}`}>
                        {isOver ? '+' : ''}{Math.round(variancePct)}%
                      </Badge>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(a)}><Edit2 className="h-3 w-3 text-muted-foreground" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => deleteActual.mutate(a.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : !adding ? (
        <p className="text-xs text-muted-foreground text-center py-4">Track actual spend against budget per department.</p>
      ) : null}
    </motion.div>
  );
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
