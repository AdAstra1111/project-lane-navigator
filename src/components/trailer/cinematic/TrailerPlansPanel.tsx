/**
 * Trailer Plans Panel — manage trailer blueprint variants
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
import { Input } from '@/components/ui/input';
import { Check, Copy, Plus, Film, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface TrailerPlan {
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

const READY_STATUSES = ['complete', 'v2_shim'];

function planLabel(p: TrailerPlan): string {
  const custom = (p.options as any)?.label;
  if (custom) return custom;
  return `${p.arc_type || 'plan'} · ${format(new Date(p.created_at), 'MMM d HH:mm')}`;
}

function statusBadge(status: string) {
  if (READY_STATUSES.includes(status)) return <Badge variant="default" className="text-[10px]">Ready</Badge>;
  if (status === 'failed' || status === 'error') return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
  return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
}

const ARC_TYPES = [
  'classic_three_act',
  'cold_open_hook',
  'mystery_reveal',
  'character_driven',
  'montage_burst',
  'slow_burn',
];

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

interface Props {
  projectId: string;
  activePlanId: string | undefined;
  onSelectPlan: (id: string) => void;
}

export function TrailerPlansPanel({ projectId, activePlanId, onSelectPlan }: Props) {
  const { data: plans, isLoading } = useTrailerPlans(projectId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newArc, setNewArc] = useState('classic_three_act');
  const [intensity, setIntensity] = useState([50]);
  const [emphasis, setEmphasis] = useState([50]);
  const [textCards, setTextCards] = useState([2]);

  const readyPlans = useMemo(() => (plans || []).filter(p => READY_STATUSES.includes(p.status)), [plans]);
  const otherPlans = useMemo(() => (plans || []).filter(p => !READY_STATUSES.includes(p.status)), [plans]);

  // Rename mutation
  const renameMutation = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      // Read current options, merge label
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

  // Create plan variant (inserts a new blueprint row)
  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const options = { intensity: intensity[0], emphasis: emphasis[0], text_cards: textCards[0] };
      const { data, error } = await supabase
        .from('trailer_blueprints')
        .insert({
          project_id: projectId,
          arc_type: newArc,
          status: 'draft',
          created_by: user.id,
          options: options as any,
          edl: [] as any,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trailer-plans', projectId] });
      toast.success('Plan variant created');
      setCreateOpen(false);
      if (data?.id) onSelectPlan(data.id);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Duplicate plan
  const duplicateMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const source = plans?.find(p => p.id === sourceId);
      if (!source) throw new Error('Source plan not found');
      const opts = { ...(source.options || {}), label: `${planLabel(source)} (copy)` };
      const { data, error } = await supabase
        .from('trailer_blueprints')
        .insert({
          project_id: projectId,
          arc_type: source.arc_type,
          status: 'draft',
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
      toast.success('Plan duplicated');
      if (data?.id) onSelectPlan(data.id);
    },
    onError: (e: any) => toast.error(e.message),
  });

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allPlans = [...readyPlans, ...otherPlans];

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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Create Plan Variant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
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
              <div className="space-y-1.5">
                <Label className="text-xs">Intensity <span className="text-muted-foreground ml-1">{intensity[0]}%</span></Label>
                <Slider value={intensity} onValueChange={setIntensity} min={0} max={100} step={5} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Emphasis <span className="text-muted-foreground ml-1">{emphasis[0]}%</span></Label>
                <Slider value={emphasis} onValueChange={setEmphasis} min={0} max={100} step={5} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Text Cards <span className="text-muted-foreground ml-1">{textCards[0]}</span></Label>
                <Slider value={textCards} onValueChange={setTextCards} min={0} max={6} step={1} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs">Cancel</Button>
                </DialogClose>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Plan List */}
      {allPlans.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No trailer plans yet. Generate one from Script Studio or create a variant above.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {allPlans.map(plan => {
            const isActive = plan.id === activePlanId;
            const beatsCount = Array.isArray(plan.edl) ? plan.edl.length : 0;
            return (
              <Card
                key={plan.id}
                className={`cursor-pointer transition-colors ${isActive ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/30'}`}
                onClick={() => onSelectPlan(plan.id)}
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
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{plan.arc_type.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{beatsCount} beats</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(plan.created_at), 'MMM d')}</span>
                    </div>
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

/** Auto-select latest ready plan for simple mode */
export function useAutoSelectPlan(projectId: string | undefined) {
  const { data: plans } = useTrailerPlans(projectId);
  return useMemo(() => {
    const ready = (plans || []).filter(p => READY_STATUSES.includes(p.status));
    return ready.length > 0 ? ready[0].id : undefined;
  }, [plans]);
}
