/**
 * Series Writer Panel — Canon-locked sequential episode generation for Vertical Drama.
 * Displays canon status, season progress, validation results, and episode grid.
 */

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Layers, Play, CheckCircle2, Circle, Loader2, AlertTriangle,
  Plus, Pen, ChevronDown, Sparkles, BookOpen, Lock, Shield,
  Zap, RotateCcw, XCircle, ArrowRight,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { InfoTooltip } from '@/components/InfoTooltip';
import { useSeriesWriter, type SeriesEpisode, type SeriesProgress } from '@/hooks/useSeriesWriter';
import { SeasonHealthDashboard } from '@/components/series/SeasonHealthDashboard';
import { SeriesRunControlBar } from '@/components/series/SeriesRunControlBar';
import { Trash2, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface Props {
  projectId: string;
}

const STATUS_STYLES: Record<string, { icon: typeof Circle; color: string; label: string }> = {
  pending: { icon: Circle, color: 'text-muted-foreground', label: 'Pending' },
  generating: { icon: Loader2, color: 'text-amber-400', label: 'Generating' },
  complete: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Complete' },
  needs_revision: { icon: AlertTriangle, color: 'text-orange-400', label: 'Needs Revision' },
  error: { icon: AlertTriangle, color: 'text-red-400', label: 'Error' },
  invalidated: { icon: XCircle, color: 'text-red-400', label: 'Invalidated' },
};

const PHASE_LABELS: Record<string, string> = {
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  draft: 'Drafting',
  score: 'Scoring',
  validate: 'Validating',
  metrics: 'Metrics',
  idle: 'Ready',
  complete: 'Complete',
  error: 'Error',
};

function ProgressBar({ progress }: { progress: SeriesProgress }) {
  if (progress.phase === 'idle' || progress.totalEpisodes === 0) return null;

  const completedEpisodes = progress.phase === 'complete'
    ? progress.totalEpisodes
    : Math.max(0, progress.currentEpisode - 1);
  const phaseIdx = ['blueprint', 'architecture', 'draft', 'score', 'validate'].indexOf(progress.phase as string);
  const phaseProgress = phaseIdx >= 0 ? (phaseIdx + 1) / 5 : 1;
  const totalProgress = ((completedEpisodes + phaseProgress) / progress.totalEpisodes) * 100;

  return (
    <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground font-medium flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-primary animate-pulse" />
          Generating Episode {progress.currentEpisode} of {progress.totalEpisodes}
        </span>
        <span className="text-muted-foreground">
          {PHASE_LABELS[progress.phase] || progress.phase}
        </span>
      </div>
      <Progress value={totalProgress} className="h-1.5" />
      {progress.error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {progress.error}
        </p>
      )}
    </div>
  );
}

