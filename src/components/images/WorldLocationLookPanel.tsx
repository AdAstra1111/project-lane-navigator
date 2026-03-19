/**
 * WorldLocationLookPanel — Phase 2 world + location visual identity system.
 * Now uses structured canon_locations as authority source.
 * Falls back to canon_json extraction if no structured locations exist.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Globe, MapPin, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw, Wand2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageSelectorGrid } from './ImageSelectorGrid';
import { EntityStateVariantsPanel } from './EntityStateVariantsPanel';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
import { useCanonLocations } from '@/hooks/useCanonLocations';
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
  type?: string;
  interior_or_exterior?: string;
  source: 'structured' | 'canon_json';
}

export function WorldLocationLookPanel({ projectId }: WorldLocationLookPanelProps) {
  const { locations: structuredLocations, isLoading: structuredLoading, seedFromCanon } = useCanonLocations(projectId);
  const [canonJson, setCanonJson] = useState<any>(null);
  const [canonLoading, setCanonLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();
      setCanonJson(data?.canon_json || null);
      setCanonLoading(false);
    })();
  }, [projectId]);

  const loading = structuredLoading || canonLoading;

  // Merge structured locations as primary source, canon_json as fallback
  const locations: LocationInfo[] = useMemo(() => {
    if (structuredLocations.length > 0) {
      return structuredLocations.map((loc, idx) => ({
        name: loc.canonical_name,
        description: loc.description || undefined,
        importance: loc.story_importance === 'primary' ? -10 + idx : idx,
        type: loc.location_type,
        interior_or_exterior: loc.interior_or_exterior || undefined,
        source: 'structured' as const,
      }));
    }
    // Fallback: extract from canon_json
    return extractLocationsFromCanon(canonJson);
  }, [structuredLocations, canonJson]);

  const handleSeedLocations = useCallback(async () => {
    if (!canonJson) {
      toast.error('No story data available to extract locations');
      return;
    }
    setSeeding(true);
    try {
      await seedFromCanon.mutateAsync({ canonJson });
    } finally {
      setSeeding(false);
    }
  }, [canonJson, seedFromCanon]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading locations...</span>
      </div>
    );
  }

  // Empty state with extraction CTA
  if (locations.length === 0) {
    return (
      <div className="py-4">
        <Card className="border-dashed border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-6 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">No structured locations seeded yet</span>
            </div>
            <p className="text-[10px] text-muted-foreground max-w-sm mx-auto">
              Extract locations from your story materials to build governed world/location visual references.
              No images will be generated without structured location canon.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={handleSeedLocations}
              disabled={seeding || !canonJson}
            >
              {seeding ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Extracting...</>
              ) : (
                <><Wand2 className="h-3 w-3" /> Extract Locations from Story</>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Coverage summary
  const structuredCount = structuredLocations.length;
  const primaryCount = locations.filter(l => l.type === 'primary' || (l.importance !== undefined && l.importance < 0)).length;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">World & Location References</h3>
      </div>

      {/* Coverage Summary */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Seeded Locations</p>
          <p className="text-sm font-semibold text-foreground">{locations.length}</p>
        </div>
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Primary</p>
          <p className="text-sm font-semibold text-foreground">{primaryCount}</p>
        </div>
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Source</p>
          <p className="text-[10px] font-medium text-foreground">
            {structuredCount > 0 ? 'Structured Canon' : 'Canon JSON'}
          </p>
        </div>
      </div>

      {structuredCount === 0 && canonJson && (
        <div className="mb-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-[10px] h-7 w-full"
            onClick={handleSeedLocations}
            disabled={seeding}
          >
            {seeding ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Seeding...</>
            ) : (
              <><Wand2 className="h-3 w-3" /> Seed Structured Location Canon</>
            )}
          </Button>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mb-3">
        Generate establishing + atmospheric + detail references per location. Select primary references to anchor world visual identity.
      </p>
      {locations.map(loc => (
        <LocationLookSection key={loc.name} projectId={projectId} location={loc} />
      ))}
    </div>
  );
}

