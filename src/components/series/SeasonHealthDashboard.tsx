/**
 * Season Health Dashboard — Tension Tracker, Retention & Engagement Simulator.
 * Displays charts, episode metrics table, flags, and rewrite recommendations.
 */

import { useState } from 'react';
import {
  Activity, TrendingUp, Zap, Eye, MessageCircle, AlertTriangle,
  ChevronDown, ChevronRight, BarChart3, RefreshCw, Loader2, Wrench,
  Settings2, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InfoTooltip } from '@/components/InfoTooltip';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid, Legend, Area, ComposedChart,
} from 'recharts';
import type {
  VerticalEpisodeMetricRow, EpisodeMetrics, Recommendation,
  TensionWeights, RetentionWeights, EngagementWeights,
} from '@/lib/vertical-metrics-config';
import {
  DEFAULT_TENSION_WEIGHTS, DEFAULT_RETENTION_WEIGHTS, DEFAULT_ENGAGEMENT_WEIGHTS,
  targetTension, metricsPassGate, METRIC_THRESHOLDS,
} from '@/lib/vertical-metrics-config';

interface Props {
  metrics: VerticalEpisodeMetricRow[];
  seasonEpisodeCount: number;
  onRunMetrics: (episodeNumber: number) => void;
  onAutoFix: (episodeNumber: number) => void;
  isRunning: boolean;
  runningEpisode: number | null;
}

// ── Charts ──

function TensionChart({ metrics, seasonEpisodeCount }: { metrics: VerticalEpisodeMetricRow[]; seasonEpisodeCount: number }) {
  const data = Array.from({ length: seasonEpisodeCount }, (_, i) => {
    const ep = i + 1;
    const m = metrics.find(x => x.episode_number === ep);
    return {
      ep,
      tension: m?.metrics.tension.tension_level ?? null,
      target: Math.round(targetTension(ep, seasonEpisodeCount)),
      retention: m?.metrics.retention.score ?? null,
    };
  });

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <RechartsTooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: 11 }}
            labelFormatter={(v) => `Episode ${v}`}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area type="monotone" dataKey="target" name="Target" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary) / 0.3)" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="tension" name="Tension" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="retention" name="Retention" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Flags Badge ──

