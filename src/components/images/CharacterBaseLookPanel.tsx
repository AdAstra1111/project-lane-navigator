/**
 * CharacterBaseLookPanel — Phase 1 character visual identity system.
 * Generates headshot + full-body candidates per character, allows selection.
 */
import { useState, useEffect, useCallback } from 'react';
import { User, Plus, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageSelectorGrid } from './ImageSelectorGrid';
import { useProjectImages } from '@/hooks/useProjectImages';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CharacterBaseLookPanelProps {
  projectId: string;
}

interface CharacterInfo {
  name: string;
  role?: string;
}

export function CharacterBaseLookPanel({ projectId }: CharacterBaseLookPanelProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Load characters from canon
  useEffect(() => {
    async function load() {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();

      if (data?.canon_json) {
        const cj = data.canon_json as any;
        if (Array.isArray(cj.characters)) {
          setCharacters(
            cj.characters
              .slice(0, 8)
              .map((c: any) => ({
                name: typeof c === 'string' ? c : c.name || 'Unknown',
                role: typeof c === 'string' ? undefined : c.role,
              }))
          );
        }
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
        Generate headshot + full-body references for each character. Select primary references to anchor visual identity.
      </p>
      {characters.map(char => (
        <CharacterLookSection key={char.name} projectId={projectId} character={char} />
      ))}
    </div>
  );
}

function CharacterLookSection({ projectId, character }: { projectId: string; character: CharacterInfo }) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const qc = useQueryClient();

  // Fetch images for this character
  const { data: charImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'character',
    subject: character.name,
    activeOnly: false,
    curationStates: ['active', 'candidate'],
  });

  const headshots = charImages.filter(i => i.shot_type === 'close_up' || i.shot_type === 'profile');
  const fullBody = charImages.filter(i => i.shot_type === 'full_body');
  const others = charImages.filter(i => !['close_up', 'profile', 'full_body'].includes(i.shot_type || ''));

  const primaryHeadshot = headshots.find(i => i.is_primary || i.curation_state === 'active');
  const primaryFullBody = fullBody.find(i => i.is_primary || i.curation_state === 'active');

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
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} images for ${character.name}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      } else {
        toast.error('No images generated successfully');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate character images');
    } finally {
      setGenerating(false);
    }
  }, [projectId, character.name, generating, qc]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        {/* Character avatar placeholder */}
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
            {primaryHeadshot && <Badge variant="secondary" className="text-[8px] px-1 py-0">Headshot ✓</Badge>}
            {primaryFullBody && <Badge variant="secondary" className="text-[8px] px-1 py-0">Full Body ✓</Badge>}
            {charImages.length === 0 && <span className="text-[10px] text-muted-foreground/60">no references</span>}
            {charImages.length > 0 && !primaryHeadshot && !primaryFullBody && (
              <span className="text-[10px] text-amber-500">{charImages.length} candidates — select primary</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {/* Headshots */}
        {headshots.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Headshots / Close-ups
            </p>
            <ImageSelectorGrid
              projectId={projectId}
              images={headshots}
              showShotTypes
              showCurationControls
              showProvenance
            />
          </div>
        )}

        {/* Full body */}
        {fullBody.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Full Body
            </p>
            <ImageSelectorGrid
              projectId={projectId}
              images={fullBody}
              showShotTypes
              showCurationControls
              showProvenance
            />
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
            <><Plus className="h-3 w-3" /> Generate Base Look Pack (5 shots)</>
          )}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
