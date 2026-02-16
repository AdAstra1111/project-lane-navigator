import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Pause, Square, RotateCcw, Zap, AlertTriangle, CheckCircle2, Loader2, ChevronDown, HelpCircle, FileText, Eye } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { AutoRunJob, AutoRunStep, PendingDecision } from '@/hooks/useAutoRun';
import type { DeliverableType } from '@/lib/dev-os-config';
import { DELIVERABLE_LABELS } from '@/lib/dev-os-config';

const LADDER_LABELS: Record<string, string> = {
  idea: 'Idea',
  concept_brief: 'Concept Brief',
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  draft: 'Draft',
  coverage: 'Coverage',
  series_writer: 'Series Writer',
  writers_room: "Writer's Room",
};

const STATUS_STYLES: Record<string, { color: string; icon: typeof Play }> = {
  running: { color: 'bg-primary/10 text-primary border-primary/30', icon: Loader2 },
  paused: { color: 'bg-amber-500/10 text-amber-500 border-amber-500/30', icon: Pause },
  stopped: { color: 'bg-destructive/10 text-destructive border-destructive/30', icon: Square },
  completed: { color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', icon: CheckCircle2 },
  failed: { color: 'bg-destructive/10 text-destructive border-destructive/30', icon: AlertTriangle },
  queued: { color: 'bg-muted text-muted-foreground', icon: Play },
};

interface AutoRunPanelProps {
  job: AutoRunJob | null;
  steps: AutoRunStep[];
  isRunning: boolean;
  error: string | null;
  currentDeliverable: DeliverableType;
  onStart: (mode: string, startDoc: string) => void;
  onRunNext: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  onClear: () => void;
  onApproveDecision?: (decisionId: string, selectedValue: string) => void;
  onGetPendingDoc?: () => Promise<any>;
  onApproveNext?: (decision: 'approve' | 'revise' | 'stop') => void;
}

interface PendingDocData {
  doc_id: string;
  version_id: string;
  doc_type: string;
  next_doc_type: string;
  approval_type: string;
  char_count: number;
  text: string;
  preview: string;
}

function DecisionApprovalCard({ decision, onApprove }: { decision: PendingDecision; onApprove: (decisionId: string, value: string) => void }) {
  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-2 space-y-1.5">
      <div className="flex items-start gap-1.5">
        <HelpCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[10px] font-medium text-foreground leading-snug">{decision.question}</p>
      </div>
      <div className="space-y-1">
        {decision.options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onApprove(decision.id, opt.value)}
            className={`w-full text-left text-[9px] p-1.5 rounded border transition-colors hover:bg-primary/10 hover:border-primary/40 ${
              decision.recommended === opt.value
                ? 'border-primary/40 bg-primary/5'
                : 'border-border/50 bg-background'
            }`}
          >
            <span className="font-medium">{opt.value}</span>
            {decision.recommended === opt.value && (
              <Badge variant="outline" className="text-[7px] px-1 py-0 ml-1 bg-primary/10 text-primary border-primary/30">
                recommended
              </Badge>
            )}
            <p className="text-muted-foreground mt-0.5">{opt.why}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AutoRunPanel({
  job, steps, isRunning, error, currentDeliverable,
  onStart, onRunNext, onResume, onPause, onStop, onClear, onApproveDecision,
  onGetPendingDoc, onApproveNext,
}: AutoRunPanelProps) {
  const [mode, setMode] = useState<string>('balanced');
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [pendingDoc, setPendingDoc] = useState<PendingDocData | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [docExpanded, setDocExpanded] = useState(false);

  // Load pending doc when job enters approval state
  useEffect(() => {
    if (job?.awaiting_approval && onGetPendingDoc && !pendingDoc && !loadingDoc) {
      setLoadingDoc(true);
      onGetPendingDoc().then((doc) => {
        setPendingDoc(doc);
        setLoadingDoc(false);
      }).catch(() => setLoadingDoc(false));
    }
    if (!job?.awaiting_approval) {
      setPendingDoc(null);
      setDocExpanded(false);
    }
  }, [job?.awaiting_approval, job?.id]);

  const hasPendingDecisions = job?.pending_decisions && job.pending_decisions.length > 0;
  const blockingDecision = hasPendingDecisions
    ? job!.pending_decisions!.find(d => d.impact === 'blocking') || job!.pending_decisions![0]
    : null;

  // No active job — show start form
  if (!job || ['completed', 'stopped', 'failed'].includes(job.status)) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Zap className="h-3 w-3" /> Auto-Run to Production Draft
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {job?.status === 'completed' && (
            <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              ✓ Completed — {job.stop_reason || 'Target reached'}
            </Badge>
          )}
          {job?.status === 'stopped' && (
            <Badge variant="outline" className="text-[9px] bg-destructive/10 text-destructive border-destructive/30">
              Stopped — {job.stop_reason}
            </Badge>
          )}
          {job?.status === 'failed' && (
            <Badge variant="outline" className="text-[9px] bg-destructive/10 text-destructive border-destructive/30">
              Failed — {job.error}
            </Badge>
          )}

          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-[10px] gap-1 flex-1"
              onClick={() => onStart(mode, currentDeliverable)}>
              <Play className="h-3 w-3" /> Start Auto-Run
            </Button>
          </div>

          <p className="text-[8px] text-muted-foreground leading-relaxed">
            ⚡ Consumes credits. {mode === 'fast' ? '1 loop/stage' : mode === 'balanced' ? '2 loops/stage' : '3 loops/stage, readiness ≥ 82'}.
          </p>

          {job && (
            <Button variant="ghost" size="sm" className="h-6 text-[9px] w-full" onClick={onClear}>
              <RotateCcw className="h-3 w-3" /> Clear
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Active job
  const statusStyle = STATUS_STYLES[job.status] || STATUS_STYLES.queued;
  const StatusIcon = statusStyle.icon;
  const progressPct = job.max_total_steps > 0 ? Math.round((job.step_count / job.max_total_steps) * 100) : 0;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Zap className="h-3 w-3" /> Auto-Run
          <Badge variant="outline" className={`text-[8px] px-1 py-0 ml-auto ${statusStyle.color}`}>
            {job.status === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />}
            {job.status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Step {job.step_count}/{job.max_total_steps}</span>
            <span>Loop {job.stage_loop_count}/{job.max_stage_loops}</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {/* Current stage */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground">Stage:</span>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
            {LADDER_LABELS[job.current_document] || job.current_document}
          </Badge>
          <span className="text-[8px] text-muted-foreground">→ {LADDER_LABELS[job.target_document] || job.target_document}</span>
        </div>

        {/* Scores */}
        {job.last_readiness != null && (
          <div className="grid grid-cols-3 gap-1 text-[9px]">
            <div className="text-center p-1 rounded bg-muted/30">
              <div className="text-muted-foreground">Readiness</div>
              <div className="font-semibold">{job.last_readiness}</div>
            </div>
            <div className="text-center p-1 rounded bg-muted/30">
              <div className="text-muted-foreground">CI/GP</div>
              <div className="font-semibold">{job.last_ci ?? '?'}/{job.last_gp ?? '?'}</div>
            </div>
            <div className="text-center p-1 rounded bg-muted/30">
              <div className="text-muted-foreground">Gap</div>
              <div className="font-semibold">{job.last_gap ?? '?'}</div>
            </div>
          </div>
        )}

        {/* Pending Decision Approval */}
        {hasPendingDecisions && blockingDecision && onApproveDecision && (
          <DecisionApprovalCard decision={blockingDecision} onApprove={onApproveDecision} />
        )}

        {/* Human Approval Gate */}
        {job.awaiting_approval && onApproveNext && (
          <div className="border border-primary/30 bg-primary/5 rounded-md p-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-foreground">Approval Required</p>
                <p className="text-[9px] text-muted-foreground">
                  {job.approval_type === 'convert'
                    ? `Review the newly generated ${LADDER_LABELS[job.pending_doc_type || ''] || job.pending_doc_type || 'Document'} before continuing.`
                    : job.pending_next_doc_type === 'series_writer'
                      ? `Review the current ${LADDER_LABELS[job.pending_doc_type || ''] || job.pending_doc_type || 'Document'} before entering Series Writer.`
                      : `Review the current ${LADDER_LABELS[job.pending_doc_type || ''] || job.pending_doc_type || 'Document'} before promoting to ${LADDER_LABELS[job.pending_next_doc_type || ''] || job.pending_next_doc_type || 'Next Step'}.`
                  }
                </p>
              </div>
            </div>

            {loadingDoc && (
              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading document…
              </div>
            )}

            {pendingDoc && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[8px] text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  <span>{pendingDoc.char_count.toLocaleString()} chars</span>
                  <Badge variant="outline" className="text-[7px] px-1 py-0">{pendingDoc.approval_type}</Badge>
                </div>

                <Collapsible open={docExpanded} onOpenChange={setDocExpanded}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-[9px] text-primary hover:underline">
                    <Eye className="h-3 w-3" /> {docExpanded ? 'Hide' : 'Show'} document text
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ScrollArea className="max-h-[200px] mt-1 border border-border/50 rounded p-1.5 bg-background">
                      <pre className="text-[8px] whitespace-pre-wrap text-foreground font-mono leading-relaxed">
                        {pendingDoc.text || pendingDoc.preview || '(empty)'}
                      </pre>
                    </ScrollArea>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            <div className="flex gap-1">
              <Button size="sm" className="h-6 text-[9px] flex-1 gap-1" onClick={() => onApproveNext('approve')}>
                <CheckCircle2 className="h-3 w-3" /> Approve & Continue
              </Button>
              <Button variant="destructive" size="sm" className="h-6 text-[9px] gap-1" onClick={() => onApproveNext('stop')}>
                <Square className="h-3 w-3" /> Stop
              </Button>
            </div>
          </div>
        )}

        {/* Stop reason (only show if no pending decisions and not awaiting approval) */}
        {job.stop_reason && !hasPendingDecisions && !job.awaiting_approval && (
          <div className="text-[9px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded p-1.5">
            {job.stop_reason}
          </div>
        )}

        {error && (
          <div className="text-[9px] text-destructive bg-destructive/5 border border-destructive/20 rounded p-1.5">
            {error}
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-1">
          {job.status === 'running' && (
            <Button variant="outline" size="sm" className="h-6 text-[9px] flex-1 gap-1" onClick={onPause}>
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {job.status === 'paused' && !hasPendingDecisions && !job.awaiting_approval && (
            <Button size="sm" className="h-6 text-[9px] flex-1 gap-1" onClick={onResume}>
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {['running', 'paused'].includes(job.status) && (
            <Button variant="destructive" size="sm" className="h-6 text-[9px] gap-1" onClick={onStop}>
              <Square className="h-3 w-3" /> Stop
            </Button>
          )}
        </div>

        {/* Step timeline */}
        {steps.length > 0 && (
          <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-[9px] text-muted-foreground hover:text-foreground">
              <span>Steps ({steps.length})</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${timelineOpen ? '' : '-rotate-90'}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="max-h-[150px] mt-1">
                <div className="space-y-0.5">
                  {steps.map((step) => (
                    <div key={step.id} className="text-[8px] p-1 rounded bg-muted/20 flex gap-1.5">
                      <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0">{step.action}</Badge>
                      <span className="text-muted-foreground truncate">{step.summary || step.document}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
