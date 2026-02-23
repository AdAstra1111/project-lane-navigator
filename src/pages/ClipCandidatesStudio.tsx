/**
 * Clip Candidates Studio — Per-beat video clip generation + selection UI
 */
import { useState, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Film, Play, Loader2, Check, RefreshCw, Download,
  ChevronDown, ChevronRight, Zap, AlertTriangle, XCircle, Clapperboard, Clock,
  Square, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBlueprints, useBlueprint } from '@/lib/trailerPipeline/useTrailerPipeline';
import { useClipProgress, useClipPolling, useClipsList, useClipEngineMutations } from '@/lib/trailerPipeline/clipHooks';
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
  polling: <Loader2 className="h-3 w-3 animate-spin text-amber-400" />,
  succeeded: <Check className="h-3 w-3 text-green-400" />,
  failed: <AlertTriangle className="h-3 w-3 text-destructive" />,
  canceled: <XCircle className="h-3 w-3 text-muted-foreground" />,
};

export default function ClipCandidatesStudio() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const blueprintId = searchParams.get('runId') || searchParams.get('blueprintId') || undefined;
  const [expandedBeats, setExpandedBeats] = useState<Set<number>>(new Set());
  const [isProcessing] = useState(false); // kept for compat, driven by processQueue.isPending
  const [providerVeo, setProviderVeo] = useState(true);
  const [providerRunway, setProviderRunway] = useState(false);

  const enabledProviders = useMemo(() => {
    const p: string[] = [];
    if (providerVeo) p.push('veo');
    if (providerRunway) p.push('runway');
    return p;
  }, [providerVeo, providerRunway]);

  // Queries
  const { data: bpListData } = useBlueprints(projectId);
  const { data: bpData } = useBlueprint(projectId, blueprintId);
  const { data: progressData } = useClipProgress(projectId, blueprintId);
  const hasPollingJobs = (progressData?.counts?.polling || 0) > 0 || (progressData?.counts?.running || 0) > 0;
  useClipPolling(projectId, blueprintId, hasPollingJobs);
  const { data: clipsData } = useClipsList(projectId, blueprintId);

  // Mutations
  const { enqueueForRun, processQueue, retryJob, selectClip, cancelAll, resetFailed } = useClipEngineMutations(projectId);

  const blueprints = (bpListData?.blueprints || []).filter((bp: any) => bp.status === 'complete');
  const blueprint = bpData?.blueprint || null;
  const beats: EDLBeat[] = blueprint?.edl || [];
  const clips: TrailerClip[] = clipsData?.clips || [];
  const progress = progressData || null;
  const counts = progress?.counts || { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, total: 0 };
  const totalDone = counts.succeeded + counts.failed + counts.canceled;
  const progressPct = counts.total > 0 ? (totalDone / counts.total) * 100 : 0;
  const isTerminal = counts.total > 0 && counts.queued === 0 && counts.running === 0;
  const terminalTitle = counts.failed > 0 ? 'Failed' : counts.canceled === counts.total ? 'Stopped' : 'Complete';

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
    if (enabledProviders.length === 0) {
      toast.error('Enable at least one AI provider');
      return;
    }
    enqueueForRun.mutate({ blueprintId, force, enabledProviders });
  };

  const handleProcessAll = async () => {
    if (!blueprintId || !projectId) return;
    try {
      await processQueue.mutateAsync({ blueprintId, maxJobs: 50 });
    } catch {
      // error toast handled by mutation
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
          {blueprintId && (
            <Link to={`/projects/${projectId}/trailer-assemble?blueprintId=${blueprintId}`}>
              <Button variant="outline" size="sm" className="text-xs ml-2">
                <Film className="h-3 w-3 mr-1" /> Timeline Studio
              </Button>
            </Link>
          )}
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-3 space-y-4 lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto lg:pr-1">
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

          {/* AI Provider Toggles */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" />
                AI Providers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-500" />
                  <Label htmlFor="toggle-veo" className="text-xs font-medium">Google Veo</Label>
                </div>
                <Switch id="toggle-veo" checked={providerVeo} onCheckedChange={setProviderVeo} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <Label htmlFor="toggle-runway" className="text-xs font-medium">Runway</Label>
                </div>
                <Switch id="toggle-runway" checked={providerRunway} onCheckedChange={setProviderRunway} />
              </div>
              {enabledProviders.length === 0 && (
                <p className="text-[10px] text-destructive">Enable at least one provider</p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Disabled providers will be rerouted to the first enabled one.
              </p>
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

                <Separator />

                {/* Stop & Reset controls */}
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="destructive" className="flex-1"
                    onClick={() => blueprintId && cancelAll.mutate(blueprintId)}
                    disabled={cancelAll.isPending || (counts.queued === 0 && counts.running === 0)}
                  >
                    {cancelAll.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Square className="h-3 w-3 mr-1" />}
                    Stop All
                  </Button>
                  <Button
                    size="sm" variant="outline" className="flex-1"
                    onClick={() => blueprintId && resetFailed.mutate(blueprintId)}
                    disabled={resetFailed.isPending || counts.failed === 0}
                  >
                    {resetFailed.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                    Reset Failed ({counts.failed})
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Progress */}
          {blueprintId && counts.total > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Progress
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <StagedProgressBar
                  title={isTerminal ? terminalTitle : counts.running > 0 ? 'Processing Clips' : counts.queued > 0 ? 'Clips Queued' : 'Clip Generation'}
                  stages={['Enqueueing jobs', 'Processing queue', 'AI generation', 'Uploading clips', 'Done']}
                  currentStageIndex={
                    isTerminal ? 4 :
                    counts.running > 0 ? 2 :
                    counts.queued > 0 ? 1 : 0
                  }
                  progressPercent={isTerminal ? 100 : progressPct}
                  etaSeconds={isTerminal ? undefined : (counts.running > 0 || counts.queued > 0 ? (counts.queued + counts.running) * 8 : undefined)}
                  detailMessage={`${counts.succeeded} succeeded · ${counts.running} running · ${counts.queued} queued · ${counts.failed} failed · ${(clipsData?.clips || []).length} clips produced`}
                />
              </CardContent>
            </Card>
          )}

          {/* Enqueue progress */}
          {enqueueForRun.isPending && (
            <StagedProgressBar
              title="Enqueueing Clip Jobs"
              stages={['Reading blueprint beats', 'Building job specs', 'Inserting into queue']}
              currentStageIndex={1}
              progressPercent={0}
              etaSeconds={5}
              detailMessage="Creating clip generation jobs for each beat…"
            />
          )}

          {/* Processing progress */}
          {(isProcessing || processQueue.isPending) && (
            <StagedProgressBar
              title="Processing Clip Queue"
              stages={['Claiming jobs', 'Calling AI providers', 'Downloading video', 'Uploading to storage', 'Recording metadata']}
              currentStageIndex={1}
              progressPercent={0}
              etaSeconds={counts.queued * 8}
              detailMessage={`Processing up to 50 jobs via AI providers…`}
            />
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
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="space-y-2 pr-3">
                    {beats.map((beat, idx) => {
                      const beatClips = clipsByBeat[idx] || [];
                      const beatProgress = progress?.beatSummary?.[idx];
                      const selectedClipId = beatProgress?.selectedClipId || beatClips.find((c: any) => c.selected)?.id;
                      const isExpanded = expandedBeats.has(idx);
                      const hint = beat.generator_hint;
                      const jobStatuses = beatProgress?.jobs || [];
                      const hasRunning = jobStatuses.some((j: any) => j.status === 'running');
                      const hasFailed = jobStatuses.some((j: any) => j.status === 'failed');

                      return (
                        <div key={idx} className="border border-border rounded-lg overflow-hidden">
                          {/* Beat header row */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleBeat(idx)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleBeat(idx); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}

                              <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{idx}</span>

                              <Badge className={`text-[10px] shrink-0 ${ROLE_COLORS[beat.role] || 'bg-muted text-muted-foreground'}`}>
                                {beat.role}
                              </Badge>

                              <span className="text-xs font-mono shrink-0">{beat.duration_s}s</span>

                              {hint && (
                                <>
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] px-1.5 py-0 shrink-0 ${
                                      hint.preferred_provider === 'runway'
                                        ? 'border-rose-500/50 text-rose-400'
                                        : 'border-sky-500/50 text-sky-400'
                                    }`}
                                  >
                                    {hint.preferred_provider === 'runway' ? 'RUNWAY' : 'VEO'}
                                  </Badge>
                                  {hint.candidates > 1 && (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-amber-500/50 text-amber-400">
                                      ×{hint.candidates}
                                    </Badge>
                                  )}
                                </>
                              )}

                              {hasRunning && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                              {hasFailed && <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}

                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {beatClips.length} clip{beatClips.length !== 1 ? 's' : ''}
                              </Badge>

                              {selectedClipId && <Check className="h-3 w-3 text-green-400 shrink-0" />}

                              <div className="ml-auto shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-[10px] h-6 px-2"
                                  disabled={enqueueForRun.isPending || processQueue.isPending}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    if (!blueprintId) return;
                                    if (enabledProviders.length === 0) {
                                      toast.error('Enable at least one AI provider');
                                      return;
                                    }
                                    try {
                                      toast.info(`Generating clips for beat #${idx}…`);
                                      await enqueueForRun.mutateAsync({ blueprintId, force: true, enabledProviders, beatIndices: [idx] });
                                      await processQueue.mutateAsync({ blueprintId, maxJobs: 5 });
                                    } catch (err: any) {
                                      toast.error(err?.message || 'Generation failed');
                                    }
                                  }}
                                >
                                  <Zap className="h-2.5 w-2.5 mr-0.5" /> Generate
                                </Button>
                              </div>
                            </div>

                            {/* Action description on its own line so it's never cropped */}
                            {beat.clip_spec?.action_description && (
                              <p className="text-[11px] text-muted-foreground mt-1.5 ml-6 leading-relaxed">
                                {beat.clip_spec.action_description}
                              </p>
                            )}
                          </div>

                          {isExpanded && (
                            <div className="px-3 pb-3 pt-2 space-y-3 border-t border-border bg-muted/10">
                              {/* Beat details */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                                <div><span className="text-muted-foreground font-medium">Shot:</span> {beat.clip_spec?.shot_type}</div>
                                <div><span className="text-muted-foreground font-medium">Camera:</span> {beat.clip_spec?.camera_move}</div>
                                <div className="sm:col-span-2"><span className="text-muted-foreground font-medium">Prompt:</span> <span className="break-words">{beat.clip_spec?.visual_prompt}</span></div>
                                <div className="sm:col-span-2"><span className="text-muted-foreground font-medium">Audio:</span> <span className="break-words">{beat.clip_spec?.audio_cue}</span></div>
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
                                          {clip.public_url && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="text-[10px] h-6 px-2"
                                              asChild
                                            >
                                              <a href={clip.public_url} download={`clip-beat${clip.beat_index}-${clip.candidate_index || 1}.mp4`} target="_blank" rel="noopener noreferrer">
                                                <Download className="h-2.5 w-2.5" />
                                              </a>
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
                                  {(() => {
                                    const fullJobs = progress?.beatSummary?.[idx]?.jobs || [];
                                    const failedJobs = fullJobs.filter((fj: any) => fj.status === 'failed');
                                    return failedJobs.map((j: any, i: number) => (
                                      <Button
                                        key={j.id || i}
                                        size="sm"
                                        variant="ghost"
                                        className="text-[10px] h-5 text-destructive"
                                        disabled={retryJob.isPending}
                                        onClick={async () => {
                                          if (!j.id) {
                                            toast.error('No job ID available');
                                            return;
                                          }
                                          try {
                                            await retryJob.mutateAsync(j.id);
                                            await processQueue.mutateAsync({ blueprintId: blueprintId!, maxJobs: 1 });
                                          } catch {}
                                        }}
                                      >
                                        <RefreshCw className="h-2.5 w-2.5 mr-0.5" /> Retry {j.provider} #{j.candidate_index}
                                      </Button>
                                    ));
                                  })()}
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
