/**
 * WorldLocationLookPanel — Phase 2 world + location visual identity system.
 * Uses structured canon_locations as authority source.
 * Multi-pass extraction with manual and assisted fallbacks.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Globe, MapPin, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw, Wand2, AlertTriangle, PenLine, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

// ── Multi-pass location extraction ──

function multiPassExtractLocations(canonJson: any): LocationInfo[] {
  if (!canonJson) return [];
  const locations: LocationInfo[] = [];
  const seen = new Set<string>();

  const addLoc = (name: string, desc?: string, type?: string, intExt?: string, importance?: number) => {
    const norm = name.toLowerCase().trim();
    if (!norm || norm === 'unknown' || seen.has(norm)) return;
    seen.add(norm);
    locations.push({ name: name.trim(), description: desc, type, interior_or_exterior: intExt, importance: importance ?? locations.length, source: 'canon_json' });
  };

  // Pass 1: Structured canon keys
  const locArr = canonJson.locations || canonJson.settings || canonJson.key_locations;
  if (Array.isArray(locArr)) {
    for (const loc of locArr) {
      if (typeof loc === 'string') {
        addLoc(loc);
      } else if (loc && typeof loc === 'object') {
        const name = (loc.name || loc.location_name || loc.setting || '').trim();
        addLoc(name, loc.description || loc.visual_description, loc.type || 'location', loc.interior_or_exterior || loc.int_ext);
      }
    }
  }

  // Pass 1b: scenes[].location
  if (Array.isArray(canonJson.scenes)) {
    for (const scene of canonJson.scenes) {
      const locName = (scene.location || scene.setting || '').trim();
      if (locName) addLoc(locName, undefined, 'location', scene.int_ext || scene.interior_or_exterior);
    }
  }

  // Pass 1c: world_description / setting
  if (locations.length === 0) {
    const worldDesc = canonJson.world_description || canonJson.setting;
    if (typeof worldDesc === 'string' && worldDesc.length > 5) {
      addLoc('Primary World', worldDesc.slice(0, 500), 'primary');
    }
  }

  // Pass 2: Semi-structured story fields
  const storyFields = [
    canonJson.synopsis, canonJson.logline, canonJson.treatment,
    canonJson.world_notes, canonJson.atmosphere, canonJson.setting_description,
  ].filter(v => typeof v === 'string' && v.length > 10);

  for (const field of storyFields) {
    // Extract INT./EXT. headings
    const headingPattern = /\b(?:INT\.|EXT\.|INT\/EXT\.?)\s+([A-Z][A-Z\s\-']+?)(?:\s*[-–—]\s*|\s*$)/gm;
    let match;
    while ((match = headingPattern.exec(field)) !== null) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (name.length > 2 && name.length < 60) {
        const intExt = match[0].includes('INT/EXT') ? 'INT/EXT' : match[0].includes('INT') ? 'INT' : 'EXT';
        addLoc(name, undefined, 'location', intExt);
      }
    }
  }

  // Pass 3: Episode/beat/outline structures
  const episodes = canonJson.episodes || canonJson.episode_grid || canonJson.episode_outlines;
  if (Array.isArray(episodes)) {
    for (const ep of episodes) {
      if (!ep || typeof ep !== 'object') continue;
      const epLocations = ep.locations || ep.settings;
      if (Array.isArray(epLocations)) {
        for (const l of epLocations) {
          if (typeof l === 'string') addLoc(l);
          else if (l?.name) addLoc(l.name, l.description);
        }
      }
      // Check beats
      const beats = ep.beats || ep.scenes;
      if (Array.isArray(beats)) {
        for (const b of beats) {
          if (b?.location) addLoc(typeof b.location === 'string' ? b.location : b.location.name);
          if (b?.setting) addLoc(typeof b.setting === 'string' ? b.setting : b.setting.name);
        }
      }
    }
  }

  // Pass 3b: Plain text extraction from any text blob
  if (locations.length === 0) {
    const allText = JSON.stringify(canonJson);
    const intExtPattern = /(?:INT\.|EXT\.|INT\/EXT\.?)\s+([A-Z][A-Z\s\-']{2,40})/g;
    let m;
    while ((m = intExtPattern.exec(allText)) !== null) {
      addLoc(m[1].trim());
    }
  }

  locations.sort((a, b) => (a.importance || 0) - (b.importance || 0));
  return locations.slice(0, 20);
}

// ── Manual Location Form ──

function ManualLocationForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [locType, setLocType] = useState('location');
  const [intExt, setIntExt] = useState('');
  const [description, setDescription] = useState('');
  const [importance, setImportance] = useState('secondary');

  const handleSave = useCallback(async () => {
    if (!name.trim()) { toast.error('Location name required'); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('canon_locations')
        .insert({
          project_id: projectId,
          canonical_name: name.trim(),
          normalized_name: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          location_type: locType,
          interior_or_exterior: intExt || null,
          description: description.trim() || null,
          story_importance: importance,
          provenance: 'manual_entry',
          active: true,
          associated_characters: [],
          source_document_ids: [],
        });
      if (error) throw error;
      toast.success(`Location "${name}" added`);
      setName(''); setDescription(''); setIntExt('');
      onCreated();
      setOpen(false);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [projectId, name, locType, intExt, description, importance, onCreated]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7">
          <PenLine className="h-3 w-3" /> Add Location Manually
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Location name (e.g. Village Square)"
              className="text-xs h-8"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={locType} onValueChange={setLocType}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="location">Location</SelectItem>
                  <SelectItem value="interior">Interior</SelectItem>
                  <SelectItem value="exterior">Exterior</SelectItem>
                  <SelectItem value="landmark">Landmark</SelectItem>
                  <SelectItem value="world">World</SelectItem>
                </SelectContent>
              </Select>
              <Select value={intExt} onValueChange={setIntExt}>
                <SelectTrigger className="text-xs h-8"><SelectValue placeholder="INT/EXT" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INT">INT</SelectItem>
                  <SelectItem value="EXT">EXT</SelectItem>
                  <SelectItem value="INT/EXT">INT/EXT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Select value={importance} onValueChange={setImportance}>
              <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="secondary">Secondary</SelectItem>
                <SelectItem value="tertiary">Tertiary</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief visual description..."
              className="text-xs min-h-[50px] resize-none"
            />
            <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save Location
            </Button>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function WorldLocationLookPanel({ projectId }: WorldLocationLookPanelProps) {
  const { locations: structuredLocations, isLoading: structuredLoading, seedFromCanon, refetch } = useCanonLocations(projectId);
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

  // Merge structured locations as primary source, multi-pass canon_json as fallback
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
    return multiPassExtractLocations(canonJson);
  }, [structuredLocations, canonJson]);

  const handleSeedLocations = useCallback(async () => {
    if (!canonJson) {
      toast.error('No story data available to extract locations');
      return;
    }
    setSeeding(true);
    try {
      // Use multi-pass extraction results to seed
      const extracted = multiPassExtractLocations(canonJson);
      if (extracted.length === 0) {
        toast.info('No locations confidently extracted. Try adding manually or using assisted suggestions.');
        return;
      }
      // Build a synthetic canonJson with locations for the hook
      const syntheticCanon = { ...canonJson, locations: extracted.map(l => ({
        name: l.name,
        description: l.description,
        type: l.type,
        interior_or_exterior: l.interior_or_exterior,
        importance: l.type === 'primary' ? 'primary' : 'secondary',
      })) };
      await seedFromCanon.mutateAsync({ canonJson: syntheticCanon });
    } catch (e: any) {
      if (e.message?.includes('No locations found')) {
        toast.info('No locations confidently extracted. Try adding manually.');
      } else {
        toast.error(e.message);
      }
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

  // Empty state with multi-path recovery
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
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
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
              <ManualLocationForm projectId={projectId} onCreated={refetch} />
            </div>
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

      {/* Seed / manual add controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {structuredCount === 0 && canonJson && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-[10px] h-7"
            onClick={handleSeedLocations}
            disabled={seeding}
          >
            {seeding ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Seeding...</>
            ) : (
              <><Wand2 className="h-3 w-3" /> Seed Structured Location Canon</>
            )}
          </Button>
        )}
        <ManualLocationForm projectId={projectId} onCreated={refetch} />
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
          <Badge className="text-[7px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
            <Star className="h-1.5 w-1.5" /> Primary
          </Badge>
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isPrimary && !isArchived && (
            <button
              className="flex-1 flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-primary/80 text-primary-foreground text-[8px] font-medium hover:bg-primary/90"
              onClick={(e) => { e.stopPropagation(); onSetPrimary(); }}
              disabled={isUpdating}
            >
              {isUpdating ? <Loader2 className="h-2 w-2 animate-spin" /> : <Star className="h-2 w-2" />}
              Primary
            </button>
          )}
          {!isArchived && (
            <button className="p-0.5 rounded bg-black/50 text-white hover:bg-black/70"
              onClick={(e) => { e.stopPropagation(); onArchive(); }} title="Archive">
              <Archive className="h-2.5 w-2.5" />
            </button>
          )}
          {isArchived && (
            <button className="flex-1 flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-muted/80 text-foreground text-[8px] font-medium"
              onClick={(e) => { e.stopPropagation(); onRestore(); }}>
              <RotateCcw className="h-2 w-2" /> Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
