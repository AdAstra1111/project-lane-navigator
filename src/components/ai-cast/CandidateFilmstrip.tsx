/**
 * CandidateFilmstrip — Horizontally scrollable candidate strip for AI Actor review.
 * Shows one card per candidate/version asset with status, thumbnail, and score.
 */
import { useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Plus, Loader2, ImageIcon, XCircle, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export type CandidateStatus = 'queued' | 'rendering' | 'scoring' | 'ready' | 'failed' | 'empty';

export interface CandidateItem {
  id: string;
  label: string;
  thumbnailUrl: string | null;
  status: CandidateStatus;
  score: number | null;
  versionNumber?: number;
  assetType?: string;
  isExploratory?: boolean;
}

interface CandidateFilmstripProps {
  candidates: CandidateItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateAnother: () => void;
  onRetryLoad?: (id: string) => void;
  isGenerating?: boolean;
  generationBlocked?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<CandidateStatus, { label: string; color: string; icon?: 'loader' | 'error' }> = {
  queued: { label: 'Queued', color: 'bg-muted text-muted-foreground' },
  rendering: { label: 'Rendering', color: 'bg-primary/20 text-primary', icon: 'loader' },
  scoring: { label: 'Scoring', color: 'bg-amber-500/20 text-amber-400', icon: 'loader' },
  ready: { label: 'Ready', color: 'bg-emerald-500/20 text-emerald-400' },
  failed: { label: 'Failed', color: 'bg-destructive/20 text-destructive', icon: 'error' },
  empty: { label: 'No image yet', color: 'bg-muted text-muted-foreground' },
};

function CandidateThumbnail({ candidate, onRetry }: { candidate: CandidateItem; onRetry?: () => void }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (candidate.status === 'queued' || candidate.status === 'rendering') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted/10">
        <Loader2 className="h-5 w-5 animate-spin text-primary/40" />
      </div>
    );
  }

  if (candidate.status === 'failed' || (!candidate.thumbnailUrl && candidate.status === 'ready')) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-destructive/5 gap-1">
        <XCircle className="h-4 w-4 text-destructive/40" />
        <span className="text-[8px] text-destructive/60">Failed</span>
        {onRetry && (
          <button onClick={(e) => { e.stopPropagation(); onRetry(); }} className="text-[8px] text-primary hover:underline flex items-center gap-0.5">
            <RotateCcw className="h-2 w-2" /> Retry
          </button>
        )}
      </div>
    );
  }

  if (candidate.status === 'empty' || !candidate.thumbnailUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-muted/5 gap-1">
        <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
        <span className="text-[8px] text-muted-foreground/70">No image yet</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {!imgLoaded && <Skeleton className="absolute inset-0 rounded-none" />}
      <img
        src={candidate.thumbnailUrl}
        alt={candidate.label}
        className={cn('w-full h-full object-cover transition-opacity', imgLoaded ? 'opacity-100' : 'opacity-0')}
        onLoad={() => setImgLoaded(true)}
        onError={() => { setImgError(true); setImgLoaded(true); }}
      />
      {imgError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80 gap-1">
          <XCircle className="h-4 w-4 text-destructive/50" />
          <span className="text-[8px] text-muted-foreground">Load failed</span>
          {onRetry && (
            <button onClick={(e) => { e.stopPropagation(); onRetry(); }} className="text-[8px] text-primary hover:underline">Retry</button>
          )}
        </div>
      )}
    </div>
  );
}

export function CandidateFilmstrip({
  candidates, selectedId, onSelect, onCreateAnother, onRetryLoad, isGenerating, generationBlocked, className,
}: CandidateFilmstripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback((dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = 160;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }, []);

  return (
    <div className={cn('relative group', className)}>
      {/* Scroll arrows — desktop only */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 hidden md:flex items-center justify-center w-7 h-7 rounded-full bg-background/90 border border-border/50 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 hidden md:flex items-center justify-center w-7 h-7 rounded-full bg-background/90 border border-border/50 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Scrollable strip */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {candidates.map((c) => {
          const config = STATUS_CONFIG[c.status];
          const isSelected = c.id === selectedId;

          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cn(
                'shrink-0 snap-start w-[120px] rounded-lg border overflow-hidden transition-all',
                'hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected
                  ? 'border-primary ring-1 ring-primary/30 shadow-md'
                  : 'border-border/40',
              )}
            >
              {/* Thumbnail */}
              <div className="aspect-[3/4] overflow-hidden bg-muted/5 relative">
                <CandidateThumbnail candidate={c} onRetry={onRetryLoad ? () => onRetryLoad(c.id) : undefined} />
                {/* Score badge */}
                {c.score != null && c.status === 'ready' && (
                  <div className={cn(
                    'absolute top-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                    c.score >= 70 ? 'bg-emerald-500/90 text-white' :
                    c.score >= 40 ? 'bg-amber-500/90 text-white' :
                    'bg-destructive/90 text-white'
                  )}>
                    {c.score}
                  </div>
                )}
              </div>
              {/* Info strip */}
              <div className="px-2 py-1.5 space-y-0.5">
                <p className="text-[10px] font-medium text-foreground truncate">{c.label}</p>
                <Badge variant="outline" className={cn('text-[8px] h-4 px-1.5 py-0', config.color)}>
                  {config.icon === 'loader' && <Loader2 className="h-2 w-2 animate-spin mr-0.5" />}
                  {config.icon === 'error' && <XCircle className="h-2 w-2 mr-0.5" />}
                  {config.label}
                </Badge>
              </div>
            </button>
          );
        })}

        {/* Create Another card */}
        <button
          onClick={onCreateAnother}
          disabled={isGenerating || generationBlocked}
          className={cn(
            'shrink-0 snap-start w-[120px] rounded-lg border border-dashed border-border/40',
            'flex flex-col items-center justify-center gap-2 transition-all',
            'hover:border-primary/50 hover:bg-primary/5',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'min-h-[160px]',
          )}
        >
          {isGenerating ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary/50" />
          ) : generationBlocked ? (
            <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
          ) : (
            <Plus className="h-5 w-5 text-muted-foreground/50" />
          )}
          <span className="text-[10px] text-muted-foreground text-center px-1">
            {isGenerating ? 'Generating…' : generationBlocked ? 'Needs references' : 'Create another'}
          </span>
        </button>
      </div>
    </div>
  );
}
