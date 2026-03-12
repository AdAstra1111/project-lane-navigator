import { useState } from 'react';
import { useStoryIntelligence, type StoryIntelligenceData, type TopBlocker, type FragilityEntry, type EvidenceSummary } from '@/hooks/useStoryIntelligence';
import { useNarrativeStability, type NarrativeStabilityData, type StabilityBand } from '@/hooks/useNarrativeStability';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Brain, RefreshCw, ShieldCheck, Play, Clock, Sparkles, Wrench, XCircle, Circle,
  ArrowRight, ChevronDown, AlertTriangle, Loader2, Activity,
} from 'lucide-react';

interface Props {
  projectId: string;
}

/* ── Band color mapping ── */
const HEALTH_BAND_STYLE: Record<string, string> = {
  stable: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  watch: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  at_risk: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

const RISK_BAND_STYLE: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  moderate: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  elevated: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  severe: 'bg-destructive/15 text-destructive border-destructive/30',
};

const READINESS_CONFIG: Record<string, { icon: typeof ShieldCheck; label: string; className?: string }> = {
  clear: { icon: ShieldCheck, label: 'All Clear', className: 'text-emerald-600 dark:text-emerald-400' },
  directly_executable: { icon: Play, label: 'Ready to Execute', className: 'text-sky-600 dark:text-sky-400' },
  approval_blocked: { icon: Clock, label: 'Awaiting Approval', className: 'text-amber-600 dark:text-amber-400' },
  proposal_required: { icon: Sparkles, label: 'Proposals Required', className: 'text-violet-600 dark:text-violet-400' },
  manual_heavy: { icon: Wrench, label: 'Manual Review Required', className: 'text-orange-600 dark:text-orange-400' },
  exhausted: { icon: XCircle, label: 'Reset Needed', className: 'text-destructive' },
  open: { icon: Circle, label: 'Unaddressed Issues', className: 'text-muted-foreground' },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-destructive',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

// Narrative Stability band colors (OS-layer operational signal — not CI/GP)
const STABILITY_BAND_STYLE: Record<StabilityBand, string> = {
  stable:   'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  watch:    'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  fragile:  'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  unstable: 'bg-destructive/15 text-destructive border-destructive/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

function bandLabel(band: string): string {
  return band.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function StoryIntelligencePanel({ projectId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refresh: refreshSI } = useStoryIntelligence(projectId);
  const { data: stabilityData, isLoading: stabilityLoading, error: stabilityError } = useNarrativeStability(projectId);

  // Single refresh button refreshes both SI and NSI coherently
  const refresh = () => {
    refreshSI();
    queryClient.invalidateQueries({ queryKey: ['narrative-stability', projectId] });
  };

  // Loading skeleton
  if (isLoading && !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  }

  // Null after load — hide entirely
  if (!data && !isLoading) return null;
  if (!data) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="py-2 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-muted-foreground" />
            Story Intelligence
          </CardTitle>
          <div className="flex items-center gap-2">
            {data.computed_at && (
              <span className="text-[9px] text-muted-foreground">
                {new Date(data.computed_at).toLocaleTimeString()}
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refresh} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {/* Error inline */}
        {error && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span>Unable to refresh — {error}</span>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={refresh}>Retry</Button>
          </div>
        )}

        {/* Summary grid — 5 cards on md+ */}
        <SummaryGrid data={data} stabilityData={stabilityData} stabilityLoading={stabilityLoading} />

        {/* NSI error note — inline, non-blocking */}
        {stabilityError && !stabilityData && (
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />
            <span>Stability index unavailable — {stabilityError}</span>
          </div>
        )}

        {/* Top blockers */}
        {data.top_blockers.length > 0 && <TopBlockersSection blockers={data.top_blockers} />}

        {/* Recommended next moves */}
        {data.recommended_next_moves.length > 0 && <NextMovesSection moves={data.recommended_next_moves} />}

        {/* Structural fragility */}
        {data.structural_fragility.length > 0 && <FragilitySection entries={data.structural_fragility} />}

        {/* Evidence summary */}
        {data.evidence_summary && <EvidenceSummarySection summary={data.evidence_summary} />}

        {/* Scoring note */}
        {data.scoring_note && (
          <p className="text-[9px] text-muted-foreground italic">{data.scoring_note}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Summary Grid ── */
function SummaryGrid({
  data,
  stabilityData,
  stabilityLoading,
}: {
  data: StoryIntelligenceData;
  stabilityData: NarrativeStabilityData | null;
  stabilityLoading: boolean;
}) {
  const readiness = READINESS_CONFIG[data.repair_readiness] ?? READINESS_CONFIG.open;
  const ReadinessIcon = readiness.icon;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {/* Health */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 space-y-0.5">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">Health</span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{data.narrative_health_score}</span>
          <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${HEALTH_BAND_STYLE[data.narrative_health_band] ?? ''}`}>
            {bandLabel(data.narrative_health_band)}
          </Badge>
        </div>
      </div>

      {/* Story Risk */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 space-y-0.5">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">Story Risk</span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{data.story_risk_score}</span>
          <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${RISK_BAND_STYLE[data.story_risk_band] ?? ''}`}>
            {bandLabel(data.story_risk_band)}
          </Badge>
        </div>
      </div>

      {/* Repair Readiness */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 space-y-0.5">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">Readiness</span>
        <div className={`flex items-center gap-1.5 ${readiness.className ?? ''}`}>
          <ReadinessIcon className="h-3.5 w-3.5" />
          <span className="text-[10px] font-medium">{readiness.label}</span>
        </div>
      </div>

      {/* Issues */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 space-y-0.5">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">Issues</span>
        <span className="text-sm font-semibold">{data.blocker_count}</span>
      </div>

      {/* Narrative Stability (NSI) — OS-layer operational signal */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 space-y-0.5">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Activity className="h-2.5 w-2.5" />
          Stability
        </span>
        {stabilityLoading && !stabilityData ? (
          <Skeleton className="h-4 w-14" />
        ) : stabilityData ? (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{stabilityData.narrative_stability_index}</span>
            <Badge
              variant="outline"
              className={`text-[8px] px-1.5 py-0 border ${STABILITY_BAND_STYLE[stabilityData.stability_band] ?? ''}`}
            >
              {bandLabel(stabilityData.stability_band)}
            </Badge>
          </div>
        ) : (
          <span className="text-[9px] text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

/* ── Top Blockers ── */
function TopBlockersSection({ blockers }: { blockers: TopBlocker[] }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Top Blockers</h4>
      <div className="space-y-1">
        {blockers.slice(0, 5).map((b, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[10px]">
            <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${SEVERITY_DOT[b.severity] ?? 'bg-muted-foreground'}`} />
            <span className="truncate flex-1" title={b.summary}>
              {b.summary.length > 80 ? b.summary.slice(0, 80) + '…' : b.summary}
            </span>
            {(b.load_class === 'core' || b.load_class === 'primary') && (
              <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0">{b.load_class}</Badge>
            )}
            <Badge variant="secondary" className="text-[7px] px-1 py-0 shrink-0">
              {b.resolution_state?.replace(/_/g, ' ')}
            </Badge>
            {b.next_action && (
              <span className="text-muted-foreground shrink-0 hidden sm:inline">{b.next_action}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Recommended Next Moves ── */
function NextMovesSection({ moves }: { moves: string[] }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recommended Next</h4>
      <div className="space-y-0.5">
        {moves.slice(0, 3).map((m, i) => {
          const isRepairRef = /repair|proposal|approv/i.test(m);
          return (
            <div key={i} className="flex items-start gap-1.5 text-[10px]">
              <ArrowRight className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
              {isRepairRef ? (
                <a href="#repair-queue-panel" className="text-primary hover:underline">{m}</a>
              ) : (
                <span>{m}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Structural Fragility ── */
function FragilitySection({ entries }: { entries: FragilityEntry[] }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Structural Fragility</h4>
      <div className="space-y-1">
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[10px]">
            <span className="font-medium shrink-0">{e.area}</span>
            <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0">{e.area_type}</Badge>
            <span className="text-muted-foreground">{e.issue_count} issues</span>
            <Badge variant="outline" className={`text-[7px] px-1 py-0 shrink-0 ${SEVERITY_DOT[e.max_severity] ? `border-current ${e.max_severity === 'critical' ? 'text-destructive' : e.max_severity === 'high' ? 'text-orange-500' : 'text-amber-500'}` : ''}`}>
              {e.max_severity}
            </Badge>
            <span className="text-muted-foreground truncate hidden sm:inline">{e.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Evidence Summary ── */
function EvidenceSummarySection({ summary }: { summary: EvidenceSummary }) {
  const [open, setOpen] = useState(false);
  const dc = summary.diagnostic_counts ?? { critical: 0, high: 0, warning: 0, info: 0, total: 0 };
  const rq = summary.repair_queue_summary ?? { pending: 0, completed: 0, failed: 0, skipped: 0 };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground w-full">
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        Evidence — {dc.total} diagnostics
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5 text-[9px] text-muted-foreground">
          {/* Diagnostic counts */}
          <div className="flex justify-between"><span>critical</span><span className="font-medium text-foreground">{dc.critical}</span></div>
          <div className="flex justify-between"><span>high</span><span className="font-medium text-foreground">{dc.high}</span></div>
          <div className="flex justify-between"><span>warning</span><span className="font-medium text-foreground">{dc.warning}</span></div>
          <div className="flex justify-between"><span>info</span><span className="font-medium text-foreground">{dc.info}</span></div>
          <div className="flex justify-between"><span>total</span><span className="font-medium text-foreground">{dc.total}</span></div>
          {/* Resolution state counts */}
          {summary.resolution_state_counts && Object.entries(summary.resolution_state_counts).map(([k, v]) => (
            <div key={`res-${k}`} className="flex justify-between">
              <span>{k.replace(/_/g, ' ')}</span><span className="font-medium text-foreground">{v}</span>
            </div>
          ))}
          {/* Repair queue summary */}
          <div className="flex justify-between"><span>queue pending</span><span className="font-medium text-foreground">{rq.pending}</span></div>
          <div className="flex justify-between"><span>queue completed</span><span className="font-medium text-foreground">{rq.completed}</span></div>
          <div className="flex justify-between"><span>queue failed</span><span className="font-medium text-foreground">{rq.failed}</span></div>
          <div className="flex justify-between"><span>queue skipped</span><span className="font-medium text-foreground">{rq.skipped}</span></div>
          {/* Extra counts */}
          <div className="flex justify-between"><span>core issues</span><span className="font-medium text-foreground">{summary.core_issue_count ?? 0}</span></div>
          <div className="flex justify-between"><span>failed repairs</span><span className="font-medium text-foreground">{summary.failed_repair_count ?? 0}</span></div>
          <div className="flex justify-between"><span>proposals needed</span><span className="font-medium text-foreground">{summary.proposal_required_count ?? 0}</span></div>
          <div className="flex justify-between"><span>blocked</span><span className="font-medium text-foreground">{summary.blocked_issue_count ?? 0}</span></div>
          <div className="flex justify-between"><span>manual only</span><span className="font-medium text-foreground">{summary.manual_only_count ?? 0}</span></div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
