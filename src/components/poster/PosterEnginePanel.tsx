/**
 * PosterEnginePanel — Poster Studio with expand/edit/branch/template workflows.
 * Generates 6 distinct poster concepts, supports prompt-based editing,
 * enlarged viewing, classic theatrical templates, and poster versioning.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useVisualDecision } from "@/hooks/useVisualDecision";
import { DecisionBadge } from "@/components/visual-decisions/DecisionBadge";
import { useParams } from "react-router-dom";
import {
  Image, RefreshCw, Upload, Trash2, CheckCircle2, AlertTriangle,
  Loader2, Sparkles, Star, ChevronDown, User, Mountain,
  Swords, Award, Megaphone, Drama, PenLine, Plus, X,
  Download, Layout, Maximize2, Edit3, Wand2, Send, ShieldAlert,
} from "lucide-react";
import { useProjectPostersFreshness, useRefreshPosterFromTruth } from "@/hooks/useVisualTruthFreshness";
import type { FreshnessResult, DependencyClass } from "@/lib/visual-truth-dependencies";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PosterCompositor, type PosterCreditsData, type PosterLayoutVariant, POSTER_TEMPLATES, type TitleStyleConfig, type TitleTypographyMode, type TitleCaseMode, type TitlePositionMode, TITLE_TYPOGRAPHY_MODES, TITLE_CASE_OPTIONS, TITLE_POSITION_OPTIONS } from "@/components/poster/PosterCompositor";
import { FramingStrategyPanel } from "@/components/framing/FramingStrategyPanel";
import {
  useProjectPosters,
  useActivePoster,
  useGeneratePoster,
  useUploadPosterKeyArt,
  useSetActivePoster,
  useDeletePoster,
  type ProjectPoster,
} from "@/hooks/useProjectPosters";
import { useProject } from "@/hooks/useProjects";
import { useProjectBranding } from "@/hooks/useProjectBranding";
import { usePosterCredits, useUpdatePosterCredits } from "@/hooks/usePosterCredits";

const STRATEGY_META: Record<string, { icon: typeof User; color: string; description: string }> = {
  character:  { icon: User,     color: "text-blue-400",   description: "Lead character dominant, emotional, intimate" },
  world:      { icon: Mountain, color: "text-emerald-400", description: "Setting dominant, cinematic scale, vast" },
  conflict:   { icon: Swords,   color: "text-red-400",     description: "Tension, confrontation, dynamic stakes" },
  prestige:   { icon: Award,    color: "text-amber-400",   description: "Minimal, metaphor-driven, festival style" },
  commercial: { icon: Megaphone, color: "text-purple-400", description: "Bold hook, strong title, mainstream appeal" },
  genre:      { icon: Drama,    color: "text-orange-400",  description: "Pure genre conventions, instant recognition" },
};

const QUICK_EDIT_PRESETS = [
  { label: "More Classic", prompt: "Make this feel more like a classic theatrical movie poster from the golden age of cinema — richer composition, more gravitas" },
  { label: "Darker Prestige", prompt: "Darken the overall tone to feel more like a prestige festival film — moodier, more atmospheric, A24 aesthetic" },
  { label: "Stronger Composition", prompt: "Strengthen the visual composition — better balance, stronger focal point, more cinematic depth" },
  { label: "More Atmospheric", prompt: "Add more atmosphere — mist, haze, dramatic lighting, environmental mood" },
  { label: "Simpler", prompt: "Simplify the composition — reduce visual noise, focus on one strong central element" },
  { label: "More Theatrical", prompt: "Make this more theatrical and dramatic — as if it will be displayed in a cinema lobby at 27×40 inches" },
];

function PosterImage({
  poster,
  title,
  branding,
  credits,
  layoutVariant,
  titleStyle,
  width,
  className,
  onCanvasReady,
}: {
  poster: ProjectPoster;
  title: string;
  branding: { companyLogoUrl: string | null; companyName: string | null } | null;
  credits?: PosterCreditsData;
  layoutVariant?: PosterLayoutVariant;
  titleStyle?: TitleStyleConfig;
  width: number;
  className?: string;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}) {
  const imageUrl = poster.rendered_public_url || poster.key_art_public_url;

  return (
    <PosterCompositor
      keyArtUrl={imageUrl || ""}
      title={title}
      companyLogoUrl={branding?.companyLogoUrl}
      companyName={branding?.companyName}
      credits={credits}
      layoutVariant={layoutVariant || "cinematic-dark"}
      titleStyle={titleStyle}
      width={width}
      onRender={onCanvasReady}
      className={className}
    />
  );
}

// ── Freshness Badge ── Shows dependency classes and separate CTAs
const DEPENDENCY_CLASS_LABELS: Record<DependencyClass, string> = {
  cast: 'Cast',
  look: 'Look',
  state: 'State',
  dna: 'DNA',
  world: 'World',
  entity: 'Character',
  costume: 'Costume',
  unknown: 'Unknown',
};

function FreshnessBadge({ freshness, posterId, onRefreshFromTruth, onEdit, isRefreshing }: {
  freshness?: FreshnessResult;
  posterId: string;
  onRefreshFromTruth: () => void;
  onEdit?: () => void;
  isRefreshing: boolean;
}) {
  if (!freshness || freshness.status === 'current') return null;

  const classLabels = freshness.affectedClasses?.map(c => DEPENDENCY_CLASS_LABELS[c] || c).join(', ');

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge
        variant="outline"
        className={cn(
          "text-[9px] gap-1",
          freshness.status === 'stale' && "border-destructive/40 text-destructive",
          freshness.status === 'needs_refresh' && "border-amber-500/40 text-amber-500",
        )}
      >
        <ShieldAlert className="w-2.5 h-2.5" />
        {freshness.predatesDependencyTracking ? 'Pre-tracking' : 'Stale'}
      </Badge>
      {classLabels && (
        <span className="text-[9px] text-muted-foreground" title={freshness.staleReasons.join('; ')}>
          {classLabels}
        </span>
      )}
      {!freshness.predatesDependencyTracking && freshness.staleReasons.length > 0 && !classLabels && (
        <span className="text-[9px] text-muted-foreground max-w-[200px] truncate" title={freshness.staleReasons.join('; ')}>
          {freshness.staleReasons[0]}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-5 text-[9px] px-2 gap-1"
        onClick={onRefreshFromTruth}
        disabled={isRefreshing}
      >
        {isRefreshing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
        Refresh Truth
      </Button>
    </div>
  );
}

export default function PosterEnginePanel() {
  const { id: projectId } = useParams<{ id: string }>();
  const { project } = useProject(projectId || "");
  const { data: branding } = useProjectBranding(projectId);
  const { data: posters, isLoading } = useProjectPosters(projectId);
  const { data: activePoster } = useActivePoster(projectId);
  const { data: posterCredits } = usePosterCredits(projectId);
  const updateCredits = useUpdatePosterCredits(projectId);
  const generatePoster = useGeneratePoster(projectId);
  const uploadPoster = useUploadPosterKeyArt(projectId);
  const setActivePoster = useSetActivePoster(projectId);
  const deletePoster = useDeletePoster(projectId);
  const { data: freshnessMap } = useProjectPostersFreshness(projectId);
  const refreshFromTruth = useRefreshPosterFromTruth(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePosterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreditsEditor, setShowCreditsEditor] = useState(false);
  const [showTitleStyle, setShowTitleStyle] = useState(false);

  // Title typography state
  const [titleStyle, setTitleStyle] = useState<TitleStyleConfig>({});

  // Expanded poster modal
  const [expandedPoster, setExpandedPoster] = useState<ProjectPoster | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // ── Visual Decision: Poster Style ──
  const posterStyleDecision = useVisualDecision(projectId, 'poster_style');
  const selectedTemplate = (posterStyleDecision.effective || 'classic-theatrical') as PosterLayoutVariant;
  const setSelectedTemplate = useCallback((v: string) => {
    posterStyleDecision.select(v);
  }, [posterStyleDecision]);

  useEffect(() => {
    if (projectId && !posterStyleDecision.recommended && !posterStyleDecision.isLoading) {
      posterStyleDecision.refreshRecommendation();
    }
  }, [projectId, posterStyleDecision.recommended, posterStyleDecision.isLoading]);

  const posterPrimaryDecision = useVisualDecision(projectId, 'poster_primary');

  const isGenerating = generatePoster.isPending;
  const isUploading = uploadPoster.isPending;
  const isBusy = isGenerating || isUploading || isEditing;

  // Build credits data for compositor
  const [liveCredits, setLiveCredits] = useState<PosterCreditsData | null>(null);

  const creditsData: PosterCreditsData = liveCredits || {
    writtenBy: posterCredits?.written_by || [],
    producedBy: posterCredits?.produced_by || [],
    createdByCredit: posterCredits?.created_by_credit || null,
    basedOnCredit: posterCredits?.based_on_credit || null,
  };

  useEffect(() => {
    if (posterCredits && !liveCredits) {
      setLiveCredits({
        writtenBy: posterCredits.written_by || [],
        producedBy: posterCredits.produced_by || [],
        createdByCredit: posterCredits.created_by_credit || null,
        basedOnCredit: posterCredits.based_on_credit || null,
      });
    }
  }, [posterCredits, liveCredits]);

  const companyName = posterCredits?.company_name || branding?.companyName || null;
  const posterTitle = posterCredits?.title_override || project?.title || "Untitled";

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadPoster.mutate(file);
    e.target.value = "";
  };

  const handleGenerateAll = () => {
    generatePoster.mutate({ mode: "multi_concept" });
  };

  const handleRegenerateOne = (strategyKey: string) => {
    generatePoster.mutate({ mode: "multi_concept", strategy_key: strategyKey });
  };

  const handleEditPoster = useCallback(async (poster: ProjectPoster, prompt: string) => {
    if (!prompt.trim()) return;
    setIsEditing(true);
    try {
      await generatePoster.mutateAsync({
        mode: "edit_poster",
        source_poster_id: poster.id,
        edit_prompt: prompt.trim(),
        poster_template: selectedTemplate,
      });
      setEditPrompt("");
      setExpandedPoster(null);
    } finally {
      setIsEditing(false);
    }
  }, [generatePoster, selectedTemplate]);

  const handleDownloadPoster = useCallback(() => {
    const canvas = activePosterCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${posterTitle.replace(/\s+/g, "_")}_poster.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [posterTitle]);

  const readyPosters = posters?.filter(p => p.status === "ready") || [];
  const generatingPosters = posters?.filter(p => p.status === "generating") || [];

  const conceptPosters = readyPosters.filter(p =>
    Object.keys(STRATEGY_META).includes(p.layout_variant)
  );
  const otherPosters = readyPosters.filter(p =>
    !Object.keys(STRATEGY_META).includes(p.layout_variant)
  );
  const hasConceptSet = conceptPosters.length > 0;

  const latestByStrategy = new Map<string, ProjectPoster>();
  for (const p of conceptPosters) {
    const existing = latestByStrategy.get(p.layout_variant);
    if (!existing || p.version_number > existing.version_number) {
      latestByStrategy.set(p.layout_variant, p);
    }
  }

  const brandingData = branding
    ? { ...branding, companyName }
    : { companyLogoUrl: null, companyName };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Image className="w-5 h-5 text-primary" />
            Poster Studio
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Generate theatrical poster concepts, edit through prompts, and compose with classic billing blocks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload
          </Button>
          <Button
            size="sm"
            disabled={isBusy}
            onClick={handleGenerateAll}
            className="gap-1.5"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                {hasConceptSet ? "Regenerate All" : "Generate 6 Posters"}
              </>
            )}
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>
      </div>

      {/* ── Template Selector + Credits Editor ── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 px-4 py-2.5 bg-card/50 rounded-lg border border-border/30">
          <div className="flex items-center gap-3 flex-wrap">
            <Layout className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Layout Template</span>
            <Select value={selectedTemplate} onValueChange={(v) => setSelectedTemplate(v as PosterLayoutVariant)}>
              <SelectTrigger className="w-52 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(POSTER_TEMPLATES).map(([key, tmpl]) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {tmpl.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground ml-1">
              {POSTER_TEMPLATES[selectedTemplate]?.description}
            </span>
          </div>
          <DecisionBadge
            recommended={posterStyleDecision.recommended}
            recommendedReason={posterStyleDecision.recommendedReason}
            selected={posterStyleDecision.selected}
            effective={posterStyleDecision.effective}
            isUserSelected={posterStyleDecision.isUserSelected}
            recommendedLabel={posterStyleDecision.recommended ? POSTER_TEMPLATES[posterStyleDecision.recommended as PosterLayoutVariant]?.label : undefined}
            selectedLabel={posterStyleDecision.selected ? POSTER_TEMPLATES[posterStyleDecision.selected as PosterLayoutVariant]?.label : undefined}
            onAcceptRecommendation={() => posterStyleDecision.recommended && posterStyleDecision.select(posterStyleDecision.recommended)}
            onClearSelection={posterStyleDecision.isUserSelected ? posterStyleDecision.clearSelection : undefined}
          />
        </div>

        {/* Credits editor */}
        <Collapsible open={showCreditsEditor} onOpenChange={setShowCreditsEditor}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-between px-4 py-2.5 bg-card/50 rounded-lg border border-border/30 hover:border-border/60">
              <div className="flex items-center gap-2">
                <PenLine className="w-3.5 h-3.5" />
                <span className="font-medium text-foreground">Poster Credits & Billing</span>
                {posterCredits && (
                  <span className="text-muted-foreground">
                    — {posterCredits.written_by.join(', ')}
                  </span>
                )}
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showCreditsEditor && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {posterCredits && (
              <PosterCreditsEditor
                credits={posterCredits}
                projectTitle={project?.title || ''}
                onUpdate={(updates) => updateCredits.mutate(updates)}
                onLiveChange={setLiveCredits}
                isSaving={updateCredits.isPending}
              />
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Title Typography Controls */}
        <Collapsible open={showTitleStyle} onOpenChange={setShowTitleStyle}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-between px-4 py-2.5 bg-card/50 rounded-lg border border-border/30 hover:border-border/60">
              <div className="flex items-center gap-2">
                <PenLine className="w-3.5 h-3.5" />
                <span className="font-medium text-foreground">Title Typography</span>
                <span className="text-muted-foreground">
                  — {TITLE_TYPOGRAPHY_MODES[titleStyle.typographyMode || "classic_theatrical_serif"]?.label || "Template Default"}
                </span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showTitleStyle && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 px-4 py-3 bg-card/50 rounded-lg border border-border/30 space-y-3">
              {/* Typography Mode */}
              <div className="flex items-center gap-3">
                <Label className="text-xs w-20 shrink-0 text-muted-foreground">Style</Label>
                <Select
                  value={titleStyle.typographyMode || ""}
                  onValueChange={(v) => setTitleStyle(prev => ({ ...prev, typographyMode: (v || undefined) as TitleTypographyMode | undefined }))}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Template default" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TITLE_TYPOGRAPHY_MODES).map(([key, info]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {info.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Case */}
              <div className="flex items-center gap-3">
                <Label className="text-xs w-20 shrink-0 text-muted-foreground">Case</Label>
                <Select
                  value={titleStyle.caseMode || ""}
                  onValueChange={(v) => setTitleStyle(prev => ({ ...prev, caseMode: (v || undefined) as TitleCaseMode | undefined }))}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Mode default" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TITLE_CASE_OPTIONS).map(([key, label]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Position */}
              <div className="flex items-center gap-3">
                <Label className="text-xs w-20 shrink-0 text-muted-foreground">Position</Label>
                <Select
                  value={titleStyle.positionMode || ""}
                  onValueChange={(v) => setTitleStyle(prev => ({ ...prev, positionMode: (v || undefined) as TitlePositionMode | undefined }))}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Center (default)" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TITLE_POSITION_OPTIONS).map(([key, label]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Color */}
              <div className="flex items-center gap-3">
                <Label className="text-xs w-20 shrink-0 text-muted-foreground">Color</Label>
                <div className="flex items-center gap-2 flex-1">
                  {["#F0EBE1", "#E5DFD3", "#D4B878", "#F5F2ED", "#B8A06A"].map(hex => (
                    <button
                      key={hex}
                      onClick={() => setTitleStyle(prev => ({ ...prev, colorHex: prev.colorHex === hex ? undefined : hex }))}
                      className={cn(
                        "w-6 h-6 rounded-full border-2 transition-all",
                        titleStyle.colorHex === hex ? "border-primary scale-110" : "border-border/40 hover:border-border"
                      )}
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              </div>

              {/* Depth toggle */}
              <div className="flex items-center gap-3">
                <Label className="text-xs w-20 shrink-0 text-muted-foreground">Depth</Label>
                <button
                  onClick={() => setTitleStyle(prev => ({ ...prev, enableDepth: !prev.enableDepth }))}
                  className={cn(
                    "text-xs px-3 py-1 rounded border transition-colors",
                    titleStyle.enableDepth
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-card border-border/30 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {titleStyle.enableDepth ? "Emboss On" : "Emboss Off"}
                </button>
              </div>

              {/* Reset */}
              <div className="pt-1 border-t border-border/20">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-6 text-muted-foreground"
                  onClick={() => setTitleStyle({})}
                >
                  Reset to template defaults
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Generating state */}
      {(isGenerating || generatingPosters.length > 0) && (
        <Card className="bg-card border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Generating theatrical poster key art…</p>
              <p className="text-xs text-muted-foreground">
                Creating cinematic compositions — full edge-to-edge artwork. ~90 seconds.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Poster Banner */}
      {activePoster && (
        <Card className="bg-card border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div
                className="cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setExpandedPoster(activePoster)}
              >
                <PosterImage
                  poster={activePoster}
                  title={posterTitle}
                  branding={brandingData}
                  credits={creditsData}
                  layoutVariant={selectedTemplate}
                  width={120}
                  className="rounded shadow-lg"
                  onCanvasReady={(c) => { activePosterCanvasRef.current = c; }}
                />
              </div>
                <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm font-medium text-foreground">Active Poster</span>
                  <Badge variant="outline" className="text-[9px]">v{activePoster.version_number}</Badge>
                  {STRATEGY_META[activePoster.layout_variant] && (
                    <Badge variant="secondary" className="text-[9px]">
                      {activePoster.layout_variant}
                    </Badge>
                  )}
                  {(activePoster.prompt_inputs as any)?.poster_mode === 'edit' && (
                    <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500">edited</Badge>
                  )}
                  <FreshnessBadge freshness={freshnessMap?.[activePoster.id]} posterId={activePoster.id} onRefreshFromTruth={() => refreshFromTruth.mutate(activePoster.id)} isRefreshing={refreshFromTruth.isPending} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {activePoster.source_type === "generated" ? "AI Key Art" : activePoster.source_type === "edited" ? "Edited" : "Uploaded"} • {POSTER_TEMPLATES[selectedTemplate]?.label || selectedTemplate}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleDownloadPoster}>
                    <Download className="w-3 h-3" /> Download
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setExpandedPoster(activePoster)}>
                    <Maximize2 className="w-3 h-3" /> Expand
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { setExpandedPoster(activePoster); }}>
                    <Edit3 className="w-3 h-3" /> Edit
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Creative Framing Panel */}
      {projectId && (
        <FramingStrategyPanel projectId={projectId} contentType="poster" compact />
      )}

      {/* 6-Concept Grid */}
      {hasConceptSet && !isGenerating && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Poster Directions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Object.entries(STRATEGY_META).map(([key, meta]) => {
              const poster = latestByStrategy.get(key);
              const Icon = meta.icon;
              const isActive = poster?.id === activePoster?.id;

              return (
                <div
                  key={key}
                  className={cn(
                    "relative group rounded-xl overflow-hidden border transition-all",
                    isActive
                      ? "border-primary/50 ring-2 ring-primary/20"
                      : "border-border/30 hover:border-border/60"
                  )}
                >
                  {poster ? (
                    <>
                      <PosterImage
                        poster={poster}
                        title={posterTitle}
                        branding={brandingData}
                        credits={creditsData}
                        layoutVariant={selectedTemplate}
                        width={280}
                      />

                      {/* Strategy label */}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1">
                        <Icon className={cn("w-3 h-3", meta.color)} />
                        <span className="text-[10px] font-medium text-foreground capitalize">{key}</span>
                      </div>

                      {isActive && (
                        <div className="absolute top-2 right-2 bg-primary rounded-full p-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />
                        </div>
                      )}

                      {/* Freshness indicator on card */}
                      {poster && freshnessMap?.[poster.id]?.status === 'stale' && (
                        <div className="absolute bottom-2 left-2 bg-destructive/90 backdrop-blur-sm rounded-md px-1.5 py-0.5 flex items-center gap-1">
                          <ShieldAlert className="w-2.5 h-2.5 text-destructive-foreground" />
                          <span className="text-[9px] font-medium text-destructive-foreground">Stale</span>
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                        <p className="text-[10px] text-muted-foreground text-center px-4 mb-1">
                          {meta.description}
                        </p>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" className="h-7 text-[10px] gap-1" onClick={() => setExpandedPoster(poster)}>
                            <Maximize2 className="w-3 h-3" /> Expand
                          </Button>
                          {!isActive && (
                            <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => setActivePoster.mutate(poster.id)}>
                              <Star className="w-3 h-3" /> Select
                            </Button>
                          )}
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={() => handleRegenerateOne(key)} disabled={isBusy}>
                            <RefreshCw className="w-2.5 h-2.5" /> Redo
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={() => setExpandedPoster(poster)}>
                            <Edit3 className="w-2.5 h-2.5" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-1 text-destructive" onClick={() => deletePoster.mutate(poster.id)}>
                            <Trash2 className="w-2.5 h-2.5" />
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="aspect-[2/3] flex flex-col items-center justify-center gap-2 bg-muted/10">
                      <Icon className={cn("w-6 h-6", meta.color, "opacity-40")} />
                      <span className="text-[10px] text-muted-foreground capitalize">{key}</span>
                      <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={() => handleRegenerateOne(key)} disabled={isBusy}>
                        <Sparkles className="w-2.5 h-2.5" /> Generate
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasConceptSet && !isLoading && !isGenerating && !activePoster && (
        <Card className="bg-card border-border/40 border-dashed">
          <CardContent className="p-12 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mx-auto">
              <Image className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No poster concepts yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Generate 6 theatrical poster directions with full cinematic compositions.
                Title and credits are composited from your editable billing fields.
              </p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 max-w-lg mx-auto">
              {Object.entries(STRATEGY_META).map(([key, meta]) => {
                const Icon = meta.icon;
                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <div className={cn("w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center")}>
                      <Icon className={cn("w-4 h-4", meta.color, "opacity-60")} />
                    </div>
                    <span className="text-[9px] text-muted-foreground capitalize">{key}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button size="sm" onClick={handleGenerateAll} disabled={isBusy} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Generate 6 Posters
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
                <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Image
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Failed posters */}
      {posters?.filter(p => p.status === "failed").slice(0, 2).map(fp => (
        <Card key={fp.id} className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <div>
                <p className="text-xs font-medium text-foreground">
                  v{fp.version_number} failed
                  {STRATEGY_META[fp.layout_variant] && ` (${fp.layout_variant})`}
                </p>
                <p className="text-[10px] text-muted-foreground">{fp.error_message || "Unknown error"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {STRATEGY_META[fp.layout_variant] && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleRegenerateOne(fp.layout_variant)} disabled={isBusy}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Retry
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => deletePoster.mutate(fp.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Other poster history */}
      {otherPosters.length > 0 && (
        <Collapsible open={showHistory} onOpenChange={setShowHistory}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showHistory && "rotate-180")} />
              Other Posters ({otherPosters.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {otherPosters.map(poster => (
                <div
                  key={poster.id}
                  className={cn(
                    "relative group rounded-lg overflow-hidden border transition-colors cursor-pointer",
                    poster.id === activePoster?.id ? "border-primary/40 ring-1 ring-primary/20" : "border-border/30"
                  )}
                  onClick={() => setExpandedPoster(poster)}
                >
                  <PosterImage
                    poster={poster}
                    title={posterTitle}
                    branding={brandingData}
                    credits={creditsData}
                    layoutVariant={selectedTemplate}
                    width={160}
                  />
                  <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                    <Button size="sm" variant="secondary" className="h-6 text-[10px] gap-1">
                      <Maximize2 className="w-3 h-3" /> View
                    </Button>
                    {poster.id !== activePoster?.id && (
                      <Button size="sm" variant="secondary" className="h-6 text-[10px] gap-1" onClick={(e) => { e.stopPropagation(); setActivePoster.mutate(poster.id); }}>
                        <Star className="w-3 h-3" /> Set Active
                      </Button>
                    )}
                  </div>
                  <div className="absolute top-1.5 left-1.5">
                    <Badge variant="outline" className="text-[9px] bg-background/80 backdrop-blur-sm">v{poster.version_number}</Badge>
                  </div>
                  {poster.id === activePoster?.id && (
                    <div className="absolute top-1.5 right-1.5">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          EXPANDED POSTER MODAL — Large preview + edit prompt + metadata
          ═══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={!!expandedPoster} onOpenChange={(open) => { if (!open) { setExpandedPoster(null); setEditPrompt(""); } }}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto p-0 gap-0">
          {expandedPoster && (
            <>
              <DialogHeader className="p-4 pb-0">
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Image className="w-4 h-4 text-primary" />
                  Poster v{expandedPoster.version_number}
                  {STRATEGY_META[expandedPoster.layout_variant] && (
                    <Badge variant="secondary" className="text-[9px] capitalize">{expandedPoster.layout_variant}</Badge>
                  )}
                  {expandedPoster.source_type === "edited" && (
                    <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500">edited</Badge>
                  )}
                  {expandedPoster.id === activePoster?.id && (
                    <Badge className="text-[9px]">Active</Badge>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="flex flex-col lg:flex-row gap-4 p-4">
                {/* Large poster preview */}
                <div className="flex-1 flex justify-center">
                  <PosterImage
                    poster={expandedPoster}
                    title={posterTitle}
                    branding={brandingData}
                    credits={creditsData}
                    layoutVariant={selectedTemplate}
                    width={480}
                    className="rounded-lg shadow-2xl"
                  />
                </div>

                {/* Right panel — metadata + edit */}
                <div className="w-full lg:w-72 space-y-4">
                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    {expandedPoster.id !== activePoster?.id && (
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setActivePoster.mutate(expandedPoster.id); }}>
                        <Star className="w-3 h-3" /> Set Primary
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => {
                      // Download expanded poster
                      const img = expandedPoster.rendered_public_url || expandedPoster.key_art_public_url;
                      if (img) { window.open(img, '_blank'); }
                    }}>
                      <Download className="w-3 h-3" /> Download
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive" onClick={() => { deletePoster.mutate(expandedPoster.id); setExpandedPoster(null); }}>
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                  </div>

                  {/* Freshness status */}
                  {freshnessMap?.[expandedPoster.id] && freshnessMap[expandedPoster.id].status !== 'current' && (
                    <div className="p-2 rounded-md bg-destructive/10 border border-destructive/20 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-destructive">
                        <ShieldAlert className="w-3 h-3" />
                        {freshnessMap[expandedPoster.id].predatesDependencyTracking
                          ? 'Pre-Tracking Poster'
                          : 'Upstream Truth Changed'}
                      </div>
                      {freshnessMap[expandedPoster.id].affectedClasses?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {freshnessMap[expandedPoster.id].affectedClasses.map((cls) => (
                            <Badge key={cls} variant="outline" className="text-[8px] h-4 border-destructive/30 text-destructive">
                              {DEPENDENCY_CLASS_LABELS[cls] || cls}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {freshnessMap[expandedPoster.id].staleReasons.map((r, i) => (
                        <p key={i} className="text-[9px] text-muted-foreground">• {r}</p>
                      ))}
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[9px] flex-1 gap-1"
                          onClick={() => refreshFromTruth.mutate(expandedPoster.id)}
                          disabled={refreshFromTruth.isPending}
                        >
                          {refreshFromTruth.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                          Refresh from Truth
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[9px] gap-1"
                          onClick={() => { /* scroll to edit section */ }}
                        >
                          <Edit3 className="w-2.5 h-2.5" />
                          Edit Creatively
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="space-y-1.5 text-[10px] text-muted-foreground">
                    <div>Template: <span className="text-foreground">{POSTER_TEMPLATES[selectedTemplate]?.label}</span></div>
                    <div>Source: <span className="text-foreground capitalize">{expandedPoster.source_type}</span></div>
                    <div>Created: <span className="text-foreground">{new Date(expandedPoster.created_at).toLocaleDateString()}</span></div>
                    {expandedPoster.provider && <div>Model: <span className="text-foreground">{expandedPoster.model}</span></div>}
                    {(expandedPoster.prompt_inputs as any)?.edit_prompt && (
                      <div>Edit: <span className="text-foreground italic">"{(expandedPoster.prompt_inputs as any).edit_prompt}"</span></div>
                    )}
                    {(expandedPoster.prompt_inputs as any)?.source_poster_id && (
                      <div>Branched from: <span className="text-foreground">v{posters?.find(p => p.id === (expandedPoster.prompt_inputs as any).source_poster_id)?.version_number || '?'}</span></div>
                    )}
                  </div>

                  {/* Quick edit presets */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Wand2 className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] font-medium text-foreground">Quick Edits</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_EDIT_PRESETS.map((preset) => (
                        <Button
                          key={preset.label}
                          size="sm"
                          variant="outline"
                          className="h-6 text-[9px] px-2"
                          disabled={isBusy}
                          onClick={() => handleEditPoster(expandedPoster, preset.prompt)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Custom edit prompt */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Edit3 className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] font-medium text-foreground">Custom Edit</span>
                    </div>
                    <Textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="Describe changes — e.g. 'make it feel more like a classic 1970s prestige poster'"
                      className="text-xs min-h-[60px] resize-none"
                      disabled={isBusy}
                    />
                    <Button
                      size="sm"
                      className="w-full h-7 text-xs gap-1.5"
                      disabled={!editPrompt.trim() || isBusy}
                      onClick={() => handleEditPoster(expandedPoster, editPrompt)}
                    >
                      {isEditing ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Creating edit…</>
                      ) : (
                        <><Send className="w-3 h-3" /> Apply Edit (New Version)</>
                      )}
                    </Button>
                    <p className="text-[9px] text-muted-foreground">
                      Creates a new poster version — original is preserved.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Poster Credits Editor — inline editable billing fields with live preview
// ══════════════════════════════════════════════════════════════════════════════

function PosterCreditsEditor({
  credits,
  projectTitle,
  onUpdate,
  onLiveChange,
  isSaving,
}: {
  credits: {
    title_override: string | null;
    tagline: string | null;
    written_by: string[];
    produced_by: string[];
    company_name: string;
    created_by_credit: string | null;
    based_on_credit: string | null;
  };
  projectTitle: string;
  onUpdate: (updates: Record<string, unknown>) => void;
  onLiveChange: (credits: PosterCreditsData) => void;
  isSaving: boolean;
}) {
  const [titleOverride, setTitleOverride] = useState(credits.title_override || '');
  const [tagline, setTagline] = useState(credits.tagline || '');
  const [writtenBy, setWrittenBy] = useState(credits.written_by);
  const [producedBy, setProducedBy] = useState(credits.produced_by);
  const [companyName, setCompanyName] = useState(credits.company_name);
  const [newWriter, setNewWriter] = useState('');
  const [newProducer, setNewProducer] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushLive = useCallback((wb: string[], pb: string[]) => {
    onLiveChange({
      writtenBy: wb,
      producedBy: pb,
      createdByCredit: credits.created_by_credit || null,
      basedOnCredit: credits.based_on_credit || null,
    });
  }, [onLiveChange, credits.created_by_credit, credits.based_on_credit]);

  const scheduleAutoSave = useCallback((updates: Record<string, unknown>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate(updates);
    }, 1500);
  }, [onUpdate]);

  const handleSave = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onUpdate({
      title_override: titleOverride.trim() || null,
      tagline: tagline.trim() || null,
      written_by: writtenBy.filter(Boolean),
      produced_by: producedBy.filter(Boolean),
      company_name: companyName.trim(),
    });
  };

  const addWriter = () => {
    const name = newWriter.trim();
    if (name && !writtenBy.includes(name)) {
      const updated = [...writtenBy, name];
      setWrittenBy(updated);
      setNewWriter('');
      pushLive(updated, producedBy);
      scheduleAutoSave({ written_by: updated.filter(Boolean) });
    }
  };

  const removeWriter = (idx: number) => {
    const updated = writtenBy.filter((_, i) => i !== idx);
    setWrittenBy(updated);
    pushLive(updated, producedBy);
    scheduleAutoSave({ written_by: updated.filter(Boolean) });
  };

  const addProducer = () => {
    const name = newProducer.trim();
    if (name && !producedBy.includes(name)) {
      const updated = [...producedBy, name];
      setProducedBy(updated);
      setNewProducer('');
      pushLive(writtenBy, updated);
      scheduleAutoSave({ produced_by: updated.filter(Boolean) });
    }
  };

  const removeProducer = (idx: number) => {
    const updated = producedBy.filter((_, i) => i !== idx);
    setProducedBy(updated);
    pushLive(writtenBy, updated);
    scheduleAutoSave({ produced_by: updated.filter(Boolean) });
  };

  return (
    <Card className="mt-2 border-border/30">
      <CardContent className="p-4 space-y-4">
        <p className="text-[11px] text-muted-foreground">
          These fields control the text composited onto your poster. No names will be invented — only what you enter here appears.
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs">Poster Title</Label>
          <Input value={titleOverride} onChange={e => setTitleOverride(e.target.value)} placeholder={projectTitle} className="h-8 text-xs" />
          <p className="text-[10px] text-muted-foreground">Leave blank to use project title</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tagline</Label>
          <Input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Optional tagline" className="h-8 text-xs" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Written By</Label>
          <div className="flex flex-wrap gap-1.5">
            {writtenBy.map((name, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs gap-1 pr-1">
                {name}
                <button onClick={() => removeWriter(idx)} className="ml-0.5 hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input value={newWriter} onChange={e => setNewWriter(e.target.value)} placeholder="Add writer name" className="h-7 text-xs flex-1" onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addWriter())} />
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addWriter} disabled={!newWriter.trim()}><Plus className="w-3 h-3" /></Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Produced By</Label>
          <div className="flex flex-wrap gap-1.5">
            {producedBy.map((name, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs gap-1 pr-1">
                {name}
                <button onClick={() => removeProducer(idx)} className="ml-0.5 hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input value={newProducer} onChange={e => setNewProducer(e.target.value)} placeholder="Add producer name" className="h-7 text-xs flex-1" onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addProducer())} />
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addProducer} disabled={!newProducer.trim()}><Plus className="w-3 h-3" /></Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Company Name</Label>
          <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Production company" className="h-8 text-xs" />
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5 text-xs">
            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Save All Credits
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
