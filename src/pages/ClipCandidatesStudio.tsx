/**
 * Clip Candidates Studio — Per-beat video clip generation + selection UI
 */
import { useState, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Film, Play, Loader2, Check, RefreshCw,
  ChevronDown, ChevronRight, Zap, AlertTriangle, XCircle, Clapperboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBlueprints, useBlueprint } from '@/lib/trailerPipeline/useTrailerPipeline';
import { useClipProgress, useClipsList, useClipEngineMutations } from '@/lib/trailerPipeline/clipHooks';
import { toast } from 'sonner';
import type { EDLBeat, TrailerClip } from '@/lib/trailerPipeline/types';

const ROLE_COLORS: Record<string, string> = {
  hook: 'bg-red-500/20 text-red-300',
  cold_open: 'bg-red-500/20 text-red-300',
  world_establish: 'bg-blue-500/20 text-blue-300',
  world: 'bg-blue-500/20 text-blue-300',
  protagonist_intro: 'bg-green-500/20 text-green-300',
  character_intro: 'bg-green-500/20 text-green-300',
  inciting_incident: 'bg-amber-500/20 text-amber-300',
  rising_action_1: 'bg-orange-500/20 text-orange-300',
  rising_action_2: 'bg-orange-500/20 text-orange-300',
  montage_peak: 'bg-purple-500/20 text-purple-300',
  emotional_beat: 'bg-pink-500/20 text-pink-300',
  climax_tease: 'bg-red-600/20 text-red-400',
  stinger: 'bg-yellow-500/20 text-yellow-300',
  title_card: 'bg-muted text-muted-foreground',
  atmosphere: 'bg-indigo-500/20 text-indigo-300',
  tension_build: 'bg-violet-500/20 text-violet-300',
  rupture: 'bg-rose-500/20 text-rose-300',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued: <Loader2 className="h-3 w-3 text-muted-foreground" />,
  running: <Loader2 className="h-3 w-3 animate-spin text-primary" />,
  succeeded: <Check className="h-3 w-3 text-green-400" />,
  failed: <AlertTriangle className="h-3 w-3 text-destructive" />,
  canceled: <XCircle className="h-3 w-3 text-muted-foreground" />,
};

