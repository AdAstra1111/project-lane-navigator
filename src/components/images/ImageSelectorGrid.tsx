/**
 * ImageSelectorGrid — Reusable image option grid with curation states.
 * Used by Look Book sections and Poster Engine for choosing active images.
 * Supports: selection, curation state transitions, lightbox, compare mode.
 * 
 * Full in-context curation: promote, demote, deactivate, archive, restore.
 * Source provenance: labels native vs external imagery.
 */
import { useState } from 'react';
import {
  Check, Loader2, Star, Expand, ImageIcon, Archive, X, Eye,
  MoreVertical, ArrowUp, ArrowDown, RotateCcw, Crown, Shield, Link2, Unlink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useImageCuration } from '@/hooks/useImageCuration';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import type { ProjectImage, CurationState, ShotType } from '@/lib/images/types';
import { getDisplayAspectClass, getOrientationLabel } from '@/lib/images/orientationUtils';
import { classifyVerticalDramaForBrowsing } from '@/lib/images/verticalCompliance';

// ── Section policy model ─────────────────────────────────────────────────────

export interface SectionPolicy {
  /** Max primary images in section (0 = no primary concept) */
  maxPrimary: number;
  /** Max active images in section */
  maxActive: number;
  /** Whether candidate pool is enabled */
  hasCandidatePool: boolean;
  /** Label for display */
  label?: string;
}

const DEFAULT_POLICY: SectionPolicy = {
  maxPrimary: 1,
  maxActive: 6,
  hasCandidatePool: true,
};

// ── Source provenance ────────────────────────────────────────────────────────

type SourceType = 'generated' | 'uploaded' | 'external';

function resolveSourceType(img: ProjectImage): SourceType {
  if (img.provider === 'upload' || img.provider === 'manual') return 'uploaded';
  if (img.provider && img.provider !== '') return 'generated';
  return 'external';
}

function isProjectNative(img: ProjectImage): boolean {
  const src = resolveSourceType(img);
  return src === 'generated' || src === 'uploaded';
}

const SOURCE_LABELS: Record<SourceType, string> = {
  generated: 'Generated',
  uploaded: 'Uploaded',
  external: 'External Ref',
};

