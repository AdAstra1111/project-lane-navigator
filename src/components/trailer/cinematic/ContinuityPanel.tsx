/**
 * Continuity Intelligence Panel — judge, fix plan, and apply
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Eye, Zap, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  ArrowLeftRight, Lightbulb, Palette, Activity, Play, RotateCcw, Shield,
  Loader2, Clock, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useContinuityRuns,
  useContinuityScores,
  useContinuityMutations,
} from '@/lib/trailerPipeline/continuityHooks';

interface ContinuityPanelProps {
  projectId: string;
  trailerCutId?: string;
  blueprintId?: string;
}

const ISSUE_ICONS: Record<string, any> = {
  direction_reversal: ArrowLeftRight,
  eyeline_break: Eye,
  lighting_jump: Lightbulb,
  palette_whiplash: Palette,
  energy_drop: Activity,
  pacing_mismatch: Zap,
};

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-green-500';
  if (score >= 0.6) return 'text-yellow-500';
  return 'text-destructive';
}

function scoreBg(score: number): string {
  if (score >= 0.8) return 'bg-green-500/10';
  if (score >= 0.6) return 'bg-yellow-500/10';
  return 'bg-destructive/10';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Filter fix plan actions to safe-only */
function filterSafeActions(actions: any[]): any[] {
  return actions.filter((a: any) => {
    if (a.type === 'swap_clip') return true;
    if (a.type === 'adjust_trim') {
      const delta = Math.abs(a.trim_in_delta_ms || 0);
      return delta <= 300;
    }
    return false;
  });
}

