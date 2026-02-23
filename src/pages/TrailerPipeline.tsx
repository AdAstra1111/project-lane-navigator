/**
 * Trailer Pipeline v2 — Quality-first trailer production page
 */
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Film, Layers, Play, Square, Loader2, Star, Check, Download, RefreshCw, Music, Volume2, Type, Clapperboard, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import {
  useArcTemplates,
  useBlueprints,
  useBlueprint,
  useBlueprintMutations,
  useClips,
  useClipMutations,
  useCuts,
  useCutMutations,
  useTimeline,
} from '@/lib/trailerPipeline/useTrailerPipeline';
import { useStoryboardRuns } from '@/lib/storyboard/useStoryboard';
import { renderTrailerCut } from '@/lib/trailerPipeline/renderTrailerCut';
import { toast } from 'sonner';
import type { TrailerBlueprint, TrailerClip, EDLBeat, ClipProvider, GeneratorHint } from '@/lib/trailerPipeline/types';

const PROVIDER_LABELS: Record<string, string> = {
  stub: 'Placeholder',
  elevenlabs_sfx: 'ElevenLabs SFX',
  elevenlabs_music: 'ElevenLabs Music',
  gateway_i2v: 'AI Image Gen',
};

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

export default function TrailerPipelinePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>();
  const [arcType, setArcType] = useState('main');
  const [clipProvider, setClipProvider] = useState<ClipProvider>('gateway_i2v');
  const [selectedCutId, setSelectedCutId] = useState<string>();
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [expandedBeats, setExpandedBeats] = useState<Set<number>>(new Set());

  // Data queries
  const { data: templatesData } = useArcTemplates();
  const { data: runsData } = useStoryboardRuns(projectId);
  const { data: bpListData } = useBlueprints(projectId);
  const { data: bpData } = useBlueprint(projectId, selectedBlueprintId);
  const { data: clipsData } = useClips(projectId, selectedBlueprintId);
  const { data: cutsData } = useCuts(projectId, selectedBlueprintId);
  const { data: timelineData } = useTimeline(projectId, selectedBlueprintId);

  // Mutations
  const { createBlueprint } = useBlueprintMutations(projectId);
  const { generateClips, selectClip } = useClipMutations(projectId);
  const { createCut, setCutStatus } = useCutMutations(projectId);

  const templates = templatesData?.templates || {};
  const runs = runsData?.runs || [];
  const blueprints = bpListData?.blueprints || [];
  const blueprint: TrailerBlueprint | null = bpData?.blueprint || null;
  const clips: TrailerClip[] = clipsData?.clips || [];
  const cuts = cutsData?.cuts || [];
  const beats = timelineData?.beats || [];

  const selectedRun = runs.length > 0 ? runs[0] : null;

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
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCreateBlueprint = () => {
    createBlueprint.mutate({
      storyboardRunId: selectedRun?.id,
      arcType,
    });
  };

  const handleGenerateAllClips = () => {
    if (!selectedBlueprintId) return;
    generateClips.mutate({
      blueprintId: selectedBlueprintId,
      provider: clipProvider,
      candidateCount: 1,
    });
  };

  const handleGenerateBeatClips = (beatIndex: number) => {
    if (!selectedBlueprintId) return;
    generateClips.mutate({
      blueprintId: selectedBlueprintId,
      provider: clipProvider,
      beatIndices: [beatIndex],
      candidateCount: 2,
    });
  };

  const handleCreateCut = () => {
    if (!selectedBlueprintId) return;
    createCut.mutate({ blueprintId: selectedBlueprintId });
  };

  const handleRenderCut = async (cutId: string, timeline: any[]) => {
    setIsRendering(true);
    setRenderProgress({ done: 0, total: timeline.length });

    try {
      await setCutStatus.mutateAsync({ cutId, status: 'rendering' });

      const blob = await renderTrailerCut(timeline, {
        width: 1280,
        height: 720,
        fps: 24,
        onProgress: (done, total) => setRenderProgress({ done, total }),
      });

      await setCutStatus.mutateAsync({ cutId, status: 'uploading' });

      const storagePath = `${projectId}/trailer-cuts/${selectedBlueprintId}/${cutId}.webm`;
      const { error: uploadErr } = await supabase.storage.from('storyboards').upload(storagePath, blob, {
        contentType: 'video/webm',
        upsert: true,
      });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      const { data: pubData } = supabase.storage.from('storyboards').getPublicUrl(storagePath);
      const publicUrl = pubData?.publicUrl || '';

      await setCutStatus.mutateAsync({ cutId, status: 'complete', storagePath, publicUrl });
      toast.success('Trailer rendered and uploaded!');
    } catch (err: any) {
      await setCutStatus.mutateAsync({ cutId, status: 'failed', error: err.message });
      toast.error(err.message);
    } finally {
      setIsRendering(false);
      setRenderProgress(null);
    }
  };

  const handleDownloadEDL = (cut: any) => {
    if (!cut?.edl_export) return;
    const blob = new Blob([JSON.stringify(cut.edl_export, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailer-edl-${cut.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('EDL downloaded');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={`/projects/${projectId}/storyboard-pipeline`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Film className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Trailer Pipeline</h1>
          <Badge variant="outline" className="text-[10px]">v2</Badge>
          {selectedBlueprintId && (
            <Link to={`/projects/${projectId}/trailer-clips?blueprintId=${selectedBlueprintId}`}>
              <Button variant="outline" size="sm" className="text-xs ml-2">
                <Clapperboard className="h-3 w-3 mr-1" />
                Clip Studio
              </Button>
            </Link>
          )}
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Blueprint Controls */}
        <div className="lg:col-span-3 space-y-4">
          {/* Create Blueprint */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clapperboard className="h-4 w-4" />
                Blueprint
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={arcType} onValueChange={setArcType}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(templates).map(([key, tmpl]: [string, any]) => (
                    <SelectItem key={key} value={key}>
                      {tmpl.name} ({tmpl.target_duration_s}s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedRun && (
                <p className="text-[10px] text-muted-foreground">
                  Using storyboard run {selectedRun.id.slice(0, 8)} ({selectedRun.unit_keys?.length || 0} units)
                </p>
              )}

              <Button
                size="sm"
                className="w-full"
                onClick={handleCreateBlueprint}
                disabled={createBlueprint.isPending}
              >
                {createBlueprint.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Layers className="h-3 w-3 mr-1" />}
                Generate Blueprint
              </Button>
            </CardContent>
          </Card>

          {/* Blueprint List */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Blueprints</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                {blueprints.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No blueprints yet</p>
                ) : (
                  <div className="space-y-1">
                    {blueprints.map((bp: any) => (
                      <button
                        key={bp.id}
                        onClick={() => setSelectedBlueprintId(bp.id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                          selectedBlueprintId === bp.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{bp.id.slice(0, 8)}</span>
                          <Badge variant={bp.status === 'complete' ? 'default' : bp.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {bp.status}
                          </Badge>
                        </div>
                        <div className="text-muted-foreground">
                          {bp.arc_type} · {(bp.edl || []).length} beats
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Clip Generation */}
          {selectedBlueprintId && blueprint?.status === 'complete' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  Clip Generator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Select value={clipProvider} onValueChange={(v) => setClipProvider(v as ClipProvider)}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gateway_i2v">AI Image Gen</SelectItem>
                    <SelectItem value="elevenlabs_sfx">ElevenLabs SFX</SelectItem>
                    <SelectItem value="elevenlabs_music">ElevenLabs Music</SelectItem>
                    <SelectItem value="stub">Placeholder</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleGenerateAllClips}
                  disabled={generateClips.isPending}
                >
                  {generateClips.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Generate All Clips
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Assembly */}
          {selectedBlueprintId && clips.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Film className="h-4 w-4" />
                  Assembler
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleCreateCut}
                  disabled={createCut.isPending}
                >
                  {createCut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Film className="h-3 w-3 mr-1" />}
                  Assemble Cut
                </Button>

                {cuts.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-[10px] text-muted-foreground">Cuts:</p>
                    {cuts.map((cut: any) => (
                      <div key={cut.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                        <Badge variant={
                          cut.status === 'complete' ? 'default' :
                          cut.status === 'failed' ? 'destructive' :
                          cut.status === 'rendering' ? 'secondary' : 'outline'
                        } className="text-[10px]">{cut.status}</Badge>
                        <span className="text-muted-foreground/60">{Math.round((cut.duration_ms || 0) / 1000)}s</span>

                        {cut.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] ml-auto"
                            disabled={isRendering}
                            onClick={() => {
                              setSelectedCutId(cut.id);
                              handleRenderCut(cut.id, cut.timeline);
                            }}
                          >
                            <Play className="h-3 w-3 mr-0.5" /> Render
                          </Button>
                        )}

                        {cut.status === 'complete' && cut.public_url && (
                          <a href={cut.public_url} target="_blank" rel="noopener noreferrer" className="ml-auto">
                            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]">
                              <ExternalLink className="h-3 w-3 mr-0.5" /> Open
                            </Button>
                          </a>
                        )}

                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px]"
                          onClick={() => handleDownloadEDL(cut)}
                        >
                          <Download className="h-3 w-3 mr-0.5" /> EDL
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {isRendering && renderProgress && (
                  <div className="space-y-1 mt-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="default" className="text-[10px] animate-pulse">Rendering</Badge>
                      <span className="text-muted-foreground">{renderProgress.done}/{renderProgress.total}</span>
                    </div>
                    <Progress value={renderProgress.total > 0 ? (renderProgress.done / renderProgress.total) * 100 : 0} className="h-2" />
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT: EDL / Beat Timeline */}
        <div className="lg:col-span-9 space-y-4">
          {!selectedBlueprintId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                <Clapperboard className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Create or select a blueprint to view the editorial timeline
              </CardContent>
            </Card>
          ) : blueprint?.status === 'generating' ? (
            <Card>
              <CardContent className="py-12 text-center text-sm">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                Generating editorial blueprint…
              </CardContent>
            </Card>
          ) : blueprint?.status === 'failed' ? (
            <Card>
              <CardContent className="py-8 text-center text-destructive text-sm">
                Blueprint failed: {blueprint.error}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Rhythm Analysis */}
              {blueprint?.rhythm_analysis && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Rhythm Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-muted/30 rounded p-2">
                        <div className="text-muted-foreground">Avg Duration</div>
                        <div className="font-mono text-lg">{blueprint.rhythm_analysis.avg_beat_duration_s?.toFixed(1)}s</div>
                      </div>
                      <div className="bg-muted/30 rounded p-2">
                        <div className="text-muted-foreground">Cut Density</div>
                        <div className="font-mono text-lg capitalize">{blueprint.rhythm_analysis.cut_density}</div>
                      </div>
                      <div className="bg-muted/30 rounded p-2">
                        <div className="text-muted-foreground">Location Variety</div>
                        <div className="font-mono text-lg">{((blueprint.rhythm_analysis.location_variety_score || 0) * 100).toFixed(0)}%</div>
                      </div>
                      <div className="bg-muted/30 rounded p-2">
                        <div className="text-muted-foreground">Shot Variety</div>
                        <div className="font-mono text-lg">{((blueprint.rhythm_analysis.shot_size_variety_score || 0) * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                    {blueprint.rhythm_analysis.warnings?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {blueprint.rhythm_analysis.warnings.map((w: string, i: number) => (
                          <p key={i} className="text-[10px] text-amber-400">⚠ {w}</p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Audio Plan Summary */}
              {blueprint?.audio_plan && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Music className="h-4 w-4" />
                      Audio Plan
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground mb-1 flex items-center gap-1"><Music className="h-3 w-3" /> Music Cues</p>
                        {(blueprint.audio_plan.music_cues || []).map((mc: any, i: number) => (
                          <p key={i} className="text-[10px] bg-muted/20 rounded px-2 py-1 mb-0.5">
                            Beats {mc.beat_range?.join('–')} · {mc.description} · {mc.energy}
                          </p>
                        ))}
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1 flex items-center gap-1"><Volume2 className="h-3 w-3" /> SFX Cues</p>
                        {(blueprint.audio_plan.sfx_cues || []).map((sc: any, i: number) => (
                          <p key={i} className="text-[10px] bg-muted/20 rounded px-2 py-1 mb-0.5">
                            Beat {sc.beat_index} · {sc.description} · {sc.timing}
                          </p>
                        ))}
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1 flex items-center gap-1"><Type className="h-3 w-3" /> VO Lines</p>
                        {(blueprint.audio_plan.vo_lines || []).map((vo: any, i: number) => (
                          <p key={i} className="text-[10px] bg-muted/20 rounded px-2 py-1 mb-0.5">
                            Beat {vo.beat_index} · "{vo.line}" — {vo.character}
                          </p>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Video preview for selected cut */}
              {cuts.find((c: any) => c.status === 'complete' && c.public_url) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Preview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <video
                      controls
                      className="w-full rounded border border-border"
                      src={cuts.find((c: any) => c.status === 'complete')?.public_url}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Beat Timeline */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>EDL — {(blueprint?.edl || []).length} Beats</span>
                    <span className="font-mono text-muted-foreground text-xs">
                      {(blueprint?.edl || []).reduce((s: number, b: any) => s + (b.duration_s || 0), 0).toFixed(1)}s total
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {(blueprint?.edl || []).map((beat: EDLBeat, idx: number) => {
                      const beatClips = clipsByBeat[idx] || [];
                      const selectedClip = beatClips.find(c => c.used_in_cut);
                      const isExpanded = expandedBeats.has(idx);

                      return (
                        <div key={idx} className="border border-border rounded overflow-hidden">
                          <button
                            onClick={() => toggleBeat(idx)}
                            className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <Badge className={`text-[10px] ${ROLE_COLORS[beat.role] || 'bg-muted text-muted-foreground'}`}>
                              {beat.role}
                            </Badge>
                            <span className="text-xs font-mono">{beat.duration_s}s</span>
                            {beat.unit_key && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{beat.unit_key}</span>
                            )}
                            <span className="text-[10px] text-muted-foreground truncate flex-1">{beat.clip_spec?.action_description}</span>

                            {/* Provider routing badges */}
                            {beat.generator_hint && (
                              <>
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 ${
                                    beat.generator_hint.preferred_provider === 'runway'
                                      ? 'border-rose-500/50 text-rose-400'
                                      : 'border-sky-500/50 text-sky-400'
                                  }`}
                                >
                                  {beat.generator_hint.preferred_provider === 'runway' ? 'RUNWAY' : 'VEO'}
                                </Badge>
                                {beat.generator_hint.candidates > 1 && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/50 text-amber-400">
                                    ×{beat.generator_hint.candidates}
                                  </Badge>
                                )}
                              </>
                            )}

                            {beatClips.length > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {beatClips.length} clip{beatClips.length > 1 ? 's' : ''}
                              </Badge>
                            )}
                            {selectedClip && <Check className="h-3 w-3 text-green-400" />}
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border bg-muted/10">
                              <div className="grid grid-cols-2 gap-2 text-[10px]">
                                <div><span className="text-muted-foreground">Shot:</span> {beat.clip_spec?.shot_type}</div>
                                <div><span className="text-muted-foreground">Camera:</span> {beat.clip_spec?.camera_move}</div>
                                <div className="col-span-2"><span className="text-muted-foreground">Audio:</span> {beat.clip_spec?.audio_cue}</div>
                                {beat.clip_spec?.text_overlay && (
                                  <div className="col-span-2"><span className="text-muted-foreground">Text:</span> {beat.clip_spec.text_overlay}</div>
                                )}
                              </div>

                              <Separator />

                              {/* Clips for this beat */}
                              <div className="flex gap-2 flex-wrap items-center">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-[10px] h-6"
                                  disabled={generateClips.isPending}
                                  onClick={() => handleGenerateBeatClips(idx)}
                                >
                                  {generateClips.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" /> : <RefreshCw className="h-2.5 w-2.5 mr-0.5" />}
                                  Generate Clips
                                </Button>
                              </div>

                              {beatClips.length > 0 && (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {beatClips.map((clip) => (
                                    <div
                                      key={clip.id}
                                      className={`border rounded p-1.5 text-[10px] cursor-pointer transition-colors ${
                                        clip.used_in_cut ? 'border-green-500 bg-green-500/10' : 'border-border hover:border-primary/40'
                                      }`}
                                      onClick={() => {
                                        if (!clip.used_in_cut && selectedBlueprintId) {
                                          selectClip.mutate({ clipId: clip.id, blueprintId: selectedBlueprintId, beatIndex: idx });
                                        }
                                      }}
                                    >
                                      {clip.public_url && clip.media_type === 'video' && (
                                        <img src={clip.public_url} alt="" className="w-full aspect-video object-cover rounded mb-1" />
                                      )}
                                      {clip.public_url && (clip.media_type === 'music' || clip.media_type === 'sfx') && (
                                        <audio controls src={clip.public_url} className="w-full h-6 mb-1" />
                                      )}
                                      <div className="flex items-center gap-1">
                                        <Badge variant={clip.status === 'complete' || clip.status === 'selected' ? 'default' : clip.status === 'failed' ? 'destructive' : 'secondary'} className="text-[8px]">
                                          {clip.status}
                                        </Badge>
                                        <span className="text-muted-foreground">{PROVIDER_LABELS[clip.provider] || clip.provider}</span>
                                        {clip.used_in_cut && <Check className="h-2.5 w-2.5 text-green-400" />}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
