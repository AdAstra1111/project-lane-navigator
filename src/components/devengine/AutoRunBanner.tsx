import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Play, Pause, Square, RotateCcw, ChevronDown, ShieldAlert,
  ArrowRight, Loader2, ListOrdered, AlertTriangle, RefreshCcw,
} from 'lucide-react';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-primary/15 text-primary border-primary/30',
  paused: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  stopped: 'bg-muted text-muted-foreground border-border',
  failed: 'bg-destructive/15 text-destructive border-destructive/30',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const DOC_LABELS: Record<string, string> = {
  idea: 'Idea', concept_brief: 'Concept Brief', blueprint: 'Blueprint',
  architecture: 'Architecture', draft: 'Draft', coverage: 'Coverage',
};

interface Props {
  job: AutoRunJob;
  steps: AutoRunStep[];
  isRunning: boolean;
  selectedDocId?: string | null;
  selectedVersionId?: string | null;
  onPause: () => void;
  onRunNext: () => void;
  onResume: (followLatest?: boolean) => void;
  onSetResumeSource: (docId: string, verId: string) => Promise<void>;
  onStop: () => void;
  onClear?: () => void;
  onScrollToApproval?: () => void;
  onScrollToCriteria?: () => void;
}

export function AutoRunBanner({
  job, steps, isRunning, selectedDocId, selectedVersionId,
  onPause, onRunNext, onResume, onSetResumeSource, onStop, onClear, onScrollToApproval, onScrollToCriteria,
}: Props) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [resumingSelected, setResumingSelected] = useState(false);

  const status = job.status;
  const hasHardGate = (job.last_risk_flags || []).some((f: string) => f.startsWith('hard_gate:'));
  const reason = job.stop_reason || job.error || '—';
  const isPausedOrStopped = status === 'paused' || status === 'stopped';
  const hasStepError = !!job.error && status === 'running';
  const isFailed = status === 'failed' || hasStepError;
  const hasSelectedVersion = !!selectedDocId && !!selectedVersionId;
  const isStepLimitPause = job.pause_reason === 'step_limit';
  const hasPendingDecisions = Array.isArray(job.pending_decisions) && job.pending_decisions.length > 0;
  const needsDecisions = !isFailed && hasPendingDecisions && !isStepLimitPause;
  const needsApproval = !isFailed && !hasPendingDecisions && !!job.awaiting_approval && !isStepLimitPause;
  const needsCriteria = (job.stop_reason || '').includes('Missing required criteria');
  const isStaleDoc = !isStepLimitPause && (job.stop_reason || '').includes('Document stale vs current criteria');
  const staleDiffKeys = isStaleDoc ? (job.stop_reason || '').match(/: (.+?)\./)?.[1] || '' : '';

  const handleResumeSelected = async () => {
    if (!selectedDocId || !selectedVersionId) return;
    setResumingSelected(true);
    try {
      await onSetResumeSource(selectedDocId, selectedVersionId);
      onResume();
    } finally {
      setResumingSelected(false);
    }
  };

  const last10 = steps.slice(-10).reverse();

  // E) Extract trace info from latest review step
  const latestReviewStep = steps.find(s => s.action === 'review' || s.action === 'review_input');
  const traceRef = latestReviewStep?.output_ref as any;
  const traceDocId = traceRef?.input_doc_id || traceRef?.docId || null;
  const traceVersionId = traceRef?.input_version_id || traceRef?.versionId || null;
  const traceTextLen = traceRef?.input_text_len ?? traceRef?.char_count ?? null;
  const traceFallback = traceRef?.used_fallback_scores === true;
  const traceCI = traceRef?.analyze_output_ci;
  const traceGP = traceRef?.analyze_output_gp;
  const traceGap = traceRef?.analyze_output_gap;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      {/* Row 1: Title + Status */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Auto-Run</span>
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${STATUS_STYLES[status] || ''}`}>
            {status}
          </Badge>
          {hasHardGate && (
            <Badge
              variant="outline"
              className="text-[9px] px-1.5 py-0 text-destructive border-destructive/40 bg-destructive/10 gap-0.5 cursor-pointer hover:bg-destructive/20 transition-colors"
              onClick={onScrollToApproval}
            >
              <ShieldAlert className="h-2.5 w-2.5" /> Hard Gate
            </Badge>
          )}
          {needsDecisions && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-destructive border-destructive/30 bg-destructive/10">
              Decisions Required
            </Badge>
          )}
          {needsApproval && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10">
              Awaiting Approval
            </Badge>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Step {job.step_count}/{job.max_total_steps}
        </div>
      </div>

      {/* Row 2: Context */}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>
          Stage: <span className="text-foreground font-medium">{DOC_LABELS[job.current_document] || job.current_document}</span>
          {' → '}
          <span className="text-foreground font-medium">{DOC_LABELS[job.target_document] || job.target_document}</span>
        </span>
        {reason !== '—' && (
          <span className="text-amber-400">
            {reason.length > 80 ? reason.slice(0, 80) + '…' : reason}
          </span>
        )}
      </div>

      {/* Row 3: Review context (trace) */}
      {traceDocId && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          <span>Reviewing: <span className="text-foreground font-medium">{DOC_LABELS[job.current_document] || job.current_document}</span></span>
          <span className="font-mono text-[9px]">{traceDocId?.slice(0, 8)}…</span>
          {traceVersionId && <span className="font-mono text-[9px]">v:{traceVersionId.slice(0, 8)}…</span>}
          {traceTextLen != null && <span>{traceTextLen.toLocaleString()} chars</span>}
        </div>
      )}

      {/* Row 4: Extracted scores */}
      {(traceCI != null || job.last_ci != null) && (
        <div className="flex flex-wrap gap-3 text-[10px]">
          <span>CI <span className="font-semibold text-foreground">{traceCI ?? job.last_ci}</span></span>
          <span>GP <span className="font-semibold text-foreground">{traceGP ?? job.last_gp}</span></span>
          {(traceGap ?? job.last_gap) != null && <span>Gap <span className="font-semibold text-foreground">{traceGap ?? job.last_gap}</span></span>}
          {job.last_readiness != null && <span>Readiness <span className="font-semibold text-foreground">{job.last_readiness}</span></span>}
          {job.last_confidence != null && <span>Confidence <span className="font-semibold text-foreground">{job.last_confidence}%</span></span>}
        </div>
      )}

      {/* Fallback scores warning */}
      {traceFallback && (
        <div className="flex items-center gap-1 text-[10px] text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          <span>Fallback scores used — CI/GP could not be extracted from analysis output</span>
        </div>
      )}

      {/* Row 4: Buttons */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {status === 'running' && !hasStepError && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onPause}>
              <Pause className="h-3 w-3" /> Pause
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onRunNext} disabled={isRunning}>
              <ArrowRight className="h-3 w-3" /> Run next
            </Button>
          </>
        )}

        {isPausedOrStopped && (
          <>
            <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => onResume(true)}>
              <Play className="h-3 w-3" /> Continue from latest
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
              disabled={!hasSelectedVersion || resumingSelected}
              onClick={handleResumeSelected}>
              {resumingSelected ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Continue from selected
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1" onClick={status === 'stopped' ? onClear : onStop}>
              <Square className="h-3 w-3" /> End job
            </Button>
          </>
        )}

        {isFailed && (
          <>
            <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => onResume(true)}>
              <RotateCcw className="h-3 w-3" /> Reset & retry
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1" onClick={() => { onStop(); onClear?.(); }}>
              <Square className="h-3 w-3" /> End job
            </Button>
          </>
        )}

        {/* Decision CTA takes priority over approval CTA */}
        {needsDecisions && onScrollToApproval && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-destructive/30 text-destructive" onClick={onScrollToApproval}>
            <AlertTriangle className="h-3 w-3" /> Review decisions ({(job.pending_decisions as any[]).length})
          </Button>
        )}

        {needsApproval && onScrollToApproval && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-amber-500/30 text-amber-400" onClick={onScrollToApproval}>
            <AlertTriangle className="h-3 w-3" /> Review & approve
          </Button>
        )}

        {needsCriteria && onScrollToCriteria && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-amber-500/30 text-amber-400" onClick={onScrollToCriteria}>
            <AlertTriangle className="h-3 w-3" /> Fix criteria
          </Button>
        )}

        {isStaleDoc && (
          <div className="flex flex-col gap-1.5 w-full">
            <div className="flex items-start gap-2 p-2 rounded-md border border-amber-500/30 bg-amber-500/5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-[10px] text-amber-400 font-medium">
                  Document may be outdated — project criteria changed{staleDiffKeys ? ` (${staleDiffKeys})` : ''}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  Choose how to proceed:
                </p>
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Button size="sm" variant="default" className="h-7 text-[10px] gap-1"
                onClick={() => onResume()}>
                <RefreshCcw className="h-3 w-3" /> Regenerate document
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                onClick={() => onResume(true)}>
                <Play className="h-3 w-3" /> Keep current &amp; continue
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-muted-foreground"
                onClick={onScrollToCriteria}>
                Review criteria first
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Steps accordion */}
      {last10.length > 0 && (
        <Collapsible open={stepsOpen} onOpenChange={setStepsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground pt-1">
            <ListOrdered className="h-3 w-3" />
            Last {last10.length} steps
            <ChevronDown className={`h-3 w-3 transition-transform ${stepsOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 space-y-0.5 max-h-[200px] overflow-y-auto">
              {last10.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[9px] text-muted-foreground py-0.5 px-1 rounded bg-muted/30">
                  <span className="font-mono text-[8px] text-muted-foreground/60">#{s.step_index}</span>
                  <Badge variant="outline" className="text-[7px] px-1 py-0">{s.document}</Badge>
                  <span className="truncate flex-1">{s.action}{s.summary ? ` — ${s.summary}` : ''}</span>
                  {s.ci != null && <span className="shrink-0">CI:{s.ci}</span>}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
