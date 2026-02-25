/**
 * Trailer Script Studio — 3-panel layout for cinematic script editing
 * Left: beats list | Center: beat detail editor | Right: citations panel
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { LookBiblePanel, LookBibleSummaryPills } from './LookBiblePanel';
import { CrescendoMontagePanel } from './CrescendoMontagePanel';
import { Badge } from '@/components/ui/badge';
import { GateChecklist } from './GateChecklist';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import {
  Film, Loader2, Play, AlertTriangle, Check, BookOpen,
  Quote, Volume2, Zap, Wrench, Lock, ArrowRight, RefreshCw,
  Settings2, ChevronDown, Plus, Trash2, Sparkles, Shield,
  Layers, Star, CheckCircle2, ExternalLink, FileText,
} from 'lucide-react';
import { StagedProgressBar } from '@/components/system/StagedProgressBar';
import { warningActionFor } from '@/lib/warningActions';
import { dedupeWarningsStable } from '@/lib/warningUtils';
import { buildWarningsReport, copyTextToClipboard } from '@/lib/warningsReport';
import {
  useScriptRuns, useScriptBeats, useRhythmRuns, useShotDesignRuns,
  useJudgeRuns, useCinematicMutations,
} from '@/lib/trailerPipeline/cinematicHooks';
import type { TrailerStyleOptions } from '@/lib/trailerPipeline/cinematicApi';
import { toast } from 'sonner';

const PHASE_COLORS: Record<string, string> = {
  hook: 'bg-red-500/20 text-red-300 border-red-500/30',
  setup: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  escalation: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  twist: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  crescendo: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  button: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const TRAILER_TYPE_OPTIONS = [
  { value: 'teaser', label: 'Teaser' },
  { value: 'main', label: 'Main' },
  { value: 'character', label: 'Character' },
  { value: 'tone', label: 'Tone' },
  { value: 'sales', label: 'Sales' },
];

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
  { value: 'streamer_hero', label: 'Streamer Hero' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube_preroll', label: 'YouTube Pre-roll' },
  { value: 'festival_cut', label: 'Festival Cut' },
];

const TONE_PRESETS = [
  { value: 'a24', label: 'A24' },
  { value: 'prestige_dark', label: 'Prestige Dark' },
  { value: 'blockbuster', label: 'Blockbuster' },
  { value: 'comedy_pop', label: 'Comedy Pop' },
  { value: 'horror_dread', label: 'Horror Dread' },
  { value: 'romance_warm', label: 'Romance Warm' },
  { value: 'thriller_taut', label: 'Thriller Taut' },
];

const PACING_PROFILES = [
  { value: 'slow_burn_spike', label: 'Slow Burn → Spike' },
  { value: 'steady_escalation', label: 'Steady Escalation' },
  { value: 'fast_dense', label: 'Fast & Dense' },
  { value: 'silence_heavy', label: 'Silence Heavy' },
  { value: 'dialogue_forward', label: 'Dialogue Forward' },
  { value: 'music_forward', label: 'Music Forward' },
];

const REVEAL_STRATEGIES = [
  { value: 'withhold_twist', label: 'Withhold Twist' },
  { value: 'hint_twist', label: 'Hint Twist' },
  { value: 'show_twist_spoiler', label: 'Show Twist (Spoiler)' },
  { value: 'no_third_act', label: 'No Third Act' },
];

const CAMERA_STYLES = [
  { value: 'measured', label: 'Measured' },
  { value: 'kinetic', label: 'Kinetic' },
  { value: 'handheld', label: 'Handheld' },
  { value: 'floating', label: 'Floating' },
  { value: 'whip_heavy', label: 'Whip Heavy' },
];

const LENS_BIASES = [
  { value: 'wide', label: 'Wide' },
  { value: 'normal', label: 'Normal' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'mixed', label: 'Mixed' },
];

const MONTAGE_INTENSITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const DROP_STYLES = [
  { value: 'hard_drop', label: 'Hard Drop' },
  { value: 'delayed_drop', label: 'Delayed Drop' },
  { value: 'false_drop', label: 'False Drop' },
];

const SFX_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// Compact select for options panel
function MiniSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// Style options summary pills
function StyleOptionsPills({ opts }: { opts: TrailerStyleOptions }) {
  const pills: string[] = [];
  if (opts.tonePreset) pills.push(opts.tonePreset.replace(/_/g, ' '));
  if (opts.pacingProfile) pills.push(opts.pacingProfile.replace(/_/g, ' '));
  if (opts.revealStrategy) pills.push(opts.revealStrategy.replace(/_/g, ' '));
  if (opts.cameraStyle) pills.push(opts.cameraStyle);
  if (opts.microMontageIntensity) pills.push(`montage:${opts.microMontageIntensity}`);
  if (opts.dropStyle) pills.push(opts.dropStyle.replace(/_/g, ' '));
  if (opts.movementOverall != null) pills.push(`mov:${opts.movementOverall}`);
  if (opts.strictCanonMode) pills.push(`canon:${opts.strictCanonMode}`);
  if (opts.targetLengthMs) pills.push(`${Math.round(opts.targetLengthMs / 1000)}s`);
  if (opts.inspirationRefs?.length) pills.push(`${opts.inspirationRefs.length} inspo`);

  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {pills.map((p, i) => (
        <Badge key={i} variant="outline" className="text-[8px] px-1.5 py-0 font-normal">{p}</Badge>
      ))}
    </div>
  );
}

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
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Style options state
  const [tonePreset, setTonePreset] = useState('a24');
  const [pacingProfile, setPacingProfile] = useState('steady_escalation');
  const [revealStrategy, setRevealStrategy] = useState('withhold_twist');
  const [movementOverall, setMovementOverall] = useState(6);
  const [cameraStyle, setCameraStyle] = useState('measured');
  const [lensBias, setLensBias] = useState('mixed');
  const [microMontageIntensity, setMicroMontageIntensity] = useState('medium');
  const [dropStyle, setDropStyle] = useState('hard_drop');
  const [minSilenceWindows, setMinSilenceWindows] = useState(2);
  const [sfxEmphasis, setSfxEmphasis] = useState('medium');

  // New fields
  const [strictCanonMode, setStrictCanonMode] = useState<'strict' | 'balanced'>('balanced');
  const [targetLengthSeconds, setTargetLengthSeconds] = useState<string>('');
  const [referenceNotes, setReferenceNotes] = useState('');
  const [avoidNotes, setAvoidNotes] = useState('');
  const [inspirationTrailers, setInspirationTrailers] = useState<{ title: string; url?: string; notes?: string }[]>([]);
  const [fullPlanStage, setFullPlanStage] = useState(0);

  const styleOptions: TrailerStyleOptions = {
    tonePreset, pacingProfile, revealStrategy, movementOverall,
    cameraStyle, lensBias, microMontageIntensity, dropStyle,
    minSilenceWindows, sfxEmphasis, strictCanonMode,
    targetLengthMs: targetLengthSeconds ? Math.round(Number(targetLengthSeconds) * 1000) : undefined,
    referenceNotes: referenceNotes || undefined,
    avoidNotes: avoidNotes || undefined,
    inspirationRefs: inspirationTrailers.length > 0 ? inspirationTrailers : undefined,
  };

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
    exportTrailerScriptDocument, createScriptVariants, selectScriptRun, regenerateCrescendoMontage,
    runTrailerPipeline,
  } = useCinematicMutations(projectId);

  const [showVariantsPanel, setShowVariantsPanel] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<{ step: string; status: string; id?: string; error?: string }[] | null>(null);

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

  // Gate checks from persisted gates_json
  const scriptGates = activeRun?.gates_json as { passed: boolean; failures: string[] } | null | undefined;
  const shotDesignGates = latestShotDesign?.gates_json as { passed: boolean; failures: string[] } | null | undefined;
  const judgeScores = latestJudge?.scores_json as Record<string, number> | null | undefined;

  const allCitationsPresent = beats?.every((b: any) => {
    const refs = b.source_refs_json || [];
    return Array.isArray(refs) && refs.length >= 1;
  }) ?? false;

  const judgePassed = latestJudge?.status === 'complete' &&
    !latestJudge?.flags?.length;

  // Gate-aware proceed logic: script gates + judge must pass
  const scriptGatesPassed = scriptGates?.passed ?? true;
  const shotGatesPassed = shotDesignGates?.passed ?? true;
  const canGenerateClips = activeRun?.status === 'complete' &&
    allCitationsPresent && judgePassed && latestShotDesign &&
    scriptGatesPassed;

  // (auto-select moved below selectedRun declaration)

  const extraPayload = {
    inspirationRefs: inspirationTrailers.length > 0 ? inspirationTrailers : undefined,
    referenceNotes: referenceNotes || undefined,
    avoidNotes: avoidNotes || undefined,
    strictCanonMode,
    targetLengthMs: targetLengthSeconds ? Math.round(Number(targetLengthSeconds) * 1000) : undefined,
  };

  const handleGenerateFullPlan = () => {
    if (!canonPackId) { toast.error('No canon pack selected'); return; }
    setFullPlanStage(0);
    createFullPlan.mutate({
      canonPackId, trailerType, genreKey, platformKey,
      seed: seed || undefined, styleOptions, ...extraPayload,
      onStageChange: setFullPlanStage,
    }, {
      onSuccess: (data) => {
        if (data.scriptRunId) setSelectedRunId(data.scriptRunId);
      }
    });
  };

  const handleGenerateScript = () => {
    if (!canonPackId) { toast.error('No canon pack selected'); return; }
    createScript.mutate({
      canonPackId, trailerType, genreKey, platformKey,
      seed: seed || undefined, styleOptions, ...extraPayload,
    }, {
      onSuccess: (data) => {
        if (data.scriptRunId) setSelectedRunId(data.scriptRunId);
      }
    });
  };

  const isGenerating = createFullPlan.isPending || createScript.isPending || createScriptVariants.isPending || runTrailerPipeline.isPending;
  const isRepairing = repairScript.isPending;

  const handleGenerateVariants = useCallback(() => {
    if (!canonPackId) { toast.error('No canon pack selected'); return; }
    createScriptVariants.mutate({
      canonPackId, trailerType, genreKey, platformKey,
      styleOptions, ...extraPayload,
      variants: ['A', 'B', 'C'],
    }, {
      onSuccess: () => setShowVariantsPanel(true),
    });
  }, [canonPackId, trailerType, genreKey, platformKey, styleOptions, extraPayload]);

  // Variant runs from script runs
  const variantRuns = useMemo(() =>
    (scriptRuns || []).filter((r: any) => r.variant_label),
    [scriptRuns]
  );

  const selectedRun = useMemo(() =>
    (scriptRuns || []).find((r: any) => r.is_selected),
    [scriptRuns]
  );

  // Auto-select: prefer is_selected run, then first run
  const autoTarget = selectedRun?.id || scriptRuns?.[0]?.id;
  if (scriptRuns?.length && !selectedRunId && autoTarget) {
    setSelectedRunId(autoTarget);
  }

  // Saved style options from the active run
  const savedOpts = activeRun?.style_options_json as TrailerStyleOptions | undefined;

  // Warnings state + normalization
  const [selectedWarning, setSelectedWarning] = useState<string | null>(null);

  const warningsRaw = (activeRun as any)?.warnings;
  const warnings: string[] = Array.isArray(warningsRaw)
    ? warningsRaw.filter((w: any) => typeof w === "string")
    : [];

  type WarningCategory = "critical" | "structure" | "pacing" | "tone" | "metadata" | "other";
  const CATEGORY_ORDER: WarningCategory[] = ["critical", "structure", "pacing", "tone", "metadata", "other"];

  function categorizeWarning(w: string): WarningCategory {
    const l = w.toLowerCase();
    if (l.includes("fail") || l.includes("missing") || l.includes("error")) return "critical";
    if (l.includes("structure") || l.includes("arc") || l.includes("peak") || l.includes("escalation")) return "structure";
    if (l.includes("pacing") || l.includes("tempo") || l.includes("duration") || l.includes("length")) return "pacing";
    if (l.includes("tone") || l.includes("contrast") || l.includes("energy") || l.includes("flat")) return "tone";
    if (l.includes("metadata") || l.includes("expected") || l.includes("unit") || l.includes("count")) return "metadata";
    return "other";
  }

  function sortWarningsDeterministic(ws: string[]): string[] {
    return [...ws].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(categorizeWarning(a));
      const bi = CATEGORY_ORDER.indexOf(categorizeWarning(b));
      return ai !== bi ? ai - bi : a.localeCompare(b);
    });
  }

  const warningsDeduped = dedupeWarningsStable(warnings);
  const warningsCount = warningsDeduped.length;
  const warningsPreview = sortWarningsDeterministic(warningsDeduped).slice(0, 6);

  const runKey =
    (activeRun as any)?.id ??
    `${activeRun?.status ?? "unknown"}::${(activeRun as any)?.updated_at ?? ""}`;

  useEffect(() => {
    setSelectedWarning(null);
  }, [runKey]);

  useEffect(() => {
    if (selectedWarning && !warningsDeduped.includes(selectedWarning)) {
      setSelectedWarning(null);
    }
  }, [warningsCount]);

  function warningAnchorId(w: string): string | null {
    const l = w.toLowerCase();
    if (l.includes("arc") || l.includes("structure") || l.includes("peak") || l.includes("escalation")) return "iffy-section-structure";
    if (l.includes("pacing") || l.includes("tempo") || l.includes("duration") || l.includes("length")) return "iffy-section-pacing";
    if (l.includes("tone") || l.includes("contrast") || l.includes("energy") || l.includes("flat")) return "iffy-section-tone";
    if (l.includes("metadata") || l.includes("expected") || l.includes("unit") || l.includes("count")) return "iffy-section-metadata";
    if (l.includes("fail") || l.includes("missing") || l.includes("error")) return "iffy-section-top";
    return null;
  }

  function scrollToAnchor(id: string) {
    try {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { /* no-op */ }
  }

  return (
    <div className="space-y-4" id="iffy-section-top">
      {/* Top Bar: Controls + Scores */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <MiniSelect label="Type" value={trailerType} onChange={setTrailerType} options={TRAILER_TYPE_OPTIONS} />
            <MiniSelect label="Genre" value={genreKey} onChange={setGenreKey} options={GENRE_OPTIONS} />
            <MiniSelect label="Platform" value={platformKey} onChange={setPlatformKey} options={PLATFORM_OPTIONS} />
            <div className="flex flex-col gap-1">
              <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Seed</Label>
              <Input className="h-7 w-[80px] text-[11px]" placeholder="auto" value={seed} onChange={e => setSeed(e.target.value)} />
            </div>

            <Separator orientation="vertical" className="h-8" />

            {activeRun && (
              <div className="flex items-center gap-3 text-xs">
                {activeRun.structure_score != null && (
                  <span className="text-muted-foreground">Struct: <span className="text-foreground font-mono">{Number(activeRun.structure_score).toFixed(2)}</span></span>
                )}
                {activeRun.cinematic_score != null && (
                  <span className="text-muted-foreground">Cine: <span className="text-foreground font-mono">{Number(activeRun.cinematic_score).toFixed(2)}</span></span>
                )}
                <Badge variant={activeRun.status === 'complete' ? 'default' : activeRun.status === 'needs_repair' ? 'destructive' : 'secondary'} className="text-[10px]">
                  {activeRun.status}
                </Badge>
                {activeRun.status === 'complete' && warningsCount > 0 && (
                  <span className="text-[10px] text-muted-foreground italic">
                    (with warnings)
                  </span>
                )}
              </div>
            )}

            {warningsCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <AlertTriangle className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{warningsCount} warning{warningsCount > 1 ? 's' : ''}</span>
                <button
                  type="button"
                  className="ml-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/80"
                  onClick={() => {
                    const anchorId = selectedWarning ? warningAnchorId(selectedWarning) : null;
                    const report = buildWarningsReport({
                      kind: "trailer",
                      runId: (activeRun as any)?.id ?? null,
                      status: activeRun?.status ?? null,
                      warnings: warningsDeduped,
                      selectedWarning,
                      anchorId,
                    });
                    void copyTextToClipboard(report);
                  }}
                >
                  Copy
                </button>
                <div className="flex flex-wrap gap-1 ml-1">
                  {warningsPreview.map((w, i) => {
                    const label = w.length > 40 ? w.slice(0, 37) + '…' : w;
                    const isActive = selectedWarning === w;
                    return (
                      <button
                        key={`${i}-${w}`}
                        type="button"
                        onClick={() => {
                          setSelectedWarning(w);
                          const id = warningAnchorId(w);
                          if (id) scrollToAnchor(id);
                        }}
                        className={
                          "rounded-md px-1.5 py-0.5 text-[9px] text-muted-foreground bg-muted hover:bg-muted/80 transition " +
                          (isActive ? "ring-1 ring-muted-foreground/40" : "")
                        }
                        title={w}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {selectedWarning && (
              <div className="mt-2 rounded-md border bg-background p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      {warningActionFor(selectedWarning).title}
                    </div>
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                      {warningActionFor(selectedWarning).steps.slice(0, 2).map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  {warningAnchorId(selectedWarning) && (
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80"
                      onClick={() => {
                        const id = warningAnchorId(selectedWarning);
                        if (id) scrollToAnchor(id);
                      }}
                    >
                      Jump
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Saved style options pills */}
          {savedOpts && Object.keys(savedOpts).length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground uppercase">Style:</span>
              <StyleOptionsPills opts={savedOpts} />
            </div>
          )}
          {/* Look Bible summary pills */}
          <div className="mt-1.5">
            <LookBibleSummaryPills projectId={projectId} scopeRefId={selectedRunId} />
          </div>
          {/* Additional run metadata */}
          {activeRun && (
            <div className="mt-1 flex flex-wrap items-center gap-2" id="iffy-section-metadata">
              {activeRun.strict_canon_mode && (
                <Badge variant="outline" className="text-[8px] px-1.5 py-0">
                  <Shield className="h-2 w-2 mr-0.5" />{activeRun.strict_canon_mode}
                </Badge>
              )}
              {activeRun.target_length_ms && (
                <Badge variant="outline" className="text-[8px] px-1.5 py-0">
                  {Math.round(activeRun.target_length_ms / 1000)}s target
                </Badge>
              )}
              {Array.isArray(activeRun.inspiration_refs_json) && activeRun.inspiration_refs_json.length > 0 && (
                <Badge variant="outline" className="text-[8px] px-1.5 py-0">
                  <Sparkles className="h-2 w-2 mr-0.5" />{activeRun.inspiration_refs_json.length} inspo
                </Badge>
              )}
              {activeRun.reference_notes && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 cursor-pointer">ref notes</Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="text-[10px] text-muted-foreground mt-1 max-w-md">{activeRun.reference_notes}</p>
                  </CollapsibleContent>
                </Collapsible>
              )}
              {activeRun.avoid_notes && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 cursor-pointer">avoid notes</Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="text-[10px] text-muted-foreground mt-1 max-w-md">{activeRun.avoid_notes}</p>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Style Options Panel — pacing + tone controls */}
      <Collapsible open={optionsOpen} onOpenChange={setOptionsOpen} id="iffy-section-pacing">
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="text-xs gap-1.5 w-full justify-between">
            <span className="flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5" /> Style Options
            </span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${optionsOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="py-3 space-y-4">
              {/* Row 1: Core style selects */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <MiniSelect label="Tone Preset" value={tonePreset} onChange={setTonePreset} options={TONE_PRESETS} />
                <MiniSelect label="Pacing" value={pacingProfile} onChange={setPacingProfile} options={PACING_PROFILES} />
                <MiniSelect label="Reveal Strategy" value={revealStrategy} onChange={setRevealStrategy} options={REVEAL_STRATEGIES} />
                <MiniSelect label="Camera Style" value={cameraStyle} onChange={setCameraStyle} options={CAMERA_STYLES} />
                <MiniSelect label="Lens Bias" value={lensBias} onChange={setLensBias} options={LENS_BIASES} />
                <MiniSelect label="Montage Intensity" value={microMontageIntensity} onChange={setMicroMontageIntensity} options={MONTAGE_INTENSITIES} />
                <MiniSelect label="Drop Style" value={dropStyle} onChange={setDropStyle} options={DROP_STYLES} />
                <MiniSelect label="SFX Emphasis" value={sfxEmphasis} onChange={setSfxEmphasis} options={SFX_OPTIONS} />
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Movement (1–10)</Label>
                  <div className="flex items-center gap-2">
                    <Slider value={[movementOverall]} min={1} max={10} step={1} onValueChange={v => setMovementOverall(v[0])} className="flex-1" />
                    <span className="text-xs font-mono w-4 text-center">{movementOverall}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Min Silence Windows</Label>
                  <div className="flex items-center gap-2">
                    <Slider value={[minSilenceWindows]} min={0} max={4} step={1} onValueChange={v => setMinSilenceWindows(v[0])} className="flex-1" />
                    <span className="text-xs font-mono w-4 text-center">{minSilenceWindows}</span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Row 2: Canon strictness + target length */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Shield className="h-2.5 w-2.5" /> Canon Mode
                  </Label>
                  <Select value={strictCanonMode} onValueChange={(v) => setStrictCanonMode(v as 'strict' | 'balanced')}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict" className="text-xs">Strict</SelectItem>
                      <SelectItem value="balanced" className="text-xs">Balanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Target Length (s)</Label>
                  <Input
                    className="h-7 text-[11px] w-[80px]"
                    type="number"
                    placeholder="auto"
                    value={targetLengthSeconds}
                    onChange={e => setTargetLengthSeconds(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              {/* Row 3: Inspirations */}
              <div>
                <Label className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-2">
                  <Sparkles className="h-2.5 w-2.5" /> Inspiration Trailers (max 5)
                </Label>
                <div className="space-y-1.5">
                  {inspirationTrailers.map((insp, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <Input
                        className="h-7 text-[11px] flex-1"
                        placeholder="Title"
                        value={insp.title}
                        onChange={e => {
                          const copy = [...inspirationTrailers];
                          copy[idx] = { ...copy[idx], title: e.target.value };
                          setInspirationTrailers(copy);
                        }}
                      />
                      <Input
                        className="h-7 text-[11px] w-[120px]"
                        placeholder="URL (optional)"
                        value={insp.url || ''}
                        onChange={e => {
                          const copy = [...inspirationTrailers];
                          copy[idx] = { ...copy[idx], url: e.target.value || undefined };
                          setInspirationTrailers(copy);
                        }}
                      />
                      <Input
                        className="h-7 text-[11px] flex-1"
                        placeholder="Notes"
                        value={insp.notes || ''}
                        onChange={e => {
                          const copy = [...inspirationTrailers];
                          copy[idx] = { ...copy[idx], notes: e.target.value || undefined };
                          setInspirationTrailers(copy);
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        setInspirationTrailers(inspirationTrailers.filter((_, i) => i !== idx));
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {inspirationTrailers.length < 5 && (
                    <Button variant="ghost" size="sm" className="text-[10px] h-6 gap-1" onClick={() => {
                      setInspirationTrailers([...inspirationTrailers, { title: '' }]);
                    }}>
                      <Plus className="h-2.5 w-2.5" /> Add inspiration
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              {/* Row 4: Reference / Avoid notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Reference Notes (emulate)</Label>
                  <Textarea
                    className="text-[11px] min-h-[60px]"
                    placeholder="Pacing, typography, sound design, reveal strategy to emulate…"
                    value={referenceNotes}
                    onChange={e => setReferenceNotes(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Avoid Notes</Label>
                  <Textarea
                    className="text-[11px] min-h-[60px]"
                    placeholder="Clichés, spoilers, shots, tones to avoid…"
                    value={avoidNotes}
                    onChange={e => setAvoidNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-2">
                <StyleOptionsPills opts={styleOptions} />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Look Bible Panel — tone */}
      <div id="iffy-section-tone">
        <LookBiblePanel projectId={projectId} scopeRefId={selectedRunId} />
      </div>

      {/* Gate Checklist — structure */}
      <div id="iffy-section-structure">
      <GateChecklist
        scriptGates={scriptGates || undefined}
        shotDesignGates={shotDesignGates || undefined}
        judgeScores={judgeScores || undefined}
      />
      </div>

      {/* Crescendo Micro-Montage Panel */}
      <CrescendoMontagePanel
        projectId={projectId}
        scriptRunId={selectedRunId}
        shotDesignRunId={latestShotDesign?.id}
      />

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => {
          if (!canonPackId) { toast.error('No canon pack selected'); return; }
          setPipelineSteps(null);
          runTrailerPipeline.mutate({
            canonPackId, trailerType, genreKey, platformKey,
            seed: seed || undefined, styleOptions, ...extraPayload,
          }, {
            onSuccess: (data) => {
              setPipelineSteps(data.steps || []);
              if (data.scriptRunId) setSelectedRunId(data.scriptRunId);
            },
            onError: () => setPipelineSteps(null),
          });
        }} disabled={isGenerating || !canonPackId}>
          {runTrailerPipeline.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
          Run Full Pipeline
        </Button>
        <Button size="sm" variant="outline" onClick={handleGenerateFullPlan} disabled={isGenerating || !canonPackId}>
          {createFullPlan.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
          Generate Full Plan
        </Button>
        <Button size="sm" variant="outline" onClick={handleGenerateScript} disabled={isGenerating || !canonPackId}>
          {createScript.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Film className="h-3 w-3 mr-1" />}
          Script Only
        </Button>
        <Button size="sm" variant="outline" onClick={handleGenerateVariants} disabled={isGenerating || !canonPackId}>
          {createScriptVariants.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Layers className="h-3 w-3 mr-1" />}
          Variants A/B/C
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
            <Button size="sm" variant="outline"
              onClick={() => {
                if (!activeRun?.id) return;
                exportTrailerScriptDocument.mutate({ scriptRunId: activeRun.id });
              }}
              disabled={!activeRun || exportTrailerScriptDocument.isPending}>
              {exportTrailerScriptDocument.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FileText className="h-3 w-3 mr-1" />}
              Export as Document
            </Button>
          </>
        )}
      </div>

      {/* Pipeline Step Checklist */}
      {(runTrailerPipeline.isPending || pipelineSteps) && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">Pipeline Progress</span>
              {runTrailerPipeline.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {runTrailerPipeline.isPending && !pipelineSteps && (
              <div className="space-y-1.5">
                {['Script', 'Judge / Repair', 'Rhythm Grid', 'Shot Design', 'Final Judge'].map((label) => (
                  <div key={label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin opacity-30" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            )}
            {pipelineSteps && (
              <div className="space-y-1">
                {pipelineSteps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    {s.status === 'complete' || s.status === 'passed' || s.status === 'skipped' ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : s.status === 'failed' ? (
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                    ) : s.status === 'needs_repair' || s.status === 'flagged' ? (
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                    ) : (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    <span className="capitalize">{s.step.replace(/_/g, ' ')}</span>
                    {s.status === 'skipped' && <Badge variant="outline" className="text-[8px] px-1 py-0">reused</Badge>}
                    {s.error && <span className="text-destructive text-[10px]">{s.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Variants Comparison Panel */}
      {showVariantsPanel && variantRuns.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> Script Variants
              </span>
              <Button variant="ghost" size="sm" className="text-[10px] h-6" onClick={() => setShowVariantsPanel(false)}>
                Hide
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {variantRuns.map((run: any) => {
                const isActive = run.id === selectedRunId;
                const isSelected = run.is_selected;
                return (
                  <Card key={run.id} className={`border ${isSelected ? 'border-primary ring-1 ring-primary/30' : isActive ? 'border-accent' : 'border-border'}`}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] font-bold">{run.variant_label || '?'}</Badge>
                          <Badge variant={run.status === 'complete' ? 'default' : run.status === 'needs_repair' ? 'destructive' : 'secondary'} className="text-[9px]">
                            {run.status}
                          </Badge>
                          {isSelected && (
                            <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">
                              <Star className="h-2 w-2 mr-0.5" /> Active
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px]">
                        <span className="text-muted-foreground">Structure</span>
                        <span className="font-mono text-right">{run.structure_score != null ? Number(run.structure_score).toFixed(2) : '—'}</span>
                        <span className="text-muted-foreground">Cinematic</span>
                        <span className="font-mono text-right">{run.cinematic_score != null ? Number(run.cinematic_score).toFixed(2) : '—'}</span>
                        <span className="text-muted-foreground">Warnings</span>
                        <span className="font-mono text-right">{run.warnings?.length || 0}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" className="text-[10px] h-6 flex-1" onClick={() => {
                          setSelectedRunId(run.id);
                          setShowVariantsPanel(false);
                        }}>
                          View
                        </Button>
                        <Button size="sm" variant={isSelected ? 'secondary' : 'default'} className="text-[10px] h-6 flex-1"
                          disabled={isSelected || selectScriptRun.isPending}
                          onClick={() => selectScriptRun.mutate({ scriptRunId: run.id })}>
                          {isSelected ? <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> : <Star className="h-2.5 w-2.5 mr-0.5" />}
                          {isSelected ? 'Selected' : 'Select'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress bar during generation */}
      {isGenerating && (
        <StagedProgressBar
          title="Generating Cinematic Plan"
          stages={['Script generation', 'Initial judge', 'Rhythm grid', 'Shot design', 'Final judge']}
          currentStageIndex={createFullPlan.isPending ? fullPlanStage : 0}
          progressPercent={createFullPlan.isPending ? Math.round((fullPlanStage / 5) * 100) : 0}
          etaSeconds={90}
          detailMessage={['Generating trailer script…', 'Running quality check…', 'Building rhythm grid…', 'Designing shots…', 'Final scoring…'][fullPlanStage] || 'Processing…'}
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

                    {/* Generator Hints */}
                    {activeBeat.generator_hint_json && typeof activeBeat.generator_hint_json === 'object' && !Array.isArray(activeBeat.generator_hint_json) && (
                      <>
                        <Separator />
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Generator Hint</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(activeBeat.generator_hint_json as Record<string, any>).shot_type && (
                              <Badge variant="outline" className="text-[8px]">{(activeBeat.generator_hint_json as Record<string, any>).shot_type}</Badge>
                            )}
                            {(activeBeat.generator_hint_json as Record<string, any>).camera_move && (
                              <Badge variant="outline" className="text-[8px]">{(activeBeat.generator_hint_json as Record<string, any>).camera_move}</Badge>
                            )}
                            {(activeBeat.generator_hint_json as Record<string, any>).lens_mm && (
                              <Badge variant="outline" className="text-[8px]">{(activeBeat.generator_hint_json as Record<string, any>).lens_mm}mm</Badge>
                            )}
                            {(activeBeat.generator_hint_json as Record<string, any>).preferred_provider && (
                              <Badge variant="outline" className="text-[8px]">{(activeBeat.generator_hint_json as Record<string, any>).preferred_provider}</Badge>
                            )}
                          </div>
                          {(activeBeat.generator_hint_json as Record<string, any>).visual_prompt && (
                            <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                              {(activeBeat.generator_hint_json as Record<string, any>).visual_prompt}
                            </p>
                          )}
                        </div>
                      </>
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
                            {ref.location && (
                              <span className="text-muted-foreground text-[10px]">{ref.location}</span>
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
