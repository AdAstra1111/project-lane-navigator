/**
 * Quality Run History — CIK quality run history for a project.
 * Shows run list, run detail with attempt diff, units table, repair instruction.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle2, XCircle, Clock, Copy, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

/* ── Types ── */

interface QualityRun {
  id: string;
  engine: string;
  lane: string | null;
  model: string;
  run_source: string | null;
  adapter_mode: string | null;
  strictness_mode: string | null;
  attempt_count: number;
  final_pass: boolean;
  final_score: number;
  hard_failures: string[] | null;
  diagnostic_flags: string[] | null;
  metrics_json: any;
  settings_json: any;
  created_at: string;
}

interface QualityAttempt {
  id: string;
  run_id: string;
  attempt_index: number;
  model: string | null;
  score: number;
  pass: boolean;
  failures: string[];
  hard_failures: string[];
  diagnostic_flags: string[];
  unit_count: number | null;
  expected_unit_count: number | null;
  repair_instruction: string | null;
  input_summary_json: any;
  output_json: any;
  units_json: any;
  metrics_json: any;
  adapter_metrics_json: any;
}

/* ── Diff Logic (exported for testing) ── */

export function computeFailureDiff(
  attempt0Failures: string[],
  attempt1Failures: string[],
): { fixed: string[]; remaining: string[]; newFailures: string[] } {
  const set0 = new Set(attempt0Failures);
  const set1 = new Set(attempt1Failures);
  return {
    fixed: attempt0Failures.filter(f => !set1.has(f)),
    remaining: attempt0Failures.filter(f => set1.has(f)),
    newFailures: attempt1Failures.filter(f => !set0.has(f)),
  };
}

/* ── Trend Computations (exported for testing) ── */

export function computePassRate(runs: { final_pass: boolean }[]): { passCount: number; total: number; rate: number } {
  const total = runs.length;
  if (total === 0) return { passCount: 0, total: 0, rate: 0 };
  const passCount = runs.filter(r => r.final_pass).length;
  return { passCount, total, rate: passCount / total };
}

export function computeAvgScore(runs: { final_score: number }[]): number {
  if (runs.length === 0) return 0;
  const sum = runs.reduce((acc, r) => acc + Number(r.final_score), 0);
  return sum / runs.length;
}

