/**
 * RewritePlanPanel — Sheet-based UI for the deterministic spine-rewrite-plan output.
 * Renders rewrite targets, preserve targets, coverage gaps, plan status,
 * dependency position badges, and propagated risk visualization.
 * Read-only planning surface — no auto-rewrite execution.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertTriangle, ChevronRight, ShieldCheck, ShieldAlert,
  FileWarning, Eye, Info, Crosshair, GitBranch, Wrench,
} from 'lucide-react';

/* ── Types matching backend contract ── */

interface SectionTarget {
  section_key: string;
  section_label: string;
  confidence: 'deterministic' | 'bounded';
  targeting_method: 'registry' | 'document_verified';
  note?: string | null;
}

type DependencyPosition = 'root' | 'upstream' | 'propagated' | 'terminal';

type SequenceBucket =
  | 'root_fix'
  | 'upstream_fix'
  | 'propagated_followup'
  | 'terminal_cleanup'
  | 'isolated';

interface RewriteSequenceItem {
  axis: string;
  sequence_rank: number;
  sequence_bucket: SequenceBucket;
  sequence_reason: string;
}

interface RewriteTarget {
  axis: string;
  unit_key: string;
  reason: 'stale' | 'contradicted';
  current_evidence: string | null;
  target_spec: string | null;
  amendment_context: string | null;
  priority: string;
  axis_class: string;
  confidence: number | null;
  section_targets?: SectionTarget[];
  dependency_position?: DependencyPosition;
  sequence_bucket?: SequenceBucket;
  sequence_rank?: number;
  sequence_reason?: string;
}

interface PreserveTarget {
  axis: string;
  unit_key: string;
  status: 'aligned' | 'active';
  evidence: string | null;
  spine_value: string | null;
  note: string;
  axis_class: string;
  section_targets?: SectionTarget[];
  dependency_position?: DependencyPosition;
}

interface CoverageBreakdown {
  supported_axes: string[];
  unsupported_axes: string[];
  deferred_validator_axes?: string[];
  supported_but_missing_on_version: string[];
  supported_and_evaluated_on_version: string[];
}

interface PropagatedRisk {
  source_axis: string;
  downstream_axes: string[];
  dependency_chain?: string[];
  reason?: string;
}

type PatchUrgency = 'critical' | 'high' | 'medium' | 'low';

interface PatchLocation {
  section_keys?: string[];
  section_labels?: string[];
  passage_lines?: { start_line: number; end_line: number }[];
}

interface PatchBlueprintEntityRef {
  entity_key: string;
  entity_type: 'character' | 'arc' | 'conflict';
  canonical_name: string;
  relation_to_patch: 'primary' | 'affected' | 'preserve';
  rationale?: string;
}

interface PatchBlueprint {
  axis: string;
  sequence_rank?: number;
  sequence_bucket?: string;
  urgency?: PatchUrgency;
  patch_goal: string;
  patch_reason: string;
  patch_location?: PatchLocation | null;
  preserve_constraints?: string[];
  upstream_dependencies?: string[];
  downstream_risk_axes?: string[];
  execution_note?: string;
  primary_entity?: PatchBlueprintEntityRef | null;
  affected_entities?: PatchBlueprintEntityRef[];
  preserve_entities?: PatchBlueprintEntityRef[];
}

interface RewritePlan {
  document_id: string | null;
  version_id: string;
  document_type: string | null;
  spine_state: string;
  is_latest_version: boolean | null;
  is_latest_version_note: string | null;
  rewrite_targets: RewriteTarget[];
  preserve_targets: PreserveTarget[];
  axes_with_no_units: string[];
  staled_axes: string[];
  total_relevant_axes: number;
  axes_covered: number;
  coverage_warning: string | null;
  plan_complete: boolean;
  generated_at: string;
  error?: string;
  coverage_breakdown?: CoverageBreakdown;
  likely_affected_areas?: string[] | null;
  propagated_risk?: PropagatedRisk[];
  rewrite_sequence?: RewriteSequenceItem[];
  patch_blueprints?: PatchBlueprint[];
}

