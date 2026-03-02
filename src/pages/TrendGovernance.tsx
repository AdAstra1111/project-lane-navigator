import { useState, useMemo, useEffect } from 'react';
import { Save, RotateCcw, History, Loader2, Lock, Unlock, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { PRODUCTION_TYPE_TREND_CATEGORIES } from '@/hooks/useTrends';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { SourceSandboxPanel } from '@/components/corpus/SourceSandboxPanel';
import { ModelAccuracyDashboard } from '@/components/ModelAccuracyDashboard';
import { TrendsPageShell } from '@/components/trends/TrendsPageShell';
import { TrendsFilterBar } from '@/components/trends/TrendsFilterBar';

const PRODUCTION_TYPES = Object.entries(PRODUCTION_TYPE_TREND_CATEGORIES).map(([value, config]) => ({
  value,
  label: config.label,
}));

const LAYER_CONFIG: Record<string, { label: string; color: string }> = {
  market: { label: 'Market Intelligence', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  narrative: { label: 'Narrative Intelligence', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  talent: { label: 'Talent Intelligence', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  platform: { label: 'Platform & Distribution', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
};

interface EngineRow {
  id: string;
  engine_name: string;
  engine_type: string;
  intelligence_layer: string;
  enabled: boolean;
  base_weight_default: number;
  refresh_frequency: string;
  last_refresh: string | null;
  confidence: string;
}

interface WeightRow {
  id: string;
  engine_id: string;
  weight_value: number;
  production_type: string;
}

interface Snapshot {
  id: string;
  snapshot_label: string;
  production_type: string;
  weights: any;
  trigger_type: string;
  notes: string;
  created_at: string;
}

export default function TrendGovernance() {
  const [selectedType, setSelectedType] = useState('film');
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResults, setAuditResults] = useState<any>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: engines = [] } = useQuery({
    queryKey: ['all-engines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('trend_engines').select('*').eq('status', 'active').order('intelligence_layer, engine_name');
      if (error) throw error;
      return data as unknown as EngineRow[];
    },
  });

  const { data: weights = [] } = useQuery({
    queryKey: ['admin-weights', selectedType],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_engine_weights').select('*').eq('production_type', selectedType);
      if (error) throw error;
      return data as unknown as WeightRow[];
    },
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ['weight-snapshots', selectedType],
    queryFn: async () => {
      const { data, error } = await supabase.from('engine_weight_snapshots').select('*').eq('production_type', selectedType).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data as unknown as Snapshot[];
    },
  });

  const [localWeights, setLocalWeights] = useState<Record<string, number>>({});
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [slidersLocked, setSlidersLocked] = useState(true);

  useEffect(() => {
    const wMap: Record<string, number> = {};
    for (const w of weights) wMap[w.engine_id] = w.weight_value;
    for (const e of engines) { if (!(e.id in wMap)) wMap[e.id] = e.base_weight_default; }
    setLocalWeights(wMap);
    const eMap: Record<string, boolean> = {};
    for (const e of engines) eMap[e.id] = e.enabled;
    setLocalEnabled(eMap);
    setHasChanges(false);
  }, [engines, weights]);

  const totalWeight = useMemo(() => {
    return Object.entries(localWeights).filter(([id]) => localEnabled[id] !== false).reduce((s, [, v]) => s + v, 0);
  }, [localWeights, localEnabled]);

  const enginesByLayer = useMemo(() => {
    const grouped: Record<string, EngineRow[]> = {};
    for (const e of engines) { const l = e.intelligence_layer || 'market'; if (!grouped[l]) grouped[l] = []; grouped[l].push(e); }
    return grouped;
  }, [engines]);

  const handleWeightChange = (engineId: string, value: number) => { setLocalWeights(prev => ({ ...prev, [engineId]: value })); setHasChanges(true); };
  const handleToggle = (engineId: string, enabled: boolean) => { setLocalEnabled(prev => ({ ...prev, [engineId]: enabled })); setHasChanges(true); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const engine of engines) {
        if (engine.enabled !== localEnabled[engine.id]) {
          await supabase.from('trend_engines').update({ enabled: localEnabled[engine.id] }).eq('id', engine.id);
        }
      }
      for (const engine of engines) {
        const weightValue = localWeights[engine.id] ?? engine.base_weight_default;
        const existing = weights.find(w => w.engine_id === engine.id);
        if (existing) {
          await supabase.from('production_engine_weights').update({ weight_value: weightValue }).eq('id', existing.id);
        } else {
          await supabase.from('production_engine_weights').insert({ production_type: selectedType, engine_id: engine.id, weight_value: weightValue });
        }
      }
      const snapshotWeights = engines.map(e => ({ engine_id: e.id, engine_name: e.engine_name, weight: localWeights[e.id] ?? e.base_weight_default, enabled: localEnabled[e.id] ?? e.enabled }));
      await supabase.from('engine_weight_snapshots').insert({ production_type: selectedType, snapshot_label: `Manual save — ${format(new Date(), 'dd MMM yyyy HH:mm')}`, weights: snapshotWeights, trigger_type: 'manual' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-engines'] });
      queryClient.invalidateQueries({ queryKey: ['admin-weights'] });
      queryClient.invalidateQueries({ queryKey: ['engine-weights'] });
      queryClient.invalidateQueries({ queryKey: ['trend-engines'] });
      queryClient.invalidateQueries({ queryKey: ['weight-snapshots'] });
      setHasChanges(false);
      toast({ title: 'Weights saved', description: `Snapshot created for ${selectedType}.` });
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  });

  const runAudit = async () => {
    setIsAuditing(true);
    setAuditResults(null);
    try {
      const response = await supabase.functions.invoke('audit-sources', {});
      if (response.error) throw response.error;
      setAuditResults(response.data);
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['model-version-log'] });
      toast({ title: 'Audit complete', description: `${response.data.sources_audited} sources audited, ${response.data.flagged_count} flagged.` });
    } catch (err: any) {
      toast({ title: 'Audit failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsAuditing(false);
    }
  };

  return (
    <TrendsPageShell
      badge="Intelligence Governance"
      title="Engine Weights"
      subtitle="Toggle engines on/off and adjust weights per production type."
      rightSlot={
        <div className="flex items-center gap-2">
          <Button size="sm" variant={slidersLocked ? 'outline' : 'secondary'} onClick={() => setSlidersLocked(prev => !prev)} className="h-8 text-xs">
            {slidersLocked ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
            {slidersLocked ? 'Locked' : 'Editing'}
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending} className="h-8 text-xs">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save & Snapshot
          </Button>
        </div>
      }
      controls={
        <TrendsFilterBar>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Production Type</label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="h-8 bg-muted/50 border-border/50 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map(pt => <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-1.5 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Total Weight</span>
              <span className={cn('font-mono text-xs font-bold', Math.abs(totalWeight - 1) < 0.01 ? 'text-emerald-400' : 'text-amber-400')}>
                {totalWeight.toFixed(3)}
              </span>
            </div>
          </div>
        </TrendsFilterBar>
      }
    >
      {/* Engine Layers */}
      <Accordion type="multiple" defaultValue={Object.keys(LAYER_CONFIG)} className="space-y-2">
        {Object.entries(LAYER_CONFIG).map(([layer, config]) => {
          const layerEngines = enginesByLayer[layer] || [];
          if (layerEngines.length === 0) return null;
          const layerWeight = layerEngines.filter(e => localEnabled[e.id] !== false).reduce((s, e) => s + (localWeights[e.id] ?? e.base_weight_default), 0);

          return (
            <AccordionItem key={layer} value={layer} className="rounded-xl border border-border/40 bg-card/50">
              <AccordionTrigger className="px-4 py-2.5 hover:no-underline">
                <div className="flex items-center gap-3 flex-1">
                  <Badge className={cn('text-[10px] border', config.color)}>{config.label}</Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto mr-3">{layerEngines.length} engines · {(layerWeight * 100).toFixed(0)}%</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3 space-y-2">
                {layerEngines.map(engine => {
                  const weight = localWeights[engine.id] ?? engine.base_weight_default;
                  const enabled = localEnabled[engine.id] ?? engine.enabled;
                  return (
                    <div key={engine.id} className={cn('rounded-lg p-3 border transition-opacity', enabled ? 'bg-card/50 border-border/30' : 'bg-muted/20 border-border/10 opacity-50')}>
                      <div className="flex items-center gap-3 mb-1.5">
                        <Switch checked={enabled} onCheckedChange={v => handleToggle(engine.id, v)} disabled={slidersLocked} />
                        <span className="text-sm font-medium text-foreground flex-1">{engine.engine_name}</span>
                        <span className="text-xs font-mono text-muted-foreground">{(weight * 100).toFixed(1)}%</span>
                      </div>
                      {enabled && <Slider value={[weight]} onValueChange={v => handleWeightChange(engine.id, v[0])} min={0} max={0.5} step={0.005} className="w-full" disabled={slidersLocked} />}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">Refresh: {engine.refresh_frequency}</span>
                        {engine.last_refresh && <span className="text-[10px] text-muted-foreground">· Last: {format(new Date(engine.last_refresh), 'dd MMM')}</span>}
                      </div>
                    </div>
                  );
                })}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Quarterly Source Audit */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold text-foreground text-sm">Quarterly Source Audit</h2>
          </div>
          <Button size="sm" variant="outline" onClick={runAudit} disabled={isAuditing} className="h-8 text-xs">
            {isAuditing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
            {isAuditing ? 'Auditing…' : 'Run Audit'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Evaluates data source accuracy, adjusts reliability scores, flags low-correlation sources.</p>

        {auditResults && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border/40 bg-card/50 p-3 grid grid-cols-4 gap-2 text-center">
              {[
                { val: auditResults.sources_audited, label: 'Sources' },
                { val: auditResults.sources_updated, label: 'Updated' },
                { val: auditResults.flagged_count, label: 'Flagged', cls: auditResults.flagged_count > 0 ? 'text-destructive' : '' },
                { val: auditResults.stale_count, label: 'Stale', cls: auditResults.stale_count > 0 ? 'text-amber-400' : '' },
              ].map(item => (
                <div key={item.label}>
                  <div className={cn('text-base font-bold text-foreground', item.cls)}>{item.val}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">{item.label}</div>
                </div>
              ))}
            </div>

            {auditResults.results?.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {auditResults.results.map((r: any) => (
                  <div key={r.source_id} className="rounded-lg border border-border/30 bg-card/50 px-3 py-2 flex items-center gap-2">
                    {r.status_change ? <AlertTriangle className="h-3 w-3 text-destructive shrink-0" /> : <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />}
                    <span className="text-sm text-foreground flex-1 truncate">{r.source_name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{r.prev_reliability.toFixed(2)} → {r.new_reliability.toFixed(2)}</span>
                    {r.accuracy !== null && <Badge variant="outline" className="text-[10px] h-5">{r.accuracy}% acc</Badge>}
                    {r.staleness_flag && <Badge variant="outline" className="text-[10px] h-5 border-amber-500/30 text-amber-400">stale</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {snapshots.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold text-foreground text-sm">Model Versions</h2>
          </div>
          <div className="space-y-1">
            {snapshots.map(snap => (
              <div key={snap.id} className="rounded-lg border border-border/30 bg-card/50 px-3 py-2 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-5">{snap.trigger_type}</Badge>
                <span className="text-sm text-foreground flex-1">{snap.snapshot_label || 'Snapshot'}</span>
                <span className="text-[10px] text-muted-foreground">{format(new Date(snap.created_at), 'dd MMM yyyy HH:mm')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ModelAccuracyDashboard productionType={selectedType} />
      <SourceSandboxPanel />

      <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-3">
        Weights normalised to 1.0 at scoring time. Each save creates a versioned snapshot for audit and rollback.
      </div>
    </TrendsPageShell>
  );
}
