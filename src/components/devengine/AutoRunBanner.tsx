import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Play, Pause, Square, RotateCcw, ChevronDown, ShieldAlert,
  ArrowRight, Loader2, ListOrdered, AlertTriangle,
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
  onScrollToApproval?: () => void;
}

export function AutoRunBanner({
  job, steps, isRunning, selectedDocId, selectedVersionId,
  onPause, onRunNext, onResume, onSetResumeSource, onStop, onScrollToApproval,
}: Props) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [resumingSelected, setResumingSelected] = useState(false);

  const status = job.status;
  const hasHardGate = (job.last_risk_flags || []).some((f: string) => f.startsWith('hard_gate:'));
  const reason = job.stop_reason || job.error || '—';
  const isPausedOrStopped = status === 'paused' || status === 'stopped';
  const isFailed = status === 'failed';
  const hasSelectedVersion = !!selectedDocId && !!selectedVersionId;
  const needsApproval = job.awaiting_approval || (job.pending_decisions && (job.pending_decisions as any[]).length > 0);

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
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-destructive border-destructive/40 bg-destructive/10 gap-0.5">
              <ShieldAlert className="h-2.5 w-2.5" /> Hard Gate
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

      {/* Row 3: Metrics */}
      {(job.last_ci != null || job.last_gp != null) && (
        <div className="flex flex-wrap gap-3 text-[10px]">
          {job.last_ci != null && <span>CI <span className="font-semibold text-foreground">{job.last_ci}</span></span>}
          {job.last_gp != null && <span>GP <span className="font-semibold text-foreground">{job.last_gp}</span></span>}
          {job.last_gap != null && <span>Gap <span className="font-semibold text-foreground">{job.last_gap}</span></span>}
          {job.last_readiness != null && <span>Readiness <span className="font-semibold text-foreground">{job.last_readiness}</span></span>}
          {job.last_confidence != null && <span>Confidence <span className="font-semibold text-foreground">{job.last_confidence}%</span></span>}
        </div>
      )}

      {/* Row 4: Buttons */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {status === 'running' && (
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
            <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1" onClick={onStop}>
              <Square className="h-3 w-3" /> End job
            </Button>
          </>
        )}

        {isFailed && (
          <>
            <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => onResume(true)}>
              <RotateCcw className="h-3 w-3" /> Reset & retry
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1" onClick={onStop}>
              <Square className="h-3 w-3" /> End job
            </Button>
          </>
        )}

        {needsApproval && onScrollToApproval && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-amber-500/30 text-amber-400" onClick={onScrollToApproval}>
            <AlertTriangle className="h-3 w-3" /> Review & approve
          </Button>
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
