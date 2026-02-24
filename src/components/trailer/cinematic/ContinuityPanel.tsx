/**
 * Continuity Intelligence Panel — judge, fix plan, and apply
 */
import { useState } from 'react';
import {
  Eye, Zap, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  ArrowLeftRight, Lightbulb, Palette, Activity, Play, RotateCcw, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
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

export function ContinuityPanel({ projectId, trailerCutId, blueprintId }: ContinuityPanelProps) {
  const { tagClips, runJudge, buildFixPlan, applyFixPlan } = useContinuityMutations(projectId);
  const { data: runs } = useContinuityRuns(projectId, trailerCutId);
  const latestRun = runs?.[0];
  const { data: scores } = useContinuityScores(latestRun?.id);

  const [fixPlan, setFixPlan] = useState<any>(null);
  const [showScores, setShowScores] = useState(true);
  const [showFixPlan, setShowFixPlan] = useState(false);
  const [allowBreaks, setAllowBreaks] = useState(true);

  const summary = latestRun?.summary_json as any;
  const avgScore = summary?.avg_transition_score ?? null;

  const handleRunJudge = () => {
    if (!trailerCutId) return;
    // Tag clips first, then judge
    tagClips.mutate(
      { blueprintId },
      {
        onSuccess: () => {
          runJudge.mutate({
            trailerCutId,
            continuitySettings: {
              allow_intentional_breaks: allowBreaks,
            },
          });
        },
        onError: () => {
          // Still run judge even if tagging partially fails
          runJudge.mutate({ trailerCutId });
        },
      }
    );
  };

  const handleBuildFixPlan = () => {
    if (!trailerCutId || !latestRun?.id) return;
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

  const handleApplyFixPlan = (dryRun: boolean) => {
    if (!trailerCutId || !fixPlan) return;
    applyFixPlan.mutate({
      trailerCutId,
      continuityRunId: latestRun?.id,
      plan: fixPlan,
      dryRun,
    });
  };

  const isRunning = tagClips.isPending || runJudge.isPending;

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
        {/* Controls */}
        <div className="flex items-center gap-2">
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
            <Eye className="h-3 w-3" />
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
              {latestRun?.status === 'complete' && (
                <Badge
                  variant={avgScore >= 0.75 ? 'secondary' : avgScore >= 0.6 ? 'outline' : 'destructive'}
                  className="text-[9px] ml-auto"
                >
                  {avgScore >= 0.75 ? 'Good' : avgScore >= 0.6 ? 'Fair' : 'Needs Work'}
                </Badge>
              )}
            </div>

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

            {/* Fix Plan */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleBuildFixPlan}
                disabled={buildFixPlan.isPending || !latestRun?.id}
                className="text-xs gap-1.5"
              >
                <Zap className="h-3 w-3" />
                {buildFixPlan.isPending ? 'Planning…' : 'Generate Fix Plan'}
              </Button>
            </div>

            {fixPlan && (
              <Collapsible open={showFixPlan} onOpenChange={setShowFixPlan}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-xs w-full justify-between">
                    Fix Plan ({fixPlan.actions?.length || 0} actions, {((fixPlan.confidence || 0) * 100).toFixed(0)}% confidence)
                    {showFixPlan ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-[200px] mt-2">
                    <div className="space-y-1 pr-3">
                      {(fixPlan.actions || []).map((action: any, idx: number) => (
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
                    </div>
                  </ScrollArea>
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleApplyFixPlan(true)}
                      disabled={applyFixPlan.isPending}
                      className="text-xs gap-1"
                    >
                      <Play className="h-3 w-3" />
                      Dry Run
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApplyFixPlan(false)}
                      disabled={applyFixPlan.isPending}
                      className="text-xs gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" />
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
