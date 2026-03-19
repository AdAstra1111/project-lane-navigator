/**
 * EntityStateVariantsPanel — Phase 3 stateful visual continuity.
 * Supports generating and curating state variants for characters and locations.
 * Derives from base references: same entity, different state.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Layers, Plus, Loader2, Star, Archive, RotateCcw, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
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
}

export function EntityStateVariantsPanel({
  projectId, entityType, entityName, entityDescription,
}: EntityStateVariantsPanelProps) {
  const presets = entityType === 'character' ? CHARACTER_STATE_PRESETS : LOCATION_STATE_PRESETS;
  const assetGroup = entityType === 'character' ? 'character' : 'world';

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
      if (!img.state_key) continue; // skip base references
      if (!groups.has(img.state_key)) groups.set(img.state_key, []);
      groups.get(img.state_key)!.push(img);
    }
    return groups;
  }, [stateImages]);

  // States that already have images
  const existingStates = Array.from(stateGroups.keys());
  const totalStateImages = Array.from(stateGroups.values()).reduce((s, imgs) => s + imgs.length, 0);

  if (totalStateImages === 0 && !isLoading) {
    return (
      <StateGenerationBar
        projectId={projectId}
        entityType={entityType}
        entityName={entityName}
        entityDescription={entityDescription}
        presets={presets}
        existingStates={existingStates}
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
        <Badge variant="secondary" className="text-[8px]">{totalStateImages}</Badge>
      </div>

      {Array.from(stateGroups.entries()).map(([stateKey, images]) => (
        <StateGroupSection
          key={stateKey}
          projectId={projectId}
          stateKey={stateKey}
          stateLabel={images[0]?.state_label || stateKey}
          images={images}
        />
      ))}

      <StateGenerationBar
        projectId={projectId}
        entityType={entityType}
        entityName={entityName}
        entityDescription={entityDescription}
        presets={presets}
        existingStates={existingStates}
      />
    </div>
  );
}

function StateGroupSection({
  projectId, stateKey, stateLabel, images,
}: {
  projectId: string;
  stateKey: string;
  stateLabel: string;
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
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-foreground capitalize">{stateLabel}</span>
          <span className="text-[9px] text-muted-foreground ml-1.5">({images.length})</span>
          {primary && (
            <Badge variant="secondary" className="text-[7px] px-1 py-0 ml-1">Primary ✓</Badge>
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
  projectId, entityType, entityName, entityDescription, presets, existingStates,
}: {
  projectId: string;
  entityType: 'character' | 'location';
  entityName: string;
  entityDescription?: string;
  presets: StatePreset[];
  existingStates: string[];
}) {
  const [generating, setGenerating] = useState<string | null>(null);
  const qc = useQueryClient();

  const availablePresets = presets.filter(p => !existingStates.includes(p.key));

  const generateState = useCallback(async (preset: StatePreset) => {
    if (generating) return;
    setGenerating(preset.key);

    const isCharacter = entityType === 'character';
    const shotTypes: ShotType[] = isCharacter
      ? ['close_up', 'full_body']
      : ['wide', 'atmospheric'];

    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: isCharacter ? 'character' : 'world',
          count: shotTypes.length,
          character_name: isCharacter ? entityName : undefined,
          location_name: !isCharacter ? entityName : undefined,
          location_description: !isCharacter ? entityDescription : undefined,
          asset_group: isCharacter ? 'character' : 'world',
          pack_mode: true,
          base_look_mode: isCharacter,
          location_ref_mode: !isCharacter,
          state_key: preset.key,
          state_label: preset.label,
          state_prompt_modifier: preset.promptModifier,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} "${preset.label}" variants for ${entityName}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      } else {
        toast.error('No images generated');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate state variant');
    } finally {
      setGenerating(null);
    }
  }, [projectId, entityType, entityName, entityDescription, generating, qc]);

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
