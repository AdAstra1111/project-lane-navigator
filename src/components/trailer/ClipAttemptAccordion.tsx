/**
 * ClipAttemptAccordion — expandable attempt history for a clip candidate.
 * Shows per-attempt metadata + promote/retry actions.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Star, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useClipAttempts, usePromoteAttempt, useRetryClipAttempt, type ClipAttempt } from '@/hooks/useTrailerClipAttempts';
import { MAX_ATTEMPTS, PASS_THRESHOLD } from '@/config/trailerQuality';

interface ClipAttemptAccordionProps {
  clipId: string;
  projectId: string;
  bestAttemptId?: string | null;
  bestScore?: number | null;
  attemptsCount: number;
}

export function ClipAttemptAccordion({ clipId, projectId, bestAttemptId, bestScore, attemptsCount }: ClipAttemptAccordionProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: attempts, isLoading } = useClipAttempts(expanded ? clipId : undefined);
  const promote = usePromoteAttempt(projectId);
  const retry = useRetryClipAttempt(projectId);

  if (attemptsCount === 0) return null;

  return (
    <div className="mt-1.5">
      {/* Summary row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {bestScore != null && (
          <Badge
            variant="outline"
            className={`text-[8px] px-1 py-0 ${
              bestScore >= PASS_THRESHOLD
                ? 'border-green-500/50 text-green-400'
                : bestScore >= 0.5
                ? 'border-amber-500/50 text-amber-400'
                : 'border-destructive/50 text-destructive'
            }`}
          >
            {bestScore >= PASS_THRESHOLD ? 'PASS' : 'FAIL'} {(bestScore * 10).toFixed(1)}
          </Badge>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
          {attemptsCount} attempt{attemptsCount !== 1 ? 's' : ''}
        </button>

        {attemptsCount < MAX_ATTEMPTS && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-4 w-4 p-0"
                  disabled={retry.isPending}
                  onClick={(e) => { e.stopPropagation(); retry.mutate(clipId); }}
                >
                  {retry.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">Retry (escalated model)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Expanded attempt list */}
      {expanded && (
        <div className="mt-1.5 space-y-1 border-l-2 border-border pl-2 ml-1">
          {isLoading && <p className="text-[9px] text-muted-foreground">Loading…</p>}
          {(attempts || []).map((a: ClipAttempt) => (
            <div key={a.id} className="text-[9px] flex items-start gap-1.5 group">
              <span className="font-mono text-muted-foreground shrink-0">#{a.attempt_index}</span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
                    a.status === 'complete' ? 'border-green-500/40 text-green-400' :
                    a.status === 'queued' ? 'border-muted-foreground/40' :
                    a.status === 'running' ? 'border-primary/40 text-primary' :
                    'border-destructive/40 text-destructive'
                  }`}>
                    {a.status}
                  </Badge>
                  {a.provider && <span className="text-muted-foreground">{a.provider}</span>}
                  {a.model && <span className="text-muted-foreground/60">{a.model}</span>}
                  {a.eval_score != null && (
                    <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
                      a.eval_score >= PASS_THRESHOLD ? 'border-green-500/50 text-green-400' : 'border-amber-500/50 text-amber-400'
                    }`}>
                      {(a.eval_score * 10).toFixed(1)}
                    </Badge>
                  )}
                  {bestAttemptId === a.id && (
                    <Star className="h-2.5 w-2.5 text-amber-400 fill-amber-400" />
                  )}
                </div>
                {a.eval_failures && (a.eval_failures as string[]).length > 0 && (
                  <p className="text-destructive/80 truncate">{(a.eval_failures as string[]).join(', ')}</p>
                )}
                {a.error && <p className="text-destructive/80 truncate">{a.error}</p>}
              </div>
              {a.status === 'complete' && bestAttemptId !== a.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-4 px-1 text-[8px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  disabled={promote.isPending}
                  onClick={(e) => { e.stopPropagation(); promote.mutate({ clipId, attemptId: a.id }); }}
                >
                  <Star className="h-2 w-2 mr-0.5" /> Best
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
