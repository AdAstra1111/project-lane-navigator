/**
 * WorldLocationLookPanel — Phase 2 world + location visual identity system.
 * Phase 3: Now includes state variant generation per location.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Globe, MapPin, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageSelectorGrid } from './ImageSelectorGrid';
import { EntityStateVariantsPanel } from './EntityStateVariantsPanel';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, CurationState } from '@/lib/images/types';

interface WorldLocationLookPanelProps {
  projectId: string;
}

interface LocationInfo {
  name: string;
  description?: string;
  importance?: number;
  type?: 'primary' | 'recurring' | 'secondary';
}

/**
 * Extract locations from canon_json with importance ordering.
 * Handles: array of strings, array of objects with name/description, or a single setting string.
 */
function extractLocations(canonJson: any): LocationInfo[] {
  if (!canonJson) return [];

  const locations: LocationInfo[] = [];

  // Try structured locations array
  const raw = canonJson.locations || canonJson.settings || canonJson.key_locations;
  if (Array.isArray(raw) && raw.length > 0) {
    raw.forEach((loc: any, idx: number) => {
      if (typeof loc === 'string') {
        const name = loc.trim();
        if (name && name !== 'Unknown') {
          locations.push({ name, importance: idx });
        }
      } else if (loc && typeof loc === 'object') {
        const name = (loc.name || loc.location_name || loc.setting || '').trim();
        if (!name || name === 'Unknown') return;
        const desc = (loc.description || loc.visual_description || loc.atmosphere || '').trim();
        const type = loc.type || loc.importance_level || (idx < 3 ? 'primary' : 'secondary');
        let importance = idx;
        if (type === 'primary' || type === 'main') importance = -10 + idx;
        else if (type === 'recurring') importance = idx;
        else if (type === 'secondary') importance = 10 + idx;
        locations.push({ name, description: desc || undefined, importance, type });
      }
    });
  }

  // Fallback: parse world_description or setting for implied locations
  if (locations.length === 0) {
    const worldDesc = canonJson.world_description || canonJson.setting || '';
    if (typeof worldDesc === 'string' && worldDesc.length > 0) {
      // Create a single "World" entry from the description
      locations.push({
        name: 'Primary World',
        description: worldDesc.slice(0, 300),
        importance: 0,
        type: 'primary',
      });
    }
  }

  // Sort by importance (lower = more important)
  locations.sort((a, b) => (a.importance || 0) - (b.importance || 0));

  // Limit to 8 max
  return locations.slice(0, 8);
}

export function WorldLocationLookPanel({ projectId }: WorldLocationLookPanelProps) {
  const [locations, setLocations] = useState<LocationInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();

      if (data?.canon_json) {
        setLocations(extractLocations(data.canon_json));
      }
      setLoading(false);
    }
    load();
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading locations...</span>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-muted-foreground">
          No locations found in project canon. Add world/location details to enable location reference development.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">World & Location References</h3>
        <Badge variant="secondary" className="text-[10px]">{locations.length} locations</Badge>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">
        Generate establishing + atmospheric + detail references per location. Select primary references to anchor world visual identity.
      </p>
      {locations.map(loc => (
        <LocationLookSection key={loc.name} projectId={projectId} location={loc} />
      ))}
    </div>
  );
}

type LocFilter = 'all' | 'active' | 'candidate' | 'archived';

