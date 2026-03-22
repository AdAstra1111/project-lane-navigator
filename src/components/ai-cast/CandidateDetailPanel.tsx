/**
 * CandidateDetailPanel — Detailed view for a selected candidate with
 * comparison mode, version carousel, staged progress, and iteration actions.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, Check, X, Sparkles, RefreshCw,
  Shuffle, Loader2, ImageIcon, XCircle, RotateCcw, ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';
import type { CandidateItem, CandidateStatus } from './CandidateFilmstrip';

// ── Per-candidate staged progress ──────────────────────────────────────────

const GENERATION_STAGES = [
  'Queueing',
  'Generating images',
  'Identity consistency check',
  'Scoring',
  'Finalizing',
];

function statusToStageIndex(status: CandidateStatus): number {
  switch (status) {
    case 'queued': return 0;
    case 'rendering': return 1;
    case 'scoring': return 3;
    case 'ready': return 4;
    case 'failed':
    case 'empty':
      return -1;
    default: return 0;
  }
}

function statusToPercent(status: CandidateStatus): number {
  switch (status) {
    case 'queued': return 5;
    case 'rendering': return 40;
    case 'scoring': return 75;
    case 'ready': return 100;
    case 'failed':
    case 'empty':
      return 0;
    default: return 0;
  }
}

// ── Version item for carousel ──────────────────────────────────────────────

export interface VersionItem {
  id: string;
  versionNumber: number;
  thumbnailUrl: string | null;
  isApproved: boolean;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface CandidateDetailPanelProps {
  candidate: CandidateItem;
  allCandidates: CandidateItem[];
  versions?: VersionItem[];
  currentVersionIndex?: number;
  onVersionChange?: (index: number) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCreateAnother: () => void;
  onMoreLikeThis?: (id: string) => void;
  onDifferentDirection?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  isActioning?: boolean;
  comparisonMode?: boolean;
  onToggleComparison?: () => void;
  etaSeconds?: number;
  className?: string;
}

// ── Image with reliable loading ────────────────────────────────────────────

function ReliableImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  if (!src || error) {
    return (
      <div className={cn('flex flex-col items-center justify-center bg-muted/10 gap-2', className)}>
        <XCircle className="h-6 w-6 text-muted-foreground/30" />
        <span className="text-[10px] text-muted-foreground">Image unavailable</span>
        {error && (
          <button
            onClick={() => { setError(false); setRetryCount(r => r + 1); }}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {!loaded && <Skeleton className="absolute inset-0 rounded-lg" />}
      <img
        key={retryCount}
        src={src}
        alt={alt}
        className={cn('w-full h-full object-cover rounded-lg transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
        onLoad={() => setLoaded(true)}
        onError={() => { setError(true); setLoaded(true); }}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function CandidateDetailPanel({
  candidate, allCandidates, versions, currentVersionIndex = 0, onVersionChange,
  onApprove, onReject, onCreateAnother, onMoreLikeThis, onDifferentDirection,
  onRegenerate, isActioning, comparisonMode, onToggleComparison, etaSeconds, className,
}: CandidateDetailPanelProps) {
  const isProcessing = candidate.status === 'queued' || candidate.status === 'rendering' || candidate.status === 'scoring';
  const isReady = candidate.status === 'ready';
  const isFailed = candidate.status === 'failed';
  const isEmpty = candidate.status === 'empty';

  return (
    <div className={cn('space-y-4', className)}>
      {/* Per-candidate progress (only when processing) */}
      {isProcessing && (
        <StagedProgressBar
          title={`Generating ${candidate.label}`}
          stages={GENERATION_STAGES}
          currentStageIndex={statusToStageIndex(candidate.status)}
          progressPercent={statusToPercent(candidate.status)}
          etaSeconds={etaSeconds}
          detailMessage={
            candidate.status === 'queued' ? 'Waiting for slot…' :
            candidate.status === 'rendering' ? 'Creating identity images…' :
            candidate.status === 'scoring' ? 'Evaluating consistency…' :
            undefined
          }
        />
      )}

      {/* Main image area */}
      {comparisonMode ? (
        <ComparisonGrid candidates={allCandidates.filter(c => c.status === 'ready')} />
      ) : (
        <div className="flex gap-4">
          {/* Primary large view */}
          <div className="flex-1">
            <ReliableImage
              src={candidate.thumbnailUrl}
              alt={candidate.label}
              className="aspect-[3/4] rounded-lg overflow-hidden"
            />
          </div>

          {/* Version carousel (if multiple versions) */}
          {versions && versions.length > 1 && (
            <div className="w-16 space-y-1.5 shrink-0">
              <p className="text-[9px] text-muted-foreground text-center">Versions</p>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {versions.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => onVersionChange?.(i)}
                    className={cn(
                      'w-full aspect-square rounded-md overflow-hidden border transition-all',
                      i === currentVersionIndex
                        ? 'border-primary ring-1 ring-primary/30'
                        : 'border-border/30 hover:border-border/60',
                    )}
                  >
                    {v.thumbnailUrl ? (
                      <img src={v.thumbnailUrl} alt={`v${v.versionNumber}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full bg-muted/10">
                        <ImageIcon className="h-3 w-3 text-muted-foreground/30" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Candidate info */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">{candidate.label}</h4>
          {candidate.score != null && isReady && (
            <Badge variant="outline" className={cn(
              'text-[10px] h-5 shrink-0',
              candidate.score >= 70 ? 'text-emerald-400 border-emerald-400/30' :
              candidate.score >= 40 ? 'text-amber-400 border-amber-400/30' :
              'text-destructive border-destructive/30'
            )}>
              Score: {candidate.score}
            </Badge>
          )}
        </div>
        {onToggleComparison && allCandidates.filter(c => c.status === 'ready').length >= 2 && (
          <Button
            size="sm" variant="ghost" className="h-7 text-xs gap-1 shrink-0"
            onClick={onToggleComparison}
          >
            <ZoomIn className="h-3 w-3" />
            {comparisonMode ? 'Single view' : 'Compare'}
          </Button>
        )}
      </div>

      {/* Failed state */}
      {isFailed && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 flex items-center gap-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
          <div className="flex-1">
            <p className="text-xs text-destructive font-medium">Generation failed</p>
            <p className="text-[10px] text-muted-foreground">This candidate could not be completed.</p>
          </div>
          {onRegenerate && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onRegenerate(candidate.id)}>
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          )}
        </div>
      )}

      {/* Iteration actions — only when ready */}
      {isReady && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => onApprove(candidate.id)}
            disabled={isActioning}
          >
            {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Approve
          </Button>
          <Button
            size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onReject(candidate.id)}
            disabled={isActioning}
          >
            <X className="h-3 w-3" /> Reject
          </Button>
          <div className="h-8 w-px bg-border/30 mx-1" />
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={onCreateAnother}>
            <Sparkles className="h-3 w-3" /> Create another
          </Button>
          {onMoreLikeThis && (
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5" onClick={() => onMoreLikeThis(candidate.id)}>
              <RefreshCw className="h-3 w-3" /> More like this
            </Button>
          )}
          {onDifferentDirection && (
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5" onClick={() => onDifferentDirection(candidate.id)}>
              <Shuffle className="h-3 w-3" /> Different direction
            </Button>
          )}
          {onRegenerate && (
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5" onClick={() => onRegenerate(candidate.id)}>
              <RotateCcw className="h-3 w-3" /> Regenerate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Comparison Grid ────────────────────────────────────────────────────────

function ComparisonGrid({ candidates }: { candidates: CandidateItem[] }) {
  if (candidates.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-muted-foreground">
        No ready candidates to compare.
      </div>
    );
  }

  return (
    <div className={cn(
      'grid gap-2',
      candidates.length <= 2 ? 'grid-cols-2' :
      candidates.length <= 4 ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' :
      'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    )}>
      {candidates.map(c => (
        <div key={c.id} className="space-y-1">
          <div className="aspect-[3/4] rounded-lg overflow-hidden border border-border/30 bg-muted/5">
            {c.thumbnailUrl ? (
              <img src={c.thumbnailUrl} alt={c.label} className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full">
                <ImageIcon className="h-5 w-5 text-muted-foreground/20" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[9px] text-muted-foreground truncate">{c.label}</span>
            {c.score != null && (
              <Badge variant="outline" className={cn(
                'text-[8px] h-4 px-1',
                c.score >= 70 ? 'text-emerald-400 border-emerald-400/30' :
                c.score >= 40 ? 'text-amber-400 border-amber-400/30' :
                'text-destructive border-destructive/30'
              )}>
                {c.score}
              </Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
