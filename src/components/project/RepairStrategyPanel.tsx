/**
 * RepairStrategyPanel — Surfaces PRP1 preventive repair prioritization,
 * NRF1 axis debt context, and PRP2 strategic recommendation. Read-only UI.
 */

import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  usePreventiveRepairPrioritization,
  fetchPatchTargets,
  fetchPatchPlan,
  fetchPatchPlanValidation,
  fetchPatchExecution,
  fetchPatchExecutionReplay,
  fetchPatchExecutionHistory,
  fetchPatchExecutionComparison,
  fetchPatchExecutionAnalytics,
  deriveExecutionOutcome,
  type PatchExecutionHistoryItem, type PatchExecutionHistoryResponse, type PatchExecutionHistoryCursor,
  type PatchExecutionHistoryFilters, type PatchExecutionOutcome,
  type PatchExecutionComparisonResponse, type MetricDiffEntry, type DocumentTimelineDiffEntry,
  type PatchExecutionAnalyticsResponse, type PatchExecutionAnalytics,
  type PRP1Repair, type AxisDebtEntry, type PRP2Data,
  type InterventionROIData, type ROIRepairEntry,
  type InterventionAnalysisResult, type InterventionCandidate,
  type PRP2SData, type PRP2SStrategyOption, type PRP2SRootCauseAdvisory,
  type RootCauseAnalysisResult,
  type PatchTargetResolutionResult,
  type PatchPlanBuildResult, type PatchPlan, type PatchImpactSurface, type PatchRevalidationTarget,
  type PatchPlanValidationResponse, type PatchPlanValidationResult, type PatchPlanValidationIssue,
  type PatchExecutionResponse, type PatchExecutionResult, type PatchExecutionTargetResult,
  type PostExecutionGovernance, type PostExecutionRevalidationTarget,
  type RevalidationExecution, type RevalidationExecutionTarget,
  type ExecutionObservability, type ExecutionObservabilityDocTimeline, type ExecutionObservabilityEvent,
  type ExecutionReplayResponse, type ExecutionReplaySnapshot,
  fetchPatchExecutionRecommendations,
  fetchPatchExecutionRecommendationTrends,
  type PatchExecutionRecommendationsResponse,
  type ExecutionRecommendations, type ExecutionRecommendation,
  type PatchExecutionTrendsResponse, type ExecutionRecommendationTrends,
  type TrendDirection, type TrendRatePoint, type TrendNullableCountPoint, type TrendCountPoint,
  type TrendTopSignalEntry,
  dedupeAndSuppressRecommendations,
  type DisplayRecommendation, type DisplayRecommendationsResult, type RecommendationBucketKey,
  resolveRecommendationTrendLinkage, humanizeSourceKey,
  type RecommendationTrendLinkage, type LinkedTrendStatus,
  resolveTrendNavigationTarget,
  type TrendNavigationTarget, type TrendSubsectionKey,
} from '@/hooks/usePreventiveRepairPrioritization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTooltip } from '@/components/InfoTooltip';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  ArrowUp, ArrowDown, Minus, Gauge, TrendingUp, ShieldAlert, AlertTriangle,
  RefreshCw, Info, Star, Unlock, Shield, Target, Activity, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Play, Zap, History, List, Clock,
  Lightbulb, Wrench, FileText, FileCode, ArrowRight, EyeOff, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';

export interface RepairLandingContext {
  title: string;
  rule_id: string;
  severity: string;
  suggested_action: string;
}

interface Props {
  projectId: string | undefined;
  onRouteToRepairs?: (ctx: RepairLandingContext) => void;
  completedRepairSignatures?: Set<string>;
}

/* ── Pressure color helpers ── */
function pressureColor(v: number): string {
  if (v <= 30) return 'text-emerald-400';
  if (v <= 60) return 'text-amber-400';
  if (v <= 80) return 'text-orange-400';
  return 'text-red-400';
}

function pressureBg(v: number): string {
  if (v <= 30) return 'bg-emerald-500';
  if (v <= 60) return 'bg-amber-500';
  if (v <= 80) return 'bg-orange-500';
  return 'bg-red-500';
}

function riskBadgeVariant(level: string): 'destructive' | 'default' | 'secondary' {
  const l = level.toLowerCase();
  if (l === 'high') return 'destructive';
  if (l === 'medium') return 'default';
  return 'secondary';
}

const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type SortKey = 'preventive_rank' | 'baseline_rank' | 'preventive_score' | 'rank_delta' | 'root_cause_signal' | 'preventive_confidence_signal';

