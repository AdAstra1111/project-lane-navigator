/**
 * EntityStateVariantsPanel — Story-aware stateful visual continuity.
 * Now persists structured entity_visual_states records alongside image generation.
 * Supports both preset-based and story-derived state variants.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Layers, Plus, Loader2, Star, Archive, RotateCcw, ChevronRight, CheckCircle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
import { useEntityVisualStates, CHARACTER_STATE_CATEGORIES, LOCATION_STATE_CATEGORIES } from '@/hooks/useEntityVisualStates';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, ShotType } from '@/lib/images/types';
import type { StatePreset } from '@/lib/images/statePresets';
import { CHARACTER_STATE_PRESETS, LOCATION_STATE_PRESETS } from '@/lib/images/statePresets';
import { resolveCharacterIdentity } from '@/lib/images/identityResolver';

interface EntityStateVariantsPanelProps {
  projectId: string;
  entityType: 'character' | 'location';
  entityName: string;
  entityDescription?: string;
  /** Canonical location ID — required for location entities when available */
  entityCanonId?: string;
}

export function EntityStateVariantsPanel({
  projectId, entityType, entityName, entityDescription, entityCanonId,
}: EntityStateVariantsPanelProps) {
  const presets = entityType === 'character' ? CHARACTER_STATE_PRESETS : LOCATION_STATE_PRESETS;
  const categories = entityType === 'character' ? CHARACTER_STATE_CATEGORIES : LOCATION_STATE_CATEGORIES;
  const assetGroup = entityType === 'character' ? 'character' : 'world';
  const { states, getStatesForEntity, createState } = useEntityVisualStates(projectId);

  const entityStates = useMemo(
    () => getStatesForEntity(entityType, entityName),
    [states, entityType, entityName, getStatesForEntity]
  );

  // Fetch all state-variant images for this entity
  const { data: stateImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: assetGroup as any,
    subject: entityName,
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived'],
  });

  // Group by state_key
  const stateGroups = useMemo(() => {
    const groups = new Map<string, ProjectImage[]>();
    for (const img of stateImages) {
      if (!img.state_key) continue;
      if (!groups.has(img.state_key)) groups.set(img.state_key, []);
      groups.get(img.state_key)!.push(img);
    }
    return groups;
  }, [stateImages]);

  const existingStates = Array.from(stateGroups.keys());
  const totalStateImages = Array.from(stateGroups.values()).reduce((s, imgs) => s + imgs.length, 0);

  // Merge: show structured states + image-backed states
  const allStateKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of entityStates) keys.add(s.state_key);
    for (const k of existingStates) keys.add(k);
    return Array.from(keys);
  }, [entityStates, existingStates]);

  if (totalStateImages === 0 && entityStates.length === 0 && !isLoading) {
    return (
      <StateGenerationBar
        projectId={projectId}
        entityType={entityType}
        entityName={entityName}
        entityDescription={entityDescription}
        entityCanonId={entityCanonId}
        presets={presets}
        existingStates={existingStates}
        onStateCreated={() => {}}
      />
    );
  }

  return (
    <div className="space-y-1 mt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          State Variants
        </span>
        <Badge variant="secondary" className="text-[8px]">
          {allStateKeys.length} state{allStateKeys.length !== 1 ? 's' : ''}
        </Badge>
        {totalStateImages > 0 && (
          <span className="text-[8px] text-muted-foreground">({totalStateImages} images)</span>
        )}
      </div>

      {/* Structured states (from entity_visual_states) without images */}
      {entityStates
        .filter(s => !stateGroups.has(s.state_key))
        .map(state => (
          <div key={state.id} className="flex items-center gap-2 py-1 px-2 rounded bg-muted/20 border border-border/30">
            <Badge variant="outline" className="text-[7px] px-1 py-0">{state.state_category}</Badge>
            <span className="text-[10px] text-foreground flex-1">{state.state_label}</span>
            <Badge className={cn(
              'text-[7px] px-1 py-0',
              state.confidence === 'approved'
                ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-600 border-amber-500/20',
            )}>
              {state.confidence === 'approved' ? 'Approved' : 'Proposed'}
            </Badge>
            <span className="text-[8px] text-muted-foreground">No images yet</span>
          </div>
        ))}

      {/* Image-backed state groups */}
      {Array.from(stateGroups.entries()).map(([stateKey, images]) => {
        const structuredState = entityStates.find(s => s.state_key === stateKey);
        return (
          <StateGroupSection
            key={stateKey}
            projectId={projectId}
            stateKey={stateKey}
            stateLabel={structuredState?.state_label || images[0]?.state_label || stateKey}
            stateCategory={structuredState?.state_category}
            confidence={structuredState?.confidence}
            images={images}
          />
        );
      })}

      <StateGenerationBar
        projectId={projectId}
        entityType={entityType}
        entityName={entityName}
        entityDescription={entityDescription}
        presets={presets}
        existingStates={allStateKeys}
        onStateCreated={() => {}}
      />
    </div>
  );
}

