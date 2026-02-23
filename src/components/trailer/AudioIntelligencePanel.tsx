/**
 * Audio Intelligence Panel — Full AI soundtrack pipeline UI
 * Steps: Create Run → Generate Plan → Generate Music + VO → Select → Mix → Render
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Music, Mic2, Volume2, Zap, Loader2, Check, Play, Pause,
  ChevronDown, ChevronUp, RefreshCw, Download, AlertTriangle,
  Wand2, Radio, AudioLines,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  useTrailerAudioRuns,
  useTrailerAudioProgress,
  useAudioIntelligenceMutations,
} from '@/lib/trailerPipeline/audioHooks';
import {
  DEFAULT_MIX,
  VOICE_STYLES,
  VOICE_PROVIDERS,
  type TrailerAudioAsset,
  type TrailerAudioJob,
  type TrailerAudioEvent,
} from '@/lib/trailerPipeline/audioTypes';

interface Props {
  projectId: string;
  blueprintId?: string;
  cutId?: string;
}

function formatTimecode(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  planning: 'bg-blue-500/20 text-blue-300',
  generating: 'bg-amber-500/20 text-amber-300',
  mixing: 'bg-purple-500/20 text-purple-300',
  ready: 'bg-green-500/20 text-green-300',
  failed: 'bg-destructive/20 text-destructive',
  canceled: 'bg-muted text-muted-foreground',
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-amber-500/20 text-amber-300',
  succeeded: 'bg-green-500/20 text-green-300',
};

function AudioAssetCard({
  asset,
  onSelect,
  isSelecting,
}: {
  asset: TrailerAudioAsset;
  onSelect: () => void;
  isSelecting: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const publicUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/trailers/${asset.storage_path}`;

  const togglePlay = () => {
    if (!audio) {
      const a = new Audio(publicUrl);
      a.onended = () => setPlaying(false);
      a.onerror = () => setPlaying(false);
      setAudio(a);
      a.play();
      setPlaying(true);
    } else if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  };

  return (
    <div className={`border rounded p-2.5 space-y-1.5 ${asset.selected ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="text-[9px] shrink-0">
            {asset.asset_type || asset.kind}
          </Badge>
          <span className="text-xs truncate">{asset.name || asset.label}</span>
        </div>
        {asset.selected && (
          <Badge className="text-[9px] shrink-0">Selected</Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={togglePlay}>
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
        {asset.duration_ms && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTimecode(asset.duration_ms)}
          </span>
        )}
        {asset.provider && (
          <span className="text-[10px] text-muted-foreground">
            via {asset.provider}
          </span>
        )}
        {!asset.selected && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto"
            onClick={onSelect} disabled={isSelecting}>
            {isSelecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-0.5" />}
            Select
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AudioIntelligencePanel({ projectId, blueprintId, cutId }: Props) {
  // Settings state
  const [musicStyleTags, setMusicStyleTags] = useState('epic, cinematic, dark');
  const [voiceStyle, setVoiceStyle] = useState('trailer_announcer');
  const [voiceProvider, setVoiceProvider] = useState('elevenlabs');
  const [sfxTag, setSfxTag] = useState('');
  const [musicGain, setMusicGain] = useState(DEFAULT_MIX.music_gain_db);
  const [sfxGain, setSfxGain] = useState(DEFAULT_MIX.sfx_gain_db);
  const [duckingDb, setDuckingDb] = useState(DEFAULT_MIX.dialogue_duck_db);
  const [targetLufs, setTargetLufs] = useState(DEFAULT_MIX.target_lufs);
  const [showEvents, setShowEvents] = useState(false);

  // Queries
  const { data: runData } = useTrailerAudioRuns(projectId, cutId);
  const audioRun = runData?.audioRun || null;
  const audioRunId = audioRun?.id;

  const { data: progressData } = useTrailerAudioProgress(projectId, audioRunId);

  // Mutations
  const {
    createAudioRun, generatePlan, genMusic, genVo, selectSfx,
    mixAudio, selectAsset, updateMixSettings,
  } = useAudioIntelligenceMutations(projectId);

  // Derived data
  const jobs: TrailerAudioJob[] = progressData?.jobs || [];
  const assets: TrailerAudioAsset[] = progressData?.assets || [];
  const events: TrailerAudioEvent[] = progressData?.events || [];
  const summary = progressData?.summary || null;
  const warnings: string[] = progressData?.warnings || [];

  const musicAssets = useMemo(() => assets.filter((a) => a.asset_type === 'music'), [assets]);
  const voAssets = useMemo(() => assets.filter((a) => a.asset_type === 'voiceover'), [assets]);
  const sfxAssets = useMemo(() => assets.filter((a) => a.asset_type === 'sfx'), [assets]);

  const isRunning = audioRun && ['planning', 'generating', 'mixing'].includes(audioRun.status);
  const canCreateRun = !audioRun || ['ready', 'failed', 'canceled'].includes(audioRun.status);

  // Sync sliders with loaded run
  useEffect(() => {
    if (audioRun?.mix_json) {
      setMusicGain(audioRun.mix_json.music_gain_db ?? DEFAULT_MIX.music_gain_db);
      setSfxGain(audioRun.mix_json.sfx_gain_db ?? DEFAULT_MIX.sfx_gain_db);
      setDuckingDb(audioRun.mix_json.dialogue_duck_db ?? DEFAULT_MIX.dialogue_duck_db);
      setTargetLufs(audioRun.mix_json.target_lufs ?? DEFAULT_MIX.target_lufs);
    }
    if (audioRun?.inputs_json) {
      if (audioRun.inputs_json.musicStyleTags) setMusicStyleTags(audioRun.inputs_json.musicStyleTags);
      if (audioRun.inputs_json.voiceStyle) setVoiceStyle(audioRun.inputs_json.voiceStyle);
      if (audioRun.inputs_json.voiceProvider) setVoiceProvider(audioRun.inputs_json.voiceProvider);
      if (audioRun.inputs_json.sfxTag) setSfxTag(audioRun.inputs_json.sfxTag);
    }
  }, [audioRun?.id]);

  const handleCreateRun = () => {
    createAudioRun.mutate({
      blueprintRunId: blueprintId,
      trailerCutId: cutId,
      inputs: {
        musicStyleTags,
        voiceStyle,
        voiceProvider,
        sfxTag,
        targetLufs,
        musicGainDb: musicGain,
        sfxGainDb: sfxGain,
        duckingAmountDb: duckingDb,
      },
    });
  };

  const handleGeneratePlan = () => {
    if (!audioRunId) return;
    generatePlan.mutate(audioRunId);
  };

  const handleGenAll = async () => {
    if (!audioRunId) return;
    // Run gen_music, gen_vo, select_sfx sequentially for clarity
    try {
      await genMusic.mutateAsync(audioRunId);
      await genVo.mutateAsync(audioRunId);
      await selectSfx.mutateAsync(audioRunId);
    } catch {
      // errors handled by individual mutations
    }
  };

  const handleMix = () => {
    if (!audioRunId) return;
    mixAudio.mutate(audioRunId);
  };

  const handleSelectAsset = (assetId: string, assetType: string) => {
    if (!audioRunId) return;
    selectAsset.mutate({ audioRunId, assetId, assetType });
  };

  const handleUpdateMix = () => {
    if (!audioRunId) return;
    updateMixSettings.mutate({
      audioRunId,
      mixSettings: {
        music_gain_db: musicGain,
        sfx_gain_db: sfxGain,
        dialogue_duck_db: duckingDb,
        target_lufs: targetLufs,
      },
    });
  };

  const jobProgress = summary
    ? Math.round((summary.succeeded / Math.max(summary.total_jobs, 1)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Audio Intelligence Engine
            {audioRun && (
              <Badge className={`text-[9px] ml-auto ${STATUS_COLORS[audioRun.status] || ''}`}>
                {audioRun.status}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!audioRun ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Generate a complete AI soundtrack: music bed, voiceover, SFX hits, and mixed master track.
              </p>

              {/* Input controls */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Music Style Tags</Label>
                  <Input className="h-8 text-xs" placeholder="epic, dark, cinematic"
                    value={musicStyleTags} onChange={(e) => setMusicStyleTags(e.target.value)} />
                </div>
                <div>
                  <Label className="text-[10px]">SFX Pack Tag</Label>
                  <Input className="h-8 text-xs" placeholder="e.g. cinematic, horror"
                    value={sfxTag} onChange={(e) => setSfxTag(e.target.value)} />
                </div>
                <div>
                  <Label className="text-[10px]">Voice Style</Label>
                  <Select value={voiceStyle} onValueChange={setVoiceStyle}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VOICE_STYLES.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Voice Provider</Label>
                  <Select value={voiceProvider} onValueChange={setVoiceProvider}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VOICE_PROVIDERS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Mix settings */}
              <div className="space-y-3">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5" /> Mix Settings
                </p>
                <MixSlider label="Music Gain" value={musicGain} min={-30} max={0} unit="dB"
                  onChange={setMusicGain} />
                <MixSlider label="SFX Gain" value={sfxGain} min={-30} max={0} unit="dB"
                  onChange={setSfxGain} />
                <MixSlider label="VO Ducking" value={duckingDb} min={-20} max={0} unit="dB"
                  onChange={setDuckingDb} />
                <MixSlider label="Target Loudness" value={targetLufs} min={-24} max={-6} unit="LUFS"
                  onChange={setTargetLufs} />
              </div>

              <Button className="w-full gap-2" onClick={handleCreateRun}
                disabled={createAudioRun.isPending || !cutId}>
                {createAudioRun.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Wand2 className="h-4 w-4" />}
                Generate AI Soundtrack
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Progress bar */}
              {summary && !summary.all_complete && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{summary.succeeded}/{summary.total_jobs} jobs complete</span>
                    <span>{summary.running} running, {summary.queued} queued</span>
                  </div>
                  <Progress value={jobProgress} className="h-1.5" />
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-[10px] text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Error */}
              {audioRun.error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded p-2">
                  <p className="text-[10px] text-destructive">{audioRun.error}</p>
                </div>
              )}

              {/* Step buttons */}
              <div className="grid grid-cols-2 gap-2">
                <StepButton
                  icon={<Zap className="h-3 w-3" />}
                  label="Generate Plan"
                  onClick={handleGeneratePlan}
                  disabled={generatePlan.isPending}
                  loading={generatePlan.isPending}
                  done={jobs.some(j => j.job_type === 'plan' && j.status === 'succeeded')}
                />
                <StepButton
                  icon={<AudioLines className="h-3 w-3" />}
                  label="Gen Music + VO + SFX"
                  onClick={handleGenAll}
                  disabled={genMusic.isPending || genVo.isPending || selectSfx.isPending}
                  loading={genMusic.isPending || genVo.isPending || selectSfx.isPending}
                  done={
                    jobs.some(j => j.job_type === 'gen_music' && j.status === 'succeeded') &&
                    jobs.some(j => j.job_type === 'gen_vo' && j.status === 'succeeded')
                  }
                />
                <StepButton
                  icon={<Radio className="h-3 w-3" />}
                  label="Mix Master"
                  onClick={handleMix}
                  disabled={mixAudio.isPending}
                  loading={mixAudio.isPending}
                  done={audioRun.status === 'ready'}
                />
                <StepButton
                  icon={<RefreshCw className="h-3 w-3" />}
                  label="New Run"
                  onClick={handleCreateRun}
                  disabled={createAudioRun.isPending}
                  loading={createAudioRun.isPending}
                  variant="outline"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assets: Music Candidates */}
      {audioRun && musicAssets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Music className="h-4 w-4" /> Music Candidates ({musicAssets.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {musicAssets.map(asset => (
              <AudioAssetCard
                key={asset.id}
                asset={asset}
                onSelect={() => handleSelectAsset(asset.id, 'music')}
                isSelecting={selectAsset.isPending}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Assets: VO Takes */}
      {audioRun && voAssets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mic2 className="h-4 w-4" /> Voiceover Takes ({voAssets.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {voAssets.map(asset => (
              <AudioAssetCard
                key={asset.id}
                asset={asset}
                onSelect={() => handleSelectAsset(asset.id, 'voiceover')}
                isSelecting={selectAsset.isPending}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Mix Settings (when run exists) */}
      {audioRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Volume2 className="h-4 w-4" /> Mix Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <MixSlider label="Music Gain" value={musicGain} min={-30} max={0} unit="dB"
              onChange={setMusicGain} />
            <MixSlider label="SFX Gain" value={sfxGain} min={-30} max={0} unit="dB"
              onChange={setSfxGain} />
            <MixSlider label="VO Ducking" value={duckingDb} min={-20} max={0} unit="dB"
              onChange={setDuckingDb} />
            <MixSlider label="Target Loudness" value={targetLufs} min={-24} max={-6} unit="LUFS"
              onChange={setTargetLufs} />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={handleUpdateMix}
                disabled={updateMixSettings.isPending}>
                {updateMixSettings.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  : <Check className="h-3 w-3 mr-1" />}
                Save Mix
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={handleMix}
                disabled={mixAudio.isPending}>
                {mixAudio.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                Re-mix
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audio Plan Summary */}
      {audioRun?.plan_json?.sfx_hits && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Audio Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {audioRun.plan_json.music_segments?.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Music Segments</p>
                  {audioRun.plan_json.music_segments.map((seg: any, i: number) => (
                    <div key={i} className="text-xs flex items-center gap-2 py-0.5">
                      <Badge variant="outline" className="text-[9px]">🎵</Badge>
                      <span>{formatTimecode(seg.start_ms)} → {formatTimecode(seg.end_ms)}</span>
                      <span className="text-muted-foreground">{seg.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {audioRun.plan_json.sfx_hits?.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    SFX Hits ({audioRun.plan_json.sfx_hits.length})
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {audioRun.plan_json.sfx_hits.map((hit: any, i: number) => (
                      <div key={i} className="text-[10px] flex items-center gap-1.5 py-0.5">
                        <span className="font-mono">{formatTimecode(hit.timestamp_ms)}</span>
                        <Badge variant="outline" className="text-[9px]">{hit.sfx_kind}</Badge>
                        <span className="text-muted-foreground truncate">{hit.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {audioRun.plan_json.vo_lines?.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">VO Lines</p>
                  {audioRun.plan_json.vo_lines.map((vo: any, i: number) => (
                    <div key={i} className="text-xs py-0.5">
                      <span className="font-mono text-muted-foreground mr-2">
                        {formatTimecode(vo.timestamp_ms)}
                      </span>
                      <span className="font-medium">{vo.character}:</span> {vo.line}
                    </div>
                  ))}
                </div>
              )}
              {audioRun.plan_json.ducking_regions?.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    Ducking Regions ({audioRun.plan_json.ducking_regions.length})
                  </p>
                  {audioRun.plan_json.ducking_regions.map((r: any, i: number) => (
                    <div key={i} className="text-[10px] py-0.5 text-muted-foreground">
                      {formatTimecode(r.start_ms)} → {formatTimecode(r.end_ms)} ({r.duck_db} dB)
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Jobs Summary */}
      {audioRun && jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {jobs.map(job => (
                <div key={job.id} className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">{job.job_type}</Badge>
                    <Badge className={`text-[9px] ${STATUS_COLORS[job.status] || ''}`}>
                      {job.status}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    attempt {job.attempt}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Event Log (collapsible) */}
      {audioRun && events.length > 0 && (
        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowEvents(!showEvents)}>
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Audit Log ({events.length})</span>
              {showEvents ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
          {showEvents && (
            <CardContent>
              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {events.map(ev => (
                    <div key={ev.id} className="text-[10px] py-0.5 flex items-center gap-2">
                      <span className="text-muted-foreground font-mono shrink-0">
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </span>
                      <Badge variant="outline" className="text-[8px]">{ev.event_type}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Helper Components ───

function MixSlider({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[10px]">{label}</Label>
        <span className="text-[10px] font-mono text-muted-foreground">{value} {unit}</span>
      </div>
      <Slider min={min} max={max} step={1} value={[value]}
        onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function StepButton({ icon, label, onClick, disabled, loading, done, variant }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  loading?: boolean;
  done?: boolean;
  variant?: 'outline' | 'default';
}) {
  return (
    <Button
      size="sm"
      variant={variant || (done ? 'default' : 'outline')}
      className={`gap-1.5 text-xs ${done ? 'bg-green-600/20 text-green-300 border-green-600/30' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3 w-3" /> : icon}
      {label}
    </Button>
  );
}
