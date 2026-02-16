/**
 * ActionToolbar — Primary action buttons for the Dev Engine workspace.
 * Includes "Why this step?" display for vertical drama gating.
 * Includes Beat Sheet → Episode Script for vertical_drama.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, ArrowRight, RefreshCw, Loader2, AlertTriangle, Info, Film } from 'lucide-react';
import { DELIVERABLE_LABELS, type DeliverableType } from '@/lib/dev-os-config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NextAction } from '@/lib/next-action';
import { renderActionPillText } from '@/lib/next-action';

interface VerticalDramaGating {
  missing_prerequisites: string[];
  reason: string;
  canonical_episode_count: number | null;
  production_type: string;
}

interface BeatSheetScopeInfo {
  scope: 'season' | 'episode' | 'unknown';
  confidence: number;
}

interface ActionToolbarProps {
  projectId?: string;
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
  /** Vertical drama beat sheet → script */
  isVerticalDrama?: boolean;
  currentDocType?: string;
  seasonEpisodeCount?: number | null;
  onBeatSheetToScript?: (episodeNumber: number) => void;
  beatSheetToScriptPending?: boolean;
  beatSheetScope?: BeatSheetScopeInfo | null;
  /** Structured next action from promotion intelligence */
  nextAction?: NextAction | null;
}

export function ActionToolbar({
  projectId,
  hasAnalysis, isConverged, isLoading,
  onRunReview, onApplyRewrite, onPromote, onSkipStage, onConvert,
  selectedNoteCount, totalNoteCount,
  nextBestDocument, selectedDeliverableType,
  hasUnresolvedDrift,
  analyzePending, rewritePending, convertPending, generateNotesPending,
  verticalDramaGating,
  isVerticalDrama, currentDocType, seasonEpisodeCount,
  onBeatSheetToScript, beatSheetToScriptPending,
  beatSheetScope,
  nextAction,
}: ActionToolbarProps) {
  const navigate = useNavigate();
  const anyPending = analyzePending || rewritePending || convertPending || generateNotesPending || beatSheetToScriptPending;
  const hasMissingPrereqs = verticalDramaGating && verticalDramaGating.missing_prerequisites.length > 0;

  const [episodeNum, setEpisodeNum] = useState('1');

  // Show beat sheet → script button for vertical_drama when on a beat_sheet doc
  const isBeatSheet = currentDocType?.toLowerCase().replace(/[\s\-]+/g, '_') === 'beat_sheet'
    || currentDocType?.toLowerCase().replace(/[\s\-]+/g, '_') === 'vertical_episode_beats';
  const showBeatSheetToScript = isVerticalDrama && isBeatSheet && onBeatSheetToScript;

  const epCount = seasonEpisodeCount || 10;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border/50">
        {/* Run Review */}
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onRunReview} disabled={anyPending}>
          {analyzePending ? <Loader2 className="h-3 w-3 animate-spin" /> : hasAnalysis ? <RefreshCw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {hasAnalysis ? 'Re-review' : 'Run Review'}
        </Button>

        {/* Converged — promote or enter mode */}
        {isConverged && (
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              // Series Writer entry: always navigate, never promote/convert
              if (nextAction?.kind === 'enter_mode' && nextAction.route) {
                navigate(nextAction.route);
              } else if (isVerticalDrama && nextBestDocument === 'script' && projectId) {
                navigate(`/projects/${projectId}/series-writer`);
              } else {
                onPromote?.();
              }
            }}
            disabled={anyPending || (!nextBestDocument && nextAction?.kind !== 'enter_mode')}>
            {convertPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {nextAction && nextAction.kind !== 'none'
              ? renderActionPillText(nextAction)
              : isVerticalDrama && nextBestDocument === 'script'
                ? 'Enter Series Writer'
                : nextBestDocument ? `Promote: ${DELIVERABLE_LABELS[nextBestDocument as DeliverableType] || nextBestDocument}` : 'Promote'}
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

      {/* Beat Sheet → Episode Script for vertical_drama */}
      {showBeatSheetToScript && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
          {/* Scope indicator */}
          {beatSheetScope && (
            <Badge variant="outline" className={`text-[9px] ${
              beatSheetScope.scope === 'season' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
              beatSheetScope.scope === 'episode' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
              'border-muted-foreground/30 text-muted-foreground'
            }`}>
              Scope: {beatSheetScope.scope === 'season' ? 'Season' : beatSheetScope.scope === 'episode' ? 'Episode' : 'Unknown'}
              {beatSheetScope.confidence > 0 && ` (${beatSheetScope.confidence}%)`}
            </Badge>
          )}

          {/* Episode number selector */}
          <Select value={episodeNum} onValueChange={setEpisodeNum}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue placeholder="EP #" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: epCount }, (_, i) => i + 1).map(n => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  EP {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Generate button */}
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => onBeatSheetToScript(Number(episodeNum))}
            disabled={anyPending}
          >
            {beatSheetToScriptPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Film className="h-3 w-3" />
            )}
            Write Episode Script (Screenplay)
          </Button>

          {beatSheetScope?.scope === 'season' && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Auto-slice: will extract EP {episodeNum} beats
            </span>
          )}
        </div>
      )}

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
