/**
 * PosterEnginePanel — Multi-concept poster generation with strategic creative directions.
 * Generates 6 distinct poster concepts based on project canon, allows selection.
 */
import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  Image, RefreshCw, Upload, Trash2, CheckCircle2, AlertTriangle,
  Loader2, Sparkles, Star, ChevronDown, User, Mountain,
  Swords, Award, Megaphone, Drama,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PosterCompositor } from "@/components/poster/PosterCompositor";
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

const STRATEGY_META: Record<string, { icon: typeof User; color: string; description: string }> = {
  character:  { icon: User,     color: "text-blue-400",   description: "Lead character dominant, emotional, intimate" },
  world:      { icon: Mountain, color: "text-emerald-400", description: "Setting dominant, cinematic scale, vast" },
  conflict:   { icon: Swords,   color: "text-red-400",     description: "Tension, confrontation, dynamic stakes" },
  prestige:   { icon: Award,    color: "text-amber-400",   description: "Minimal, metaphor-driven, festival style" },
  commercial: { icon: Megaphone, color: "text-purple-400", description: "Bold hook, strong title, mainstream appeal" },
  genre:      { icon: Drama,    color: "text-orange-400",  description: "Pure genre conventions, instant recognition" },
};

/**
 * Renders a poster image — uses direct img for composed finals (text baked in),
 * falls back to PosterCompositor canvas for key-art-only uploads.
 */
function PosterImage({
  poster,
  title,
  branding,
  width,
  className,
}: {
  poster: ProjectPoster;
  title: string;
  branding: { companyLogoUrl: string | null; companyName: string | null } | null;
  width: number;
  className?: string;
}) {
  const isComposed = poster.render_status === "composed_final" || poster.render_status === "composed_preview";
  const imageUrl = poster.rendered_public_url || poster.key_art_public_url;

  if (isComposed && imageUrl) {
    const height = Math.round(width * 1.5); // 2:3 ratio
    return (
      <img
        src={imageUrl}
        alt={`${title} poster — ${poster.layout_variant}`}
        className={cn("object-cover", className)}
        style={{ width, height, borderRadius: 8 }}
        loading="lazy"
      />
    );
  }

  // Fallback: key-art-only → use compositor for text overlay
  return (
    <PosterCompositor
      keyArtUrl={imageUrl || ""}
      title={title}
      companyLogoUrl={branding?.companyLogoUrl}
      companyName={branding?.companyName}
      width={width}
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
  const generatePoster = useGeneratePoster(projectId);
  const uploadPoster = useUploadPosterKeyArt(projectId);
  const setActivePoster = useSetActivePoster(projectId);
  const deletePoster = useDeletePoster(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  const isGenerating = generatePoster.isPending;
  const isUploading = uploadPoster.isPending;
  const isBusy = isGenerating || isUploading;

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
            Generate 6 theatrical poster concepts from your project's story, world, and tone.
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

      {/* Generating state */}
      {(isGenerating || generatingPosters.length > 0) && (
        <Card className="bg-card border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Generating theatrical poster concepts…</p>
              <p className="text-xs text-muted-foreground">
                Creating 6 distinct poster directions faithful to your project's world. This takes ~90 seconds.
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
                title={project?.title || "Untitled"}
                branding={branding || null}
                width={80}
                className="rounded shadow-lg"
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
                  {activePoster.source_type === "generated" ? "AI Generated" : "Uploaded"} • Used in export package
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
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
                        title={project?.title || "Untitled"}
                        branding={branding || null}
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
                all faithful to your project's story world with title and credit treatment.
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
                    title={project?.title || "Untitled"}
                    branding={branding || null}
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
