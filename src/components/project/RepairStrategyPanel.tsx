/**
 * RepairStrategyPanel — Surfaces PRP1 preventive repair prioritization,
 * NRF1 axis debt context, and PRP2 strategic recommendation. Read-only UI.
 */

import { useState, useMemo, useEffect, Fragment } from 'react';
import {
  usePreventiveRepairPrioritization,
  fetchPatchTargets,
  fetchPatchPlan,
  fetchPatchPlanValidation,
  fetchPatchExecution,
  fetchPatchExecutionReplay,
  fetchPatchExecutionHistory,
  fetchPatchExecutionComparison,
  deriveExecutionOutcome,
  type PatchExecutionHistoryItem, type PatchExecutionHistoryResponse, type PatchExecutionHistoryCursor,
  type PatchExecutionHistoryFilters, type PatchExecutionOutcome,
  type PatchExecutionComparisonResponse, type MetricDiffEntry, type DocumentTimelineDiffEntry,
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface Props {
  projectId: string | undefined;
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

export function RepairStrategyPanel({ projectId }: Props) {
  const { prp1, nrf1, prp2, roi, prp2s, rcc, iv, isLoading, nrf1Loading, prp2Loading, roiLoading, prp2sLoading, rccLoading, ivLoading, error, refresh } = usePreventiveRepairPrioritization(projectId);
  const [selectedRepair, setSelectedRepair] = useState<PRP1Repair | null>(null);
  
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
