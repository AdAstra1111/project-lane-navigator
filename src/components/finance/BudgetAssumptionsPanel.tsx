import { useState } from 'react';
import { Calculator, Edit2, Save, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBudgetAssumptions } from '@/hooks/usePromotionModules';

interface Props { projectId: string; }

export function BudgetAssumptionsPanel({ projectId }: Props) {
  const { assumptions, updateAssumptions } = useBudgetAssumptions(projectId);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  if (!assumptions) return null;

  const startEdit = () => {
    setForm({
      currency: assumptions.currency,
      schedule_weeks: assumptions.schedule_weeks,
      shoot_days: assumptions.shoot_days,
      union_level: assumptions.union_level,
      location_count: assumptions.location_count,
      vfx_level: assumptions.vfx_level,
      cast_level: assumptions.cast_level,
      notes: assumptions.notes,
    });
    setEditing(true);
  };

  const saveEdit = () => {
    updateAssumptions(form);
    setEditing(false);
  };

  const fields = [
    { key: 'currency', label: 'Currency', type: 'text' },
    { key: 'schedule_weeks', label: 'Schedule (weeks)', type: 'number' },
    { key: 'shoot_days', label: 'Shoot Days', type: 'number' },
    { key: 'union_level', label: 'Union Level', type: 'text' },
    { key: 'location_count', label: 'Locations', type: 'number' },
    { key: 'vfx_level', label: 'VFX Level', type: 'select', options: ['none', 'light', 'moderate', 'heavy'] },
    { key: 'cast_level', label: 'Cast Level', type: 'text' },
  ];

  return (
    <Card className="border-border/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" /> Budget Assumptions
          </CardTitle>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">v{assumptions.version}</Badge>
            {editing ? (
              <>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditing(false)}>
                  <X className="h-3 w-3" /> Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={saveEdit}>
                  <Save className="h-3 w-3" /> Save
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={startEdit}>
                <Edit2 className="h-3 w-3" /> Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {assumptions.budget_band && (
          <Badge className="mb-3 bg-primary/15 text-primary border-primary/30 text-xs">
            {assumptions.budget_band}
          </Badge>
        )}
        <div className="grid grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.key}>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">{f.label}</Label>
              {editing ? (
                f.type === 'select' ? (
                  <Select value={form[f.key] || ''} onValueChange={v => setForm(p => ({ ...p, [f.key]: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {f.options?.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={f.type}
                    className="h-8 text-xs"
                    value={form[f.key] ?? ''}
                    onChange={e => setForm(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
                  />
                )
              ) : (
                <p className="text-sm font-medium">{(assumptions as any)[f.key] || '—'}</p>
              )}
            </div>
          ))}
        </div>
        {assumptions.notes && !editing && (
          <p className="text-xs text-muted-foreground mt-3 italic">{assumptions.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
