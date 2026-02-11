import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings2, Save, RotateCcw, History, BarChart3, Loader2, Lock, Unlock } from 'lucide-react';
import { Header } from '@/components/Header';
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch all engines (including disabled)
  const { data: engines = [] } = useQuery({
    queryKey: ['all-engines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_engines')
        .select('*')
        .eq('status', 'active')
        .order('intelligence_layer, engine_name');
      if (error) throw error;
      return data as unknown as EngineRow[];
    },
  });

  // Fetch weights for selected type
  const { data: weights = [] } = useQuery({
    queryKey: ['admin-weights', selectedType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_engine_weights')
        .select('*')
        .eq('production_type', selectedType);
      if (error) throw error;
      return data as unknown as WeightRow[];
    },
  });

  // Fetch snapshots
  const { data: snapshots = [] } = useQuery({
    queryKey: ['weight-snapshots', selectedType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('engine_weight_snapshots')
        .select('*')
        .eq('production_type', selectedType)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as unknown as Snapshot[];
    },
  });

  // Local editable state
  const [localWeights, setLocalWeights] = useState<Record<string, number>>({});
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [slidersLocked, setSlidersLocked] = useState(true);

  // Initialize local state when data loads
  useEffect(() => {
    const wMap: Record<string, number> = {};
    for (const w of weights) wMap[w.engine_id] = w.weight_value;
    for (const e of engines) {
      if (!(e.id in wMap)) wMap[e.id] = e.base_weight_default;
    }
    setLocalWeights(wMap);

    const eMap: Record<string, boolean> = {};
    for (const e of engines) eMap[e.id] = e.enabled;
    setLocalEnabled(eMap);
    setHasChanges(false);
  }, [engines, weights]);

  const totalWeight = useMemo(() => {
    return Object.entries(localWeights)
      .filter(([id]) => localEnabled[id] !== false)
      .reduce((s, [, v]) => s + v, 0);
  }, [localWeights, localEnabled]);

  // Group engines by layer
  const enginesByLayer = useMemo(() => {
    const grouped: Record<string, EngineRow[]> = {};
    for (const e of engines) {
      const layer = e.intelligence_layer || 'market';
      if (!grouped[layer]) grouped[layer] = [];
      grouped[layer].push(e);
    }
    return grouped;
  }, [engines]);

  const handleWeightChange = (engineId: string, value: number) => {
    setLocalWeights(prev => ({ ...prev, [engineId]: value }));
    setHasChanges(true);
  };

  const handleToggle = (engineId: string, enabled: boolean) => {
    setLocalEnabled(prev => ({ ...prev, [engineId]: enabled }));
    setHasChanges(true);
  };

  // Save mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Save enabled state
      for (const engine of engines) {
        if (engine.enabled !== localEnabled[engine.id]) {
          await supabase
            .from('trend_engines')
            .update({ enabled: localEnabled[engine.id] })
            .eq('id', engine.id);
        }
      }

      // Upsert weights
      for (const engine of engines) {
        const weightValue = localWeights[engine.id] ?? engine.base_weight_default;
        const existing = weights.find(w => w.engine_id === engine.id);
        if (existing) {
          await supabase
            .from('production_engine_weights')
            .update({ weight_value: weightValue })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('production_engine_weights')
            .insert({
              production_type: selectedType,
              engine_id: engine.id,
              weight_value: weightValue,
            });
        }
      }

      // Create snapshot
      const snapshotWeights = engines.map(e => ({
        engine_id: e.id,
        engine_name: e.engine_name,
        weight: localWeights[e.id] ?? e.base_weight_default,
        enabled: localEnabled[e.id] ?? e.enabled,
      }));
      await supabase
        .from('engine_weight_snapshots')
        .insert({
          production_type: selectedType,
          snapshot_label: `Manual save — ${format(new Date(), 'dd MMM yyyy HH:mm')}`,
          weights: snapshotWeights,
          trigger_type: 'manual',
        });
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings2 className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Governance</span>
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Engine Weights</h1>
              <p className="text-muted-foreground mt-1">Toggle engines on/off and adjust weights per production type.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={slidersLocked ? 'outline' : 'secondary'}
                onClick={() => setSlidersLocked(prev => !prev)}
                className="text-xs"
              >
                {slidersLocked ? <Lock className="h-3.5 w-3.5 mr-1" /> : <Unlock className="h-3.5 w-3.5 mr-1" />}
                {slidersLocked ? 'Locked' : 'Editing'}
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!hasChanges || saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save & Snapshot
              </Button>
            </div>
          </div>

          {/* Production Type Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Production Type</label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full h-9 bg-muted/50 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map(pt => (
                  <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Weight total indicator */}
          <div className="glass-card rounded-xl p-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Weight (pre-normalisation)</span>
            <span className={cn(
              'font-mono text-sm font-bold',
              Math.abs(totalWeight - 1) < 0.01 ? 'text-emerald-400' : 'text-amber-400'
            )}>
              {totalWeight.toFixed(3)}
            </span>
          </div>

          {/* Engine Layers */}
          <Accordion type="multiple" defaultValue={Object.keys(LAYER_CONFIG)} className="space-y-2">
            {Object.entries(LAYER_CONFIG).map(([layer, config]) => {
              const layerEngines = enginesByLayer[layer] || [];
              if (layerEngines.length === 0) return null;

              const layerWeight = layerEngines
                .filter(e => localEnabled[e.id] !== false)
                .reduce((s, e) => s + (localWeights[e.id] ?? e.base_weight_default), 0);

              return (
                <AccordionItem key={layer} value={layer} className="glass-card rounded-xl border-none">
                  <AccordionTrigger className="px-5 py-3 hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <Badge className={cn('text-xs border', config.color)}>{config.label}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto mr-3">
                        {layerEngines.length} engines · wt: {(layerWeight * 100).toFixed(0)}%
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-4 space-y-3">
                    {layerEngines.map(engine => {
                      const weight = localWeights[engine.id] ?? engine.base_weight_default;
                      const enabled = localEnabled[engine.id] ?? engine.enabled;
                      return (
                        <div key={engine.id} className={cn(
                          'rounded-lg p-3 border transition-opacity',
                          enabled ? 'bg-card/50 border-border/30' : 'bg-muted/20 border-border/10 opacity-50'
                        )}>
                          <div className="flex items-center gap-3 mb-2">
                            <Switch
                              checked={enabled}
                              onCheckedChange={v => handleToggle(engine.id, v)}
                              disabled={slidersLocked}
                            />
                            <span className="text-sm font-medium text-foreground flex-1">{engine.engine_name}</span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {(weight * 100).toFixed(1)}%
                            </span>
                          </div>
                          {enabled && (
                            <Slider
                              value={[weight]}
                              onValueChange={v => handleWeightChange(engine.id, v[0])}
                              min={0} max={0.5} step={0.005}
                              className="w-full"
                              disabled={slidersLocked}
                            />
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground">
                              Refresh: {engine.refresh_frequency}
                            </span>
                            {engine.last_refresh && (
                              <span className="text-[10px] text-muted-foreground">
                                · Last: {format(new Date(engine.last_refresh), 'dd MMM')}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>

          {/* Snapshots History */}
          {snapshots.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <h2 className="font-display font-semibold text-foreground">Model Versions</h2>
              </div>
              <div className="space-y-1.5">
                {snapshots.map(snap => (
                  <div key={snap.id} className="glass-card rounded-lg px-4 py-2.5 flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px]">{snap.trigger_type}</Badge>
                    <span className="text-sm text-foreground flex-1">{snap.snapshot_label || 'Snapshot'}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(snap.created_at), 'dd MMM yyyy HH:mm')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Weights are normalised to 1.0 at scoring time. Each save creates a versioned snapshot for audit and rollback.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
