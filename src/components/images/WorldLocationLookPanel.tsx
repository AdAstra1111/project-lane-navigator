/**
 * WorldLocationLookPanel — Phase 3 world + location visual identity system.
 * Auto-populates from canon_locations + scene graph usage + visual reference state.
 * Manual add is positioned as override, not primary workflow.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Globe, MapPin, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw, Wand2, AlertTriangle, PenLine, Sparkles, Eye, Film, Users, Package, CheckCircle2, Clock, ImageIcon, Link2, Unlink2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ImageSelectorGrid } from './ImageSelectorGrid';
import { EntityStateVariantsPanel } from './EntityStateVariantsPanel';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
import { useHydratedLocations, type HydratedLocation, type LocationReadiness, type LocationBindingStatus } from '@/hooks/useHydratedLocations';
import { useLocationBindingBackfill } from '@/hooks/useLocationBindingBackfill';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage } from '@/lib/images/types';

interface WorldLocationLookPanelProps {
  projectId: string;
}

// ── Readiness display ──

const READINESS_CONFIG: Record<LocationReadiness, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  ready_to_generate: { label: 'Ready', color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  missing_canon_data: { label: 'Missing Data', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20', icon: AlertTriangle },
  has_existing_refs: { label: 'Needs Primary', color: 'text-blue-600 bg-blue-500/10 border-blue-500/20', icon: ImageIcon },
  needs_refresh: { label: 'Needs Refresh', color: 'text-orange-600 bg-orange-500/10 border-orange-500/20', icon: Clock },
  primary_selected: { label: 'Complete', color: 'text-primary bg-primary/10 border-primary/20', icon: Star },
};

const USAGE_TIER_COLORS: Record<string, string> = {
  primary: 'bg-primary/10 text-primary border-primary/20',
  secondary: 'bg-muted text-foreground border-border/30',
  minor: 'bg-muted/50 text-muted-foreground border-border/20',
};

const BINDING_STATUS_CONFIG: Record<LocationBindingStatus, { label: string; color: string; icon: typeof Link2 }> = {
  canon_bound: { label: 'ID-Bound', color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20', icon: Link2 },
  partially_bound: { label: 'Partial', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20', icon: Link2 },
  unresolved: { label: 'Unresolved', color: 'text-destructive bg-destructive/10 border-destructive/20', icon: Unlink2 },
};

// ── Multi-pass location extraction (for seeding) ──

function multiPassExtractLocations(canonJson: any) {
  if (!canonJson) return [];
  const locations: { name: string; description?: string; type?: string; interior_or_exterior?: string }[] = [];
  const seen = new Set<string>();

  const addLoc = (name: string, desc?: string, type?: string, intExt?: string) => {
    const norm = name.toLowerCase().trim();
    if (!norm || norm === 'unknown' || seen.has(norm)) return;
    seen.add(norm);
    locations.push({ name: name.trim(), description: desc, type, interior_or_exterior: intExt });
  };

  const locArr = canonJson.locations || canonJson.settings || canonJson.key_locations;
  if (Array.isArray(locArr)) {
    for (const loc of locArr) {
      if (typeof loc === 'string') addLoc(loc);
      else if (loc && typeof loc === 'object') {
        addLoc(loc.name || loc.location_name || loc.setting || '', loc.description, loc.type, loc.interior_or_exterior || loc.int_ext);
      }
    }
  }

  if (Array.isArray(canonJson.scenes)) {
    for (const scene of canonJson.scenes) {
      const locName = (scene.location || scene.setting || '').trim();
      if (locName) addLoc(locName, undefined, 'location', scene.int_ext);
    }
  }

  if (locations.length === 0) {
    const worldDesc = canonJson.world_description || canonJson.setting;
    if (typeof worldDesc === 'string' && worldDesc.length > 5) {
      addLoc('Primary World', worldDesc.slice(0, 500), 'primary');
    }
  }

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
        <Button size="sm" variant="ghost" className="gap-1.5 text-[10px] h-6 text-muted-foreground">
          <PenLine className="h-3 w-3" /> Add Manually
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Location name" className="text-xs h-8" />
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
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief visual description..." className="text-xs min-h-[50px] resize-none" />
            <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Save Location
            </Button>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main Panel ──

export function WorldLocationLookPanel({ projectId }: WorldLocationLookPanelProps) {
  const { locations, isLoading, canonLocations, seedFromCanon, refetch, stats } = useHydratedLocations(projectId);
  const { runBackfill, running: backfilling, lastResult: backfillResult } = useLocationBindingBackfill(projectId);
  const [canonJson, setCanonJson] = useState<any>(null);
  const [canonLoading, setCanonLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
  const [generationState, setGenerationState] = useState<Record<string, { status: string; error?: string }>>({});

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

  const loading = isLoading || canonLoading;

  const handleSeedLocations = useCallback(async () => {
    if (!canonJson) { toast.error('No story data available'); return; }
    setSeeding(true);
    try {
      const extracted = multiPassExtractLocations(canonJson);
      if (extracted.length === 0) {
        toast.info('No locations confidently extracted. Try adding manually.');
        return;
      }
      const syntheticCanon = { ...canonJson, locations: extracted.map(l => ({
        name: l.name, description: l.description, type: l.type,
        interior_or_exterior: l.interior_or_exterior,
        importance: l.type === 'primary' ? 'primary' : 'secondary',
      })) };
      await seedFromCanon.mutateAsync({ canonJson: syntheticCanon });
    } catch (e: any) {
      if (!e.message?.includes('No locations found')) toast.error(e.message);
      else toast.info('No locations confidently extracted. Try adding manually.');
    } finally {
      setSeeding(false);
    }
  }, [canonJson, seedFromCanon]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Hydrating location data...</span>
      </div>
    );
  }

  // Empty state
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
              Extract locations from your story materials to auto-populate world references.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleSeedLocations} disabled={seeding || !canonJson}>
                {seeding ? <><Loader2 className="h-3 w-3 animate-spin" /> Extracting...</> : <><Wand2 className="h-3 w-3" /> Extract Locations from Story</>}
              </Button>
              <ManualLocationForm projectId={projectId} onCreated={refetch} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">World & Location References</h3>
        </div>

        {/* Coverage Summary */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-3">
          <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">Locations</p>
            <p className="text-sm font-semibold text-foreground">{stats.total}</p>
          </div>
          <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">Primary</p>
            <p className="text-sm font-semibold text-foreground">{stats.primary}</p>
          </div>
          <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">ID-Bound</p>
            <p className="text-sm font-semibold text-foreground">{stats.canonBound}</p>
          </div>
          <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">With Refs</p>
            <p className="text-sm font-semibold text-foreground">{stats.withRefs}</p>
          </div>
          <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">Locked</p>
            <p className="text-sm font-semibold text-foreground">{stats.withPrimary}</p>
          </div>
          <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">Ready</p>
            <p className="text-sm font-semibold text-foreground">{stats.readyToGenerate}</p>
          </div>
        </div>

        {/* Unresolved warnings */}
        {(stats.unresolvedSceneLocations > 0 || stats.unresolvedWorldRefs > 0) && (
          <div className="mb-3 rounded-md bg-amber-500/5 border border-amber-500/20 overflow-hidden">
            <div className="px-2 py-1.5 flex items-center gap-2 flex-wrap">
              <Unlink2 className="h-3 w-3 text-amber-600 shrink-0" />
              <span className="text-[10px] text-amber-600 font-medium">Unresolved Bindings</span>
              <div className="flex items-center gap-2 text-[10px] text-amber-600">
                {stats.unresolvedSceneLocations > 0 && (
                  <span className="flex items-center gap-0.5"><Film className="h-2.5 w-2.5" />{stats.unresolvedSceneLocations} scene{stats.unresolvedSceneLocations !== 1 ? 's' : ''}</span>
                )}
                {stats.unresolvedWorldRefs > 0 && (
                  <span className="flex items-center gap-0.5"><ImageIcon className="h-2.5 w-2.5" />{stats.unresolvedWorldRefs} image{stats.unresolvedWorldRefs !== 1 ? 's' : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-[9px] h-5 text-amber-700 hover:bg-amber-500/10"
                  onClick={() => runBackfill(true)}
                  disabled={backfilling}
                >
                  {backfilling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Eye className="h-2.5 w-2.5" />}
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-[9px] h-5 border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
                  onClick={() => runBackfill(false)}
                  disabled={backfilling}
                >
                  {backfilling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Link2 className="h-2.5 w-2.5" />}
                  Backfill
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Backfill result summary */}
        {backfillResult && (
          <div className="mb-3 px-2 py-1.5 rounded-md bg-muted/30 border border-border/30 text-[9px] text-muted-foreground">
            <div className="font-medium text-foreground text-[10px] mb-1">
              {backfillResult.dry_run ? '🔍 Preview (dry run)' : '✅ Backfill applied'}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <div className="flex items-center gap-1"><Film className="h-2.5 w-2.5" /> Scenes bound: <span className="text-foreground font-medium">{backfillResult.report.scenes.bound}</span></div>
              <div className="flex items-center gap-1"><ImageIcon className="h-2.5 w-2.5" /> Images bound: <span className="text-foreground font-medium">{backfillResult.report.images.bound}</span></div>
              <div>Unresolved: {backfillResult.report.scenes.unresolved}</div>
              <div>Unresolved: {backfillResult.report.images.unresolved}</div>
              {(backfillResult.report.scenes.ambiguous > 0 || backfillResult.report.images.ambiguous > 0) && (
                <>
                  <div className="text-amber-600">Ambiguous: {backfillResult.report.scenes.ambiguous}</div>
                  <div className="text-amber-600">Ambiguous: {backfillResult.report.images.ambiguous}</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Controls row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {canonLocations.length === 0 && canonJson && (
            <Button size="sm" variant="outline" className="gap-1.5 text-[10px] h-7" onClick={handleSeedLocations} disabled={seeding}>
              {seeding ? <><Loader2 className="h-3 w-3 animate-spin" /> Seeding...</> : <><Wand2 className="h-3 w-3" /> Seed from Story</>}
            </Button>
          )}
          <ManualLocationForm projectId={projectId} onCreated={refetch} />
        </div>

        {/* Location rows */}
        {locations.map(loc => (
          <HydratedLocationRow
            key={loc.id}
            projectId={projectId}
            location={loc}
            isExpanded={expandedLocationId === loc.id}
            onToggleExpand={() => setExpandedLocationId(prev => prev === loc.id ? null : loc.id)}
            generationStatus={generationState[loc.id]}
            onGenerationStateChange={(status, error) =>
              setGenerationState(prev => ({ ...prev, [loc.id]: { status, error } }))
            }
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

// ── Hydrated Location Row ──

interface HydratedLocationRowProps {
  projectId: string;
  location: HydratedLocation;
  isExpanded: boolean;
  onToggleExpand: () => void;
  generationStatus?: { status: string; error?: string };
  onGenerationStateChange: (status: string, error?: string) => void;
}

type LocFilter = 'all' | 'active' | 'candidate' | 'archived';

function HydratedLocationRow({
  projectId, location, isExpanded, onToggleExpand, generationStatus, onGenerationStateChange,
}: HydratedLocationRowProps) {
  const [filter, setFilter] = useState<LocFilter>('all');
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);
  const generating = generationStatus?.status === 'generating';

  const { data: locImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'world',
    subject: location.canonical_name,
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

  const canGenerate = location.readiness !== 'missing_canon_data';
  const readinessCfg = READINESS_CONFIG[location.readiness];
  const ReadinessIcon = readinessCfg.icon;

  const generateLocationRef = useCallback(async () => {
    if (generating || !canGenerate) return;
    onGenerationStateChange('generating');
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: 'world',
          count: 4,
          location_id: location.id,
          location_name: location.canonical_name,
          location_description: location.description,
          location_type: location.location_type,
          interior_or_exterior: location.interior_or_exterior,
          asset_group: 'world',
          pack_mode: true,
          location_ref_mode: true,
        },
      });
      if (error) { onGenerationStateChange('error', error.message); toast.error(`${location.canonical_name}: ${error.message}`); return; }
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        onGenerationStateChange('success');
        toast.success(`${location.canonical_name}: ${successCount} image(s) generated`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['location-image-stats', projectId] });
      } else {
        const msg = data?.error || results[0]?.error || 'No images generated';
        onGenerationStateChange('error', msg);
        toast.error(`${location.canonical_name}: ${msg}`);
      }
    } catch (e: any) {
      onGenerationStateChange('error', e.message);
      toast.error(`${location.canonical_name}: ${e.message}`);
    }
  }, [projectId, location, generating, canGenerate, qc, onGenerationStateChange]);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        {/* Thumbnail */}
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {primaryEstablishing?.signedUrl ? (
            <img src={primaryEstablishing.signedUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-foreground">{location.canonical_name}</span>

            {/* Usage tier badge */}
            <Badge variant="outline" className={cn('text-[7px] px-1 py-0', USAGE_TIER_COLORS[location.usage_tier])}>
              {location.usage_tier}
            </Badge>

            {location.interior_or_exterior && (
              <Badge variant="outline" className="text-[7px] px-1 py-0">{location.interior_or_exterior}</Badge>
            )}

            {/* Binding status badge */}
            {(() => {
              const bcfg = BINDING_STATUS_CONFIG[location.binding_status];
              const BIcon = bcfg.icon;
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className={cn('text-[7px] px-1 py-0 gap-0.5 cursor-help', bcfg.color)}>
                      <BIcon className="h-1.5 w-1.5" /> {bcfg.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px] max-w-[220px]">
                    {location.binding_status === 'canon_bound'
                      ? 'All downstream data linked by canonical ID'
                      : location.binding_status === 'partially_bound'
                        ? `${location.unresolved_scene_count} scene(s) and ${location.unresolved_image_count} image(s) matched by text only`
                        : 'No ID-based links — using text matching fallback'}
                  </TooltipContent>
                </Tooltip>
              );
            })()}

            {location.suggested_primary && (
              <Badge variant="secondary" className="text-[7px] px-1 py-0 gap-0.5 text-amber-600 bg-amber-500/10 border-amber-500/20">
                <Sparkles className="h-1.5 w-1.5" /> Suggested Primary
              </Badge>
            )}

            {generating && (
              <Badge variant="secondary" className="text-[7px] px-1 py-0 gap-0.5 animate-pulse">
                <Loader2 className="h-2 w-2 animate-spin" /> Generating
              </Badge>
            )}
          </div>

          {/* Hydrated metadata row */}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {/* Scene count */}
            {location.scene_count > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                <Film className="h-2.5 w-2.5" /> {location.scene_count} scene{location.scene_count !== 1 ? 's' : ''}
              </span>
            )}

            {/* Character count */}
            {location.characters_at_location.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground cursor-help">
                    <Users className="h-2.5 w-2.5" /> {location.characters_at_location.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px] max-w-[200px]">
                  {location.characters_at_location.slice(0, 8).join(', ')}
                  {location.characters_at_location.length > 8 && ` +${location.characters_at_location.length - 8}`}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Image count */}
            {location.total_images > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                <ImageIcon className="h-2.5 w-2.5" /> {location.total_images} ref{location.total_images !== 1 ? 's' : ''}
              </span>
            )}

            {/* Readiness */}
            <Badge variant="outline" className={cn('text-[7px] px-1 py-0 gap-0.5', readinessCfg.color)}>
              <ReadinessIcon className="h-2 w-2" /> {readinessCfg.label}
            </Badge>

            {/* Provenance */}
            {location.provenance && (
              <span className="text-[8px] text-muted-foreground/60 italic">{location.provenance.replace(/_/g, ' ')}</span>
            )}
          </div>
        </div>

        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0', isExpanded && 'rotate-90')} />
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-3">
        {/* Description */}
        {location.description && (
          <p className="text-[10px] text-muted-foreground mb-2 italic line-clamp-2">{location.description}</p>
        )}

        {/* Pack Blueprint */}
        {location.pack_blueprint.length > 0 && (
          <div className="mb-2">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1 flex items-center gap-1">
              <Package className="h-2.5 w-2.5" /> Pack Blueprint
            </p>
            <div className="flex flex-wrap gap-1">
              {location.pack_blueprint.map(slot => (
                <Badge
                  key={slot.slot}
                  variant={slot.recommended ? 'secondary' : 'outline'}
                  className={cn(
                    'text-[8px] px-1.5 py-0',
                    slot.recommended ? 'bg-primary/5 text-primary border-primary/20' : 'text-muted-foreground'
                  )}
                >
                  {slot.label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Error display */}
        {generationStatus?.status === 'error' && generationStatus.error && (
          <div className="mb-2 px-2 py-1.5 rounded bg-destructive/10 border border-destructive/20">
            <p className="text-[10px] text-destructive font-medium">Generation failed</p>
            <p className="text-[10px] text-destructive/80">{generationStatus.error}</p>
          </div>
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

        {/* Image grids */}
        {wideShots.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Establishing / Atmospheric</p>
            <div className="grid grid-cols-2 gap-2">
              {wideShots.map(img => (
                <LocationImageCard key={img.id} image={img} isPrimary={img.id === primaryEstablishing?.id}
                  onSetPrimary={() => setPrimary(img)} onArchive={() => setCurationState(img.id, 'archived')}
                  onRestore={() => setCurationState(img.id, 'candidate')} updating={updating} />
              ))}
            </div>
          </div>
        )}

        {detailShots.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Detail / Temporal</p>
            <div className="grid grid-cols-2 gap-2">
              {detailShots.map(img => (
                <LocationImageCard key={img.id} image={img} isPrimary={img.id === primaryDetail?.id}
                  onSetPrimary={() => setPrimary(img)} onArchive={() => setCurationState(img.id, 'archived')}
                  onRestore={() => setCurationState(img.id, 'candidate')} updating={updating} />
              ))}
            </div>
          </div>
        )}

        {others.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Other References</p>
            <ImageSelectorGrid projectId={projectId} images={others} showShotTypes showCurationControls showProvenance />
          </div>
        )}

        {locImages.length > 0 && (
          <EntityStateVariantsPanel projectId={projectId} entityType="location" entityName={location.canonical_name} entityDescription={location.description || undefined} entityCanonId={location.id} />
        )}

        {/* Generate button */}
        {!canGenerate ? (
          <div className="mt-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20">
            <p className="text-[10px] text-amber-600 font-medium">Cannot generate</p>
            <p className="text-[10px] text-amber-600/80">{location.readiness_reason}</p>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 w-full mt-2" onClick={generateLocationRef} disabled={generating}>
            {generating ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</> : <><Plus className="h-3 w-3" /> Generate Location Pack</>}
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Location Image Card ──

function LocationImageCard({
  image, isPrimary, onSetPrimary, onArchive, onRestore, updating,
}: {
  image: ProjectImage; isPrimary: boolean;
  onSetPrimary: () => void; onArchive: () => void; onRestore: () => void;
  updating: string | null;
}) {
  const isArchived = image.curation_state === 'archived';
  const isUpdating = updating === image.id;

  return (
    <div className={cn(
      'group relative rounded-md overflow-hidden border-2 transition-all aspect-video bg-muted',
      isPrimary ? 'border-primary ring-1 ring-primary/30' : isArchived ? 'border-border/30 opacity-50' : 'border-border/50 hover:border-primary/40',
    )}>
      {image.signedUrl ? (
        <img src={image.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center"><MapPin className="h-6 w-6 text-muted-foreground/30" /></div>
      )}
      {isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge className="text-[7px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5"><Star className="h-1.5 w-1.5" /> Primary</Badge>
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isPrimary && !isArchived && (
            <button className="flex-1 flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-primary/80 text-primary-foreground text-[8px] font-medium hover:bg-primary/90"
              onClick={e => { e.stopPropagation(); onSetPrimary(); }} disabled={isUpdating}>
              {isUpdating ? <Loader2 className="h-2 w-2 animate-spin" /> : <Star className="h-2 w-2" />} Primary
            </button>
          )}
          {!isArchived && (
            <button className="p-0.5 rounded bg-black/50 text-white hover:bg-black/70" onClick={e => { e.stopPropagation(); onArchive(); }} title="Archive">
              <Archive className="h-2.5 w-2.5" />
            </button>
          )}
          {isArchived && (
            <button className="flex-1 flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-muted/80 text-foreground text-[8px] font-medium"
              onClick={e => { e.stopPropagation(); onRestore(); }}>
              <RotateCcw className="h-2 w-2" /> Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
