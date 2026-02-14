/**
 * Series Writer Panel — Episode grid for Vertical Drama.
 * Per-episode generation + script reader dialog.
 */

import { useState, useCallback } from 'react';
import {
  Layers, Play, CheckCircle2, Circle, Loader2, AlertTriangle,
  Plus, Pen, ChevronDown, ChevronRight, Sparkles, BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InfoTooltip } from '@/components/InfoTooltip';
import { useSeriesWriter, type SeriesEpisode, type SeriesProgress } from '@/hooks/useSeriesWriter';

interface Props {
  projectId: string;
}

const STATUS_STYLES: Record<string, { icon: typeof Circle; color: string; label: string }> = {
  pending: { icon: Circle, color: 'text-muted-foreground', label: 'Pending' },
  generating: { icon: Loader2, color: 'text-amber-400', label: 'Generating' },
  complete: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Complete' },
  error: { icon: AlertTriangle, color: 'text-red-400', label: 'Error' },
};

const PHASE_LABELS: Record<string, string> = {
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  draft: 'Drafting',
  score: 'Scoring',
  idle: 'Ready',
  complete: 'Complete',
  error: 'Error',
};

function ProgressBar({ progress }: { progress: SeriesProgress }) {
  if (progress.phase === 'idle' || progress.totalEpisodes === 0) return null;

  const completedEpisodes = progress.phase === 'complete'
    ? progress.totalEpisodes
    : Math.max(0, progress.currentEpisode - 1);
  const phaseIdx = ['blueprint', 'architecture', 'draft', 'score'].indexOf(progress.phase as string);
  const phaseProgress = phaseIdx >= 0 ? (phaseIdx + 1) / 4 : 1;
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

interface EpisodeCardProps {
  episode: SeriesEpisode;
  isActive: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onRead: () => void;
}

function EpisodeCard({ episode, isActive, isGenerating, onGenerate, onRead }: EpisodeCardProps) {
  const style = STATUS_STYLES[episode.status] || STATUS_STYLES.pending;
  const Icon = style.icon;
  const phase = (episode.generation_progress as any)?.phase;

  return (
    <div className={`border rounded-lg transition-colors ${
      isActive ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-card/50'
    }`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Icon className={`h-4 w-4 shrink-0 ${style.color} ${
          episode.status === 'generating' ? 'animate-spin' : ''
        }`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              EP {String(episode.episode_number).padStart(2, '0')}
            </span>
            <span className="text-sm font-medium text-foreground truncate">
              {episode.title || `Episode ${episode.episode_number}`}
            </span>
          </div>
          {episode.logline && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{episode.logline}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {episode.status === 'generating' && phase && (
            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 bg-amber-500/10">
              {PHASE_LABELS[phase] || phase}
            </Badge>
          )}

          {episode.status === 'complete' && episode.script_id && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
              onClick={onRead}
            >
              <BookOpen className="h-3 w-3" /> Read
            </Button>
          )}

          {episode.status === 'pending' && (
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

          {episode.status === 'error' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1 border-red-500/30 text-red-400 hover:text-red-300"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              <Play className="h-3 w-3" /> Retry
            </Button>
          )}

          <Badge variant="outline" className={`text-[9px] ${
            episode.status === 'complete' ? 'border-emerald-500/30 text-emerald-400' :
            episode.status === 'error' ? 'border-red-500/30 text-red-400' :
            episode.status === 'generating' ? 'border-amber-500/30 text-amber-400' :
            'border-border text-muted-foreground'
          }`}>
            {style.label}
          </Badge>
        </div>
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

  // Load content when dialog opens
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
    episodes, isLoading, progress, isGenerating,
    createEpisodes, generateAll, generateOne, fetchScriptContent,
  } = useSeriesWriter(projectId);

  const [episodeCount, setEpisodeCount] = useState('10');
  const [readerEpisode, setReaderEpisode] = useState<SeriesEpisode | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);

  const hasEpisodes = episodes.length > 0;
  const allComplete = hasEpisodes && episodes.every(e => e.status === 'complete');
  const completedCount = episodes.filter(e => e.status === 'complete').length;
  const pendingCount = episodes.filter(e => e.status !== 'complete').length;

  if (isLoading) {
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
          <InfoTooltip text="Generate episodic scripts one at a time or all at once. Click 'Read' on any completed episode to view its script." />
        </div>
        {hasEpisodes && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{episodes.length} episodes complete
          </span>
        )}
      </div>

      {/* Episode count selector */}
      <div className={`border ${hasEpisodes ? 'border-border/50' : 'border-dashed border-border/60'} rounded-lg p-4 space-y-3`}>
        {!hasEpisodes && (
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-foreground">Configure Your Series</p>
            <p className="text-xs text-muted-foreground">
              Choose the number of episodes. You can generate them one at a time or all at once.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          <Select value={episodeCount} onValueChange={setEpisodeCount} disabled={isGenerating}>
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

          <Button
            size="sm"
            onClick={() => createEpisodes.mutate(Number(episodeCount))}
            disabled={createEpisodes.isPending || isGenerating}
            className="h-8 text-xs"
          >
            {createEpisodes.isPending ? (
              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Creating…</>
            ) : hasEpisodes ? (
              <><Pen className="h-3 w-3 mr-1.5" /> Reset to {episodeCount}</>
            ) : (
              <><Plus className="h-3 w-3 mr-1.5" /> Create Episodes</>
            )}
          </Button>
        </div>

        {hasEpisodes && Number(episodeCount) !== episodes.length && (
          <p className="text-[10px] text-amber-400 text-center">
            Resetting will remove existing episodes and start fresh.
          </p>
        )}
      </div>

      {/* Generation Progress */}
      {isGenerating && <ProgressBar progress={progress} />}

      {/* Episode Grid */}
      {hasEpisodes && (
        <div className="space-y-3">
          {/* Generate All button */}
          {!allComplete && !isGenerating && pendingCount > 1 && (
            <Button
              onClick={generateAll}
              disabled={isGenerating}
              variant="outline"
              className="w-full h-9 text-xs gap-1.5"
            >
              <Play className="h-3.5 w-3.5" />
              Generate All Remaining ({pendingCount} episodes)
            </Button>
          )}

          {allComplete && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">
                All {episodes.length} episodes generated successfully
              </span>
            </div>
          )}

          <ScrollArea className="max-h-[500px]">
            <div className="space-y-1.5">
              {episodes.map(ep => (
                <EpisodeCard
                  key={ep.id}
                  episode={ep}
                  isActive={isGenerating && progress.currentEpisode === ep.episode_number}
                  isGenerating={isGenerating}
                  onGenerate={() => generateOne(ep)}
                  onRead={() => { setReaderEpisode(ep); setReaderOpen(true); }}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Script Reader Dialog */}
      <ScriptReaderDialog
        episode={readerEpisode}
        open={readerOpen}
        onOpenChange={setReaderOpen}
        fetchContent={fetchScriptContent}
      />
    </div>
  );
}
