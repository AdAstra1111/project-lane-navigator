/**
 * ActionToolbar — Primary action buttons for the Dev Engine workspace.
 */
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Sparkles, ArrowRight, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { DELIVERABLE_LABELS, type DeliverableType } from '@/lib/dev-os-config';

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
}

export function ActionToolbar({
  hasAnalysis, isConverged, isLoading,
  onRunReview, onApplyRewrite, onPromote, onSkipStage, onConvert,
  selectedNoteCount, totalNoteCount,
  nextBestDocument, selectedDeliverableType,
  hasUnresolvedDrift,
  analyzePending, rewritePending, convertPending, generateNotesPending,
}: ActionToolbarProps) {
  const anyPending = analyzePending || rewritePending || convertPending || generateNotesPending;

  return (
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

      {/* Convert — secondary */}
      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 ml-auto"
        onClick={onConvert} disabled={anyPending}>
        {convertPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
        Convert → {DELIVERABLE_LABELS[selectedDeliverableType]}
      </Button>
    </div>
  );
}