export function buildChartData(runs: { final_score: number; final_pass: boolean; created_at: string }[]): { score: number; pass: boolean; time: string }[] {
  return [...runs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(r => ({ score: Number(r.final_score), pass: r.final_pass, time: r.created_at }));
}

/* ── Main Component ── */

export default function QualityRunHistory({ projectId }: { projectId: string }) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const { data: runs, isLoading, error } = useQuery({
    queryKey: ['quality-runs', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cinematic_quality_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as QualityRun[];
    },
    enabled: !!projectId,
  });

  const { data: attempts } = useQuery({
    queryKey: ['quality-attempts', expandedRunId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cinematic_quality_attempts')
        .select('*')
        .eq('run_id', expandedRunId!)
        .order('attempt_index', { ascending: true });
      if (error) throw error;
      return (data || []) as QualityAttempt[];
    },
    enabled: !!expandedRunId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4 animate-spin" />
            Loading quality history…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">Failed to load quality history.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Quality Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No quality runs recorded yet. Runs are logged automatically when CIK evaluates trailer or storyboard output.
          </p>
        </CardContent>
      </Card>
    );
  }

  const recent20 = runs.slice(0, 20);
  const passRate = computePassRate(recent20);
  const avgScore = computeAvgScore(recent20);
  const chartData = buildChartData(runs);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Quality Run History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-0">
        {/* Trend widgets */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Pass rate */}
          <div className="flex-1 rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">
              Pass rate (last {passRate.total})
            </p>
            <p className="text-lg font-mono font-bold tabular-nums">
              {(passRate.rate * 100).toFixed(0)}%
              <span className="text-xs font-normal text-muted-foreground ml-1.5">
                ({passRate.passCount}/{passRate.total})
              </span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Avg score: <span className="font-mono">{avgScore.toFixed(3)}</span>
            </p>
          </div>

          {/* Sparkline */}
          <div className="flex-[2] rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">
              Score over time ({chartData.length} runs)
            </p>
            {chartData.length < 2 ? (
              <p className="text-xs text-muted-foreground italic">Not enough runs to chart yet.</p>
            ) : (
              <Sparkline data={chartData} />
            )}
          </div>
        </div>
      </CardContent>
      <CardContent className="p-0 pt-2">
        <ScrollArea className="max-h-[600px]">
          {/* Column headers */}
          <div className="px-4 py-2 grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 text-[10px] text-muted-foreground font-medium border-b border-border">
            <span className="w-4" />
            <span>Source / Lane</span>
            <span>Score</span>
            <span>Hard</span>
            <span>Diag</span>
            <span>Time</span>
          </div>
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <div key={run.id}>
                <button
                  className="w-full px-4 py-2.5 grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                >
                  {run.final_pass ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{run.run_source || run.engine}</Badge>
                      {run.lane && run.lane !== 'unknown' && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{run.lane}</Badge>
                      )}
                      {run.strictness_mode && run.strictness_mode !== 'standard' && (
                        <Badge variant={run.strictness_mode === 'strict' ? 'destructive' : 'outline'} className="text-[10px] px-1.5 py-0">
                          {run.strictness_mode}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-mono tabular-nums">{Number(run.final_score).toFixed(2)}</span>
                  <span className="text-xs font-mono tabular-nums text-destructive">{(run.hard_failures || []).length}</span>
                  <span className="text-xs font-mono tabular-nums text-muted-foreground">{(run.diagnostic_flags || []).length}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(run.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>

                {expandedRunId === run.id && attempts && (
                  <RunDetail run={run} attempts={attempts} />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/* ── Run Detail ── */

function RunDetail({ run, attempts }: { run: QualityRun; attempts: QualityAttempt[] }) {
  // Specialized view for video_render runs
  if (run.run_source === 'video_render') {
    return <RenderRunDetail run={run} attempts={attempts} />;
  }

  if (attempts.length === 0) return null;

  const attempt0 = attempts.find(a => a.attempt_index === 0);
  const attempt1 = attempts.find(a => a.attempt_index === 1);

  const diff = attempt0 && attempt1
    ? computeFailureDiff(attempt0.hard_failures || [], attempt1.hard_failures || [])
    : null;
  const scoreDelta = attempt1 && attempt0 ? attempt1.score - attempt0.score : null;

  const repairInstruction = attempt1?.input_summary_json?.repair_instruction
    || attempt1?.repair_instruction
    || null;

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-border/50 bg-muted/10">
      {/* Run header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 text-xs">
        <div><span className="text-muted-foreground">Lane: </span><span className="font-medium">{run.lane || '—'}</span></div>
        <div><span className="text-muted-foreground">Source: </span><span>{run.run_source || run.engine}</span></div>
        <div><span className="text-muted-foreground">Adapter: </span><span>{run.adapter_mode || '—'}</span></div>
        <div><span className="text-muted-foreground">Strictness: </span><span>{run.strictness_mode || 'standard'}</span></div>
      </div>

      {/* Diff summary */}
      {diff && (
        <div className="rounded-md border border-border bg-background p-3 space-y-2">
          <p className="text-xs font-medium">Repair Impact</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Score Δ: </span>
              <span className={scoreDelta && scoreDelta > 0 ? 'text-green-500 font-medium' : 'text-destructive font-medium'}>
                {scoreDelta !== null ? (scoreDelta > 0 ? '+' : '') + scoreDelta.toFixed(3) : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Fixed: </span>
              <span className={diff.fixed.length > 0 ? 'text-green-500' : 'text-muted-foreground'}>
                {diff.fixed.length}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Remaining: </span>
              <span className={diff.remaining.length > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                {diff.remaining.length}
              </span>
            </div>
            {diff.newFailures.length > 0 && (
              <div>
                <span className="text-muted-foreground">New: </span>
                <span className="text-destructive font-medium">{diff.newFailures.length}</span>
              </div>
            )}
          </div>
          {diff.fixed.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {diff.fixed.map(f => (
                <Badge key={`fixed-${f}`} className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/30">✓ {f}</Badge>
              ))}
            </div>
          )}
          {diff.remaining.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {diff.remaining.map(f => (
                <Badge key={`rem-${f}`} variant="destructive" className="text-[10px] px-1.5 py-0">⬤ {f}</Badge>
              ))}
            </div>
          )}
          {diff.newFailures.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {diff.newFailures.map(f => (
                <Badge key={`new-${f}`} variant="destructive" className="text-[10px] px-1.5 py-0">⚠ {f}</Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Repair instruction */}
      {repairInstruction && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs text-muted-foreground font-medium">Repair instruction</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1"
              onClick={() => {
                navigator.clipboard.writeText(repairInstruction);
                toast.success('Copied to clipboard');
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <pre className="bg-muted rounded p-2 text-[10px] leading-tight whitespace-pre-wrap max-h-40 overflow-auto font-mono border border-border">
            {repairInstruction}
          </pre>
        </div>
      )}

      {/* Attempt tabs */}
      <Tabs defaultValue="0" className="w-full">
        <TabsList className="w-full">
          {attempts.map((a) => (
            <TabsTrigger key={a.attempt_index} value={String(a.attempt_index)} className="flex-1 text-xs">
              {a.attempt_index === 0 ? 'Initial' : 'Repair'}
              {a.pass ? (
                <CheckCircle2 className="h-3 w-3 ml-1 text-green-500" />
              ) : (
                <XCircle className="h-3 w-3 ml-1 text-destructive" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {attempts.map((attempt) => (
          <TabsContent key={attempt.attempt_index} value={String(attempt.attempt_index)} className="space-y-2 mt-2">
            <AttemptDetail attempt={attempt} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/* ── Render Run Detail (video_render source) ── */

function RenderRunDetail({ run, attempts }: { run: QualityRun; attempts: QualityAttempt[] }) {
  const attempt0 = attempts.find(a => a.attempt_index === 0);
  const metrics = run.metrics_json || {};
  const outputShots = attempt0?.output_json?.shots || [];

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-border/50 bg-muted/10">
      {/* Render summary header */}
      <div className="pt-3">
        <p className="text-xs font-medium mb-2">Render Summary</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><span className="text-muted-foreground">Provider: </span><span className="font-medium">{metrics.provider_id || '—'}</span></div>
          <div><span className="text-muted-foreground">Model: </span><span>{metrics.model_id || run.model}</span></div>
          <div><span className="text-muted-foreground">Lane: </span><span>{run.lane || '—'}</span></div>
          <div><span className="text-muted-foreground">Score: </span><span className="font-mono">{Number(run.final_score).toFixed(3)}</span></div>
        </div>
      </div>

      {/* Shot stats */}
      <div className="rounded-md border border-border bg-background p-3">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground block text-[10px]">Total Shots</span>
            <span className="font-mono font-medium">{metrics.totalShots ?? '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Completed</span>
            <span className="font-mono font-medium text-green-600">{metrics.completedShots ?? '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Failed</span>
            <span className="font-mono font-medium text-destructive">{metrics.failedShots ?? 0}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Retries</span>
            <span className="font-mono">{metrics.retries ?? 0}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Rough Cut</span>
            <span className="font-mono">{metrics.roughCutStatus ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Continuity warnings count */}
      {metrics.continuityWarningsCount > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Continuity warnings: </span>
          <span className="font-mono text-yellow-600 dark:text-yellow-400">{metrics.continuityWarningsCount}</span>
        </div>
      )}

      {/* Hard failures */}
      {(run.hard_failures || []).length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Hard failures: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {(run.hard_failures || []).map(f => (
              <Badge key={f} variant="destructive" className="text-[10px] px-1.5 py-0">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Diagnostic flags */}
      {(run.diagnostic_flags || []).length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Diagnostics: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {(run.diagnostic_flags || []).map(f => (
              <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Shot artifacts table */}
      {outputShots.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border border-border rounded">
            <thead>
              <tr className="bg-muted">
                <th className="px-2 py-1 text-left font-medium">#</th>
                <th className="px-2 py-1 text-right font-medium">Duration</th>
                <th className="px-2 py-1 text-left font-medium">Path</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {outputShots.slice(0, 20).map((s: any, i: number) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-2 py-0.5 font-mono">{s.shotIndex ?? i}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{s.durationSec ?? '—'}s</td>
                  <td className="px-2 py-0.5 truncate max-w-[200px]">{s.storagePath || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Adapter metrics */}
      {attempt0?.adapter_metrics_json && Object.keys(attempt0.adapter_metrics_json).length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Performance: </span>
          <span className="font-mono">
            {attempt0.adapter_metrics_json.totalMs || attempt0.adapter_metrics_json.processingTimeMs
              ? `${Math.round((attempt0.adapter_metrics_json.totalMs || attempt0.adapter_metrics_json.processingTimeMs) / 1000)}s`
              : '—'}
          </span>
          {attempt0.adapter_metrics_json.avgCostPerShot != null && (
            <span className="ml-2 font-mono">${attempt0.adapter_metrics_json.avgCostPerShot}/shot</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Attempt Detail ── */

function AttemptDetail({ attempt }: { attempt: QualityAttempt }) {
  const [showPayload, setShowPayload] = useState(false);

  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        <div><span className="text-muted-foreground">Score: </span><span className="font-mono">{Number(attempt.score).toFixed(3)}</span></div>
        <div><span className="text-muted-foreground">Model: </span><span>{attempt.model || '—'}</span></div>
        <div><span className="text-muted-foreground">Units: </span><span>{attempt.unit_count ?? '?'}{attempt.expected_unit_count ? ` / ${attempt.expected_unit_count}` : ''}</span></div>
        <div><span className="text-muted-foreground">Pass: </span><span>{attempt.pass ? '✓' : '✗'}</span></div>
      </div>

      {(attempt.hard_failures?.length > 0) && (
        <div>
          <span className="text-muted-foreground">Hard failures: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {attempt.hard_failures.map(f => (
              <Badge key={f} variant="destructive" className="text-[10px] px-1.5 py-0">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {(attempt.diagnostic_flags?.length > 0) && (
        <div>
          <span className="text-muted-foreground">Diagnostics: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {attempt.diagnostic_flags.map(f => (
              <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Attempt payload viewer */}
      <div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setShowPayload(!showPayload)}>
          {showPayload ? 'Hide' : 'Show'} output
          {showPayload ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
        </Button>

        {showPayload && <PayloadViewer outputJson={attempt.output_json} />}
      </div>

      {attempt.metrics_json && Object.keys(attempt.metrics_json).length > 0 && (
        <div>
          <span className="text-muted-foreground">Metrics:</span>
          <pre className="bg-muted rounded p-2 text-[10px] leading-tight whitespace-pre-wrap max-h-32 overflow-auto font-mono mt-1 border border-border">
            {JSON.stringify(attempt.metrics_json, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Payload / Units Viewer ── */

function PayloadViewer({ outputJson }: { outputJson: any }) {
  if (!outputJson) {
    return <p className="text-[10px] text-muted-foreground italic">No output data.</p>;
  }

  // Try to find units array
  const units: any[] | null = extractUnits(outputJson);

  if (units && units.length > 0) {
    return (
      <div className="overflow-x-auto mt-1">
        <table className="w-full text-[10px] border border-border rounded">
          <thead>
            <tr className="bg-muted">
              <th className="px-2 py-1 text-left font-medium">#</th>
              <th className="px-2 py-1 text-left font-medium">Intent</th>
              <th className="px-2 py-1 text-right font-medium">Energy</th>
              <th className="px-2 py-1 text-right font-medium">Tension</th>
              <th className="px-2 py-1 text-right font-medium">Density</th>
              <th className="px-2 py-1 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {units.map((u: any, i: number) => (
              <tr key={i} className="hover:bg-muted/30">
                <td className="px-2 py-0.5 font-mono">{i}</td>
                <td className="px-2 py-0.5">{u.intent || u.emotional_intent || '—'}</td>
                <td className="px-2 py-0.5 text-right font-mono">{fmtNum(u.energy)}</td>
                <td className="px-2 py-0.5 text-right font-mono">{fmtNum(u.tension)}</td>
                <td className="px-2 py-0.5 text-right font-mono">{fmtNum(u.density)}</td>
                <td className="px-2 py-0.5">{u.role || u.shot_type || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Fallback: JSON viewer
  return (
    <ScrollArea className="max-h-48 mt-1">
      <pre className="bg-muted rounded p-2 text-[10px] leading-tight whitespace-pre-wrap font-mono border border-border">
        {JSON.stringify(outputJson, null, 2).slice(0, 5000)}
      </pre>
    </ScrollArea>
  );
}

function extractUnits(json: any): any[] | null {
  if (!json) return null;
  if (Array.isArray(json)) return json.length > 0 && typeof json[0] === 'object' ? json : null;
  for (const key of ['units', 'beats', 'segments', 'panels', 'items']) {
    if (Array.isArray(json[key]) && json[key].length > 0) return json[key];
  }
  return null;
}

function fmtNum(v: any): string {
  if (v == null) return '—';
  const n = Number(v);
  return isNaN(n) ? '—' : n.toFixed(2);
}

/* ── Sparkline (inline SVG) ── */

function Sparkline({ data }: { data: { score: number; pass: boolean }[] }) {
  const w = 300;
  const h = 40;
  const pad = 2;

  const scores = data.map(d => d.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d.score - min) / range) * (h - pad * 2);
    return { x, y, pass: d.pass };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={1.5}
          fill={p.pass ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
        />
      ))}
    </svg>
  );
}