export function RepairStrategyPanel({ projectId, onRouteToRepairs, completedRepairSignatures }: Props) {
  const { prp1, nrf1, prp2, roi, prp2s, rcc, iv, isLoading, nrf1Loading, prp2Loading, roiLoading, prp2sLoading, rccLoading, ivLoading, error, refresh } = usePreventiveRepairPrioritization(projectId);
  const [selectedRepair, setSelectedRepair] = useState<PRP1Repair | null>(null);
  const [trendNavTarget, setTrendNavTarget] = useState<TrendNavigationTarget | null>(null);
  
  const [sortKey, setSortKey] = useState<SortKey>('preventive_rank');
  const [sortAsc, setSortAsc] = useState(true);

  const prioritization = prp1?.prp1_prioritization;
  const axisDebtMap: AxisDebtEntry[] = useMemo(() => {
    if (nrf1?.axis_debt_map) return nrf1.axis_debt_map;
    return [];
  }, [nrf1]);

  const sortedRepairs = useMemo(() => {
    if (!prioritization?.prioritized_repairs) return [];
    const list = [...prioritization.prioritized_repairs];
    list.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [prioritization?.prioritized_repairs, sortKey, sortAsc]);

  const sortedAxes = useMemo(() => {
    return [...axisDebtMap].sort((a, b) => {
      const ra = RISK_ORDER[a.risk_level.toLowerCase()] ?? 9;
      const rb = RISK_ORDER[b.risk_level.toLowerCase()] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.source_repair_count - a.source_repair_count;
    });
  }, [axisDebtMap]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => {
    const isActive = sortKey === field;
    return (
      <button
        onClick={() => handleSort(field)}
        className={cn(
          'flex items-center gap-1 text-left transition-colors',
          isActive ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label}
        {isActive ? (
          sortAsc
            ? <ArrowUp className="h-3 w-3 text-primary" />
            : <ArrowDown className="h-3 w-3 text-primary" />
        ) : (
          <ArrowDown className="h-3 w-3 opacity-0 group-hover:opacity-30" />
        )}
      </button>
    );
  };

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
    );
  }

  /* ── Error ── */
  if (error || !prioritization) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-10 text-center space-y-2">
          <AlertTriangle className="h-5 w-5 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Repair prioritization unavailable.</p>
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const pressure = prioritization.project_repair_pressure;
  const highestUpliftRepair = prioritization.highest_preventive_uplift_repair_id
    ? prioritization.prioritized_repairs.find(r => r.repair_id === prioritization.highest_preventive_uplift_repair_id)
    : null;

  return (
    <div className="space-y-5">
      {/* NRF1 degraded banner */}
      {prp1?.nrf1_degraded && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-400">Preventive forecasts unavailable — baseline ranking only.</span>
        </div>
      )}

      {/* ═══ COMPACT LEGEND ═══ */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground/70">Legend</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Low</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Moderate</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Elevated</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Critical</span>
        <span className="border-l border-border/50 pl-4 flex items-center gap-1"><ArrowUp className="h-2.5 w-2.5 text-emerald-400" /> Moved up</span>
        <span className="flex items-center gap-1"><ArrowDown className="h-2.5 w-2.5 text-red-400" /> Moved down</span>
        <span className="flex items-center gap-1"><Minus className="h-2.5 w-2.5 text-muted-foreground" /> Unchanged</span>
      </div>

      {/* ═══ TOP SUMMARY ROW ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: Pressure Gauge */}
        <Card className="border-border/50">
          <CardContent className="p-4 flex flex-col items-center gap-2">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${pressure} ${100 - pressure}`}
                  strokeLinecap="round"
                  className={pressureColor(pressure)}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn('text-sm font-mono font-bold', pressureColor(pressure))}>
                  {Math.round(pressure)}
                </span>
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground text-center">Forecasted narrative repair pressure</span>
          </CardContent>
        </Card>

        {/* Card 2: Uplift Count */}
        <Card className="border-border/50">
          <CardContent className="p-4 flex flex-col items-center justify-center gap-1">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-mono font-bold text-foreground">
                {prioritization.repairs_with_preventive_uplift}
              </span>
              <span className="text-sm text-muted-foreground font-mono">
                / {prioritization.total_repairs_considered}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground text-center">
              Repairs with preventive uplift
            </span>
          </CardContent>
        </Card>

        {/* Card 3: Highest Preventive Repair */}
        <Card className="border-border/50">
          <CardContent className="p-4 flex flex-col items-center justify-center gap-1">
            <TrendingUp className="h-4 w-4 text-primary mb-1" />
            <span className="text-xs font-mono font-medium text-foreground text-center truncate max-w-full">
              {highestUpliftRepair?.repair_type ?? '—'}
            </span>
            <span className="text-[11px] text-muted-foreground text-center">
              Highest preventive uplift
            </span>
          </CardContent>
        </Card>
      </div>

      {/* ═══ SECTION 1: PREVENTIVE REPAIR RANKING ═══ */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              Preventive Repair Ranking
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={refresh}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {sortedRepairs.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No repairs to prioritize.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead className="text-xs w-[140px]">Repair</TableHead>
                    <TableHead className="text-xs w-[70px]">Status</TableHead>
                    <TableHead className="text-xs w-[50px]"><SortHeader label="Base" field="baseline_rank" /></TableHead>
                    <TableHead className="text-xs w-[50px]"><SortHeader label="Prev" field="preventive_rank" /></TableHead>
                    <TableHead className="text-xs w-[50px]"><SortHeader label="Δ" field="rank_delta" /></TableHead>
                    <TableHead className="text-xs w-[70px]"><SortHeader label="Score" field="preventive_score" /></TableHead>
                    <TableHead className="text-xs w-[70px]">Friction</TableHead>
                    <TableHead className="text-xs w-[80px]"><SortHeader label="Root Cause" field="root_cause_signal" /></TableHead>
                    <TableHead className="text-xs w-[80px]"><SortHeader label="Confidence" field="preventive_confidence_signal" /></TableHead>
                    <TableHead className="text-xs">Explanation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRepairs.map((r) => (
                    <TableRow
                      key={r.repair_id}
                      className="cursor-pointer hover:bg-muted/30 transition-colors border-border/30"
                      onClick={() => setSelectedRepair(r)}
                    >
                      <TableCell className="font-mono text-xs truncate max-w-[140px]">{r.repair_type}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-center">{r.baseline_rank}</TableCell>
                      <TableCell className="font-mono text-xs text-center">{r.preventive_rank}</TableCell>
                      <TableCell className="text-center">
                        <RankDelta delta={r.rank_delta} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-center">{r.preventive_score.toFixed(1)}</TableCell>
                      <TableCell className="font-mono text-xs text-center">{r.execution_friction_signal.toFixed(1)}</TableCell>
                      <TableCell>
                        <div className="w-16">
                          <Progress value={r.root_cause_signal * 100} className="h-1.5" />
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-center">
                        {Math.round(r.preventive_confidence_signal * 100)}%
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.explanation_tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                              {tag}
                            </Badge>
                          ))}
                          {r.explanation_tags.length > 3 && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                              +{r.explanation_tags.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ SECTION 2: AXIS DEBT MAP ═══ */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5" />
          Axis Debt Map
          <InfoTooltip text="Shows narrative axes under repair pressure, ranked by risk level and source repair count." />
        </h3>
        {nrf1Loading && sortedAxes.length === 0 ? (
          <Skeleton className="h-20 w-full rounded-md" />
        ) : sortedAxes.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">Axis debt map unavailable for this project.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sortedAxes.map((ax) => (
              <Card key={ax.axis} className="border-border/50">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-medium text-foreground">{ax.axis}</span>
                    <Badge variant={riskBadgeVariant(ax.risk_level)} className="text-[10px] uppercase">
                      {ax.risk_level}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-[11px] text-muted-foreground">
                    <span>Source repairs: <span className="font-mono text-foreground">{ax.source_repair_count}</span></span>
                    <span>Max confidence: <span className="font-mono text-foreground">{(ax.max_forecast_confidence * 100).toFixed(0)}%</span></span>
                  </div>
                  {ax.forecast_repair_families.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {ax.forecast_repair_families.map((f) => (
                        <Badge key={f} variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-mono">{f}</Badge>
                      ))}
                    </div>
                  )}
                  {ax.notes.length > 0 && (
                    <div className="space-y-0.5">
                      {ax.notes.map((n, i) => (
                        <p key={i} className="text-[10px] text-muted-foreground italic">{n}</p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ═══ SECTION 3: NARRATIVE PRESSURE BAR ═══ */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Narrative Pressure
          </h3>
          <InfoTooltip text="Estimated future repair pressure derived from NDG dependency propagation." />
        </div>
        <div className="relative h-3 rounded-full overflow-hidden bg-muted">
          <div className="absolute inset-0 flex">
            <div className="w-[30%] bg-emerald-500/20" />
            <div className="w-[30%] bg-amber-500/20" />
            <div className="w-[20%] bg-orange-500/20" />
            <div className="w-[20%] bg-red-500/20" />
          </div>
          <div
            className={cn('h-full rounded-full transition-all duration-500', pressureBg(pressure))}
            style={{ width: `${Math.min(pressure, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>0</span>
          <span>30</span>
          <span>60</span>
          <span>80</span>
          <span>100</span>
        </div>
      </div>

      {/* ═══ SECTION 4: PRP2 STRATEGIC REPAIR RECOMMENDATION ═══ */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Strategic Repair Recommendation
        </h3>

        {prp2Loading ? (
          <Skeleton className="h-32 w-full rounded-md" />
        ) : !prp2 ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">No strategic repair required.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Top Recommendation Card */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Recommended Repair</span>
                    </div>
                    <p className="font-mono text-xs text-foreground">{prp2.selected_repair_type}</p>
                  </div>
                  <div className="flex gap-3 text-right shrink-0">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Strategic Score</span>
                      <span className="font-mono text-sm font-bold text-foreground">{prp2.strategic_priority_score.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Confidence</span>
                      <span className="font-mono text-sm font-bold text-foreground">{Math.round(prp2.recommendation_confidence * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* Rationale */}
                {prp2.selection_rationale && (
                  <div className="border-t border-border/30 pt-2">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{prp2.selection_rationale}</p>
                  </div>
                )}

                {/* Chips row */}
                <div className="flex flex-wrap gap-3">
                  {prp2.prevented_repair_families.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Prevents</span>
                      <div className="flex flex-wrap gap-1">
                        {prp2.prevented_repair_families.map(f => (
                          <Badge key={f} variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-4">{f}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {prp2.reduced_axis_debt.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Reduces Debt On</span>
                      <div className="flex flex-wrap gap-1">
                        {prp2.reduced_axis_debt.map(a => (
                          <Badge key={a} variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4">{a}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Unlocked repairs */}
                {prp2.unlocks_repairs.length > 0 && (
                  <div className="border-t border-border/30 pt-2 space-y-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Unlock className="h-3 w-3" /> Unlocks
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {prp2.unlocks_repairs.map(r => (
                        <Badge key={r} variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4">{r}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {/* Pointer to Strategic Analysis */}
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] text-muted-foreground/70 italic">
                    Detailed comparative strategy rankings and advisory ROI are shown in Strategic Analysis below.
                  </p>
                </div>
              </CardContent>
            </Card>

      {/* ═══ SECTION 4e: PATCH PLAN BUILDER (read-only visibility) ═══ */}
      <PatchPlanSection projectId={projectId} iv={iv} prp2s={prp2s} prp2={prp2} />

      {/* ═══ SECTION 4f: PATCH PLAN VALIDATION (read-only gate) ═══ */}
      <PatchValidationSection projectId={projectId} iv={iv} prp2s={prp2s} prp2={prp2} />

      {/* ═══ SECTION 4g: PATCH EXECUTION (section-only, fail-closed) ═══ */}
      <PatchExecutionSection projectId={projectId} iv={iv} prp2s={prp2s} prp2={prp2} />

      {/* ═══ SECTION 4h: EXECUTION REPLAY (read-only historical audit) ═══ */}
      <ExecutionReplaySection projectId={projectId} iv={iv} prp2s={prp2s} prp2={prp2} />

      {/* ═══ SECTION 4i: EXECUTION ANALYTICS (read-only aggregation) ═══ */}
      <ExecutionAnalyticsSection projectId={projectId} />

      {/* ═══ SECTION 4j: EXECUTION RECOMMENDATIONS (read-only, deterministic) ═══ */}
      <ExecutionRecommendationsSection projectId={projectId} onNavigateToTrend={setTrendNavTarget} onRouteToRepairs={onRouteToRepairs} completedRepairSignatures={completedRepairSignatures} />

      {/* ═══ SECTION 4k: EXECUTION TRENDS (read-only) ═══ */}
      <ExecutionTrendsSection projectId={projectId} navigationTarget={trendNavTarget} onTargetHandled={() => setTrendNavTarget(null)} />

          </div>
        )}
      </div>

      {/* ═══ SECTION 4b: PRP2S STRATEGIC STRATEGY WITH ROI ADVISORY ═══ */}
      <PRP2SAdvisorySection prp2s={prp2s} prp2sLoading={prp2sLoading} />

      {/* ═══ SECTION 4c: INTERVENTION ENGINE (advisory-only decision layer) ═══ */}
      <InterventionCandidatesSection iv={iv} ivLoading={ivLoading} />

      {/* ═══ SECTION 4d: PATCH TARGET RESOLVER (read-only visibility) ═══ */}
      <PatchTargetSection projectId={projectId} iv={iv} prp2s={prp2s} prp2={prp2} />

      {/* ═══ SECTION 5: INTERVENTION ROI (READ-ONLY DIAGNOSTIC, collapsed by default) ═══ */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
            <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
            <Activity className="h-3.5 w-3.5" />
            <span className="uppercase tracking-wider font-semibold">Diagnostic: Raw ROI Composition</span>
            <span className="text-[9px] font-normal ml-1">— standalone ROI decomposition per repair</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <InterventionROISection roi={roi} roiLoading={roiLoading} />
        </CollapsibleContent>
      </Collapsible>

      {/* ═══ SECTION 6: ROOT CAUSE CLUSTERS ═══ */}
      <RootCauseClustersSection rcc={rcc} rccLoading={rccLoading} />

      {/* ═══ DISCLAIMER ═══ */}
      {prioritization?.prioritization_disclaimer && (
        <p className="text-[10px] text-muted-foreground/70 border-t border-border/30 pt-2">
          {prioritization.prioritization_disclaimer}
        </p>
      )}

      {/* ═══ REPAIR DETAIL MODAL ═══ */}
      <Dialog open={!!selectedRepair} onOpenChange={(open) => !open && setSelectedRepair(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selectedRepair?.repair_type}</DialogTitle>
            <DialogDescription className="text-xs">Repair detail — preventive ranking context</DialogDescription>
          </DialogHeader>
          {selectedRepair && (
            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ranking</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pl-1">
                  <Detail label="Status" value={selectedRepair.status} />
                  <Detail label="Baseline Rank" value={String(selectedRepair.baseline_rank)} />
                  <Detail label="Preventive Rank" value={String(selectedRepair.preventive_rank)} />
                  <Detail label="Rank Delta" value={`${selectedRepair.rank_delta > 0 ? '+' : ''}${selectedRepair.rank_delta}`} />
                  <Detail label="Baseline Score" value={selectedRepair.baseline_score.toFixed(2)} />
                  <Detail label="Preventive Score" value={selectedRepair.preventive_score.toFixed(2)} />
                  <Detail label="Uplift" value={selectedRepair.uplift_amount.toFixed(2)} />
                  <Detail label="Root Cause" value={selectedRepair.root_cause_signal.toFixed(3)} />
                  <Detail label="Confidence" value={`${(selectedRepair.preventive_confidence_signal * 100).toFixed(0)}%`} />
                  <Detail label="Friction" value={selectedRepair.execution_friction_signal.toFixed(1)} />
                </div>
              </div>
              {selectedRepair.forecasted_repair_families.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Forecast Families</h4>
                  <div className="flex flex-wrap gap-1 pl-1">
                    {selectedRepair.forecasted_repair_families.map((f) => (
                      <Badge key={f} variant="outline" className="text-[10px] font-mono">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {selectedRepair.explanation_tags.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Explanation Tags</h4>
                  <div className="flex flex-wrap gap-1 pl-1">
                    {selectedRepair.explanation_tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Sub-components ── */

function PRP2SAdvisorySection({ prp2s, prp2sLoading }: { prp2s: PRP2SData | null; prp2sLoading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  if (prp2sLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Strategic Analysis
        </h3>
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
    );
  }

  if (!prp2s) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Strategic Analysis
        </h3>
        <Card className="border-border/50">
          <CardContent className="py-6 text-center">
            <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">Enhanced strategy analysis unavailable.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const strat = prp2s.prp2_strategy;
  const options = strat.ranked_strategy_options;
  const notes = prp2s.scoring_notes;
  const roiMode = notes.roi_integration_mode as string | undefined;
  const roiVersion = notes.roi_version as string | undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Strategic Analysis
        </h3>
        <div className="flex items-center gap-2">
          {roiMode && (
            <Badge variant="outline" className="text-[9px] font-mono uppercase">
              ROI: {roiMode}
            </Badge>
          )}
          {roiVersion && (
            <Badge variant="secondary" className="text-[9px] font-mono">
              {roiVersion}
            </Badge>
          )}
        </div>
      </div>

      {/* Advisory notice */}
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] text-muted-foreground">
          Advisory ROI and root-cause leverage are shown for diagnostic comparison only. They do <strong>not</strong> affect the strategic priority score.
        </span>
      </div>

      {/* Axis Debt Hotspots (from PRP2S) */}
      {strat.axis_debt_hotspots && strat.axis_debt_hotspots.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Shield className="h-3 w-3" />
            Axis Debt Hotspots
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {strat.axis_debt_hotspots.map(h => (
              <Card key={h.axis} className="border-border/50">
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-medium text-foreground">{h.axis}</span>
                    <Badge variant={riskBadgeVariant(h.risk_level)} className="text-[10px] uppercase">{h.risk_level}</Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Source repairs: <span className="font-mono text-foreground">{h.source_repair_count}</span>
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Ranked options with ROI advisory columns */}
      {options.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-muted-foreground">No strategy candidates.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
               <TableHeader>
                  <TableRow className="border-border/50">
                     <TableHead className="text-xs w-[55px]">Strat #</TableHead>
                     <TableHead className="text-xs w-[55px]">ROI #</TableHead>
                     <TableHead className="text-xs w-[50px]">RC #</TableHead>
                     <TableHead className="text-xs">Repair</TableHead>
                     <TableHead className="text-xs w-[70px]">Strat Score</TableHead>
                     <TableHead className="text-xs w-[70px]">Adv. ROI</TableHead>
                     <TableHead className="text-xs w-[55px]">RC</TableHead>
                     <TableHead className="text-xs w-[70px]">Confidence</TableHead>
                     <TableHead className="text-xs w-[30px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {options.map((opt) => {
                    const isExpanded = expandedId === opt.repair_id;
                    const isTop = opt.repair_id === strat.recommended_first_repair_id;
                    return (
                      <Fragment key={opt.repair_id}>
                        <TableRow
                          className={cn(
                            'cursor-pointer hover:bg-muted/30 transition-colors border-border/30',
                            isTop && 'bg-primary/5'
                          )}
                          onClick={() => setExpandedId(isExpanded ? null : opt.repair_id)}
                        >
                          <TableCell className="font-mono text-xs text-center">{opt.strategic_rank}</TableCell>
                          <TableCell className="font-mono text-xs text-center text-muted-foreground">
                            {opt.roi_rank != null ? opt.roi_rank : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-center text-muted-foreground">
                            {opt.root_cause_rank != null ? opt.root_cause_rank : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs truncate max-w-[140px]">
                            {opt.repair_type}
                            {isTop && <Star className="h-3 w-3 text-primary inline ml-1" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-center font-bold">{opt.strategic_priority_score.toFixed(1)}</TableCell>
                          <TableCell className="text-center">
                            {opt.roi_advisory ? (
                              <ROIScoreBadge score={opt.roi_advisory.intervention_roi_score} />
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <RCLeverageBadge advisory={opt.root_cause_advisory} />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-center capitalize">{opt.recommendation_confidence}</TableCell>
                          <TableCell className="text-center">
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${opt.repair_id}-detail`} className="border-border/30 bg-muted/10">
                            <TableCell colSpan={9} className="p-3">
                              <PRP2SOptionDetail opt={opt} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scoring notes (collapsible) */}
      {notes.anti_double_counting_notes && (
        <Collapsible open={showNotes} onOpenChange={setShowNotes}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              {showNotes ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span className="uppercase tracking-wider font-semibold">Anti-Double-Counting Notes</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <Card className="border-border/50">
              <CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground leading-relaxed">{String(notes.anti_double_counting_notes)}</p>
                {notes.roi_formula_reference && (
                  <p className="text-[10px] text-muted-foreground leading-relaxed mt-2 font-mono">{String(notes.roi_formula_reference)}</p>
                )}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function PRP2SOptionDetail({ opt }: { opt: PRP2SStrategyOption }) {
  return (
    <div className="space-y-4 text-[11px]">
      {/* Signals grid */}
      <div className="space-y-1.5">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Strategic Signals</h5>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 pl-1">
          <Detail label="Importance" value={opt.current_importance_signal.toFixed(1)} />
          <Detail label="Prev. Uplift" value={opt.preventive_uplift_signal.toFixed(3)} />
          <Detail label="Root Cause" value={opt.root_cause_signal.toFixed(3)} />
          <Detail label="Path Quality" value={opt.path_quality_signal.toFixed(2)} />
          <Detail label="Path Interaction" value={opt.path_interaction_signal.toFixed(2)} />
          <Detail label="Axis Debt Reduct." value={opt.axis_debt_reduction_signal.toFixed(3)} />
          <Detail label="Friction" value={opt.execution_friction_signal.toFixed(1)} />
        </div>
      </div>

      {/* ROI Advisory detail */}
      {opt.roi_advisory && (
        <div className="space-y-1.5 border-t border-border/30 pt-3">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            Advisory ROI Components
            <Badge variant="outline" className="text-[8px] font-normal">Does not affect strategic score</Badge>
          </h5>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 pl-1">
            <Detail label="Prevented Downstream" value={opt.roi_advisory.roi_components.prevented_downstream_pressure.toFixed(1)} />
            <Detail label="Stability Gain" value={opt.roi_advisory.roi_components.projected_stability_gain.toFixed(1)} />
            <Detail label="Execution Friction" value={opt.roi_advisory.roi_components.execution_friction.toFixed(1)} />
            <Detail label="Blast Radius" value={opt.roi_advisory.roi_components.blast_radius.toFixed(1)} />
          </div>
          <p className="text-[10px] text-muted-foreground italic pl-1">{opt.roi_advisory.rationale}</p>
        </div>
      )}

      {/* Root-Cause Leverage Advisory detail */}
      {opt.root_cause_advisory?.in_cluster && (
        <div className="space-y-1.5 border-t border-border/30 pt-3">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            Root-Cause Cluster
            <Badge variant="outline" className="text-[8px] font-normal">Advisory only</Badge>
          </h5>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 pl-1">
            <Detail label="Cluster ID" value={opt.root_cause_advisory.cluster_id ?? '—'} />
            <Detail label="Primary Axis" value={opt.root_cause_advisory.cluster_primary_axis ?? '—'} />
            <Detail label="Combined Pressure" value={opt.root_cause_advisory.cluster_combined_pressure?.toFixed(2) ?? '—'} />
            <Detail label="Cluster Confidence" value={opt.root_cause_advisory.cluster_confidence != null ? `${Math.round(opt.root_cause_advisory.cluster_confidence * 100)}%` : '—'} />
            <Detail label="Cluster Size" value={String(opt.root_cause_advisory.cluster_repair_count ?? '—')} />
            <Detail label="Leverage Score" value={opt.root_cause_advisory.root_cause_leverage_score?.toFixed(1) ?? '—'} />
          </div>
        </div>
      )}
      {opt.rationale_tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {opt.rationale_tags.map(t => (
            <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}


function InterventionROISection({ roi, roiLoading }: { roi: InterventionROIData | null; roiLoading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFormula, setShowFormula] = useState(false);

  if (roiLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
    );
  }

  if (!roi) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-6 text-center">
          <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">Intervention ROI analysis unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  const repairs = roi.ranked_repairs;

  return (
    <div className="space-y-3">
      {/* Summary header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Version</span>
            <span className="font-mono text-sm font-medium text-foreground">{roi.roi_version}</span>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Candidates</span>
            <span className="font-mono text-sm font-bold text-foreground">{roi.project_context.candidate_repair_count}</span>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Blast Radius</span>
            <Badge variant={roi.blast_radius_available ? 'default' : 'secondary'} className="text-[10px]">
              {roi.blast_radius_available ? 'Available' : 'Unavailable'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Formula notes (collapsible) */}
      <Collapsible open={showFormula} onOpenChange={setShowFormula}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            {showFormula ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="uppercase tracking-wider font-semibold">Formula Notes</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Card className="border-border/50">
            <CardContent className="p-3 space-y-1.5">
              {Object.entries(roi.roi_formula_notes).map(([key, desc]) => (
                <div key={key}>
                  <span className="text-[10px] font-mono font-medium text-foreground">{key}</span>
                  <p className="text-[10px] text-muted-foreground leading-snug">{desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Ranked repairs */}
      {repairs.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-muted-foreground">No repair candidates for ROI analysis.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead className="text-xs w-[40px]">Rank</TableHead>
                    <TableHead className="text-xs">Repair</TableHead>
                    <TableHead className="text-xs w-[60px]">Scope</TableHead>
                    <TableHead className="text-xs w-[70px]">ROI</TableHead>
                    <TableHead className="text-xs">Rationale</TableHead>
                    <TableHead className="text-xs w-[30px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repairs.map((r, idx) => {
                    const isExpanded = expandedId === r.repair_id;
                    return (
                      <Fragment key={r.repair_id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/30 transition-colors border-border/30"
                          onClick={() => setExpandedId(isExpanded ? null : r.repair_id)}
                        >
                          <TableCell className="font-mono text-xs text-center">{idx + 1}</TableCell>
                          <TableCell className="font-mono text-xs truncate max-w-[140px]">{r.repair_type}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground font-mono">
                            {r.scope_key ?? '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            <ROIScoreBadge score={r.intervention_roi_score} />
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">{r.rationale}</TableCell>
                          <TableCell className="text-center">
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${r.repair_id}-detail`} className="border-border/30 bg-muted/10">
                            <TableCell colSpan={6} className="p-3">
                              <ROIDetailBlock entry={r} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ROIScoreBadge({ score }: { score: number }) {
  const color = score >= 40 ? 'text-emerald-400' : score >= 10 ? 'text-amber-400' : score >= -10 ? 'text-muted-foreground' : 'text-red-400';
  return <span className={cn('font-mono text-xs font-bold', color)}>{score.toFixed(1)}</span>;
}

function RCLeverageBadge({ advisory }: { advisory: PRP2SRootCauseAdvisory | undefined }) {
  if (!advisory?.in_cluster || !advisory.root_cause_leverage_label) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const label = advisory.root_cause_leverage_label;
  const color = label === 'high' ? 'text-red-400' : label === 'medium' ? 'text-amber-400' : 'text-muted-foreground';
  return <span className={cn('font-mono text-[10px] font-bold uppercase', color)}>{label}</span>;
}

function ROIDetailBlock({ entry }: { entry: ROIRepairEntry }) {
  const c = entry.roi_components;
  const s = entry.supporting_signals;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[11px]">
      <div className="space-y-1.5">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ROI Components</h5>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 pl-1">
          <Detail label="Prevented Downstream" value={c.prevented_downstream_pressure.toFixed(1)} />
          <Detail label="Stability Gain" value={c.projected_stability_gain.toFixed(1)} />
          <Detail label="Execution Friction" value={c.execution_friction.toFixed(1)} />
          <Detail label="Blast Radius" value={c.blast_radius != null ? c.blast_radius.toFixed(1) : 'N/A'} />
        </div>
      </div>
      <div className="space-y-1.5">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Supporting Signals</h5>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 pl-1">
          <Detail label="Preventive Value" value={s.repair_preventive_value.toFixed(3)} />
          <Detail label="Forecast Confidence" value={s.forecast_confidence.toFixed(3)} />
          <Detail label="Stability Gain (raw)" value={s.expected_stability_gain.toFixed(1)} />
          <Detail label="Net Priority" value={s.net_priority_score.toFixed(1)} />
          <Detail label="Friction (raw)" value={s.execution_friction_score.toFixed(1)} />
          <Detail label="Root Cause" value={s.root_cause_score.toFixed(3)} />
          <Detail label="Blast Risk" value={s.blast_risk_score.toFixed(1)} />
        </div>
      </div>
    </div>
  );
}

function RankDelta({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-400 font-mono text-xs">
        <ArrowUp className="h-3 w-3" />+{delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-400 font-mono text-xs">
        <ArrowDown className="h-3 w-3" />{delta}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground font-mono text-xs">
      <Minus className="h-3 w-3" />0
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-mono font-medium text-foreground">{value}</p>
    </div>
  );
}

/* ── Intervention Candidates Section ── */

function InterventionLabelBadge({ label }: { label: "high" | "medium" | "low" }) {
  const color = label === 'high' ? 'text-red-400' : label === 'medium' ? 'text-amber-400' : 'text-muted-foreground';
  return <span className={cn('font-mono text-[10px] font-bold uppercase', color)}>{label}</span>;
}

function InterventionCandidatesSection({ iv, ivLoading }: { iv: InterventionAnalysisResult | null; ivLoading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Interventions
        </h3>
        {iv && (
          <Badge variant="secondary" className="text-[9px] font-mono">
            {iv.version}
          </Badge>
        )}
      </div>

      {/* Advisory notice */}
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] text-muted-foreground">
          Intervention score is advisory-only and does <strong>not</strong> modify PRP2S strategic scoring.
          It combines strategic priority (40%), ROI (30%), and root-cause leverage (30%).
        </span>
      </div>

      {ivLoading ? (
        <Skeleton className="h-32 w-full rounded-md" />
      ) : !iv ? (
        <Card className="border-border/50">
          <CardContent className="py-6 text-center">
            <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">Intervention analysis unavailable.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Recommended intervention card */}
          {iv.recommended_intervention_repair_id && iv.interventions.length > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Recommended Intervention</span>
                    </div>
                    <p className="font-mono text-xs text-foreground">{iv.interventions[0].repair_type}</p>
                  </div>
                  <div className="flex gap-3 text-right shrink-0">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Intervention</span>
                      <span className="font-mono text-sm font-bold text-foreground">{iv.interventions[0].intervention_score.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Label</span>
                      <InterventionLabelBadge label={iv.interventions[0].intervention_label} />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 border-t border-border/30 pt-2">
                  {iv.interventions[0].rationale_tags.map(t => (
                    <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{t}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ranked interventions table */}
          {iv.interventions.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="py-6 text-center">
                <p className="text-xs text-muted-foreground">No intervention candidates.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50">
                        <TableHead className="text-xs w-[40px]">#</TableHead>
                        <TableHead className="text-xs">Repair</TableHead>
                        <TableHead className="text-xs w-[70px]">IV Score</TableHead>
                        <TableHead className="text-xs w-[55px]">Strat #</TableHead>
                        <TableHead className="text-xs w-[55px]">ROI #</TableHead>
                        <TableHead className="text-xs w-[50px]">RC #</TableHead>
                        <TableHead className="text-xs w-[55px]">Label</TableHead>
                        <TableHead className="text-xs w-[30px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {iv.interventions.map((c, idx) => {
                        const isExpanded = expandedId === c.repair_id;
                        const isTop = c.repair_id === iv.recommended_intervention_repair_id;
                        return (
                          <Fragment key={c.repair_id}>
                            <TableRow
                              className={cn(
                                'cursor-pointer hover:bg-muted/30 transition-colors border-border/30',
                                isTop && 'bg-primary/5'
                              )}
                              onClick={() => setExpandedId(isExpanded ? null : c.repair_id)}
                            >
                              <TableCell className="font-mono text-xs text-center">{idx + 1}</TableCell>
                              <TableCell className="font-mono text-xs truncate max-w-[140px]">
                                {c.repair_type}
                                {isTop && <Star className="h-3 w-3 text-primary inline ml-1" />}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-center font-bold">{c.intervention_score.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs text-center text-muted-foreground">{c.strategic_rank}</TableCell>
                              <TableCell className="font-mono text-xs text-center text-muted-foreground">{c.roi_rank ?? '—'}</TableCell>
                              <TableCell className="font-mono text-xs text-center text-muted-foreground">{c.root_cause_rank ?? '—'}</TableCell>
                              <TableCell className="text-center"><InterventionLabelBadge label={c.intervention_label} /></TableCell>
                              <TableCell className="text-center">
                                {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`${c.repair_id}-iv-detail`} className="border-border/30 bg-muted/10">
                                <TableCell colSpan={8} className="p-3">
                                  <InterventionDetail candidate={c} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function InterventionDetail({ candidate: c }: { candidate: InterventionCandidate }) {
  const s = c.supporting_signals;
  return (
    <div className="space-y-4 text-[11px]">
      <div className="space-y-1.5">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Composite Scores</h5>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 pl-1">
          <Detail label="Strategic Priority" value={c.strategic_priority_score.toFixed(2)} />
          <Detail label="ROI Score" value={c.intervention_roi_score?.toFixed(1) ?? '—'} />
          <Detail label="RC Leverage" value={c.root_cause_leverage_score?.toFixed(1) ?? '—'} />
          <Detail label="Intervention" value={c.intervention_score.toFixed(1)} />
        </div>
      </div>
      <div className="space-y-1.5 border-t border-border/30 pt-3">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Supporting Signals</h5>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 pl-1">
          <Detail label="Prev. Downstream" value={s.prevented_downstream_pressure?.toFixed(1) ?? '—'} />
          <Detail label="Stability Gain" value={s.projected_stability_gain?.toFixed(1) ?? '—'} />
          <Detail label="Exec. Friction" value={s.execution_friction?.toFixed(1) ?? '—'} />
          <Detail label="Blast Radius" value={s.blast_radius?.toFixed(1) ?? '—'} />
          <Detail label="Cluster Pressure" value={s.cluster_combined_pressure?.toFixed(2) ?? '—'} />
          <Detail label="Cluster Confidence" value={s.cluster_confidence != null ? `${Math.round(s.cluster_confidence * 100)}%` : '—'} />
          <Detail label="Cluster Size" value={String(s.cluster_repair_count ?? '—')} />
        </div>
      </div>
      {c.rationale_tags.length > 0 && (
        <div className="space-y-1.5 border-t border-border/30 pt-3">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rationale</h5>
          <div className="flex flex-wrap gap-1">
            {c.rationale_tags.map(t => (
              <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{t}</Badge>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic pl-1">{c.rationale_summary}</p>
        </div>
      )}
    </div>
  );
}

/* ── Root Cause Clusters Section ── */

function RootCauseClustersSection({ rcc, rccLoading }: { rcc: RootCauseAnalysisResult | null; rccLoading: boolean }) {
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Target className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wider font-semibold">Root Cause Clusters</span>
          {rcc && (
            <Badge variant="secondary" className="text-[9px] font-mono ml-1">
              {rcc.cluster_count} cluster{rcc.cluster_count !== 1 ? 's' : ''}
            </Badge>
          )}
          <span className="text-[9px] font-normal ml-1">— repairs grouped by shared upstream cause</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        {rccLoading ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : !rcc ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">Root cause analysis unavailable.</p>
            </CardContent>
          </Card>
        ) : rcc.clusters.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">No root cause clusters detected — repairs appear independent.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground">
                Clusters identify repairs sharing upstream causes. Addressing the root cause may resolve multiple repairs simultaneously.
                <span className="ml-1 font-mono">{rcc.version}</span>
              </span>
            </div>

            <div className="space-y-2">
              {rcc.clusters.map((cluster) => {
                const isExpanded = expandedCluster === cluster.cluster_id;
                return (
                  <Card key={cluster.cluster_id} className="border-border/50">
                    <CardContent className="p-0">
                      <button
                        className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/20 transition-colors"
                        onClick={() => setExpandedCluster(isExpanded ? null : cluster.cluster_id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-semibold text-foreground">{cluster.primary_axis}</span>
                              <Badge variant="outline" className="text-[9px] font-mono">{cluster.repair_count} repairs</Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {cluster.shared_axes.slice(0, 3).map(ax => (
                                <Badge key={ax} variant="secondary" className="text-[8px] font-mono px-1 py-0 h-3.5">{ax}</Badge>
                              ))}
                              {cluster.shared_axes.length > 3 && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">+{cluster.shared_axes.length - 3}</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <span className="text-[10px] text-muted-foreground block">Pressure</span>
                            <span className={cn('font-mono text-xs font-bold', pressureColor(Math.min(100, cluster.combined_pressure * 10)))}>{cluster.combined_pressure.toFixed(1)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-muted-foreground block">Confidence</span>
                            <span className="font-mono text-xs font-bold text-foreground">{Math.round(cluster.cluster_confidence * 100)}%</span>
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-0 border-t border-border/30 space-y-2">
                          <div className="space-y-1">
                            <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Involved Repairs</h5>
                            <div className="flex flex-wrap gap-1">
                              {cluster.involved_repairs.map(id => (
                                <Badge key={id} variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4">{id}</Badge>
                              ))}
                            </div>
                          </div>
                          {cluster.repair_families.length > 0 && (
                            <div className="space-y-1">
                              <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Repair Families</h5>
                              <div className="flex flex-wrap gap-1">
                                {cluster.repair_families.map(fam => (
                                  <Badge key={fam} variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-4">{fam}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {cluster.shared_axes.length > 0 && (
                            <div className="space-y-1">
                              <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shared Axes</h5>
                              <div className="flex flex-wrap gap-1">
                                {cluster.shared_axes.map(ax => (
                                  <Badge key={ax} variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4">{ax}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {rcc.unclustered_repairs.length > 0 && (
              <div className="space-y-1">
                <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unclustered Repairs ({rcc.unclustered_repairs.length})</h5>
                <div className="flex flex-wrap gap-1">
                  {rcc.unclustered_repairs.map(id => (
                    <Badge key={id} variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4 text-muted-foreground">{id}</Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── PatchTargetSection — read-only patch target visibility ──

function PatchTargetSection({
  projectId,
  iv,
  prp2s,
  prp2,
}: {
  projectId: string | undefined;
  iv: InterventionAnalysisResult | null;
  prp2s: PRP2SData | null;
  prp2: PRP2Data | null;
}) {
  const [ptResult, setPtResult] = useState<PatchTargetResolutionResult | null>(null);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptSource, setPtSource] = useState<string>("none");

  useEffect(() => {
    if (!projectId) return;

    // Priority: intervention → prp2s → prp2
    let repairId: string | null = null;
    let sourceType: "intervention" | "prp2s" | "arp1" | "manual" = "manual";
    let sourceLabel = "none";

    if (iv?.recommended_intervention_repair_id) {
      repairId = iv.recommended_intervention_repair_id;
      sourceType = "intervention";
      sourceLabel = "Intervention Engine";
    } else if (prp2s?.prp2_strategy?.recommended_first_repair_id) {
      repairId = prp2s.prp2_strategy.recommended_first_repair_id;
      sourceType = "prp2s";
      sourceLabel = "PRP2S Strategy";
    } else if (prp2?.selected_repair_id) {
      repairId = prp2.selected_repair_id;
      sourceType = "arp1";
      sourceLabel = "PRP2 Strategy";
    }

    if (!repairId) {
      setPtResult(null);
      setPtSource("none");
      return;
    }

    setPtLoading(true);
    setPtSource(sourceLabel);
    fetchPatchTargets(projectId, repairId, undefined, sourceType)
      .then(r => setPtResult(r))
      .catch(() => setPtResult(null))
      .finally(() => setPtLoading(false));
  }, [projectId, iv?.recommended_intervention_repair_id, prp2s?.prp2_strategy?.recommended_first_repair_id, prp2?.selected_repair_id]);

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Target className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Patch Targets</span>
          {ptResult && <Badge variant="outline" className="text-[9px] ml-1 font-mono">{ptResult.resolved_targets.length} target{ptResult.resolved_targets.length !== 1 ? 's' : ''}</Badge>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {/* Advisory notice */}
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground">
            Patch targets are resolved read-only. No execution, no mutations. Source: <strong>{ptSource}</strong>.
          </span>
        </div>

        {ptLoading ? (
          <Skeleton className="h-20 w-full rounded-md" />
        ) : !ptResult || ptResult.resolved_targets.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {ptSource === "none" ? "No recommended repair available to resolve targets." : "No patch targets resolved."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Resolution notes */}
            {ptResult.resolution_notes.fallback_used && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-[10px] text-amber-400">
                  Fallback to document-level: {ptResult.resolution_notes.fallback_reason}
                </span>
              </div>
            )}

            <Card className="border-border/50">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50">
                        <TableHead className="text-xs w-[80px]">Type</TableHead>
                        <TableHead className="text-xs">Doc Type</TableHead>
                        <TableHead className="text-xs">Identifier</TableHead>
                        <TableHead className="text-xs w-[100px]">Method</TableHead>
                        <TableHead className="text-xs w-[70px]">Confidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ptResult.resolved_targets.map(t => (
                        <TableRow key={t.target_id} className="border-border/30">
                          <TableCell>
                            <Badge
                              variant={t.target_type === 'document' ? 'secondary' : t.target_type === 'section' ? 'default' : 'outline'}
                              className="text-[9px] font-mono uppercase px-1.5 py-0 h-4"
                            >
                              {t.target_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-foreground">{t.doc_type}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {t.section_key || (t.episode_number != null ? `ep ${t.episode_number}` : t.scene_key || '—')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4">
                              {t.targeting_method.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={t.targeting_confidence === 'high' ? 'default' : t.targeting_confidence === 'medium' ? 'secondary' : 'outline'}
                              className="text-[9px] font-mono uppercase px-1.5 py-0 h-4"
                            >
                              {t.targeting_confidence}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Strategy + version binding metadata */}
            <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
              <span>Strategy: <span className="font-mono text-foreground">{ptResult.resolution_notes.chosen_strategy}</span></span>
              <span>Binding: <span className="font-mono text-foreground">{ptResult.resolution_notes.version_binding_mode}</span></span>
              <span>Docs: <span className="font-mono text-foreground">{ptResult.resolution_notes.doc_types_considered.join(', ') || '—'}</span></span>
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── PatchPlanSection — read-only patch plan visibility ──

function PatchPlanSection({
  projectId,
  iv,
  prp2s,
  prp2,
}: {
  projectId: string | undefined;
  iv: InterventionAnalysisResult | null;
  prp2s: PRP2SData | null;
  prp2: PRP2Data | null;
}) {
  const [ppResult, setPpResult] = useState<PatchPlanBuildResult | null>(null);
  const [ppLoading, setPpLoading] = useState(false);
  const [ppSource, setPpSource] = useState<string>("none");

  useEffect(() => {
    if (!projectId) return;

    let repairId: string | null = null;
    let sourceType: "intervention" | "prp2s" | "arp1" | "manual" = "manual";
    let sourceLabel = "none";

    if (iv?.recommended_intervention_repair_id) {
      repairId = iv.recommended_intervention_repair_id;
      sourceType = "intervention";
      sourceLabel = "Intervention Engine";
    } else if (prp2s?.prp2_strategy?.recommended_first_repair_id) {
      repairId = prp2s.prp2_strategy.recommended_first_repair_id;
      sourceType = "prp2s";
      sourceLabel = "PRP2S Strategy";
    } else if (prp2?.selected_repair_id) {
      repairId = prp2.selected_repair_id;
      sourceType = "arp1";
      sourceLabel = "PRP2 Strategy";
    }

    if (!repairId) {
      setPpResult(null);
      setPpSource("none");
      return;
    }

    setPpLoading(true);
    setPpSource(sourceLabel);
    fetchPatchPlan(projectId, repairId, undefined, sourceType)
      .then(r => setPpResult(r))
      .catch(() => setPpResult(null))
      .finally(() => setPpLoading(false));
  }, [projectId, iv?.recommended_intervention_repair_id, prp2s?.prp2_strategy?.recommended_first_repair_id, prp2?.selected_repair_id]);

  const plan = ppResult?.patch_plan;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Activity className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Patch Plan</span>
          {plan && (
            <Badge variant="outline" className="text-[9px] ml-1 font-mono">
              {plan.execution_mode.replace(/_/g, ' ')}
            </Badge>
          )}
          {plan?.stale && (
            <Badge variant="destructive" className="text-[9px] ml-1 font-mono">STALE</Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {/* Advisory notice */}
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground">
            Patch plan is advisory-only and read-only. No execution, no mutations. Source: <strong>{ppSource}</strong>.
          </span>
        </div>

        {ppLoading ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : !plan ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {ppSource === "none" ? "No recommended repair available to build plan." : "No patch plan generated."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Planning notes fallback warning */}
            {ppResult?.planning_notes?.fallback_used && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-[10px] text-amber-400">
                  Fallback used: {ppResult.planning_notes.fallback_reason}
                </span>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{plan.direct_targets.length}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Direct Targets</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{plan.protected_targets.length}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Protected</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{plan.downstream_regeneration.length}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Downstream</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{plan.revalidation_plan.revalidation_targets.length}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Revalidation</div>
                </CardContent>
              </Card>
            </div>

            {/* Downstream impact table */}
            {plan.downstream_regeneration.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Downstream Impact</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-xs">Doc Type</TableHead>
                          <TableHead className="text-xs w-[110px]">Impact</TableHead>
                          <TableHead className="text-xs w-[100px]">Edge</TableHead>
                          <TableHead className="text-xs w-[80px]">Reval</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.downstream_regeneration.map(ds => (
                          <TableRow key={ds.doc_type} className="border-border/30">
                            <TableCell className="text-xs font-mono text-foreground">{ds.doc_type}</TableCell>
                            <TableCell>
                              <Badge
                                variant={ds.impact_type === 'regeneration_required' ? 'destructive' : ds.impact_type === 'review_required' ? 'secondary' : 'outline'}
                                className="text-[9px] font-mono px-1.5 py-0 h-4"
                              >
                                {ds.impact_type.replace(/_/g, ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[10px] font-mono text-muted-foreground">{ds.dependency_edge || '—'}</TableCell>
                            <TableCell className="text-[10px] font-mono text-muted-foreground">{ds.revalidation_policy || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Revalidation targets */}
            {plan.revalidation_plan.revalidation_targets.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revalidation Targets</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-xs">Doc Type</TableHead>
                          <TableHead className="text-xs w-[120px]">Type</TableHead>
                          <TableHead className="text-xs w-[80px]">Priority</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.revalidation_plan.revalidation_targets.map(rt => (
                          <TableRow key={rt.doc_type} className="border-border/30">
                            <TableCell className="text-xs font-mono text-foreground">{rt.doc_type}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4">
                                {rt.revalidation_type.replace(/_/g, ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={rt.priority === 'immediate' ? 'destructive' : 'secondary'}
                                className="text-[9px] font-mono px-1.5 py-0 h-4"
                              >
                                {rt.priority}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Planning metadata */}
            <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
              <span>Mode: <span className="font-mono text-foreground">{plan.execution_mode.replace(/_/g, ' ')}</span></span>
              <span>Lane: <span className="font-mono text-foreground">{plan.lane || '—'}</span></span>
              <span>Strategy: <span className="font-mono text-foreground">{ppResult?.planning_notes?.target_resolution_source || '—'}</span></span>
              {plan.revalidation_plan.downstream_invalidation_triggered && (
                <Badge variant="destructive" className="text-[9px] font-mono px-1.5 py-0 h-4">downstream invalidation</Badge>
              )}
            </div>

            {/* Guardrails + preserve_entities */}
            {(plan.guardrails.length > 0 || plan.preserve_entities.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {plan.guardrails.map(g => (
                  <Badge key={g} variant="outline" className="text-[9px] font-mono">{g}</Badge>
                ))}
                {plan.preserve_entities.map(e => (
                  <Badge key={e} variant="secondary" className="text-[9px] font-mono">preserve: {e}</Badge>
                ))}
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── PatchValidationSection — read-only patch plan validation gate ──

function PatchValidationSection({
  projectId,
  iv,
  prp2s,
  prp2,
}: {
  projectId: string | undefined;
  iv: InterventionAnalysisResult | null;
  prp2s: PRP2SData | null;
  prp2: PRP2Data | null;
}) {
  const [valResult, setValResult] = useState<PatchPlanValidationResponse | null>(null);
  const [valLoading, setValLoading] = useState(false);
  const [valSource, setValSource] = useState<string>("none");

  useEffect(() => {
    if (!projectId) return;

    let repairId: string | null = null;
    let sourceType: "intervention" | "prp2s" | "arp1" | "manual" = "manual";
    let sourceLabel = "none";

    if (iv?.recommended_intervention_repair_id) {
      repairId = iv.recommended_intervention_repair_id;
      sourceType = "intervention";
      sourceLabel = "Intervention Engine";
    } else if (prp2s?.prp2_strategy?.recommended_first_repair_id) {
      repairId = prp2s.prp2_strategy.recommended_first_repair_id;
      sourceType = "prp2s";
      sourceLabel = "PRP2S Strategy";
    } else if (prp2?.selected_repair_id) {
      repairId = prp2.selected_repair_id;
      sourceType = "arp1";
      sourceLabel = "PRP2 Strategy";
    }

    if (!repairId) {
      setValResult(null);
      setValSource("none");
      return;
    }

    setValLoading(true);
    setValSource(sourceLabel);
    fetchPatchPlanValidation(projectId, repairId, undefined, sourceType)
      .then(r => setValResult(r))
      .catch(() => setValResult(null))
      .finally(() => setValLoading(false));
  }, [projectId, iv?.recommended_intervention_repair_id, prp2s?.prp2_strategy?.recommended_first_repair_id, prp2?.selected_repair_id]);

  const validation = valResult?.validation;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Shield className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Patch Validation</span>
          {validation && (
            validation.plan_valid ? (
              <Badge variant="outline" className="text-[9px] ml-1 font-mono text-emerald-400 border-emerald-500/30">VALID</Badge>
            ) : validation.stale ? (
              <Badge variant="destructive" className="text-[9px] ml-1 font-mono">STALE</Badge>
            ) : (
              <Badge variant="destructive" className="text-[9px] ml-1 font-mono">INVALID</Badge>
            )
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground">
            Read-only validation gate. Source: <strong>{valSource}</strong>.
          </span>
        </div>

        {valLoading ? (
          <Skeleton className="h-20 w-full rounded-md" />
        ) : !validation ? (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {valSource === "none" ? "No recommended repair available for validation." : "Validation unavailable."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Status + counts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  {validation.plan_valid ? (
                    <CheckCircle className="h-5 w-5 mx-auto text-emerald-400" />
                  ) : (
                    <XCircle className="h-5 w-5 mx-auto text-red-400" />
                  )}
                  <div className="text-[9px] text-muted-foreground uppercase mt-1">
                    {validation.plan_valid ? 'Valid' : validation.stale ? 'Stale' : 'Invalid'}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{validation.direct_targets_valid}/{validation.direct_targets_checked}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Direct Valid</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{validation.protected_targets_valid}/{validation.protected_targets_checked}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Protected Valid</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{validation.issues.length}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Issues</div>
                </CardContent>
              </Card>
            </div>

            {/* Issues table */}
            {validation.issues.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Validation Issues</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-xs w-[70px]">Severity</TableHead>
                          <TableHead className="text-xs w-[140px]">Code</TableHead>
                          <TableHead className="text-xs">Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validation.issues.map((issue, idx) => (
                          <TableRow key={`${issue.code}-${issue.target_id}-${idx}`} className="border-border/30">
                            <TableCell>
                              <Badge
                                variant={issue.severity === 'error' ? 'destructive' : 'secondary'}
                                className="text-[9px] font-mono px-1.5 py-0 h-4"
                              >
                                {issue.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-foreground">{issue.code}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{issue.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Validation notes */}
            <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
              <span>Hash: <span className="font-mono text-foreground">{validation.validation_notes.hash_check_performed ? '✓' : '—'}</span></span>
              <span>Version: <span className="font-mono text-foreground">{validation.validation_notes.version_check_performed ? '✓' : '—'}</span></span>
              <span>Lock: <span className="font-mono text-foreground">{validation.validation_notes.lock_check_performed ? '✓' : '—'}</span></span>
              {validation.validation_notes.fallback_used && (
                <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/30">fallback: {validation.validation_notes.fallback_reason}</Badge>
              )}
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── PatchExecutionSection — section-only patch execution with dry-run support ──

function PatchExecutionSection({
  projectId,
  iv,
  prp2s,
  prp2,
}: {
  projectId: string | undefined;
  iv: InterventionAnalysisResult | null;
  prp2s: PRP2SData | null;
  prp2: PRP2Data | null;
}) {
  const [execResult, setExecResult] = useState<PatchExecutionResponse | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [execSource, setExecSource] = useState<string>("none");

  // Resolve recommended repair using same priority as other sections
  const resolvedRepair = useMemo(() => {
    let repairId: string | null = null;
    let sourceType: "intervention" | "prp2s" | "arp1" | "manual" = "manual";
    let sourceLabel = "none";

    if (iv?.recommended_intervention_repair_id) {
      repairId = iv.recommended_intervention_repair_id;
      sourceType = "intervention";
      sourceLabel = "Intervention Engine";
    } else if (prp2s?.prp2_strategy?.recommended_first_repair_id) {
      repairId = prp2s.prp2_strategy.recommended_first_repair_id;
      sourceType = "prp2s";
      sourceLabel = "PRP2S Strategy";
    } else if (prp2?.selected_repair_id) {
      repairId = prp2.selected_repair_id;
      sourceType = "arp1";
      sourceLabel = "PRP2 Strategy";
    }

    return { repairId, sourceType, sourceLabel };
  }, [iv, prp2s, prp2]);

  const handleDryRun = async () => {
    if (!projectId || !resolvedRepair.repairId) return;
    setExecLoading(true);
    setExecSource(resolvedRepair.sourceLabel);
    try {
      const result = await fetchPatchExecution(
        projectId,
        resolvedRepair.repairId,
        undefined,
        resolvedRepair.sourceType,
        undefined,
        true, // dryRun
      );
      setExecResult(result);
    } catch {
      setExecResult(null);
    } finally {
      setExecLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!projectId || !resolvedRepair.repairId) return;
    setExecLoading(true);
    setExecSource(resolvedRepair.sourceLabel);
    try {
      const result = await fetchPatchExecution(
        projectId,
        resolvedRepair.repairId,
        undefined,
        resolvedRepair.sourceType,
        undefined,
        false, // real execution
      );
      setExecResult(result);
    } catch {
      setExecResult(null);
    } finally {
      setExecLoading(false);
    }
  };

  const execution = execResult?.execution;
  const hasRepair = !!resolvedRepair.repairId;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Zap className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Patch Execution</span>
          {execution && (
            execution.executed && !execution.dry_run ? (
              <Badge variant="outline" className="text-[9px] ml-1 font-mono text-emerald-400 border-emerald-500/30">EXECUTED</Badge>
            ) : execution.dry_run ? (
              <Badge variant="outline" className="text-[9px] ml-1 font-mono text-blue-400 border-blue-500/30">DRY RUN</Badge>
            ) : !execution.execution_allowed ? (
              <Badge variant="destructive" className="text-[9px] ml-1 font-mono">BLOCKED</Badge>
            ) : null
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground">
            Section-only execution engine v1. Source: <strong>{execSource !== "none" ? execSource : resolvedRepair.sourceLabel}</strong>.
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDryRun}
            disabled={!hasRepair || execLoading}
            className="text-xs"
          >
            <Play className="h-3 w-3 mr-1" />
            {execLoading ? 'Running…' : 'Dry Run Patch'}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleExecute}
            disabled={!hasRepair || execLoading}
            className="text-xs"
          >
            <Zap className="h-3 w-3 mr-1" />
            {execLoading ? 'Executing…' : 'Execute Patch'}
          </Button>
        </div>

        {!hasRepair && !execution && (
          <Card className="border-border/50">
            <CardContent className="py-6 text-center">
              <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">No recommended repair available for execution.</p>
            </CardContent>
          </Card>
        )}

        {execLoading && <Skeleton className="h-20 w-full rounded-md" />}

        {execution && !execLoading && (
          <>
            {/* Status grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  {execution.execution_allowed ? (
                    <CheckCircle className="h-5 w-5 mx-auto text-emerald-400" />
                  ) : (
                    <XCircle className="h-5 w-5 mx-auto text-red-400" />
                  )}
                  <div className="text-[9px] text-muted-foreground uppercase mt-1">
                    {execution.execution_allowed ? 'Allowed' : 'Blocked'}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{execution.direct_targets_executed}/{execution.direct_targets_attempted}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Sections</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">
                    {execution.documents_executed != null ? `${execution.documents_executed}/${execution.documents_attempted}` : execution.direct_targets_failed}
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase">
                    {execution.documents_executed != null ? 'Documents' : 'Failed'}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{execution.dry_run ? 'Yes' : 'No'}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Dry Run</div>
                </CardContent>
              </Card>
            </div>

            {/* Document-level summary (v1.1) */}
            {execution.documents_attempted != null && execution.documents_attempted > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
                  <span>Docs attempted: <span className="font-mono text-foreground">{execution.documents_attempted}</span></span>
                  <span>Docs executed: <span className="font-mono text-foreground">{execution.documents_executed}</span></span>
                  {(execution.document_sequences_failed ?? 0) > 0 && (
                    <Badge variant="destructive" className="text-[9px] font-mono">{execution.document_sequences_failed} sequence(s) failed</Badge>
                  )}
                  {(execution.documents_skipped_due_to_upstream_failure ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/30">{execution.documents_skipped_due_to_upstream_failure} blocked by upstream</Badge>
                  )}
                  {execution.direct_targets_attempted > 1 && (
                    <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground border-border/50">multi-section</Badge>
                  )}
                  {(execution.document_execution_order?.length ?? 0) > 1 && (
                    <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground border-border/50">multi-document</Badge>
                  )}
                </div>

                {/* Blocked downstream documents */}
                {execution.blocked_doc_types && execution.blocked_doc_types.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-[10px] text-amber-400 space-y-1">
                      <div className="font-semibold">Dependency-linked downstream documents skipped</div>
                      <div className="text-amber-300/80">These documents depend on a document that failed. They were not executed in this run to prevent inconsistent state. No versions were created. Re-run after fixing the upstream failure.</div>
                      <div className="space-y-0.5 pt-0.5">
                        {execution.blocked_doc_types.map((dt, i) => (
                          <div key={`blocked-dt-${i}`} className="font-mono">{dt}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Document execution order */}
                {execution.document_execution_metadata && execution.document_execution_metadata.length > 1 && (
                  <div className="rounded-md border border-border/30 px-2.5 py-1.5 space-y-1">
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase">Execution Order</div>
                    {execution.document_execution_metadata.map((dm, i) => (
                      <div key={`doc-order-${i}`} className="flex items-center gap-2 text-[10px]">
                        <span className="font-mono text-muted-foreground w-4 text-right">{dm.order_index + 1}.</span>
                        <span className="font-mono text-foreground">{dm.doc_type}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[8px] font-mono px-1 py-0 h-3.5",
                            dm.ordering_basis === "dependency_registry" ? "text-blue-400 border-blue-500/30" :
                            dm.ordering_basis === "lane_ladder" ? "text-amber-400 border-amber-500/30" :
                            "text-muted-foreground border-border/50"
                          )}
                        >
                          {dm.ordering_basis.replace(/_/g, ' ')}
                        </Badge>
                        {execution.blocked_document_ids?.includes(dm.document_id) && (
                          <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-amber-400 border-amber-500/30">blocked</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Block reasons */}
            {!execution.execution_allowed && execution.execution_notes.block_reasons && execution.execution_notes.block_reasons.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-[10px] text-red-400 space-y-0.5">
                  {execution.execution_notes.block_reasons.map((r, i) => (
                    <div key={i} className="font-mono">{r}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Target results */}
            {execution.target_results.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Target Results</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-xs w-[70px]">Status</TableHead>
                          <TableHead className="text-xs">Target</TableHead>
                          <TableHead className="text-xs w-[100px]">Doc Type</TableHead>
                          <TableHead className="text-xs">Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {execution.target_results.map((tr, idx) => (
                          <TableRow key={`${tr.target_id}-${idx}`} className="border-border/30">
                            <TableCell>
                              <Badge
                                variant={tr.status === 'executed' ? 'outline' : tr.status === 'failed' ? 'destructive' : 'secondary'}
                                className={cn(
                                  "text-[9px] font-mono px-1.5 py-0 h-4",
                                  tr.status === 'executed' && "text-emerald-400 border-emerald-500/30"
                                )}
                              >
                                {tr.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[10px] font-mono text-foreground truncate max-w-[200px]">{tr.target_id}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{tr.doc_type}</TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{tr.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Execution notes */}
            <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
              <span>Validation: <span className="font-mono text-foreground">{execution.execution_notes.validation_passed ? '✓' : '✗'}</span></span>
              <span>Write: <span className="font-mono text-foreground">{execution.execution_notes.write_performed ? '✓' : '—'}</span></span>
              {execution.execution_notes.downstream_execution_deferred && (
                <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/30">downstream deferred</Badge>
              )}
            </div>

            {/* ── POST-EXECUTION GOVERNANCE SUMMARY ── */}
            {execution.post_execution && (
              <Card className="border-border/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Shield className="h-3 w-3" />
                    Post-Execution Governance
                    {execution.post_execution.governance_notes.dry_run_no_governance_writes && (
                      <Badge variant="outline" className="text-[9px] font-mono text-blue-400 border-blue-500/30 ml-1">DRY RUN — NO WRITES</Badge>
                    )}
                    {execution.post_execution.governance_notes.governance_error && (
                      <Badge variant="destructive" className="text-[9px] font-mono ml-1">GOVERNANCE ERROR</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  {/* Invalidation summary */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <div className="text-sm font-bold text-foreground">{execution.post_execution.downstream_invalidation.surfaces_considered}</div>
                      <div className="text-[9px] text-muted-foreground uppercase">Surfaces Checked</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-red-400">{execution.post_execution.downstream_invalidation.surfaces_marked_stale}</div>
                      <div className="text-[9px] text-muted-foreground uppercase">Marked Stale</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-amber-400">{execution.post_execution.downstream_invalidation.surfaces_marked_review}</div>
                      <div className="text-[9px] text-muted-foreground uppercase">Flagged Review</div>
                    </div>
                  </div>

                  {/* Deferred surfaces */}
                  {execution.post_execution.downstream_invalidation.deferred_surfaces.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
                      <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-[10px] text-amber-400">
                        <span className="font-semibold">Deferred:</span>{' '}
                        {execution.post_execution.downstream_invalidation.deferred_surfaces.join(', ')}
                      </div>
                    </div>
                  )}

                  {/* Revalidation targets */}
                  {execution.post_execution.immediate_revalidation.targets.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Revalidation Targets ({execution.post_execution.immediate_revalidation.targets.length})</div>
                      <div className="space-y-1">
                        {execution.post_execution.immediate_revalidation.targets.map((rt, i) => (
                          <div key={`reval-${i}`} className="flex items-center gap-2 text-[10px] rounded border border-border/30 px-2 py-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[8px] font-mono px-1 py-0 h-3.5",
                                rt.revalidation_type === "full_reanalysis" ? "text-red-400 border-red-500/30" :
                                "text-amber-400 border-amber-500/30"
                              )}
                            >
                              {rt.revalidation_type.replace(/_/g, ' ')}
                            </Badge>
                            <span className="font-mono text-foreground">{rt.doc_type}</span>
                            <Badge
                              variant="secondary"
                              className="text-[8px] font-mono px-1 py-0 h-3.5 ml-auto"
                            >
                              {rt.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Governance notes */}
                  <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground pt-1 border-t border-border/30">
                    <span>Invalidation: <span className="font-mono text-foreground">{execution.post_execution.governance_notes.invalidation_performed ? '✓' : '—'}</span></span>
                    <span>Revalidation: <span className="font-mono text-foreground">{execution.post_execution.governance_notes.revalidation_handoff_performed ? '✓' : '—'}</span></span>
                    {execution.post_execution.governance_notes.governance_error && (
                      <span className="text-red-400 font-mono truncate max-w-[200px]">{execution.post_execution.governance_notes.governance_error}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── REVALIDATION EXECUTION SUMMARY ── */}
            {execution.revalidation_execution && (
              <Card className="border-border/50">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3" />
                    Revalidation Execution
                    {execution.revalidation_execution.notes.dry_run_no_revalidation_writes && (
                      <Badge variant="outline" className="text-[9px] font-mono text-blue-400 border-blue-500/30 ml-1">DRY RUN</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  {/* Summary counts */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <div className="text-sm font-bold text-emerald-400">{execution.revalidation_execution.succeeded}</div>
                      <div className="text-[9px] text-muted-foreground uppercase">Succeeded</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-red-400">{execution.revalidation_execution.failed}</div>
                      <div className="text-[9px] text-muted-foreground uppercase">Failed</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-muted-foreground">{execution.revalidation_execution.attempted - execution.revalidation_execution.succeeded - execution.revalidation_execution.failed}</div>
                      <div className="text-[9px] text-muted-foreground uppercase">Deferred</div>
                    </div>
                  </div>

                  {/* Per-target results */}
                  {execution.revalidation_execution.target_results.length > 0 && (
                    <div className="space-y-1">
                      {execution.revalidation_execution.target_results.map((rt, i) => (
                        <div key={`reval-exec-${i}`} className="flex items-center gap-2 text-[10px] rounded border border-border/30 px-2 py-1">
                          <Badge
                            variant={rt.status === 'executed' ? 'outline' : rt.status === 'failed' ? 'destructive' : 'secondary'}
                            className={cn(
                              "text-[8px] font-mono px-1 py-0 h-3.5",
                              rt.status === 'executed' && "text-emerald-400 border-emerald-500/30"
                            )}
                          >
                            {rt.status}
                          </Badge>
                          <span className="font-mono text-foreground">{rt.doc_type}</span>
                          <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">
                            {rt.revalidation_type.replace(/_/g, ' ')}
                          </Badge>
                          {rt.status === 'deferred' && (
                            <span className="text-[9px] text-amber-400 ml-auto">no canonical path</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Revalidation notes */}
                  <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground pt-1 border-t border-border/30">
                    <span>Patched doc: <span className="font-mono text-foreground">{execution.revalidation_execution.notes.patched_document_revalidated ? '✓' : '—'}</span></span>
                    <span>Downstream: <span className="font-mono text-foreground">{execution.revalidation_execution.notes.downstream_revalidation_performed ? '✓' : '—'}</span></span>
                    {execution.revalidation_execution.notes.unavailable_paths_deferred && (
                      <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/30">paths deferred</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── EXECUTION OBSERVABILITY TIMELINE ── */}
            {execution.execution_observability && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full mt-2">
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <Activity className="h-3 w-3" />
                    <span className="font-semibold uppercase tracking-wider">Execution Timeline</span>
                    <Badge variant="outline" className="text-[8px] font-mono ml-1 text-muted-foreground border-border/50">
                      {execution.execution_observability.total_duration_ms}ms
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  {/* Phase duration chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.entries(execution.execution_observability.phase_durations_ms) as [string, number | null][]).map(([phase, ms]) => (
                      ms != null && (
                        <Badge key={phase} variant="outline" className="text-[8px] font-mono px-1.5 py-0 h-4 text-muted-foreground border-border/50">
                          {phase.replace(/_/g, ' ')}: {ms}ms
                        </Badge>
                      )
                    ))}
                  </div>

                  {/* Document timeline */}
                  {execution.execution_observability.document_timeline.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[9px] font-semibold text-muted-foreground uppercase">Document Timeline</div>
                      {execution.execution_observability.document_timeline.map((dt, i) => (
                        <div key={`obs-doc-${i}`} className="rounded-md border border-border/30 px-2.5 py-1.5 space-y-0.5">
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="font-mono text-muted-foreground w-4 text-right">{dt.order_index + 1}.</span>
                            <span className="font-mono text-foreground font-semibold">{dt.doc_type}</span>
                            <Badge
                              variant={dt.status === 'executed' ? 'outline' : dt.status === 'failed' ? 'destructive' : dt.status === 'blocked' ? 'secondary' : 'outline'}
                              className={cn(
                                "text-[8px] font-mono px-1 py-0 h-3.5",
                                dt.status === 'executed' && "text-emerald-400 border-emerald-500/30",
                                dt.status === 'dry_run' && "text-blue-400 border-blue-500/30",
                                dt.status === 'blocked' && "text-amber-400 border-amber-500/30",
                              )}
                            >
                              {dt.status.replace(/_/g, ' ')}
                            </Badge>
                            <Badge variant="outline" className={cn(
                              "text-[8px] font-mono px-1 py-0 h-3.5",
                              dt.ordering_basis === "dependency_registry" ? "text-blue-400 border-blue-500/30" :
                              dt.ordering_basis === "lane_ladder" ? "text-amber-400 border-amber-500/30" :
                              "text-muted-foreground border-border/50"
                            )}>
                              {dt.ordering_basis.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground pl-6">
                            <span>Sections: {dt.section_targets_executed}/{dt.section_targets_total}</span>
                            {dt.section_targets_failed > 0 && <span className="text-destructive">{dt.section_targets_failed} failed</span>}
                            {dt.section_targets_skipped > 0 && <span>{dt.section_targets_skipped} skipped</span>}
                            {dt.version_id_after && <span className="font-mono">→ {dt.version_id_after.slice(0, 8)}</span>}
                            {dt.blocked_by_doc_type && <span className="text-amber-400">blocked by: {dt.blocked_by_doc_type}</span>}
                            {dt.governance_status && dt.governance_status !== "skipped" && (
                              <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">
                                gov: {dt.governance_status}
                              </Badge>
                            )}
                            {dt.revalidation_status && dt.revalidation_status !== "skipped" && (
                              <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">
                                reval: {dt.revalidation_status}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[9px] text-muted-foreground pl-6">{dt.execution_message}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Event trace */}
                  {execution.execution_observability.event_trace.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
                          <ChevronRight className="h-2.5 w-2.5 [[data-state=open]>&]:hidden" />
                          <ChevronDown className="h-2.5 w-2.5 hidden [[data-state=open]>&]:block" />
                          Event Trace ({execution.execution_observability.event_trace.length})
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-0.5 mt-1 max-h-40 overflow-y-auto">
                          {execution.execution_observability.event_trace.map((ev, i) => (
                            <div key={`obs-ev-${i}`} className="flex items-center gap-1.5 text-[9px]">
                              <span className="font-mono text-muted-foreground w-4 text-right shrink-0">{ev.seq}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[7px] font-mono px-1 py-0 h-3 shrink-0",
                                  ev.status === 'completed' && "text-emerald-400 border-emerald-500/30",
                                  ev.status === 'failed' && "text-destructive border-destructive/30",
                                  ev.status === 'blocked' && "text-amber-400 border-amber-500/30",
                                  ev.status === 'started' && "text-blue-400 border-blue-500/30",
                                )}
                              >
                                {ev.status}
                              </Badge>
                              <span className="font-mono text-muted-foreground shrink-0">[{ev.phase}]</span>
                              <span className="text-foreground truncate">{ev.message}</span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── ExecutionReplaySection — read-only historical execution audit replay with history index ──

function ExecutionReplaySection({
  projectId,
  iv,
  prp2s,
  prp2,
}: {
  projectId: string | undefined;
  iv: InterventionAnalysisResult | null;
  prp2s: PRP2SData | null;
  prp2: PRP2Data | null;
}) {
  const [replayResult, setReplayResult] = useState<ExecutionReplayResponse | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [lastPlanId, setLastPlanId] = useState<string | null>(null);

  // History index state
  const [historyResult, setHistoryResult] = useState<PatchExecutionHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accumulatedItems, setAccumulatedItems] = useState<PatchExecutionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<PatchExecutionHistoryCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<PatchExecutionHistoryItem | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  // Compare state
  const [compareItem, setCompareItem] = useState<PatchExecutionHistoryItem | null>(null);
  const [compareResult, setCompareResult] = useState<PatchExecutionComparisonResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Filter state
  const [historyFilters, setHistoryFilters] = useState<PatchExecutionHistoryFilters>({});
  const hasActiveFilters = Object.values(historyFilters).some(v => v != null && v !== '');

  const handleLoadHistory = async (filtersOverride?: PatchExecutionHistoryFilters) => {
    if (!projectId) return;
    setHistoryLoading(true);
    setAccumulatedItems([]);
    setCompareItem(null);
    setCompareResult(null);
    setNextCursor(null);
    setHasMore(false);
    try {
      const f = filtersOverride ?? historyFilters;
      const result = await fetchPatchExecutionHistory(projectId, 20, hasActiveFilters || filtersOverride ? f : undefined);
      setHistoryResult(result);
      setAccumulatedItems(result?.history_items || []);
      setNextCursor(result?.pagination?.next_cursor || null);
      setHasMore(result?.pagination?.has_more || false);
    } catch {
      setHistoryResult(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!projectId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const f = hasActiveFilters ? historyFilters : undefined;
      const result = await fetchPatchExecutionHistory(projectId, 20, f, nextCursor);
      if (result) {
        setHistoryResult(result);
        setAccumulatedItems(prev => [...prev, ...result.history_items]);
        setNextCursor(result.pagination?.next_cursor || null);
        setHasMore(result.pagination?.has_more || false);
      }
    } catch {
      // keep existing items
    } finally {
      setLoadingMore(false);
    }
  };

  const handleClearFilters = () => {
    setHistoryFilters({});
    setCompareItem(null);
    setCompareResult(null);
    if (historyResult) handleLoadHistory({});
  };

  const handleMarkForCompare = (item: PatchExecutionHistoryItem) => {
    if (compareItem?.transition_id === item.transition_id) {
      setCompareItem(null);
      setCompareResult(null);
    } else {
      setCompareItem(item);
      setCompareResult(null);
    }
  };

  const handleRunComparison = async () => {
    if (!projectId || !selectedHistoryItem || !compareItem) return;
    setCompareLoading(true);
    try {
      const result = await fetchPatchExecutionComparison(
        projectId,
        selectedHistoryItem.plan_id,
        compareItem.plan_id,
      );
      setCompareResult(result);
    } catch {
      setCompareResult(null);
    } finally {
      setCompareLoading(false);
    }
  };

  const handleSelectHistoryItem = async (item: PatchExecutionHistoryItem) => {
    if (!projectId) return;
    setSelectedHistoryItem(item);
    setLastPlanId(item.plan_id);
    setReplayLoading(true);
    try {
      const result = await fetchPatchExecutionReplay(projectId, item.plan_id);
      setReplayResult(result);
    } catch {
      setReplayResult(null);
    } finally {
      setReplayLoading(false);
    }
  };

  const handleLoadReplay = async () => {
    if (!projectId || !lastPlanId) return;
    setSelectedHistoryItem(null);
    setReplayLoading(true);
    try {
      const result = await fetchPatchExecutionReplay(projectId, lastPlanId);
      setReplayResult(result);
    } catch {
      setReplayResult(null);
    } finally {
      setReplayLoading(false);
    }
  };

  const replay = replayResult?.execution_replay;
  const replayExec = replay?.execution;
  const obs = replayExec?.execution_observability;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <History className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Execution Replay</span>
          {accumulatedItems.length > 0 && (
            <Badge variant="outline" className="text-[9px] ml-1 font-mono text-muted-foreground border-border/50">
              {accumulatedItems.length}{hasMore ? '+' : ''} saved
            </Badge>
          )}
          {replayResult?.replay_found && (
            <Badge variant="outline" className="text-[9px] ml-1 font-mono text-emerald-400 border-emerald-500/30">REPLAY LOADED</Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground">
            Read-only replay of previously persisted execution snapshots. Older executions before replay persistence may not appear.
          </span>
        </div>

        {/* ── History Index ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleLoadHistory()}
              disabled={!projectId || historyLoading}
              className="text-xs"
            >
              <List className="h-3 w-3 mr-1" />
              {historyLoading ? 'Loading…' : historyResult ? 'Refresh History' : 'Load Recent Executions'}
            </Button>
            <button
              onClick={() => setShowManualInput(!showManualInput)}
              className="text-[9px] text-muted-foreground hover:text-foreground transition-colors underline"
            >
              {showManualInput ? 'Hide manual input' : 'Enter plan ID manually'}
            </button>
          </div>

          {/* ── Filter Controls ── */}
          {historyResult && (
            <div className="space-y-1.5 rounded-md border border-border/30 bg-muted/20 px-2.5 py-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
                {hasActiveFilters && (
                  <button onClick={handleClearFilters} className="text-[8px] text-destructive hover:underline ml-auto">Clear all</button>
                )}
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label className="text-[8px] text-muted-foreground block mb-0.5">From</label>
                  <input
                    type="date"
                    className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[9px] text-foreground"
                    value={historyFilters.date_from || ''}
                    onChange={e => setHistoryFilters(p => ({ ...p, date_from: e.target.value || undefined }))}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground block mb-0.5">To</label>
                  <input
                    type="date"
                    className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[9px] text-foreground"
                    value={historyFilters.date_to || ''}
                    onChange={e => setHistoryFilters(p => ({ ...p, date_to: e.target.value || undefined }))}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground block mb-0.5">Source</label>
                  <select
                    className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[9px] text-foreground"
                    value={historyFilters.source_type || ''}
                    onChange={e => setHistoryFilters(p => ({ ...p, source_type: e.target.value || undefined }))}
                  >
                    <option value="">All</option>
                    <option value="intervention">intervention</option>
                    <option value="prp2s">prp2s</option>
                    <option value="arp1">arp1</option>
                    <option value="manual">manual</option>
                  </select>
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground block mb-0.5">Outcome</label>
                  <select
                    className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[9px] text-foreground"
                    value={historyFilters.outcome || ''}
                    onChange={e => setHistoryFilters(p => ({ ...p, outcome: (e.target.value || undefined) as PatchExecutionOutcome | undefined }))}
                  >
                    <option value="">All</option>
                    <option value="executed">executed</option>
                    <option value="partial">partial</option>
                    <option value="blocked">blocked</option>
                    <option value="failed">failed</option>
                    <option value="dry_run">dry run</option>
                  </select>
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground block mb-0.5">Repair type</label>
                  <input
                    type="text"
                    className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[9px] text-foreground w-[80px]"
                    placeholder="any"
                    value={historyFilters.repair_type || ''}
                    onChange={e => setHistoryFilters(p => ({ ...p, repair_type: e.target.value || undefined }))}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLoadHistory()}
                  disabled={historyLoading}
                  className="text-[9px] h-6 px-2"
                >
                  Apply
                </Button>
              </div>
              {historyResult.applied_filters && hasActiveFilters && (
                <div className="text-[8px] text-muted-foreground">
                  {historyResult.history_notes.prefilter_row_count != null && (
                    <span>{historyResult.history_notes.prefilter_row_count} valid → {historyResult.history_notes.postfilter_row_count} matched</span>
                  )}
                </div>
              )}
            </div>
          )}

          {historyLoading && <Skeleton className="h-16 w-full rounded-md" />}

          {/* History list */}
          {historyResult && !historyLoading && (
            <>
              {accumulatedItems.length === 0 ? (
                <Card className="border-border/50">
                  <CardContent className="py-4 text-center">
                    <History className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
                    {hasActiveFilters ? (
                      <>
                        <p className="text-xs text-muted-foreground">No executions match current filters.</p>
                        <button onClick={handleClearFilters} className="text-[9px] text-primary hover:underline mt-1">Clear filters</button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">No replayable executions found for this project.</p>
                        <p className="text-[9px] text-muted-foreground mt-1">Only non-dry-run executions that performed writes are persisted.</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {accumulatedItems.map((item) => {
                    const isSelected = selectedHistoryItem?.transition_id === item.transition_id;
                    const isCompare = compareItem?.transition_id === item.transition_id;
                    return (
                      <div
                        key={item.transition_id}
                        className={cn(
                          "rounded-md border px-2.5 py-2 transition-colors",
                          isSelected ? "border-primary/50 bg-accent/30" :
                          isCompare ? "border-blue-500/50 bg-blue-500/5" :
                          "border-border/30 hover:bg-accent/50"
                        )}
                      >
                        <button
                          onClick={() => handleSelectHistoryItem(item)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isSelected && <Badge variant="outline" className="text-[7px] font-mono px-1 py-0 h-3 text-primary border-primary/30">L</Badge>}
                            {isCompare && <Badge variant="outline" className="text-[7px] font-mono px-1 py-0 h-3 text-blue-400 border-blue-500/30">R</Badge>}
                            <span className="text-[10px] font-mono text-foreground">
                              {new Date(item.created_at).toLocaleString()}
                            </span>
                            {(() => {
                              const oc = item.outcome || deriveExecutionOutcome(item);
                              const ocStyles: Record<string, string> = {
                                executed: "text-emerald-400 border-emerald-500/30",
                                partial: "text-amber-400 border-amber-500/30",
                                blocked: "text-red-400 border-red-500/30",
                                failed: "text-destructive border-destructive/30",
                                dry_run: "text-blue-400 border-blue-500/30",
                              };
                              return (
                                <Badge variant="outline" className={cn("text-[8px] font-mono px-1 py-0 h-3.5", ocStyles[oc] || "text-muted-foreground border-border/50")}>
                                  {oc === "dry_run" ? "dry run" : oc}
                                </Badge>
                              );
                            })()}
                            {item.blocked_doc_types.length > 0 && (
                              <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-amber-400 border-amber-500/30">
                                {item.blocked_doc_types.length} blocked
                              </Badge>
                            )}
                            {item.total_duration_ms != null && (
                              <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">
                                {item.total_duration_ms}ms
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[9px] text-muted-foreground">
                            {item.repair_type && <span>repair: {item.repair_type}</span>}
                            {item.source_type && <span>source: {item.source_type}</span>}
                            <span>sections: {item.direct_targets_executed}/{item.direct_targets_attempted}</span>
                            {item.documents_executed != null && (
                              <span>docs: {item.documents_executed}/{item.documents_attempted}</span>
                            )}
                            {item.direct_targets_failed > 0 && (
                              <span className="text-destructive">{item.direct_targets_failed} failed</span>
                            )}
                          </div>
                        </button>
                        {/* Compare toggle — only show if this isn't the selected item */}
                        {!isSelected && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMarkForCompare(item); }}
                            className={cn(
                              "mt-1 text-[8px] font-mono px-1.5 py-0.5 rounded border transition-colors",
                              isCompare
                                ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                                : "text-muted-foreground border-border/30 hover:text-foreground hover:border-border/60"
                            )}
                          >
                            {isCompare ? '✕ Unmark' : '⇔ Compare'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Pagination status and Load More */}
              {accumulatedItems.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[9px] text-muted-foreground">
                    Showing {accumulatedItems.length} item{accumulatedItems.length !== 1 ? 's' : ''}
                  </span>
                  {hasMore && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="text-[9px] h-6 px-2 ml-auto"
                    >
                      {loadingMore ? 'Loading…' : 'Load More'}
                    </Button>
                  )}
                </div>
              )}
              {historyResult.history_notes.omitted_non_replay_rows > 0 && (
                <div className="text-[9px] text-muted-foreground">
                  {historyResult.history_notes.omitted_non_replay_rows} older transition(s) omitted (pre-replay format).
                </div>
              )}
            </>
          )}

          {/* ── Compare Executions ── */}
          {selectedHistoryItem && compareItem && (
            <div className="space-y-2 border-t border-border/30 pt-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">
                  Comparing <Badge variant="outline" className="text-[7px] font-mono px-1 py-0 h-3 text-primary border-primary/30">L</Badge>{' '}
                  {new Date(selectedHistoryItem.created_at).toLocaleDateString()} vs{' '}
                  <Badge variant="outline" className="text-[7px] font-mono px-1 py-0 h-3 text-blue-400 border-blue-500/30">R</Badge>{' '}
                  {new Date(compareItem.created_at).toLocaleDateString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunComparison}
                  disabled={compareLoading}
                  className="text-[9px] h-6 px-2 ml-auto"
                >
                  {compareLoading ? 'Comparing…' : 'Compare Executions'}
                </Button>
                <button
                  onClick={() => { setCompareItem(null); setCompareResult(null); }}
                  className="text-[8px] text-muted-foreground hover:text-foreground"
                >✕</button>
              </div>

              {compareResult && !compareResult.comparison_found && (
                <Card className="border-border/50">
                  <CardContent className="py-3 text-center space-y-1">
                    <XCircle className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">
                      Comparison unavailable — {compareResult.comparison_notes.missing_side || 'unknown'} snapshot missing or invalid.
                    </p>
                    {compareResult.comparison_notes.left_invalid_reason && (
                      <p className="text-[9px] font-mono text-red-400/70">Left: {compareResult.comparison_notes.left_invalid_reason}</p>
                    )}
                    {compareResult.comparison_notes.right_invalid_reason && (
                      <p className="text-[9px] font-mono text-red-400/70">Right: {compareResult.comparison_notes.right_invalid_reason}</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {compareResult?.comparison_found && compareResult.comparison && (() => {
                const c = compareResult.comparison;
                const renderDelta = (d: MetricDiffEntry) => {
                  if (d.delta == null) return <span className="text-muted-foreground">—</span>;
                  if (d.delta > 0) return <span className="text-emerald-400">+{d.delta}</span>;
                  if (d.delta < 0) return <span className="text-red-400">{d.delta}</span>;
                  return <span className="text-muted-foreground">0</span>;
                };
                const chipColor = (changed: boolean) =>
                  changed ? "text-amber-400 border-amber-500/30" : "text-emerald-400 border-emerald-500/30";

                return (
                  <div className="space-y-3">
                    {/* Summary chips */}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className={cn("text-[8px] font-mono px-1.5 py-0 h-4", chipColor(c.summary.outcome_changed))}>
                        outcome {c.summary.outcome_changed ? 'changed' : 'same'}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[8px] font-mono px-1.5 py-0 h-4", chipColor(c.summary.duration_changed))}>
                        duration {c.summary.duration_changed ? 'changed' : 'same'}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[8px] font-mono px-1.5 py-0 h-4", chipColor(c.summary.documents_changed))}>
                        docs {c.summary.documents_changed ? 'changed' : 'same'}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[8px] font-mono px-1.5 py-0 h-4", chipColor(c.summary.target_counts_changed))}>
                        targets {c.summary.target_counts_changed ? 'changed' : 'same'}
                      </Badge>
                    </div>

                    {/* Outcome diff */}
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-muted-foreground">Outcome:</span>
                      <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5">{c.outcome_diff.left_outcome}</Badge>
                      <span className="text-muted-foreground">→</span>
                      <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5">{c.outcome_diff.right_outcome}</Badge>
                    </div>

                    {/* Metrics diff table */}
                    <div>
                      <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Metrics</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[8px] py-1 h-6">Metric</TableHead>
                            <TableHead className="text-[8px] py-1 h-6 text-right">Left</TableHead>
                            <TableHead className="text-[8px] py-1 h-6 text-right">Right</TableHead>
                            <TableHead className="text-[8px] py-1 h-6 text-right">Δ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(Object.entries(c.metrics_diff) as [string, MetricDiffEntry][]).map(([key, val]) => (
                            <TableRow key={key}>
                              <TableCell className="text-[9px] font-mono py-1">{key.replace(/_/g, ' ')}</TableCell>
                              <TableCell className="text-[9px] font-mono py-1 text-right">{val.left ?? '—'}</TableCell>
                              <TableCell className="text-[9px] font-mono py-1 text-right">{val.right ?? '—'}</TableCell>
                              <TableCell className="text-[9px] font-mono py-1 text-right">{renderDelta(val)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Blocked doc types diff */}
                    {(c.blocked_doc_types_diff.only_left.length > 0 || c.blocked_doc_types_diff.only_right.length > 0 || c.blocked_doc_types_diff.both.length > 0) && (
                      <div>
                        <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Blocked Doc Types</div>
                        <div className="flex flex-wrap gap-1.5">
                          {c.blocked_doc_types_diff.only_left.map(d => (
                            <Badge key={`bl-${d}`} variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-red-400 border-red-500/30">−{d}</Badge>
                          ))}
                          {c.blocked_doc_types_diff.only_right.map(d => (
                            <Badge key={`br-${d}`} variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-emerald-400 border-emerald-500/30">+{d}</Badge>
                          ))}
                          {c.blocked_doc_types_diff.both.map(d => (
                            <Badge key={`bb-${d}`} variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">{d}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Document order diff */}
                    {c.document_order_diff.changed && (
                      <div>
                        <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Document Order Changed</div>
                        <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                          <div><span className="text-muted-foreground">Left: </span>{c.document_order_diff.left.join(' → ') || '—'}</div>
                          <div><span className="text-muted-foreground">Right: </span>{c.document_order_diff.right.join(' → ') || '—'}</div>
                        </div>
                      </div>
                    )}

                    {/* Document timeline diff */}
                    {(c.document_timeline_diff.only_left.length > 0 || c.document_timeline_diff.only_right.length > 0 || c.document_timeline_diff.changed_documents.length > 0) && (
                      <div>
                        <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Document Timeline Changes</div>
                        {c.document_timeline_diff.only_left.length > 0 && (
                          <div className="text-[9px] text-red-400 mb-1">Only left: {c.document_timeline_diff.only_left.join(', ')}</div>
                        )}
                        {c.document_timeline_diff.only_right.length > 0 && (
                          <div className="text-[9px] text-emerald-400 mb-1">Only right: {c.document_timeline_diff.only_right.join(', ')}</div>
                        )}
                        {c.document_timeline_diff.changed_documents.map((cd) => (
                          <div key={cd.document_id} className="rounded-md border border-border/30 px-2 py-1 mb-1 text-[9px]">
                            <span className="font-mono font-semibold text-foreground">{cd.doc_type}</span>
                            <div className="flex flex-wrap gap-2 text-muted-foreground mt-0.5">
                              {cd.left_status !== cd.right_status && (
                                <span>status: <span className="text-red-400">{cd.left_status}</span> → <span className="text-emerald-400">{cd.right_status}</span></span>
                              )}
                              {cd.left_governance_status !== cd.right_governance_status && (
                                <span>gov: {cd.left_governance_status} → {cd.right_governance_status}</span>
                              )}
                              {cd.left_revalidation_status !== cd.right_revalidation_status && (
                                <span>reval: {cd.left_revalidation_status} → {cd.right_revalidation_status}</span>
                              )}
                              {cd.left_version_id_after !== cd.right_version_id_after && (
                                <span className="font-mono">ver: {cd.left_version_id_after?.slice(0,8) || '—'} → {cd.right_version_id_after?.slice(0,8) || '—'}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Phase duration diff */}
                    <div>
                      <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Phase Durations (ms)</div>
                      <div className="flex flex-wrap gap-2">
                        {(Object.entries(c.phase_duration_diff) as [string, MetricDiffEntry][]).map(([phase, val]) => (
                          <div key={phase} className="text-[9px] font-mono">
                            <span className="text-muted-foreground">{phase.replace(/_/g, ' ')}: </span>
                            <span>{val.left ?? '—'}/{val.right ?? '—'} </span>
                            {renderDelta(val)}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Event trace summary */}
                    <div className="text-[9px] text-muted-foreground">
                      Events: {c.event_trace_summary.left_event_count} → {c.event_trace_summary.right_event_count}
                      {c.event_trace_summary.delta !== 0 && (
                        <span className={c.event_trace_summary.delta > 0 ? "text-emerald-400" : "text-red-400"}>
                          {' '}({c.event_trace_summary.delta > 0 ? '+' : ''}{c.event_trace_summary.delta})
                        </span>
                      )}
                    </div>

                    {/* Causal comparison notes */}
                    {compareResult.comparison_notes && (() => {
                      const cn2 = compareResult.comparison_notes as any;
                      const hasCausalData = cn2.first_causal_divergence || cn2.root_blocker || cn2.new_blockers?.length > 0 || cn2.resolved_blockers?.length > 0;
                      if (!hasCausalData) return null;
                      return (
                        <div>
                          <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Causal Analysis</div>
                          <div className="space-y-1">
                            {cn2.first_causal_divergence && (
                              <div className="text-[9px]">
                                <span className="text-muted-foreground">First divergence: </span>
                                <span className="font-mono text-amber-400">{cn2.first_causal_divergence.reason}</span>
                              </div>
                            )}
                            {cn2.root_blocker && (
                              <div className="text-[9px]">
                                <span className="text-muted-foreground">Root blocker: </span>
                                <span className="font-mono text-red-400">{cn2.root_blocker.from_node} → {cn2.root_blocker.to_node}</span>
                              </div>
                            )}
                            {cn2.new_blockers?.length > 0 && (
                              <div className="text-[9px]">
                                <span className="text-muted-foreground">New blockers: </span>
                                <span className="font-mono text-red-400">{cn2.new_blockers.join(', ')}</span>
                              </div>
                            )}
                            {cn2.resolved_blockers?.length > 0 && (
                              <div className="text-[9px]">
                                <span className="text-muted-foreground">Resolved blockers: </span>
                                <span className="font-mono text-emerald-400">{cn2.resolved_blockers.join(', ')}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          )}

          {showManualInput && (
            <div className="flex gap-2 items-end border-t border-border/30 pt-2">
              <div className="flex-1">
                <label className="text-[9px] text-muted-foreground uppercase font-semibold block mb-1">Plan ID (manual)</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted-foreground/50"
                  placeholder="Enter plan_id from a previous execution"
                  value={lastPlanId || ''}
                  onChange={(e) => { setLastPlanId(e.target.value || null); setSelectedHistoryItem(null); }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadReplay}
                disabled={!lastPlanId || !projectId || replayLoading}
                className="text-xs"
              >
                <History className="h-3 w-3 mr-1" />
                {replayLoading ? 'Loading…' : 'Load Replay'}
              </Button>
            </div>
          )}
        </div>

        {replayLoading && <Skeleton className="h-20 w-full rounded-md" />}

        {/* Not found state */}
        {replayResult && !replayResult.replay_found && !replayLoading && (
          <Card className="border-border/50">
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">No Replay Found</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                No persisted execution snapshot exists for this plan ID. Only non-dry-run executions that performed writes are persisted.
              </p>
              {replayResult.replay_notes.fallback_reason && (
                <div className="text-[9px] font-mono text-muted-foreground">
                  Reason: {replayResult.replay_notes.fallback_reason}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Replay found — render observability */}
        {replayResult && replayResult.replay_found && replay && replayExec && !replayLoading && (
          <>
            {/* Replay metadata */}
            <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
              <Badge variant="outline" className="text-[8px] font-mono text-blue-400 border-blue-500/30">
                PERSISTED REPLAY
              </Badge>
              <span>Source: <span className="font-mono text-foreground">{replayResult.replay_source}</span></span>
              <span>Match: <span className="font-mono text-foreground">{replayResult.replay_notes.exact_match ? 'exact' : 'fallback'}</span></span>
              <span>Version: <span className="font-mono text-foreground">{replay.execution_replay_version}</span></span>
              {replay.snapshot_mode && (
                <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/50">
                  {replay.snapshot_mode}
                </Badge>
              )}
              <span>Computed: <span className="font-mono text-foreground">{new Date(replay.computed_at).toLocaleString()}</span></span>
            </div>

            {/* Replay status grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  {replayExec.execution_allowed ? (
                    <CheckCircle className="h-5 w-5 mx-auto text-emerald-400" />
                  ) : (
                    <XCircle className="h-5 w-5 mx-auto text-red-400" />
                  )}
                  <div className="text-[9px] text-muted-foreground uppercase mt-1">
                    {replayExec.execution_allowed ? 'Allowed' : 'Blocked'}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{replayExec.direct_targets_executed}/{replayExec.direct_targets_attempted}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Sections</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">
                    {replayExec.documents_executed != null ? `${replayExec.documents_executed}/${replayExec.documents_attempted}` : '—'}
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase">Documents</div>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-2 text-center">
                  <div className="text-lg font-bold text-foreground">{replayExec.dry_run ? 'Yes' : 'No'}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Dry Run</div>
                </CardContent>
              </Card>
            </div>

            {/* Observability timeline from replay */}
            {obs && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                  <Activity className="h-3 w-3" />
                  Replay Timeline
                  <Badge variant="outline" className="text-[8px] font-mono ml-1 text-muted-foreground border-border/50">
                    {obs.total_duration_ms}ms
                  </Badge>
                </div>

                {/* Phase duration chips */}
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(obs.phase_durations_ms) as [string, number | null][]).map(([phase, ms]) => (
                    ms != null && (
                      <Badge key={phase} variant="outline" className="text-[8px] font-mono px-1.5 py-0 h-4 text-muted-foreground border-border/50">
                        {phase.replace(/_/g, ' ')}: {ms}ms
                      </Badge>
                    )
                  ))}
                </div>

                {/* Document timeline */}
                {obs.document_timeline.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase">Document Timeline</div>
                    {obs.document_timeline.map((dt, i) => (
                      <div key={`replay-doc-${i}`} className="rounded-md border border-border/30 px-2.5 py-1.5 space-y-0.5">
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="font-mono text-muted-foreground w-4 text-right">{dt.order_index + 1}.</span>
                          <span className="font-mono text-foreground font-semibold">{dt.doc_type}</span>
                          <Badge
                            variant={dt.status === 'executed' ? 'outline' : dt.status === 'failed' ? 'destructive' : dt.status === 'blocked' ? 'secondary' : 'outline'}
                            className={cn(
                              "text-[8px] font-mono px-1 py-0 h-3.5",
                              dt.status === 'executed' && "text-emerald-400 border-emerald-500/30",
                              dt.status === 'dry_run' && "text-blue-400 border-blue-500/30",
                              dt.status === 'blocked' && "text-amber-400 border-amber-500/30",
                            )}
                          >
                            {dt.status.replace(/_/g, ' ')}
                          </Badge>
                          <Badge variant="outline" className={cn(
                            "text-[8px] font-mono px-1 py-0 h-3.5",
                            dt.ordering_basis === "dependency_registry" ? "text-blue-400 border-blue-500/30" :
                            dt.ordering_basis === "lane_ladder" ? "text-amber-400 border-amber-500/30" :
                            "text-muted-foreground border-border/50"
                          )}>
                            {dt.ordering_basis.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground pl-6">
                          <span>Sections: {dt.section_targets_executed}/{dt.section_targets_total}</span>
                          {dt.section_targets_failed > 0 && <span className="text-destructive">{dt.section_targets_failed} failed</span>}
                          {dt.version_id_after && <span className="font-mono">→ {dt.version_id_after.slice(0, 8)}</span>}
                          {dt.blocked_by_doc_type && <span className="text-amber-400">blocked by: {dt.blocked_by_doc_type}</span>}
                          {dt.governance_status && dt.governance_status !== "skipped" && (
                            <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">
                              gov: {dt.governance_status}
                            </Badge>
                          )}
                          {dt.revalidation_status && dt.revalidation_status !== "skipped" && (
                            <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 h-3.5 text-muted-foreground border-border/50">
                              reval: {dt.revalidation_status}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[9px] text-muted-foreground pl-6">{dt.execution_message}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Event trace */}
                {obs.event_trace.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
                        <ChevronRight className="h-2.5 w-2.5 [[data-state=open]>&]:hidden" />
                        <ChevronDown className="h-2.5 w-2.5 hidden [[data-state=open]>&]:block" />
                        Event Trace ({obs.event_trace.length})
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-0.5 mt-1 max-h-40 overflow-y-auto">
                        {obs.event_trace.map((ev, i) => (
                          <div key={`replay-ev-${i}`} className="flex items-center gap-1.5 text-[9px]">
                            <span className="font-mono text-muted-foreground w-4 text-right shrink-0">{ev.seq}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[7px] font-mono px-1 py-0 h-3 shrink-0",
                                ev.status === 'completed' && "text-emerald-400 border-emerald-500/30",
                                ev.status === 'failed' && "text-destructive border-destructive/30",
                                ev.status === 'blocked' && "text-amber-400 border-amber-500/30",
                                ev.status === 'started' && "text-blue-400 border-blue-500/30",
                              )}
                            >
                              {ev.status}
                            </Badge>
                            <span className="font-mono text-muted-foreground shrink-0">[{ev.phase}]</span>
                            <span className="text-foreground truncate">{ev.message}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}

            {/* Causal Graph */}
            {obs && (obs as any).causal_nodes?.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronRight className="h-2.5 w-2.5 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-2.5 w-2.5 hidden [[data-state=open]>&]:block" />
                    Execution Causal Graph ({(obs as any).causal_nodes.length} nodes, {(obs as any).causal_edges?.length || 0} edges)
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2 mt-1">
                    {/* Root blockers */}
                    {(() => {
                      const edges = (obs as any).causal_edges || [];
                      const blockEdges = edges.filter((e: any) => e.edge_type === "blocks");
                      const failEdges = edges.filter((e: any) => e.edge_type === "failed_because");
                      if (blockEdges.length === 0 && failEdges.length === 0) return null;
                      return (
                        <div>
                          {blockEdges.length > 0 && (
                            <div className="mb-1">
                              <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Blocked By</div>
                              {blockEdges.map((e: any, i: number) => (
                                <div key={`block-${i}`} className="text-[9px] font-mono text-amber-400">
                                  {e.from_node} → {e.to_node}: {e.reason_message}
                                </div>
                              ))}
                            </div>
                          )}
                          {failEdges.length > 0 && (
                            <div>
                              <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Failures</div>
                              {failEdges.map((e: any, i: number) => (
                                <div key={`fail-${i}`} className="text-[9px] font-mono text-destructive">
                                  {e.from_node}: {e.reason_message}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* All nodes */}
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {((obs as any).causal_nodes || []).map((n: any, i: number) => (
                        <div key={`cn-${i}`} className="flex items-center gap-1.5 text-[9px]">
                          <Badge variant="outline" className={cn(
                            "text-[7px] font-mono px-1 py-0 h-3 shrink-0",
                            n.node_type === 'document' && "text-blue-400 border-blue-500/30",
                            n.node_type === 'validation' && "text-emerald-400 border-emerald-500/30",
                            n.node_type === 'governance' && "text-amber-400 border-amber-500/30",
                            n.node_type === 'revalidation' && "text-purple-400 border-purple-500/30",
                            n.node_type === 'patch_target' && "text-muted-foreground border-border/50",
                            n.node_type === 'execution_step' && "text-emerald-400 border-emerald-500/30",
                          )}>
                            {n.node_type}
                          </Badge>
                          <span className="text-foreground truncate">{n.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Plan ID for reference */}
            <div className="text-[9px] text-muted-foreground font-mono border-t border-border/30 pt-1.5">
              plan_id: {replay.plan_id}
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── ExecutionAnalyticsSection — read-only aggregation over persisted replay snapshots ──

function ExecutionAnalyticsSection({ projectId }: { projectId: string }) {
  const [analytics, setAnalytics] = useState<PatchExecutionAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetchPatchExecutionAnalytics(projectId, { limit: 100 });
      if (res?.ok) setAnalytics(res.analytics);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const a = analytics;
  const fmtMs = (ms: number | null) => ms != null ? `${(ms / 1000).toFixed(1)}s` : '—';

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Activity className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Execution Analytics</span>
          {a && (
            <Badge variant="outline" className="text-[9px] ml-1 font-mono text-muted-foreground border-border/50">
              {a.summary.total_snapshots} snapshots
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {!loaded && (
          <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={loadAnalytics} disabled={loading}>
            {loading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
            {loading ? 'Loading…' : 'Load Analytics'}
          </Button>
        )}

        {loaded && !a && (
          <div className="text-[10px] text-muted-foreground italic">No analytics data available.</div>
        )}

        {a && (
          <div className="space-y-3">
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Snapshots</div>
                <div className="text-sm font-mono font-semibold text-foreground">{a.summary.total_snapshots}</div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Executed %</div>
                <div className="text-sm font-mono font-semibold text-emerald-400">{a.success_rates.executed_rate}%</div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Blocked</div>
                <div className="text-sm font-mono font-semibold text-amber-400">{a.outcomes.blocked}</div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Avg Duration</div>
                <div className="text-sm font-mono font-semibold text-foreground">{fmtMs(a.timing.avg_total_duration_ms)}</div>
              </div>
            </div>

            {/* Outcome chips */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(a.outcomes).map(([key, val]) => (
                <Badge key={key} variant="outline" className={cn("text-[9px] font-mono",
                  key === 'executed' && 'text-emerald-400 border-emerald-500/30',
                  key === 'partial' && 'text-amber-400 border-amber-500/30',
                  key === 'blocked' && 'text-orange-400 border-orange-500/30',
                  key === 'failed' && 'text-red-400 border-red-500/30',
                  key === 'dry_run' && 'text-muted-foreground border-border/50',
                )}>
                  {key}: {val}
                </Badge>
              ))}
            </div>

            {/* Repair type table */}
            {a.repair_type_breakdown.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Repair Types</div>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/30">
                      <TableHead className="text-[9px] h-7 px-2">Type</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">Count</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">✓</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">⚠</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">✗</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {a.repair_type_breakdown.slice(0, 8).map((r) => (
                      <TableRow key={r.repair_type} className="border-border/20">
                        <TableCell className="text-[9px] font-mono px-2 py-1">{r.repair_type}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right">{r.count}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-emerald-400">{r.executed}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-amber-400">{r.partial + r.blocked}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-red-400">{r.failed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Source type table */}
            {a.source_type_breakdown.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Source Types</div>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/30">
                      <TableHead className="text-[9px] h-7 px-2">Source</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">Count</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">✓</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">✗</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {a.source_type_breakdown.slice(0, 8).map((s) => (
                      <TableRow key={s.source_type} className="border-border/20">
                        <TableCell className="text-[9px] font-mono px-2 py-1">{s.source_type}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right">{s.count}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-emerald-400">{s.executed}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-red-400">{s.failed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Document type health */}
            {a.document_type_breakdown.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Document Type Health</div>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/30">
                      <TableHead className="text-[9px] h-7 px-2">Doc Type</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">Seen</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">✓</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">Blocked</TableHead>
                      <TableHead className="text-[9px] h-7 px-2 text-right">Gov</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {a.document_type_breakdown.slice(0, 10).map((d) => (
                      <TableRow key={d.doc_type} className="border-border/20">
                        <TableCell className="text-[9px] font-mono px-2 py-1">{d.doc_type}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right">{d.total_seen}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-emerald-400">{d.executed}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right text-orange-400">{d.blocked}</TableCell>
                        <TableCell className="text-[9px] font-mono px-2 py-1 text-right">{d.governance_performed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Blocker patterns */}
            {a.blocker_breakdown.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Blocker Patterns</div>
                <div className="space-y-0.5">
                  {a.blocker_breakdown.slice(0, 8).map((b) => (
                    <div key={b.blocker_code} className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-muted-foreground truncate max-w-[200px]">{b.blocker_code}</span>
                      <Badge variant="outline" className="text-[8px] border-border/50 ml-2">{b.count}×</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Causal block edges */}
            {a.causal_patterns.block_edges.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Causal Block Edges</div>
                <div className="space-y-0.5">
                  {a.causal_patterns.block_edges.slice(0, 6).map((e, i) => (
                    <div key={i} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
                      <span className="truncate max-w-[120px]">{e.from_node}</span>
                      <span className="text-orange-400">→</span>
                      <span className="truncate max-w-[120px]">{e.to_node}</span>
                      <Badge variant="outline" className="text-[8px] border-border/50 ml-auto">{e.count}×</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Governance + Revalidation cards */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                <div className="text-[9px] text-muted-foreground uppercase mb-1">Governance</div>
                <div className="text-[9px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span>With gov:</span><span className="text-foreground">{a.governance.snapshots_with_governance}</span></div>
                  <div className="flex justify-between"><span>Without:</span><span className="text-foreground">{a.governance.snapshots_without_governance}</span></div>
                  <div className="flex justify-between"><span>Invalidations:</span><span className="text-foreground">{a.governance.invalidation_performed_count}</span></div>
                </div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                <div className="text-[9px] text-muted-foreground uppercase mb-1">Revalidation</div>
                <div className="text-[9px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span>With reval:</span><span className="text-foreground">{a.revalidation.snapshots_with_revalidation_execution}</span></div>
                  <div className="flex justify-between"><span>Full success:</span><span className="text-emerald-400">{a.revalidation.full_success_count}</span></div>
                  <div className="flex justify-between"><span>Failed:</span><span className="text-red-400">{a.revalidation.failed_count}</span></div>
                </div>
              </div>
            </div>

            {/* Timing cards */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                <div className="text-[9px] text-muted-foreground uppercase mb-1">Timing</div>
                <div className="text-[9px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span>Avg total:</span><span className="text-foreground">{fmtMs(a.timing.avg_total_duration_ms)}</span></div>
                  <div className="flex justify-between"><span>Min:</span><span className="text-foreground">{fmtMs(a.timing.min_total_duration_ms)}</span></div>
                  <div className="flex justify-between"><span>Max:</span><span className="text-foreground">{fmtMs(a.timing.max_total_duration_ms)}</span></div>
                </div>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                <div className="text-[9px] text-muted-foreground uppercase mb-1">Phase Avg</div>
                <div className="text-[9px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span>Validation:</span><span className="text-foreground">{fmtMs(a.timing.avg_validation_ms)}</span></div>
                  <div className="flex justify-between"><span>Execution:</span><span className="text-foreground">{fmtMs(a.timing.avg_section_execution_ms)}</span></div>
                  <div className="flex justify-between"><span>Governance:</span><span className="text-foreground">{fmtMs(a.timing.avg_governance_ms)}</span></div>
                  <div className="flex justify-between"><span>Revalidation:</span><span className="text-foreground">{fmtMs(a.timing.avg_revalidation_ms)}</span></div>
                </div>
              </div>
            </div>

            {/* Invalid snapshots warning */}
            {a.summary.invalid_snapshots > 0 && (
              <div className="flex items-center gap-1.5 text-[9px] text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {a.summary.invalid_snapshots} snapshot(s) excluded due to invalid structure
              </div>
            )}

            {/* Refresh */}
            <Button variant="ghost" size="sm" className="text-[9px] h-6" onClick={loadAnalytics} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── ExecutionRecommendationsSection ──────────────────────────────────────────
// Read-only deterministic recommendation surface derived from persisted replay
// snapshots. No execution-path changes. No mutation.
// Renders explainability fields: rule_id, threshold_version, trigger_metrics,
// evidence_summary (execution-recommendations-v1.1).

type TriageStatus = "do_now" | "watch" | "ignore";
type ChangeStatus = "new" | "resolved" | "worsened" | "improved" | "unchanged";
interface ChangeEntry { change_status: ChangeStatus; previous_severity?: string; current_severity?: string; title?: string; rule_id?: string; comparison_key?: string; }

/**
 * Comparison-key strategy registry.
 * Every recommendation rule_id MUST be registered here.
 * - singleton: category::rule_id is unique (only one rec per run for this rule)
 * - multi: category::rule_id is NOT unique; the named evidence `field` discriminates instances
 *
 * If a new rule_id is added to the backend without a registry entry here,
 * deriveComparisonKey will log a deterministic dev warning and fall back to
 * recommendation_id (safe but defeats cross-run stability).
 */
type ComparisonKeyStrategy =
  | { kind: 'singleton' }
  | { kind: 'multi'; field: string };

const COMPARISON_KEY_REGISTRY: Record<string, ComparisonKeyStrategy> = {
  // Singletons — one rec per run
  REC_A_OVERALL_HEALTH:        { kind: 'singleton' },
  REC_F_OVERALL_GOVERNANCE_GAP:{ kind: 'singleton' },
  REC_G_REVALIDATION_FAILURE_GAP: { kind: 'singleton' },
  REC_H_TIMING_INEFFICIENCY:   { kind: 'singleton' },

  // Multi-instance — one rec per qualifying entity
  REC_B_BLOCKER_MITIGATION:    { kind: 'multi', field: 'blocker_code' },
  REC_C_REPAIR_TYPE_WATCHLIST:  { kind: 'multi', field: 'repair_type' },
  REC_D_SOURCE_TYPE_WATCHLIST:  { kind: 'multi', field: 'source_type' },
  REC_E_DOC_STABILITY:          { kind: 'multi', field: 'doc_type' },
  REC_E_GOVERNANCE_GAP:         { kind: 'multi', field: 'doc_type' },
  REC_E_REVALIDATION_GAP:       { kind: 'multi', field: 'doc_type' },
  REC_I_CAUSAL_ROOT_BLOCKER:    { kind: 'multi', field: 'blocker' },
};

// Dedup dev warnings so we don't spam per render cycle
const _warnedRuleIds = new Set<string>();

/**
 * Derive a stable comparison key for change detection.
 *
 * Uses COMPARISON_KEY_REGISTRY to determine strategy per rule_id.
 * Unregistered rules trigger a dev warning and fall back to recommendation_id.
 * Registered multi-instance rules missing their discriminator field also warn.
 */
function deriveComparisonKey(rec: {
  category?: string;
  rule_id?: string;
  recommendation_id: string;
  evidence?: Record<string, unknown>;
  trigger_metrics?: Record<string, unknown>;
}): string {
  if (!rec.category || !rec.rule_id) return rec.recommendation_id;

  const strategy = COMPARISON_KEY_REGISTRY[rec.rule_id];

  // ── Guard: unregistered rule_id ──
  if (!strategy) {
    if (!_warnedRuleIds.has(rec.rule_id)) {
      _warnedRuleIds.add(rec.rule_id);
      console.warn(
        `[IFFY change-detection] Unregistered rule_id "${rec.rule_id}" in COMPARISON_KEY_REGISTRY. ` +
        `Falling back to recommendation_id — cross-run change detection will be unreliable for this rule. ` +
        `Add an entry to COMPARISON_KEY_REGISTRY to fix.`
      );
    }
    return rec.recommendation_id;
  }

  // ── Singleton: two-segment key is sufficient ──
  if (strategy.kind === 'singleton') {
    return `${rec.category}::${rec.rule_id}`;
  }

  // ── Multi-instance: three-segment key using registered field ──
  const ev = (rec.evidence ?? rec.trigger_metrics ?? {}) as Record<string, unknown>;
  const entityValue = ev[strategy.field];

  if (entityValue != null && entityValue !== '') {
    return `${rec.category}::${rec.rule_id}::${String(entityValue)}`;
  }

  // ── Guard: multi-instance rule missing its discriminator ──
  if (!_warnedRuleIds.has(rec.rule_id + ':missing_field')) {
    _warnedRuleIds.add(rec.rule_id + ':missing_field');
    console.warn(
      `[IFFY change-detection] Multi-instance rule "${rec.rule_id}" missing discriminator field "${strategy.field}" in evidence. ` +
      `Falling back to recommendation_id. Check backend recommendation generation.`
    );
  }
  return rec.recommendation_id;
}

// ── Recommended Actions Registry ────────────────────────────────────────────
// Maps rule_id → factory producing non-mutating inspection actions from evidence.
// All actions are destructive: false. Mutating actions are a future concern.

type RecommendedActionFactory = (args: {
  rule_id?: string;
  category?: string;
  title?: string;
  evidence?: Record<string, unknown>;
}) => import('@/hooks/usePreventiveRepairPrioritization').RecommendedAction[];

const RECOMMENDED_ACTIONS_REGISTRY: Record<string, RecommendedActionFactory> = {
  REC_A_OVERALL_HEALTH: () => [{
    action_type: 'inspect_execution_health', label: 'View execution health', params: {}, destructive: false,
  }],
  REC_B_BLOCKER_MITIGATION: ({ evidence }) => [{
    action_type: 'inspect_blocker',
    label: `Inspect blocker: ${String(evidence?.blocker_code ?? '')}`,
    params: { blocker_code: String(evidence?.blocker_code ?? '') },
    destructive: false,
  }],
  REC_C_REPAIR_TYPE_WATCHLIST: ({ evidence }) => [{
    action_type: 'inspect_repair_type',
    label: `Inspect repair type: ${String(evidence?.repair_type ?? '')}`,
    params: { repair_type: String(evidence?.repair_type ?? '') },
    destructive: false,
  }],
  REC_D_SOURCE_TYPE_WATCHLIST: ({ evidence }) => [{
    action_type: 'inspect_source_type',
    label: `Inspect source type: ${String(evidence?.source_type ?? '')}`,
    params: { source_type: String(evidence?.source_type ?? '') },
    destructive: false,
  }],
  REC_E_DOC_STABILITY: ({ evidence }) => [{
    action_type: 'inspect_doc_type',
    label: `Inspect doc type: ${String(evidence?.doc_type ?? '')}`,
    params: { doc_type: String(evidence?.doc_type ?? '') },
    destructive: false,
  }],
  REC_E_GOVERNANCE_GAP: ({ evidence }) => [{
    action_type: 'inspect_doc_type',
    label: `Inspect doc type: ${String(evidence?.doc_type ?? '')}`,
    params: { doc_type: String(evidence?.doc_type ?? '') },
    destructive: false,
  }],
  REC_E_REVALIDATION_GAP: ({ evidence }) => [{
    action_type: 'inspect_doc_type',
    label: `Inspect doc type: ${String(evidence?.doc_type ?? '')}`,
    params: { doc_type: String(evidence?.doc_type ?? '') },
    destructive: false,
  }],
  REC_F_OVERALL_GOVERNANCE_GAP: () => [{
    action_type: 'inspect_governance', label: 'Inspect governance', params: {}, destructive: false,
  }],
  REC_G_REVALIDATION_FAILURE_GAP: () => [{
    action_type: 'inspect_governance', label: 'Inspect governance', params: {}, destructive: false,
  }],
  REC_H_TIMING_INEFFICIENCY: () => [{
    action_type: 'inspect_timing', label: 'Inspect timing', params: {}, destructive: false,
  }],
  REC_I_CAUSAL_ROOT_BLOCKER: ({ evidence }) => [{
    action_type: 'inspect_blocker',
    label: `Inspect blocker: ${String(evidence?.blocker ?? '')}`,
    params: { blocker: String(evidence?.blocker ?? '') },
    destructive: false,
  }],
};

/** Populate recommended_actions on a DisplayRecommendation using the registry. */
function populateRecommendedActions(rec: import('@/hooks/usePreventiveRepairPrioritization').DisplayRecommendation): void {
  if (rec.recommended_actions && rec.recommended_actions.length > 0) return; // already populated (e.g. from backend)
  const factory = RECOMMENDED_ACTIONS_REGISTRY[rec.rule_id];
  if (!factory) return; // unregistered rule — no actions
  rec.recommended_actions = factory({
    rule_id: rec.rule_id,
    category: rec.category,
    title: rec.title,
    evidence: rec.evidence as Record<string, unknown>,
  });
}

const SEV_ORDER: Record<string, number> = { high: 2, medium: 1, low: 0 };

interface SnapshotItem {
  recommendation_id: string;
  comparison_key?: string;
  severity: string;
  suppressed?: boolean;
  title?: string;
  rule_id?: string;
  category?: string;
  evidence?: Record<string, unknown>;
}

function computeChangeMap(
  currentRecs: DisplayRecommendation[],
  previousSnapshot: SnapshotItem[] | null,
): Record<string, ChangeEntry> {
  const map: Record<string, ChangeEntry> = {};
  if (!previousSnapshot) return map; // first run — no changes

  // Build previous map keyed by comparison_key (falls back to recommendation_id for legacy snapshots)
  const prevMap = new Map<string, SnapshotItem>();
  for (const r of previousSnapshot) {
    const key = r.comparison_key || deriveComparisonKey(r);
    prevMap.set(key, r);
  }
  const currentKeys = new Set<string>();

  for (const rec of currentRecs) {
    if (rec.suppressed) continue;
    const key = deriveComparisonKey(rec);
    currentKeys.add(key);
    // Map back to recommendation_id for UI badge lookups
    const prev = prevMap.get(key);
    if (!prev) {
      map[rec.recommendation_id] = { change_status: "new", current_severity: rec.severity, comparison_key: key };
    } else {
      const prevSev = SEV_ORDER[prev.severity] ?? 0;
      const curSev = SEV_ORDER[rec.severity] ?? 0;
      if (curSev > prevSev) {
        map[rec.recommendation_id] = { change_status: "worsened", previous_severity: prev.severity, current_severity: rec.severity, comparison_key: key };
      } else if (curSev < prevSev) {
        map[rec.recommendation_id] = { change_status: "improved", previous_severity: prev.severity, current_severity: rec.severity, comparison_key: key };
      } else {
        map[rec.recommendation_id] = { change_status: "unchanged", previous_severity: prev.severity, current_severity: rec.severity, comparison_key: key };
      }
    }
  }

  // Resolved: existed previously (not suppressed) but not in current set
  for (const prev of previousSnapshot) {
    const key = prev.comparison_key || deriveComparisonKey(prev);
    if (!currentKeys.has(key) && !prev.suppressed) {
      map[key] = {
        change_status: "resolved",
        previous_severity: prev.severity,
        title: prev.title,
        rule_id: prev.rule_id,
        comparison_key: key,
      };
    }
  }

  return map;
}

function ExecutionRecommendationsSection({ projectId, onNavigateToTrend, onRouteToRepairs }: {
  projectId: string;
  onNavigateToTrend: (target: TrendNavigationTarget) => void;
  onRouteToRepairs?: (ctx: RepairLandingContext) => void;
}) {
  const [data, setData] = useState<PatchExecutionRecommendationsResponse | null>(null);
  const [trendsData, setTrendsData] = useState<PatchExecutionTrendsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [triageMap, setTriageMap] = useState<Record<string, TriageStatus>>({});
  const triageLoadedRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [memoCopied, setMemoCopied] = useState<string | null>(null);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [triageJsonCopied, setTriageJsonCopied] = useState<string | null>(null);
  const [changeMap, setChangeMap] = useState<Record<string, ChangeEntry>>({});

  // Stable triage identity helper — uses comparison_key instead of ephemeral recommendation_id
  const triageKey = (rec: { category?: string; rule_id?: string; recommendation_id: string; evidence?: Record<string, unknown>; trigger_metrics?: Record<string, unknown> }) => deriveComparisonKey(rec);

  // Load persisted triage from DB on mount — keyed by stable comparison_key.
  // Phase 4 enforces UNIQUE(project_id, comparison_key) and NOT NULL on comparison_key.
  // The null filter and ORDER BY updated_at are defensive belts retained for safety.
  useEffect(() => {
    if (triageLoadedRef.current) return;
    triageLoadedRef.current = true;
    (async () => {
      const { data: rows } = await supabase
        .from('execution_recommendation_triage')
        .select('comparison_key, triage_status')
        .eq('project_id', projectId)
        .not('comparison_key', 'is', null)
        .order('updated_at', { ascending: false });
      if (rows && rows.length > 0) {
        const map: Record<string, TriageStatus> = {};
        for (const r of rows) {
          if (r.triage_status === 'do_now' || r.triage_status === 'watch' || r.triage_status === 'ignore') {
            // First seen wins (rows are ordered by updated_at DESC, so latest is first)
            if (!map[r.comparison_key!]) {
              map[r.comparison_key!] = r.triage_status;
            }
          }
        }
        setTriageMap(map);
      }
    })();
  }, [projectId]);

  // Persist a single triage upsert — keyed by stable comparison_key (Phase 4)
  const persistTriage = useCallback(async (compKey: string, recId: string, status: TriageStatus) => {
    const { data: userData } = await supabase.auth.getUser();
    await supabase
      .from('execution_recommendation_triage')
      .upsert({
        project_id: projectId,
        recommendation_id: recId,
        comparison_key: compKey,
        triage_status: status,
        created_by: userData?.user?.id ?? null,
      }, { onConflict: 'project_id,comparison_key' });
  }, [projectId]);

  // Delete a single triage row — by stable comparison_key
  const deleteTriage = useCallback(async (compKey: string, _recId: string) => {
    await supabase
      .from('execution_recommendation_triage')
      .delete()
      .eq('project_id', projectId)
      .eq('comparison_key', compKey);
  }, [projectId]);

  // Persist bulk upserts — keyed by stable comparison_key (Phase 4)
  const persistBulkTriage = useCallback(async (items: { compKey: string; recId: string }[], status: TriageStatus) => {
    const { data: userData } = await supabase.auth.getUser();
    const rows = items.map(item => ({
      project_id: projectId,
      recommendation_id: item.recId,
      comparison_key: item.compKey,
      triage_status: status,
      created_by: userData?.user?.id ?? null,
    }));
    await supabase
      .from('execution_recommendation_triage')
      .upsert(rows, { onConflict: 'project_id,comparison_key' });
  }, [projectId]);

  // Delete bulk triage rows — by stable comparison_key
  const deleteBulkTriage = useCallback(async (compKeys: string[]) => {
    await supabase
      .from('execution_recommendation_triage')
      .delete()
      .eq('project_id', projectId)
      .in('comparison_key', compKeys);
  }, [projectId]);

  // Clean stale triage entries when recommendations change — uses comparison_key
  const cleanTriageMap = (recs: ExecutionRecommendations) => {
    const allKeys = new Set([
      ...recs.top_priorities, ...recs.blocker_mitigations, ...recs.repair_type_watchlist,
      ...recs.source_type_watchlist, ...recs.document_type_watchlist,
      ...recs.governance_gaps, ...recs.revalidation_gaps, ...recs.suggested_next_actions,
    ].map(r => triageKey(r)));
    setTriageMap(prev => {
      const next: Record<string, TriageStatus> = {};
      for (const [key, status] of Object.entries(prev)) {
        if (allKeys.has(key)) next[key] = status;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  };

  const toggleTriage = (compKey: string, recId: string, status: TriageStatus) => {
    setTriageMap(prev => {
      if (prev[compKey] === status) {
        const { [compKey]: _, ...rest } = prev;
        deleteTriage(compKey, recId);
        return rest;
      }
      persistTriage(compKey, recId, status);
      return { ...prev, [compKey]: status };
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const [recsRes, trendsRes] = await Promise.all([
        fetchPatchExecutionRecommendations(projectId, { limit: 100 }),
        fetchPatchExecutionRecommendationTrends(projectId, { recent_limit: 25, prior_limit: 25 }),
      ]);
      if (recsRes?.ok) {
        setData(recsRes);
        if (recsRes.recommendations) cleanTriageMap(recsRes.recommendations);

        // Change detection: compare with previous run
        const runId = recsRes.computed_at || new Date().toISOString();
        const displayModel = dedupeAndSuppressRecommendations(recsRes.recommendations);
        if (displayModel) {
          // Build minimal snapshot for storage — includes comparison_key + entity evidence for stable identity
          const snapshotItems: SnapshotItem[] = displayModel.all_display
            .filter(r => !r.suppressed)
            .map(r => {
              // Extract only canonical entity fields from evidence for snapshot (not full evidence blob)
              const ev = r.evidence as Record<string, unknown> | undefined;
              const entityEvidence: Record<string, unknown> = {};
              if (ev) {
                for (const k of ['blocker_code', 'blocker', 'repair_type', 'source_type', 'doc_type']) {
                  if (ev[k] != null) entityEvidence[k] = ev[k];
                }
              }
              return {
                recommendation_id: r.recommendation_id,
                comparison_key: deriveComparisonKey(r),
                severity: r.severity,
                rule_id: r.rule_id,
                category: r.category,
                suppressed: false,
                title: r.title,
                evidence: Object.keys(entityEvidence).length > 0 ? entityEvidence : undefined,
              };
            });

          // Fetch previous snapshot — EXCLUDE current run_id to prevent self-comparison
          const { data: prevRows } = await supabase
            .from('execution_recommendation_runs')
            .select('recommendations_snapshot')
            .eq('project_id', projectId)
            .neq('run_id', runId)
            .order('created_at', { ascending: false })
            .limit(1);

          const prevSnapshot = prevRows?.[0]?.recommendations_snapshot as { recommendations?: SnapshotItem[] } | null;
          const prevRecs = prevSnapshot?.recommendations ?? null;

          // Compute change map
          const changes = computeChangeMap(displayModel.all_display, prevRecs);
          setChangeMap(changes);

          // Persist current snapshot idempotently (upsert by run_id)
          await (supabase
            .from('execution_recommendation_runs') as any)
            .upsert({
              project_id: projectId,
              run_id: runId,
              recommendations_snapshot: { recommendations: snapshotItems },
            }, { onConflict: 'project_id,run_id' });
        }
      }
      if (trendsRes?.ok) setTrendsData(trendsRes);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const trends = trendsData?.trends ?? null;

  const recs = data?.recommendations;
  const summary = recs?.summary;

  // Compute display model via dedup/suppression
  const displayResult: DisplayRecommendationsResult | null = recs
    ? dedupeAndSuppressRecommendations(recs)
    : null;
  // Populate recommended_actions from registry (additive, non-mutating)
  if (displayResult) {
    for (const rec of displayResult.all_display) {
      populateRecommendedActions(rec);
    }
  }
  const report = displayResult?.suppression_report;

  const sevColor = (s: ExecutionRecommendation["severity"]) =>
    s === "high" ? "text-red-400 border-red-500/30" :
    s === "medium" ? "text-amber-400 border-amber-500/30" :
    "text-muted-foreground border-border/50";

  const sevDot = (s: ExecutionRecommendation["severity"]) =>
    s === "high" ? "bg-red-400" : s === "medium" ? "bg-amber-400" : "bg-muted-foreground";

  // Trend status badge helpers — uses semantic tokens where possible
  const trendStatusColor = (s: LinkedTrendStatus) =>
    s === "worsening" ? "text-destructive border-destructive/30" :
    s === "improving" ? "text-emerald-400 border-emerald-500/30" :
    s === "flat" ? "text-muted-foreground/60 border-border/40" :
    s === "insufficient_data" ? "text-muted-foreground/50 border-border/25" :
    "text-muted-foreground/40 border-border/20";

  const trendStatusIcon = (s: LinkedTrendStatus) =>
    s === "worsening" ? "↗" :
    s === "improving" ? "↘" :
    s === "flat" ? "→" :
    s === "insufficient_data" ? "…" : "·";

  /* ── Recommended Action Dispatcher ──
   * Maps non-mutating inspection action_types to existing TrendNavigationTarget
   * subsections. All actions navigate to the Execution Trends section.
   * No mutations, no backend calls, no schema changes.
   */
  const ACTION_TYPE_TO_TREND: Record<string, { subsection_key: TrendSubsectionKey; entity_param?: string }> = {
    inspect_execution_health: { subsection_key: 'overall_outcomes' },
    inspect_blocker:          { subsection_key: 'blocker_code_trends', entity_param: 'blocker_code' },
    inspect_repair_type:      { subsection_key: 'repair_type_trends', entity_param: 'repair_type' },
    inspect_source_type:      { subsection_key: 'source_type_trends', entity_param: 'source_type' },
    inspect_doc_type:         { subsection_key: 'document_type_trends', entity_param: 'doc_type' },
    inspect_governance:       { subsection_key: 'governance_trends' },
    inspect_timing:           { subsection_key: 'timing_trends' },
  };

  const dispatchRecommendedAction = useCallback((action: { action_type: string; label: string; params: Record<string, unknown>; destructive?: boolean }) => {
    const mapping = ACTION_TYPE_TO_TREND[action.action_type];
    if (!mapping) {
      if (import.meta.env.DEV) {
        console.warn(`[IFFY action] No dispatcher mapping for action_type="${action.action_type}". Ignoring.`);
      }
      return;
    }
    // Resolve optional entity key from action params
    const entity_key = mapping.entity_param
      ? String(action.params[mapping.entity_param] ?? action.params['blocker'] ?? '')
      : undefined;
    const target: TrendNavigationTarget = {
      source_key: `action::${action.action_type}`,
      subsection_key: mapping.subsection_key,
      entity_key: entity_key || undefined,
      highlight_mode: entity_key ? 'row' : 'header',
      activated_at: Date.now(),
    };
    onNavigateToTrend(target);
  }, [onNavigateToTrend]);

  const RecCard = ({ rec, suppressed }: { rec: DisplayRecommendation; suppressed?: boolean }) => {
    const linkage = resolveRecommendationTrendLinkage(rec, trends);
    const navTarget = linkage.status !== "unavailable" ? resolveTrendNavigationTarget(linkage.source_key) : null;
    return (
    <div
      ref={(el) => { cardRefs.current[rec.recommendation_id] = el; }}
      className={cn(
      "rounded-md border px-3 py-2 space-y-1.5",
      suppressed
        ? "border-border/20 bg-muted/10 opacity-50"
        : "border-border/40 bg-muted/20",
    )}>
      <div className="flex items-start gap-2">
        <div className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", sevDot(rec.severity))} />
        <div className="flex-1 min-w-0 space-y-1">

          {/* Title + severity + confidence + suppressed badge */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold text-foreground">{rec.title}</span>
            <Badge variant="outline" className={cn("text-[8px] font-mono shrink-0", sevColor(rec.severity))}>
              {rec.severity}
            </Badge>
            <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground/70 border-border/30 shrink-0">
              {rec.confidence} confidence
            </Badge>
            {/* Trend linkage chip — raw source_key on title for audit */}
            <Badge variant="outline" className={cn("text-[8px] font-mono shrink-0", trendStatusColor(linkage.status))} title={`Trend source: ${linkage.source_key}`}>
              {trendStatusIcon(linkage.status)} {linkage.chip_label}
            </Badge>
            {linkage.metric_summary && (
              <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/20 shrink-0">
                {linkage.metric_summary}
              </Badge>
            )}
            {suppressed && (
              <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/30 bg-muted/40 shrink-0">
                SUPPRESSED
              </Badge>
            )}
            {suppressed && rec.suppression_reason && (
              <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/40 border-border/20 shrink-0">
                {rec.suppression_reason}
              </Badge>
            )}
            {/* Change detection badge */}
            {(() => {
              const change = changeMap[rec.recommendation_id];
              if (!change || change.change_status === "unchanged") return null;
              const cfg: Record<string, { label: string; cls: string }> = {
                new: { label: "NEW", cls: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
                worsened: { label: `WORSENED ↑ ${change.previous_severity}→${change.current_severity}`, cls: "text-red-400 border-red-500/30 bg-red-500/10" },
                improved: { label: `IMPROVED ↓ ${change.previous_severity}→${change.current_severity}`, cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
              };
              const c = cfg[change.change_status];
              if (!c) return null;
              return <Badge variant="outline" className={cn("text-[7px] font-mono shrink-0", c.cls)}>{c.label}</Badge>;
            })()}
          </div>

          {/* Trend signal subline — shown for all statuses for honesty */}
          <div className="flex items-center gap-2 text-[8px] text-muted-foreground/50">
            <span>{linkage.label}{linkage.source_label ? ` · ${linkage.source_label}` : ""}</span>
            {navTarget && (
              <button
                type="button"
                className="text-[8px] font-mono text-primary/70 hover:text-primary underline decoration-primary/30 hover:decoration-primary/60 transition-colors"
                onClick={() => onNavigateToTrend({ ...navTarget, activated_at: Date.now() })}
                title={`Opens linked trend: ${linkage.source_key}`}
              >
                View trend evidence
              </button>
            )}
          </div>

          {/* Suppressed-by line */}
          {suppressed && rec.suppressed_by && (
            <div className="text-[8px] font-mono text-muted-foreground/40">
              retained by: {rec.suppressed_by}
            </div>
          )}

          {/* Rule metadata row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[8px] font-mono text-muted-foreground/50 bg-muted/40 border border-border/20 rounded px-1 py-0.5">
              {rec.rule_id}
            </span>
            <span className="text-[8px] font-mono text-muted-foreground/40 bg-muted/30 border border-border/20 rounded px-1 py-0.5">
              {rec.threshold_version}
            </span>
          </div>

          {/* Rationale */}
          <p className="text-[9px] text-muted-foreground leading-snug">{rec.rationale}</p>

          {/* Evidence summary */}
          {rec.evidence_summary && rec.evidence_summary.length > 0 && (
            <ul className="space-y-0.5">
              {rec.evidence_summary.map((line, i) => (
                <li key={i} className="flex items-start gap-1 text-[8px] font-mono text-muted-foreground/80">
                  <span className="text-muted-foreground/40 mt-px shrink-0">›</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Trigger metrics */}
          {rec.trigger_metrics && Object.keys(rec.trigger_metrics).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(rec.trigger_metrics).slice(0, 4).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-0.5 text-[8px] font-mono bg-muted/50 border border-border/30 rounded px-1 py-0.5 text-muted-foreground">
                  {k}: <span className="text-foreground/80">{String(v)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Suggested action */}
          <div className="text-[9px] text-muted-foreground border-l-2 border-border/40 pl-1.5">
            <span className="font-semibold text-foreground/80">Action:</span> {rec.suggested_action}
          </div>

          {/* Recommended actions — structured non-mutating inspection buttons */}
          {rec.recommended_actions && rec.recommended_actions.length > 0 && !suppressed && (
            <div className="flex items-center gap-1 flex-wrap">
              {rec.recommended_actions.filter(a => !a.destructive).map((action, i) => (
                <button
                  key={`${action.action_type}-${i}`}
                  type="button"
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary/80 hover:text-primary hover:bg-primary/10 transition-colors"
                  title={`${action.action_type}: ${JSON.stringify(action.params)}`}
                  onClick={() => dispatchRecommendedAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Triage controls — only for non-suppressed */}
          {!suppressed && (
            <div className="flex items-center gap-1 pt-0.5">
              {(["do_now", "watch", "ignore"] as const).map(s => {
                const active = triageMap[triageKey(rec)] === s;
                const labels: Record<TriageStatus, string> = { do_now: "Do now", watch: "Watch", ignore: "Ignore" };
                const colors: Record<TriageStatus, string> = {
                  do_now: active ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground/50 border-border/30 hover:border-primary/30",
                  watch: active ? "bg-amber-500/10 text-amber-400 border-amber-500/40" : "text-muted-foreground/50 border-border/30 hover:border-amber-500/30",
                  ignore: active ? "bg-muted/40 text-muted-foreground border-border/50" : "text-muted-foreground/50 border-border/30 hover:border-border/50",
                };
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleTriage(triageKey(rec), rec.recommendation_id, s)}
                    className={cn("text-[8px] font-mono rounded px-1.5 py-0.5 border transition-colors", colors[s])}
                  >
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  )};

  // Triage summary counts — visible non-suppressed only
  const triageCounts = useMemo(() => {
    const counts = { do_now: 0, watch: 0, ignore: 0 };
    if (!displayResult) return counts;
     const visibleKeys = new Set(displayResult.all_display.filter(r => !r.suppressed).map(r => triageKey(r)));
    for (const [key, status] of Object.entries(triageMap)) {
      if (visibleKeys.has(key)) counts[status]++;
    }
    return counts;
  }, [triageMap, displayResult]);

  const hasAnyTriage = triageCounts.do_now + triageCounts.watch + triageCounts.ignore > 0;

  const DisplayBucket = ({ title, icon: Icon, bucketKey }: { title: string; icon: any; bucketKey: RecommendationBucketKey }) => {
    if (!displayResult) return null;
    const allItems = displayResult.display_buckets[bucketKey];
    const visible = showSuppressed ? allItems : allItems.filter(d => !d.suppressed);
    if (visible.length === 0) return null;
    const activeCount = allItems.filter(d => !d.suppressed).length;
    const suppressedCount = allItems.filter(d => d.suppressed).length;
    return (
      <Collapsible defaultOpen={visible.some(r => !r.suppressed && r.severity === "high")}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-0.5">
            <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
            <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
            <Icon className="h-3 w-3" />
            <span className="font-semibold">{title}</span>
            <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/40 ml-1">{activeCount}</Badge>
            {suppressedCount > 0 && (
              <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/40 border-border/20 ml-0.5">
                +{suppressedCount} suppressed
              </Badge>
            )}
            {visible.some(r => !r.suppressed && r.severity === "high") && (
              <Badge variant="outline" className="text-[8px] font-mono text-red-400 border-red-500/30 ml-0.5">HIGH</Badge>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1.5 pt-1.5 pl-4">
          {visible.map(rec => <RecCard key={rec.recommendation_id} rec={rec} suppressed={rec.suppressed} />)}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Lightbulb className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Execution Recommendations</span>
          {summary && (
            <div className="flex items-center gap-1 ml-1">
              {summary.high_severity_count > 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-red-400 border-red-500/30">
                  {summary.high_severity_count} high
                </Badge>
              )}
              {summary.medium_severity_count > 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-amber-400 border-amber-500/30">
                  {summary.medium_severity_count} medium
                </Badge>
              )}
              {summary.generated_recommendations === 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-emerald-400 border-emerald-500/30">
                  healthy
                </Badge>
              )}
            </div>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {!loaded && (
          <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={load} disabled={loading}>
            {loading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Lightbulb className="h-3 w-3 mr-1" />}
            {loading ? 'Analysing\u2026' : 'Load Recommendations'}
          </Button>
        )}

        {loaded && !recs && (
          <div className="text-[10px] text-muted-foreground italic">No recommendation data available.</div>
        )}

        {recs && displayResult && report && (
          <div className="space-y-3">
            {/* Summary row + suppression audit strip */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] text-muted-foreground font-mono">{summary?.total_snapshots} snapshots</span>
              <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/40">
                {report.display_total} display
              </Badge>
              {report.suppressed_total > 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground/50 border-border/30">
                  {report.suppressed_total} suppressed
                </Badge>
              )}
              <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground/40 border-border/20">
                {report.raw_total} raw
              </Badge>
              {summary?.generated_recommendations === 0 ? (
                <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">
                  No recommendations — all metrics within thresholds
                </Badge>
              ) : (
                <>
                  {(summary?.high_severity_count ?? 0) > 0 && <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">{summary!.high_severity_count} high</Badge>}
                  {(summary?.medium_severity_count ?? 0) > 0 && <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30">{summary!.medium_severity_count} medium</Badge>}
                  {(summary?.low_severity_count ?? 0) > 0 && <Badge variant="outline" className="text-[9px] text-muted-foreground border-border/50">{summary!.low_severity_count} low</Badge>}
                </>
              )}
            </div>

            {/* Suppression controls */}
            {report.suppressed_total > 0 && (
              <div className="space-y-1">
                <div className="text-[8px] text-muted-foreground/50 italic">
                  {report.suppressed_total} redundant or lower-priority variants hidden — retained for audit.
                </div>
                <button
                  onClick={() => setShowSuppressed(p => !p)}
                  className="flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  {showSuppressed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showSuppressed ? 'Hide suppressed' : 'Show suppressed'}
                </button>
              </div>
            )}

            {/* Change detection summary strip */}
            {(() => {
              const entries = Object.values(changeMap);
              const newCount = entries.filter(e => e.change_status === "new").length;
              const worsenedCount = entries.filter(e => e.change_status === "worsened").length;
              const improvedCount = entries.filter(e => e.change_status === "improved").length;
              const resolvedCount = entries.filter(e => e.change_status === "resolved").length;
              const hasChanges = newCount + worsenedCount + improvedCount + resolvedCount > 0;
              if (!hasChanges) return null;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[8px] font-mono text-muted-foreground/50 uppercase">Changes since last run:</span>
                  {newCount > 0 && (
                    <Badge variant="outline" className="text-[8px] font-mono text-blue-400 border-blue-500/30 bg-blue-500/10">
                      {newCount} new
                    </Badge>
                  )}
                  {worsenedCount > 0 && (
                    <Badge variant="outline" className="text-[8px] font-mono text-red-400 border-red-500/30 bg-red-500/10">
                      {worsenedCount} worsened
                    </Badge>
                  )}
                  {improvedCount > 0 && (
                    <Badge variant="outline" className="text-[8px] font-mono text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                      {improvedCount} improved
                    </Badge>
                  )}
                  {resolvedCount > 0 && (
                    <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/40 bg-muted/20">
                      {resolvedCount} resolved
                    </Badge>
                  )}
                </div>
              );
            })()}

            {/* Resolved recommendations section */}
            {(() => {
              const resolved = Object.entries(changeMap)
                .filter(([, e]) => e.change_status === "resolved")
                .map(([id, e]) => ({ recommendation_id: id, ...e }));
              if (resolved.length === 0) return null;
              return (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-0.5">
                      <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                      <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                      <CheckCircle className="h-3 w-3 text-emerald-400" />
                      <span className="font-semibold">Resolved Since Last Run</span>
                      <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/40 ml-1">
                        {resolved.length}
                      </Badge>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4 pt-1.5 space-y-1">
                    {resolved.map(r => (
                      <div key={r.recommendation_id} className="rounded border border-border/20 bg-muted/10 px-3 py-1.5 flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[9px] font-semibold text-muted-foreground">{r.title || r.recommendation_id}</span>
                          {r.rule_id && <span className="text-[7px] font-mono text-muted-foreground/40 ml-1.5">({r.rule_id})</span>}
                        </div>
                        <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/30 shrink-0">
                          was {r.previous_severity}
                        </Badge>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })()}

            {/* Triage summary strip */}
            {hasAnyTriage && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[8px] font-mono text-muted-foreground/50 uppercase">Triage:</span>
                {triageCounts.do_now > 0 && (
                  <Badge variant="outline" className="text-[8px] font-mono text-primary border-primary/40 bg-primary/10">
                    {triageCounts.do_now} do now
                  </Badge>
                )}
                {triageCounts.watch > 0 && (
                  <Badge variant="outline" className="text-[8px] font-mono text-amber-400 border-amber-500/40 bg-amber-500/10">
                    {triageCounts.watch} watch
                  </Badge>
                )}
                {triageCounts.ignore > 0 && (
                  <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/50 bg-muted/30">
                    {triageCounts.ignore} ignore
                  </Badge>
                )}
              </div>
            )}

            {/* Bulk triage controls */}
            {displayResult && (() => {
               const visible = displayResult.all_display.filter(r => !r.suppressed);
              const highItems = visible.filter(r => r.severity === "high").map(r => ({ compKey: triageKey(r), recId: r.recommendation_id }));
              const medItems = visible.filter(r => r.severity === "medium").map(r => ({ compKey: triageKey(r), recId: r.recommendation_id }));
              const visibleItems = visible.map(r => ({ compKey: triageKey(r), recId: r.recommendation_id }));
              const canDoNow = highItems.some(item => triageMap[item.compKey] !== "do_now");
              const canWatch = medItems.some(item => triageMap[item.compKey] !== "watch");
              const canClear = visibleItems.some(item => triageMap[item.compKey]);

              const applyBulk = (items: { compKey: string; recId: string }[], status: TriageStatus) => {
                setTriageMap(prev => {
                  const next = { ...prev };
                  items.forEach(item => { next[item.compKey] = status; });
                  return next;
                });
                persistBulkTriage(items, status);
                setBulkFeedback(status === "do_now" ? "Updated do now" : status === "watch" ? "Updated watch" : "Updated ignore");
                setTimeout(() => setBulkFeedback(null), 1200);
              };

              const clearAll = () => {
                const itemsToDelete = visibleItems.filter(item => triageMap[item.compKey]);
                setTriageMap(prev => {
                  const next = { ...prev };
                  visibleItems.forEach(item => { delete next[item.compKey]; });
                  return next;
                });
                if (itemsToDelete.length > 0) deleteBulkTriage(itemsToDelete.map(item => item.compKey));
                setBulkFeedback("Cleared triage");
                setTimeout(() => setBulkFeedback(null), 1200);
              };

              return (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[8px] font-mono text-muted-foreground/40 uppercase">Bulk:</span>
                  <button
                    disabled={!canDoNow || highItems.length === 0}
                    onClick={() => applyBulk(highItems, "do_now")}
                    className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Do now: all high ({highItems.length})
                  </button>
                  <button
                    disabled={!canWatch || medItems.length === 0}
                    onClick={() => applyBulk(medItems, "watch")}
                    className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Watch: all medium ({medItems.length})
                  </button>
                  <button
                    disabled={!canClear}
                    onClick={clearAll}
                    className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Clear triage
                  </button>
                  {bulkFeedback && (
                    <span className="text-[8px] font-mono text-primary/70">{bulkFeedback}</span>
                  )}
                </div>
              );
            })()}

            {/* Export Triage JSON */}
            {displayResult && (() => {
              const sevOrd: Record<string, number> = { high: 0, medium: 1, low: 2 };
              const confOrd: Record<string, number> = { high: 0, medium: 1, low: 2 };
              const statusOrd: Record<string, number> = { do_now: 0, watch: 1, ignore: 2 };
              const visible = displayResult.all_display.filter(r => !r.suppressed && triageMap[triageKey(r)]);
              const sorted = [...visible].sort((a, b) =>
                (statusOrd[triageMap[triageKey(a)] ?? ''] ?? 3) - (statusOrd[triageMap[triageKey(b)] ?? ''] ?? 3)
                || (sevOrd[a.severity] ?? 3) - (sevOrd[b.severity] ?? 3)
                || (confOrd[a.confidence] ?? 3) - (confOrd[b.confidence] ?? 3)
                || a.recommendation_id.localeCompare(b.recommendation_id)
              );
              const cts = { do_now: 0, watch: 0, ignore: 0 };
              sorted.forEach(r => { const s = triageMap[triageKey(r)]; if (s) cts[s]++; });
              const exportJson = {
                export_version: "triage-export-v1" as const,
                exported_at: new Date().toISOString(),
                project_id: projectId,
                counts: { ...cts, total: sorted.length },
                items: sorted.map(r => ({
                  recommendation_id: r.recommendation_id,
                  comparison_key: triageKey(r),
                  triage_status: triageMap[triageKey(r)],
                  title: r.title,
                  severity: r.severity,
                  confidence: r.confidence,
                  rule_id: r.rule_id,
                  category: r.category,
                  source_bucket: r.source_bucket,
                  suggested_action: r.suggested_action,
                  suppressed: false as const,
                })),
              };
              const doExport = async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(exportJson, null, 2));
                  setTriageJsonCopied("Copied");
                  setTimeout(() => setTriageJsonCopied(null), 1500);
                } catch {
                  setTriageJsonCopied("Copy failed");
                  setTimeout(() => setTriageJsonCopied(null), 2000);
                }
              };
              return (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={doExport}
                    className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {triageJsonCopied || "Export triage JSON"}
                  </button>
                </div>
              );
            })()}

            {/* Insufficient history note */}
            {summary && summary.total_snapshots < 3 && (
              <div className="text-[9px] text-muted-foreground italic">
                Insufficient execution history for recommendations (need ≥ 3 snapshots, have {summary.total_snapshots}).
              </div>
            )}

            <DisplayBucket title="Top Priorities"           icon={AlertTriangle} bucketKey="top_priorities" />
            <DisplayBucket title="Blocker Mitigations"      icon={XCircle}       bucketKey="blocker_mitigations" />
            <DisplayBucket title="Repair Type Watchlist"    icon={Wrench}        bucketKey="repair_type_watchlist" />
            <DisplayBucket title="Source Type Watchlist"    icon={FileText}      bucketKey="source_type_watchlist" />
            <DisplayBucket title="Document Type Stability"  icon={FileCode}      bucketKey="document_type_watchlist" />
            <DisplayBucket title="Governance Gaps"          icon={Shield}        bucketKey="governance_gaps" />
            <DisplayBucket title="Revalidation Gaps"        icon={RefreshCw}     bucketKey="revalidation_gaps" />
            <DisplayBucket title="Suggested Next Actions"   icon={ArrowRight}    bucketKey="suggested_next_actions" />

            {summary?.generated_recommendations === 0 && summary.total_snapshots >= 3 && (
              <div className="flex items-center gap-1.5 text-[9px] text-emerald-400">
                <CheckCircle className="h-3 w-3" />
                All tracked metrics are within healthy thresholds across {summary.total_snapshots} snapshots.
              </div>
            )}

            {/* ── Recommendation Action Queue ── */}
            {hasAnyTriage && displayResult && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-0.5">
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <List className="h-3 w-3" />
                    <span className="font-semibold">Action Queue</span>
                    <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/40 ml-1">
                      {triageCounts.do_now + triageCounts.watch + triageCounts.ignore}
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1.5 space-y-2">
                  {(["do_now", "watch", "ignore"] as const).map(status => {
                    const items = displayResult.all_display.filter(r => triageMap[triageKey(r)] === status && !r.suppressed);
                    if (items.length === 0) return null;
                    const statusLabels: Record<TriageStatus, string> = { do_now: "Do Now", watch: "Watch", ignore: "Ignored" };
                    const statusColors: Record<TriageStatus, string> = {
                      do_now: "text-primary border-primary/30",
                      watch: "text-amber-400 border-amber-500/30",
                      ignore: "text-muted-foreground/60 border-border/30",
                    };
                    return (
                      <div key={status} className="space-y-1">
                        <div className={cn("text-[8px] font-mono font-semibold uppercase", statusColors[status].split(" ")[0])}>
                          {statusLabels[status]} ({items.length})
                        </div>
                        {items.map(rec => (
                          <div
                            key={rec.recommendation_id}
                            className={cn("rounded border px-2 py-1.5 space-y-0.5 cursor-pointer hover:bg-muted/20 transition-colors", statusColors[status].split(" ").slice(1).join(" "), "bg-muted/10")}
                            onClick={() => {
                              const el = cardRefs.current[rec.recommendation_id];
                              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                            title="Click to jump to card"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[9px] font-semibold text-foreground">{rec.title}</span>
                              <Badge variant="outline" className={cn("text-[7px] font-mono shrink-0", sevColor(rec.severity))}>
                                {rec.severity}
                              </Badge>
                              <span className="text-[7px] font-mono text-muted-foreground/40">{rec.rule_id}</span>
                              {(() => {
                                const change = changeMap[rec.recommendation_id];
                                if (!change || change.change_status === "unchanged") return null;
                                const cfg: Record<string, { label: string; cls: string }> = {
                                  new: { label: "NEW", cls: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
                                  worsened: { label: "WORSENED", cls: "text-red-400 border-red-500/30 bg-red-500/10" },
                                  improved: { label: "IMPROVED", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
                                };
                                const c = cfg[change.change_status];
                                if (!c) return null;
                                return <Badge variant="outline" className={cn("text-[6px] font-mono shrink-0", c.cls)}>{c.label}</Badge>;
                              })()}
                            </div>
                            <div className="text-[8px] text-muted-foreground leading-snug border-l-2 border-border/30 pl-1.5">
                              {rec.suggested_action}
                            </div>
                            {rec.recommended_actions && rec.recommended_actions.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                                {rec.recommended_actions.filter(a => !a.destructive).map((action, i) => (
                                  <button
                                    key={`${action.action_type}-${i}`}
                                    type="button"
                                    className="text-[7px] font-mono px-1 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary/80 hover:text-primary hover:bg-primary/10 transition-colors"
                                    title={`${action.action_type}: ${JSON.stringify(action.params)}`}
                                    onClick={() => dispatchRecommendedAction(action)}
                                  >
                                    {action.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            {status === "do_now" && onRouteToRepairs && (
                              <div className="flex items-center" onClick={e => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="text-[7px] font-mono px-1.5 py-0.5 rounded border border-accent/40 bg-accent/10 text-accent-foreground/80 hover:text-accent-foreground hover:bg-accent/20 transition-colors flex items-center gap-1"
                                  title="Switch to Repairs tab and scroll to repair queue"
                                  onClick={() => onRouteToRepairs({
                                    title: rec.title,
                                    rule_id: rec.rule_id,
                                    severity: rec.severity,
                                    suggested_action: rec.suggested_action,
                                  })}
                                >
                                  <ArrowRight className="h-2.5 w-2.5" />
                                  Route to Repair
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* ── Action Memo ── */}
            {(() => {
              const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
              const confOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
              const sortItems = (items: DisplayRecommendation[]) =>
                [...items].sort((a, b) =>
                  (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
                  || (confOrder[a.confidence] ?? 3) - (confOrder[b.confidence] ?? 3)
                  || a.recommendation_id.localeCompare(b.recommendation_id)
                );
              const buckets: { status: TriageStatus; label: string; items: DisplayRecommendation[] }[] = (["do_now", "watch", "ignore"] as const).map(s => ({
                status: s,
                label: s === "do_now" ? "DO NOW" : s === "watch" ? "WATCH" : "IGNORE",
                items: sortItems(displayResult?.all_display.filter(r => !r.suppressed && triageMap[triageKey(r)] === s) ?? []),
              })).filter(b => b.items.length > 0);
              const hasMemo = buckets.length > 0;

              const buildPlain = () => {
                let out = "Execution Recommendations Action Memo\n" + "=".repeat(42) + "\n\n";
                for (const b of buckets) {
                  out += `── ${b.label} ──\n`;
                  for (const r of b.items) {
                    out += `• [${r.severity.toUpperCase()}] ${r.title} (${r.rule_id})\n  Action: ${r.suggested_action}\n`;
                    const firstAction = r.recommended_actions?.find(a => !a.destructive);
                    if (firstAction) out += `  Inspect: ${firstAction.label}\n`;
                  }
                  out += "\n";
                }
                return out.trimEnd();
              };

              const buildMarkdown = () => {
                let out = "# Execution Recommendations Action Memo\n\n";
                for (const b of buckets) {
                  out += `## ${b.label}\n\n`;
                    for (const r of b.items) {
                      out += `- **[${r.severity.toUpperCase()}]** ${r.title} _(${r.rule_id})_\n  - Action: ${r.suggested_action}\n`;
                      const firstAction = r.recommended_actions?.find(a => !a.destructive);
                      if (firstAction) out += `  - Inspect: ${firstAction.label}\n`;
                    }
                  out += "\n";
                }
                return out.trimEnd();
              };

              return (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-0.5">
                      <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                      <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                      <FileText className="h-3 w-3" />
                      <span className="font-semibold">Action Memo</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4 pt-1.5 space-y-2">
                    {!hasMemo ? (
                      <p className="text-[9px] text-muted-foreground/50 italic">No triaged recommendations yet.</p>
                    ) : (
                      <>
                        {(() => {
                          const doCopy = async (label: string, text: string) => {
                            try { await navigator.clipboard.writeText(text); setMemoCopied(label); setTimeout(() => setMemoCopied(null), 1500); } catch {}
                          };
                          return (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => doCopy("plain", buildPlain())} className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground transition-colors">
                                {memoCopied === "plain" ? "Copied" : "Copy Memo"}
                              </button>
                              <button onClick={() => doCopy("md", buildMarkdown())} className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground transition-colors">
                                {memoCopied === "md" ? "Copied" : "Copy Markdown"}
                              </button>
                            </div>
                          );
                        })()}
                        <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2 space-y-2">
                          {buckets.map(b => (
                            <div key={b.status} className="space-y-1">
                              <div className="text-[8px] font-mono font-semibold uppercase text-muted-foreground">{b.label}</div>
                              {b.items.map(r => (
                                <div key={r.recommendation_id} className="text-[8px] leading-snug text-muted-foreground">
                                  <span className="font-semibold text-foreground">[{r.severity.toUpperCase()}]</span>{" "}
                                  {r.title}{" "}
                                  <span className="text-muted-foreground/40">({r.rule_id})</span>
                                  <div className="pl-2 border-l border-border/30 mt-0.5">{r.suggested_action}</div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })()}

            {report.suppressed_total > 0 && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full pt-1">
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <span className="font-mono font-semibold uppercase tracking-wider text-[8px]">Suppression Audit</span>
                    <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/40 border-border/20 ml-1">
                      {report.suppressed_total} items
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1.5 space-y-2">
                  {/* Reason summary */}
                  <div className="flex flex-wrap gap-1">
                    {report.suppression_reasons.map(r => (
                      <Badge key={r.reason} variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/20">
                        {r.reason}: {r.count}
                      </Badge>
                    ))}
                  </div>
                  {/* Suppressed items list — scrollable for long histories */}
                  <div className="rounded-md border border-border/20 bg-muted/10 max-h-52 overflow-y-auto">
                    <div className="sticky top-0 z-10 grid grid-cols-[1fr_1fr_auto] gap-x-2 px-2 py-1 border-b border-border/15 bg-muted/30">
                      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Rec ID</span>
                      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Reason</span>
                      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Retained By</span>
                    </div>
                    {report.suppressed_items.map(item => (
                      <div key={item.recommendation_id} className="grid grid-cols-[1fr_1fr_auto] gap-x-2 px-2 py-1 border-b border-border/10 last:border-0">
                        <span className="text-[8px] font-mono text-muted-foreground/60 truncate">{item.recommendation_id}</span>
                        <span className="text-[8px] font-mono text-muted-foreground/50 truncate">{item.reason}</span>
                        <span className="text-[8px] font-mono text-muted-foreground/40 truncate">{item.suppressed_by_recommendation_id || "—"}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Calibration Panel */}
            {data?.recommendations_calibration && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors w-full pt-1">
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <span className="font-mono font-semibold uppercase tracking-wider text-[8px]">Recommendation Calibration</span>
                    <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/20 ml-1">
                      {data.recommendations_calibration.threshold_version}
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1.5">
                  <div className="rounded-md border border-border/30 bg-muted/10 overflow-hidden">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 px-2 py-1 border-b border-border/20 bg-muted/20">
                      <span className="text-[8px] font-mono font-semibold text-muted-foreground/60 uppercase">Rule</span>
                      <span className="text-[8px] font-mono font-semibold text-muted-foreground/60 uppercase">Key Thresholds</span>
                      <span className="text-[8px] font-mono font-semibold text-muted-foreground/60 uppercase">Sample Support</span>
                    </div>
                    {data.recommendations_calibration.rules.map(rule => {
                      const primarySupport = rule.minimum_sample_support.find(s => s.minimum_required !== null && s.minimum_required > 0) ?? rule.minimum_sample_support[0];
                      const sufficient = primarySupport?.sufficient;
                      const supportColor = sufficient === true ? "text-emerald-400" : sufficient === false ? "text-red-400" : "text-muted-foreground/50";
                      const keyThresholds = Object.entries(rule.threshold_fields).slice(0, 2);
                      return (
                        <Collapsible key={rule.rule_id}>
                          <CollapsibleTrigger asChild>
                            <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 px-2 py-1.5 border-b border-border/10 hover:bg-muted/20 transition-colors cursor-pointer items-start">
                              <div className="flex items-center gap-1">
                                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0 [[data-state=open]>&]:hidden" />
                                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0 hidden [[data-state=open]>&]:block" />
                                <span className="text-[8px] font-mono text-muted-foreground/70 truncate">{rule.rule_id.replace("REC_", "")}</span>
                              </div>
                              <div className="flex flex-wrap gap-0.5">
                                {keyThresholds.map(([k, v]) => (
                                  <span key={k} className="text-[7px] font-mono text-muted-foreground/60 bg-muted/30 border border-border/20 rounded px-1 py-0.5">
                                    {k.replace(/_pct$|_ms$/, "")}: {String(v)}
                                  </span>
                                ))}
                              </div>
                              <div className={cn("text-[7px] font-mono shrink-0", supportColor)}>
                                {primarySupport ? (
                                  <span title={`${primarySupport.metric_name}: ${primarySupport.sample_count ?? "N/A"} / min ${primarySupport.minimum_required ?? "N/A"}`}>
                                    {primarySupport.sample_count ?? "—"}{primarySupport.minimum_required != null ? `/${primarySupport.minimum_required}` : ""}
                                    {sufficient === true && " ✓"}
                                    {sufficient === false && " ✗"}
                                  </span>
                                ) : <span>—</span>}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="px-3 py-1.5 bg-muted/10 border-b border-border/10 space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(rule.threshold_fields).map(([k, v]) => (
                                <span key={k} className="text-[7px] font-mono text-muted-foreground/50 bg-muted/20 border border-border/15 rounded px-1 py-0.5">
                                  {k}: {String(v)}
                                </span>
                              ))}
                            </div>
                            {rule.denominator_notes.length > 0 && (
                              <div className="space-y-0.5">
                                <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Denominator Notes</span>
                                {rule.denominator_notes.map((n, i) => (
                                  <div key={i} className="text-[8px] text-muted-foreground/60 leading-snug">• {n}</div>
                                ))}
                              </div>
                            )}
                            {rule.calibration_notes.length > 0 && (
                              <div className="space-y-0.5">
                                <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Calibration Notes</span>
                                {rule.calibration_notes.map((n, i) => (
                                  <div key={i} className="text-[8px] text-amber-400/50 leading-snug">⚠ {n}</div>
                                ))}
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <Button variant="ghost" size="sm" className="text-[9px] h-6" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── ExecutionTrendsSection ────────────────────────────────────────────────────
// Read-only trend surface comparing two adjacent windows of persisted replay
// snapshots. No execution-path changes. No mutation.

function ExecutionTrendsSection({ projectId, navigationTarget, onTargetHandled }: {
  projectId: string;
  navigationTarget: TrendNavigationTarget | null;
  onTargetHandled: () => void;
}) {
  const [data, setData] = useState<PatchExecutionTrendsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [forcedOpenSubs, setForcedOpenSubs] = useState<Set<TrendSubsectionKey>>(new Set());
  const [highlightedEntity, setHighlightedEntity] = useState<{ subsection: TrendSubsectionKey; entity?: string; at: number } | null>(null);
  const [emptyTargetNotice, setEmptyTargetNotice] = useState<{ subsection_label: string; entity?: string } | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchPatchExecutionRecommendationTrends(projectId, { recent_limit: 25, prior_limit: 25 });
      if (res?.ok) setData(res);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  // ── Subsection emptiness check for action-driven navigation ──
  // Entity subsections are conditionally rendered (length > 0).
  // When navigation targets an empty subsection, warn in DEV.
  const ARRAY_SUBSECTIONS: TrendSubsectionKey[] = [
    'blocker_code_trends', 'repair_type_trends', 'source_type_trends', 'document_type_trends',
  ];
  const isSubsectionEmpty = useCallback((sub: TrendSubsectionKey, trendData: typeof data): boolean => {
    if (!trendData?.trends) return true;
    if (!ARRAY_SUBSECTIONS.includes(sub)) return false; // non-array subsections always render
    const arr = (trendData.trends as unknown as Record<string, unknown>)[sub];
    return !Array.isArray(arr) || arr.length === 0;
  }, []);

  // React to navigation target from recommendations / action dispatcher
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!navigationTarget) return;
    const { subsection_key, entity_key, activated_at } = navigationTarget;

    // Clear any stale highlight timer from prior navigation
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }

    const SUBSECTION_LABELS: Partial<Record<TrendSubsectionKey, string>> = {
      blocker_code_trends: 'Blocker Code Trends',
      repair_type_trends: 'Repair Type Trends',
      source_type_trends: 'Source Type Trends',
      document_type_trends: 'Document Type Trends',
      overall_outcomes: 'Overall Outcomes',
      governance_trends: 'Governance Trends',
      timing_trends: 'Timing Trends',
      revalidation_trends: 'Revalidation Trends',
    };

    const applyNavigation = (loadedData: typeof data) => {
      setSectionOpen(true);
      setForcedOpenSubs(prev => new Set(prev).add(subsection_key));
      setHighlightedEntity({ subsection: subsection_key, entity: entity_key, at: activated_at });

      // Empty-target UX: show transient notice when subsection has no data rows
      if (isSubsectionEmpty(subsection_key, loadedData)) {
        setEmptyTargetNotice({
          subsection_label: SUBSECTION_LABELS[subsection_key] ?? subsection_key,
          entity: entity_key,
        });
        if (import.meta.env.DEV) {
          console.warn(
            `[IFFY nav] Subsection "${subsection_key}" has no data — forced-open and highlight will have no DOM target.`,
            entity_key ? `Entity: "${entity_key}"` : '(header-level)',
          );
        }
      } else {
        setEmptyTargetNotice(null);
      }

      setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    };

    // Auto-load if not loaded
    if (!loaded && !loading) {
      load().then(() => applyNavigation(data));
    } else {
      applyNavigation(data);
    }

    // Clear highlight and empty-target notice after 4 seconds
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedEntity(null);
      setEmptyTargetNotice(null);
    }, 4000);
    // Acknowledge navigation target handled
    onTargetHandled();
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [navigationTarget]);

  // onSubOpenChange: clear forced-open when user manually closes
  const onSubOpenChange = (key: TrendSubsectionKey, open: boolean) => {
    if (!open) {
      setForcedOpenSubs(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  // Is a specific row highlighted?
  const isRowHighlighted = (subsection: TrendSubsectionKey, entityKey?: string) => {
    if (!highlightedEntity) return false;
    if (highlightedEntity.subsection !== subsection) return false;
    if (entityKey && highlightedEntity.entity) return highlightedEntity.entity === entityKey;
    return !entityKey || !highlightedEntity.entity; // header-level
  };

  const highlightClass = "ring-1 ring-primary/40 bg-primary/5 rounded transition-all duration-500";

  const trends = data?.trends;

  // Direction → color + symbol
  const dirColor = (d: TrendDirection | undefined) => {
    if (!d || d === "insufficient_data") return "text-muted-foreground/40";
    if (d === "improving") return "text-emerald-400";
    if (d === "worsening") return "text-red-400";
    return "text-muted-foreground/60";
  };
  const dirSymbol = (d: TrendDirection | undefined, higherIsBetter?: boolean) => {
    if (!d || d === "insufficient_data") return "—";
    if (d === "flat") return "→";
    if (d === "improving") return higherIsBetter ? "↑" : "↓";
    return higherIsBetter ? "↓" : "↑";
  };

  // Compact metric row
  const MetricRow = ({
    label, prior, recent, delta, direction, unit = "", higherBetter = false,
  }: {
    label: string;
    prior: number | null;
    recent: number | null;
    delta: number | null;
    direction: TrendDirection;
    unit?: string;
    higherBetter?: boolean;
  }) => (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 py-0.5 border-b border-border/10 last:border-0">
      <span className="text-[9px] text-muted-foreground truncate">{label}</span>
      <span className="text-[8px] font-mono text-muted-foreground/50 w-10 text-right">{prior != null ? `${prior}${unit}` : "—"}</span>
      <span className="text-[8px] font-mono text-foreground/80 w-10 text-right">{recent != null ? `${recent}${unit}` : "—"}</span>
      <div className={cn("text-[9px] font-mono font-semibold w-10 text-right flex items-center justify-end gap-0.5", dirColor(direction))}>
        <span>{dirSymbol(direction, higherBetter)}</span>
        {delta != null && delta !== 0 && (
          <span className="text-[8px]">{delta > 0 ? `+${delta}` : `${delta}`}{unit}</span>
        )}
      </div>
    </div>
  );

  // Sub-table header
  const SubHeader = () => (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 pb-0.5 mb-0.5 border-b border-border/20">
      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Metric</span>
      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Prior</span>
      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Recent</span>
      <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Δ</span>
    </div>
  );

  // Signal indicator badge
  const SignalBadge = ({ label, d }: { label: string; d: TrendDirection }) => (
    <div className={cn("flex items-center gap-1 text-[8px] font-mono rounded px-1.5 py-0.5 border",
      d === "improving" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" :
      d === "worsening" ? "text-red-400 border-red-500/30 bg-red-500/5" :
      d === "flat"      ? "text-muted-foreground/60 border-border/30" :
      "text-muted-foreground/30 border-border/20")}>
      <span>{dirSymbol(d)}</span>
      <span>{label}</span>
    </div>
  );

  return (
    <div ref={sectionRef}>
    <Collapsible open={sectionOpen || undefined} onOpenChange={setSectionOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <TrendingUp className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Execution Trends</span>
          {trends?.window_summary && (
            <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground/60 border-border/30 ml-1">
              {trends.window_summary.recent_count}r / {trends.window_summary.prior_count}p
            </Badge>
          )}
          {trends && !trends.window_summary.sufficient_for_comparison && (
            <Badge variant="outline" className="text-[8px] font-mono text-amber-400 border-amber-500/30 ml-1">
              insufficient data
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {!loaded && (
          <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={load} disabled={loading}>
            {loading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <TrendingUp className="h-3 w-3 mr-1" />}
            {loading ? 'Loading trends…' : 'Load Trends'}
          </Button>
        )}

        {loaded && !trends && (
          <div className="text-[10px] text-muted-foreground italic">No trend data available.</div>
        )}

        {data?.insufficient_data && (
          <div className="text-[9px] text-amber-400 italic">{data.insufficient_reason}</div>
        )}

        {emptyTargetNotice && (
          <div className="text-[9px] text-amber-400 italic border border-amber-500/20 rounded px-2 py-1 bg-amber-500/5">
            Opened {emptyTargetNotice.subsection_label}, but no trend rows are currently available{emptyTargetNotice.entity ? ` for "${emptyTargetNotice.entity}"` : ''}.
          </div>
        )}

        {trends && (
          <div className="space-y-3">
            {/* Window summary */}
            <div className="flex items-center gap-2 flex-wrap text-[9px] text-muted-foreground font-mono">
              <span>Recent: {trends.window_summary.recent_count} snapshots</span>
              <span className="text-muted-foreground/30">|</span>
              <span>Prior: {trends.window_summary.prior_count} snapshots</span>
              {trends.window_summary.sufficient_for_comparison
                ? <Badge variant="outline" className="text-[8px] text-emerald-400 border-emerald-500/30">comparable</Badge>
                : <Badge variant="outline" className="text-[8px] text-amber-400 border-amber-500/30">insufficient for comparison</Badge>
              }
            </div>

            {/* Signal summary strip */}
            <div className="flex flex-wrap gap-1">
              <SignalBadge label="health" d={trends.recommendation_signal_trends.overall_health_signal.direction} />
              <SignalBadge label="blockers" d={trends.recommendation_signal_trends.blocker_signal_count.direction} />
              <SignalBadge label="governance" d={trends.recommendation_signal_trends.governance_gap_signal.direction} />
              <SignalBadge label="revalidation" d={trends.recommendation_signal_trends.revalidation_gap_signal.direction} />
              <SignalBadge label="timing" d={trends.recommendation_signal_trends.timing_signal.direction} />
              <SignalBadge label="causal" d={trends.recommendation_signal_trends.causal_root_blocker_signal.direction} />
            </div>

            {/* Overall outcomes */}
            <Collapsible defaultOpen open={forcedOpenSubs.has("overall_outcomes") ? true : undefined} onOpenChange={(o) => onSubOpenChange("overall_outcomes", o)}>
              <CollapsibleTrigger asChild>
                <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("overall_outcomes") && highlightClass)}>
                  <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                  <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                  <span className="font-semibold">Overall Outcomes</span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 pt-1">
                <SubHeader />
                <MetricRow label="Executed rate" prior={trends.overall_outcomes.executed_rate_pct.prior} recent={trends.overall_outcomes.executed_rate_pct.recent} delta={trends.overall_outcomes.executed_rate_pct.delta} direction={trends.overall_outcomes.executed_rate_pct.direction} unit="%" higherBetter />
                <MetricRow label="Blocked rate" prior={trends.overall_outcomes.blocked_rate_pct.prior} recent={trends.overall_outcomes.blocked_rate_pct.recent} delta={trends.overall_outcomes.blocked_rate_pct.delta} direction={trends.overall_outcomes.blocked_rate_pct.direction} unit="%" />
                <MetricRow label="Failed rate" prior={trends.overall_outcomes.failed_rate_pct.prior} recent={trends.overall_outcomes.failed_rate_pct.recent} delta={trends.overall_outcomes.failed_rate_pct.delta} direction={trends.overall_outcomes.failed_rate_pct.direction} unit="%" />
                <MetricRow label="Partial or better" prior={trends.overall_outcomes.partial_or_better_rate_pct.prior} recent={trends.overall_outcomes.partial_or_better_rate_pct.recent} delta={trends.overall_outcomes.partial_or_better_rate_pct.delta} direction={trends.overall_outcomes.partial_or_better_rate_pct.direction} unit="%" higherBetter />
              </CollapsibleContent>
            </Collapsible>

            {/* Timing trends */}
            <Collapsible open={forcedOpenSubs.has("timing_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("timing_trends", o)}>
              <CollapsibleTrigger asChild>
                <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("timing_trends") && highlightClass)}>
                  <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                  <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                  <span className="font-semibold">Timing</span>
                  <span className={cn("text-[8px] font-mono ml-1", dirColor(trends.timing_trends.avg_section_execution_ms.direction))}>
                    {dirSymbol(trends.timing_trends.avg_section_execution_ms.direction)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 pt-1">
                <SubHeader />
                <MetricRow label="Avg total duration" prior={trends.timing_trends.avg_total_duration_ms.prior} recent={trends.timing_trends.avg_total_duration_ms.recent} delta={trends.timing_trends.avg_total_duration_ms.delta} direction={trends.timing_trends.avg_total_duration_ms.direction} unit="ms" />
                <MetricRow label="Avg section exec" prior={trends.timing_trends.avg_section_execution_ms.prior} recent={trends.timing_trends.avg_section_execution_ms.recent} delta={trends.timing_trends.avg_section_execution_ms.delta} direction={trends.timing_trends.avg_section_execution_ms.direction} unit="ms" />
                <MetricRow label="Section exec samples" prior={trends.timing_trends.section_execution_sample_count.prior} recent={trends.timing_trends.section_execution_sample_count.recent} delta={trends.timing_trends.section_execution_sample_count.delta} direction="flat" higherBetter />
              </CollapsibleContent>
            </Collapsible>

            {/* Governance trends */}
            <Collapsible open={forcedOpenSubs.has("governance_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("governance_trends", o)}>
              <CollapsibleTrigger asChild>
                <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("governance_trends") && highlightClass)}>
                  <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                  <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                  <span className="font-semibold">Governance</span>
                  <span className={cn("text-[8px] font-mono ml-1", dirColor(trends.governance_trends.governance_coverage_rate_pct.direction))}>
                    {dirSymbol(trends.governance_trends.governance_coverage_rate_pct.direction, true)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 pt-1">
                <SubHeader />
                <MetricRow label="Governance coverage" prior={trends.governance_trends.governance_coverage_rate_pct.prior} recent={trends.governance_trends.governance_coverage_rate_pct.recent} delta={trends.governance_trends.governance_coverage_rate_pct.delta} direction={trends.governance_trends.governance_coverage_rate_pct.direction} unit="%" higherBetter />
                <MetricRow label="Invalidation rate" prior={trends.governance_trends.invalidation_performed_rate_pct.prior} recent={trends.governance_trends.invalidation_performed_rate_pct.recent} delta={trends.governance_trends.invalidation_performed_rate_pct.delta} direction={trends.governance_trends.invalidation_performed_rate_pct.direction} unit="%" higherBetter />
              </CollapsibleContent>
            </Collapsible>

            {/* Revalidation trends */}
            <Collapsible open={forcedOpenSubs.has("revalidation_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("revalidation_trends", o)}>
              <CollapsibleTrigger asChild>
                <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("revalidation_trends") && highlightClass)}>
                  <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                  <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                  <span className="font-semibold">Revalidation</span>
                  <span className={cn("text-[8px] font-mono ml-1", dirColor(trends.revalidation_trends.revalidation_success_rate_pct.direction))}>
                    {dirSymbol(trends.revalidation_trends.revalidation_success_rate_pct.direction, true)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 pt-1">
                <SubHeader />
                <MetricRow label="Execution rate" prior={trends.revalidation_trends.revalidation_execution_rate_pct.prior} recent={trends.revalidation_trends.revalidation_execution_rate_pct.recent} delta={trends.revalidation_trends.revalidation_execution_rate_pct.delta} direction={trends.revalidation_trends.revalidation_execution_rate_pct.direction} unit="%" higherBetter />
                <MetricRow label="Full success rate" prior={trends.revalidation_trends.revalidation_success_rate_pct.prior} recent={trends.revalidation_trends.revalidation_success_rate_pct.recent} delta={trends.revalidation_trends.revalidation_success_rate_pct.delta} direction={trends.revalidation_trends.revalidation_success_rate_pct.direction} unit="%" higherBetter />
                <MetricRow label="Failure/deferral rate" prior={trends.revalidation_trends.revalidation_failure_or_deferral_rate_pct.prior} recent={trends.revalidation_trends.revalidation_failure_or_deferral_rate_pct.recent} delta={trends.revalidation_trends.revalidation_failure_or_deferral_rate_pct.delta} direction={trends.revalidation_trends.revalidation_failure_or_deferral_rate_pct.direction} unit="%" />
              </CollapsibleContent>
            </Collapsible>

            {/* Blocker code trends */}
            {trends.blocker_code_trends.length > 0 && (
              <Collapsible open={forcedOpenSubs.has("blocker_code_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("blocker_code_trends", o)}>
                <CollapsibleTrigger asChild>
                  <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("blocker_code_trends") && !highlightedEntity?.entity && highlightClass)}>
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <span className="font-semibold">Blocker Codes</span>
                    <Badge variant="outline" className="text-[8px] font-mono border-border/40 ml-1">{trends.blocker_code_trends.length}</Badge>
                    <span className={cn("text-[8px] font-mono ml-1", dirColor(trends.recommendation_signal_trends.blocker_signal_count.direction))}>
                      {dirSymbol(trends.recommendation_signal_trends.blocker_signal_count.direction)}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 pb-0.5 mb-0.5 border-b border-border/20">
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Code</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-8 text-right">Prior</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-8 text-right">Recent</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-8 text-right">Δ</span>
                  </div>
                  {trends.blocker_code_trends.slice(0, 10).map(b => (
                    <div key={b.blocker_code} className={cn("grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 py-0.5 border-b border-border/10 last:border-0", isRowHighlighted("blocker_code_trends", b.blocker_code) && highlightClass)}>
                      <span className="text-[8px] font-mono text-muted-foreground truncate">{b.blocker_code}</span>
                      <span className="text-[8px] font-mono text-muted-foreground/50 w-8 text-right">{b.prior_count}</span>
                      <span className="text-[8px] font-mono text-foreground/80 w-8 text-right">{b.recent_count}</span>
                      <span className={cn("text-[8px] font-mono font-semibold w-8 text-right", dirColor(b.direction))}>
                        {b.delta !== 0 ? (b.delta > 0 ? `+${b.delta}` : `${b.delta}`) : "—"}
                      </span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Repair type trends */}
            {trends.repair_type_trends.length > 0 && (
              <Collapsible open={forcedOpenSubs.has("repair_type_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("repair_type_trends", o)}>
                <CollapsibleTrigger asChild>
                  <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("repair_type_trends") && !highlightedEntity?.entity && highlightClass)}>
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <span className="font-semibold">Repair Type Issue Rates</span>
                    <Badge variant="outline" className="text-[8px] font-mono border-border/40 ml-1">{trends.repair_type_trends.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 pb-0.5 mb-0.5 border-b border-border/20">
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Type</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Prior%</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Recent%</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-8 text-right">Δ</span>
                  </div>
                  {trends.repair_type_trends.slice(0, 8).map(r => (
                    <div key={r.repair_type} className={cn("grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 py-0.5 border-b border-border/10 last:border-0", isRowHighlighted("repair_type_trends", r.repair_type) && highlightClass)}>
                      <span className="text-[8px] font-mono text-muted-foreground truncate" title={`prior n=${r.sample_prior} recent n=${r.sample_recent}`}>{r.repair_type}</span>
                      <span className="text-[8px] font-mono text-muted-foreground/50 w-10 text-right">{r.prior_bad_rate_pct != null ? `${r.prior_bad_rate_pct}%` : "—"}</span>
                      <span className="text-[8px] font-mono text-foreground/80 w-10 text-right">{r.recent_bad_rate_pct != null ? `${r.recent_bad_rate_pct}%` : "—"}</span>
                      <span className={cn("text-[8px] font-mono font-semibold w-8 text-right", dirColor(r.direction))}>
                        {r.delta != null && r.delta !== 0 ? (r.delta > 0 ? `+${r.delta}` : `${r.delta}`) : "—"}
                      </span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Source type trends */}
            {trends.source_type_trends.length > 0 && (
              <Collapsible open={forcedOpenSubs.has("source_type_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("source_type_trends", o)}>
                <CollapsibleTrigger asChild>
                  <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("source_type_trends") && !highlightedEntity?.entity && highlightClass)}>
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <span className="font-semibold">Source Type Issue Rates</span>
                    <Badge variant="outline" className="text-[8px] font-mono border-border/40 ml-1">{trends.source_type_trends.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 pb-0.5 mb-0.5 border-b border-border/20">
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Source</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Prior%</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Recent%</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-8 text-right">Δ</span>
                  </div>
                  {trends.source_type_trends.slice(0, 8).map(s => (
                    <div key={s.source_type} className={cn("grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 py-0.5 border-b border-border/10 last:border-0", isRowHighlighted("source_type_trends", s.source_type) && highlightClass)}>
                      <span className="text-[8px] font-mono text-muted-foreground truncate" title={`prior n=${s.sample_prior} recent n=${s.sample_recent}`}>{s.source_type}</span>
                      <span className="text-[8px] font-mono text-muted-foreground/50 w-10 text-right">{s.prior_bad_rate_pct != null ? `${s.prior_bad_rate_pct}%` : "—"}</span>
                      <span className="text-[8px] font-mono text-foreground/80 w-10 text-right">{s.recent_bad_rate_pct != null ? `${s.recent_bad_rate_pct}%` : "—"}</span>
                      <span className={cn("text-[8px] font-mono font-semibold w-8 text-right", dirColor(s.direction))}>
                        {s.delta != null && s.delta !== 0 ? (s.delta > 0 ? `+${s.delta}` : `${s.delta}`) : "—"}
                      </span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Document type trends */}
            {trends.document_type_trends.length > 0 && (
              <Collapsible open={forcedOpenSubs.has("document_type_trends") ? true : undefined} onOpenChange={(o) => onSubOpenChange("document_type_trends", o)}>
                <CollapsibleTrigger asChild>
                  <button className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full py-0.5", isRowHighlighted("document_type_trends") && !highlightedEntity?.entity && highlightClass)}>
                    <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
                    <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
                    <span className="font-semibold">Document Type Stability</span>
                    <Badge variant="outline" className="text-[8px] font-mono border-border/40 ml-1">{trends.document_type_trends.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 pb-0.5 mb-0.5 border-b border-border/20">
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase">Doc Type</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Prior%</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-10 text-right">Recent%</span>
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase w-8 text-right">Δ</span>
                  </div>
                  {trends.document_type_trends.slice(0, 8).map(d => (
                    <div key={d.doc_type} className={cn("grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 py-0.5 border-b border-border/10 last:border-0", isRowHighlighted("document_type_trends", d.doc_type) && highlightClass)}>
                      <span className="text-[8px] font-mono text-muted-foreground truncate" title={`prior n=${d.sample_prior} recent n=${d.sample_recent}`}>{d.doc_type}</span>
                      <span className="text-[8px] font-mono text-muted-foreground/50 w-10 text-right">{d.prior_instability_rate_pct != null ? `${d.prior_instability_rate_pct}%` : "—"}</span>
                      <span className="text-[8px] font-mono text-foreground/80 w-10 text-right">{d.recent_instability_rate_pct != null ? `${d.recent_instability_rate_pct}%` : "—"}</span>
                      <span className={cn("text-[8px] font-mono font-semibold w-8 text-right", dirColor(d.direction))}>
                        {d.delta != null && d.delta !== 0 ? (d.delta > 0 ? `+${d.delta}` : `${d.delta}`) : "—"}
                      </span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Top worsening + improving signals */}
            {(trends.top_worsening_signals.length > 0 || trends.top_improving_signals.length > 0) && (
              <div className="grid grid-cols-2 gap-2">
                {trends.top_worsening_signals.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[8px] font-mono text-red-400/70 uppercase font-semibold">↑ Worsening</div>
                    {trends.top_worsening_signals.map((s: TrendTopSignalEntry) => (
                      <div key={s.signal_key} className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1 space-y-0.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[8px] font-mono text-red-400 font-semibold">{s.signal_key}</span>
                          <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/20">{s.confidence}</Badge>
                        </div>
                        <div className="text-[8px] text-muted-foreground/70 leading-snug">{s.rationale}</div>
                      </div>
                    ))}
                  </div>
                )}
                {trends.top_improving_signals.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[8px] font-mono text-emerald-400/70 uppercase font-semibold">↓ Improving</div>
                    {trends.top_improving_signals.map((s: TrendTopSignalEntry) => (
                      <div key={s.signal_key} className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 space-y-0.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[8px] font-mono text-emerald-400 font-semibold">{s.signal_key}</span>
                          <Badge variant="outline" className="text-[7px] font-mono text-muted-foreground/50 border-border/20">{s.confidence}</Badge>
                        </div>
                        <div className="text-[8px] text-muted-foreground/70 leading-snug">{s.rationale}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button variant="ghost" size="sm" className="text-[9px] h-6" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
    </div>
  );
}
