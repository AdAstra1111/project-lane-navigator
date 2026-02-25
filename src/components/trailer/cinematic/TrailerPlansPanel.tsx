/**
 * Trailer Plans Panel — manage trailer plan variants (FAST / DEEP / FULL REBUILD)
 * Studio-only: hidden in Simple mode (auto-select latest ready plan).
 */
import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Check, Copy, Plus, Film, Loader2, Zap, Layers, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cinematicApi } from '@/lib/trailerPipeline/cinematicApi';

// ─── Types ───

export interface TrailerPlan {
  id: string;
  project_id: string;
  arc_type: string;
  status: string;
  edl: any[];
  options: Record<string, any>;
  created_at: string;
  created_by: string;
  error: string | null;
}

export const READY_STATUSES = ['ready', 'complete', 'v2_shim'];

export type VariantType = 'FAST' | 'DEEP' | 'FULL_REBUILD';

// ─── Helpers ───

function planLabel(p: TrailerPlan): string {
  const custom = p.options?.label;
  if (custom) return custom;
  const vt = p.options?.variant_type;
  const prefix = vt ? `${vt} · ` : '';
  return `${prefix}${(p.arc_type || 'plan').replace(/_/g, ' ')} · ${format(new Date(p.created_at), 'MMM d HH:mm')}`;
}

function statusBadge(status: string) {
  if (READY_STATUSES.includes(status))
    return <Badge variant="default" className="text-[10px]">Ready</Badge>;
  if (status === 'failed' || status === 'error')
    return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
  if (status === 'draft')
    return <Badge variant="secondary" className="text-[10px]">Draft</Badge>;
  return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
}