function CanonStatusCard({ 
  canonSnapshot, 
  isCanonValid, 
  onCreateSnapshot, 
  isCreating, 
  disabled 
}: { 
  canonSnapshot: any; 
  isCanonValid: boolean; 
  onCreateSnapshot: () => void; 
  isCreating: boolean; 
  disabled: boolean;
}) {
  if (!canonSnapshot) {
    return (
      <Card className="border-dashed border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">Canon Not Locked</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Lock the canon snapshot before generating episodes. This freezes Blueprint, Character Bible, and Episode Grid as the source of truth.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            onClick={onCreateSnapshot}
            disabled={isCreating || disabled}
          >
            {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
            Lock Canon
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${isCanonValid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCanonValid ? (
              <Lock className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-400" />
            )}
            <span className={`text-xs font-medium ${isCanonValid ? 'text-emerald-400' : 'text-red-400'}`}>
              {isCanonValid ? 'Canon Locked' : 'Canon Invalidated'}
            </span>
          </div>
          <Badge variant="outline" className="text-[9px]">
            {canonSnapshot.season_episode_count} episodes
          </Badge>
        </div>
        {!isCanonValid && canonSnapshot.invalidation_reason && (
          <p className="text-[10px] text-red-400 mt-1.5">{canonSnapshot.invalidation_reason}</p>
        )}
        {!isCanonValid && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1 mt-2 border-amber-500/30 text-amber-400"
            onClick={onCreateSnapshot}
            disabled={isCreating}
          >
            <RotateCcw className="h-3 w-3" /> Re-lock Canon
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SeasonProgressTracker({ episodes, completedCount }: { episodes: SeriesEpisode[]; completedCount: number }) {
  if (episodes.length === 0) return null;
  const pct = (completedCount / episodes.length) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Season Progress</span>
        <span className="font-mono text-foreground">{completedCount}/{episodes.length}</span>
      </div>
      <Progress value={pct} className="h-2" />
      <div className="flex gap-0.5">
        {episodes.map(ep => (
          <div
            key={ep.id}
            className={`h-1.5 flex-1 rounded-sm ${
              ep.status === 'complete' ? 'bg-emerald-500' :
              ep.status === 'needs_revision' ? 'bg-orange-500' :
              ep.status === 'error' || ep.status === 'invalidated' ? 'bg-red-500' :
              ep.status === 'generating' ? 'bg-amber-500 animate-pulse' :
              'bg-muted/40'
            }`}
            title={`EP ${ep.episode_number}: ${ep.status}`}
          />
        ))}
      </div>
    </div>
  );
}

interface EpisodeCardProps {
  episode: SeriesEpisode;
  isActive: boolean;
  isGenerating: boolean;
  disabled: boolean;
  validation?: any;
  onGenerate: () => void;
  onRead: () => void;
  onDelete: () => void;
  onReset: () => void;
  isResetting?: boolean;
}

function EpisodeCard({ episode, isActive, isGenerating, disabled, validation, onGenerate, onRead, onDelete, onReset, isResetting }: EpisodeCardProps) {
  const style = STATUS_STYLES[episode.status] || STATUS_STYLES.pending;
  const Icon = style.icon;
  const phase = (episode.generation_progress as any)?.phase;

  const statusBadgeClass =
    episode.status === 'complete' ? 'border-emerald-500/30 text-emerald-400' :
    episode.status === 'needs_revision' ? 'border-orange-500/30 text-orange-400' :
    episode.status === 'error' || episode.status === 'invalidated' ? 'border-red-500/30 text-red-400' :
    episode.status === 'generating' ? 'border-amber-500/30 text-amber-400' :
    'border-border text-muted-foreground';

  return (
    <div className={`border rounded-lg transition-colors ${
      isActive ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-card/50'
    }`}>
      {/* Top row: icon + title info + status badge */}
      <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-1">
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${style.color} ${
          episode.status === 'generating' ? 'animate-spin' : ''
        }`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              EP {String(episode.episode_number).padStart(2, '0')}
            </span>
            <span className="text-sm font-medium text-foreground break-words min-w-0">
              {episode.title || `Episode ${episode.episode_number}`}
            </span>
            {episode.status === 'generating' && phase && (
              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 bg-amber-500/10 shrink-0">
                {PHASE_LABELS[phase] || phase}
              </Badge>
            )}
          </div>
          {episode.logline && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{episode.logline}</p>
          )}
          {episode.validation_status === 'needs_revision' && (
            <p className="text-[10px] text-orange-400 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              Validation: {episode.validation_score ? `${Math.round(Number(episode.validation_score))}%` : 'Needs revision'}
            </p>
          )}
        </div>

        <Badge variant="outline" className={`text-[9px] shrink-0 mt-0.5 ${statusBadgeClass}`}>
          {style.label}
        </Badge>
      </div>

      {/* Bottom row: action buttons */}
      <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
        {/* Stop & Reset — for stuck/stalled generating episodes */}
        {episode.status === 'generating' && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={onReset}
            disabled={isResetting}
            title="Stop and reset this stuck episode so you can retry"
          >
            {isResetting
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <XCircle className="h-3 w-3" />}
            Stop & Reset
          </Button>
        )}

        {(episode.status === 'complete' || episode.status === 'needs_revision') && episode.script_id && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
            onClick={onRead}
          >
            <BookOpen className="h-3 w-3" /> Read
          </Button>
        )}

        {(episode.status === 'pending' || episode.status === 'invalidated') && !disabled && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            <Play className="h-3 w-3" /> Generate
          </Button>
        )}

        {(episode.status === 'error' || episode.status === 'needs_revision') && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1 border-orange-500/30 text-orange-400 hover:text-orange-300"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            <RotateCcw className="h-3 w-3" /> {episode.status === 'needs_revision' ? 'Revise' : 'Retry'}
          </Button>
        )}

        {!isGenerating && episode.status !== 'generating' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 ml-auto"
            onClick={onDelete}
            title="Delete episode"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ScriptReaderDialog({
  episode,
  open,
  onOpenChange,
  fetchContent,
}: {
  episode: SeriesEpisode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchContent: (scriptId: string) => Promise<string>;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const loadContent = useCallback(async (scriptId: string) => {
    setLoading(true);
    try {
      const text = await fetchContent(scriptId);
      setContent(text);
    } catch {
      setContent('Failed to load script content.');
    }
    setLoading(false);
  }, [fetchContent]);

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && episode?.script_id) {
      loadContent(episode.script_id);
    }
    if (!isOpen) setContent('');
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-primary" />
            {episode ? `EP ${String(episode.episode_number).padStart(2, '0')} — ${episode.title || `Episode ${episode.episode_number}`}` : 'Script'}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1 max-h-[60vh]">
            <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono text-foreground p-4">
              {content}
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SeriesWriterPanel({ projectId }: Props) {
  const {
    episodes, deletedEpisodes, showDeleted, setShowDeleted,
    isLoading, canonSnapshot, canonLoading,
    validations, episodeMetrics, metricsRunning, metricsRunningEp,
    progress, isGenerating, completedCount, runControl,
    isSeasonComplete, nextEpisode, hasFailedValidation, hasMetricsBlock, isCanonValid,
    createCanonSnapshot, createEpisodes, generateOne, generateAll,
    fetchScriptContent, runEpisodeMetrics,
    deleteEpisode, restoreEpisode, hardDeleteEpisode, resetStuckEpisode,
    pauseGeneration, resumeGeneration, stopGeneration,
  } = useSeriesWriter(projectId);

  const [episodeCount, setEpisodeCount] = useState('10');
  const [readerEpisode, setReaderEpisode] = useState<SeriesEpisode | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [lastDocOpen, setLastDocOpen] = useState(false);
  const [lastDocContent, setLastDocContent] = useState('');
  const [lastDocLoading, setLastDocLoading] = useState(false);
  const [autoRunConfirmOpen, setAutoRunConfirmOpen] = useState(false);
  const [deleteConfirmEp, setDeleteConfirmEp] = useState<SeriesEpisode | null>(null);
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('');

  const hasEpisodes = episodes.length > 0;
  const canGenerate = isCanonValid && !isGenerating;

  // ── Open last saved doc from runControl ──
  const openLastDoc = useCallback(async () => {
    const scriptId = runControl.lastSavedScriptId;
    if (!scriptId) return;
    setLastDocLoading(true);
    setLastDocOpen(true);
    try {
      const text = await fetchScriptContent(scriptId);
      setLastDocContent(text);
    } catch {
      setLastDocContent('Failed to load draft content.');
    }
    setLastDocLoading(false);
  }, [runControl.lastSavedScriptId, fetchScriptContent]);

  if (isLoading || canonLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Series Writer</h3>
          <InfoTooltip text="Canon-locked sequential episode generation. Lock your Blueprint, Character Bible, and Episode Grid, then generate episodes in order with narrative continuity and validation." />
        </div>
        {hasEpisodes && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{episodes.length} episodes
          </span>
        )}
      </div>

      {/* Canon Status */}
      <CanonStatusCard
        canonSnapshot={canonSnapshot}
        isCanonValid={isCanonValid}
        onCreateSnapshot={() => createCanonSnapshot.mutate()}
        isCreating={createCanonSnapshot.isPending}
        disabled={isGenerating}
      />

      {/* Season Progress */}
      {hasEpisodes && (
        <SeasonProgressTracker episodes={episodes} completedCount={completedCount} />
      )}

      {/* Episode count selector */}
      {isCanonValid && (
        <div className={`border ${hasEpisodes ? 'border-border/50' : 'border-dashed border-border/60'} rounded-lg p-4 space-y-3`}>
          {!hasEpisodes && (
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium text-foreground">Configure Your Season</p>
              <p className="text-xs text-muted-foreground">
                Canon locked with {canonSnapshot?.season_episode_count} episodes. Create episode slots to begin generation.
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            {!hasEpisodes && (
              <Select value={String(canonSnapshot?.season_episode_count || episodeCount)} onValueChange={setEpisodeCount} disabled={isGenerating}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 8, 10, 12, 15, 20, 25, 30].map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n} episodes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {!hasEpisodes && (
              <Button
                size="sm"
                onClick={() => createEpisodes.mutate(canonSnapshot?.season_episode_count || Number(episodeCount))}
                disabled={createEpisodes.isPending || isGenerating}
                className="h-8 text-xs"
              >
                {createEpisodes.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Creating…</>
                ) : (
                  <><Plus className="h-3 w-3 mr-1.5" /> Create {canonSnapshot?.season_episode_count || episodeCount} Episodes</>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Generation Controls */}
      {hasEpisodes && isCanonValid && !isSeasonComplete && (
        <div className="flex items-center gap-2">
          {nextEpisode && !hasFailedValidation && (
            <Button
              size="sm"
              onClick={() => generateOne(nextEpisode)}
              disabled={!canGenerate}
              className="h-8 text-xs gap-1.5"
            >
              {isGenerating ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
              ) : (
                <><ArrowRight className="h-3 w-3" /> Generate EP {nextEpisode.episode_number}</>
              )}
            </Button>
          )}

          {!isGenerating && episodes.filter(e => e.status === 'pending').length > 1 && !hasFailedValidation && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAutoRunConfirmOpen(true)}
              disabled={!canGenerate}
              className="h-8 text-xs gap-1.5"
            >
              <Zap className="h-3 w-3" /> AutoRun Season
            </Button>
          )}

          {hasFailedValidation && (
            <div className="flex items-center gap-1.5 text-xs text-orange-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Fix validation issues before generating next episode
            </div>
          )}
        </div>
      )}

      {/* Season Complete Banner */}
      {isSeasonComplete && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <div>
            <span className="text-xs text-emerald-400 font-medium">
              Season Complete — All {episodes.length} episodes generated
            </span>
            <p className="text-[10px] text-emerald-400/70 mt-0.5">
              Series Writer pipeline finished. Export or review episodes above.
            </p>
          </div>
        </div>
      )}

      {/* Stuck episode banner — visible when episodes are stalled from a previous session */}
      {!isGenerating && episodes.some(ep => ep.status === 'generating') && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-400">Generation Stalled</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {episodes.filter(ep => ep.status === 'generating').length === 1
              ? `EP ${episodes.find(ep => ep.status === 'generating')?.episode_number} is stuck from a previous session.`
              : `${episodes.filter(ep => ep.status === 'generating').length} episodes are stuck.`}
            {' '}Reset to retry.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {episodes.filter(ep => ep.status === 'generating').map(ep => (
              <Button
                key={ep.id}
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => resetStuckEpisode.mutate(ep.id)}
                disabled={resetStuckEpisode.isPending}
              >
                {resetStuckEpisode.isPending && resetStuckEpisode.variables === ep.id
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <XCircle className="h-3 w-3" />}
                Reset EP {ep.episode_number}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Series Run Control Bar — always visible when active or paused */}
      <SeriesRunControlBar
        progress={progress}
        runControl={runControl}
        totalEpisodes={episodes.length}
        onPause={pauseGeneration}
        onResume={resumeGeneration}
        onStop={stopGeneration}
        onOpenLastDoc={openLastDoc}
      />

      {/* Episode Grid */}
      {hasEpisodes && (
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-1.5">
            {episodes.map((ep, idx) => {
              const prevComplete = idx === 0 || episodes[idx - 1].status === 'complete';
              const isNextPending = prevComplete && (ep.status === 'pending' || ep.status === 'error' || ep.status === 'invalidated' || ep.status === 'needs_revision');
              const epValidation = validations.find(v => v.episode_id === ep.id);
              return (
                <EpisodeCard
                  key={ep.id}
                  episode={ep}
                  isActive={isGenerating && progress.currentEpisode === ep.episode_number}
                  isGenerating={isGenerating}
                  disabled={!isNextPending || !isCanonValid}
                  validation={epValidation}
                  onGenerate={() => generateOne(ep)}
                  onRead={() => { setReaderEpisode(ep); setReaderOpen(true); }}
                  onDelete={() => setDeleteConfirmEp(ep)}
                  onReset={() => resetStuckEpisode.mutate(ep.id)}
                  isResetting={resetStuckEpisode.isPending && resetStuckEpisode.variables === ep.id}
                />
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Deleted Episodes */}
      {deletedEpisodes.length > 0 && (
        <div className="space-y-1.5">
          <button
            onClick={() => setShowDeleted(!showDeleted)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showDeleted ? 'rotate-0' : '-rotate-90'}`} />
            {deletedEpisodes.length} deleted episode{deletedEpisodes.length > 1 ? 's' : ''}
          </button>
          {showDeleted && (
            <div className="space-y-1 pl-2 border-l border-border/30">
              {deletedEpisodes.map(ep => (
                <div key={ep.id} className="flex items-center justify-between px-3 py-1.5 rounded bg-muted/20 text-xs text-muted-foreground">
                  <span>EP {String(ep.episode_number).padStart(2, '0')} — {ep.title}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => restoreEpisode.mutate(ep.id)}>
                      <Undo2 className="h-3 w-3" /> Restore
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Season Health Dashboard */}
      {hasEpisodes && episodeMetrics.length > 0 && (
        <SeasonHealthDashboard
          metrics={episodeMetrics}
          seasonEpisodeCount={canonSnapshot?.season_episode_count || episodes.length}
          onRunMetrics={(ep) => runEpisodeMetrics(ep)}
          onAutoFix={(ep) => { /* TODO: auto-fix integration */ toast.info(`Auto-fix for EP ${ep} coming soon`); }}
          isRunning={metricsRunning}
          runningEpisode={metricsRunningEp}
        />
      )}

      {/* Script Reader */}
      <ScriptReaderDialog
        episode={readerEpisode}
        open={readerOpen}
        onOpenChange={setReaderOpen}
        fetchContent={fetchScriptContent}
      />

      {/* Last Saved Doc Viewer */}
      <Dialog open={lastDocOpen} onOpenChange={setLastDocOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              Last Saved Draft
            </DialogTitle>
          </DialogHeader>
          {lastDocLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1 max-h-[60vh]">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono text-foreground p-4">
                {lastDocContent || 'No content available.'}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>


      {/* AutoRun Confirm */}
      <AlertDialog open={autoRunConfirmOpen} onOpenChange={setAutoRunConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>AutoRun Season Generation</AlertDialogTitle>
            <AlertDialogDescription>
              This will sequentially generate all remaining episodes ({episodes.filter(e => e.status === 'pending').length} pending). Each episode will be validated before the next begins. Generation stops on validation failure or error.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => generateAll()}>
              Start AutoRun
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Episode Confirm */}
      <AlertDialog open={!!deleteConfirmEp} onOpenChange={(open) => { if (!open) { setDeleteConfirmEp(null); setHardDeleteConfirmText(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Episode {deleteConfirmEp?.episode_number}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>This will soft-delete the episode. You can restore it later.</p>
                <p className="text-[11px] text-muted-foreground">
                  To permanently delete, type <span className="font-mono font-bold">DELETE</span> below:
                </p>
                <Input
                  value={hardDeleteConfirmText}
                  onChange={e => setHardDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE for permanent removal"
                  className="h-8 text-xs"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {hardDeleteConfirmText === 'DELETE' ? (
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700"
                onClick={() => { if (deleteConfirmEp) hardDeleteEpisode.mutate(deleteConfirmEp.id); }}
              >
                Permanently Delete
              </AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={() => { if (deleteConfirmEp) deleteEpisode.mutate({ episodeId: deleteConfirmEp.id }); }}>
                Soft Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