/* ── Props ── */

interface RewritePlanPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documentId: string;
  versionId: string | null;
  docType: string;
}

/* ── Axis display helpers ── */

const AXIS_LABELS: Record<string, string> = {
  story_engine: 'Story Engine',
  protagonist_arc: 'Protagonist Arc',
  pressure_system: 'Pressure System',
  central_conflict: 'Central Conflict',
  resolution_type: 'Resolution Type',
  stakes_class: 'Stakes Class',
  inciting_incident: 'Inciting Incident',
  midpoint_reversal: 'Midpoint Reversal',
  tonal_gravity: 'Tonal Gravity',
};

const PRIORITY_STYLES: Record<string, string> = {
  constitutional: 'bg-red-950 text-red-300 border-red-800',
  high: 'bg-orange-950 text-orange-300 border-orange-800',
  moderate: 'bg-amber-950 text-amber-300 border-amber-800',
  advisory: 'bg-blue-950 text-blue-300 border-blue-800',
};

const DEPENDENCY_POSITION_STYLES: Record<DependencyPosition, { className: string; label: string }> = {
  root: { className: 'border-purple-500/40 text-purple-400', label: 'root cause' },
  upstream: { className: 'border-blue-500/40 text-blue-400', label: 'upstream dependency' },
  propagated: { className: 'border-amber-500/40 text-amber-400', label: 'propagated risk' },
  terminal: { className: 'border-border text-muted-foreground', label: 'terminal axis' },
};

const DEPENDENCY_ORDER: Record<DependencyPosition, number> = {
  root: 0,
  upstream: 1,
  propagated: 2,
  terminal: 3,
};

const SEQUENCE_BUCKET_STYLES: Record<SequenceBucket, { className: string; label: string }> = {
  root_fix: { className: 'border-purple-500/40 text-purple-400', label: 'Root fix' },
  upstream_fix: { className: 'border-blue-500/40 text-blue-400', label: 'Upstream fix' },
  propagated_followup: { className: 'border-amber-500/40 text-amber-400', label: 'Follow-up' },
  terminal_cleanup: { className: 'border-border text-muted-foreground', label: 'Terminal cleanup' },
  isolated: { className: 'border-border text-muted-foreground/60', label: 'Isolated' },
};

const PATCH_URGENCY_STYLES: Record<PatchUrgency, { className: string; label: string }> = {
  critical: { className: 'border-red-500/40 text-red-400', label: 'Critical' },
  high: { className: 'border-orange-500/40 text-orange-400', label: 'High' },
  medium: { className: 'border-yellow-500/40 text-yellow-400', label: 'Medium' },
  low: { className: 'border-border text-muted-foreground', label: 'Low' },
};

/* ── Component ── */