export function ContinuityPanel({ projectId, trailerCutId, blueprintId }: ContinuityPanelProps) {
  const { tagClips, runJudge, buildFixPlan, applyFixPlan } = useContinuityMutations(projectId);
  const { data: runs } = useContinuityRuns(projectId, trailerCutId);
  const latestRun = runs?.[0];
  const { data: scores } = useContinuityScores(latestRun?.id);

  const [fixPlan, setFixPlan] = useState<any>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [showScores, setShowScores] = useState(true);
  const [showFixPlan, setShowFixPlan] = useState(false);
  const [showWorst, setShowWorst] = useState(false);
  const [allowBreaks, setAllowBreaks] = useState(true);
  const [safeOnly, setSafeOnly] = useState(true);
  const [reRunAfterApply, setReRunAfterApply] = useState(true);

  const summary = latestRun?.summary_json as any;
  const avgScore = summary?.avg_transition_score ?? null;
  const worstTransitions: any[] = summary?.worst_transitions || [];

  // Auto dry-run when fix plan is generated
  useEffect(() => {
    if (fixPlan && trailerCutId && latestRun?.id) {
      const planToApply = safeOnly
        ? { ...fixPlan, actions: filterSafeActions(fixPlan.actions || []) }
        : fixPlan;
      if (planToApply.actions?.length > 0) {
        applyFixPlan.mutate(
          { trailerCutId, continuityRunId: latestRun.id, plan: planToApply, dryRun: true },
          { onSuccess: (data) => setDryRunResult(data) }
        );
      } else {
        setDryRunResult({ message: 'No applicable actions', diff: [] });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixPlan, safeOnly]);

  const handleRunJudge = () => {
    if (!trailerCutId) return;
    tagClips.mutate(
      { blueprintId },
      {
        onSuccess: () => {
          runJudge.mutate({
            trailerCutId,
            continuitySettings: { allow_intentional_breaks: allowBreaks },
          });
        },
        onError: () => {
          runJudge.mutate({ trailerCutId });
        },
      }
    );
  };

  const handleBuildFixPlan = () => {
    if (!trailerCutId || !latestRun?.id) return;
    setDryRunResult(null);
    buildFixPlan.mutate(
      { trailerCutId, continuityRunId: latestRun.id },
      {
        onSuccess: (data) => {
          setFixPlan(data);
          setShowFixPlan(true);
        },
      }
    );
  };

  const handleApplyFixPlan = useCallback(() => {
    if (!trailerCutId || !fixPlan || !latestRun?.id) return;
    const planToApply = safeOnly
      ? { ...fixPlan, actions: filterSafeActions(fixPlan.actions || []) }
      : fixPlan;
    applyFixPlan.mutate(
      { trailerCutId, continuityRunId: latestRun.id, plan: planToApply, dryRun: false },
      {
        onSuccess: () => {
          if (reRunAfterApply) {
            runJudge.mutate({ trailerCutId });
          }
        },
      }
    );
  }, [trailerCutId, fixPlan, latestRun?.id, safeOnly, reRunAfterApply, applyFixPlan, runJudge]);

  const isRunning = tagClips.isPending || runJudge.isPending;
  const runStatus = latestRun?.status;
  const displayedActions = fixPlan
    ? (safeOnly ? filterSafeActions(fixPlan.actions || []) : fixPlan.actions || [])
    : [];

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          Continuity Intelligence
          <Badge variant="outline" className="text-[9px] ml-auto">v1</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Run status banner */}
        {latestRun && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {runStatus === 'running' && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            {runStatus === 'complete' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
            {runStatus === 'failed' && <AlertTriangle className="h-3 w-3 text-destructive" />}
            <span className="capitalize">{runStatus}</span>
            {latestRun.created_at && (
              <>
                <Clock className="h-2.5 w-2.5 ml-1" />
                <span>{timeAgo(latestRun.created_at)}</span>
              </>
            )}
            {latestRun.method && (
              <Badge variant="outline" className="text-[8px] px-1 py-0">{latestRun.method}</Badge>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            <Switch
              id="allow-breaks"
              checked={allowBreaks}
              onCheckedChange={setAllowBreaks}
              className="scale-75"
            />
            <Label htmlFor="allow-breaks" className="text-[10px] text-muted-foreground">
              Allow breaks in Twist/Crescendo
            </Label>
          </div>
          <Button
            size="sm"
            onClick={handleRunJudge}
            disabled={isRunning || !trailerCutId}
            className="text-xs gap-1.5"
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
            {isRunning ? 'Analyzing…' : 'Run Continuity Judge'}
          </Button>
        </div>

        {/* Summary */}
        {avgScore !== null && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className={`text-2xl font-bold ${scoreColor(avgScore)}`}>
                {(avgScore * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-muted-foreground">
                avg transition score
                <br />
                <span className="font-mono">{summary?.transition_count || 0} transitions</span>
              </div>
              {runStatus === 'complete' && (
                <Badge
                  variant={avgScore >= 0.75 ? 'secondary' : avgScore >= 0.6 ? 'outline' : 'destructive'}
                  className="text-[9px] ml-auto"
                >
                  {avgScore >= 0.75 ? 'Good' : avgScore >= 0.6 ? 'Fair' : 'Needs Work'}
                </Badge>
              )}
            </div>

            {/* Worst Transitions (from summary_json) */}
            {worstTransitions.length > 0 && (
              <Collapsible open={showWorst} onOpenChange={setShowWorst}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-xs w-full justify-between text-amber-500">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3" />
                      Worst Transitions ({worstTransitions.length})
                    </span>
                    {showWorst ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1 mt-1">
                    {worstTransitions.slice(0, 5).map((wt: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded bg-destructive/5">
                        <span className="font-mono text-muted-foreground w-14">
                          #{wt.from_beat ?? wt.from_beat_index}→{wt.to_beat ?? wt.to_beat_index}
                        </span>
                        <span className={`font-bold w-10 ${scoreColor(wt.score ?? 0)}`}>
                          {((wt.score ?? 0) * 100).toFixed(0)}%
                        </span>
                        <span className="text-muted-foreground truncate flex-1">
                          {wt.reason || wt.issues?.map((i: any) => i.type).join(', ') || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Per-transition scores */}
            <Collapsible open={showScores} onOpenChange={setShowScores}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs w-full justify-between">
                  Transition Scores
                  {showScores ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-[240px] mt-2">
                  <div className="space-y-1 pr-3">
                    {(scores || []).map((s: any) => {
                      const sc = Number(s.score);
                      const issues = s.issues_json || [];
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-2 text-[10px] py-1.5 px-2 rounded ${scoreBg(sc)}`}
                        >
                          <span className="font-mono text-muted-foreground w-12">
                            #{s.from_beat_index}→{s.to_beat_index}
                          </span>
                          <span className={`font-bold w-10 ${scoreColor(sc)}`}>
                            {(sc * 100).toFixed(0)}%
                          </span>
                          <div className="flex gap-1 flex-1">
                            <TooltipProvider>
                              {issues.map((issue: any, idx: number) => {
                                const Icon = ISSUE_ICONS[issue.type] || AlertTriangle;
                                return (
                                  <Tooltip key={idx}>
                                    <TooltipTrigger>
                                      <Icon className="h-3 w-3 text-muted-foreground" />
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs max-w-[200px]">
                                      <p className="font-medium">{issue.type}</p>
                                      <p className="text-muted-foreground">{issue.detail}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </TooltipProvider>
                          </div>
                          {s.suggestion_json?.action && s.suggestion_json.action !== 'none' && (
                            <Badge variant="outline" className="text-[8px]">
                              {s.suggestion_json.action}
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* Fix Plan Controls */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBuildFixPlan}
                  disabled={buildFixPlan.isPending || !latestRun?.id}
                  className="text-xs gap-1.5"
                >
                  {buildFixPlan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  {buildFixPlan.isPending ? 'Planning…' : 'Generate Fix Plan'}
                </Button>

                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="safe-only"
                    checked={safeOnly}
                    onCheckedChange={(v) => setSafeOnly(!!v)}
                    className="h-3 w-3"
                  />
                  <Label htmlFor="safe-only" className="text-[10px] text-muted-foreground">
                    Safe fixes only
                  </Label>
                </div>

                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="rerun-judge"
                    checked={reRunAfterApply}
                    onCheckedChange={(v) => setReRunAfterApply(!!v)}
                    className="h-3 w-3"
                  />
                  <Label htmlFor="rerun-judge" className="text-[10px] text-muted-foreground">
                    Re-run judge after apply
                  </Label>
                </div>
              </div>

              {/* Safe-only explainer */}
              {safeOnly && fixPlan && (
                <p className="text-[9px] text-muted-foreground">
                  Safe mode: only swap_clip (same beat) and adjust_trim (≤300ms).
                  {fixPlan.actions?.length !== displayedActions.length && (
                    <span className="text-amber-500"> {fixPlan.actions.length - displayedActions.length} action(s) blocked.</span>
                  )}
                </p>
              )}
            </div>

            {/* Fix Plan + Dry Run Preview */}
            {fixPlan && (
              <Collapsible open={showFixPlan} onOpenChange={setShowFixPlan}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-xs w-full justify-between">
                    Fix Plan ({displayedActions.length} actions, {((fixPlan.confidence || 0) * 100).toFixed(0)}% confidence)
                    {showFixPlan ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-[200px] mt-2">
                    <div className="space-y-1 pr-3">
                      {displayedActions.map((action: any, idx: number) => (
                        <div key={idx} className="text-[10px] py-1.5 px-2 rounded bg-muted/50 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[8px]">{action.type}</Badge>
                            {action.beat_index != null && (
                              <span className="font-mono text-muted-foreground">beat #{action.beat_index}</span>
                            )}
                            {action.between_beats && (
                              <span className="font-mono text-muted-foreground">
                                between #{action.between_beats[0]}–{action.between_beats[1]}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground">{action.reason}</p>
                        </div>
                      ))}
                      {displayedActions.length === 0 && (
                        <p className="text-[10px] text-muted-foreground py-2">No applicable actions{safeOnly ? ' in safe mode' : ''}.</p>
                      )}
                    </div>
                  </ScrollArea>

                  {/* Dry-run diff preview (auto-generated) */}
                  {dryRunResult && (
                    <div className="mt-2 p-2 rounded bg-muted/30 border border-border">
                      <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Dry-run preview</p>
                      {dryRunResult.diff?.length > 0 ? (
                        <div className="space-y-1">
                          {dryRunResult.diff.map((d: any, i: number) => (
                            <div key={i} className={`text-[10px] flex items-center gap-1.5 ${d.skipped ? 'opacity-50' : ''}`}>
                              <RefreshCw className="h-2.5 w-2.5 text-primary" />
                              {d.type === 'swap_clip' ? (
                                <span className="text-muted-foreground">
                                  beat #{d.beat_index ?? '?'}: <span className="line-through text-destructive/60">{String(d.old_clip_id ?? '').slice(0, 12)}</span> → <span className="text-green-500">{String(d.new_clip_id ?? '').slice(0, 12)}</span>
                                </span>
                              ) : d.type === 'adjust_trim' ? (
                                <span className="text-muted-foreground">
                                  beat #{d.beat_index ?? '?'}: trim_in <span className="line-through text-destructive/60">{d.old_trim_in}</span> → <span className="text-green-500">{d.new_trim_in}</span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  {d.type} beat #{d.beat_index ?? '?'}: {d.field ?? 'update'} {d.old_value != null && <><span className="line-through text-destructive/60">{String(d.old_value).slice(0, 20)}</span> → </>}<span className="text-green-500">{String(d.new_value ?? '').slice(0, 20)}</span>
                                </span>
                              )}
                              {d.skipped && <Badge variant="outline" className="text-[7px] px-1 py-0">skipped</Badge>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">{dryRunResult.message || 'No changes in dry run.'}</p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      onClick={handleApplyFixPlan}
                      disabled={applyFixPlan.isPending || displayedActions.length === 0}
                      className="text-xs gap-1"
                    >
                      {applyFixPlan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Apply Fix Plan
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {!avgScore && !isRunning && (
          <p className="text-[10px] text-muted-foreground">
            Run the continuity judge to analyze transition flow between beats.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
