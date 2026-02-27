/**
 * SeriesWriterAutorunPanel — End-to-end series writer autorun UI.
 *
 * Shows prerequisites, per-episode progress table, and controls.
 * Only for series/vertical_drama lanes.
 */
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Rocket, Play, Pause, RotateCcw, CheckCircle2, XCircle, AlertTriangle,
  Loader2, FileText, ShieldCheck, Lock, BookOpen,
} from 'lucide-react';
import { useSeriesWriterAutorun, type AutorunItem } from '@/hooks/useSeriesWriterAutorun';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  projectId: string;
}

interface Prerequisites {
  hasLane: boolean;
  lane: string | null;
  hasEpisodeCount: boolean;
  episodeCount: number | null;
  episodeLocked: boolean;
  hasGrid: boolean;
  hasCharacterBible: boolean;
  allMet: boolean;
}

function usePrerequisites(projectId: string): Prerequisites {
  const { data } = useQuery({
    queryKey: ['series-autorun-prereqs', projectId],
    queryFn: async () => {
      const { data: proj } = await supabase
        .from('projects')
        .select('assigned_lane, season_episode_count, season_episode_count_locked, format')
        .eq('id', projectId)
        .single();

      const { data: docs } = await supabase
        .from('project_documents')
        .select('doc_type')
        .eq('project_id', projectId)
        .in('doc_type', ['episode_grid', 'character_bible']);

      const docTypes = new Set((docs || []).map((d: any) => d.doc_type));

      const lane = proj?.assigned_lane || null;
      const isSeriesLane = ['series', 'vertical_drama'].includes(lane || '');
      const hasLane = !!lane && isSeriesLane;
      const episodeCount = proj?.season_episode_count;
      const hasEpisodeCount = typeof episodeCount === 'number' && episodeCount > 0;
      const episodeLocked = proj?.season_episode_count_locked === true;

      return {
        hasLane,
        lane,
        hasEpisodeCount,
        episodeCount: hasEpisodeCount ? episodeCount : null,
        episodeLocked,
        hasGrid: docTypes.has('episode_grid'),
        hasCharacterBible: docTypes.has('character_bible'),
        allMet: hasLane && hasEpisodeCount && episodeLocked && docTypes.has('episode_grid'),
      };
    },
    staleTime: 10000,
  });

  return data || {
    hasLane: false, lane: null, hasEpisodeCount: false, episodeCount: null,
    episodeLocked: false, hasGrid: false, hasCharacterBible: false, allMet: false,
  };
}

function PrereqItem({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {met ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      )}
      <span className={met ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
    </div>
  );
}

function EpisodeStatusRow({ item }: { item: AutorunItem }) {
  const isComplete = item.status === 'regenerated';
  const isError = item.status === 'error';
  const isRunning = item.status === 'running';

  return (
    <div className="flex items-center justify-between py-1.5 px-3 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">
          Ep {item.episode_index}: {item.episode_title}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {item.char_after > 0 && (
          <span className="text-[10px] text-muted-foreground">{(item.char_after / 1000).toFixed(1)}k</span>
        )}
        {item.auto_approved && (
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
        )}
        <Badge
          variant={isComplete ? 'default' : isError ? 'destructive' : isRunning ? 'secondary' : 'outline'}
          className="text-[9px] px-1.5 py-0"
        >
          {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />}
          {isComplete ? 'Done' : isError ? 'Failed' : isRunning ? 'Writing…' : 'Queued'}
        </Badge>
        {isError && item.error && (
          <span className="text-[9px] text-destructive max-w-[120px] truncate" title={item.error}>
            {item.error}
          </span>
        )}
      </div>
    </div>
  );
}

