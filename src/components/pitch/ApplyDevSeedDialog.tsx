import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FolderPlus, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { CanonJson, CanonCharacter } from '@/hooks/useProjectCanon';
import { saveProjectLaneRulesetPrefs, type RulesetPrefs } from '@/lib/rulesets/uiState';
import { buildPrefsDraft } from '@/lib/pitch/devseedHelpers';
import { getDefaultVoiceForLane } from '@/lib/writingVoices/select';

interface Props {
  idea: PitchIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Content builders ──────────────────────────────────────────────────

function buildTreatmentContent(title: string, bible: any): string {
  const lines: string[] = [`# ${title} — Treatment / Series Bible Starter`, ''];
  if (bible.world) lines.push('## World & Setting', '', bible.world, '');
  if (bible.tone_and_style) lines.push('## Tone & Style', '', bible.tone_and_style, '');
  if (bible.story_engine) lines.push('## Story Engine', '', bible.story_engine, '');
  if (bible.themes?.length) lines.push('## Themes', '', ...bible.themes.map((t: string) => `- ${t}`), '');
  return lines.join('\n');
}

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
  if (market.lane_justification) lines.push('## Lane Justification', '', market.lane_justification, '');
  if (market.timing) lines.push('## Market Timing', '', market.timing, '');
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
    for (const bp of market.buyer_positioning) lines.push(`- **${bp.buyer}:** ${bp.angle}`);
    lines.push('');
  }
  if (market.risk_summary?.length) {
    lines.push('## Risk Summary', '');
    for (const r of market.risk_summary) lines.push(`- **${r.risk}** → ${r.mitigation}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildConceptBriefContent(title: string, idea: PitchIdea, devSeed: any): string {
  const lines: string[] = [`# ${title} — Concept Brief`, ''];
  if (idea.logline) lines.push('## Logline', '', idea.logline, '');
  if (idea.one_page_pitch) lines.push('## Premise', '', idea.one_page_pitch, '');
  if (idea.genre) lines.push(`**Genre:** ${idea.genre}`);
  if (idea.recommended_lane) lines.push(`**Lane:** ${idea.recommended_lane}`);
  if (idea.budget_band) lines.push(`**Budget Band:** ${idea.budget_band}`);
  if (idea.why_us) lines.push('', '## Why Us', '', idea.why_us);
  if (devSeed?.bible_starter?.story_engine) lines.push('', '## Story Engine', '', devSeed.bible_starter.story_engine);
  lines.push('');
  return lines.join('\n');
}

function buildSeasonArcStub(title: string, devSeed: any): string {
  const lines: string[] = [`# ${title} — Season Arc`, '', '> Draft stub — generate full season arc from Dev Engine.', ''];
  if (devSeed?.bible_starter?.story_engine) lines.push('## Story Engine', '', devSeed.bible_starter.story_engine, '');
  if (devSeed?.bible_starter?.themes?.length) lines.push('## Thematic Spine', '', ...devSeed.bible_starter.themes.map((t: string) => `- ${t}`), '');
  return lines.join('\n');
}

function buildBeatSheetStub(title: string): string {
  return [`# ${title} — Beat Sheet`, '', '> Draft stub — generate full beat sheet from Dev Engine.', ''].join('\n');
}

// ── Canon draft builder ───────────────────────────────────────────────

function buildCanonDraft(idea: PitchIdea, devSeed: any): CanonJson {
  const canon: CanonJson = {};

  canon.logline = idea.logline || '';
  canon.premise = idea.one_page_pitch || '';

  if (devSeed.bible_starter) {
    const bible = devSeed.bible_starter;
    if (bible.characters?.length) {
      canon.characters = bible.characters.map((c: any): CanonCharacter => ({
        name: c.name || 'Unnamed',
        role: c.role || '',
        goals: c.arc || '',
        traits: c.flaw ? `Flaw: ${c.flaw}` : '',
      }));
    }
    if (bible.world) canon.world_rules = bible.world;
    if (bible.tone_and_style) canon.tone_style = bible.tone_and_style;
    if (bible.themes?.length) canon.ongoing_threads = bible.themes.join('; ');
  }

  if (devSeed.nuance_contract?.tone_boundaries) {
    canon.forbidden_changes = devSeed.nuance_contract.tone_boundaries;
  }

  return canon;
}

// buildPrefsDraft moved to @/lib/pitch/devseedHelpers

// ── Doc helper (hardened) ─────────────────────────────────────────────

interface DocStyleMeta {
  lane?: string;
  style_benchmark?: string | null;
  pacing_feel?: string;
  seeded_from?: { pitch_idea_id?: string; concept_expansion_id?: string | null };
  applied_at?: string;
}

async function createDocWithVersion(
  projectId: string,
  userId: string,
  docType: string,
  title: string,
  content: string,
  styleMeta?: DocStyleMeta,
) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
  const filePath = `${userId}/${projectId}/${slug}.md`;
  const { data: doc, error: docErr } = await supabase
    .from('project_documents')
    .insert({
      project_id: projectId,
      user_id: userId,
      doc_type: docType,
      title,
      file_name: `${slug}.md`,
      file_path: filePath,
      extraction_status: 'complete',
      plaintext: content,
      extracted_text: content,
    } as any)
    .select('id')
    .single();

  if (docErr) {
    console.error(`Doc insert failed [${docType}]:`, docErr.message);
    throw new Error(`Failed to create ${docType} document: ${docErr.message}`);
  }

  const versionPayload: Record<string, unknown> = {
    document_id: doc.id,
    version_number: 1,
    plaintext: content,
    status: 'draft',
    is_current: true,
    created_by: userId,
  };
  if (styleMeta) {
    versionPayload.meta_json = styleMeta;
  }

  const { error: verErr } = await supabase
    .from('project_document_versions')
    .insert(versionPayload as any);

  if (verErr) {
    console.error(`Version insert failed [${docType}]:`, verErr.message);
    // Don't throw — doc exists, version is secondary
  }

  return doc;
}

