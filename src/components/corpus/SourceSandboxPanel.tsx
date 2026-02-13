import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Plus, ArrowUpRight, Loader2, Trash2, BarChart3, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { DataSource } from '@/hooks/useDataSources';

const PROMOTION_THRESHOLD = 0.6; // 60% accuracy to promote

interface ShadowEvaluation {
  id: string;
  source_id: string;
  evaluation_period: string;
  accuracy_score: number;
  sample_size: number;
  correlation_details: any;
  promoted_at: string | null;
  created_at: string;
}

export function SourceSandboxPanel() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSource, setNewSource] = useState({
    source_name: '',
    source_type: 'api',
    intelligence_layer: 'market',
    region: '',
    refresh_frequency: 'weekly',
    description: '',
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch shadow sources
  const { data: shadowSources = [] } = useQuery({
    queryKey: ['shadow-sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('data_sources')
        .select('*')
        .eq('status', 'shadow')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as DataSource[];
    },
  });

  // Fetch evaluations for shadow sources
  const { data: evaluations = [] } = useQuery({
    queryKey: ['shadow-evaluations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shadow_source_evaluations')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ShadowEvaluation[];
    },
  });

  // Add shadow source
  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('data_sources').insert({
        ...newSource,
        status: 'shadow',
        reliability_score: 0,
        data_staleness_score: 0,
        volatility_score: 0,
        production_types_supported: [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shadow-sources'] });
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
      setShowAddForm(false);
      setNewSource({ source_name: '', source_type: 'api', intelligence_layer: 'market', region: '', refresh_frequency: 'weekly', description: '' });
      toast({ title: 'Shadow source added', description: 'Source will be tracked without affecting live scores.' });
    },
    onError: (e: any) => toast({ title: 'Failed to add', description: e.message, variant: 'destructive' }),
  });

  // Promote source to active
  const promoteMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await supabase
        .from('data_sources')
        .update({ status: 'active', reliability_score: 0.5 })
        .eq('id', sourceId);
      if (error) throw error;

      // Record promotion in evaluations
      await supabase.from('shadow_source_evaluations').insert({
        source_id: sourceId,
        evaluation_period: 'promotion',
        accuracy_score: 0,
        sample_size: 0,
        promoted_at: new Date().toISOString(),
        correlation_details: { action: 'promoted_to_active' },
      });

      // Log to model version
      await supabase.from('model_version_log').insert({
        version_label: `Shadow Promotion — ${format(new Date(), 'dd MMM yyyy')}`,
        production_type: 'all',
        change_type: 'shadow_promotion',
        reason: `Shadow source promoted to active after meeting performance threshold.`,
        triggered_by: 'sandbox',
        changes: { source_id: sourceId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shadow-sources'] });
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['model-version-log'] });
      toast({ title: 'Source promoted', description: 'Source is now active and contributing to scores.' });
    },
    onError: (e: any) => toast({ title: 'Promotion failed', description: e.message, variant: 'destructive' }),
  });

  // Remove shadow source
  const removeMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await supabase.from('data_sources').delete().eq('id', sourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shadow-sources'] });
      toast({ title: 'Shadow source removed' });
    },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const getLatestEval = (sourceId: string) =>
    evaluations.filter(e => e.source_id === sourceId && !e.promoted_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const canPromote = (sourceId: string) => {
    const eval_ = getLatestEval(sourceId);
    return eval_ && eval_.accuracy_score >= PROMOTION_THRESHOLD && eval_.sample_size >= 3;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold text-foreground">Source Sandbox</h2>
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Phase 4</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddForm(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Shadow Source
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Test new data feeds in shadow mode — they're tracked against outcomes but don't affect live scores. Promote to active when accuracy exceeds {(PROMOTION_THRESHOLD * 100).toFixed(0)}%.
      </p>

      {/* Add Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card rounded-xl p-4 space-y-3 border border-primary/20">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Source Name</label>
                  <Input
                    value={newSource.source_name}
                    onChange={e => setNewSource(p => ({ ...p, source_name: e.target.value }))}
                    placeholder="e.g. Festival Circuit API"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                  <Select value={newSource.source_type} onValueChange={v => setNewSource(p => ({ ...p, source_type: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api">API</SelectItem>
                      <SelectItem value="database">Database</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="scraper">Scraper</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Intelligence Layer</label>
                  <Select value={newSource.intelligence_layer} onValueChange={v => setNewSource(p => ({ ...p, intelligence_layer: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="market">Market</SelectItem>
                      <SelectItem value="narrative">Narrative</SelectItem>
                      <SelectItem value="talent">Talent</SelectItem>
                      <SelectItem value="platform">Platform</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Refresh Frequency</label>
                  <Select value={newSource.refresh_frequency} onValueChange={v => setNewSource(p => ({ ...p, refresh_frequency: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Region</label>
                  <Input
                    value={newSource.region}
                    onChange={e => setNewSource(p => ({ ...p, region: e.target.value }))}
                    placeholder="e.g. Global"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                  <Input
                    value={newSource.description}
                    onChange={e => setNewSource(p => ({ ...p, description: e.target.value }))}
                    placeholder="What data does this source provide?"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => addMutation.mutate()}
                  disabled={!newSource.source_name || addMutation.isPending}
                >
                  {addMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Add to Sandbox
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shadow Sources List */}
      {shadowSources.length === 0 ? (
        <div className="glass-card rounded-xl p-6 text-center text-sm text-muted-foreground">
          No shadow sources yet. Add one to start tracking in sandbox mode.
        </div>
      ) : (
        <div className="space-y-2">
          {shadowSources.map(source => {
            const latestEval = getLatestEval(source.id);
            const ready = canPromote(source.id);
            const sourceEvals = evaluations.filter(e => e.source_id === source.id && !e.promoted_at);

            return (
              <div key={source.id} className="glass-card rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <FlaskConical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{source.source_name}</span>
                      <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400">shadow</Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{source.source_type}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{source.description || 'No description'}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {ready && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => promoteMutation.mutate(source.id)}
                        disabled={promoteMutation.isPending}
                      >
                        {promoteMutation.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3 mr-1" />
                        )}
                        Promote
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMutation.mutate(source.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Performance metrics */}
                {latestEval ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-card/50 rounded-lg p-2 text-center border border-border/30">
                      <span className={cn(
                        'text-sm font-bold font-mono',
                        latestEval.accuracy_score >= PROMOTION_THRESHOLD ? 'text-emerald-400' :
                        latestEval.accuracy_score >= 0.4 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {(latestEval.accuracy_score * 100).toFixed(0)}%
                      </span>
                      <p className="text-[9px] text-muted-foreground">Accuracy</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-2 text-center border border-border/30">
                      <span className="text-sm font-bold font-mono text-foreground">{latestEval.sample_size}</span>
                      <p className="text-[9px] text-muted-foreground">Samples</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-2 text-center border border-border/30">
                      <span className={cn(
                        'text-sm font-bold font-mono',
                        ready ? 'text-emerald-400' : 'text-muted-foreground'
                      )}>
                        {ready ? 'Ready' : 'Tracking'}
                      </span>
                      <p className="text-[9px] text-muted-foreground">Status</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-card/50 rounded-lg p-3 text-center border border-border/30">
                    <BarChart3 className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Awaiting evaluation — run a Quarterly Audit to generate performance data.</p>
                  </div>
                )}

                {/* Promotion progress bar */}
                {latestEval && !ready && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Promotion threshold: {(PROMOTION_THRESHOLD * 100).toFixed(0)}%</span>
                      <span>{(latestEval.accuracy_score * 100).toFixed(0)}% / {(PROMOTION_THRESHOLD * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={Math.min(100, (latestEval.accuracy_score / PROMOTION_THRESHOLD) * 100)} className="h-1.5" />
                  </div>
                )}

                {/* Evaluation history */}
                {sourceEvals.length > 1 && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground">
                        <Eye className="h-3 w-3 mr-1" />
                        {sourceEvals.length} evaluations
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle className="font-display">{source.source_name} — Evaluation History</DialogTitle>
                      </DialogHeader>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Period</TableHead>
                            <TableHead className="text-xs">Accuracy</TableHead>
                            <TableHead className="text-xs">Samples</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sourceEvals.map(ev => (
                            <TableRow key={ev.id}>
                              <TableCell className="text-xs">{ev.evaluation_period}</TableCell>
                              <TableCell className="text-xs font-mono">{(ev.accuracy_score * 100).toFixed(1)}%</TableCell>
                              <TableCell className="text-xs">{ev.sample_size}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{format(new Date(ev.created_at), 'dd MMM yyyy')}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
