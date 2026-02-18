/**
 * CompileSeasonModal — Dialog to compile all episode scripts into a master season document.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronRight,
  FileText, Loader2, RotateCcw, Sparkles, XCircle,
} from 'lucide-react';
import type { SeriesEpisode } from '@/hooks/useSeriesWriter';

interface CompileSource {
  episode_id: string;
  episode_number: number;
  script_id: string | null;
  version_id: string | null;
  source_type: string;
}

interface CompileResult {
  doc_id: string;
  version_id: string;
  version_number: number;
  sources: CompileSource[];
  skipped: Array<{ episode_number: number; reason: string }>;
  episode_count: number;
  compiled_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  episodes: SeriesEpisode[];
  seasonEpisodeCount: number;
  onOpenMaster: (docId: string, versionId: string, masterText?: string) => void;
}

export function CompileSeasonModal({
  open,
  onOpenChange,
  projectId,
  episodes,
  seasonEpisodeCount,
  onOpenMaster,
}: Props) {
  const [useApproved, setUseApproved] = useState(false);
  const [includeEpisodeTitles, setIncludeEpisodeTitles] = useState(true);
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(
    () => new Set(episodes.map(e => e.id))
  );
  const [isCompiling, setIsCompiling] = useState(false);
  const [lastResult, setLastResult] = useState<CompileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completedCount = episodes.filter(e => !!e.locked_at || e.status === 'complete').length;
  const isSeasonFullyComplete = completedCount === seasonEpisodeCount && seasonEpisodeCount > 0;
  const incompleteCount = episodes.filter(e => selectedEpisodeIds.has(e.id) && !e.script_id).length;

  const toggleEpisode = (id: string) => {
    setSelectedEpisodeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedEpisodeIds(new Set(episodes.map(e => e.id)));
  const selectNone = () => setSelectedEpisodeIds(new Set());

  const handleCompile = async () => {
    setIsCompiling(true);
    setError(null);
    try {
      const { data: { session } } = await import('@/integrations/supabase/client').then(m => m.supabase.auth.getSession());
      if (!session) throw new Error('Not authenticated');

      const body = {
        project_id: projectId,
        use_approved: useApproved,
        include_episode_titles: includeEpisodeTitles,
        episode_ids: selectedEpisodeIds.size < episodes.length ? Array.from(selectedEpisodeIds) : undefined,
      };

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compile-season`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );

      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Compile failed');

      setLastResult(data as CompileResult);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleOpenMaster = () => {
    if (!lastResult) return;
    onOpenMaster(lastResult.doc_id, lastResult.version_id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Compile Season to Master Script
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-5 p-1 pr-3">

            {/* Season completeness banner */}
            <div className={`flex items-start gap-2 p-3 rounded-lg border ${
              isSeasonFullyComplete
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              {isSeasonFullyComplete
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />}
              <div className="space-y-0.5">
                <p className={`text-xs font-medium ${isSeasonFullyComplete ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isSeasonFullyComplete
                    ? `Season complete — all ${seasonEpisodeCount} episodes drafted`
                    : `${completedCount} of ${seasonEpisodeCount} episodes drafted`}
                </p>
                {!isSeasonFullyComplete && (
                  <p className="text-[11px] text-muted-foreground">
                    You can still compile — missing episodes will show a placeholder.
                  </p>
                )}
              </div>
            </div>

            {/* Source options */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Options</h4>

              <label className="flex items-start gap-3 cursor-pointer group">
                <Checkbox
                  checked={useApproved}
                  onCheckedChange={(c) => setUseApproved(!!c)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Approved versions only</p>
                  <p className="text-[11px] text-muted-foreground">
                    Use the latest &quot;final&quot; approved version for each episode. Falls back to latest draft if no approval exists.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group">
                <Checkbox
                  checked={includeEpisodeTitles}
                  onCheckedChange={(c) => setIncludeEpisodeTitles(!!c)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Include episode titles in headers</p>
                  <p className="text-[11px] text-muted-foreground">
                    Adds &quot;EPISODE N: TITLE&quot; dividers between episodes.
                  </p>
                </div>
              </label>
            </div>

            <Separator />

            {/* Episode selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Episodes to include ({selectedEpisodeIds.size} / {episodes.length})
                </h4>
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectAll}>All</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectNone}>None</Button>
                </div>
              </div>

              {incompleteCount > 0 && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {incompleteCount} selected episode{incompleteCount > 1 ? 's have' : ' has'} no script — will show placeholder text
                </p>
              )}

              <div className="grid grid-cols-2 gap-1 max-h-52 overflow-y-auto pr-1">
                {episodes.map(ep => {
                  const isSelected = selectedEpisodeIds.has(ep.id);
                  const hasScript = !!ep.script_id;
                  const isLocked = !!ep.locked_at;
                  return (
                    <label
                      key={ep.id}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer border transition-colors ${
                        isSelected
                          ? 'border-primary/30 bg-primary/5'
                          : 'border-border/40 hover:border-border/70 bg-transparent'
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleEpisode(ep.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            EP{String(ep.episode_number).padStart(2, '0')}
                          </span>
                          {isLocked && <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-primary">Locked</Badge>}
                          {!hasScript && <XCircle className="h-3 w-3 text-muted-foreground/50" />}
                        </div>
                        <p className="text-[11px] text-foreground truncate">
                          {ep.title || `Episode ${ep.episode_number}`}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Last compile result */}
            {lastResult && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-400">
                      Compiled — v{lastResult.version_number} · {lastResult.episode_count} episodes
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(lastResult.compiled_at).toLocaleTimeString()}
                    </span>
                  </div>

                  {lastResult.skipped.length > 0 && (
                    <div className="text-[11px] text-amber-400 space-y-0.5">
                      <p className="font-medium">Placeholders inserted:</p>
                      {lastResult.skipped.map(s => (
                        <p key={s.episode_number} className="pl-2">
                          • EP{String(s.episode_number).padStart(2, '0')} — {s.reason === 'no_script' ? 'no script' : s.reason}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sources used</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {lastResult.sources.map(s => (
                        <div key={s.episode_id} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="font-mono">EP{String(s.episode_number).padStart(2, '0')}</span>
                          <ChevronRight className="h-2.5 w-2.5" />
                          <span>{
                            s.source_type === 'approved' ? 'approved version' :
                            s.source_type === 'latest_fallback' ? 'latest draft (no approval)' :
                            s.source_type === 'latest' ? 'latest draft' :
                            'missing'
                          }</span>
                          {s.version_id && (
                            <span className="font-mono text-muted-foreground/60">·{s.version_id.slice(0, 6)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button
                    className="w-full gap-1.5"
                    size="sm"
                    onClick={handleOpenMaster}
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Open Master Script
                  </Button>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-border/50 mt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>
          <div className="flex-1" />
          {lastResult && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={handleCompile}
              disabled={isCompiling || selectedEpisodeIds.size === 0}
            >
              {isCompiling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RotateCcw className="h-3.5 w-3.5" />}
              Recompile
            </Button>
          )}
          {!lastResult && (
            <Button
              size="sm"
              className="text-xs gap-1.5"
              onClick={handleCompile}
              disabled={isCompiling || selectedEpisodeIds.size === 0}
            >
              {isCompiling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <FileText className="h-3.5 w-3.5" />}
              {isCompiling ? 'Compiling…' : 'Compile Season Script'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