export default function ClipCandidatesStudio() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const blueprintId = searchParams.get('runId') || searchParams.get('blueprintId') || undefined;
  const [expandedBeats, setExpandedBeats] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  // Queries
  const { data: bpListData } = useBlueprints(projectId);
  const { data: bpData } = useBlueprint(projectId, blueprintId);
  const { data: progressData } = useClipProgress(projectId, blueprintId);
  const { data: clipsData } = useClipsList(projectId, blueprintId);

  // Mutations
  const { enqueueForRun, processQueue, retryJob, selectClip } = useClipEngineMutations(projectId);

  const blueprints = (bpListData?.blueprints || []).filter((bp: any) => bp.status === 'complete');
  const blueprint = bpData?.blueprint || null;
  const beats: EDLBeat[] = blueprint?.edl || [];
  const clips: TrailerClip[] = clipsData?.clips || [];
  const progress = progressData || null;
  const counts = progress?.counts || { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, total: 0 };
  const totalDone = counts.succeeded + counts.failed + counts.canceled;
  const progressPct = counts.total > 0 ? (totalDone / counts.total) * 100 : 0;

  // Group clips by beat
  const clipsByBeat = useMemo(() => {
    const map: Record<number, TrailerClip[]> = {};
    for (const c of clips) {
      if (!map[c.beat_index]) map[c.beat_index] = [];
      map[c.beat_index].push(c);
    }
    return map;
  }, [clips]);

  const toggleBeat = (idx: number) => {
    setExpandedBeats(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleEnqueue = (force: boolean) => {
    if (!blueprintId) return;
    enqueueForRun.mutate({ blueprintId, force });
  };

  const handleProcessAll = async () => {
    if (!blueprintId || !projectId) return;
    setIsProcessing(true);
    try {
      await processQueue.mutateAsync({ blueprintId, maxJobs: 50 });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectClip = (clipId: string, beatIndex: number) => {
    if (!blueprintId) return;
    selectClip.mutate({ clipId, blueprintId, beatIndex });
  };

  const selectBlueprintId = (id: string) => {
    setSearchParams({ blueprintId: id });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}/trailer-pipeline`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Film className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Clip Candidates</h1>
          <Badge variant="outline" className="text-[10px]">v1</Badge>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-3 space-y-4">
          {/* Blueprint Selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clapperboard className="h-4 w-4" />
                Blueprint
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={blueprintId || ''} onValueChange={selectBlueprintId}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="Select blueprint" /></SelectTrigger>
                <SelectContent>
                  {blueprints.map((bp: any) => (
                    <SelectItem key={bp.id} value={bp.id}>
                      {bp.arc_type} · {(bp.edl || []).length} beats · {bp.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {blueprint && (
                <p className="text-[10px] text-muted-foreground">
                  {blueprint.arc_type} · {beats.length} beats ·{' '}
                  {beats.reduce((s: number, b: EDLBeat) => s + (b.duration_s || 0), 0).toFixed(1)}s
                </p>
              )}
            </CardContent>
          </Card>

          {/* Generation Controls */}
          {blueprintId && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Generate
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm" className="w-full" variant="outline"
                  onClick={() => handleEnqueue(false)}
                  disabled={enqueueForRun.isPending}
                >
                  {enqueueForRun.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Generate Missing Clips
                </Button>
                <Button
                  size="sm" className="w-full" variant="outline"
                  onClick={() => handleEnqueue(true)}
                  disabled={enqueueForRun.isPending}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Force Regenerate All
                </Button>

                <Separator />

                <Button
                  size="sm" className="w-full"
                  onClick={handleProcessAll}
                  disabled={isProcessing || processQueue.isPending || counts.queued === 0}
                >
                  {isProcessing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                  Process Queue ({counts.queued} pending)
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Progress */}
          {blueprintId && counts.total > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress value={progressPct} className="h-2" />
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                    Queued: {counts.queued}
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    Running: {counts.running}
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    Done: {counts.succeeded}
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-destructive" />
                    Failed: {counts.failed}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {(clipsData?.clips || []).length} clips produced
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT: Beat Timeline with Clips */}
        <div className="lg:col-span-9 space-y-4">
          {!blueprintId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                <Clapperboard className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Select a blueprint to view clip candidates
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Beats — {beats.length} total</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {clips.filter((c: any) => c.selected).length}/{beats.length} selected
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[calc(100vh-200px)]">
                  <div className="space-y-1.5">
                    {beats.map((beat, idx) => {
                      const beatClips = clipsByBeat[idx] || [];
                      const beatProgress = progress?.beatSummary?.[idx];
                      const selectedClipId = beatProgress?.selectedClipId || beatClips.find((c: any) => c.selected)?.id;
                      const isExpanded = expandedBeats.has(idx);
                      const hint = beat.generator_hint;
                      const jobStatuses = beatProgress?.jobs || [];
                      const hasQueued = jobStatuses.some((j: any) => j.status === 'queued');
                      const hasRunning = jobStatuses.some((j: any) => j.status === 'running');
                      const hasFailed = jobStatuses.some((j: any) => j.status === 'failed');

                      return (
                        <div key={idx} className="border border-border rounded overflow-hidden">
                          <button
                            onClick={() => toggleBeat(idx)}
                            className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}

                            <span className="text-[10px] font-mono text-muted-foreground w-5">#{idx}</span>

                            <Badge className={`text-[10px] ${ROLE_COLORS[beat.role] || 'bg-muted text-muted-foreground'}`}>
                              {beat.role}
                            </Badge>

                            <span className="text-xs font-mono">{beat.duration_s}s</span>

                            {/* Provider hint badges */}
                            {hint && (
                              <>
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 ${
                                    hint.preferred_provider === 'runway'
                                      ? 'border-rose-500/50 text-rose-400'
                                      : 'border-sky-500/50 text-sky-400'
                                  }`}
                                >
                                  {hint.preferred_provider === 'runway' ? 'RUNWAY' : 'VEO'}
                                </Badge>
                                {hint.candidates > 1 && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/50 text-amber-400">
                                    ×{hint.candidates}
                                  </Badge>
                                )}
                              </>
                            )}

                            <span className="text-[10px] text-muted-foreground truncate flex-1">
                              {beat.clip_spec?.action_description}
                            </span>

                            {/* Status indicators */}
                            {hasRunning && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                            {hasFailed && <AlertTriangle className="h-3 w-3 text-destructive" />}

                            <Badge variant="outline" className="text-[10px]">
                              {beatClips.length} clip{beatClips.length !== 1 ? 's' : ''}
                            </Badge>

                            {selectedClipId && <Check className="h-3 w-3 text-green-400" />}
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border bg-muted/10">
                              {/* Beat details */}
                              <div className="grid grid-cols-2 gap-2 text-[10px]">
                                <div><span className="text-muted-foreground">Shot:</span> {beat.clip_spec?.shot_type}</div>
                                <div><span className="text-muted-foreground">Camera:</span> {beat.clip_spec?.camera_move}</div>
                                <div className="col-span-2"><span className="text-muted-foreground">Prompt:</span> {beat.clip_spec?.visual_prompt}</div>
                                <div className="col-span-2"><span className="text-muted-foreground">Audio:</span> {beat.clip_spec?.audio_cue}</div>
                              </div>

                              <Separator />

                              {/* Clip Candidates Grid */}
                              {beatClips.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {beatClips.map((clip: any) => (
                                    <div
                                      key={clip.id}
                                      className={`border rounded-lg overflow-hidden transition-all ${
                                        clip.selected
                                          ? 'border-green-500 ring-1 ring-green-500/30 bg-green-500/5'
                                          : 'border-border hover:border-primary/40'
                                      }`}
                                    >
                                      {/* Video preview */}
                                      {clip.public_url && clip.media_type === 'video' ? (
                                        <video
                                          controls
                                          className="w-full aspect-video object-cover"
                                          src={clip.public_url}
                                          preload="metadata"
                                        />
                                      ) : clip.public_url ? (
                                        <img
                                          src={clip.public_url}
                                          alt={`Clip ${clip.candidate_index}`}
                                          className="w-full aspect-video object-cover bg-muted"
                                        />
                                      ) : (
                                        <div className="w-full aspect-video bg-muted flex items-center justify-center">
                                          <Film className="h-6 w-6 text-muted-foreground/30" />
                                        </div>
                                      )}

                                      <div className="p-2 space-y-1.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <Badge
                                            variant="outline"
                                            className={`text-[9px] px-1.5 py-0 ${
                                              clip.provider === 'runway'
                                                ? 'border-rose-500/50 text-rose-400'
                                                : clip.provider === 'veo'
                                                ? 'border-sky-500/50 text-sky-400'
                                                : 'border-muted-foreground/50 text-muted-foreground'
                                            }`}
                                          >
                                            {(clip.provider || 'stub').toUpperCase()}
                                          </Badge>
                                          <span className="text-[9px] text-muted-foreground">
                                            #{clip.candidate_index || 1}
                                          </span>
                                          {clip.model && (
                                            <span className="text-[9px] text-muted-foreground/60">{clip.model}</span>
                                          )}
                                          {clip.selected && <Check className="h-3 w-3 text-green-400 ml-auto" />}
                                        </div>

                                        <div className="flex items-center gap-1">
                                          {!clip.selected && clip.status === 'complete' && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="text-[10px] h-6 flex-1"
                                              onClick={() => handleSelectClip(clip.id, idx)}
                                              disabled={selectClip.isPending}
                                            >
                                              <Check className="h-2.5 w-2.5 mr-0.5" /> Select
                                            </Button>
                                          )}
                                          {clip.selected && (
                                            <Badge className="text-[9px] bg-green-500/20 text-green-400 border-green-500/30">
                                              Selected
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[10px] text-muted-foreground text-center py-2">
                                  No clips generated yet. Enqueue + process to generate.
                                </p>
                              )}

                              {/* Failed job retry buttons */}
                              {hasFailed && (
                                <div className="flex gap-1 flex-wrap">
                                  {jobStatuses.filter((j: any) => j.status === 'failed').map((j: any, i: number) => (
                                    <Button
                                      key={i}
                                      size="sm"
                                      variant="ghost"
                                      className="text-[10px] h-5 text-destructive"
                                      onClick={() => {
                                        // Need job ID — we have it from progress
                                        const fullJobs = progress?.beatSummary?.[idx]?.jobs || [];
                                        const failedJob = fullJobs.find((fj: any) => fj.status === 'failed');
                                        // job IDs aren't in summary — would need list_jobs. For now, show toast
                                        toast.info('Use "Process Queue" to retry failed jobs');
                                      }}
                                    >
                                      <RefreshCw className="h-2.5 w-2.5 mr-0.5" /> Retry {j.provider} #{j.candidate_index}
                                    </Button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
