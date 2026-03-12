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
} from 'lucide-react';

interface Props {
  projectId: string;
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

export function NarrativeRepairQueuePanel({ projectId }: Props) {
  const { data: repairs, isLoading, error, refresh: refreshQueue } = useNarrativeRepairs(projectId);
  const { planRepairs, isPlanning, error: planError } = usePlanNarrativeRepairs(projectId);
  const execHook = useExecuteNarrativeRepair(projectId);
  const generateHook = useGeneratePatchProposal(projectId);
  const applyHook = useApplyPatchProposal(projectId);
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
              />
            ))}
          </div>
        )}

        {/* Reserved statuses */}
        {reserved.length > 0 && (
          <CollapsibleSection title={`Other (system-managed) · ${reserved.length}`} defaultOpen={false}>
            <div className="space-y-2">
              {reserved.map(r => (
                <RepairCard key={r.repair_id} repair={r} projectId={projectId} onExecute={handleExecute} isExecuting={false} execResult={null} noActions generateHook={generateHook} applyHook={applyHook} />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* History */}
        {history.length > 0 && (
          <CollapsibleSection title={`History · ${history.length}`} defaultOpen={false}>
            <div className="space-y-2">
              {history.map(r => (
                <RepairCard key={r.repair_id} repair={r} projectId={projectId} onExecute={handleExecute} isExecuting={false} execResult={null} noActions generateHook={generateHook} applyHook={applyHook} />
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

function RepairCard({ repair, projectId, onExecute, isExecuting, execResult, noActions, generateHook, applyHook }: {
  repair: NarrativeRepair;
  projectId: string;
  onExecute: (id: string, approved?: boolean) => void;
  isExecuting: boolean;
  execResult: any;
  noActions?: boolean;
  generateHook: ReturnType<typeof useGeneratePatchProposal>;
  applyHook: ReturnType<typeof useApplyPatchProposal>;
}) {
  const [expanded, setExpanded] = useState(false);
  const repStyle = REPAIRABILITY_STYLE[repair.repairability] ?? REPAIRABILITY_STYLE.unknown;
  const stStyle = STATUS_STYLE[repair.status] ?? { label: repair.status, color: 'text-muted-foreground' };

  const isTerminal = ['completed', 'failed', 'skipped', 'dismissed'].includes(repair.status);
  const isPatchable = PATCH_PROPOSAL_TYPES.has(repair.repair_type);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="rounded-md border border-border/50 bg-card p-3 space-y-2">
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

function ProposalPanel({ repair, projectId, generateHook, applyHook }: {
  repair: NarrativeRepair;
  projectId: string;
  generateHook: ReturnType<typeof useGeneratePatchProposal>;
  applyHook: ReturnType<typeof useApplyPatchProposal>;
}) {
  const { data: proposal, isLoading: proposalLoading, error: proposalError, refetch: refetchProposal } = usePatchProposalsByRepair(repair.repair_id);
  const [confirmMode, setConfirmMode] = useState(false);

  const handleGenerate = useCallback(() => {
    generateHook.generate(repair.repair_id);
  }, [generateHook, repair.repair_id]);

  const handleApply = useCallback(() => {
    if (!proposal) return;
    applyHook.apply(repair.repair_id, proposal.proposal_id);
    setConfirmMode(false);
  }, [applyHook, repair.repair_id, proposal]);

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
        </div>
      )}

      {/* STATE 2: Proposed — show patch preview + apply */}
      {proposal.status === 'proposed' && (
        <div className="space-y-2.5">
          <PatchPreview proposal={proposal} />

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
