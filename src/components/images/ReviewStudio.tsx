/**
 * ReviewStudio — Primary image review workspace.
 * Replaces the buried "Approval Queue" button with a full-surface creative review experience.
 * Images are the focus; pipeline metadata is secondary.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  CheckCircle, XCircle, Recycle, Eye, Expand, Filter,
  Crown, ShieldCheck, AlertTriangle, Unlink, Link,
  Image as ImageIcon, SlidersHorizontal, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useVisualCanonReset } from '@/hooks/useVisualCanonReset';
import { useImageCuration } from '@/hooks/useImageCuration';
import { ImageLightbox } from './ImageLightbox';
import { ImageComparisonView } from './ImageComparisonView';
import type { ProjectImage, CurationState, ShotType } from '@/lib/images/types';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import { getOrientationLabel } from '@/lib/images/orientationUtils';
import { classifyIdentityContinuity, resolveIdentityAnchorsFromImages, type IdentityAnchorMap } from '@/lib/images/characterIdentityAnchorSet';

type FilterState = 'candidate' | 'active' | 'archived' | 'all';
type GroupBy = 'none' | 'section' | 'character' | 'shot_type';

interface ReviewStudioProps {
  projectId: string;
}

const SECTION_LABELS: Record<string, string> = {
  character: 'Characters',
  world: 'World & Locations',
  visual_language: 'Visual Language',
  key_moment: 'Key Moments',
  poster: 'Poster Directions',
};

export function ReviewStudio({ projectId }: ReviewStudioProps) {
  const [filter, setFilter] = useState<FilterState>('candidate');
  const [groupBy, setGroupBy] = useState<GroupBy>('section');
  const [shotFilter, setShotFilter] = useState<string>('all');
  const [characterFilter, setCharacterFilter] = useState<string>('all');
  const [lightboxImage, setLightboxImage] = useState<ProjectImage | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<ProjectImage[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  // Load images
  const curationStates: CurationState[] = filter === 'all'
    ? ['active', 'candidate', 'archived']
    : [filter as CurationState];

  const { data: images = [], isLoading } = useProjectImages(projectId, {
    activeOnly: false,
    curationStates,
    limit: 500,
  });

  const { approveIntoCanon, rejectCandidate } = useVisualCanonReset(projectId);
  const { setCurationState } = useImageCuration(projectId);

  // Derive identity anchors
  const identityAnchorMap: IdentityAnchorMap = useMemo(
    () => resolveIdentityAnchorsFromImages(images),
    [images],
  );

  // Extract unique values for filters
  const uniqueCharacters = useMemo(() => {
    const chars = new Set<string>();
    images.forEach(img => { if (img.subject) chars.add(img.subject); });
    return Array.from(chars).sort();
  }, [images]);

  const uniqueShotTypes = useMemo(() => {
    const types = new Set<string>();
    images.forEach(img => { if (img.shot_type) types.add(img.shot_type); });
    return Array.from(types).sort();
  }, [images]);

  // Filter images
  const filteredImages = useMemo(() => {
    let result = images;
    if (shotFilter !== 'all') {
      result = result.filter(img => img.shot_type === shotFilter);
    }
    if (characterFilter !== 'all') {
      result = result.filter(img => img.subject === characterFilter);
    }
    return result;
  }, [images, shotFilter, characterFilter]);

  // Group images
  const groupedImages = useMemo(() => {
    if (groupBy === 'none') return { 'All Images': filteredImages };

    const groups: Record<string, ProjectImage[]> = {};
    for (const img of filteredImages) {
      let key: string;
      if (groupBy === 'section') {
        const ag = (img as any).asset_group as string || 'uncategorized';
        key = SECTION_LABELS[ag] || ag;
      } else if (groupBy === 'character') {
        key = img.subject || 'Unassigned';
      } else {
        key = img.shot_type
          ? (SHOT_TYPE_LABELS[img.shot_type as ShotType] || img.shot_type)
          : 'Unspecified';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(img);
    }
    return groups;
  }, [filteredImages, groupBy]);

  // Actions
  const handleApprove = useCallback((img: ProjectImage) => {
    approveIntoCanon(img);
  }, [approveIntoCanon]);

  const handleReject = useCallback((imgId: string) => {
    rejectCandidate(imgId, false);
  }, [rejectCandidate]);

  const handleReuse = useCallback((imgId: string) => {
    rejectCandidate(imgId, true);
  }, [rejectCandidate]);

  const handleArchive = useCallback((imgId: string) => {
    setCurationState(imgId, 'archived');
  }, [setCurationState]);

  const toggleCompare = useCallback((img: ProjectImage) => {
    setSelectedForCompare(prev => {
      const exists = prev.find(i => i.id === img.id);
      if (exists) return prev.filter(i => i.id !== img.id);
      if (prev.length >= 4) return [...prev.slice(1), img];
      return [...prev, img];
    });
  }, []);

  const candidateCount = images.filter(i => i.curation_state === 'candidate').length;
  const activeCount = images.filter(i => i.curation_state === 'active').length;
  const hasFilters = shotFilter !== 'all' || characterFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* ── Header strip ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Review Studio</h2>
          {candidateCount > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
              {candidateCount} pending
            </Badge>
          )}
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
            {activeCount} approved
          </Badge>
        </div>

        {selectedForCompare.length >= 2 && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
            onClick={() => setShowComparison(true)}>
            <Eye className="h-3 w-3" /> Compare ({selectedForCompare.length})
          </Button>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status filter tabs */}
        <div className="flex items-center bg-muted/40 rounded-md p-0.5 gap-0.5">
          {([
            { key: 'candidate' as FilterState, label: 'Pending', count: candidateCount },
            { key: 'active' as FilterState, label: 'Approved', count: activeCount },
            { key: 'archived' as FilterState, label: 'Archived' },
            { key: 'all' as FilterState, label: 'All' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'px-2.5 py-1 rounded text-[10px] font-medium transition-colors',
                filter === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {'count' in tab && tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-[9px] opacity-60">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border/50" />

        {/* Group by */}
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="h-7 w-[120px] text-[10px]">
            <SlidersHorizontal className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="section" className="text-xs">By Section</SelectItem>
            <SelectItem value="character" className="text-xs">By Character</SelectItem>
            <SelectItem value="shot_type" className="text-xs">By Shot Type</SelectItem>
            <SelectItem value="none" className="text-xs">No Grouping</SelectItem>
          </SelectContent>
        </Select>

        {/* Character filter */}
        {uniqueCharacters.length > 0 && (
          <Select value={characterFilter} onValueChange={setCharacterFilter}>
            <SelectTrigger className="h-7 w-[130px] text-[10px]">
              <SelectValue placeholder="Character" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Characters</SelectItem>
              {uniqueCharacters.map(c => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Shot type filter */}
        {uniqueShotTypes.length > 0 && (
          <Select value={shotFilter} onValueChange={setShotFilter}>
            <SelectTrigger className="h-7 w-[120px] text-[10px]">
              <SelectValue placeholder="Shot Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Shots</SelectItem>
              {uniqueShotTypes.map(t => (
                <SelectItem key={t} value={t} className="text-xs">
                  {SHOT_TYPE_LABELS[t as ShotType] || t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 px-2"
            onClick={() => { setShotFilter('all'); setCharacterFilter('all'); }}>
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-muted-foreground">Loading images…</div>
      ) : filteredImages.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {filter === 'candidate' ? 'No pending images to review' :
             filter === 'active' ? 'No approved images yet' :
             filter === 'archived' ? 'No archived images' :
             'No images found'}
          </p>
          <p className="text-xs text-muted-foreground/60">
            Generate images from Visual Canon or Look Book to populate the review queue.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(groupedImages).map(([groupName, groupImgs]) => (
            <div key={groupName}>
              {groupBy !== 'none' && (
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xs font-semibold text-foreground">{groupName}</h3>
                  <Badge variant="secondary" className="text-[8px] px-1 py-0">
                    {groupImgs.length}
                  </Badge>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {groupImgs.map(img => (
                  <ReviewCard
                    key={img.id}
                    image={img}
                    isSelectedForCompare={selectedForCompare.some(c => c.id === img.id)}
                    identityAnchorMap={identityAnchorMap}
                    onApprove={() => handleApprove(img)}
                    onReject={() => handleReject(img.id)}
                    onReuse={() => handleReuse(img.id)}
                    onArchive={() => handleArchive(img.id)}
                    onExpand={() => setLightboxImage(img)}
                    onToggleCompare={() => toggleCompare(img)}
                    showCurationState={filter === 'all'}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      <ImageLightbox
        image={lightboxImage}
        open={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
      />

      {/* Comparison */}
      <ImageComparisonView
        images={selectedForCompare}
        open={showComparison}
        onClose={() => setShowComparison(false)}
        onReject={(id) => handleReject(id)}
        identityAnchorMap={identityAnchorMap}
      />
    </div>
  );
}

// ── Review Card ──

function ReviewCard({
  image, isSelectedForCompare, identityAnchorMap, showCurationState,
  onApprove, onReject, onReuse, onArchive, onExpand, onToggleCompare,
}: {
  image: ProjectImage;
  isSelectedForCompare: boolean;
  identityAnchorMap: IdentityAnchorMap;
  showCurationState?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReuse: () => void;
  onArchive: () => void;
  onExpand: () => void;
  onToggleCompare: () => void;
}) {
  const continuity = image.asset_group === 'character' && image.subject
    ? classifyIdentityContinuity(image, identityAnchorMap[image.subject] || null).status
    : undefined;

  const isCandidate = image.curation_state === 'candidate';
  const isActive = image.curation_state === 'active';

  return (
    <Card className={cn(
      'relative group overflow-hidden transition-shadow hover:shadow-md',
      isSelectedForCompare && 'ring-2 ring-primary',
      isActive && 'ring-1 ring-emerald-500/30',
    )}>
      {/* Image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-muted cursor-pointer" onClick={onExpand}>
        <img
          src={image.signedUrl || image.storage_path}
          alt={image.subject || 'Image'}
          className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
          loading="lazy"
        />

        {/* Top-left badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5">
          {image.is_primary && (
            <Badge className="bg-emerald-600/90 text-white text-[7px] px-1 py-0 gap-0.5">
              <Crown className="h-2.5 w-2.5" /> Primary
            </Badge>
          )}
          {showCurationState && (
            <Badge className={cn(
              'text-[7px] px-1 py-0',
              isActive && 'bg-emerald-600/80 text-white',
              isCandidate && 'bg-amber-500/80 text-white',
              image.curation_state === 'archived' && 'bg-muted-foreground/60 text-white',
            )}>
              {isActive ? 'Approved' : isCandidate ? 'Pending' : 'Archived'}
            </Badge>
          )}
        </div>

        {/* Top-right: continuity */}
        {continuity && continuity !== 'no_anchor_context' && (
          <div className="absolute top-1.5 right-1.5">
            <Badge variant="outline" className={cn(
              'bg-background/80 text-[7px] px-1 py-0 gap-0.5',
              continuity === 'strong_match' && 'border-emerald-500/50',
              continuity === 'partial_match' && 'border-amber-400/50',
              continuity === 'identity_drift' && 'border-destructive/50',
            )}>
              {continuity === 'strong_match' ? <ShieldCheck className="h-2 w-2" /> :
               continuity === 'identity_drift' ? <AlertTriangle className="h-2 w-2" /> :
               <Unlink className="h-2 w-2" />}
              <span>{continuity === 'strong_match' ? 'Strong' : continuity === 'partial_match' ? 'Partial' : 'Drift'}</span>
            </Badge>
          </div>
        )}

        {/* Bottom-right: compare toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          className={cn(
            'absolute bottom-1.5 right-1.5 h-6 w-6 rounded-md flex items-center justify-center transition-colors',
            isSelectedForCompare
              ? 'bg-primary text-primary-foreground'
              : 'bg-background/70 text-muted-foreground hover:bg-background/90',
          )}
        >
          <Eye className="h-3 w-3" />
        </button>
      </div>

      {/* Metadata row */}
      <div className="px-2 py-1.5 space-y-1.5">
        <div className="flex items-center gap-1 flex-wrap min-h-[18px]">
          {image.subject && (
            <span className="text-[9px] font-medium text-foreground truncate max-w-[80px]">
              {image.subject}
            </span>
          )}
          {image.shot_type && (
            <Badge variant="secondary" className="text-[7px] px-1 py-0">
              {SHOT_TYPE_LABELS[image.shot_type as ShotType] || image.shot_type}
            </Badge>
          )}
          {(image.width || image.height) && (
            <Badge variant="outline" className="text-[7px] px-1 py-0 border-border/40 text-muted-foreground">
              {getOrientationLabel(image.width, image.height)}
            </Badge>
          )}
        </div>

        {/* Action buttons */}
        {isCandidate ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="default"
              className="h-6 flex-1 text-[8px] gap-0.5 px-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onApprove}>
              <CheckCircle className="h-2.5 w-2.5" /> Approve
            </Button>
            <Button size="sm" variant="destructive" className="h-6 px-1.5 text-[8px]"
              onClick={onReject}>
              <XCircle className="h-2.5 w-2.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[8px]"
              onClick={onReuse} title="Send to reuse pool">
              <Recycle className="h-2.5 w-2.5" />
            </Button>
          </div>
        ) : isActive ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline"
              className="h-6 flex-1 text-[8px] gap-0.5 px-1"
              onClick={onExpand}>
              <Expand className="h-2.5 w-2.5" /> View
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[8px] text-muted-foreground"
              onClick={onArchive} title="Archive">
              <XCircle className="h-2.5 w-2.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline"
              className="h-6 flex-1 text-[8px] gap-0.5 px-1"
              onClick={onApprove}>
              <CheckCircle className="h-2.5 w-2.5" /> Restore
            </Button>
            <Button size="sm" variant="outline"
              className="h-6 flex-1 text-[8px] gap-0.5 px-1"
              onClick={onExpand}>
              <Expand className="h-2.5 w-2.5" /> View
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