/** Fallback extraction from canon_json */
function extractLocationsFromCanon(canonJson: any): LocationInfo[] {
  if (!canonJson) return [];
  const locations: LocationInfo[] = [];
  const raw = canonJson.locations || canonJson.settings || canonJson.key_locations;
  if (Array.isArray(raw) && raw.length > 0) {
    raw.forEach((loc: any, idx: number) => {
      if (typeof loc === 'string') {
        const name = loc.trim();
        if (name && name !== 'Unknown') locations.push({ name, importance: idx, source: 'canon_json' });
      } else if (loc && typeof loc === 'object') {
        const name = (loc.name || loc.location_name || loc.setting || '').trim();
        if (!name || name === 'Unknown') return;
        locations.push({
          name,
          description: (loc.description || loc.visual_description || '').trim() || undefined,
          importance: idx,
          type: loc.type || 'secondary',
          source: 'canon_json',
        });
      }
    });
  }
  if (locations.length === 0) {
    const worldDesc = canonJson.world_description || canonJson.setting || '';
    if (typeof worldDesc === 'string' && worldDesc.length > 0) {
      locations.push({ name: 'Primary World', description: worldDesc.slice(0, 300), importance: 0, type: 'primary', source: 'canon_json' });
    }
  }
  locations.sort((a, b) => (a.importance || 0) - (b.importance || 0));
  return locations.slice(0, 8);
}

type LocFilter = 'all' | 'active' | 'candidate' | 'archived';

function LocationLookSection({ projectId, location }: { projectId: string; location: LocationInfo }) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<LocFilter>('all');
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);

  const { data: locImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'world',
    subject: location.name,
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived'],
  });

  const filteredImages = useMemo(() => {
    if (filter === 'all') return locImages.filter(i => i.curation_state !== 'rejected');
    return locImages.filter(i => i.curation_state === filter);
  }, [locImages, filter]);

  const wideShots = filteredImages.filter(i => i.shot_type === 'wide' || i.shot_type === 'atmospheric');
  const detailShots = filteredImages.filter(i => i.shot_type === 'detail' || i.shot_type === 'time_variant');
  const others = filteredImages.filter(i => !['wide', 'atmospheric', 'detail', 'time_variant'].includes(i.shot_type || ''));

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
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{location.name}</span>
            {location.type && (
              <Badge variant="secondary" className="text-[8px] px-1 py-0">{location.type}</Badge>
            )}
            {location.interior_or_exterior && (
              <Badge variant="outline" className="text-[7px] px-1 py-0">{location.interior_or_exterior}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {primaryEstablishing && <Badge variant="secondary" className="text-[8px] px-1 py-0">Primary ✓</Badge>}
            {locImages.length === 0 && <span className="text-[10px] text-muted-foreground/60">no references</span>}
            {locImages.length > 0 && !primaryEstablishing && (
              <span className="text-[10px] text-accent">{locImages.length} candidates</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {location.description && (
          <p className="text-[10px] text-muted-foreground mb-2 italic line-clamp-2">{location.description}</p>
        )}

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

        {wideShots.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Establishing / Atmospheric
            </p>
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

        {detailShots.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Detail / Temporal
            </p>
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

        {others.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Other References
            </p>
            <ImageSelectorGrid projectId={projectId} images={others} showShotTypes showCurationControls showProvenance />
          </div>
        )}

        {locImages.length > 0 && (
          <EntityStateVariantsPanel
            projectId={projectId}
            entityType="location"
            entityName={location.name}
            entityDescription={location.description}
          />
        )}

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7 w-full mt-2"
          onClick={generateLocationRef}
          disabled={generating}
        >
          {generating ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
          ) : (
            <><Plus className="h-3 w-3" /> Generate Location Pack</>
          )}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

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

      {isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge className="text-[9px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
            <Star className="h-2 w-2" /> Primary
          </Badge>
        </div>
      )}

      {!isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-black/50 text-white/80 border-0">
            {image.shot_type?.replace('_', ' ') || 'ref'}
          </Badge>
        </div>
      )}

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