export function SeriesWriterAutorunPanel({ projectId }: Props) {
  const prereqs = usePrerequisites(projectId);
  const autorun = useSeriesWriterAutorun(projectId);
  const [stopOnFirstFail, setStopOnFirstFail] = useState(false);

  const isRunning = autorun.progress.status === 'running';
  const isComplete = autorun.progress.status === 'complete';
  const isFailed = autorun.progress.status === 'failed';
  const isPaused = autorun.progress.status === 'paused';
  const hasJob = autorun.items.length > 0 || isRunning || isComplete || isFailed || isPaused;

  const progressPct = autorun.progress.total > 0
    ? Math.round((autorun.progress.completed / autorun.progress.total) * 100)
    : 0;

  const sortedItems = useMemo(
    () => [...autorun.items].sort((a, b) => a.episode_index - b.episode_index),
    [autorun.items],
  );

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Rocket className="h-4 w-4 text-primary" />
            Series Writer Auto-Run
          </CardTitle>
          {prereqs.lane && (
            <Badge variant="outline" className="text-[9px]">
              {prereqs.lane.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Prerequisites */}
        {!prereqs.allMet && !hasJob && (
          <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Prerequisites</p>
            <PrereqItem met={prereqs.hasLane} label={`Lane assigned${prereqs.lane ? `: ${prereqs.lane.replace(/_/g, ' ')}` : ''}`} />
            <PrereqItem met={prereqs.hasEpisodeCount && prereqs.episodeLocked} label={
              prereqs.hasEpisodeCount
                ? `${prereqs.episodeCount} episodes${prereqs.episodeLocked ? ' (locked)' : ' — needs locking'}`
                : 'Episode count set & locked'
            } />
            <PrereqItem met={prereqs.hasGrid} label="Episode Grid exists" />
            <PrereqItem met={prereqs.hasCharacterBible} label="Character Bible exists (recommended)" />
          </div>
        )}

        {/* Error */}
        {autorun.error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30">
            <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{autorun.error}</p>
          </div>
        )}

        {/* Progress bar */}
        {hasJob && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                {isRunning ? 'Writing episodes…' : isComplete ? 'Complete' : isFailed ? 'Failed' : isPaused ? 'Paused' : 'Ready'}
              </span>
              <span>
                {autorun.progress.completed}/{autorun.progress.total}
                {autorun.progress.errors > 0 && ` (${autorun.progress.errors} failed)`}
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        {/* Completion messages */}
        {isComplete && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/30">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="text-foreground font-medium">All episodes generated & auto-approved</p>
              {autorun.progress.masterBuilt && (
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1">
                  <BookOpen className="h-3 w-3" /> Master Season Script built
                </p>
              )}
            </div>
          </div>
        )}

        {isFailed && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30">
            <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">
              Auto-run stopped. {autorun.progress.errors} episode(s) failed validation after retry.
            </p>
          </div>
        )}

        {/* Episode table */}
        {sortedItems.length > 0 && (
          <ScrollArea className="max-h-[250px] border rounded-md">
            {sortedItems.map(item => (
              <EpisodeStatusRow key={item.id} item={item} />
            ))}
          </ScrollArea>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {!hasJob && (
            <>
              <Button
                size="sm"
                onClick={() => autorun.startAutorun({ stopOnFirstFail })}
                disabled={!prereqs.allMet || autorun.loading}
                className="gap-1.5"
              >
                {autorun.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Start Auto-Run
              </Button>
              <div className="flex items-center gap-1.5 ml-2">
                <Switch
                  id="stop-on-fail"
                  checked={stopOnFirstFail}
                  onCheckedChange={setStopOnFirstFail}
                  className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
                />
                <Label htmlFor="stop-on-fail" className="text-[10px] text-muted-foreground cursor-pointer">
                  Stop on first failure
                </Label>
              </div>
            </>
          )}

          {isRunning && (
            <Button size="sm" variant="outline" onClick={autorun.pauseAutorun} className="gap-1">
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}

          {isPaused && (
            <Button size="sm" onClick={autorun.resumeAutorun} disabled={autorun.loading} className="gap-1">
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}

          {(isComplete || isFailed) && (
            <Button size="sm" variant="outline" onClick={autorun.reset} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>

        {/* Info text when idle */}
        {!hasJob && prereqs.allMet && (
          <p className="text-[10px] text-muted-foreground">
            Generates all {prereqs.episodeCount} episode scripts, runs quality gates, auto-approves passing versions,
            and builds the Master Season Script — all in one run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
