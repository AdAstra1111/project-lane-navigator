/**
 * SeriesRunControlBar — Always-visible mission control for episode generation.
 * Shows live phase, episode progress, pause/resume/stop controls, and last-saved doc link.
 */
import { Play, Pause, Square, BookOpen, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { SeriesProgress, RunControlState } from '@/hooks/useSeriesWriter';

const PHASE_LABELS: Record<string, string> = {
  // Vertical Drama phases
  load_pack:    'Loading Vertical Pack',
  beats:        'Episode Beats',
  draft:        'Drafting Episode Script',
  continuity:   'Tighten + Continuity',
  save:         'Saving',
  // Shared phases
  validate:     'Validating Canon',
  metrics:      'Beat Metrics',
  idle:         'Ready',
  complete:     'Complete',
  error:        'Error',
  paused:       'Paused',
  // Legacy labels (non-vertical paths — should not appear in VD)
  blueprint:    'Context Pack',
  architecture: 'Beat Spine',
  score:        'Scoring',
};

interface Props {
  progress: SeriesProgress;
  runControl: RunControlState;
  totalEpisodes: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenLastDoc: () => void;
}

export function SeriesRunControlBar({
  progress,
  runControl,
  totalEpisodes,
  onPause,
  onResume,
  onStop,
  onOpenLastDoc,
}: Props) {
  const { status, lastSavedScriptId, lastUpdatedAt, phaseLog } = runControl;
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';

  // Don't render if truly idle with no history
  if (isIdle && !lastSavedScriptId && phaseLog.length === 0) return null;

  const completedEps = progress.phase === 'complete'
    ? progress.totalEpisodes
    : Math.max(0, progress.currentEpisode - 1);
  const phaseIdx = ['blueprint', 'architecture', 'draft', 'score', 'validate', 'metrics'].indexOf(progress.phase as string);
  const phaseProgress = phaseIdx >= 0 ? ((phaseIdx + 1) / 6) : (progress.phase === 'complete' ? 1 : 0);
  const effectiveTotal = totalEpisodes > 0 ? totalEpisodes : (progress.totalEpisodes || 1);
  const totalPct = effectiveTotal > 0
    ? ((completedEps + phaseProgress) / effectiveTotal) * 100
    : phaseProgress * 100;

  const lastUpdatedDisplay = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const containerClass = isRunning
    ? 'border-primary/40 bg-primary/5'
    : isPaused
    ? 'border-amber-500/40 bg-amber-500/5'
    : status === 'error'
    ? 'border-destructive/40 bg-destructive/5'
    : 'border-border/50 bg-muted/20';

  return (
    <div className={`rounded-lg border p-3 space-y-2.5 transition-colors ${containerClass}`}>
      {/* Top row: status label + action buttons — wraps on narrow widths */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isRunning && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />}
          {isPaused && <Pause className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
          {status === 'error' && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
          {(status === 'idle' || status === 'stopped') && progress.phase === 'complete' && (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}

          <span className="text-xs font-semibold text-foreground break-words">
            {isPaused
              ? 'Generation Paused'
              : isRunning
              ? `EP ${progress.currentEpisode}${effectiveTotal > 1 ? `/${effectiveTotal}` : ''} — ${PHASE_LABELS[progress.phase] || progress.phase}`
              : status === 'error'
              ? 'Generation Error'
              : progress.phase === 'complete'
              ? 'Season Generation Complete'
              : 'Series Run Control'}
          </span>

          {isRunning && progress.phase !== 'idle' && (
            <Badge variant="outline" className="text-[9px] border-primary/30 text-primary shrink-0">
              {PHASE_LABELS[progress.phase] || progress.phase}
            </Badge>
          )}
          {isPaused && progress.currentEpisode > 0 && (
            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 shrink-0">
              EP {progress.currentEpisode}
            </Badge>
          )}
        </div>

        {/* Action buttons — flex-wrap so they never get clipped */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {lastSavedScriptId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={onOpenLastDoc}
              title="Open last saved episode draft"
            >
              <BookOpen className="h-3 w-3" />
              Last Doc
            </Button>
          )}

          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
              onClick={onPause}
              title="Pause after current phase completes"
            >
              <Pause className="h-3 w-3" />
              Pause
            </Button>
          )}

          {isPaused && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
              onClick={onResume}
              title="Resume generation"
            >
              <Play className="h-3 w-3" />
              Resume
            </Button>
          )}

          {(isRunning || isPaused) && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={onStop}
              title="Stop generation completely"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar — only when actively running or paused mid-run */}
      {(isRunning || isPaused) && effectiveTotal > 0 && (
        <div className="space-y-1">
          <Progress value={Math.min(100, totalPct)} className="h-1.5" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {completedEps} of {effectiveTotal} episodes complete
            </span>
            {lastUpdatedDisplay && (
              <span>Updated {lastUpdatedDisplay}</span>
            )}
          </div>
        </div>
      )}

      {/* Error display */}
      {status === 'error' && progress.error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {progress.error}
        </p>
      )}

      {/* Live phase log — scrollable append-only list */}
      {phaseLog.length > 0 && (isRunning || isPaused) && (
        <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
          {phaseLog.slice(-6).map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-mono text-[9px] opacity-60 shrink-0 w-[56px]">
                {entry.time}
              </span>
              <span className={entry.isActive ? 'text-foreground' : 'opacity-70'}>{entry.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pause confirmation hint */}
      {isPaused && (
        <div className="text-[10px] text-amber-400 flex items-center gap-1">
          <Pause className="h-2.5 w-2.5" />
          Paused safely between phases.
          {lastSavedScriptId ? ' Last draft is ready to open.' : ' No draft saved yet.'}
        </div>
      )}
    </div>
  );
}
