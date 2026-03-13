/**
 * RepairStrategyPanel — Surfaces PRP1 preventive repair prioritization,
 * NRF1 axis debt context, and PRP2 strategic recommendation. Read-only UI.
 */

import { useState, useMemo, Fragment } from 'react';
import {
  usePreventiveRepairPrioritization,
  type PRP1Repair, type AxisDebtEntry, type PRP2Data, type PRP2StrategyOption,
  type InterventionROIData, type ROIRepairEntry,
  type PRP2SData, type PRP2SStrategyOption, type PRP2SROIAdvisory,
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
  const { prp1, nrf1, prp2, roi, prp2s, isLoading, nrf1Loading, prp2Loading, roiLoading, prp2sLoading, error, refresh } = usePreventiveRepairPrioritization(projectId);
  const [selectedRepair, setSelectedRepair] = useState<PRP1Repair | null>(null);
  const [selectedStrategyOption, setSelectedStrategyOption] = useState<PRP2StrategyOption | null>(null);
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
              </CardContent>
            </Card>

            {/* Ranked Strategy Options Table */}
            {prp2.ranked_strategy_options.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
                    Ranked Strategy Options
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-xs w-[40px]">Rank</TableHead>
                          <TableHead className="text-xs">Repair Type</TableHead>
                          <TableHead className="text-xs w-[80px]">Score</TableHead>
                          <TableHead className="text-xs w-[80px]">Confidence</TableHead>
                          <TableHead className="text-xs">Primary Signals</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {prp2.ranked_strategy_options.map((opt, idx) => (
                          <TableRow
                            key={opt.repair_id}
                            className={cn(
                              'cursor-pointer hover:bg-muted/30 transition-colors border-border/30',
                              opt.repair_id === prp2.selected_repair_id && 'bg-primary/5'
                            )}
                            onClick={() => setSelectedStrategyOption(opt)}
                          >
                            <TableCell className="font-mono text-xs text-center">{idx + 1}</TableCell>
                            <TableCell className="font-mono text-xs">{opt.repair_type}</TableCell>
                            <TableCell className="font-mono text-xs text-center">{opt.strategic_priority_score.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs text-center">{Math.round(opt.recommendation_confidence * 100)}%</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(opt.primary_signals ?? []).slice(0, 3).map(s => (
                                  <Badge key={s} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{s}</Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Axis Debt Hotspots (PRP2) */}
            {prp2.axis_debt_hotspots && prp2.axis_debt_hotspots.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Shield className="h-3 w-3" />
                  Axis Debt Hotspots
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {prp2.axis_debt_hotspots.map(h => (
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
          </div>
        )}
      </div>

      {/* ═══ SECTION 4b: PRP2S STRATEGIC STRATEGY WITH ROI ADVISORY ═══ */}
      <PRP2SAdvisorySection prp2s={prp2s} prp2sLoading={prp2sLoading} />

      {/* ═══ SECTION 5: INTERVENTION ROI (READ-ONLY DIAGNOSTIC) ═══ */}
      <InterventionROISection roi={roi} roiLoading={roiLoading} />

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

      {/* ═══ STRATEGY OPTION DETAIL MODAL ═══ */}
      <Dialog open={!!selectedStrategyOption} onOpenChange={(open) => !open && setSelectedStrategyOption(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selectedStrategyOption?.repair_type}</DialogTitle>
            <DialogDescription className="text-xs">Strategy option detail</DialogDescription>
          </DialogHeader>
          {selectedStrategyOption && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Detail label="Strategic Score" value={selectedStrategyOption.strategic_priority_score.toFixed(2)} />
                <Detail label="Confidence" value={`${Math.round(selectedStrategyOption.recommendation_confidence * 100)}%`} />
              </div>
              {(selectedStrategyOption.primary_signals ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Primary Signals</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedStrategyOption.primary_signals.map(s => (
                      <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
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
          <Target className="h-3.5 w-3.5" /> Enhanced Strategy (PRP2S)
        </h3>
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
    );
  }

  if (!prp2s) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Enhanced Strategy (PRP2S)
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
          <Target className="h-3.5 w-3.5" /> Enhanced Strategy (PRP2S)
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
          Advisory ROI is shown for diagnostic comparison only. It does <strong>not</strong> affect the strategic priority score.
        </span>
      </div>

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
                    <TableHead className="text-xs">Repair</TableHead>
                    <TableHead className="text-xs w-[70px]">Strat Score</TableHead>
                    <TableHead className="text-xs w-[70px]">Adv. ROI</TableHead>
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
                          <TableCell className="font-mono text-xs text-center capitalize">{opt.recommendation_confidence}</TableCell>
                          <TableCell className="text-center">
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${opt.repair_id}-detail`} className="border-border/30 bg-muted/10">
                            <TableCell colSpan={7} className="p-3">
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

      {/* Tags */}
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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" /> Intervention ROI
        </h3>
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
    );
  }

  if (!roi) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" /> Intervention ROI
        </h3>
        <Card className="border-border/50">
          <CardContent className="py-6 text-center">
            <Info className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">Intervention ROI analysis unavailable.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const repairs = roi.ranked_repairs;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" /> Intervention ROI
      </h3>

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