function variantBadge(vt?: string) {
  if (!vt) return null;
  const map: Record<string, { icon: React.ReactNode; cls: string }> = {
    FAST: { icon: <Zap className="h-2.5 w-2.5" />, cls: 'bg-accent/40 text-accent-foreground' },
    DEEP: { icon: <Layers className="h-2.5 w-2.5" />, cls: 'bg-primary/20 text-primary' },
    FULL_REBUILD: { icon: <RefreshCw className="h-2.5 w-2.5" />, cls: 'bg-primary/30 text-primary' },
  };
  const m = map[vt] || map.FAST;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium ${m.cls}`}>
      {m.icon} {vt.replace(/_/g, ' ')}
    </span>
  );
}

const ARC_TYPES = [
  'classic_three_act', 'cold_open_hook', 'mystery_reveal',
  'character_driven', 'montage_burst', 'slow_burn',
];

const EMPHASIS_OPTIONS = ['Hook', 'Character', 'World', 'Mystery', 'Action'] as const;
const STYLE_OPTIONS = ['grounded', 'glossy', 'gritty', 'arthouse'] as const;
const VO_OPTIONS = ['none', 'sparse', 'guided'] as const;
const TEXT_CARD_OPTIONS = ['none', 'light', 'normal', 'heavy'] as const;

// ─── Hook: Fetch plans ───

export function useTrailerPlans(projectId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-plans', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_blueprints')
        .select('id, project_id, arc_type, status, edl, options, created_at, created_by, error')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as TrailerPlan[];
    },
    enabled: !!projectId,
  });
}

/** Auto-select latest ready plan */
export function useAutoSelectPlan(projectId: string | undefined) {
  const { data: plans } = useTrailerPlans(projectId);
  return useMemo(() => {
    const ready = (plans || []).filter(p => READY_STATUSES.includes(p.status));
    return ready.length > 0 ? ready[0].id : undefined;
  }, [plans]);
}

// ─── Props ───

interface Props {
  projectId: string;
  activePlanId: string | undefined;
  onSelectPlan: (id: string) => void;
  scriptRunId?: string;
  canonPackId?: string;
}

// ─── Component ───

export function TrailerPlansPanel({ projectId, activePlanId, onSelectPlan, scriptRunId, canonPackId }: Props) {
  const { data: plans, isLoading } = useTrailerPlans(projectId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [variantTab, setVariantTab] = useState<VariantType>('FAST');

  // Modal form state
  const [newArc, setNewArc] = useState('classic_three_act');
  const [intensity, setIntensity] = useState([5]);
  const [emphasis, setEmphasis] = useState('Hook');
  const [style, setStyle] = useState('grounded');
  const [textCards, setTextCards] = useState('normal');
  const [voiceover, setVoiceover] = useState('none');
  const [exploration, setExploration] = useState([5]);

  const readyPlans = useMemo(() => (plans || []).filter(p => READY_STATUSES.includes(p.status)), [plans]);
  const failedPlans = useMemo(() => (plans || []).filter(p => p.status === 'failed' || p.status === 'error'), [plans]);
  const otherPlans = useMemo(() => (plans || []).filter(p => !READY_STATUSES.includes(p.status) && p.status !== 'failed' && p.status !== 'error'), [plans]);

  // ─── Rename mutation ───
  const renameMutation = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const plan = plans?.find(p => p.id === id);
      const opts = { ...(plan?.options || {}), label };
      const { error } = await supabase
        .from('trailer_blueprints')
        .update({ options: opts as any })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trailer-plans', projectId] }),
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Create variant mutation ───
  const createVariantMutation = useMutation({
    mutationFn: async (vType: VariantType) => {
      const options = {
        variant_type: vType,
        intensity: intensity[0],
        emphasis,
        style,
        text_cards: textCards,
        voiceover,
        exploration: vType !== 'FAST' ? exploration[0] : undefined,
      };

      const actionMap: Record<VariantType, string> = {
        FAST: 'create_trailer_plan_variant_fast',
        DEEP: 'create_trailer_plan_variant_deep',
        FULL_REBUILD: 'create_trailer_plan_variant_full_rebuild',
      };

      const result = await cinematicApi.createTrailerPlanVariant({
        projectId,
        action: actionMap[vType],
        arc_type: newArc,
        options,
        scriptRunId,
        canonPackId,
      });

      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trailer-plans', projectId] });
      queryClient.invalidateQueries({ queryKey: ['trailer-blueprints', projectId] });
      toast.success('Trailer Plan created');
      setCreateOpen(false);
      if (data?.blueprintId) onSelectPlan(data.blueprintId);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Duplicate mutation ───
  const duplicateMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const source = plans?.find(p => p.id === sourceId);
      if (!source) throw new Error('Source plan not found');
      const opts = {
        ...(source.options || {}),
        label: `${planLabel(source)} (copy)`,
        variant_type: 'FAST',
      };
      const { data, error } = await supabase
        .from('trailer_blueprints')
        .insert({
          project_id: projectId,
          arc_type: source.arc_type,
          status: READY_STATUSES.includes(source.status) ? source.status : 'draft',
          created_by: user.id,
          options: opts as any,
          edl: source.edl as any,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trailer-plans', projectId] });
      queryClient.invalidateQueries({ queryKey: ['trailer-blueprints', projectId] });
      toast.success('Plan duplicated');
      if (data?.id) onSelectPlan(data.id);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Inline editing ───
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback((plan: TrailerPlan) => {
    setEditingLabel(plan.id);
    setEditValue(planLabel(plan));
  }, []);

  const commitEdit = useCallback(() => {
    if (editingLabel && editValue.trim()) {
      renameMutation.mutate({ id: editingLabel, label: editValue.trim() });
    }
    setEditingLabel(null);
  }, [editingLabel, editValue, renameMutation]);

  // ─── Render ───

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allPlans = [...readyPlans, ...otherPlans, ...failedPlans];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Trailer Plans</span>
          <Badge variant="outline" className="text-[10px]">{readyPlans.length} ready</Badge>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" /> New Variant
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm">Create Trailer Plan Variant</DialogTitle>
            </DialogHeader>
            <Tabs value={variantTab} onValueChange={(v) => setVariantTab(v as VariantType)}>
              <TabsList className="w-full">
                <TabsTrigger value="FAST" className="flex-1 text-xs gap-1">
                  <Zap className="h-3 w-3" /> Fast
                </TabsTrigger>
                <TabsTrigger value="DEEP" className="flex-1 text-xs gap-1">
                  <Layers className="h-3 w-3" /> Deep
                </TabsTrigger>
                <TabsTrigger value="FULL_REBUILD" className="flex-1 text-xs gap-1">
                  <RefreshCw className="h-3 w-3" /> Full Rebuild
                </TabsTrigger>
              </TabsList>

              {/* Shared form fields */}
              <div className="space-y-3 pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Arc Type</Label>
                  <Select value={newArc} onValueChange={setNewArc}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ARC_TYPES.map(a => (
                        <SelectItem key={a} value={a} className="text-xs">{a.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Emphasis</Label>
                    <Select value={emphasis} onValueChange={setEmphasis}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EMPHASIS_OPTIONS.map(e => (
                          <SelectItem key={e} value={e} className="text-xs">{e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Style</Label>
                    <Select value={style} onValueChange={setStyle}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STYLE_OPTIONS.map(s => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Text Cards</Label>
                    <Select value={textCards} onValueChange={setTextCards}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TEXT_CARD_OPTIONS.map(t => (
                          <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Voiceover</Label>
                    <Select value={voiceover} onValueChange={setVoiceover}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {VO_OPTIONS.map(v => (
                          <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Intensity <span className="text-muted-foreground ml-1">{intensity[0]}/10</span></Label>
                  <Slider value={intensity} onValueChange={setIntensity} min={1} max={10} step={1} />
                </div>

                {variantTab !== 'FAST' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Exploration <span className="text-muted-foreground ml-1">{exploration[0]}/10</span>
                    </Label>
                    <Slider value={exploration} onValueChange={setExploration} min={1} max={10} step={1} />
                    <p className="text-[10px] text-muted-foreground">Conservative → Bold divergence from existing material</p>
                  </div>
                )}

                {variantTab === 'FULL_REBUILD' && (
                  <div className="rounded border border-border bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">
                      <RefreshCw className="h-3 w-3 inline mr-1" />
                      Regenerates Rhythm, Shot Design, and Judge before compiling the plan. Highest quality.
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <DialogClose asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">Cancel</Button>
                  </DialogClose>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => createVariantMutation.mutate(variantTab)}
                    disabled={createVariantMutation.isPending}
                  >
                    {createVariantMutation.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : `Create ${variantTab.replace(/_/g, ' ')} Variant`
                    }
                  </Button>
                </div>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {/* Plan List */}
      {allPlans.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <Film className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No Trailer Plans Yet</p>
            <p className="text-[11px] text-muted-foreground/70">
              IFFY needs a Trailer Plan before it can generate clips. Create one above or run the full pipeline from Script Studio.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {allPlans.map(plan => {
            const isActive = plan.id === activePlanId;
            const beatsCount = Array.isArray(plan.edl) ? plan.edl.length : 0;
            const isFailed = plan.status === 'failed' || plan.status === 'error';
            return (
              <Card
                key={plan.id}
                className={`cursor-pointer transition-colors ${
                  isActive ? 'border-primary/50 bg-primary/5' : isFailed ? 'opacity-60 hover:opacity-80' : 'hover:bg-accent/30'
                }`}
                onClick={() => !isFailed && onSelectPlan(plan.id)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  {/* Active indicator */}
                  <div className={`w-1.5 h-8 rounded-full shrink-0 ${isActive ? 'bg-primary' : 'bg-transparent'}`} />

                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    {editingLabel === plan.id ? (
                      <Input
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e => e.key === 'Enter' && commitEdit()}
                        className="h-6 text-xs"
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="text-xs font-medium truncate block"
                        onDoubleClick={(e) => { e.stopPropagation(); startEdit(plan); }}
                        title="Double-click to rename"
                      >
                        {planLabel(plan)}
                      </span>
                    )}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{plan.arc_type.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{beatsCount} beats</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(plan.created_at), 'MMM d')}</span>
                      {plan.options?.variant_type && variantBadge(plan.options.variant_type)}
                    </div>
                    {isFailed && plan.error && (
                      <div className="flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                        <span className="text-[10px] text-destructive truncate">{plan.error}</span>
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  {statusBadge(plan.status)}

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(plan.id); }}
                      title="Duplicate plan"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
