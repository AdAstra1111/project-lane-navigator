/**
 * StagePlanPanel — Debug/verification panel showing the canonical stage ladder
 * for the current project format. Proves that Dev Engine UI and AutoRun use
 * the same ordering from the shared source (stage-ladders.json via registry.ts).
 *
 * Show by passing showDebug={true} or toggling the debug button.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Layers, ChevronRight, CheckCircle2, Circle, ArrowRight, FlaskConical,
} from 'lucide-react';
import {
  getLadderForFormat, getNextStage, normalizeFormatKey,
  runStageRegistrySelfTest,
} from '@/lib/stages/registry';
import { DELIVERABLE_LABELS, getDeliverableLabel } from '@/lib/dev-os-config';

interface Props {
  projectFormat: string;
  currentDocType?: string | null;
  existingDocTypes?: string[];
  className?: string;
}

function labelFor(stage: string, format: string): string {
  return getDeliverableLabel(stage, format);
}

export function StagePlanPanel({ projectFormat, currentDocType, existingDocTypes = [], className }: Props) {
  const [selfTestResult, setSelfTestResult] = useState<{ passed: boolean; failures: string[] } | null>(null);

  const formatKey = normalizeFormatKey(projectFormat);
  const ladder = getLadderForFormat(projectFormat);
  const currentIdx = currentDocType ? ladder.indexOf(currentDocType as any) : -1;
  const nextStage = currentDocType ? getNextStage(currentDocType, projectFormat) : ladder[0];
  const totalStages = ladder.length;

  const runTest = () => {
    const result = runStageRegistrySelfTest(true);
    setSelfTestResult(result);
  };

  return (
    <div className={`border border-border/50 rounded-lg bg-card/50 overflow-hidden ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">Stage Plan</span>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/30 text-primary/80">
            {formatKey}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {currentIdx >= 0 && (
            <span className="text-[10px] text-muted-foreground">
              {currentIdx + 1} / {totalStages}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[9px] gap-1 text-muted-foreground hover:text-foreground"
            onClick={runTest}
          >
            <FlaskConical className="h-3 w-3" />
            Self-test
          </Button>
        </div>
      </div>

      {/* Self-test result */}
      {selfTestResult && (
        <div className={`px-3 py-1.5 text-[10px] border-b border-border/30 ${
          selfTestResult.passed
            ? 'bg-emerald-500/5 text-emerald-400'
            : 'bg-destructive/5 text-destructive'
        }`}>
          {selfTestResult.passed
            ? '✅ Self-test passed — registry is consistent'
            : `❌ ${selfTestResult.failures.length} failure(s): ${selfTestResult.failures[0]}`
          }
        </div>
      )}

      {/* Next stage callout */}
      {nextStage && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-border/30">
          <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
          <div>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide mr-1.5">Next:</span>
            <span className="text-[10px] font-medium text-primary">
              {labelFor(nextStage, projectFormat)}
            </span>
          </div>
        </div>
      )}

      {/* Ladder stages */}
      <ScrollArea className="max-h-64">
        <div className="py-1.5 px-2 space-y-0.5">
          {ladder.map((stage, i) => {
            const isCurrent = stage === currentDocType;
            const isCompleted = existingDocTypes.includes(stage) && !isCurrent;
            const isFuture = !existingDocTypes.includes(stage) && !isCurrent;
            const label = labelFor(stage, projectFormat);

            return (
              <div
                key={stage}
                className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-colors ${
                  isCurrent
                    ? 'bg-primary/10 border border-primary/20'
                    : isCompleted
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/50'
                }`}
              >
                {/* Index */}
                <span className="text-[9px] text-muted-foreground/50 w-4 shrink-0 text-right">{i + 1}</span>

                {/* Icon */}
                {isCurrent ? (
                  <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                ) : isCompleted ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500/60 shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 shrink-0" />
                )}

                {/* Label */}
                <span className={isCurrent ? 'font-semibold text-foreground' : ''}>
                  {label}
                </span>

                {/* Stage key */}
                <span className="ml-auto text-[8px] text-muted-foreground/40 font-mono">
                  {stage}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer: source info */}
      <div className="px-3 py-1.5 border-t border-border/30 text-[9px] text-muted-foreground/50">
        Source: supabase/_shared/stage-ladders.json → registry.ts → auto-run edge fn
      </div>
    </div>
  );
}
