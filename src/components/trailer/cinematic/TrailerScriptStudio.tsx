/**
 * Trailer Script Studio — 3-panel layout for cinematic script editing
 * Left: beats list | Center: beat detail editor | Right: citations panel
 */
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Film, Loader2, Play, AlertTriangle, Check, BookOpen,
  Quote, Volume2, Zap, Wrench, Lock, ArrowRight, RefreshCw,
} from 'lucide-react';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';
import {
  useScriptRuns, useScriptBeats, useRhythmRuns, useShotDesignRuns,
  useJudgeRuns, useCinematicMutations,
} from '@/lib/trailerPipeline/cinematicHooks';
import { toast } from 'sonner';

const PHASE_COLORS: Record<string, string> = {
  hook: 'bg-red-500/20 text-red-300 border-red-500/30',
  setup: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  escalation: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  twist: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  crescendo: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  button: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const GENRE_OPTIONS = [
  { value: 'drama', label: 'Drama' },
  { value: 'thriller', label: 'Thriller' },
  { value: 'horror', label: 'Horror' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'action', label: 'Action' },
  { value: 'sci_fi', label: 'Sci-Fi' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'romance', label: 'Romance' },
];

const PLATFORM_OPTIONS = [
  { value: 'theatrical', label: 'Theatrical' },
  { value: 'streaming', label: 'Streaming' },
  { value: 'social', label: 'Social / Short-Form' },
  { value: 'broadcast', label: 'Broadcast' },
  { value: 'festival', label: 'Festival' },
];

interface TrailerScriptStudioProps {
  projectId: string;
  canonPackId: string | undefined;
}

export function TrailerScriptStudio({ projectId, canonPackId }: TrailerScriptStudioProps) {
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedBeatId, setSelectedBeatId] = useState<string>();
  const [genreKey, setGenreKey] = useState('drama');
  const [platformKey, setPlatformKey] = useState('theatrical');
  const [trailerType, setTrailerType] = useState('main');
  const [seed, setSeed] = useState('');

  // Queries
  const { data: scriptRuns, isLoading: runsLoading } = useScriptRuns(projectId);
  const { data: beats } = useScriptBeats(selectedRunId);
  const { data: rhythmRuns } = useRhythmRuns(selectedRunId);
  const { data: shotDesignRuns } = useShotDesignRuns(selectedRunId);
  const { data: judgeRuns } = useJudgeRuns(selectedRunId);

  // Mutations
  const {
    createFullPlan, createScript, createRhythmGrid,
    createShotDesign, runJudge, repairScript, startClipGeneration,
  } = useCinematicMutations(projectId);

  const activeRun = useMemo(() =>
    scriptRuns?.find((r: any) => r.id === selectedRunId) || scriptRuns?.[0],
    [scriptRuns, selectedRunId]
  );

  const activeBeat = useMemo(() =>
    beats?.find((b: any) => b.id === selectedBeatId),
    [beats, selectedBeatId]
  );

  const latestJudge = judgeRuns?.[0];
  const latestRhythm = rhythmRuns?.[0];
  const latestShotDesign = shotDesignRuns?.[0];

  // Gate checks
  const allCitationsPresent = beats?.every((b: any) => {
    const refs = b.source_refs_json || [];
    return Array.isArray(refs) && refs.length >= 1;
  }) ?? false;

  const judgePassed = latestJudge?.status === 'complete' &&
    !latestJudge?.flags?.length;

  const canGenerateClips = activeRun?.status === 'complete' &&
    allCitationsPresent && judgePassed && latestShotDesign;

  // Auto-select first run
  if (scriptRuns?.length && !selectedRunId) {
    setSelectedRunId(scriptRuns[0].id);
  }

  const handleGenerateFullPlan = () => {
    if (!canonPackId) { toast.error('No canon pack selected'); return; }
    createFullPlan.mutate({
      canonPackId,
      trailerType,
      genreKey,
      platformKey,
      seed: seed || undefined,
    }, {
      onSuccess: (data) => {
        if (data.scriptRunId) setSelectedRunId(data.scriptRunId);
      }
    });
  };

  const handleGenerateScript = () => {
    if (!canonPackId) { toast.error('No canon pack selected'); return; }
    createScript.mutate({
      canonPackId,
      trailerType,
      genreKey,
      platformKey,
      seed: seed || undefined,
    }, {
      onSuccess: (data) => {
        if (data.scriptRunId) setSelectedRunId(data.scriptRunId);
      }
    });
  };

  const isGenerating = createFullPlan.isPending || createScript.isPending;
  const isRepairing = repairScript.isPending;

  return (
    <div className="space-y-4">
      {/* Top Bar: Controls + Scores */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground">Genre</Label>
              <Select value={genreKey} onValueChange={setGenreKey}>
                <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GENRE_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground">Platform</Label>
              <Select value={platformKey} onValueChange={setPlatformKey}>
                <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground">Seed</Label>
              <Input className="h-7 w-[100px] text-xs" placeholder="optional" value={seed} onChange={e => setSeed(e.target.value)} />
            </div>

            <Separator orientation="vertical" className="h-6" />

            {activeRun && (
              <div className="flex items-center gap-3 text-xs">
                {activeRun.structure_score != null && (
                  <span className="text-muted-foreground">Structure: <span className="text-foreground font-mono">{Number(activeRun.structure_score).toFixed(2)}</span></span>
                )}
                {activeRun.cinematic_score != null && (
                  <span className="text-muted-foreground">Cinematic: <span className="text-foreground font-mono">{Number(activeRun.cinematic_score).toFixed(2)}</span></span>
                )}
                <Badge variant={activeRun.status === 'complete' ? 'default' : activeRun.status === 'needs_repair' ? 'destructive' : 'secondary'} className="text-[10px]">
                  {activeRun.status}
                </Badge>
              </div>
            )}

            {activeRun?.warnings?.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {activeRun.warnings.length} warning{activeRun.warnings.length > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleGenerateFullPlan} disabled={isGenerating || !canonPackId}>
          {createFullPlan.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
          Generate Full Plan
        </Button>
        <Button size="sm" variant="outline" onClick={handleGenerateScript} disabled={isGenerating || !canonPackId}>
          {createScript.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Film className="h-3 w-3 mr-1" />}
          Script Only
        </Button>
        {activeRun && (
          <>
            <Button size="sm" variant="outline"
              onClick={() => repairScript.mutate({ scriptRunId: activeRun.id, judgeRunId: latestJudge?.id, canonPackId })}
              disabled={isRepairing || activeRun.status !== 'needs_repair'}>
              {isRepairing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wrench className="h-3 w-3 mr-1" />}
              Repair Script
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => runJudge.mutate({ scriptRunId: activeRun.id, rhythmRunId: latestRhythm?.id, shotDesignRunId: latestShotDesign?.id })}
              disabled={runJudge.isPending}>
              {runJudge.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
              Run Judge
            </Button>
            <Button size="sm" variant={canGenerateClips ? 'default' : 'outline'}
              onClick={() => startClipGeneration.mutate({ scriptRunId: activeRun.id, shotDesignRunId: latestShotDesign!.id })}
              disabled={!canGenerateClips || startClipGeneration.isPending}>
              {startClipGeneration.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ArrowRight className="h-3 w-3 mr-1" />}
              Proceed to Clips
            </Button>
          </>
        )}
      </div>

      {/* Progress bar during generation */}
      {isGenerating && (
        <StagedProgressBar
          title="Generating Cinematic Plan"
          stages={['Canon analysis', 'Script generation', 'Rhythm grid', 'Shot design', 'Judge scoring']}
          currentStageIndex={createFullPlan.isPending ? 1 : 0}
          progressPercent={0}
          etaSeconds={45}
          detailMessage="AI is building your cinematic trailer script…"
        />
      )}

      {/* 3-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Beats List */}
        <div className="lg:col-span-3">
          <Card className="h-[calc(100vh-380px)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Beats</span>
                <span className="font-mono text-muted-foreground text-[10px]">{beats?.length || 0}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-440px)]">
                <div className="space-y-0.5 p-2">
                  {runsLoading && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}
                  {!beats?.length && !runsLoading && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      Generate a script to see beats
                    </p>
                  )}
                  {beats?.map((beat: any) => {
                    const refs = beat.source_refs_json || [];
                    const hasCitations = Array.isArray(refs) && refs.length > 0;
                    const hasSilence = (beat.silence_before_ms || 0) > 0 || (beat.silence_after_ms || 0) > 0;
                    const isSelected = selectedBeatId === beat.id;

                    return (
                      <button
                        key={beat.id}
                        onClick={() => setSelectedBeatId(beat.id)}
                        className={`w-full text-left px-2 py-2 rounded text-xs transition-colors ${
                          isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-muted-foreground text-[10px] w-4">
                            {beat.beat_index}
                          </span>
                          <Badge className={`text-[9px] px-1.5 ${PHASE_COLORS[beat.phase] || 'bg-muted text-muted-foreground'}`}>
                            {beat.phase}
                          </Badge>
                          {beat.title && (
                            <span className="truncate text-[11px]">{beat.title}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {hasCitations && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 border-green-500/40 text-green-400">
                              <BookOpen className="h-2 w-2 mr-0.5" />{refs.length}
                            </Badge>
                          )}
                          {!hasCitations && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 border-destructive/40 text-destructive">
                              <AlertTriangle className="h-2 w-2 mr-0.5" />no ref
                            </Badge>
                          )}
                          {hasSilence && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/40 text-blue-400">
                              <Volume2 className="h-2 w-2 mr-0.5" />silence
                            </Badge>
                          )}
                          {beat.trailer_moment_flag && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/40 text-amber-400">
                              <Zap className="h-2 w-2 mr-0.5" />moment
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* CENTER: Beat Detail Editor */}
        <div className="lg:col-span-5">
          <Card className="h-[calc(100vh-380px)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {activeBeat ? `Beat ${activeBeat.beat_index} — ${activeBeat.phase}` : 'Beat Detail'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!activeBeat ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Select a beat from the list
                </p>
              ) : (
                <ScrollArea className="h-[calc(100vh-460px)]">
                  <div className="space-y-4 pr-3">
                    {activeBeat.title && (
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Title</Label>
                        <p className="text-sm font-medium">{activeBeat.title}</p>
                      </div>
                    )}

                    <div>
                      <Label className="text-[10px] text-muted-foreground">Emotional Intent</Label>
                      <p className="text-sm">{activeBeat.emotional_intent}</p>
                    </div>

                    {activeBeat.quoted_dialogue && (
                      <div>
                        <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Quote className="h-3 w-3" /> Quoted Dialogue
                        </Label>
                        <p className="text-sm italic border-l-2 border-primary/30 pl-3 py-1">
                          "{activeBeat.quoted_dialogue}"
                        </p>
                      </div>
                    )}

                    {activeBeat.text_card && (
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Text Card</Label>
                        <p className="text-sm font-bold uppercase tracking-wider bg-muted/30 rounded px-3 py-2 text-center">
                          {activeBeat.text_card}
                        </p>
                      </div>
                    )}

                    {activeBeat.withholding_note && (
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Withholding Note</Label>
                        <p className="text-xs text-muted-foreground bg-muted/20 rounded px-2 py-1.5">
                          {activeBeat.withholding_note}
                        </p>
                      </div>
                    )}

                    <Separator />

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Movement Target</Label>
                        <div className="flex items-center gap-2">
                          <Slider
                            value={[activeBeat.movement_intensity_target || 5]}
                            min={1} max={10} step={1}
                            disabled
                            className="flex-1"
                          />
                          <span className="text-xs font-mono w-4 text-center">{activeBeat.movement_intensity_target}</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Shot Density</Label>
                        <p className="text-sm font-mono">{activeBeat.shot_density_target ?? '—'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Contrast Δ</Label>
                        <p className="text-sm font-mono">{activeBeat.contrast_delta_score ?? '—'}</p>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Silence Before</Label>
                        <p className="text-sm font-mono">{activeBeat.silence_before_ms}ms</p>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Silence After</Label>
                        <p className="text-sm font-mono">{activeBeat.silence_after_ms}ms</p>
                      </div>
                    </div>

                    {activeBeat.trailer_moment_flag && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                        <Zap className="h-3 w-3 mr-1" /> Trailer Moment
                      </Badge>
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Citations Panel */}
        <div className="lg:col-span-4">
          <Card className="h-[calc(100vh-380px)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Citations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!activeBeat ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Select a beat to view citations
                </p>
              ) : (
                <ScrollArea className="h-[calc(100vh-460px)]">
                  <div className="space-y-3 pr-3">
                    {(() => {
                      const refs = activeBeat.source_refs_json || [];
                      if (!Array.isArray(refs) || refs.length === 0) {
                        return (
                          <div className="text-center py-6">
                            <AlertTriangle className="h-6 w-6 mx-auto text-destructive/50 mb-2" />
                            <p className="text-xs text-destructive">No citations — required for judge gate</p>
                          </div>
                        );
                      }
                      return refs.map((ref: any, idx: number) => (
                        <div key={idx} className="border border-border rounded-lg p-3 space-y-1.5">
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="outline" className="text-[9px]">
                              {ref.doc_type || ref.type || 'source'}
                            </Badge>
                            {ref.version && (
                              <span className="text-muted-foreground font-mono text-[10px]">v{ref.version}</span>
                            )}
                            {ref.doc_id && (
                              <span className="text-muted-foreground font-mono text-[10px]">{String(ref.doc_id).slice(0, 8)}</span>
                            )}
                          </div>
                          {ref.excerpt && (
                            <p className="text-xs border-l-2 border-muted-foreground/30 pl-2 text-muted-foreground italic">
                              "{ref.excerpt}"
                            </p>
                          )}
                          {ref.quote && (
                            <p className="text-xs border-l-2 border-primary/30 pl-2 italic">
                              "{ref.quote}"
                            </p>
                          )}
                          {ref.scene_id && (
                            <p className="text-[10px] text-muted-foreground">Scene: {String(ref.scene_id).slice(0, 8)}</p>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Judge Results */}
      {latestJudge && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Check className="h-4 w-4" /> Judge Results
              <Badge variant={judgePassed ? 'default' : 'destructive'} className="text-[10px]">
                {judgePassed ? 'PASSED' : 'FLAGGED'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-xs">
              {Object.entries(latestJudge.scores_json || {}).map(([key, val]: [string, any]) => (
                <div key={key} className="text-center">
                  <p className="text-muted-foreground text-[10px]">{key.replace(/_/g, ' ')}</p>
                  <p className="font-mono text-sm">{typeof val === 'number' ? val.toFixed(2) : String(val)}</p>
                </div>
              ))}
            </div>
            {latestJudge.flags?.length > 0 && (
              <div className="mt-3 space-y-1">
                {latestJudge.flags.map((flag: string, i: number) => (
                  <p key={i} className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {flag}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