// ── Props ────────────────────────────────────────────────────────────────────

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
  /** Section curation policy */
  sectionPolicy?: SectionPolicy;
  /** Active prestige style filter — only show images matching this style */
  prestigeStyleFilter?: string;
  /** Lane key for compliance badges */
  laneKey?: string;
  /** Include untagged legacy images in strict style filter mode */
  includeLegacyInStyleFilter?: boolean;
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
  images: rawImages,
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
  sectionPolicy = DEFAULT_POLICY,
  prestigeStyleFilter,
  laneKey,
  includeLegacyInStyleFilter = false,
}: ImageSelectorGridProps) {
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);
  const [lightbox, setLightbox] = useState<ProjectImage | null>(null);
  const [compareImages, setCompareImages] = useState<ProjectImage[]>([]);
  const [compareMode, setCompareMode] = useState(false);

  // STRICT style filtering: when a style filter is active, exclude untagged
  // legacy images by default. Only include them if explicitly opted in.
  const images = prestigeStyleFilter
    ? rawImages.filter(img => {
        if (img.prestige_style === prestigeStyleFilter) return true;
        if (!img.prestige_style) return includeLegacyInStyleFilter;
        return false;
      })
    : rawImages;

  const handlePromote = async (image: ProjectImage) => {
    if (updating) return;
    await setPrimary(image);
    onSelectionChange?.();
  };

  const handleCurationAction = async (e: React.MouseEvent, image: ProjectImage, state: CurationState) => {
    e.stopPropagation();
    await setCurationState(image.id, state);
    onSelectionChange?.();
    // Update lightbox state if the lightbox is showing this image
    if (lightbox?.id === image.id) {
      setLightbox({ ...lightbox, curation_state: state, is_primary: false, is_active: state === 'active' || state === 'candidate' });
    }
  };

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
    // Click on non-active = promote; click on active = open lightbox for review
    if (image.curation_state === 'active' || image.is_primary) {
      setLightbox(image);
    } else {
      await handlePromote(image);
    }
  };

  // Group by shot type if available
  const groupedByShot = new Map<string, ProjectImage[]>();
  for (const img of images) {
    const key = img.shot_type || 'untyped';
    if (!groupedByShot.has(key)) groupedByShot.set(key, []);
    groupedByShot.get(key)!.push(img);
  }
  const hasGroups = groupedByShot.size > 1 || (groupedByShot.size === 1 && !groupedByShot.has('untyped'));

  const activeCount = images.filter(i => i.curation_state === 'active').length;
  const primaryCount = images.filter(i => i.is_primary).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Section policy hint */}
      {showCurationControls && images.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {sectionPolicy.maxPrimary > 0 && (
            <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 border-primary/30 text-primary/70">
              <Crown className="h-2.5 w-2.5" />
              {primaryCount}/{sectionPolicy.maxPrimary} primary
            </Badge>
          )}
          <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 border-border text-muted-foreground">
            <Shield className="h-2.5 w-2.5" />
            {activeCount}/{sectionPolicy.maxActive} active
          </Badge>
        </div>
      )}

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
            <div key={img.id} className={cn('relative rounded overflow-hidden', getDisplayAspectClass(img.width, img.height))}>
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
                      showProvenance={showProvenance}
                      laneKey={laneKey}
                      onSelect={handleSelect}
                      onLightbox={setLightbox}
                      onCurationAction={handleCurationAction}
                      onPromote={handlePromote}
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
                showProvenance={showProvenance}
                laneKey={laneKey}
                onSelect={handleSelect}
                onLightbox={setLightbox}
                onCurationAction={handleCurationAction}
                onPromote={handlePromote}
              />
            ))}
          </div>
        )
      )}

      {/* Lightbox with full curation controls */}
      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/95 border-border">
          <DialogTitle className="sr-only">Image detail</DialogTitle>
          {lightbox && (
            <div className="relative">
              {lightbox.signedUrl && (
                <img src={lightbox.signedUrl} alt="" className="w-full h-auto max-h-[80vh] object-contain" />
              )}
              {/* Bottom metadata panel */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {lightbox.is_primary && (
                    <Badge className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0 gap-0.5">
                      <Crown className="h-2.5 w-2.5" /> Primary
                    </Badge>
                  )}
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
                  {/* Source provenance badge */}
                  {showProvenance && (
                    <Badge variant="outline" className={cn(
                      'text-[8px] px-1 py-0',
                      isProjectNative(lightbox)
                        ? 'border-emerald-500/30 text-emerald-400/70'
                        : 'border-amber-500/30 text-amber-400/70',
                    )}>
                      {isProjectNative(lightbox) ? '● Native' : '◆ External'}
                    </Badge>
                  )}
                  <span className="text-[9px] text-white/50 ml-auto">{lightbox.model}</span>
                </div>
                {/* Extended provenance */}
                {showProvenance && (
                  <div className="mt-2 space-y-0.5 text-[9px] text-white/50">
                    <p>Source: <span className="text-white/70">{SOURCE_LABELS[resolveSourceType(lightbox)]}</span></p>
                    {lightbox.strategy_key && (
                      <p>Strategy: <span className="text-white/70">{lightbox.strategy_key}</span></p>
                    )}
                    {lightbox.role && (
                      <p>Role: <span className="text-white/70">{lightbox.role}</span></p>
                    )}
                    {lightbox.provider && (
                      <p>Provider: <span className="text-white/70">{lightbox.provider}</span></p>
                    )}
                    {lightbox.style_mode && (
                      <p>Style: <span className="text-white/70">{lightbox.style_mode}</span></p>
                    )}
                    {lightbox.created_at && (
                      <p>Created: <span className="text-white/70">{new Date(lightbox.created_at).toLocaleDateString()}</span></p>
                    )}
                    {lightbox.prompt_used && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-white/40 hover:text-white/60">Prompt</summary>
                        <p className="mt-1 text-white/50 leading-relaxed max-h-24 overflow-y-auto text-[8px]">
                          {lightbox.prompt_used}
                        </p>
                      </details>
                    )}
                  </div>
                )}
              </div>

              {/* Full curation action bar in lightbox */}
              {showCurationControls && (
                <div className="absolute top-3 right-3 flex gap-1.5 flex-wrap justify-end">
                  {/* Promote actions */}
                  {!lightbox.is_primary && lightbox.curation_state !== 'active' && (
                    <Button size="sm" variant="secondary" className="h-7 text-xs gap-1"
                      disabled={!!updating}
                      onClick={() => { handlePromote(lightbox); setLightbox(null); }}>
                      <Crown className="h-3 w-3" /> Set Primary
                    </Button>
                  )}
                  {lightbox.curation_state !== 'active' && !lightbox.is_primary && (
                    <Button size="sm" variant="secondary" className="h-7 text-xs gap-1"
                      disabled={!!updating}
                      onClick={(e) => { handleCurationAction(e, lightbox, 'active'); }}>
                      <Star className="h-3 w-3" /> Activate
                    </Button>
                  )}
                  {/* Demote actions */}
                  {(lightbox.curation_state === 'active' || lightbox.is_primary) && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-white/70 hover:text-white"
                      disabled={!!updating}
                      onClick={(e) => { handleCurationAction(e, lightbox, 'candidate'); }}>
                      <ArrowDown className="h-3 w-3" /> Demote
                    </Button>
                  )}
                  {/* Archive */}
                  {lightbox.curation_state !== 'archived' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-white/70 hover:text-white"
                      disabled={!!updating}
                      onClick={(e) => { handleCurationAction(e, lightbox, 'archived'); }}>
                      <Archive className="h-3 w-3" /> Archive
                    </Button>
                  )}
                  {/* Restore from archived/rejected */}
                  {(lightbox.curation_state === 'archived' || lightbox.curation_state === 'rejected') && (
                    <Button size="sm" variant="secondary" className="h-7 text-xs gap-1"
                      disabled={!!updating}
                      onClick={(e) => { handleCurationAction(e, lightbox, 'candidate'); }}>
                      <RotateCcw className="h-3 w-3" /> Restore
                    </Button>
                  )}
                  {/* Reject */}
                  {lightbox.curation_state !== 'rejected' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-white/70 hover:text-white"
                      disabled={!!updating}
                      onClick={(e) => { handleCurationAction(e, lightbox, 'rejected'); }}>
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
  showProvenance: boolean;
  laneKey?: string;
  onSelect: (img: ProjectImage) => void;
  onLightbox: (img: ProjectImage) => void;
  onCurationAction: (e: React.MouseEvent, img: ProjectImage, state: CurationState) => void;
  onPromote: (img: ProjectImage) => void;
}

function ImageCard({
  img, updating, compareMode, compareSelected,
  showShotTypes, showCurationControls, showProvenance, laneKey,
  onSelect, onLightbox, onCurationAction, onPromote,
}: ImageCardProps) {
  const isActive = img.curation_state === 'active' || img.is_primary;
  const isArchived = img.curation_state === 'archived' || img.curation_state === 'rejected';
  const isPrimary = img.is_primary;
  const native = isProjectNative(img);

  return (
    <div
      className={cn(
        `group relative rounded-md overflow-hidden border-2 cursor-pointer transition-all ${getDisplayAspectClass(img.width, img.height)} bg-muted`,
        isPrimary
          ? 'border-primary ring-2 ring-primary/40'
          : isActive
            ? 'border-primary/60 ring-1 ring-primary/20'
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

      {/* State badges — top left */}
      <div className="absolute top-1 left-1 flex flex-col gap-0.5">
        {isPrimary && (
          <Badge className="text-[8px] bg-primary text-primary-foreground px-1 py-0 gap-0.5">
            <Crown className="h-2 w-2" /> Primary
          </Badge>
        )}
        {isActive && !isPrimary && (
          <Badge className="text-[9px] bg-primary/80 text-primary-foreground px-1 py-0 gap-0.5">
            <Check className="h-2 w-2" /> Active
          </Badge>
        )}
        {/* Orientation badge with measured dims */}
        <Badge variant="outline" className="text-[7px] px-1 py-0 border-white/30 text-white/70 bg-black/40">
          {getOrientationLabel(img.width, img.height)}
          {img.width && img.height ? ` ${img.width}×${img.height}` : ''}
        </Badge>
        {/* VD compliance indicator when lane is vertical_drama */}
        {laneKey === 'vertical_drama' && (() => {
          const vd = classifyVerticalDramaForBrowsing(img);
          return (
            <Badge variant="outline" className={cn(
              'text-[7px] px-1 py-0 bg-black/40',
              vd.compliant
                ? 'border-emerald-500/50 text-emerald-400'
                : vd.level === 'portrait_only'
                  ? 'border-amber-500/50 text-amber-400'
                  : vd.level === 'square'
                    ? 'border-orange-500/50 text-orange-400'
                    : vd.level === 'unknown_unmeasured'
                      ? 'border-muted text-muted-foreground'
                      : 'border-destructive/50 text-destructive',
            )}>
              {vd.label}
            </Badge>
          );
        })()}
        {/* External indicator */}
        {showProvenance && !native && (
          <Badge variant="outline" className="text-[7px] px-1 py-0 border-amber-500/40 text-amber-400 bg-black/40">
            External
          </Badge>
        )}
        {/* Canonical binding provenance */}
        {showProvenance && (() => {
          const gc = img.generation_config as Record<string, unknown> | null;
          const status = gc?.canonical_binding_status as string | undefined;
          const targeting = gc?.targeting_mode as string | undefined;
          if (!status) return null;

          // Resolve display label from provenance
          const charNames = (gc?.resolved_character_names as string[]) || (gc?.bound_character_names as string[]) || [];
          const locNames = (gc?.resolved_location_names as string[]) || (gc?.bound_location_names as string[]) || [];
          const targetPrefix = targeting === 'exact' ? '⎯' : targeting === 'derived' ? '~' : '';

          if (status === 'bound') {
            const label = charNames.length > 0
              ? charNames.slice(0, 2).join(', ')
              : locNames.length > 0
                ? locNames.slice(0, 2).join(', ')
                : 'Bound';
            return (
              <Badge variant="outline" className="text-[7px] px-1 py-0 border-emerald-500/60 text-emerald-400 bg-black/40 gap-0.5">
                <Link2 className="h-2 w-2" /> {targetPrefix}{label}
              </Badge>
            );
          }
          if (status === 'partially_bound') {
            return (
              <Badge variant="outline" className="text-[7px] px-1 py-0 border-yellow-500/50 text-yellow-400 bg-black/40 gap-0.5">
                <Link2 className="h-2 w-2" /> {targetPrefix || ''}Partial
              </Badge>
            );
          }
          if (status === 'unbound') {
            return (
              <Badge variant="outline" className="text-[7px] px-1 py-0 border-red-500/40 text-red-400/70 bg-black/40 gap-0.5">
                <Unlink className="h-2 w-2" /> Unbound
              </Badge>
            );
          }
          return null;
        })()}
      </div>

      {/* Shot type badge */}
      {showShotTypes && img.shot_type && !isActive && !isPrimary && (
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

      {/* Bottom actions — context menu + expand */}
      <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {showCurationControls && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 rounded bg-black/60 text-white hover:bg-black/80"
                onClick={(e) => e.stopPropagation()}
                title="Curation actions"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              {/* Promote actions */}
              {!isPrimary && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPromote(img); }}>
                  <Crown className="h-3 w-3 mr-1.5" /> Set as Primary
                </DropdownMenuItem>
              )}
              {img.curation_state !== 'active' && !isPrimary && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCurationAction(e as any, img, 'active'); }}>
                  <Star className="h-3 w-3 mr-1.5" /> Activate
                </DropdownMenuItem>
              )}
              {/* Demote actions */}
              {(isActive || isPrimary) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCurationAction(e as any, img, 'candidate'); }}>
                    <ArrowDown className="h-3 w-3 mr-1.5" /> Demote to Candidate
                  </DropdownMenuItem>
                </>
              )}
              {/* Archive / Restore */}
              <DropdownMenuSeparator />
              {img.curation_state !== 'archived' && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCurationAction(e as any, img, 'archived'); }}>
                  <Archive className="h-3 w-3 mr-1.5" /> Archive
                </DropdownMenuItem>
              )}
              {(img.curation_state === 'archived' || img.curation_state === 'rejected') && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCurationAction(e as any, img, 'candidate'); }}>
                  <RotateCcw className="h-3 w-3 mr-1.5" /> Restore
                </DropdownMenuItem>
              )}
              {img.curation_state !== 'rejected' && (
                <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onCurationAction(e as any, img, 'rejected'); }}>
                  <X className="h-3 w-3 mr-1.5" /> Reject
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          className="p-1 rounded bg-black/60 text-white hover:bg-black/80"
          onClick={(e) => { e.stopPropagation(); onLightbox(img); }}
          title="Enlarge"
        >
          <Expand className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
