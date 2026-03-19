/**
 * CharacterBaseLookPanel — Phase 1 character visual identity system.
 * Phase 3: Now includes state variant generation per character.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { User, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw } from 'lucide-react';
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

interface CharacterBaseLookPanelProps {
  projectId: string;
}

interface CharacterInfo {
  name: string;
  role?: string;
  importance?: number; // lower = more important
}

/**
 * Extract characters from canon_json with importance ordering.
 * Handles: array of strings, array of objects with name/role/importance.
 */
function extractCharacters(canonJson: any): CharacterInfo[] {
  if (!canonJson) return [];
  const raw = canonJson.characters;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const chars: CharacterInfo[] = raw.map((c: any, idx: number) => {
    if (typeof c === 'string') {
      return { name: c.trim(), role: undefined, importance: idx };
    }
    const name = (c.name || c.character_name || '').trim();
    if (!name || name === 'Unknown') return null;

    // Determine importance from role keywords
    const role = (c.role || c.archetype || '').trim();
    let importance = idx;
    const roleLower = role.toLowerCase();
    if (roleLower.includes('protagonist') || roleLower.includes('lead') || roleLower.includes('main')) {
      importance = -10 + idx;
    } else if (roleLower.includes('antagonist') || roleLower.includes('villain')) {
      importance = -5 + idx;
    } else if (roleLower.includes('supporting') || roleLower.includes('secondary')) {
      importance = 10 + idx;
    }

    return { name, role, importance };
  }).filter(Boolean) as CharacterInfo[];

  // Sort by importance (lower = more important), then alphabetical
  chars.sort((a, b) => (a.importance || 0) - (b.importance || 0));

  // Limit to 10 max
  return chars.slice(0, 10);
}

export function CharacterBaseLookPanel({ projectId }: CharacterBaseLookPanelProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();

      if (data?.canon_json) {
        setCharacters(extractCharacters(data.canon_json));
      }
      setLoading(false);
    }
    load();
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading characters...</span>
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-muted-foreground">
          No characters found in project canon. Add characters to enable base look development.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <User className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Character Base Looks</h3>
        <Badge variant="secondary" className="text-[10px]">{characters.length} characters</Badge>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">
        Generate headshot + full-body references per character. Select explicit primary references to anchor visual identity.
      </p>
      {characters.map(char => (
        <CharacterLookSection key={char.name} projectId={projectId} character={char} />
      ))}
    </div>
  );
}

type CharFilter = 'all' | 'active' | 'candidate' | 'archived';

function CharacterLookSection({ projectId, character }: { projectId: string; character: CharacterInfo }) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<CharFilter>('all');
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);

  // Fetch ALL images for this character (including archived)
  const { data: charImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'character',
    subject: character.name,
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived'],
  });

  // Apply client filter
  const filteredImages = useMemo(() => {
    if (filter === 'all') return charImages.filter(i => i.curation_state !== 'rejected');
    return charImages.filter(i => i.curation_state === filter);
  }, [charImages, filter]);

  const headshots = filteredImages.filter(i => i.shot_type === 'close_up' || i.shot_type === 'profile');
  const fullBody = filteredImages.filter(i => i.shot_type === 'full_body');
  const others = filteredImages.filter(i => !['close_up', 'profile', 'full_body'].includes(i.shot_type || ''));

  // Primary = is_primary ONLY (not curation_state fallback)
  const primaryHeadshot = charImages.find(i => i.is_primary && (i.shot_type === 'close_up' || i.shot_type === 'profile'));
  const primaryFullBody = charImages.find(i => i.is_primary && i.shot_type === 'full_body');

  const activeCount = charImages.filter(i => i.curation_state === 'active').length;
  const candidateCount = charImages.filter(i => i.curation_state === 'candidate').length;
  const archivedCount = charImages.filter(i => i.curation_state === 'archived').length;

  const generateBaseLook = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: 'character',
          count: 5,
          character_name: character.name,
          asset_group: 'character',
          pack_mode: true,
          base_look_mode: true, // Ensures guaranteed headshot + full-body
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} images for ${character.name}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
        qc.invalidateQueries({ queryKey: ['section-images', projectId] });
      } else {
        toast.error('No images generated successfully');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate character images');
    } finally {
      setGenerating(false);
    }
  }, [projectId, character.name, generating, qc]);

  const handleSetPrimaryHeadshot = useCallback(async (img: ProjectImage) => {
    await setPrimary(img);
  }, [setPrimary]);

  const handleSetPrimaryFullBody = useCallback(async (img: ProjectImage) => {
    await setPrimary(img);
  }, [setPrimary]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {primaryHeadshot?.signedUrl ? (
            <img src={primaryHeadshot.signedUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{character.name}</span>
          {character.role && (
            <span className="text-[10px] text-muted-foreground ml-1.5">({character.role})</span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            {primaryHeadshot && <Badge variant="secondary" className="text-[8px] px-1 py-0">Primary Headshot ✓</Badge>}
            {primaryFullBody && <Badge variant="secondary" className="text-[8px] px-1 py-0">Primary Full Body ✓</Badge>}
            {charImages.length === 0 && <span className="text-[10px] text-muted-foreground/60">no references</span>}
            {charImages.length > 0 && !primaryHeadshot && !primaryFullBody && (
              <span className="text-[10px] text-accent">{charImages.length} candidates — select primaries</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {/* Filter bar */}
        {charImages.length > 0 && (
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {(['all', 'active', 'candidate', 'archived'] as CharFilter[]).map(f => (
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

        {/* Headshots with explicit primary selection */}
        {headshots.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Headshots / Close-ups
              </p>
              {primaryHeadshot && (
                <Badge className="text-[8px] bg-primary/90 text-primary-foreground px-1.5 py-0">
                  Primary: {primaryHeadshot.shot_type}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {headshots.map(img => (
                <CharacterImageCard
                  key={img.id}
                  image={img}
                  isPrimary={img.id === primaryHeadshot?.id}
                  onSetPrimary={() => handleSetPrimaryHeadshot(img)}
                  onArchive={() => setCurationState(img.id, 'archived')}
                  onRestore={() => setCurationState(img.id, 'candidate')}
                  updating={updating}
                />
              ))}
            </div>
          </div>
        )}

        {/* Full body with explicit primary selection */}
        {fullBody.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Full Body
              </p>
              {primaryFullBody && (
                <Badge className="text-[8px] bg-primary/90 text-primary-foreground px-1.5 py-0">
                  Primary
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {fullBody.map(img => (
                <CharacterImageCard
                  key={img.id}
                  image={img}
                  isPrimary={img.id === primaryFullBody?.id}
                  onSetPrimary={() => handleSetPrimaryFullBody(img)}
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
          onClick={generateBaseLook}
          disabled={generating}
        >
          {generating ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
          ) : (
            <><Plus className="h-3 w-3" /> Generate Base Look Pack (2 headshots + 2 full-body + 1 medium)</>
          )}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Individual character image card with explicit primary selection controls.
 */
function CharacterImageCard({
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
          <User className="h-6 w-6 text-muted-foreground/30" />
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

      {/* Subject badge */}
      {image.subject && !isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-black/50 text-white/80 border-0">
            {image.subject}
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
