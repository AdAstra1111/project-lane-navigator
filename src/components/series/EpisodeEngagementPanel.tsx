/**
 * EpisodeEngagementPanel — Displays tension curve, beat density,
 * retention/engagement scores, and actionable recommendations.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Activity, Zap, TrendingUp, AlertTriangle, CheckCircle2,
  Loader2, BarChart3, Target, Eye, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EpisodeEngagementResult } from '@/hooks/useEpisodeEngagement';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts';

interface Props {
  result: EpisodeEngagementResult | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onCreateNote?: (rec: { title: string; why: string; suggested_fix: string; severity: string }) => void;
  className?: string;
}

const FLAG_LABELS: Record<string, { label: string; severity: 'high' | 'med' | 'low' }> = {
  no_hook: { label: 'No hook detected', severity: 'high' },
  late_hook: { label: 'Hook lands too late (>10s)', severity: 'high' },
  no_cliffhanger: { label: 'Missing cliffhanger', severity: 'high' },
  weak_cliffhanger: { label: 'Weak end hook (<50)', severity: 'med' },
  sparse_middle: { label: 'Sparse middle section', severity: 'med' },
  below_minimum_beats: { label: 'Below minimum beat count', severity: 'high' },
  overstuffed: { label: 'Too many beats, no breathing room', severity: 'med' },
};

const SEVERITY_COLORS: Record<string, string> = {
  high: 'border-red-500/40 text-red-400 bg-red-500/10',
  med: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
  low: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
};

function ScoreRing({ value, label, icon: Icon, size = 'md' }: {
  value: number; label: string; icon: typeof Activity; size?: 'sm' | 'md';
}) {
  const color = value >= 75 ? 'text-emerald-400' : value >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className={cn('flex flex-col items-center gap-0.5', size === 'sm' ? 'min-w-[50px]' : 'min-w-[70px]')}>
      <div className={cn('font-bold', color, size === 'sm' ? 'text-lg' : 'text-2xl')}>
        {Math.round(value)}
      </div>
      <div className="flex items-center gap-0.5 text-muted-foreground">
        <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        <span className={size === 'sm' ? 'text-[8px]' : 'text-[9px]'}>{label}</span>
      </div>
    </div>
  );
}

export function EpisodeEngagementPanel({ result, isAnalyzing, onAnalyze, onCreateNote, className }: Props) {
  if (!result && !isAnalyzing) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardContent className="py-6 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-xs text-muted-foreground mb-3">
            Analyze beat density, tension curve, and retention scoring
          </p>
          <Button size="sm" onClick={onAnalyze} className="h-7 text-xs gap-1.5">
            <BarChart3 className="h-3 w-3" /> Analyze Engagement
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isAnalyzing) {
    return (
      <Card className={cn('border-border/50', className)}>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Analyzing engagement metrics…</p>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  const { beat_density: bd, tension_curve: tc, retention_score: rs, engagement_score: es, recommendations } = result;

  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <CardTitle className="text-xs">Episode Engagement</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border/50 text-muted-foreground">
              {result.episodeLengthRange}
            </Badge>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onAnalyze}>
              <BarChart3 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-3">
        {/* Score summary row */}
        <div className="flex items-center justify-around py-2 bg-muted/20 rounded-lg">
          <ScoreRing value={rs.total} label="Retention" icon={Eye} />
          <ScoreRing value={es.total} label="Engagement" icon={MessageSquare} />
          <ScoreRing value={tc.end_hook_strength} label="End Hook" icon={Zap} />
        </div>

        {/* Tension Curve Chart */}
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Tension Curve
            <span className="ml-1 font-normal capitalize">({tc.shape})</span>
          </p>
          <div className="h-[100px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tc.points} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="tensionGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => `${v}s`}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
                  tickCount={3}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6,
                    fontSize: 10,
                  }}
                  formatter={(v: number) => [`${Math.round(v)}`, 'Tension']}
                  labelFormatter={(l) => `${l}s`}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#tensionGrad)"
                />
                {/* Hook window reference */}
                <ReferenceLine x={10} stroke="hsl(var(--destructive))" strokeDasharray="4 4" opacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Beat Density */}
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Beat Density
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-sm font-bold text-foreground">{bd.detected_beats}</div>
              <div className="text-[8px] text-muted-foreground">Beats</div>
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">{bd.turns_per_min?.toFixed(1)}</div>
              <div className="text-[8px] text-muted-foreground">Turns/min</div>
            </div>
            <div>
              <div className={cn('text-sm font-bold', bd.longest_gap_seconds > 25 ? 'text-red-400' : 'text-foreground')}>
                {bd.longest_gap_seconds}s
              </div>
              <div className="text-[8px] text-muted-foreground">Longest gap</div>
            </div>
          </div>

          {/* Flags */}
          {bd.flags && bd.flags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {bd.flags.map((flag: string) => {
                const info = FLAG_LABELS[flag] || { label: flag, severity: 'low' as const };
                return (
                  <Badge key={flag} variant="outline" className={cn('text-[8px] px-1.5', SEVERITY_COLORS[info.severity])}>
                    <AlertTriangle className="h-2 w-2 mr-0.5" />
                    {info.label}
                  </Badge>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-1 mt-1.5 text-[9px] text-muted-foreground">
            <Target className="h-2.5 w-2.5" />
            Target: {result.targets.beatCountRange} @ {result.targets.beatSpacing}
          </div>
        </div>

        {/* Retention components */}
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Retention Breakdown
          </p>
          <div className="space-y-1">
            {Object.entries(rs.components).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground w-24 truncate capitalize">
                  {key.replace(/_/g, ' ')}
                </span>
                <Progress
                  value={value as number}
                  className="h-1.5 flex-1"
                />
                <span className={cn(
                  'text-[9px] font-mono w-6 text-right',
                  (value as number) >= 70 ? 'text-emerald-400' : (value as number) >= 40 ? 'text-amber-400' : 'text-red-400',
                )}>
                  {Math.round(value as number)}
                </span>
              </div>
            ))}
          </div>
          {rs.key_risks.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {rs.key_risks.map((risk, i) => (
                <p key={i} className="text-[9px] text-red-400/80 flex items-start gap-1">
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                  {risk}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div>
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Top Fixes
            </p>
            <div className="space-y-1.5">
              {recommendations.slice(0, 3).map((rec, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-md border px-2 py-1.5 space-y-0.5',
                    SEVERITY_COLORS[rec.severity] || SEVERITY_COLORS.low,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium">{rec.title}</span>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 border-current">
                      {rec.severity}
                    </Badge>
                  </div>
                  <p className="text-[9px] opacity-80">{rec.why}</p>
                  <p className="text-[9px] font-medium">Fix: {rec.suggested_fix}</p>
                  {onCreateNote && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[8px] px-1.5 gap-0.5 mt-0.5"
                      onClick={() => onCreateNote(rec)}
                    >
                      <TrendingUp className="h-2.5 w-2.5" /> Create Note
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
