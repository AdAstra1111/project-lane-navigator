/**
 * PosterEnginePanel — Multi-concept poster generation with strategic creative directions.
 * Generates 6 distinct poster concepts based on project canon, allows selection.
 * All text/credits are composited deterministically from structured editable fields.
 * 
 * Features:
 * - Template selector (layout variant) per poster
 * - Live preview on credit changes (debounced auto-save)
 * - Download composed poster as PNG
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useVisualDecision } from "@/hooks/useVisualDecision";
import { DecisionBadge } from "@/components/visual-decisions/DecisionBadge";
import { useParams } from "react-router-dom";
import {
  Image, RefreshCw, Upload, Trash2, CheckCircle2, AlertTriangle,
  Loader2, Sparkles, Star, ChevronDown, User, Mountain,
  Swords, Award, Megaphone, Drama, PenLine, Plus, X,
  Download, Layout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PosterCompositor, type PosterCreditsData, type PosterLayoutVariant, POSTER_TEMPLATES } from "@/components/poster/PosterCompositor";
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

/**
 * Always uses PosterCompositor — deterministic text overlay, no baked-in hallucinated text.
 */
function PosterImage({
  poster,
  title,
  branding,
  credits,
  layoutVariant,
  width,
  className,
  onCanvasReady,
}: {
  poster: ProjectPoster;
  title: string;
  branding: { companyLogoUrl: string | null; companyName: string | null } | null;
  credits?: PosterCreditsData;
  layoutVariant?: PosterLayoutVariant;
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
      width={width}
      onRender={onCanvasReady}
      className={className}
    />
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePosterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreditsEditor, setShowCreditsEditor] = useState(false);
  // ── Visual Decision: Poster Style ──
  const posterStyleDecision = useVisualDecision(projectId, 'poster_style');
  const selectedTemplate = (posterStyleDecision.effective || 'cinematic-dark') as PosterLayoutVariant;
  const setSelectedTemplate = useCallback((v: string) => {
    posterStyleDecision.select(v);
  }, [posterStyleDecision]);

  // Auto-seed recommendation on first load
  useEffect(() => {
    if (projectId && !posterStyleDecision.recommended && !posterStyleDecision.isLoading) {
      posterStyleDecision.refreshRecommendation();
    }
  }, [projectId, posterStyleDecision.recommended, posterStyleDecision.isLoading]);

  // ── Visual Decision: Primary Poster ──
  const posterPrimaryDecision = useVisualDecision(projectId, 'poster_primary');

  const isGenerating = generatePoster.isPending;
  const isUploading = uploadPoster.isPending;
  const isBusy = isGenerating || isUploading;

  // Build credits data for compositor — use live local state for instant preview
  const [liveCredits, setLiveCredits] = useState<PosterCreditsData | null>(null);

  const creditsData: PosterCreditsData = liveCredits || {
    writtenBy: posterCredits?.written_by || [],
    producedBy: posterCredits?.produced_by || [],
    createdByCredit: posterCredits?.created_by_credit || null,
    basedOnCredit: posterCredits?.based_on_credit || null,
  };

  // Sync from server when posterCredits loads
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
            Poster Engine
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Generate 6 theatrical poster concepts. Title and credits are composited from your editable billing fields.
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
        {/* Template selector */}
        <div className="flex flex-col gap-2 px-4 py-2.5 bg-card/50 rounded-lg border border-border/30">
          <div className="flex items-center gap-3">
            <Layout className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Layout Template</span>
            <Select value={selectedTemplate} onValueChange={(v) => setSelectedTemplate(v as PosterLayoutVariant)}>
              <SelectTrigger className="w-48 h-7 text-xs">
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
      </div>

      {/* Generating state */}
      {(isGenerating || generatingPosters.length > 0) && (
        <Card className="bg-card border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Generating theatrical poster key art…</p>
              <p className="text-xs text-muted-foreground">
                Creating 6 distinct visual directions. Title and credits will be composited automatically. ~90 seconds.
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
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm font-medium text-foreground">Active Poster</span>
                  <Badge variant="outline" className="text-[9px]">v{activePoster.version_number}</Badge>
                  {STRATEGY_META[activePoster.layout_variant] && (
                    <Badge variant="secondary" className="text-[9px]">
                      {activePoster.layout_variant}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {activePoster.source_type === "generated" ? "AI Key Art" : "Uploaded"} • Template: {POSTER_TEMPLATES[selectedTemplate]?.label || selectedTemplate}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={handleDownloadPoster}
                  >
                    <Download className="w-3 h-3" />
                    Download Poster
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

                      {/* Active indicator */}
                      {isActive && (
                        <div className="absolute top-2 right-2 bg-primary rounded-full p-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                        <p className="text-[10px] text-muted-foreground text-center px-4 mb-1">
                          {meta.description}
                        </p>
                        {!isActive && (
                          <Button
                            size="sm"
                            className="h-7 text-[10px] gap-1"
                            onClick={() => setActivePoster.mutate(poster.id)}
                          >
                            <Star className="w-3 h-3" />
                            Select as Primary
                          </Button>
                        )}
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[9px] gap-1"
                            onClick={() => handleRegenerateOne(key)}
                            disabled={isBusy}
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                            Redo
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[9px] gap-1 text-destructive"
                            onClick={() => deletePoster.mutate(poster.id)}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="aspect-[2/3] flex flex-col items-center justify-center gap-2 bg-muted/10">
                      <Icon className={cn("w-6 h-6", meta.color, "opacity-40")} />
                      <span className="text-[10px] text-muted-foreground capitalize">{key}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[9px] gap-1"
                        onClick={() => handleRegenerateOne(key)}
                        disabled={isBusy}
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        Generate
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
                Generate 6 theatrical poster directions — Character, World, Conflict, Prestige, Commercial, and Genre — 
                all faithful to your project's story world. Title and credits are composited from your editable billing fields.
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Upload Image
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
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => handleRegenerateOne(fp.layout_variant)}
                  disabled={isBusy}
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Retry
                </Button>
              )}
              <Button
                variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                onClick={() => deletePoster.mutate(fp.id)}
              >
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
                    "relative group rounded-lg overflow-hidden border transition-colors",
                    poster.id === activePoster?.id ? "border-primary/40 ring-1 ring-primary/20" : "border-border/30"
                  )}
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
                    {poster.id !== activePoster?.id && (
                      <Button size="sm" variant="secondary" className="h-6 text-[10px] gap-1" onClick={() => setActivePoster.mutate(poster.id)}>
                        <Star className="w-3 h-3" /> Set Active
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-destructive" onClick={() => deletePoster.mutate(poster.id)}>
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
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

  // Push live changes for instant preview
  const pushLive = useCallback((wb: string[], pb: string[]) => {
    onLiveChange({
      writtenBy: wb,
      producedBy: pb,
      createdByCredit: credits.created_by_credit || null,
      basedOnCredit: credits.based_on_credit || null,
    });
  }, [onLiveChange, credits.created_by_credit, credits.based_on_credit]);

  // Debounced auto-save
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
          These fields control the text composited onto your poster. No names will be invented — only what you enter here appears. Changes preview instantly.
        </p>

        {/* Title Override */}
        <div className="space-y-1.5">
          <Label className="text-xs">Poster Title</Label>
          <Input
            value={titleOverride}
            onChange={e => setTitleOverride(e.target.value)}
            placeholder={projectTitle}
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">Leave blank to use project title</p>
        </div>

        {/* Tagline */}
        <div className="space-y-1.5">
          <Label className="text-xs">Tagline</Label>
          <Input
            value={tagline}
            onChange={e => setTagline(e.target.value)}
            placeholder="Optional tagline"
            className="h-8 text-xs"
          />
        </div>

        {/* Written By */}
        <div className="space-y-1.5">
          <Label className="text-xs">Written By</Label>
          <div className="flex flex-wrap gap-1.5">
            {writtenBy.map((name, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs gap-1 pr-1">
                {name}
                <button onClick={() => removeWriter(idx)} className="ml-0.5 hover:text-destructive">
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={newWriter}
              onChange={e => setNewWriter(e.target.value)}
              placeholder="Add writer name"
              className="h-7 text-xs flex-1"
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addWriter())}
            />
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addWriter} disabled={!newWriter.trim()}>
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Produced By */}
        <div className="space-y-1.5">
          <Label className="text-xs">Produced By</Label>
          <div className="flex flex-wrap gap-1.5">
            {producedBy.map((name, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs gap-1 pr-1">
                {name}
                <button onClick={() => removeProducer(idx)} className="ml-0.5 hover:text-destructive">
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={newProducer}
              onChange={e => setNewProducer(e.target.value)}
              placeholder="Add producer name"
              className="h-7 text-xs flex-1"
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addProducer())}
            />
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addProducer} disabled={!newProducer.trim()}>
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Company Name */}
        <div className="space-y-1.5">
          <Label className="text-xs">Company Name</Label>
          <Input
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="Production company"
            className="h-8 text-xs"
          />
        </div>

        {/* Save */}
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
