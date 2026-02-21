/**
 * PipelineNextStepPanel — Shows pipeline-aware next-step recommendations
 * with explanations, Series Writer CTA, and deferred note counts.
 *
 * Replaces ad-hoc "Next Step" logic with Pipeline Brain computations.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, CheckCircle2, AlertCircle, Layers, Shield,
  BookOpen, Loader2, Lock,
} from 'lucide-react';
import {
  computePipelineState,
  type ExistingDoc,
  type ProjectCriteria,
  type PipelineNextStep,
  getDurationRangeLabel,
} from '@/lib/pipeline-brain';
import { cn } from '@/lib/utils';

interface Props {
  format: string;
  existingDocs: ExistingDoc[];
  criteria?: ProjectCriteria;
  deferredNoteCount?: number;
  onNavigateToStage?: (docType: string) => void;
  onEnterSeriesWriter?: () => void;
  className?: string;
}

const ACTION_ICONS: Record<string, typeof ArrowRight> = {
  create: ArrowRight,
  approve: Lock,
  converge: CheckCircle2,
  enter_series_writer: BookOpen,
};

const ACTION_COLORS: Record<string, string> = {
  create: 'border-primary/30 text-primary',
  approve: 'border-amber-500/30 text-amber-400',
  converge: 'border-emerald-500/30 text-emerald-400',
  enter_series_writer: 'border-blue-500/30 text-blue-400',
};

export function PipelineNextStepPanel({
  format, existingDocs, criteria, deferredNoteCount,
  onNavigateToStage, onEnterSeriesWriter, className,
}: Props) {
  const state = useMemo(
    () => computePipelineState(format, existingDocs, criteria),
    [format, existingDocs, criteria],
  );

  const primary = state.nextSteps.find(s => s.priority === 'primary');
  const secondary = state.nextSteps.filter(s => s.priority === 'secondary').slice(0, 2);

  return (
    <Card className={cn('border-primary/20', className)}>
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <CardTitle className="text-xs">Pipeline Next Step</CardTitle>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-border/50 text-muted-foreground">
              {state.formatKey}
            </Badge>
            <div className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-primary" />
              <span className="font-semibold text-foreground">{state.completedCount}/{state.totalStages}</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-2.5">
        {/* Primary recommendation */}
        {primary && (
          <NextStepItem
            step={primary}
            format={format}
            criteria={criteria}
            onNavigate={primary.action === 'enter_series_writer' ? onEnterSeriesWriter : () => onNavigateToStage?.(primary.docType)}
          />
        )}

        {/* Secondary options */}
        {secondary.length > 0 && (
          <div className="space-y-1 pl-2 border-l-2 border-border/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Also available</p>
            {secondary.map(step => (
              <NextStepItem
                key={step.docType}
                step={step}
                format={format}
                criteria={criteria}
                compact
                onNavigate={() => onNavigateToStage?.(step.docType)}
              />
            ))}
          </div>
        )}

        {/* Deferred notes reminder */}
        {(deferredNoteCount ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-500/5 rounded px-2 py-1">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{deferredNoteCount} deferred note{deferredNoteCount! > 1 ? 's' : ''} will resurface at the next stage</span>
          </div>
        )}

        {/* Series Writer readiness checklist */}
        {state.seriesWriterReadiness && !state.seriesWriterReadiness.eligible && (
          <div className="space-y-1 pt-1.5 border-t border-border/30">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
              Series Writer Readiness
            </p>
            <div className="space-y-0.5">
              {state.seriesWriterReadiness.gates.map(gate => (
                <div key={gate.key} className="flex items-center gap-1.5 text-[10px]">
                  {gate.met ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-amber-400 shrink-0" />
                  )}
                  <span className={gate.met ? 'text-muted-foreground line-through' : 'text-foreground'}>
                    {gate.label}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1">{state.seriesWriterReadiness.message}</p>
          </div>
        )}

        {/* Duration range notice (for episodic formats) */}
        {criteria && (criteria.episodeLengthMin || criteria.episodeLengthMax) && (
          <p className="text-[9px] text-muted-foreground">
            Episode duration: {getDurationRangeLabel(criteria)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NextStepItem({
  step, format, criteria, compact, onNavigate,
}: {
  step: PipelineNextStep;
  format: string;
  criteria?: ProjectCriteria;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = ACTION_ICONS[step.action] || ArrowRight;
  const color = ACTION_COLORS[step.action] || 'border-border/50 text-foreground';

  if (compact) {
    return (
      <button
        onClick={onNavigate}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span>{step.label}</span>
        <span className="text-[8px] text-muted-foreground/60 ml-auto">{step.reason}</span>
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn('text-[10px] gap-1', color)}>
          <Icon className="h-3 w-3" />
          {step.action === 'enter_series_writer'
            ? 'Continue in Series Writer'
            : step.action === 'approve'
            ? `Approve ${step.label}`
            : step.action === 'converge'
            ? `Converge ${step.label}`
            : `Create ${step.label}`}
        </Badge>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Because: {step.reason}
      </p>
      {onNavigate && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[9px] gap-1 px-2"
          onClick={onNavigate}
        >
          <Icon className="h-3 w-3" />
          {step.action === 'enter_series_writer' ? 'Enter Series Writer' : 'Go to stage'}
        </Button>
      )}
    </div>
  );
}
