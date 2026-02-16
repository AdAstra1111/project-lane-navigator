/**
 * ActionToolbar — Primary action buttons for the Dev Engine workspace.
 * Includes "Why this step?" display for vertical drama gating.
 */
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, ArrowRight, RefreshCw, Loader2, AlertTriangle, Info } from 'lucide-react';
import { DELIVERABLE_LABELS, type DeliverableType } from '@/lib/dev-os-config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface VerticalDramaGating {
  missing_prerequisites: string[];
  reason: string;
  canonical_episode_count: number | null;
  production_type: string;
}

interface ActionToolbarProps {
  hasAnalysis: boolean;
  isConverged: boolean;
  isLoading: boolean;
  onRunReview: () => void;
  onApplyRewrite: () => void;
  onPromote: () => void;
  onSkipStage: () => void;
  onConvert: () => void;
  selectedNoteCount: number;
  totalNoteCount: number;
  nextBestDocument: string | null;
  selectedDeliverableType: DeliverableType;
  hasUnresolvedDrift: boolean;
  analyzePending: boolean;
  rewritePending: boolean;
  convertPending: boolean;
  generateNotesPending: boolean;
  verticalDramaGating?: VerticalDramaGating | null;
}

export function ActionToolbar({
  hasAnalysis, isConverged, isLoading,
  onRunReview, onApplyRewrite, onPromote, onSkipStage, onConvert,
  selectedNoteCount, totalNoteCount,
  nextBestDocument, selectedDeliverableType,
  hasUnresolvedDrift,
  analyzePending, rewritePending, convertPending, generateNotesPending,
  verticalDramaGating,
}: ActionToolbarProps) {
  const anyPending = analyzePending || rewritePending || convertPending || generateNotesPending;
  const hasMissingPrereqs = verticalDramaGating && verticalDramaGating.missing_prerequisites.length > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border/50">
        {/* Run Review */}
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onRunReview} disabled={anyPending}>
          {analyzePending ? <Loader2 className="h-3 w-3 animate-spin" /> : hasAnalysis ? <RefreshCw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {hasAnalysis ? 'Re-review' : 'Run Review'}
        </Button>

        {/* Converged — promote */}
        {isConverged && (
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={onPromote} disabled={anyPending || !nextBestDocument}>
            {convertPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            Promote{nextBestDocument ? `: ${DELIVERABLE_LABELS[nextBestDocument as DeliverableType] || nextBestDocument}` : ''}
            {hasUnresolvedDrift && <AlertTriangle className="h-3 w-3 text-amber-400" />}
          </Button>
        )}

        {/* Skip stage */}
        {hasAnalysis && !isConverged && nextBestDocument && (
          <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-amber-500"
            onClick={onSkipStage} disabled={anyPending}>
            <AlertTriangle className="h-3 w-3" /> Skip
          </Button>
        )}

        {/* Why this step? */}
        {verticalDramaGating && nextBestDocument && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                <Info className="h-3 w-3" />
                Why this step?
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[280px] text-xs space-y-1">
              <p className="font-medium">Production: {verticalDramaGating.production_type}</p>
              <p>{verticalDramaGating.reason}</p>
              {hasMissingPrereqs && (
                <p className="text-amber-400">
                  Missing: {verticalDramaGating.missing_prerequisites.map(p => DELIVERABLE_LABELS[p as DeliverableType] || p).join(', ')}
                </p>
              )}
              {verticalDramaGating.canonical_episode_count && (
                <p>Canonical episodes: {verticalDramaGating.canonical_episode_count}</p>
              )}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Convert — secondary */}
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 ml-auto"
          onClick={onConvert} disabled={anyPending}>
          {convertPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
          Convert → {DELIVERABLE_LABELS[selectedDeliverableType]}
        </Button>
      </div>

      {/* Missing prerequisites warning */}
      {hasMissingPrereqs && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-500 px-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {verticalDramaGating!.reason}
        </div>
      )}
    </div>
  );
}
