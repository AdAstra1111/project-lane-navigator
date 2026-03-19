/**
 * CharacterBaseLookPanel — Character visual identity + reference system.
 * Split into two sections:
 * 1. CHARACTER IDENTITY (top) — neutral studio-style identity anchors
 * 2. CHARACTER REFERENCES (below) — cinematic scene-based imagery
 * Identity images use generation_purpose='character_identity' and identity_* shot types.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { User, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw, Lock, ShieldCheck, AlertTriangle, CheckCircle, FileText, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageSelectorGrid } from './ImageSelectorGrid';
import { EntityStateVariantsPanel } from './EntityStateVariantsPanel';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
import { useCharacterIdentityNotes } from '@/hooks/useCharacterIdentityNotes';
import { resolveCharacterIdentity, checkIdentityNotesAgainstCanon } from '@/lib/images/identityResolver';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, CurationState } from '@/lib/images/types';
import { isCharacterIdentityImage, IDENTITY_SHOT_TYPES } from '@/lib/images/types';

interface CharacterBaseLookPanelProps {
  projectId: string;
}

interface CharacterInfo {
  name: string;
  role?: string;
  importance?: number;
}

/**
 * Extract characters from canon_json with importance ordering.
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

  chars.sort((a, b) => (a.importance || 0) - (b.importance || 0));
  return chars.slice(0, 10);
}

export function CharacterBaseLookPanel({ projectId }: CharacterBaseLookPanelProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [canonJson, setCanonJson] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();

      if (data?.canon_json) {
        setCanonJson(data.canon_json);
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
          No characters found in project canon. Add characters to enable visual identity development.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <User className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Character Visual Identity</h3>
        <Badge variant="secondary" className="text-[10px]">{characters.length} characters</Badge>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">
        Establish locked visual identity (face + body) before generating scene imagery. Identity anchors ensure continuity across all outputs.
      </p>
      {characters.map(char => (
        <CharacterSection key={char.name} projectId={projectId} character={char} canonJson={canonJson} />
      ))}
    </div>
  );
}

type CharFilter = 'all' | 'active' | 'candidate' | 'archived';

function CharacterSection({ projectId, character }: { projectId: string; character: CharacterInfo }) {
  const [open, setOpen] = useState(false);

  // Fetch ALL images for this character (including archived)
  const { data: allImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'character',
    subject: character.name,
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived'],
  });

  // Split identity vs reference images
  const identityImages = useMemo(() =>
    allImages.filter(img => isCharacterIdentityImage(img)),
    [allImages]
  );
  const referenceImages = useMemo(() =>
    allImages.filter(img => !isCharacterIdentityImage(img)),
    [allImages]
  );

  const primaryIdentityHeadshot = identityImages.find(i => i.is_primary && i.shot_type === 'identity_headshot');
  const primaryIdentityFullBody = identityImages.find(i => i.is_primary && i.shot_type === 'identity_full_body');
  const identityLocked = !!primaryIdentityHeadshot && !!primaryIdentityFullBody;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {primaryIdentityHeadshot?.signedUrl ? (
            <img src={primaryIdentityHeadshot.signedUrl} alt="" className="w-full h-full object-cover" />
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
            {identityLocked ? (
              <Badge className="text-[8px] px-1 py-0 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-0.5">
                <Lock className="h-2 w-2" /> Identity Locked
              </Badge>
            ) : identityImages.length > 0 ? (
              <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5 text-amber-600">
                <AlertTriangle className="h-2 w-2" /> Select Primaries
              </Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground/60">no identity yet</span>
            )}
            {referenceImages.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{referenceImages.length} refs</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {/* === SECTION 1: CHARACTER IDENTITY === */}
        <CharacterIdentitySection
          projectId={projectId}
          character={character}
          identityImages={identityImages}
          identityLocked={identityLocked}
        />

        {/* === SECTION 2: CHARACTER REFERENCES === */}
        <CharacterReferenceSection
          projectId={projectId}
          character={character}
          referenceImages={referenceImages}
          identityLocked={identityLocked}
        />

        {/* Phase 3: State Variants */}
        {allImages.length > 0 && (
          <EntityStateVariantsPanel
            projectId={projectId}
            entityType="character"
            entityName={character.name}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── IDENTITY SECTION ────────────────────────────────────────────────────────

function CharacterIdentitySection({
  projectId, character, identityImages, identityLocked,
}: {
  projectId: string;
  character: CharacterInfo;
  identityImages: ProjectImage[];
  identityLocked: boolean;
}) {
  const [generating, setGenerating] = useState(false);
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);

  const headshots = identityImages.filter(i => i.shot_type === 'identity_headshot');
  const profiles = identityImages.filter(i => i.shot_type === 'identity_profile');
  const fullBodies = identityImages.filter(i => i.shot_type === 'identity_full_body');

  const primaryHeadshot = identityImages.find(i => i.is_primary && i.shot_type === 'identity_headshot');
  const primaryProfile = identityImages.find(i => i.is_primary && i.shot_type === 'identity_profile');
  const primaryFullBody = identityImages.find(i => i.is_primary && i.shot_type === 'identity_full_body');

  const generateIdentity = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: 'character',
          count: 3,
          character_name: character.name,
          asset_group: 'character',
          pack_mode: true,
          identity_mode: true,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} identity images for ${character.name}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      } else {
        toast.error('No identity images generated');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate identity pack');
    } finally {
      setGenerating(false);
    }
  }, [projectId, character.name, generating, qc]);

  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
          Character Identity
        </span>
        {identityLocked && (
          <Badge className="text-[7px] px-1 py-0 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-0.5">
            <Lock className="h-1.5 w-1.5" /> Locked
          </Badge>
        )}
      </div>
      <p className="text-[9px] text-muted-foreground mb-2">
        Neutral studio-style identity anchors. Select primary headshot + full body to lock identity.
      </p>

      {identityImages.length === 0 ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7 w-full"
          onClick={generateIdentity}
          disabled={generating}
        >
          {generating ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Generating Identity Pack...</>
          ) : (
            <><ShieldCheck className="h-3 w-3" /> Generate Identity Pack (headshot + profile + full body)</>
          )}
        </Button>
      ) : (
        <>
          {/* Identity Headshots */}
          {headshots.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Identity Headshot</p>
                {primaryHeadshot && (
                  <Badge className="text-[7px] bg-emerald-500/15 text-emerald-600 px-1 py-0">Primary ✓</Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {headshots.map(img => (
                  <IdentityImageCard
                    key={img.id}
                    image={img}
                    isPrimary={img.id === primaryHeadshot?.id}
                    onSetPrimary={() => setPrimary(img)}
                    onArchive={() => setCurationState(img.id, 'archived')}
                    onRestore={() => setCurationState(img.id, 'candidate')}
                    updating={updating}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Identity Profiles */}
          {profiles.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Identity Profile</p>
                {primaryProfile && (
                  <Badge className="text-[7px] bg-emerald-500/15 text-emerald-600 px-1 py-0">Primary ✓</Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {profiles.map(img => (
                  <IdentityImageCard
                    key={img.id}
                    image={img}
                    isPrimary={img.id === primaryProfile?.id}
                    onSetPrimary={() => setPrimary(img)}
                    onArchive={() => setCurationState(img.id, 'archived')}
                    onRestore={() => setCurationState(img.id, 'candidate')}
                    updating={updating}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Identity Full Body */}
          {fullBodies.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Identity Full Body</p>
                {primaryFullBody && (
                  <Badge className="text-[7px] bg-emerald-500/15 text-emerald-600 px-1 py-0">Primary ✓</Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {fullBodies.map(img => (
                  <IdentityImageCard
                    key={img.id}
                    image={img}
                    isPrimary={img.id === primaryFullBody?.id}
                    onSetPrimary={() => setPrimary(img)}
                    onArchive={() => setCurationState(img.id, 'archived')}
                    onRestore={() => setCurationState(img.id, 'candidate')}
                    updating={updating}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Re-generate button */}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-[10px] h-6 w-full text-muted-foreground"
            onClick={generateIdentity}
            disabled={generating}
          >
            {generating ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Plus className="h-2.5 w-2.5" />
            )}
            Generate More Identity Candidates
          </Button>
        </>
      )}
    </div>
  );
}

// ─── REFERENCE SECTION ───────────────────────────────────────────────────────

function CharacterReferenceSection({
  projectId, character, referenceImages, identityLocked,
}: {
  projectId: string;
  character: CharacterInfo;
  referenceImages: ProjectImage[];
  identityLocked: boolean;
}) {
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<CharFilter>('all');
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);

  const filteredImages = useMemo(() => {
    if (filter === 'all') return referenceImages.filter(i => i.curation_state !== 'rejected');
    return referenceImages.filter(i => i.curation_state === filter);
  }, [referenceImages, filter]);

  const headshots = filteredImages.filter(i => i.shot_type === 'close_up' || i.shot_type === 'profile');
  const fullBody = filteredImages.filter(i => i.shot_type === 'full_body');
  const others = filteredImages.filter(i => !['close_up', 'profile', 'full_body'].includes(i.shot_type || ''));

  const primaryHeadshot = referenceImages.find(i => i.is_primary && (i.shot_type === 'close_up' || i.shot_type === 'profile'));
  const primaryFullBody = referenceImages.find(i => i.is_primary && i.shot_type === 'full_body');

  const activeCount = referenceImages.filter(i => i.curation_state === 'active').length;
  const candidateCount = referenceImages.filter(i => i.curation_state === 'candidate').length;
  const archivedCount = referenceImages.filter(i => i.curation_state === 'archived').length;

  const generateReferences = useCallback(async () => {
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
          base_look_mode: true,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} reference images for ${character.name}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
        qc.invalidateQueries({ queryKey: ['section-images', projectId] });
      } else {
        toast.error('No images generated successfully');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate character references');
    } finally {
      setGenerating(false);
    }
  }, [projectId, character.name, generating, qc]);

  return (
    <div className="mb-3 border-t border-border/50 pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
          Cinematic References
        </span>
        {!identityLocked && referenceImages.length === 0 && (
          <span className="text-[9px] text-amber-600">
            (generate identity first for best results)
          </span>
        )}
      </div>

      {/* Filter bar */}
      {referenceImages.length > 0 && (
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

      {/* Headshots */}
      {headshots.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Headshots / Close-ups</p>
            {primaryHeadshot && (
              <Badge className="text-[7px] bg-primary/90 text-primary-foreground px-1 py-0">Primary ✓</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {headshots.map(img => (
              <CharacterImageCard
                key={img.id}
                image={img}
                isPrimary={img.id === primaryHeadshot?.id}
                onSetPrimary={() => setPrimary(img)}
                onArchive={() => setCurationState(img.id, 'archived')}
                onRestore={() => setCurationState(img.id, 'candidate')}
                updating={updating}
              />
            ))}
          </div>
        </div>
      )}

      {/* Full body */}
      {fullBody.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Full Body</p>
            {primaryFullBody && (
              <Badge className="text-[7px] bg-primary/90 text-primary-foreground px-1 py-0">Primary ✓</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {fullBody.map(img => (
              <CharacterImageCard
                key={img.id}
                image={img}
                isPrimary={img.id === primaryFullBody?.id}
                onSetPrimary={() => setPrimary(img)}
                onArchive={() => setCurationState(img.id, 'archived')}
                onRestore={() => setCurationState(img.id, 'candidate')}
                updating={updating}
              />
            ))}
          </div>
        </div>
      )}

      {/* Others */}
      {others.length > 0 && (
        <div className="mb-2">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Other References</p>
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
        onClick={generateReferences}
        disabled={generating}
      >
        {generating ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
        ) : (
          <><Plus className="h-3 w-3" /> Generate Reference Pack (2 headshots + 2 full-body + 1 medium)</>
        )}
      </Button>
    </div>
  );
}

// ─── IMAGE CARDS ─────────────────────────────────────────────────────────────

function IdentityImageCard({
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
      'group relative rounded-md overflow-hidden border-2 transition-all aspect-[3/4] bg-muted',
      isPrimary
        ? 'border-emerald-500 ring-1 ring-emerald-500/30'
        : isArchived
          ? 'border-border/30 opacity-50'
          : 'border-border/50 hover:border-emerald-500/40',
    )}>
      {image.signedUrl ? (
        <img src={image.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-muted-foreground/30" />
        </div>
      )}

      {isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge className="text-[8px] bg-emerald-500/90 text-white px-1 py-0 gap-0.5">
            <Lock className="h-2 w-2" /> Primary
          </Badge>
        </div>
      )}

      {!isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-[7px] px-1 py-0 bg-black/50 text-white/80 border-0">
            {image.shot_type?.replace('identity_', '') || 'id'}
          </Badge>
        </div>
      )}

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isPrimary && !isArchived && (
            <button
              className="flex-1 flex items-center justify-center gap-0.5 px-1.5 py-1 rounded bg-emerald-500/80 text-white text-[9px] font-medium hover:bg-emerald-500/90"
              onClick={(e) => { e.stopPropagation(); onSetPrimary(); }}
              disabled={isUpdating}
            >
              {isUpdating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Lock className="h-2.5 w-2.5" />}
              Lock as Primary
            </button>
          )}
          {!isArchived && !isPrimary && (
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

      {isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge className="text-[9px] bg-primary/90 text-primary-foreground px-1 py-0 gap-0.5">
            <Star className="h-2 w-2" /> Primary
          </Badge>
        </div>
      )}

      {image.subject && !isPrimary && (
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-black/50 text-white/80 border-0">
            {image.shot_type?.replace('_', ' ') || image.subject}
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
