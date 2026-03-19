/**
 * ImageSelectorGrid — Reusable image option grid with curation states.
 * Used by Look Book sections and Poster Engine for choosing active images.
 * Supports: selection, curation state transitions, lightbox, compare mode.
 */
import { useState } from 'react';
import { Check, Loader2, Star, Expand, ImageIcon, Archive, X, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useImageCuration } from '@/hooks/useImageCuration';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import type { ProjectImage, CurationState, ShotType } from '@/lib/images/types';

interface ImageSelectorGridProps {
  projectId: string;
  images: ProjectImage[];
  isLoading?: boolean;
  onGenerate?: () => void;
  isGenerating?: boolean;
  generateLabel?: string;
  emptyLabel?: string;
  onSelectionChange?: () => void;
  className?: string;
  /** Show shot type badges */
  showShotTypes?: boolean;
  /** Show curation state controls */
  showCurationControls?: boolean;
  /** Enable compare mode */
  enableCompare?: boolean;
  /** Show image provenance metadata */
  showProvenance?: boolean;
}

const STATE_COLORS: Record<CurationState, string> = {
  active: 'bg-primary/90 text-primary-foreground',
  candidate: 'bg-muted text-muted-foreground',
  archived: 'bg-muted/60 text-muted-foreground/60',
  rejected: 'bg-destructive/20 text-destructive',
};

const STATE_LABELS: Record<CurationState, string> = {
  active: 'Active',
  candidate: 'Candidate',
  archived: 'Archived',
  rejected: 'Rejected',
};

