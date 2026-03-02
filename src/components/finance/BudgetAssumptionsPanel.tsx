import { useState } from 'react';
import { Calculator, Edit2, Save, X, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBudgetAssumptions } from '@/hooks/usePromotionModules';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  getProjectModality,
  MODALITY_LABELS,
  MODALITY_COST_FACTORS,
  isAnimationModality,
  type ProductionModality,
} from '@/config/productionModality';

interface Props { projectId: string; }

export function BudgetAssumptionsPanel({ projectId }: Props) {
  const { assumptions, updateAssumptions } = useBudgetAssumptions(projectId);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  // Fetch project modality for overlay
  const { data: modality } = useQuery({
    queryKey: ['project-modality', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('project_features')
        .eq('id', projectId)
        .single();
      return getProjectModality(data?.project_features as Record<string, any> | null);
    },
    enabled: !!projectId,
  });

  if (!assumptions) return null;

  const effectiveModality: ProductionModality = modality || 'live_action';
  const showOverlay = isAnimationModality(effectiveModality);
  const factors = MODALITY_COST_FACTORS[effectiveModality];

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

  // Compute modality-adjusted values (display only, not persisted)
  const adjustedSchedule = assumptions.schedule_weeks
    ? Math.round(assumptions.schedule_weeks * factors.schedule_multiplier * 10) / 10
    : null;
  const adjustedEstimate = assumptions.estimated_total
    ? Math.round(assumptions.estimated_total * factors.crew_cost_multiplier * factors.post_multiplier)
    : null;

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

        {/* ── Modality Overlay (deterministic, display-only) ── */}
        {showOverlay && (
          <div className="mt-4 p-3 rounded-md border border-accent/30 bg-accent/5">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-3.5 w-3.5 text-accent-foreground" />
              <span className="text-xs font-semibold text-accent-foreground">
                Modality Overlay: {MODALITY_LABELS[effectiveModality]}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>Schedule ×{factors.schedule_multiplier}{adjustedSchedule != null && ` → ${adjustedSchedule} wks`}</div>
              <div>Crew Cost ×{factors.crew_cost_multiplier}</div>
              <div>Location ×{factors.location_multiplier}</div>
              <div>Post ×{factors.post_multiplier}</div>
              <div>VFX ×{factors.vfx_multiplier}</div>
              {adjustedEstimate != null && (
                <div className="col-span-2 font-medium text-foreground">
                  Adjusted Est: {assumptions.currency || '$'}{adjustedEstimate.toLocaleString()}
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 italic">
              Overlay only — base assumptions unchanged. Multipliers from MODALITY_COST_FACTORS.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
