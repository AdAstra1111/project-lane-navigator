import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FolderPlus, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  idea: PitchIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Format DevSeed bible_starter into a markdown treatment document */
function buildTreatmentContent(title: string, bible: any): string {
  const lines: string[] = [`# ${title} — Treatment / Series Bible Starter`, ''];
  if (bible.world) {
    lines.push('## World & Setting', '', bible.world, '');
  }
  if (bible.tone_and_style) {
    lines.push('## Tone & Style', '', bible.tone_and_style, '');
  }
  if (bible.story_engine) {
    lines.push('## Story Engine', '', bible.story_engine, '');
  }
  if (bible.themes?.length) {
    lines.push('## Themes', '', ...bible.themes.map((t: string) => `- ${t}`), '');
  }
  return lines.join('\n');
}

/** Format DevSeed characters into a markdown character bible */
function buildCharacterBibleContent(title: string, characters: any[]): string {
  const lines: string[] = [`# ${title} — Character Bible`, ''];
  for (const c of characters) {
    lines.push(`## ${c.name || 'Unnamed'}`, '');
    if (c.role) lines.push(`**Role:** ${c.role}`);
    if (c.arc) lines.push(`**Arc:** ${c.arc}`);
    if (c.flaw) lines.push(`**Flaw:** ${c.flaw}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Format DevSeed market_rationale into a market sheet */
function buildMarketSheetContent(title: string, market: any, nuance: any): string {
  const lines: string[] = [`# ${title} — Market Sheet`, ''];

  if (nuance) {
    lines.push('## Nuance Contract', '');
    if (nuance.restraint_level != null) lines.push(`**Restraint Level:** ${nuance.restraint_level}/10`);
    if (nuance.restraint_rationale) lines.push(`*${nuance.restraint_rationale}*`);
    if (nuance.conflict_mode) lines.push(`**Conflict Mode:** ${nuance.conflict_mode}`);
    if (nuance.complexity_cap) {
      const cc = nuance.complexity_cap;
      lines.push(`**Complexity Cap:** ${cc.max_plot_threads || '?'} threads / ${cc.max_factions || '?'} factions / ${cc.max_core_characters || '?'} core characters`);
    }
    if (nuance.melodrama_guard) lines.push(`**Melodrama Guard:** ${nuance.melodrama_guard}`);
    if (nuance.tone_boundaries) lines.push(`**Tone Boundaries:** ${nuance.tone_boundaries}`);
    lines.push('');
  }

  if (market.lane_justification) {
    lines.push('## Lane Justification', '', market.lane_justification, '');
  }
  if (market.timing) {
    lines.push('## Market Timing', '', market.timing, '');
  }
  if (market.comparable_analysis?.length) {
    lines.push('## Comparable Analysis', '');
    for (const comp of market.comparable_analysis) {
      lines.push(`### ${comp.title}`);
      if (comp.relevance) lines.push(`**Relevance:** ${comp.relevance}`);
      if (comp.take) lines.push(`**Take:** ${comp.take}`);
      if (comp.avoid) lines.push(`**Avoid:** ${comp.avoid}`);
      lines.push('');
    }
  }
  if (market.buyer_positioning?.length) {
    lines.push('## Buyer Positioning', '');
    for (const bp of market.buyer_positioning) {
      lines.push(`- **${bp.buyer}:** ${bp.angle}`);
    }
    lines.push('');
  }
  if (market.risk_summary?.length) {
    lines.push('## Risk Summary', '');
    for (const r of market.risk_summary) {
      lines.push(`- **${r.risk}** → ${r.mitigation}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Helper to insert a project_document + its initial version */
async function createDocWithVersion(
  projectId: string,
  userId: string,
  docType: string,
  title: string,
  content: string,
) {
  const { data: doc } = await supabase
    .from('project_documents')
    .insert({
      project_id: projectId,
      user_id: userId,
      doc_type: docType,
      title,
    } as any)
    .select('id')
    .single();

  if (doc) {
    await supabase
      .from('project_document_versions')
      .insert({
        document_id: doc.id,
        project_id: projectId,
        version_number: 1,
        content,
        status: 'draft',
        is_current: true,
        created_by: userId,
      } as any);
  }
  return doc;
}

export function ApplyDevSeedDialog({ idea, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');

  if (!idea) return null;

  const defaultTitle = idea.title || 'Untitled Project';

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const title = projectTitle.trim() || defaultTitle;

      // 1. Create project
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .insert({
          title,
          user_id: user.id,
          production_format: idea.production_type || 'film',
          genre: idea.genre || '',
          assigned_lane: idea.recommended_lane || 'independent-film',
          budget_range: idea.budget_band || '',
          status: 'development',
          source_pitch_idea_id: idea.id,
        } as any)
        .select('id')
        .single();

      if (projErr) throw projErr;

      // 2. Update pitch idea with promoted_to_project_id
      await supabase
        .from('pitch_ideas')
        .update({ promoted_to_project_id: project.id, status: 'in-development' } as any)
        .eq('id', idea.id);

      // 3. Create initial "Idea" document from the pitch
      const ideaContent = [
        `# ${title}`,
        '',
        `**Logline:** ${idea.logline}`,
        '',
        idea.one_page_pitch || '',
        '',
        idea.why_us ? `**Why Us:** ${idea.why_us}` : '',
      ].filter(Boolean).join('\n');

      await createDocWithVersion(project.id, user.id, 'idea', `${title} — Idea`, ideaContent);

      // 4. Fetch DevSeed from concept_expansions
      const { data: expansion } = await supabase
        .from('concept_expansions')
        .select('raw_response')
        .eq('pitch_idea_id', idea.id)
        .order('version', { ascending: false })
        .limit(1)
        .single();

      const devSeed = expansion?.raw_response as any;

      if (devSeed) {
        // 5. Create Treatment / Bible Starter doc
        if (devSeed.bible_starter) {
          const treatmentContent = buildTreatmentContent(title, devSeed.bible_starter);
          await createDocWithVersion(project.id, user.id, 'treatment', `${title} — Treatment`, treatmentContent);

          // 6. Create Character Bible doc (if characters exist)
          if (devSeed.bible_starter.characters?.length) {
            const charContent = buildCharacterBibleContent(title, devSeed.bible_starter.characters);
            await createDocWithVersion(project.id, user.id, 'character_bible', `${title} — Characters`, charContent);
          }
        }

        // 7. Create Market Sheet doc
        if (devSeed.market_rationale) {
          const marketContent = buildMarketSheetContent(title, devSeed.market_rationale, devSeed.nuance_contract);
          await createDocWithVersion(project.id, user.id, 'market_sheet', `${title} — Market Sheet`, marketContent);
        }
      }

      // 8. Invalidate queries
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });

      toast.success('Project created with DevSeed artifacts');
      onOpenChange(false);
      // Navigate directly to Dev Engine so user sees artifacts immediately
      navigate(`/projects/${project.id}/development`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            Create Project from DevSeed
          </DialogTitle>
          <DialogDescription>
            Creates a new project and initializes Dev Engine artifacts from the DevSeed — treatment, character bible, and market sheet are created as drafts. Nothing is committed to canon until you review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Project Title</Label>
            <Input
              value={projectTitle}
              onChange={e => setProjectTitle(e.target.value)}
              placeholder={defaultTitle}
              className="h-9"
            />
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground mb-1">This will create:</p>
            <p>• New project with lane: <span className="text-foreground">{idea.recommended_lane}</span></p>
            <p>• <span className="text-foreground">Idea</span> document from the pitch logline & one-pager</p>
            <p>• <span className="text-foreground">Treatment</span> — world, tone, story engine, themes</p>
            <p>• <span className="text-foreground">Character Bible</span> — character cards with arcs & flaws</p>
            <p>• <span className="text-foreground">Market Sheet</span> — nuance contract, comps, buyer positioning</p>
            <p>• Genre: <span className="text-foreground">{idea.genre}</span> | Budget: <span className="text-foreground">{idea.budget_band}</span></p>
            <p className="mt-2 text-muted-foreground">⚠ No canon or lane prefs are written — use the Development Engine to iterate.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Skip</Button>
          <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Create & Open Dev Engine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
