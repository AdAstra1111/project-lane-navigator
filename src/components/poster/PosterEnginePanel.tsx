/**
 * PosterEnginePanel — Project poster generation, upload, preview, and versioning.
 * Lives within the project workspace as a dedicated page.
 */
import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  Image, RefreshCw, Upload, Trash2, CheckCircle2, AlertTriangle,
  Loader2, Sparkles, Star, Eye, ChevronDown,
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

export default function PosterEnginePanel() {
  const { id: projectId } = useParams<{ id: string }>();
  const { data: project } = useProject(projectId || "");
  const { data: posters, isLoading } = useProjectPosters(projectId);
  const { data: activePoster } = useActivePoster(projectId);
  const generatePoster = useGeneratePoster(projectId);
  const uploadPoster = useUploadPosterKeyArt(projectId);
  const setActivePoster = useSetActivePoster(projectId);
  const deletePoster = useDeletePoster(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  const isGenerating = generatePoster.isPending;
  const isUploading = uploadPoster.isPending;
  const isBusy = isGenerating || isUploading;

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadPoster.mutate(file);
    e.target.value = "";
  };

  const generatingPoster = posters?.find(p => p.status === "generating");
  const failedPosters = posters?.filter(p => p.status === "failed") || [];
  const readyPosters = posters?.filter(p => p.status === "ready") || [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Image className="w-5 h-5 text-primary" />
            Poster Engine
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Generate cinematic key art and branded poster layout for your project.
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
            Upload Key Art
          </Button>
          <Button
            size="sm"
            disabled={isBusy}
            onClick={() => generatePoster.mutate()}
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
                {readyPosters.length > 0 ? "Regenerate" : "Generate Poster"}
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </div>

      {/* Active Poster Preview */}
      {activePoster ? (
        <Card className="bg-card border-border/40">
          <CardContent className="p-6">
            <div className="flex gap-6">
              {/* Poster Canvas */}
              <div className="flex-shrink-0">
                <PosterCompositor
                  keyArtUrl={activePoster.key_art_public_url || ""}
                  title={project?.title || "Untitled"}
                  width={320}
                  className="shadow-2xl"
                />
              </div>

              {/* Poster Info */}
              <div className="flex-1 space-y-4 min-w-0">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Active — v{activePoster.version_number}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {activePoster.source_type === "generated" ? "AI Generated" : "Uploaded"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {activePoster.aspect_ratio}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {activePoster.layout_variant} • {new Date(activePoster.created_at).toLocaleDateString()}
                  </p>
                </div>

                {/* Prompt Provenance */}
                {activePoster.prompt_text && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Generation Prompt
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                      {activePoster.prompt_text}
                    </p>
                    <button
                      onClick={() => setSelectedPrompt(
                        selectedPrompt === activePoster.id ? null : activePoster.id
                      )}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {selectedPrompt === activePoster.id ? "Hide full prompt" : "View full prompt"}
                    </button>
                    {selectedPrompt === activePoster.id && (
                      <pre className="text-[10px] text-muted-foreground bg-muted/30 p-3 rounded mt-1 whitespace-pre-wrap max-h-48 overflow-auto">
                        {activePoster.prompt_text}
                      </pre>
                    )}
                  </div>
                )}

                {/* Provider info */}
                {activePoster.provider && (
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>Provider: {activePoster.provider}</span>
                    {activePoster.model && <span>Model: {activePoster.model}</span>}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : !isLoading && !isGenerating ? (
        <Card className="bg-card border-border/40 border-dashed">
          <CardContent className="p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mx-auto">
              <Image className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No poster yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Generate cinematic key art from your project data, or upload your own image.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button
                size="sm"
                onClick={() => generatePoster.mutate()}
                disabled={isBusy}
                className="gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate Poster
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
      ) : null}

      {/* Generating state */}
      {(isGenerating || generatingPoster) && (
        <Card className="bg-card border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Generating poster…</p>
              <p className="text-xs text-muted-foreground">
                Building cinematic key art from your project data. This may take a moment.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Failed posters */}
      {failedPosters.length > 0 && (
        <div className="space-y-2">
          {failedPosters.slice(0, 2).map(fp => (
            <Card key={fp.id} className="bg-destructive/5 border-destructive/20">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      v{fp.version_number} failed
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {fp.error_message || "Unknown error"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => generatePoster.mutate()}
                    disabled={isBusy}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => deletePoster.mutate(fp.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Version History */}
      {readyPosters.length > 1 && (
        <Collapsible open={showHistory} onOpenChange={setShowHistory}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={cn(
                "w-3.5 h-3.5 transition-transform",
                showHistory && "rotate-180"
              )} />
              Poster History ({readyPosters.length} versions)
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {readyPosters.map(poster => (
                <PosterVersionCard
                  key={poster.id}
                  poster={poster}
                  projectTitle={project?.title || "Untitled"}
                  isActive={poster.id === activePoster?.id}
                  onSetActive={() => setActivePoster.mutate(poster.id)}
                  onDelete={() => deletePoster.mutate(poster.id)}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ── Version Card ──────────────────────────────────────────────────────────────

function PosterVersionCard({
  poster,
  projectTitle,
  isActive,
  onSetActive,
  onDelete,
}: {
  poster: ProjectPoster;
  projectTitle: string;
  isActive: boolean;
  onSetActive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn(
      "relative group rounded-lg overflow-hidden border transition-colors",
      isActive ? "border-primary/40 ring-1 ring-primary/20" : "border-border/30 hover:border-border/60"
    )}>
      <PosterCompositor
        keyArtUrl={poster.key_art_public_url || ""}
        title={projectTitle}
        width={160}
      />

      {/* Overlay controls */}
      <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
        {!isActive && (
          <Button size="sm" variant="secondary" className="h-6 text-[10px] gap-1" onClick={onSetActive}>
            <Star className="w-3 h-3" />
            Set Active
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-destructive" onClick={onDelete}>
          <Trash2 className="w-3 h-3" />
          Delete
        </Button>
      </div>

      {/* Version badge */}
      <div className="absolute top-1.5 left-1.5">
        <Badge variant="outline" className="text-[9px] bg-background/80 backdrop-blur-sm">
          v{poster.version_number}
        </Badge>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div className="absolute top-1.5 right-1.5">
          <CheckCircle2 className="w-4 h-4 text-primary" />
        </div>
      )}
    </div>
  );
}