function FlagBadges({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  const FLAG_LABELS: Record<string, { label: string; color: string }> = {
    overheat_risk: { label: 'Overheat', color: 'border-red-500/30 text-red-400 bg-red-500/10' },
    flatline_risk: { label: 'Flatline', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
    whiplash_risk: { label: 'Whiplash', color: 'border-orange-500/30 text-orange-400 bg-orange-500/10' },
  };
  return (
    <div className="flex gap-1">
      {flags.map(f => {
        const fl = FLAG_LABELS[f] || { label: f, color: 'border-border text-muted-foreground' };
        return <Badge key={f} variant="outline" className={`text-[9px] px-1.5 ${fl.color}`}>{fl.label}</Badge>;
      })}
    </div>
  );
}

// ── Recommendations Dialog ──

function RecommendationsDialog({
  open,
  onOpenChange,
  recommendations,
  episodeNumber,
  onAutoFix,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recommendations: Recommendation[];
  episodeNumber: number;
  onAutoFix: () => void;
}) {
  const severityColor = { low: 'text-muted-foreground', med: 'text-amber-400', high: 'text-red-400' };
  const typeIcon = { hook: '🪝', pacing: '⚡', emotion: '❤️', stakes: '🎯', cliffhanger: '🔗', clarity: '🔍' };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Wrench className="h-4 w-4 text-primary" />
            EP {String(episodeNumber).padStart(2, '0')} — Rewrite Recommendations
          </DialogTitle>
          <DialogDescription className="text-xs">
            Canon-safe suggestions to improve this episode.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 max-h-[50vh]">
          <div className="space-y-2 p-1">
            {recommendations.map((rec, i) => (
              <div key={i} className="border border-border/50 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{typeIcon[rec.type] || '📝'}</span>
                  <span className="text-xs font-medium capitalize text-foreground">{rec.type}</span>
                  <Badge variant="outline" className={`text-[9px] ml-auto ${
                    rec.severity === 'high' ? 'border-red-500/30 text-red-400' :
                    rec.severity === 'med' ? 'border-amber-500/30 text-amber-400' :
                    'border-border text-muted-foreground'
                  }`}>
                    {rec.severity}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{rec.note}</p>
                {rec.example && (
                  <div className="bg-muted/30 rounded px-2 py-1.5">
                    <p className="text-[11px] italic text-foreground/80">{rec.example}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        {recommendations.some(r => r.severity === 'high') && (
          <div className="pt-2 border-t border-border/50">
            <Button size="sm" onClick={onAutoFix} className="h-7 text-xs gap-1">
              <Wrench className="h-3 w-3" /> Apply Auto-Fix (Canon-Safe)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Weights Editor ──

function WeightsEditor({
  tensionWeights,
  retentionWeights,
  engagementWeights,
  onChange,
}: {
  tensionWeights: TensionWeights;
  retentionWeights: RetentionWeights;
  engagementWeights: EngagementWeights;
  onChange: (t: TensionWeights, r: RetentionWeights, e: EngagementWeights) => void;
}) {
  const [open, setOpen] = useState(false);

  const renderSliders = (label: string, weights: Record<string, number>, setWeights: (w: Record<string, number>) => void) => (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">{label}</p>
      {Object.entries(weights).map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-28 capitalize">{key.replace(/_/g, ' ')}</span>
          <Slider
            value={[value * 100]}
            max={50}
            step={5}
            className="flex-1"
            onValueChange={([v]) => setWeights({ ...weights, [key]: v / 100 })}
          />
          <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{Math.round(value * 100)}%</span>
        </div>
      ))}
    </div>
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground">
          <Settings2 className="h-3 w-3" />
          Advanced Weights
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-4">
        {renderSliders('Tension', tensionWeights, (w) => onChange(w as TensionWeights, retentionWeights, engagementWeights))}
        {renderSliders('Retention', retentionWeights, (w) => onChange(tensionWeights, w as RetentionWeights, engagementWeights))}
        {renderSliders('Engagement', engagementWeights, (w) => onChange(tensionWeights, retentionWeights, w as EngagementWeights))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Episode Metrics Table ──

function EpisodeMetricsTable({
  metrics,
  seasonEpisodeCount,
  onViewRecommendations,
  onRunMetrics,
  onAutoFix,
  isRunning,
  runningEpisode,
}: {
  metrics: VerticalEpisodeMetricRow[];
  seasonEpisodeCount: number;
  onViewRecommendations: (ep: number) => void;
  onRunMetrics: (ep: number) => void;
  onAutoFix: (ep: number) => void;
  isRunning: boolean;
  runningEpisode: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Ep</th>
            <th className="text-center py-1.5 px-1 text-muted-foreground font-medium">Tension</th>
            <th className="text-center py-1.5 px-1 text-muted-foreground font-medium">Δ</th>
            <th className="text-center py-1.5 px-1 text-muted-foreground font-medium">Gap</th>
            <th className="text-center py-1.5 px-1 text-muted-foreground font-medium">Retention</th>
            <th className="text-center py-1.5 px-1 text-muted-foreground font-medium">Engage</th>
            <th className="text-center py-1.5 px-1 text-muted-foreground font-medium">Cliff</th>
            <th className="text-left py-1.5 px-1 text-muted-foreground font-medium">Flags</th>
            <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: seasonEpisodeCount }, (_, i) => i + 1).map(ep => {
            const m = metrics.find(x => x.episode_number === ep);
            const isCurrentRunning = isRunning && runningEpisode === ep;
            if (!m) {
              return (
                <tr key={ep} className="border-b border-border/30">
                  <td className="py-1.5 px-2 font-mono">{String(ep).padStart(2, '0')}</td>
                  <td colSpan={7} className="py-1.5 px-1 text-center text-muted-foreground">—</td>
                  <td className="py-1.5 px-2 text-right">
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => onRunMetrics(ep)} disabled={isRunning}>
                      {isCurrentRunning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <BarChart3 className="h-2.5 w-2.5" />}
                    </Button>
                  </td>
                </tr>
              );
            }

            const t = m.metrics.tension;
            const r = m.metrics.retention;
            const e = m.metrics.engagement;
            const c = m.metrics.cliffhanger;
            const gate = metricsPassGate(m.metrics);

            return (
              <tr key={ep} className={`border-b border-border/30 ${!gate.passed ? 'bg-red-500/5' : ''}`}>
                <td className="py-1.5 px-2 font-mono">{String(ep).padStart(2, '0')}</td>
                <td className="py-1.5 px-1 text-center">
                  <span className={`font-mono ${t.tension_level >= 70 ? 'text-red-400' : t.tension_level >= 50 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {Math.round(t.tension_level)}
                  </span>
                </td>
                <td className="py-1.5 px-1 text-center">
                  <span className={`font-mono text-[10px] ${t.tension_delta > 0 ? 'text-red-400' : t.tension_delta < -10 ? 'text-blue-400' : 'text-muted-foreground'}`}>
                    {t.tension_delta > 0 ? '+' : ''}{Math.round(t.tension_delta)}
                  </span>
                </td>
                <td className="py-1.5 px-1 text-center">
                  <span className={`font-mono text-[10px] ${Math.abs(t.tension_gap) > 15 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                    {t.tension_gap > 0 ? '+' : ''}{Math.round(t.tension_gap)}
                  </span>
                </td>
                <td className="py-1.5 px-1 text-center">
                  <span className={`font-mono ${r.score < 60 ? 'text-red-400' : r.score < 75 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {Math.round(r.score)}
                  </span>
                </td>
                <td className="py-1.5 px-1 text-center">
                  <span className="font-mono text-foreground">{Math.round(e.score)}</span>
                </td>
                <td className="py-1.5 px-1 text-center">
                  <span className={`font-mono ${c.cliffhanger_strength < 60 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {Math.round(c.cliffhanger_strength)}
                  </span>
                </td>
                <td className="py-1.5 px-1">
                  <FlagBadges flags={t.flags || []} />
                </td>
                <td className="py-1.5 px-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {m.metrics.recommendations?.length > 0 && (
                      <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => onViewRecommendations(ep)}>
                        <Wrench className="h-2.5 w-2.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => onRunMetrics(ep)} disabled={isRunning}>
                      {isCurrentRunning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ──

export function SeasonHealthDashboard({
  metrics,
  seasonEpisodeCount,
  onRunMetrics,
  onAutoFix,
  isRunning,
  runningEpisode,
}: Props) {
  const [recDialogEp, setRecDialogEp] = useState<number | null>(null);
  const [tensionWeights, setTensionWeights] = useState(DEFAULT_TENSION_WEIGHTS);
  const [retentionWeights, setRetentionWeights] = useState(DEFAULT_RETENTION_WEIGHTS);
  const [engagementWeights, setEngagementWeights] = useState(DEFAULT_ENGAGEMENT_WEIGHTS);

  const recMetrics = recDialogEp ? metrics.find(m => m.episode_number === recDialogEp) : null;

  if (metrics.length === 0) {
    return (
      <Card className="border-dashed border-border/60">
        <CardContent className="p-4 text-center">
          <Activity className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">
            No metrics yet. Generate episodes first, then run metrics scoring.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Summary stats
  const scored = metrics.length;
  const avgTension = metrics.reduce((a, m) => a + m.metrics.tension.tension_level, 0) / scored;
  const avgRetention = metrics.reduce((a, m) => a + m.metrics.retention.score, 0) / scored;
  const avgEngagement = metrics.reduce((a, m) => a + m.metrics.engagement.score, 0) / scored;
  const flagCount = metrics.reduce((a, m) => a + (m.metrics.tension.flags?.length || 0), 0);
  const highRecs = metrics.reduce((a, m) => a + (m.metrics.recommendations?.filter(r => r.severity === 'high').length || 0), 0);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Season Health</h4>
          <InfoTooltip text="Tension, retention, and engagement metrics for the season. Scores are heuristic simulations — use them to identify weak episodes and apply canon-safe fixes." />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px]">{scored}/{seasonEpisodeCount} scored</Badge>
          {flagCount > 0 && (
            <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-400">
              {flagCount} flags
            </Badge>
          )}
          {highRecs > 0 && (
            <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400">
              {highRecs} critical
            </Badge>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="border-border/50">
          <CardContent className="p-2.5 text-center">
            <TrendingUp className="h-3.5 w-3.5 mx-auto text-red-400 mb-1" />
            <p className="text-lg font-mono font-bold text-foreground">{Math.round(avgTension)}</p>
            <p className="text-[9px] text-muted-foreground">Avg Tension</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-2.5 text-center">
            <Eye className="h-3.5 w-3.5 mx-auto text-blue-400 mb-1" />
            <p className="text-lg font-mono font-bold text-foreground">{Math.round(avgRetention)}</p>
            <p className="text-[9px] text-muted-foreground">Avg Retention</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-2.5 text-center">
            <MessageCircle className="h-3.5 w-3.5 mx-auto text-emerald-400 mb-1" />
            <p className="text-lg font-mono font-bold text-foreground">{Math.round(avgEngagement)}</p>
            <p className="text-[9px] text-muted-foreground">Avg Engagement</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="chart" className="w-full">
        <TabsList className="w-full h-7">
          <TabsTrigger value="chart" className="text-[10px] h-5">Curves</TabsTrigger>
          <TabsTrigger value="table" className="text-[10px] h-5">Episode Table</TabsTrigger>
        </TabsList>
        <TabsContent value="chart" className="pt-2">
          <TensionChart metrics={metrics} seasonEpisodeCount={seasonEpisodeCount} />
        </TabsContent>
        <TabsContent value="table" className="pt-2">
          <EpisodeMetricsTable
            metrics={metrics}
            seasonEpisodeCount={seasonEpisodeCount}
            onViewRecommendations={setRecDialogEp}
            onRunMetrics={onRunMetrics}
            onAutoFix={onAutoFix}
            isRunning={isRunning}
            runningEpisode={runningEpisode}
          />
        </TabsContent>
      </Tabs>

      {/* Weights */}
      <WeightsEditor
        tensionWeights={tensionWeights}
        retentionWeights={retentionWeights}
        engagementWeights={engagementWeights}
        onChange={(t, r, e) => { setTensionWeights(t); setRetentionWeights(r); setEngagementWeights(e); }}
      />

      {/* Recommendations Dialog */}
      <RecommendationsDialog
        open={recDialogEp !== null}
        onOpenChange={(v) => { if (!v) setRecDialogEp(null); }}
        recommendations={recMetrics?.metrics.recommendations || []}
        episodeNumber={recDialogEp || 0}
        onAutoFix={() => { if (recDialogEp) onAutoFix(recDialogEp); setRecDialogEp(null); }}
      />
    </div>
  );
}