function StateGroupSection({
  projectId, stateKey, stateLabel, stateCategory, confidence, images,
}: {
  projectId: string;
  stateKey: string;
  stateLabel: string;
  stateCategory?: string;
  confidence?: string;
  images: ProjectImage[];
}) {
  const [open, setOpen] = useState(false);
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);
  const primary = images.find(i => i.is_primary);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-1.5 px-2 rounded hover:bg-muted/40 transition-colors text-left group">
        <div className="w-5 h-5 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {primary?.signedUrl ? (
            <img src={primary.signedUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Layers className="h-2.5 w-2.5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground capitalize">{stateLabel}</span>
          <span className="text-[9px] text-muted-foreground">({images.length})</span>
          {stateCategory && (
            <Badge variant="outline" className="text-[7px] px-1 py-0">{stateCategory}</Badge>
          )}
          {confidence === 'approved' && (
            <CheckCircle className="h-2.5 w-2.5 text-emerald-500" />
          )}
          {primary && (
            <Badge variant="secondary" className="text-[7px] px-1 py-0">Primary ✓</Badge>
          )}
        </div>
        <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2">
        <div className="grid grid-cols-3 gap-1.5 mt-1">
          {images.filter(i => i.curation_state !== 'rejected').map(img => (
            <StateImageCard
              key={img.id}
              image={img}
              isPrimary={img.id === primary?.id}
              onSetPrimary={() => setPrimary(img)}
              onArchive={() => setCurationState(img.id, 'archived')}
              onRestore={() => setCurationState(img.id, 'candidate')}
              updating={updating}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StateImageCard({
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
      'group relative rounded overflow-hidden border-2 transition-all aspect-video bg-muted',
      isPrimary ? 'border-primary ring-1 ring-primary/30'
        : isArchived ? 'border-border/30 opacity-50'
        : 'border-border/50 hover:border-primary/40',
    )}>
      {image.signedUrl ? (
        <img src={image.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Layers className="h-4 w-4 text-muted-foreground/30" />
        </div>
      )}
      {isPrimary && (
        <div className="absolute top-0.5 left-0.5">
          <Badge className="text-[7px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
            <Star className="h-1.5 w-1.5" /> Primary
          </Badge>
        </div>
      )}
      {!isPrimary && image.state_label && (
        <div className="absolute top-0.5 left-0.5">
          <Badge variant="secondary" className="text-[7px] px-1 py-0 bg-black/50 text-white/80 border-0 capitalize">
            {image.shot_type?.replace('_', ' ') || 'ref'}
          </Badge>
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute bottom-0.5 left-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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

function StateGenerationBar({
  projectId, entityType, entityName, entityDescription, entityCanonId, presets, existingStates, onStateCreated,
}: {
  projectId: string;
  entityType: 'character' | 'location';
  entityName: string;
  entityDescription?: string;
  entityCanonId?: string;
  presets: StatePreset[];
  existingStates: string[];
  onStateCreated: () => void;
}) {
  const [generating, setGenerating] = useState<string | null>(null);
  const [identityAnchors, setIdentityAnchors] = useState<{ headshot?: string; fullBody?: string } | null>(null);
  const qc = useQueryClient();
  const { createState } = useEntityVisualStates(projectId);

  useEffect(() => {
    if (entityType !== 'character') return;
    resolveCharacterIdentity(projectId, entityName).then(state => {
      if (state.locked && state.headshot && state.fullBody) {
        setIdentityAnchors({ headshot: state.headshot.storage_path, fullBody: state.fullBody.storage_path });
      }
    });
  }, [projectId, entityName, entityType]);

  const availablePresets = presets.filter(p => !existingStates.includes(p.key));

  const generateState = useCallback(async (preset: StatePreset) => {
    if (generating) return;
    setGenerating(preset.key);

    const isCharacter = entityType === 'character';
    const shotTypes: ShotType[] = isCharacter
      ? ['close_up', 'full_body']
      : ['wide', 'atmospheric'];

    // Persist structured state record
    try {
      await createState.mutateAsync({
        entityType,
        entityName,
        stateKey: preset.key,
        stateLabel: preset.label,
        stateCategory: isCharacter ? 'costume' : 'time_of_day', // infer from preset
        canonicalDescription: preset.promptModifier,
        sourceReason: 'preset_generation',
        confidence: 'proposed',
      });
    } catch {
      // May already exist, continue with generation
    }

    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: isCharacter ? 'character' : 'world',
          count: shotTypes.length,
          character_name: isCharacter ? entityName : undefined,
          location_name: !isCharacter ? entityName : undefined,
          location_description: !isCharacter ? entityDescription : undefined,
          location_id: !isCharacter ? entityCanonId : undefined,
          asset_group: isCharacter ? 'character' : 'world',
          pack_mode: true,
          base_look_mode: isCharacter,
          location_ref_mode: !isCharacter,
          state_key: preset.key,
          state_label: preset.label,
          state_prompt_modifier: preset.promptModifier,
          identity_anchor_paths: isCharacter ? identityAnchors : null,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} "${preset.label}" variants for ${entityName}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        onStateCreated();
      } else {
        toast.error('No images generated');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate state variant');
    } finally {
      setGenerating(null);
    }
  }, [projectId, entityType, entityName, entityDescription, generating, qc, identityAnchors, createState, onStateCreated]);

  if (availablePresets.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="text-[9px] text-muted-foreground mb-1">Generate state variant:</p>
      <div className="flex flex-wrap gap-1">
        {availablePresets.slice(0, 4).map(preset => (
          <Button
            key={preset.key}
            size="sm"
            variant="outline"
            className="text-[9px] h-6 px-2 gap-1"
            onClick={() => generateState(preset)}
            disabled={!!generating}
          >
            {generating === preset.key ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Plus className="h-2.5 w-2.5" />
            )}
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
