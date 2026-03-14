/**
 * NarrativeRepairQueuePanel — Repair queue surface for producers.
 * Renders persisted repair plans, allows execution/approval.
 * RP5: Adds proposal flow for patchable repair types.
 * Fail-closed. No autonomous execution.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNarrativeRepairs, type NarrativeRepair } from '@/hooks/useNarrativeRepairs';
import { usePlanNarrativeRepairs } from '@/hooks/usePlanNarrativeRepairs';
import { useExecuteNarrativeRepair } from '@/hooks/useExecuteNarrativeRepair';
import { usePatchProposalsByRepair, type NarrativePatchProposal } from '@/hooks/usePatchProposalsByRepair';
import { useGeneratePatchProposal } from '@/hooks/useGeneratePatchProposal';
import { useApplyPatchProposal } from '@/hooks/useApplyPatchProposal';
import { useSimulateNarrativePatch, type SimulateNarrativePatchResult } from '@/hooks/useSimulateNarrativePatch';
import { useProjectedNarrativeStability, type ProjectedEffect } from '@/hooks/useProjectedNarrativeStability';
import { useRecommendedRepairOrder, type RepairRecommendation, type BlockedRepair } from '@/hooks/useRecommendedRepairOrder';
import { useRecommendedRepairPaths, type RepairPath, type ExcludedRepair } from '@/hooks/useRecommendedRepairPaths';
import { useEvaluatedRepairPaths, type EvaluatedPath, type EvaluatedStep } from '@/hooks/useEvaluatedRepairPaths';
import type { RepairLandingContext } from '@/components/project/RepairStrategyPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  RefreshCw,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Play,
  ShieldCheck,
  Loader2,
  Search,
  Wrench,
  ListChecks,
  FileText,
  ArrowRight,
  Zap,
  TrendingUp,
  Ban,
  Info,
  X,
} from 'lucide-react';

interface Props {
  projectId: string;
  landingContext?: RepairLandingContext | null;
  onDismissLandingContext?: () => void;
}

const ACTIVE_STATUSES = ['pending', 'failed'] as const;
const HISTORY_STATUSES = ['completed', 'skipped', 'dismissed'] as const;
const RESERVED_STATUSES = ['planned', 'approved', 'queued', 'in_progress'] as const;
const HISTORY_CAP = 50;

const PATCH_PROPOSAL_TYPES = new Set([
  'repair_relation_graph',
  'repair_structural_beats',
]);

const REPAIRABILITY_STYLE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  auto: { label: 'Auto', variant: 'default' },
  guided: { label: 'Guided', variant: 'secondary' },
  manual: { label: 'Manual', variant: 'outline' },
  investigatory: { label: 'Investigatory', variant: 'secondary' },
  unknown: { label: 'Unknown', variant: 'outline' },
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'text-amber-600 dark:text-amber-400' },
  planned: { label: 'Planned', color: 'text-sky-600 dark:text-sky-400' },
  approved: { label: 'Approved', color: 'text-sky-600 dark:text-sky-400' },
  queued: { label: 'Queued', color: 'text-sky-600 dark:text-sky-400' },
  in_progress: { label: 'In Progress', color: 'text-sky-600 dark:text-sky-400' },
  completed: { label: 'Completed', color: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Failed', color: 'text-destructive' },
  skipped: { label: 'Skipped', color: 'text-muted-foreground' },
  dismissed: { label: 'Dismissed', color: 'text-muted-foreground' },
};

export function NarrativeRepairQueuePanel({ projectId, landingContext, onDismissLandingContext }: Props) {
  const { data: repairs, isLoading, error, refresh: refreshQueue } = useNarrativeRepairs(projectId);
  const { planRepairs, isPlanning, error: planError } = usePlanNarrativeRepairs(projectId);
  const execHook = useExecuteNarrativeRepair(projectId);
  const generateHook = useGeneratePatchProposal(projectId);
  const applyHook = useApplyPatchProposal(projectId);
  const simulateHook = useSimulateNarrativePatch(projectId);
  const repairOrder = useRecommendedRepairOrder(projectId);
  const repairPaths = useRecommendedRepairPaths(projectId);
  const evaluatedPaths = useEvaluatedRepairPaths(projectId);
  const lastPlanRefreshRef = useRef<number>(0);

  // Auto plan on mount with TTL guard
  useEffect(() => {
    if (!repairs) return;
    const hasPending = repairs.some(r => ACTIVE_STATUSES.includes(r.status as any));
    const stale = Date.now() - lastPlanRefreshRef.current > 60000;
    if (!hasPending || stale) {
      if (stale) {
        lastPlanRefreshRef.current = Date.now();
        planRepairs();
      }
    }
  }, [repairs, planRepairs]);

  const handleRefreshPlans = useCallback(() => {
    lastPlanRefreshRef.current = Date.now();
    planRepairs();
  }, [planRepairs]);

  const handleExecute = useCallback((repairId: string, approved?: boolean) => {
    execHook.execute(repairId, approved);
  }, [execHook]);

  // Group repairs
  const { active, history, reserved } = useMemo(() => {
    if (!repairs) return { active: [], history: [], reserved: [] };
    const act: NarrativeRepair[] = [];
    const hist: NarrativeRepair[] = [];
    const res: NarrativeRepair[] = [];
    for (const r of repairs) {
      if ((ACTIVE_STATUSES as readonly string[]).includes(r.status)) act.push(r);
      else if ((HISTORY_STATUSES as readonly string[]).includes(r.status)) hist.push(r);
      else if ((RESERVED_STATUSES as readonly string[]).includes(r.status)) res.push(r);
      else act.push(r); // fallback
    }
    return {
      active: act,
      history: hist.slice(0, HISTORY_CAP),
      reserved: res,
    };
  }, [repairs]);

  const pendingCount = active.filter(r => r.status === 'pending').length;
  const failedCount = active.filter(r => r.status === 'failed').length;

  // Loading
  if (isLoading && !repairs) {
    return (
      <Card className="border-border/50" id="repair-queue-panel">
        <CardHeader className="pb-2"><Skeleton className="h-5 w-48" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // Error
  if (error) {
    return (
      <Card className="border-border/50" id="repair-queue-panel">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Repair Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Unable to load repair queue.</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 gap-1.5" onClick={refreshQueue}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const allRepairs = repairs ?? [];

  return (
    <Card className="border-border/50" id="repair-queue-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Repair Queue
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={handleRefreshPlans} disabled={isPlanning}>
              <RefreshCw className={`h-3 w-3 ${isPlanning ? 'animate-spin' : ''}`} />
              Refresh Plans
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={refreshQueue} disabled={isLoading}>
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh Queue
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Landing context notice from Action Queue routing */}
        {landingContext && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-300">
            <ArrowRight className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-foreground">Routed from Action Queue</span>
                <Badge variant="outline" className="text-[7px] font-mono">{landingContext.severity.toUpperCase()}</Badge>
                <span className="text-[8px] font-mono text-muted-foreground">{landingContext.rule_id}</span>
              </div>
              <p className="text-[10px] font-semibold text-foreground">{landingContext.title}</p>
              <p className="text-[9px] text-muted-foreground leading-snug">{landingContext.suggested_action}</p>
            </div>
            {onDismissLandingContext && (
              <button
                type="button"
                onClick={onDismissLandingContext}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Plan error */}
        {planError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{planError}</p>
          </div>
        )}

        {/* Counts */}
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-muted-foreground">Pending: <span className="font-semibold text-foreground">{pendingCount}</span></span>
          {failedCount > 0 && (
            <span className="text-destructive">Failed: <span className="font-semibold">{failedCount}</span></span>
          )}
        </div>

        {/* Exec error */}
        {execHook.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{execHook.error}</p>
          </div>
        )}

        {/* Empty state */}
        {allRepairs.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No repair plans currently queued.</p>
            {landingContext && (
              <p className="text-[10px] text-muted-foreground leading-snug border-l-2 border-primary/30 pl-2">
                Generate repair plans to address: <span className="font-semibold text-foreground">{landingContext.title}</span>
                <span className="text-muted-foreground/60 font-mono ml-1">({landingContext.rule_id})</span>
              </p>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefreshPlans} disabled={isPlanning}>
              {isPlanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              Generate Repair Plans
            </Button>
          </div>
        )}

        {/* Active empty */}
        {allRepairs.length > 0 && active.length === 0 && (
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-muted-foreground">✓ No pending repairs</span>
          </div>
        )}

        {/* Counterfactual Repair Strategies (ARP5) */}
        <CounterfactualRepairStrategiesSection data={evaluatedPaths.data} isLoading={evaluatedPaths.isLoading} error={evaluatedPaths.error} />

        {/* Recommended Repair Strategies (ARP4) */}
        <RecommendedRepairStrategiesSection data={repairPaths.data} isLoading={repairPaths.isLoading} error={repairPaths.error} />

        {/* Recommended Repair Order (ARP2) */}
        <RecommendedRepairOrderSection data={repairOrder.data} isLoading={repairOrder.isLoading} error={repairOrder.error} />

        {/* Active repairs */}
        {active.length > 0 && (
          <div className="space-y-2">
            {active.map(r => (
              <RepairCard
                key={r.repair_id}
                repair={r}
                projectId={projectId}
                onExecute={handleExecute}
                isExecuting={execHook.isExecuting && execHook.executingRepairId === r.repair_id}
                execResult={execHook.result?.repair_id === r.repair_id ? execHook.result : null}
                generateHook={generateHook}
                applyHook={applyHook}
                simulateHook={simulateHook}
              />
            ))}
          </div>
        )}

        {/* Reserved statuses */}
        {reserved.length > 0 && (
          <CollapsibleSection title={`Other (system-managed) · ${reserved.length}`} defaultOpen={false}>
            <div className="space-y-2">
              {reserved.map(r => (
                <RepairCard key={r.repair_id} repair={r} projectId={projectId} onExecute={handleExecute} isExecuting={false} execResult={null} noActions generateHook={generateHook} applyHook={applyHook} simulateHook={simulateHook} />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* History */}
        {history.length > 0 && (
          <CollapsibleSection title={`History · ${history.length}`} defaultOpen={false}>
            <div className="space-y-2">
              {history.map(r => (
                <RepairCard key={r.repair_id} repair={r} projectId={projectId} onExecute={handleExecute} isExecuting={false} execResult={null} noActions generateHook={generateHook} applyHook={applyHook} simulateHook={simulateHook} />
              ))}
              {(repairs ?? []).filter(r => (HISTORY_STATUSES as readonly string[]).includes(r.status)).length > HISTORY_CAP && (
                <p className="text-[10px] text-muted-foreground">Showing 50 most recent — older plans not displayed.</p>
              )}
            </div>
          </CollapsibleSection>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Collapsible Section ── */

function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between h-7 text-xs text-muted-foreground">
          {title}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ── Repair Card ── */

function RepairCard({ repair, projectId, onExecute, isExecuting, execResult, noActions, generateHook, applyHook, simulateHook }: {
  repair: NarrativeRepair;
  projectId: string;
  onExecute: (id: string, approved?: boolean) => void;
  isExecuting: boolean;
  execResult: any;
  noActions?: boolean;
  generateHook: ReturnType<typeof useGeneratePatchProposal>;
  applyHook: ReturnType<typeof useApplyPatchProposal>;
  simulateHook: ReturnType<typeof useSimulateNarrativePatch>;
}) {
  const [expanded, setExpanded] = useState(false);
  const repStyle = REPAIRABILITY_STYLE[repair.repairability] ?? REPAIRABILITY_STYLE.unknown;
  const stStyle = STATUS_STYLE[repair.status] ?? { label: repair.status, color: 'text-muted-foreground' };

  const isTerminal = ['completed', 'failed', 'skipped', 'dismissed'].includes(repair.status);
  const isPatchable = PATCH_PROPOSAL_TYPES.has(repair.repair_type);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div id={`repair-card-${repair.repair_id}`} className="rounded-md border border-border/50 bg-card p-3 space-y-2 transition-all">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0 flex-1">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={repStyle.variant} className="text-[10px]">{repStyle.label}</Badge>
              <Badge variant="outline" className={`text-[10px] ${stStyle.color}`}>{stStyle.label}</Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">P{repair.priority_score}</Badge>
              <Badge variant="secondary" className="text-[10px]">{repair.repair_type}</Badge>
            </div>
            {/* Summary */}
            {repair.summary && <p className="text-sm text-foreground">{repair.summary}</p>}
            {!repair.summary && <p className="text-sm text-muted-foreground">{repair.repair_type} — {repair.diagnostic_type ?? 'unknown'}</p>}
            {/* Scope */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {repair.scope_key ? `${repair.scope_type}: ${repair.scope_key}` : repair.scope_type}
              </Badge>
            </div>
            {/* Skipped reason */}
            {repair.skipped_reason && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Skipped: {repair.skipped_reason}</p>
            )}
            {/* Created */}
            <p className="text-[10px] text-muted-foreground">{new Date(repair.created_at).toLocaleString()}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Action buttons — patchable pending repairs have no collapsed action button */}
            {!noActions && !isTerminal && !(isPatchable && repair.status === 'pending') && (
              <RepairActionButton
                repair={repair}
                onExecute={onExecute}
                isExecuting={isExecuting}
              />
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        {/* Inline execution result */}
        {execResult && (
          <div className={`rounded border px-2.5 py-2 text-xs ${
            execResult.status === 'completed' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' :
            execResult.status === 'failed' ? 'border-destructive/30 bg-destructive/5 text-destructive' :
            'border-border/40 bg-muted/30 text-muted-foreground'
          }`}>
            <span className="font-medium">{execResult.status === 'completed' ? 'Completed' : execResult.status === 'failed' ? 'Failed' : execResult.status}</span>
            {execResult.outcome_summary && <span> — {execResult.outcome_summary}</span>}
          </div>
        )}

        {/* Expanded details */}
        <CollapsibleContent>
          <div className="space-y-2 pt-1 border-t border-border/30">
            {repair.recommended_action && (
              <div className="rounded border border-primary/20 bg-primary/5 px-2.5 py-2">
                <span className="text-[10px] font-semibold uppercase text-primary">Recommended Action</span>
                <p className="text-xs text-foreground mt-0.5">{repair.recommended_action}</p>
              </div>
            )}

            {/* RP5: Proposal panel for patchable repairs */}
            {isPatchable && repair.status === 'pending' && (
              <ProposalPanel
                repair={repair}
                projectId={projectId}
                generateHook={generateHook}
                applyHook={applyHook}
                simulateHook={simulateHook}
              />
            )}

            {repair.executed_at && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Executed At</span>
                <p className="text-xs text-muted-foreground">{new Date(repair.executed_at).toLocaleString()}</p>
              </div>
            )}
            {repair.execution_result && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Execution Result</span>
                <p className="text-xs text-muted-foreground">
                  {(repair.execution_result as any)?.outcome_summary ?? (repair.execution_result as any)?.status ?? 'See details'}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              {repair.source_system && <span>Source: {repair.source_system}</span>}
              {repair.diagnostic_type && <span>Type: {repair.diagnostic_type}</span>}
              <span>DX: …{repair.source_diagnostic_id.slice(-8)}</span>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ── Proposal Panel (RP5) ── */

function ProposalPanel({ repair, projectId, generateHook, applyHook, simulateHook }: {
  repair: NarrativeRepair;
  projectId: string;
  generateHook: ReturnType<typeof useGeneratePatchProposal>;
  applyHook: ReturnType<typeof useApplyPatchProposal>;
  simulateHook: ReturnType<typeof useSimulateNarrativePatch>;
}) {
  const { data: proposal, isLoading: proposalLoading, error: proposalError, refetch: refetchProposal } = usePatchProposalsByRepair(repair.repair_id);
  const [confirmMode, setConfirmMode] = useState(false);
  const [stabilityEnabled, setStabilityEnabled] = useState(false);

  // Projected stability — enabled when Preview Impact is clicked
  const stabilityHook = useProjectedNarrativeStability(
    projectId,
    proposal?.proposal_id,
    stabilityEnabled && !!proposal?.proposal_id,
  );

  const handleGenerate = useCallback(() => {
    generateHook.generate(repair.repair_id);
  }, [generateHook, repair.repair_id]);

  const handleApply = useCallback(() => {
    if (!proposal) return;
    applyHook.apply(repair.repair_id, proposal.proposal_id);
    setConfirmMode(false);
  }, [applyHook, repair.repair_id, proposal]);

  const handlePreviewImpact = useCallback(() => {
    if (!proposal) return;
    simulateHook.preview(proposal.proposal_id);
    setStabilityEnabled(true);
  }, [simulateHook, proposal]);

  const isGeneratingThis = generateHook.isGenerating;
  const isApplyingThis = applyHook.isApplying;

  // Loading proposal
  if (proposalLoading) {
    return (
      <div className="rounded border border-border/30 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading proposal...
        </div>
      </div>
    );
  }

  // Proposal query error
  if (proposalError) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/5 px-3 py-2">
        <p className="text-xs text-destructive">Unable to load proposal: {proposalError}</p>
      </div>
    );
  }

  // STATE 1: No proposal exists
  if (!proposal) {
    return (
      <div className="rounded border border-border/30 bg-muted/20 px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">No patch proposal generated yet.</span>
        </div>
        {generateHook.error && (
          <p className="text-xs text-destructive">{generateHook.error}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleGenerate}
          disabled={isGeneratingThis}
        >
          {isGeneratingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
          {isGeneratingThis ? 'Generating patch proposal...' : 'Generate Proposal'}
        </Button>
      </div>
    );
  }

  // Proposal exists — render based on status
  return (
    <div className="rounded border border-border/30 bg-muted/20 px-3 py-2.5 space-y-2.5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Patch Proposal</span>
        <ProposalStatusBadge status={proposal.status} />
        {proposal.generator_model && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">{proposal.generator_model}</Badge>
        )}
        <span className="text-[10px] text-muted-foreground">{new Date(proposal.created_at).toLocaleString()}</span>
      </div>

      {/* Rationale */}
      {proposal.rationale && (
        <div className="space-y-0.5">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Rationale</span>
          <p className="text-xs text-foreground">{proposal.rationale}</p>
        </div>
      )}

      {/* STATE 4: Applied */}
      {proposal.status === 'applied' && (
        <div className="space-y-1">
          {proposal.applied_at && (
            <p className="text-[10px] text-muted-foreground">Applied: {new Date(proposal.applied_at).toLocaleString()}</p>
          )}
        </div>
      )}

      {/* STATE 5: Rejected */}
      {proposal.status === 'rejected' && (
        <div className="space-y-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleGenerate} disabled={isGeneratingThis}>
            {isGeneratingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Regenerate Proposal
          </Button>
        </div>
      )}

      {/* STATE 3: Stale */}
      {proposal.status === 'stale' && (
        <div className="space-y-2">
          <p className="text-xs text-amber-600 dark:text-amber-400">Proposal is outdated — seed was modified.</p>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleGenerate} disabled={isGeneratingThis}>
            {isGeneratingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Regenerate Proposal
          </Button>
          <PatchPreview proposal={proposal} />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground"
            onClick={handlePreviewImpact}
            disabled={simulateHook.isPreviewing}
          >
            {simulateHook.isPreviewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {simulateHook.isPreviewing ? 'Previewing...' : 'Preview Impact'}
          </Button>
          {simulateHook.result?.proposal_id === proposal.proposal_id && (
            <ImpactPreviewBlock result={simulateHook.result} stabilityData={stabilityHook.data} stabilityLoading={stabilityHook.isLoading} stabilityError={stabilityHook.error} />
          )}
          {simulateHook.error && !simulateHook.isPreviewing && (
            <p className="text-xs text-muted-foreground">Impact preview unavailable: {simulateHook.error}</p>
          )}
        </div>
      )}

      {/* STATE 2: Proposed — show patch preview + apply */}
      {proposal.status === 'proposed' && (
        <div className="space-y-2.5">
          <PatchPreview proposal={proposal} />

          {/* Impact preview */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground"
            onClick={handlePreviewImpact}
            disabled={simulateHook.isPreviewing}
          >
            {simulateHook.isPreviewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {simulateHook.isPreviewing ? 'Previewing...' : 'Preview Impact'}
          </Button>
          {simulateHook.result?.proposal_id === proposal.proposal_id && (
            <ImpactPreviewBlock result={simulateHook.result} stabilityData={stabilityHook.data} stabilityLoading={stabilityHook.isLoading} stabilityError={stabilityHook.error} />
          )}
          {simulateHook.error && !simulateHook.isPreviewing && (
            <p className="text-xs text-muted-foreground">Impact preview unavailable: {simulateHook.error}</p>
          )}
          {/* Apply feedback */}
          {applyHook.result && applyHook.result.repair_id === repair.repair_id && (
            <div className={`rounded border px-2.5 py-2 text-xs ${
              applyHook.result.post_dx_diagnostic_present
                ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
            }`}>
              {applyHook.result.post_dx_diagnostic_present
                ? '✗ Applied but diagnostic persists — consider regenerating'
                : '✓ Patch applied — diagnostic resolved'}
              {applyHook.result.outcome_summary && <span> — {applyHook.result.outcome_summary}</span>}
            </div>
          )}

          {applyHook.error && (
            <p className="text-xs text-destructive">{applyHook.error}</p>
          )}

          {/* Confirm mode */}
          {confirmMode ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-2">
              <p className="text-xs text-amber-700 dark:text-amber-300">⚠ This will update your Dev Seed v2 and cannot be undone.</p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleApply}
                  disabled={isApplyingThis}
                >
                  {isApplyingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  {isApplyingThis ? 'Applying patch...' : 'Confirm Apply'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setConfirmMode(false)}
                  disabled={isApplyingThis}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setConfirmMode(true)}
              disabled={isApplyingThis}
            >
              <CheckCircle2 className="h-3 w-3" />
              Apply Proposal
            </Button>
          )}
        </div>
      )}

      {/* Generation error */}
      {generateHook.error && (
        <p className="text-xs text-destructive">{generateHook.error}</p>
      )}
    </div>
  );
}

/* ── Proposal Status Badge ── */

function ProposalStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    proposed: { label: 'Proposed', className: 'text-sky-600 dark:text-sky-400' },
    applied: { label: 'Applied', className: 'text-emerald-600 dark:text-emerald-400' },
    rejected: { label: 'Rejected', className: 'text-destructive' },
    stale: { label: 'Stale', className: 'text-amber-600 dark:text-amber-400' },
  };
  const s = map[status] ?? { label: status, className: 'text-muted-foreground' };
  return <Badge variant="outline" className={`text-[10px] ${s.className}`}>{s.label}</Badge>;
}

/* ── Patch Preview ── */

function PatchPreview({ proposal }: { proposal: NarrativePatchProposal }) {
  const patch = proposal.proposed_patch;

  if (!patch) {
    return <p className="text-xs text-muted-foreground italic">Unable to display proposal contents.</p>;
  }

  // Relation graph patch
  if (proposal.patch_type === 'repair_relation_graph' && patch.entity_relations) {
    if (!Array.isArray(patch.entity_relations) || patch.entity_relations.length === 0) {
      return <p className="text-xs text-muted-foreground italic">Unable to display proposal contents.</p>;
    }
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Proposed Relations</span>
        <div className="space-y-1">
          {patch.entity_relations.map((rel, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-foreground font-mono">
              <span className="text-muted-foreground">{rel.source_entity_key ?? '?'}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <Badge variant="outline" className="text-[10px]">{rel.relation_type ?? '?'}</Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{rel.target_entity_key ?? '?'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Structural beats patch
  if (proposal.patch_type === 'repair_structural_beats' && patch.beats) {
    if (!Array.isArray(patch.beats) || patch.beats.length === 0) {
      return <p className="text-xs text-muted-foreground italic">Unable to display proposal contents.</p>;
    }
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Proposed Beats</span>
        <div className="space-y-1.5">
          {patch.beats.map((beat, i) => (
            <div key={i} className="rounded border border-border/30 bg-card px-2 py-1.5 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{beat.beat_key ?? `beat_${i}`}</Badge>
                {beat.narrative_axis_reference && (
                  <Badge variant="secondary" className="text-[10px]">{beat.narrative_axis_reference}</Badge>
                )}
                {beat.expected_turn && (
                  <span className="text-[10px] text-muted-foreground">Turn: {beat.expected_turn}</span>
                )}
              </div>
              <p className="text-xs text-foreground">
                {beat.beat_description
                  ? beat.beat_description.length > 100
                    ? beat.beat_description.slice(0, 100) + '…'
                    : beat.beat_description
                  : 'No description'}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback for unknown patch structure
  return <p className="text-xs text-muted-foreground italic">Unable to display proposal contents.</p>;
}

/* ── Impact Preview Block ── */

const IMPACT_BAND_STYLE: Record<string, string> = {
  none: 'text-muted-foreground border-border/40',
  limited: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  moderate: 'text-amber-600 dark:text-amber-400 border-amber-500/30',
  broad: 'text-orange-600 dark:text-orange-400 border-orange-500/30',
  systemic: 'text-destructive border-destructive/30',
};

function getBlastStyle(score: number): string {
  if (score <= 25) return 'text-emerald-600 dark:text-emerald-400';
  if (score <= 50) return 'text-amber-600 dark:text-amber-400';
  if (score <= 75) return 'text-orange-600 dark:text-orange-400';
  return 'text-destructive';
}

const PROJECTED_EFFECT_STYLE: Record<string, string> = {
  stabilizing: 'text-emerald-600 dark:text-emerald-400',
  likely_improving: 'text-green-600 dark:text-green-400',
  neutral: 'text-muted-foreground',
  likely_destabilizing: 'text-amber-600 dark:text-amber-400',
  destabilizing: 'text-destructive',
  unknown: 'text-muted-foreground',
};

const PROJECTED_EFFECT_LABEL: Record<string, string> = {
  stabilizing: 'Stabilizing',
  likely_improving: 'Likely Improving',
  neutral: 'Neutral',
  likely_destabilizing: 'Likely Destabilizing',
  destabilizing: 'Destabilizing',
  unknown: 'Unknown',
};

function ImpactPreviewBlock({ result, stabilityData, stabilityLoading, stabilityError }: {
  result: SimulateNarrativePatchResult;
  stabilityData?: import('@/hooks/useProjectedNarrativeStability').ProjectedNarrativeStabilityData | null;
  stabilityLoading?: boolean;
  stabilityError?: string | null;
}) {
  const bandStyle = IMPACT_BAND_STYLE[result.impact_band] ?? IMPACT_BAND_STYLE.none;
  const blastStyle = getBlastStyle(result.blast_radius_score);

  if (result.simulation_state === 'no_impact' || result.impact_band === 'none') {
    return (
      <div className="rounded border border-border/30 bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground">No impact detected for current project state.</p>
      </div>
    );
  }

  const axes = result.affected_axes_enriched?.slice(0, 6) ?? [];

  return (
    <div className="rounded border border-border/30 bg-muted/20 px-3 py-2.5 space-y-2">
      {/* 1. Impact band */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Zap className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Impact Preview</span>
        <Badge variant="outline" className={`text-[10px] ${bandStyle}`}>{result.impact_band}</Badge>
        <span className={`text-[10px] font-semibold ${blastStyle}`}>Blast: {result.blast_radius_score}</span>
      </div>

      {/* 3. Scene summary */}
      <p className="text-xs text-muted-foreground">
        Impacted scenes: {result.impacted_scene_count} ({result.direct_scene_count} direct, {result.propagated_scene_count} propagated)
        {result.entity_link_scene_count > 0 && ` + ${result.entity_link_scene_count} entity-linked`}
      </p>

      {/* 4. Affected axes */}
      {axes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {axes.map((ax) => (
            <div key={ax.axis} className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px]">{ax.label}</Badge>
              <span className="text-[10px] text-muted-foreground">{ax.class}</span>
              <span className="text-[10px] text-muted-foreground">{ax.severity}</span>
              {ax.is_direct && <Badge variant="secondary" className="text-[9px] px-1 py-0 text-sky-600 dark:text-sky-400">direct</Badge>}
            </div>
          ))}
        </div>
      )}

      {/* 5. Confidence + notes */}
      <div className="space-y-0.5">
        {result.simulation_confidence != null && (
          <p className="text-[10px] text-muted-foreground">Confidence: {result.simulation_confidence}%</p>
        )}
      </div>

      {/* 6. Projected Stability (NSI3) */}
      {stabilityLoading && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading projected stability...
        </div>
      )}
      {stabilityData && (
        <div className="rounded border border-border/20 bg-muted/10 px-2.5 py-2 space-y-1">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Projected Stability</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {stabilityData.current_nsi != null && (
              <Badge variant="outline" className="text-[10px]">NSI: {stabilityData.current_nsi}</Badge>
            )}
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant="outline" className={`text-[10px] ${PROJECTED_EFFECT_STYLE[stabilityData.projected_effect] ?? 'text-muted-foreground'}`}>
              {PROJECTED_EFFECT_LABEL[stabilityData.projected_effect] ?? stabilityData.projected_effect}
            </Badge>
          </div>
          {stabilityData.projected_nsi_range && stabilityData.current_nsi != null && (
            <p className="text-[10px] text-muted-foreground">
              range: {stabilityData.current_nsi} → {stabilityData.projected_nsi_range.low}–{stabilityData.projected_nsi_range.high}
              {stabilityData.projected_delta !== 0 && (
                <span className={stabilityData.projected_delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {' '}({stabilityData.projected_delta > 0 ? '+' : ''}{stabilityData.projected_delta})
                </span>
              )}
            </p>
          )}
          {stabilityData.stale_warning && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">{stabilityData.stale_warning}</p>
          )}
        </div>
      )}
      {stabilityError && !stabilityLoading && (
        <p className="text-[10px] text-muted-foreground">Projected stability unavailable.</p>
      )}

      {/* 7. Simulation note */}
      <div className="space-y-0.5">
        {result.simulation_note && (
          <p className="text-[10px] text-muted-foreground">{result.simulation_note}</p>
        )}
        {result.structural_uncertainty_reason && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">{result.structural_uncertainty_reason}</p>
        )}
      </div>
    </div>
  );
}

/* ── Recommended Repair Order Section ── */

const LABEL_STYLE: Record<string, string> = {
  'High Return': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  'High Return / High Risk': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  'Low Return / High Risk': 'bg-destructive/10 text-destructive border-destructive/30',
  'Blocked / Manual Heavy': 'bg-muted text-muted-foreground border-border/40',
  'Proposal Needed': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  'Standard Priority': 'bg-muted text-muted-foreground border-border/40',
};

/* ─── ARP4: Path label styling ─── */
const PATH_LABEL_STYLE: Record<string, string> = {
  'Highest Gain': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  'Safest Path': 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30',
  'Fastest Path': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  'Balanced Path': 'bg-muted text-muted-foreground border-border/40',
  'Proposal-Led Path': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  'Investigate Then Repair': 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
};

/* ─── ARP5: Counterfactual Repair Strategies Section ─── */

const SEQUENTIAL_EFFECT_STYLE: Record<string, string> = {
  strengthened_by_sequence: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  prerequisite_aligned: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  de_risked_by_investigation: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
  redundant_sequence: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  proposal_friction_constrained: 'bg-destructive/10 text-destructive border-destructive/30',
  neutral_sequence: 'bg-muted/50 text-muted-foreground border-border',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  low: 'bg-muted/50 text-muted-foreground border-border',
};

function CounterfactualRepairStrategiesSection({ data, isLoading, error }: {
  data: import('@/hooks/useEvaluatedRepairPaths').EvaluatedRepairPathsData | null;
  isLoading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Sequential repair strategy evaluation unavailable.</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Counterfactual Repair Strategies</p>
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full rounded-md" />)}
      </div>
    );
  }

  if (!data || !data.evaluated_paths || data.evaluated_paths.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No counterfactual repair strategies available for this project.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium text-foreground">Counterfactual Repair Strategies</p>
        <p className="text-[10px] text-muted-foreground">Sequential evaluation of repair paths using CSP1 interaction modelling.</p>
      </div>
      {data.evaluated_paths.map((path) => (
        <CounterfactualPathCard key={path.path_id} path={path} />
      ))}
    </div>
  );
}

function CounterfactualPathCard({ path }: { path: EvaluatedPath }) {
  const effectStyle = SEQUENTIAL_EFFECT_STYLE[path.sequential_effect_label] ?? SEQUENTIAL_EFFECT_STYLE.neutral_sequence;
  const confStyle = CONFIDENCE_STYLE[path.confidence] ?? CONFIDENCE_STYLE.low;
  const deltaColor = path.adjustment_delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : path.adjustment_delta < 0 ? 'text-destructive' : 'text-muted-foreground';

  return (
    <div className="rounded-md border border-border/50 bg-card p-3 space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={`text-[10px] ${PATH_LABEL_STYLE[path.path_label] ?? 'bg-muted/50 text-muted-foreground border-border'}`}>
          {path.path_label}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${effectStyle}`}>
          {path.sequential_effect_label.replace(/_/g, ' ')}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${confStyle}`}>
          {path.confidence}
        </Badge>
      </div>

      {/* Score Panel */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">Baseline: <span className="font-medium text-foreground">{path.baseline_path_score}</span></span>
        <span className="text-muted-foreground">Adjusted: <span className="font-medium text-foreground">{path.adjusted_path_score}</span></span>
        <span className={`font-semibold ${deltaColor}`}>
          Δ {path.adjustment_delta > 0 ? '+' : ''}{path.adjustment_delta}
        </span>
      </div>

      {/* Steps */}
      <div className="space-y-1.5 pl-1 border-l-2 border-border/50 ml-1">
        {path.steps.map((step, idx) => (
          <CounterfactualStepRow key={step.repair_id} step={step} index={idx} />
        ))}
      </div>

      {/* Interaction Notes */}
      {path.interaction_notes.length > 0 && (
        <ul className="text-[10px] text-muted-foreground space-y-0.5 pl-3 list-disc">
          {path.interaction_notes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      )}
    </div>
  );
}

function CounterfactualStepRow({ step, index }: { step: EvaluatedStep; index: number }) {
  const adj = step.sequential_adjustments;

  const handleClick = () => {
    const el = document.getElementById(`repair-card-${step.repair_id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary/50');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary/50'), 2000);
    }
  };

  const deltaLabel = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  const deltaColor = (v: number) => v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : 'text-muted-foreground';

  return (
    <button type="button" onClick={handleClick} className="w-full text-left pl-2 py-1 hover:bg-accent/30 rounded transition-colors space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-mono text-[10px] text-muted-foreground">{index + 1}.</span>
        <span className="text-foreground">{step.repair_type.replace(/_/g, ' ')}</span>
        {step.scope_key && <span className="text-[10px] text-muted-foreground">({step.scope_key})</span>}
        {step.proposal_required && (
          <Badge variant="outline" className="text-[9px] text-sky-600 dark:text-sky-400 border-sky-500/30">Proposal</Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground pl-4">
        <span>Gain <span className={`font-medium ${deltaColor(adj.gain_delta)}`}>{deltaLabel(adj.gain_delta)}</span></span>
        <span>Blast <span className={`font-medium ${deltaColor(adj.blast_delta)}`}>{deltaLabel(adj.blast_delta)}</span></span>
        <span>Friction <span className={`font-medium ${deltaColor(adj.friction_delta)}`}>{deltaLabel(adj.friction_delta)}</span></span>
      </div>
      {adj.reasons.length > 0 && (
        <ul className="text-[10px] text-muted-foreground/70 pl-4 list-disc list-inside">
          {adj.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </button>
  );
}

/* ─── ARP4: Recommended Repair Strategies Section ─── */
function RecommendedRepairStrategiesSection({ data, isLoading, error }: {
  data: import('@/hooks/useRecommendedRepairPaths').RecommendedRepairPathsData | null;
  isLoading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex items-center gap-2 px-1 py-1">
        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Repair strategy planner unavailable.</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Recommended Repair Strategies</p>
          <p className="text-xs text-muted-foreground">Multi-step repair paths optimized for narrative stability.</p>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-md" />)}
        </div>
      </div>
    );
  }

  if (!data || data.paths.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Recommended Repair Strategies</p>
        <p className="text-xs text-muted-foreground">No repair strategies available for the current project state.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Recommended Repair Strategies</p>
        <p className="text-xs text-muted-foreground">Multi-step repair paths optimized for narrative stability.</p>
      </div>

      <div className="space-y-2">
        {data.paths.map((path, idx) => (
          <RepairPathCard key={idx} path={path} />
        ))}
      </div>

      {data.excluded_repairs.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="h-3 w-3" />
            Excluded Repairs ({data.excluded_repairs.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-1.5">
            {data.excluded_repairs.map((er, i) => (
              <div key={i} className="flex items-start gap-2 rounded border border-border/40 bg-muted/20 px-2.5 py-2">
                <Ban className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-foreground">{er.repair_type}</p>
                  <p className="text-xs text-muted-foreground">{er.reason}</p>
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function RepairPathCard({ path }: { path: RepairPath }) {
  const labelStyle = PATH_LABEL_STYLE[path.path_label] ?? 'bg-muted text-muted-foreground border-border/40';

  const handleStepClick = (repairId: string) => {
    const el = document.getElementById(`repair-card-${repairId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary/50');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary/50'), 2000);
    }
  };

  return (
    <div className="rounded-md border border-border/50 bg-card/50 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={`text-[10px] px-2 py-0 ${labelStyle}`}>
          {path.path_label}
        </Badge>
        <span className="text-xs font-semibold text-foreground tabular-nums">Score {path.path_score}</span>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {path.steps.map((step, si) => (
          <button
            key={si}
            onClick={() => handleStepClick(step.repair_id)}
            className="w-full flex items-start gap-2 text-left rounded px-1.5 py-1 hover:bg-muted/40 transition-colors"
          >
            <span className="text-[10px] font-semibold text-muted-foreground mt-0.5 shrink-0 w-4 text-right">{si + 1}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-xs text-foreground truncate">{step.summary || step.repair_type}</p>
              {step.scope_key && (
                <p className="text-[10px] text-muted-foreground">scope: {step.scope_key}</p>
              )}
              {step.proposal_required && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30">
                  Proposal Required
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Metrics */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <span>Gain: <span className="font-semibold text-foreground">{path.expected_stability_gain}</span></span>
        <span>Risk: <span className="font-semibold text-foreground">{path.blast_risk}</span></span>
        <span>Friction: <span className="font-semibold text-foreground">{path.execution_friction}</span></span>
        <span>Urgency: <span className="font-semibold text-foreground">{path.urgency}</span></span>
      </div>

      {/* Notes */}
      {path.notes && path.notes.length > 0 && (
        <div className="text-[10px] text-muted-foreground space-y-0.5 pt-1">
          {path.notes.map((n, ni) => <p key={ni}>• {n}</p>)}
        </div>
      )}
    </div>
  );
}

function RecommendedRepairOrderSection({ data, isLoading, error }: {
  data: import('@/hooks/useRecommendedRepairOrder').RecommendedRepairOrderData | null;
  isLoading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground">Repair prioritization unavailable.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Recommended Repair Order</span>
        </div>
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }

  if (!data) return null;

  const { recommendations, blocked_repairs } = data;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Recommended Repair Order</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Repairs ranked by expected stability improvement, urgency, and structural risk.
        </p>
      </div>

      {recommendations.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          <span className="text-xs text-muted-foreground">No pending repairs requiring prioritization.</span>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-1.5">
          {recommendations.map(rec => (
            <RecommendationCard key={rec.repair_id} recommendation={rec} />
          ))}
        </div>
      )}

      {blocked_repairs.length > 0 && (
        <CollapsibleSection title={`Blocked Repairs · ${blocked_repairs.length}`} defaultOpen={false}>
          <div className="space-y-1.5">
            {blocked_repairs.map((br, i) => (
              <div key={br.repair_id ?? i} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Ban className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">{br.repair_type}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{br.reason}</p>
                <p className="text-[10px] text-muted-foreground">Next: {br.next_action}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

/* ── Recommendation Card ── */

function RecommendationCard({ recommendation }: { recommendation: RepairRecommendation }) {
  const labelStyle = LABEL_STYLE[recommendation.recommendation_label] ?? LABEL_STYLE['Standard Priority'];

  const handleClick = () => {
    // Scroll to the repair card in the queue
    const el = document.getElementById(`repair-card-${recommendation.repair_id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight
      el.classList.add('ring-2', 'ring-primary/50');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary/50'), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left rounded-md border border-border/50 bg-card hover:bg-accent/30 transition-colors px-3 py-2 space-y-1.5"
    >
      <div className="flex items-start gap-2">
        <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">#{recommendation.priority_rank}</Badge>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-foreground line-clamp-2">{recommendation.summary}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`text-[10px] ${labelStyle}`}>
              {recommendation.recommendation_label}
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Score: {recommendation.net_priority_score}
            </Badge>
            {recommendation.proposal_required && (
              <Badge variant="outline" className="text-[10px] text-sky-600 dark:text-sky-400 border-sky-500/30">
                Proposal required
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span>Gain: <span className="font-medium text-foreground">{recommendation.expected_stability_gain}</span></span>
            <span>Risk: <span className="font-medium text-foreground">{recommendation.blast_risk_score}</span></span>
            <span>Friction: <span className="font-medium text-foreground">{recommendation.execution_friction_score}</span></span>
            <span>Urgency: <span className="font-medium text-foreground">{recommendation.urgency_score}</span></span>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ── Action Button ── */


function RepairActionButton({ repair, onExecute, isExecuting }: {
  repair: NarrativeRepair;
  onExecute: (id: string, approved?: boolean) => void;
  isExecuting: boolean;
}) {
  if (repair.status !== 'pending') return null;

  // Patchable types have no collapsed action button — proposal controls are in expanded panel
  if (PATCH_PROPOSAL_TYPES.has(repair.repair_type)) return null;

  if (repair.repairability === 'auto') {
    return (
      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onExecute(repair.repair_id)} disabled={isExecuting}>
        {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        Execute
      </Button>
    );
  }

  if (repair.repairability === 'guided') {
    return (
      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onExecute(repair.repair_id, true)} disabled={isExecuting}>
        {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
        Approve & Execute
      </Button>
    );
  }

  if (repair.repairability === 'investigatory') {
    return (
      <Button size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={() => onExecute(repair.repair_id)} disabled={isExecuting}>
        {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
        Investigate
      </Button>
    );
  }

  if (repair.repairability === 'manual') {
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Manual Resolution Required</Badge>;
  }

  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Unsupported</Badge>;
}