export function ImageSelectorGrid({
  projectId,
  images,
  isLoading,
  onGenerate,
  isGenerating,
  generateLabel = 'Generate Pack',
  emptyLabel = 'No images generated yet',
  onSelectionChange,
  className,
  showShotTypes = true,
  showCurationControls = true,
  enableCompare = false,
  showProvenance = false,
}: ImageSelectorGridProps) {
  const { setActiveForSlot, setCurationState, updating } = useImageCuration(projectId);
  const [lightbox, setLightbox] = useState<ProjectImage | null>(null);
  const [compareImages, setCompareImages] = useState<ProjectImage[]>([]);
  const [compareMode, setCompareMode] = useState(false);

  const handleSelect = async (image: ProjectImage) => {
    if (updating) return;
    if (compareMode) {
      setCompareImages(prev => {
        const exists = prev.find(i => i.id === image.id);
        if (exists) return prev.filter(i => i.id !== image.id);
        if (prev.length >= 2) return [prev[1], image];
        return [...prev, image];
      });
      return;
    }
    await setActiveForSlot(image);
    onSelectionChange?.();
  };

  const handleCurationAction = async (e: React.MouseEvent, image: ProjectImage, state: CurationState) => {
    e.stopPropagation();
    await setCurationState(image.id, state);
    onSelectionChange?.();
  };

  // Group by shot type if available
  const groupedByShot = new Map<string, ProjectImage[]>();
  for (const img of images) {
    const key = img.shot_type || 'untyped';
    if (!groupedByShot.has(key)) groupedByShot.set(key, []);
    groupedByShot.get(key)!.push(img);
  }
  const hasGroups = groupedByShot.size > 1 || (groupedByShot.size === 1 && !groupedByShot.has('untyped'));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Action row */}
      {onGenerate && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {images.length > 0 ? `${images.length} images` : emptyLabel}
          </span>
          <div className="flex items-center gap-1.5">
            {enableCompare && images.length >= 2 && (
              <Button
                size="sm"
                variant={compareMode ? 'default' : 'ghost'}
                className="gap-1 text-xs h-7"
                onClick={() => { setCompareMode(!compareMode); setCompareImages([]); }}
              >
                <Eye className="h-3 w-3" />
                {compareMode ? 'Exit Compare' : 'Compare'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
              ) : (
                <><ImageIcon className="h-3 w-3" /> {generateLabel}</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Compare view */}
      {compareMode && compareImages.length === 2 && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary/30 p-2 bg-muted/30">
          {compareImages.map(img => (
            <div key={img.id} className="relative aspect-video rounded overflow-hidden">
              {img.signedUrl ? (
                <img src={img.signedUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                </div>
              )}
              {img.shot_type && (
                <Badge variant="secondary" className="absolute bottom-1 left-1 text-[8px] px-1 py-0">
                  {SHOT_TYPE_LABELS[img.shot_type as ShotType] || img.shot_type}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Grid — grouped by shot type or flat */}
      {images.length > 0 && (
        hasGroups && showShotTypes ? (
          <div className="space-y-3">
            {Array.from(groupedByShot.entries()).map(([shotKey, shotImages]) => (
              <div key={shotKey}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                  {SHOT_TYPE_LABELS[shotKey as ShotType] || shotKey}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {shotImages.map(img => (
                    <ImageCard
                      key={img.id}
                      img={img}
                      updating={updating}
                      compareMode={compareMode}
                      compareSelected={compareImages.some(c => c.id === img.id)}
                      showShotTypes={false}
                      showCurationControls={showCurationControls}
                      onSelect={handleSelect}
                      onLightbox={setLightbox}
                      onCurationAction={handleCurationAction}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {images.map(img => (
              <ImageCard
                key={img.id}
                img={img}
                updating={updating}
                compareMode={compareMode}
                compareSelected={compareImages.some(c => c.id === img.id)}
                showShotTypes={showShotTypes}
                showCurationControls={showCurationControls}
                onSelect={handleSelect}
                onLightbox={setLightbox}
                onCurationAction={handleCurationAction}
              />
            ))}
          </div>
        )
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/95 border-border">
          <DialogTitle className="sr-only">Image detail</DialogTitle>
          {lightbox && (
            <div className="relative">
              {lightbox.signedUrl && (
                <img src={lightbox.signedUrl} alt="" className="w-full h-auto max-h-[80vh] object-contain" />
              )}
              {/* Metadata panel */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {lightbox.shot_type && (
                    <Badge variant="secondary" className="text-[9px]">
                      {SHOT_TYPE_LABELS[lightbox.shot_type as ShotType] || lightbox.shot_type}
                    </Badge>
                  )}
                  {lightbox.asset_group && (
                    <Badge variant="outline" className="text-[9px] border-white/30 text-white/70">
                      {lightbox.asset_group}
                    </Badge>
                  )}
                  {lightbox.subject && (
                    <Badge variant="outline" className="text-[9px] border-white/30 text-white/70">
                      {lightbox.subject}
                    </Badge>
                  )}
                  <Badge className={cn('text-[9px] px-1 py-0', STATE_COLORS[lightbox.curation_state || 'candidate'])}>
                    {STATE_LABELS[lightbox.curation_state || 'candidate']}
                  </Badge>
                  <span className="text-[9px] text-white/50 ml-auto">{lightbox.model}</span>
                </div>
              </div>
              {/* Curation actions in lightbox */}
              {showCurationControls && (
                <div className="absolute top-3 right-3 flex gap-1.5">
                  {lightbox.curation_state !== 'active' && (
                    <Button size="sm" variant="secondary" className="h-7 text-xs gap-1"
                      onClick={(e) => handleCurationAction(e, lightbox, 'active')}>
                      <Star className="h-3 w-3" /> Select
                    </Button>
                  )}
                  {lightbox.curation_state !== 'archived' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-white/70 hover:text-white"
                      onClick={(e) => handleCurationAction(e, lightbox, 'archived')}>
                      <Archive className="h-3 w-3" /> Archive
                    </Button>
                  )}
                  {lightbox.curation_state !== 'rejected' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-white/70 hover:text-white"
                      onClick={(e) => handleCurationAction(e, lightbox, 'rejected')}>
                      <X className="h-3 w-3" /> Reject
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Individual Image Card ────────────────────────────────────────────────────

interface ImageCardProps {
  img: ProjectImage;
  updating: string | null;
  compareMode: boolean;
  compareSelected: boolean;
  showShotTypes: boolean;
  showCurationControls: boolean;
  onSelect: (img: ProjectImage) => void;
  onLightbox: (img: ProjectImage) => void;
  onCurationAction: (e: React.MouseEvent, img: ProjectImage, state: CurationState) => void;
}

function ImageCard({
  img, updating, compareMode, compareSelected,
  showShotTypes, showCurationControls,
  onSelect, onLightbox, onCurationAction,
}: ImageCardProps) {
  const isActive = img.curation_state === 'active' || img.is_primary;
  const isArchived = img.curation_state === 'archived' || img.curation_state === 'rejected';

  return (
    <div
      className={cn(
        'group relative rounded-md overflow-hidden border-2 cursor-pointer transition-all aspect-video bg-muted',
        isActive
          ? 'border-primary ring-1 ring-primary/30'
          : compareSelected
            ? 'border-accent ring-1 ring-accent/40'
            : isArchived
              ? 'border-border/30 opacity-50'
              : 'border-border/50 hover:border-primary/40',
      )}
      onClick={() => onSelect(img)}
    >
      {img.signedUrl ? (
        <img src={img.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
        </div>
      )}

      {/* State badge */}
      {isActive && (
        <div className="absolute top-1 left-1">
          <Badge className="text-[9px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
            <Check className="h-2 w-2" /> Active
          </Badge>
        </div>
      )}

      {/* Shot type badge */}
      {showShotTypes && img.shot_type && !isActive && (
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-black/50 text-white/80 border-0">
            {SHOT_TYPE_LABELS[img.shot_type as ShotType] || img.shot_type}
          </Badge>
        </div>
      )}

      {/* Compare indicator */}
      {compareMode && compareSelected && (
        <div className="absolute top-1 right-1">
          <Badge className="text-[9px] bg-accent text-accent-foreground px-1 py-0">
            Compare
          </Badge>
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
        {updating === img.id ? (
          <Loader2 className="h-4 w-4 animate-spin text-white opacity-0 group-hover:opacity-100" />
        ) : !isActive && !compareMode ? (
          <Star className="h-4 w-4 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
        ) : null}
      </div>

      {/* Bottom actions */}
      <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {showCurationControls && !isArchived && img.curation_state !== 'active' && (
          <button
            className="p-1 rounded bg-black/50 text-white hover:bg-black/70"
            onClick={(e) => onCurationAction(e, img, 'archived')}
            title="Archive"
          >
            <Archive className="h-3 w-3" />
          </button>
        )}
        <button
          className="p-1 rounded bg-black/50 text-white hover:bg-black/70"
          onClick={(e) => { e.stopPropagation(); onLightbox(img); }}
          title="Enlarge"
        >
          <Expand className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