export function RewritePlanPanel({
  open, onOpenChange, projectId, documentId, versionId, docType,
}: RewritePlanPanelProps) {

  const { data: plan, isLoading, error } = useQuery<RewritePlan>({
    queryKey: ['rewrite-plan', projectId, documentId, versionId],
    queryFn: async () => {
      if (!versionId) throw new Error('No version available');
      const { data, error } = await supabase.functions.invoke('spine-rewrite-plan', {
        body: { projectId, documentId, versionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as RewritePlan;
    },
    enabled: open && !!versionId,
    staleTime: 30_000,
  });

  // Stable secondary sort by dependency position (primary order preserved)
  const sortedRewriteTargets = useMemo(() => {
    if (!plan) return [];
    return [...plan.rewrite_targets].sort((a, b) => {
      const oa = a.dependency_position ? DEPENDENCY_ORDER[a.dependency_position] : 99;
      const ob = b.dependency_position ? DEPENDENCY_ORDER[b.dependency_position] : 99;
      return oa - ob;
    });
  }, [plan]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto bg-background border-border">
        <SheetHeader className="pb-3">
          <SheetTitle className="text-sm">Rewrite Plan</SheetTitle>
          <SheetDescription className="text-xs">
            Deterministic guidance for {docType || 'this document'} based on current spine state and unit evaluations.
          </SheetDescription>
        </SheetHeader>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3 pt-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 mt-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-destructive">Plan generation failed</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{(error as Error).message}</p>
            </div>
          </div>
        )}

        {/* Empty: no version */}
        {!isLoading && !error && !versionId && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border mt-2">
            <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">No analyzed version available for this document.</p>
          </div>
        )}

        {/* Plan result */}
        {plan && !isLoading && (
          <div className="space-y-5 pt-2">

            {/* A. Plan Status / Safety Header */}
            <PlanStatusHeader plan={plan} />

            {/* B. Coverage Warning */}
            {plan.coverage_warning && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <FileWarning className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300/90">{plan.coverage_warning}</p>
              </div>
            )}

            {/* B2. Likely Affected Areas summary */}
            <LikelyAffectedAreas areas={plan.likely_affected_areas} />

            {/* B3. Propagation Impact */}
            <PropagatedRiskSection risks={plan.propagated_risk} />

            {/* B4. Rewrite Sequence */}
            <RewriteSequenceSection sequence={plan.rewrite_sequence} />

            {/* B5. Patch Blueprint Manifest */}
            <PatchBlueprintManifest blueprints={plan.patch_blueprints} />

            {/* C. Rewrite Targets */}
            {sortedRewriteTargets.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  Targets to change
                  <Badge variant="outline" className="text-[9px] ml-1 border-amber-500/30 text-amber-400">
                    {sortedRewriteTargets.length}
                  </Badge>
                </h3>
                <div className="space-y-2">
                  {sortedRewriteTargets.map((t, i) => (
                    <RewriteTargetCard key={`${t.axis}-${i}`} target={t} />
                  ))}
                </div>
              </section>
            )}

            {/* D. Preserve Targets */}
            {plan.preserve_targets.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Targets to preserve
                  <Badge variant="outline" className="text-[9px] ml-1 border-emerald-500/30 text-emerald-400">
                    {plan.preserve_targets.length}
                  </Badge>
                </h3>
                <div className="space-y-2">
                  {plan.preserve_targets.map((t, i) => (
                    <PreserveTargetCard key={`${t.axis}-${i}`} target={t} />
                  ))}
                </div>
              </section>
            )}

            {/* E. Coverage Gaps — split by coverage_breakdown when available */}
            {plan.coverage_breakdown ? (
              <CoverageBreakdownSection breakdown={plan.coverage_breakdown} />
            ) : (
              plan.axes_with_no_units.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    Axes without evaluated unit coverage
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.axes_with_no_units.map(ax => (
                      <Badge key={ax} variant="outline" className="text-[10px] border-border text-muted-foreground">
                        {AXIS_LABELS[ax] || ax}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    No unit data exists for these axes on this version. Run analysis to populate coverage.
                  </p>
                </section>
              )
            )}

            {/* Staled Axes info */}
            {plan.staled_axes.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">Stale axes</h3>
                <p className="text-[10px] text-muted-foreground/70">
                  {plan.staled_axes.length} axis unit(s) were evaluated against a superseded spine spec.
                  These appear as rewrite targets above.
                </p>
              </section>
            )}

            {/* Footer: meta */}
            <div className="pt-2 border-t border-border">
              <p className="text-[9px] text-muted-foreground/50">
                {plan.coverage_breakdown
                  ? `Coverage: ${plan.coverage_breakdown.supported_and_evaluated_on_version.length}/${plan.coverage_breakdown.supported_axes.length} supported axes evaluated`
                  : `Coverage: ${plan.axes_covered}/${plan.total_relevant_axes} axes`}
                · Generated {new Date(plan.generated_at).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ── Sub-components ── */

function PlanStatusHeader({ plan }: { plan: RewritePlan }) {
  const isComplete = plan.plan_complete;
  const isLatest = plan.is_latest_version;

  return (
    <div className="space-y-2">
      {isComplete ? (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-emerald-300">Plan complete</p>
            <p className="text-[10px] text-emerald-300/60">All relevant spine axes have unit coverage for this version.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-amber-300">Partial guidance only</p>
            <p className="text-[10px] text-amber-300/60">
              Not all spine axes have evaluated unit coverage. This plan provides partial guidance — missing axes may require additional analysis.
            </p>
          </div>
        </div>
      )}

      {isLatest === false && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Info className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-violet-300/80">
            {plan.is_latest_version_note || 'This plan is based on an older analyzed version, not the latest.'}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Dependency Position Badge ── */

function DependencyPositionBadge({ position }: { position?: DependencyPosition }) {
  if (!position) return null;
  const style = DEPENDENCY_POSITION_STYLES[position];
  return (
    <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${style.className}`}>
      {style.label}
    </Badge>
  );
}

/* ── Rewrite Target Card ── */

function RewriteTargetCard({ target }: { target: RewriteTarget }) {
  const [expanded, setExpanded] = useState(false);
  const priorityStyle = PRIORITY_STYLES[target.priority] || PRIORITY_STYLES.moderate;
  const reasonStyle = target.reason === 'stale'
    ? 'bg-amber-950 text-amber-300 border-amber-800'
    : 'bg-red-950 text-red-300 border-red-800';

  return (
    <div className="p-3 rounded-lg bg-card border border-border space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {target.sequence_rank != null && (
          <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0">#{target.sequence_rank}</span>
        )}
        <span className="text-xs font-medium text-foreground">{AXIS_LABELS[target.axis] || target.axis}</span>
        <DependencyPositionBadge position={target.dependency_position} />
        {target.sequence_bucket && SEQUENCE_BUCKET_STYLES[target.sequence_bucket] && (
          <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${SEQUENCE_BUCKET_STYLES[target.sequence_bucket].className}`}>
            {SEQUENCE_BUCKET_STYLES[target.sequence_bucket].label}
          </Badge>
        )}
        <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${reasonStyle}`}>
          {target.reason}
        </Badge>
        <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${priorityStyle}`}>
          {target.priority}
        </Badge>
      </div>

      {target.sequence_reason && (
        <p className="text-[9px] text-muted-foreground/60 leading-snug">{target.sequence_reason}</p>
      )}

      {target.target_spec && (
        <div>
          <p className="text-[9px] text-muted-foreground font-medium mb-0.5">Target spec</p>
          <p className="text-[10px] text-foreground/80 leading-snug">{target.target_spec}</p>
        </div>
      )}

      <SectionTargetsDisplay targets={target.section_targets} />

      {(target.current_evidence || target.amendment_context) && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground/60 transition-colors group">
            <ChevronRight className="w-2.5 h-2.5 transition-transform group-data-[state=open]:rotate-90" />
            Details
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-1.5">
            {target.current_evidence && (
              <div>
                <p className="text-[9px] text-muted-foreground font-medium">Current evidence</p>
                <p className="text-[10px] text-foreground/60 italic leading-snug">"{target.current_evidence}"</p>
              </div>
            )}
            {target.amendment_context && (
              <div>
                <p className="text-[9px] text-muted-foreground font-medium">Amendment context</p>
                <p className="text-[10px] text-foreground/60 leading-snug">{target.amendment_context}</p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/* ── Preserve Target Card ── */

function PreserveTargetCard({ target }: { target: PreserveTarget }) {
  const isProvisional = target.status === 'active';
  const borderClass = isProvisional
    ? 'border-dashed border-amber-500/20'
    : 'border-emerald-500/20';
  const bgClass = isProvisional
    ? 'bg-amber-500/[0.03]'
    : 'bg-emerald-500/[0.03]';

  // Dependency context hints
  const depHint = target.dependency_position === 'upstream'
    ? 'This axis supports downstream narrative structure.'
    : target.dependency_position === 'terminal'
      ? 'This axis represents a narrative outcome.'
      : null;

  return (
    <div className={`p-3 rounded-lg ${bgClass} border ${borderClass} space-y-1.5`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-foreground">{AXIS_LABELS[target.axis] || target.axis}</span>
        <DependencyPositionBadge position={target.dependency_position} />
        {isProvisional ? (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-dashed border-amber-500/30 text-amber-400">
            provisional
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-emerald-500/30 text-emerald-400">
            aligned
          </Badge>
        )}
      </div>

      {target.evidence && (
        <p className="text-[10px] text-foreground/60 italic leading-snug">"{target.evidence}"</p>
      )}

      <p className="text-[9px] text-muted-foreground leading-snug">{target.note}</p>

      {depHint && (
        <p className="text-[8px] text-muted-foreground/50 italic">{depHint}</p>
      )}

      <SectionTargetsDisplay targets={target.section_targets} />
    </div>
  );
}

/* ── Section Targets Display ── */

function SectionTargetsDisplay({ targets }: { targets?: SectionTarget[] }) {
  if (!targets || targets.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
        <Crosshair className="w-2.5 h-2.5" />
        Suggested sections
      </p>
      <div className="flex flex-wrap gap-1.5">
        {targets.map((st) => (
          <div
            key={st.section_key}
            className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5"
          >
            <span className="text-[9px] text-foreground/80">{st.section_label}</span>
            <Badge
              variant="outline"
              className={`text-[7px] px-1 py-0 ${
                st.confidence === 'deterministic'
                  ? 'border-emerald-500/40 text-emerald-400'
                  : 'border-amber-500/40 text-amber-400'
              }`}
            >
              {st.confidence === 'deterministic' ? 'exact' : 'bounded'}
            </Badge>
          </div>
        ))}
      </div>
      {targets.some(st => st.targeting_method === 'registry') && (
        <p className="text-[8px] text-muted-foreground/50 italic">
          Section targeting is structural guidance based on document registry, not excerpt-verified.
        </p>
      )}
    </div>
  );
}

/* ── Likely Affected Areas ── */

function LikelyAffectedAreas({ areas }: { areas?: string[] | null }) {
  if (!areas || areas.length === 0) return null;

  return (
    <div className="p-2.5 rounded-lg bg-muted/30 border border-border space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
        <Crosshair className="w-3 h-3 text-muted-foreground" />
        Likely affected sections
      </p>
      <div className="flex flex-wrap gap-1.5">
        {areas.map((area) => (
          <Badge key={area} variant="outline" className="text-[9px] border-border text-foreground/70">
            {AXIS_LABELS[area] || area.replace(/_/g, ' ')}
          </Badge>
        ))}
      </div>
      <p className="text-[8px] text-muted-foreground/50">
        Planning guidance — not exact edit instructions.
      </p>
    </div>
  );
}

/* ── Propagated Risk Section ── */

function PropagatedRiskSection({ risks }: { risks?: PropagatedRisk[] }) {
  if (!risks || risks.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5 text-purple-400" />
        Propagation Impact
      </h3>
      <div className="space-y-2">
        {risks.map((risk, i) => (
          <div key={`${risk.source_axis}-${i}`} className="p-2.5 rounded-lg bg-purple-500/[0.04] border border-purple-500/15 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-foreground">
                {AXIS_LABELS[risk.source_axis] || risk.source_axis}
              </span>
              <span className="text-[10px] text-muted-foreground">change may affect:</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-2">
              {risk.downstream_axes.map(ax => (
                <Badge key={ax} variant="outline" className="text-[9px] border-purple-500/30 text-purple-400">
                  {AXIS_LABELS[ax] || ax}
                </Badge>
              ))}
            </div>
            {risk.reason && (
              <p className="text-[9px] text-muted-foreground/70 pl-2">{risk.reason}</p>
            )}
            {risk.dependency_chain && risk.dependency_chain.length > 1 && (
              <p className="text-[8px] text-muted-foreground/40 pl-2 font-mono">
                {risk.dependency_chain.map(ax => AXIS_LABELS[ax] || ax).join(' → ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Rewrite Sequence Section ── */

function RewriteSequenceSection({ sequence }: { sequence?: RewriteSequenceItem[] }) {
  if (!sequence || sequence.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5 text-blue-400" />
        Rewrite Sequence
        <Badge variant="outline" className="text-[9px] ml-1 border-blue-500/30 text-blue-400">
          {sequence.length} steps
        </Badge>
      </h3>
      <div className="space-y-1">
        {sequence
          .sort((a, b) => a.sequence_rank - b.sequence_rank)
          .map((item) => {
            const bucketStyle = SEQUENCE_BUCKET_STYLES[item.sequence_bucket];
            return (
              <div key={item.axis} className="flex items-start gap-2 py-1.5 px-2.5 rounded bg-muted/30 border border-border">
                <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">
                  {item.sequence_rank}.
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-medium text-foreground">
                      {AXIS_LABELS[item.axis] || item.axis}
                    </span>
                    {bucketStyle && (
                      <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${bucketStyle.className}`}>
                        {bucketStyle.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[9px] text-muted-foreground/60 leading-snug">{item.sequence_reason}</p>
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}

/* ── Coverage Breakdown Section ── */

function CoverageBreakdownSection({ breakdown }: { breakdown: CoverageBreakdown }) {
  const hasUnsupported = breakdown.unsupported_axes.length > 0;
  const hasMissing = breakdown.supported_but_missing_on_version.length > 0;
  const hasDeferred = (breakdown.deferred_validator_axes || []).length > 0;

  if (!hasUnsupported && !hasMissing) return null;

  return (
    <div className="space-y-3">
      {hasUnsupported && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
            Not yet covered by IFFY
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {breakdown.unsupported_axes.map(ax => (
              <Badge key={ax} variant="outline" className="text-[10px] border-border text-muted-foreground/60">
                {AXIS_LABELS[ax] || ax}
              </Badge>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            These axes are not yet supported by IFFY's current validator architecture for rewrite planning.
          </p>
          {hasDeferred && (
            <p className="text-[10px] text-muted-foreground/50 italic">
              {breakdown.deferred_validator_axes!.length} axis(es) deferred pending deeper validation support.
            </p>
          )}
        </section>
      )}

      {hasMissing && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            Supported but not yet evaluated on this version
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {breakdown.supported_but_missing_on_version.map(ax => (
              <Badge key={ax} variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                {AXIS_LABELS[ax] || ax}
              </Badge>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            These axes are supported by IFFY, but no evaluated unit coverage exists yet for this document version. Run analysis to populate coverage.
          </p>
        </section>
      )}
    </div>
  );
}

/* ── Patch Blueprint Manifest ── */

function PatchBlueprintManifest({ blueprints }: { blueprints?: PatchBlueprint[] }) {
  if (!blueprints || blueprints.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
        <Wrench className="w-3.5 h-3.5 text-violet-400" />
        Patch Blueprint Manifest
        <Badge variant="outline" className="text-[9px] ml-1 border-violet-500/30 text-violet-400">
          {blueprints.length} {blueprints.length === 1 ? 'patch' : 'patches'}
        </Badge>
      </h3>
      <div className="space-y-2">
        {blueprints.map((bp, i) => (
          <PatchBlueprintCard key={`${bp.axis}-${i}`} blueprint={bp} index={i} />
        ))}
      </div>
    </section>
  );
}

function PatchBlueprintCard({ blueprint: bp, index }: { blueprint: PatchBlueprint; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const urgencyStyle = bp.urgency ? PATCH_URGENCY_STYLES[bp.urgency] : null;
  const bucketStyle = bp.sequence_bucket ? SEQUENCE_BUCKET_STYLES[bp.sequence_bucket as SequenceBucket] : null;

  return (
    <div className="p-3 rounded-lg bg-card border border-border space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
          {bp.sequence_rank != null ? `#${bp.sequence_rank}` : `${index + 1}.`}
        </span>
        <span className="text-xs font-medium text-foreground">
          {AXIS_LABELS[bp.axis] || bp.axis}
        </span>
        {urgencyStyle && (
          <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${urgencyStyle.className}`}>
            {urgencyStyle.label}
          </Badge>
        )}
        {bucketStyle && (
          <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${bucketStyle.className}`}>
            {bucketStyle.label}
          </Badge>
        )}
      </div>

      {/* Primary entity */}
      {bp.primary_entity && (
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground font-medium">Primary entity</span>
          <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-400">
            {bp.primary_entity.canonical_name}
          </Badge>
        </div>
      )}

      {/* Goal as headline */}
      <p className="text-[10px] font-medium text-foreground/90 leading-snug">{bp.patch_goal}</p>

      {/* Reason */}
      <p className="text-[9px] text-muted-foreground/70 leading-snug">{bp.patch_reason}</p>

      {/* Execution note callout */}
      {bp.execution_note && (
        <div className="p-2 rounded bg-violet-500/[0.06] border border-violet-500/15">
          <p className="text-[9px] text-violet-300/80 leading-snug">{bp.execution_note}</p>
        </div>
      )}

      {/* Patch location */}
      <PatchLocationDisplay location={bp.patch_location} />

      {/* Guardrails */}
      {bp.preserve_constraints && bp.preserve_constraints.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground font-medium">Guardrails</p>
          <div className="flex flex-wrap gap-1.5">
            {bp.preserve_constraints.map((c, ci) => (
              <Badge key={ci} variant="outline" className="text-[9px] border-border text-foreground/60">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Preserve entities */}
      {bp.preserve_entities && bp.preserve_entities.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground font-medium">Preserve entities</p>
          <div className="flex flex-wrap gap-1.5">
            {bp.preserve_entities.map((e) => (
              <Badge key={e.entity_key} variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
                {e.canonical_name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Affected entities */}
      {bp.affected_entities && bp.affected_entities.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground font-medium">Affected entities</p>
          <div className="flex flex-wrap gap-1.5">
            {bp.affected_entities.map((e) => (
              <Badge key={e.entity_key} variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                {e.canonical_name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies + downstream risk (collapsible if both present) */}
      {((bp.upstream_dependencies && bp.upstream_dependencies.length > 0) ||
        (bp.downstream_risk_axes && bp.downstream_risk_axes.length > 0)) && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground/60 transition-colors group">
            <ChevronRight className="w-2.5 h-2.5 transition-transform group-data-[state=open]:rotate-90" />
            Dependencies &amp; risk
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-1.5">
            {bp.upstream_dependencies && bp.upstream_dependencies.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground font-medium">Depends on</p>
                <div className="flex flex-wrap gap-1.5">
                  {bp.upstream_dependencies.map((dep) => (
                    <Badge key={dep} variant="outline" className="text-[9px] border-blue-500/30 text-blue-400">
                      {AXIS_LABELS[dep] || dep}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {bp.downstream_risk_axes && bp.downstream_risk_axes.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground font-medium">May affect</p>
                <div className="flex flex-wrap gap-1.5">
                  {bp.downstream_risk_axes.map((ax) => (
                    <Badge key={ax} variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                      {AXIS_LABELS[ax] || ax}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function PatchLocationDisplay({ location }: { location?: PatchLocation | null }) {
  if (!location) return null;
  const hasLabels = location.section_labels && location.section_labels.length > 0;
  const hasKeys = !hasLabels && location.section_keys && location.section_keys.length > 0;
  const hasLines = location.passage_lines && location.passage_lines.length > 0;

  if (!hasLabels && !hasKeys && !hasLines) return null;

  return (
    <div className="space-y-1">
      <p className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
        <Crosshair className="w-2.5 h-2.5" />
        Patch location
      </p>
      {(hasLabels || hasKeys) && (
        <div className="flex flex-wrap gap-1.5">
          {(location.section_labels || location.section_keys || []).map((s, si) => (
            <Badge key={si} variant="outline" className="text-[9px] border-border text-foreground/70">
              {s}
            </Badge>
          ))}
        </div>
      )}
      {hasLines && (
        <div className="flex flex-wrap gap-1.5">
          {location.passage_lines!.map((pl, pi) => (
            <Badge key={pi} variant="outline" className="text-[8px] font-mono border-border text-muted-foreground">
              L{pl.start_line}–{pl.end_line}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