function LocationLookSection({ projectId, location }: { projectId: string; location: LocationInfo }) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<LocFilter>('all');
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);

  // Fetch ALL images for this location (including archived)
  const { data: locImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'world',
    subject: location.name,
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived'],
  });

  // Apply client filter
  const filteredImages = useMemo(() => {
    if (filter === 'all') return locImages.filter(i => i.curation_state !== 'rejected');
    return locImages.filter(i => i.curation_state === filter);
  }, [locImages, filter]);

  const wideShots = filteredImages.filter(i => i.shot_type === 'wide' || i.shot_type === 'atmospheric');
  const detailShots = filteredImages.filter(i => i.shot_type === 'detail' || i.shot_type === 'time_variant');
  const others = filteredImages.filter(i => !['wide', 'atmospheric', 'detail', 'time_variant'].includes(i.shot_type || ''));

  // Primary = is_primary ONLY (not curation_state fallback)
  const primaryEstablishing = locImages.find(i => i.is_primary && (i.shot_type === 'wide' || i.shot_type === 'atmospheric'));
  const primaryDetail = locImages.find(i => i.is_primary && (i.shot_type === 'detail' || i.shot_type === 'time_variant'));

  const activeCount = locImages.filter(i => i.curation_state === 'active').length;
  const candidateCount = locImages.filter(i => i.curation_state === 'candidate').length;
  const archivedCount = locImages.filter(i => i.curation_state === 'archived').length;

  const generateLocationRef = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: 'world',
          count: 4,
          location_name: location.name,
          location_description: location.description,
          asset_group: 'world',
          pack_mode: true,
          location_ref_mode: true,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} images for ${location.name}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
        qc.invalidateQueries({ queryKey: ['section-images', projectId] });
      } else {
        toast.error('No images generated successfully');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate location images');
    } finally {
      setGenerating(false);
    }
  }, [projectId, location.name, location.description, generating, qc]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {primaryEstablishing?.signedUrl ? (
            <img src={primaryEstablishing.signedUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{location.name}</span>
          {location.type && (
            <span className="text-[10px] text-muted-foreground ml-1.5">({location.type})</span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            {primaryEstablishing && <Badge variant="secondary" className="text-[8px] px-1 py-0">Primary Establishing ✓</Badge>}
            {primaryDetail && <Badge variant="secondary" className="text-[8px] px-1 py-0">Primary Detail ✓</Badge>}
            {locImages.length === 0 && <span className="text-[10px] text-muted-foreground/60">no references</span>}
            {locImages.length > 0 && !primaryEstablishing && !primaryDetail && (
              <span className="text-[10px] text-accent">{locImages.length} candidates — select primaries</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {/* Description */}
        {location.description && (
          <p className="text-[10px] text-muted-foreground mb-2 italic line-clamp-2">{location.description}</p>
        )}

        {/* Filter bar */}
        {locImages.length > 0 && (
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {(['all', 'active', 'candidate', 'archived'] as LocFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize',
                  filter === f
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground'
                )}
              >
                {f}
                {f === 'active' && activeCount > 0 && ` (${activeCount})`}
                {f === 'candidate' && candidateCount > 0 && ` (${candidateCount})`}
                {f === 'archived' && archivedCount > 0 && ` (${archivedCount})`}
              </button>
            ))}
          </div>
        )}

        {/* Wide / Establishing shots */}
        {wideShots.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Establishing / Atmospheric
              </p>
              {primaryEstablishing && (
                <Badge className="text-[8px] bg-primary/90 text-primary-foreground px-1.5 py-0">
                  Primary: {primaryEstablishing.shot_type}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {wideShots.map(img => (
                <LocationImageCard
                  key={img.id}
                  image={img}
                  isPrimary={img.id === primaryEstablishing?.id}
                  onSetPrimary={() => setPrimary(img)}
                  onArchive={() => setCurationState(img.id, 'archived')}
                  onRestore={() => setCurationState(img.id, 'candidate')}
                  updating={updating}
                />
              ))}
            </div>
          </div>
        )}

        {/* Detail / Time variant shots */}
        {detailShots.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Detail / Temporal
              </p>
              {primaryDetail && (
                <Badge className="text-[8px] bg-primary/90 text-primary-foreground px-1.5 py-0">
                  Primary
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {detailShots.map(img => (
                <LocationImageCard
                  key={img.id}
                  image={img}
                  isPrimary={img.id === primaryDetail?.id}
                  onSetPrimary={() => setPrimary(img)}
                  onArchive={() => setCurationState(img.id, 'archived')}
                  onRestore={() => setCurationState(img.id, 'candidate')}
                  updating={updating}
                />
              ))}
            </div>
          </div>
        )}

        {/* Other shots */}
        {others.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Other References
            </p>
            <ImageSelectorGrid
              projectId={projectId}
              images={others}
              showShotTypes
              showCurationControls
              showProvenance
            />
          </div>
        )}

        {/* Generate button */}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7 w-full mt-1"
          onClick={generateLocationRef}
          disabled={generating}
        >
          {generating ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
          ) : (
            <><Plus className="h-3 w-3" /> Generate Location Pack (wide + atmospheric + detail + time variant)</>
          )}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Individual location image card with explicit primary selection controls.
 */
function LocationImageCard({
  image, isPrimary, onSetPrimary, onArchive, onRestore, updating,
}: {
  image: ProjectImage;
  isPrimary: boolean;
  onSetPrimary: () => void;
  onArchive: () => void;
  onRestore: () => void;
  updating: string | null;
}) {
  const isArchived = image.curation_state === 'archived';
  const isUpdating = updating === image.id;

  return (
    <div className={cn(
      'group relative rounded-md overflow-hidden border-2 transition-all aspect-video bg-muted',
      isPrimary
        ? 'border-primary ring-1 ring-primary/30'
        : isArchived
          ? 'border-border/30 opacity-50'
          : 'border-border/50 hover:border-primary/40',
    )}>
      {image.signedUrl ? (
        <img src={image.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <MapPin className="h-6 w-6 text-muted-foreground/30" />
        </div>
      )}

      {/* Primary badge */}
      {isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge className="text-[9px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
            <Star className="h-2 w-2" /> Primary
          </Badge>
        </div>
      )}

      {/* Subject + shot type badge */}
      {!isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-black/50 text-white/80 border-0">
            {image.shot_type?.replace('_', ' ') || 'ref'}
          </Badge>
        </div>
      )}

      {/* Hover controls */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isPrimary && !isArchived && (
            <button
              className="flex-1 flex items-center justify-center gap-0.5 px-1.5 py-1 rounded bg-primary/80 text-primary-foreground text-[9px] font-medium hover:bg-primary/90"
              onClick={(e) => { e.stopPropagation(); onSetPrimary(); }}
              disabled={isUpdating}
            >
              {isUpdating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Star className="h-2.5 w-2.5" />}
              Set Primary
            </button>
          )}
          {!isArchived && (
            <button
              className="p-1 rounded bg-black/50 text-white hover:bg-black/70"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
              title="Archive"
            >
              <Archive className="h-3 w-3" />
            </button>
          )}
          {isArchived && (
            <button
              className="flex-1 flex items-center justify-center gap-0.5 px-1.5 py-1 rounded bg-muted/80 text-foreground text-[9px] font-medium"
              onClick={(e) => { e.stopPropagation(); onRestore(); }}
            >
              <RotateCcw className="h-2.5 w-2.5" /> Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