// ── Lane helpers ──────────────────────────────────────────────────────

const SERIES_LANES = ['fast-turnaround', 'vertical-drama', 'tv-series', 'limited-series', 'digital-series'];

function isSeriesLane(lane: string): boolean {
  const norm = lane.toLowerCase().replace(/[-_\s]+/g, '');
  return SERIES_LANES.some(s => norm.includes(s.replace(/-/g, '')));
}

// ── Component ─────────────────────────────────────────────────────────

export function ApplyDevSeedDialog({ idea, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [applyDocs, setApplyDocs] = useState(true);
  const [applyCanon, setApplyCanon] = useState(true); // default ON now
  const [applyPrefs, setApplyPrefs] = useState(false);

  if (!idea) return null;

  const defaultTitle = idea.title || 'Untitled Project';

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const title = projectTitle.trim() || defaultTitle;
      const lane = idea.recommended_lane || 'independent-film';

      // 1. Create project
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .insert({
          title,
          user_id: user.id,
          format: idea.production_type || 'film',
          genres: idea.genre ? [idea.genre] : [],
          assigned_lane: lane,
          budget_range: idea.budget_band || '',
          source_pitch_idea_id: idea.id,
        } as any)
        .select('id')
        .single();

      if (projErr) throw projErr;

      // 2. Update pitch idea
      await supabase
        .from('pitch_ideas')
        .update({ promoted_to_project_id: project.id, status: 'in-development' } as any)
        .eq('id', idea.id);

      // 3. Always create Idea doc
      const ideaContent = [
        `# ${title}`,
        '',
        `**Logline:** ${idea.logline}`,
        '',
        idea.one_page_pitch || '',
        '',
        idea.why_us ? `**Why Us:** ${idea.why_us}` : '',
      ].filter(Boolean).join('\n');

      // Build style meta for all seeded docs
      const baseStyleMeta: DocStyleMeta = {
        lane,
        applied_at: new Date().toISOString(),
        seeded_from: { pitch_idea_id: idea.id },
      };

      await createDocWithVersion(project.id, user.id, 'idea', `${title} — Idea`, ideaContent, baseStyleMeta);

      // 4. Fetch DevSeed (maybeSingle — may not exist if promote was skipped)
      const { data: expansion } = await supabase
        .from('concept_expansions')
        .select('id, raw_response')
        .eq('pitch_idea_id', idea.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      const devSeed = expansion?.raw_response as any;
      const expansionId = expansion?.id as string | undefined;

      if (devSeed) {
        // Enrich style meta with seed provenance + prefs draft
        const prefsDraft = buildPrefsDraft(devSeed, lane);
        const seedStyleMeta: DocStyleMeta = {
          ...baseStyleMeta,
          style_benchmark: prefsDraft.style_benchmark || null,
          pacing_feel: prefsDraft.pacing_feel,
          seeded_from: { pitch_idea_id: idea.id, concept_expansion_id: expansionId || null },
        };

        // 5. Create full starter doc pack
        if (applyDocs) {
          // Concept Brief (always)
          await createDocWithVersion(project.id, user.id, 'concept_brief', `${title} — Concept Brief`, buildConceptBriefContent(title, idea, devSeed), seedStyleMeta);

          // Treatment + Character Bible
          if (devSeed.bible_starter) {
            await createDocWithVersion(project.id, user.id, 'treatment', `${title} — Treatment`, buildTreatmentContent(title, devSeed.bible_starter), seedStyleMeta);
            if (devSeed.bible_starter.characters?.length) {
              await createDocWithVersion(project.id, user.id, 'character_bible', `${title} — Characters`, buildCharacterBibleContent(title, devSeed.bible_starter.characters), seedStyleMeta);
            }
          }

          // Market Sheet
          if (devSeed.market_rationale) {
            await createDocWithVersion(project.id, user.id, 'market_sheet', `${title} — Market Sheet`, buildMarketSheetContent(title, devSeed.market_rationale, devSeed.nuance_contract), seedStyleMeta);
          }

          // Lane-conditional stubs
          if (isSeriesLane(lane)) {
            await createDocWithVersion(project.id, user.id, 'season_arc', `${title} — Season Arc`, buildSeasonArcStub(title, devSeed), seedStyleMeta);
          } else {
            await createDocWithVersion(project.id, user.id, 'beat_sheet', `${title} — Beat Sheet`, buildBeatSheetStub(title), seedStyleMeta);
          }
        }

        // 6. Always plant canon top-level keys from seed (provenance + top-level)
        const canonTopLevel = buildCanonDraft(idea, devSeed);
        const seedDraft = {
          ...canonTopLevel,
          source_pitch_idea_id: idea.id,
          concept_expansion_id: expansionId || null,
          lane,
          applied_at: new Date().toISOString(),
        };

        const { data: existing } = await (supabase as any)
          .from('project_canon')
          .select('canon_json')
          .eq('project_id', project.id)
          .maybeSingle();
        const existingCanon = existing?.canon_json || {};

        // Preserve previous seed_draft in history (max 10)
        const history = existingCanon.seed_draft
          ? [...(existingCanon.seed_draft_history ?? []), existingCanon.seed_draft].slice(-10)
          : existingCanon.seed_draft_history ?? [];

        // Merge: top-level canonical keys (only if empty) + seed_draft provenance
        const merged: Record<string, unknown> = { ...existingCanon };
        // Plant top-level keys only if not already set
        for (const [key, val] of Object.entries(canonTopLevel)) {
          if (val && !merged[key]) {
            merged[key] = val;
          }
        }
        merged.seed_draft = seedDraft;
        if (history.length > 0) merged.seed_draft_history = history;

        await (supabase as any)
          .from('project_canon')
          .update({ canon_json: merged, updated_by: user.id })
          .eq('project_id', project.id);

        // 7. Optional: Apply lane prefs (merge-safe)
        if (applyPrefs) {
          const prefsDraft = buildPrefsDraft(devSeed, lane);
          // Set default writing voice if not already present
          if (!prefsDraft.writing_voice) {
            const defaultVoice = getDefaultVoiceForLane(lane);
            if (defaultVoice) {
              (prefsDraft as any).writing_voice = defaultVoice;
            }
          }
          if (Object.keys(prefsDraft).length > 0) {
            await saveProjectLaneRulesetPrefs(project.id, lane, prefsDraft as RulesetPrefs, user.id);
          } else {
            toast.info('No prefs suggestions in seed');
          }
        }
      } else {
        // No devSeed — still plant basic canon from pitch idea
        const basicCanon: CanonJson = {
          logline: idea.logline || '',
          premise: idea.one_page_pitch || '',
        };
        const { data: existing } = await (supabase as any)
          .from('project_canon')
          .select('canon_json')
          .eq('project_id', project.id)
          .maybeSingle();
        const existingCanon = existing?.canon_json || {};
        const merged = { ...existingCanon };
        for (const [key, val] of Object.entries(basicCanon)) {
          if (val && !merged[key]) merged[key] = val;
        }
        await (supabase as any)
          .from('project_canon')
          .update({ canon_json: merged, updated_by: user.id })
          .eq('project_id', project.id);
      }

      // 8. Auto-fill stubs: run queued regeneration with tick polling
      let regenResult: any = null;
      if (applyDocs) {
        const startRes = await supabase.functions.invoke('dev-engine-v2', {
          body: { action: 'regen-insufficient-start', projectId: project.id, dryRun: false },
        });
        if (startRes.error) throw new Error(startRes.error.message || 'Failed to start doc regen');
        const startData = startRes.data;
        if (startData?.error) throw new Error(startData.error);
        const jobId = startData?.job_id;
        const total = startData?.total_count || 0;

        if (jobId && total > 0) {
          let done = false;
          let backoff = 500;
          while (!done) {
            const tickRes = await supabase.functions.invoke('dev-engine-v2', {
              body: { action: 'regen-insufficient-tick', jobId, maxItemsPerTick: 3 },
            });
            if (tickRes.error) throw new Error(tickRes.error.message || 'Regen tick failed');
            done = tickRes.data?.done === true;
            if (!done) {
              await new Promise(r => setTimeout(r, backoff));
              backoff = Math.min(backoff * 1.2, 3000);
            }
          }
          // Get final status
          const statusRes = await supabase.functions.invoke('dev-engine-v2', {
            body: { action: 'regen-insufficient-status', jobId },
          });
          regenResult = statusRes.data;

          // Hard guard: if any item errored, abort before navigating
          const errorItems = (regenResult?.items || []).filter((i: any) => i.status === 'error');
          if (errorItems.length > 0) {
            throw new Error(`Doc regen failed for ${errorItems[0].doc_type}: ${errorItems[0].error || 'unknown error'}`);
          }
        }
      }

      // 9. Invalidate list + docs + seed status before opening Dev Engine
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['pitch-ideas'] }),
        qc.invalidateQueries({ queryKey: ['dev-v2-docs', project.id] }),
        qc.invalidateQueries({ queryKey: ['dev-v2-versions'] }),
        qc.invalidateQueries({ queryKey: ['seed-pack-versions', project.id] }),
      ]);

      const parts: string[] = ['Project created'];
      if (applyDocs) parts.push('docs seeded');
      if (applyDocs && regenResult?.items?.length) parts.push(`autofilled ${regenResult.items.filter((i: any) => i.status === 'regenerated').length} docs`);
      parts.push('canon planted');
      if (applyPrefs) parts.push('lane prefs set');
      toast.success(parts.join(', '));

      onOpenChange(false);
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
            Creates a new project and seeds Dev Engine artifacts, canon, and optionally lane preferences from the DevSeed.
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

          {/* Apply options */}
          <div className="rounded-md border border-border/40 p-3 space-y-3">
            <p className="text-xs font-medium text-foreground">Apply options</p>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={applyDocs} onCheckedChange={(v) => setApplyDocs(!!v)} className="mt-0.5" />
              <div>
                <span className="text-sm font-medium">Create starter doc pack</span>
                <p className="text-xs text-muted-foreground">Concept Brief, Treatment, Character Bible, Market Sheet + lane-specific stubs</p>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={applyCanon} onCheckedChange={(v) => setApplyCanon(!!v)} className="mt-0.5" />
              <div>
                <span className="text-sm font-medium">Apply Canon draft</span>
                <p className="text-xs text-muted-foreground">Seed logline, characters, world rules, tone into project canon (editable, not locked)</p>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={applyPrefs} onCheckedChange={(v) => setApplyPrefs(!!v)} className="mt-0.5" />
              <div>
                <span className="text-sm font-medium">Apply Lane Prefs suggestions</span>
                <p className="text-xs text-muted-foreground">Set restraint level and conflict mode from nuance contract</p>
              </div>
            </label>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground mb-1">Always created:</p>
            <p>• New project with lane: <span className="text-foreground">{idea.recommended_lane}</span></p>
            <p>• <span className="text-foreground">Idea</span> document + canon logline/premise planted</p>
            <p>• Genre: <span className="text-foreground">{idea.genre}</span> | Budget: <span className="text-foreground">{idea.budget_band}</span></p>
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
