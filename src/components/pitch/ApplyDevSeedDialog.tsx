import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FolderPlus, ArrowRight, Zap, Bot } from 'lucide-react';
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
import { useDevSeedBackfill } from '@/hooks/useDevSeedBackfill';
import { DevSeedBackfillProgress } from '@/components/pitch/DevSeedBackfillProgress';
import { AutopilotProgress, type AutopilotState } from '@/components/pitch/AutopilotProgress';
import { buildSeedIntelPack } from '@/lib/trends/seed-intel-pack';
import { useActiveSignals, useActiveCastTrends } from '@/hooks/useTrends';

interface Props {
  idea: PitchIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── DevSeed whitelist (ONLY these doc_types may be created during DevSeed) ──
const DEVSEED_DOC_TYPES = ['idea', 'concept_brief', 'treatment', 'character_bible', 'market_sheet'] as const;
type DevSeedDocType = typeof DEVSEED_DOC_TYPES[number];

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
  docType: DevSeedDocType,
  title: string,
  content: string,
  styleMeta?: DocStyleMeta,
) {
  // Hard guard: only DevSeed doc types allowed in this codepath
  if (!(DEVSEED_DOC_TYPES as readonly string[]).includes(docType)) {
    throw new Error(`DEVSEED_DOC_TYPE_NOT_ALLOWED: "${docType}" is not a valid DevSeed doc type`);
  }

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
      doc_role: 'creative_primary',
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
  // Always include created_source provenance
  const metaWithProvenance = {
    ...(styleMeta || {}),
    created_source: 'devseed',
  };
  versionPayload.meta_json = metaWithProvenance;

  const { error: verErr } = await supabase
    .from('project_document_versions')
    .insert(versionPayload as any);

  if (verErr) {
    console.error(`Version insert failed [${docType}]:`, verErr.message);
  }

  return doc;
}



// ── Component ─────────────────────────────────────────────────────────

export function ApplyDevSeedDialog({ idea, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [creatingBackfill, setCreatingBackfill] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [applyDocs, setApplyDocs] = useState(true);
  const [applyCanon, setApplyCanon] = useState(true);
  const [applyPrefs, setApplyPrefs] = useState(true);
  const [includeDevPack, setIncludeDevPack] = useState(false);
  const [enableAutopilot, setEnableAutopilot] = useState(true);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [autopilotState, setAutopilotState] = useState<AutopilotState | null>(null);
  const [autopilotTicking, setAutopilotTicking] = useState(false);
  const autopilotAbortRef = useRef(false);
  const backfill = useDevSeedBackfill(createdProjectId || undefined, idea?.id);
  const { data: allSignals = [] } = useActiveSignals();
  const { data: allCast = [] } = useActiveCastTrends();

  const defaultTitle = idea?.title || 'Untitled Project';

  // ── Autopilot tick loop ──
  const runAutopilotTicks = useCallback(async (projectId: string) => {
    if (autopilotAbortRef.current) return;
    setAutopilotTicking(true);

    try {
      let done = false;
      let iterations = 0;
      const MAX_ITERATIONS = 20;

      while (!done && iterations < MAX_ITERATIONS && !autopilotAbortRef.current) {
        iterations++;
        const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
          body: { action: 'tick', projectId },
        });

        if (error) {
          console.error('[autopilot tick] error:', error.message);
          break;
        }

        const result = data as any;
        if (result?.autopilot) {
          setAutopilotState(result.autopilot);
        }

        done = result?.done === true || result?.message === 'not_running';

        if (!done) {
          // Small delay between ticks
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (err: any) {
      console.error('[autopilot tick] exception:', err.message);
    } finally {
      setAutopilotTicking(false);
    }
  }, []);

  const handleResumeAutopilot = useCallback(async () => {
    if (!createdProjectId) return;
    autopilotAbortRef.current = false;

    // Re-start the autopilot
    const { data } = await supabase.functions.invoke('devseed-autopilot', {
      body: {
        action: 'start',
        projectId: createdProjectId,
        pitchIdeaId: idea?.id,
      },
    });

    if (data?.autopilot) {
      setAutopilotState(data.autopilot);
    }

    // Run tick loop
    runAutopilotTicks(createdProjectId);
  }, [createdProjectId, idea?.id, runAutopilotTicks]);

  // ── Status poller: keep UI in sync even if tick loop exits early ──
  useEffect(() => {
    if (!createdProjectId || !enableAutopilot || !open) return;
    // Don't poll if already complete
    if (autopilotState?.status === 'complete') return;

    const poll = async () => {
      try {
        const { data } = await supabase.functions.invoke('devseed-autopilot', {
          body: { action: 'status', projectId: createdProjectId },
        });
        if (data?.autopilot) setAutopilotState(data.autopilot);
      } catch { /* silent */ }
    };

    // Initial fetch (covers dialog reopen / refresh scenarios)
    if (!autopilotState) poll();

    const interval = setInterval(poll, 2500);
    return () => clearInterval(interval);
  }, [createdProjectId, enableAutopilot, open, autopilotState?.status]);

  if (!idea) return null;

  const handleCreate = async (withBackfill = false): Promise<string | null> => {
    if (!user) return null;
    if (withBackfill) setCreatingBackfill(true); else setCreating(true);
    autopilotAbortRef.current = false;

    try {
      const title = projectTitle.trim() || defaultTitle;
      const lane = idea.recommended_lane || 'independent-film';

      // Read devseed canon for episode count + duration
      const devseedCanon = (idea as any).devseed_canon_json || {};
      let canonEpisodeCount = devseedCanon.season_episode_count;
      let canonDurMin: number | null = typeof devseedCanon.episode_length_seconds_min === 'number' ? devseedCanon.episode_length_seconds_min : null;
      let canonDurMax: number | null = typeof devseedCanon.episode_length_seconds_max === 'number' ? devseedCanon.episode_length_seconds_max : null;

      // Auto-extract from raw_response format_summary if not explicitly set
      if (!canonEpisodeCount || typeof canonEpisodeCount !== 'number') {
        const raw = idea.raw_response as any || {};
        const fmt = raw.format_summary || raw.format || '';
        const match = fmt.match(/(\d+)\s*x\s*/i) || fmt.match(/(\d+)\s*episodes/i);
        if (match) canonEpisodeCount = parseInt(match[1]);
      }

      // Auto-extract duration from format_summary (e.g. "30 x 2-3 min")
      if (canonDurMin == null && canonDurMax == null) {
        const raw = idea.raw_response as any || {};
        const fmt = raw.format_summary || raw.format || '';
        const durMatch = fmt.match(/(\d+)\s*[-–]\s*(\d+)\s*min/i);
        if (durMatch) {
          canonDurMin = parseInt(durMatch[1]) * 60;
          canonDurMax = parseInt(durMatch[2]) * 60;
        } else {
          const singleMatch = fmt.match(/(\d+)\s*min/i);
          if (singleMatch) {
            canonDurMin = parseInt(singleMatch[1]) * 60;
            canonDurMax = canonDurMin;
          }
        }
      }

      // 1. Create project — copy canonical episode count + duration from devseed
      const projectInsert: Record<string, any> = {
        title,
        user_id: user.id,
        format: idea.production_type || 'film',
        genres: idea.genre ? [idea.genre] : [],
        assigned_lane: lane,
        budget_range: idea.budget_band || '',
        source_pitch_idea_id: idea.id,
        devseed_pitch_idea_id: idea.id,
      };

      // Copy canonical episode count if available (from devseed or parsed)
      if (typeof canonEpisodeCount === 'number' && canonEpisodeCount > 0) {
        projectInsert.season_episode_count = canonEpisodeCount;
        projectInsert.season_episode_count_locked = true;
        projectInsert.season_episode_count_source = 'devseed';
      }

      // Copy canonical duration into project columns
      if (canonDurMin != null && canonDurMax != null) {
        projectInsert.episode_target_duration_min_seconds = canonDurMin;
        projectInsert.episode_target_duration_max_seconds = canonDurMax;
        projectInsert.episode_target_duration_seconds = Math.round((canonDurMin + canonDurMax) / 2);
        console.log(`[DevSeed] Episode duration from devseed: ${canonDurMin}-${canonDurMax}s`);
      }

      const { data: project, error: projErr } = await supabase
        .from('projects')
        .insert(projectInsert as any)
        .select('id')
        .single();

      if (projErr) throw projErr;
      setCreatedProjectId(project.id);

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

          // No lane-conditional stubs — season_arc, beat_sheet, episode_grid etc.
          // are development artifacts, created only from Project Dev Engine.
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

        // ── Plant canonical duration in canon_json.format block ──
        if (canonDurMin != null && canonDurMax != null) {
          merged.format = {
            ...(typeof merged.format === 'object' && merged.format ? merged.format : {}),
            episode_duration_seconds: { min: canonDurMin, max: canonDurMax },
            episode_duration_source: 'devseed',
            episode_duration_locked: true,
          };
          // Also plant legacy keys for backward compat
          merged.episode_length_seconds_min = canonDurMin;
          merged.episode_length_seconds_max = canonDurMax;
          console.log(`[DevSeed] Planted canonical duration in canon_json.format: ${canonDurMin}-${canonDurMax}s (locked)`);
        }
        merged.seed_draft = seedDraft;
        if (history.length > 0) merged.seed_draft_history = history;

        // ── Seed Intel Pack: build from active trends and apply via canon-decisions ──
        // (Only if autopilot is OFF — autopilot handles this server-side)
        if (!enableAutopilot) {
          const productionType = idea.production_type || 'film';
          const pack = buildSeedIntelPack(allSignals, allCast, {
            lane,
            productionType,
          });
          console.log(`[DevSeed] seed_intel_pack built: ${pack.demand_signals.length} demand signals, ${pack.comparable_candidates.length} comp candidates, ${pack.genre_heat.length} genre heat`);

          // Route through canon-decisions for auditable mutation
          try {
            const cdRes = await supabase.functions.invoke('canon-decisions', {
              body: {
                action: 'create_and_apply',
                projectId: project.id,
                decision: {
                  type: 'APPLY_SEED_INTEL_PACK',
                  payload: {
                    seed_intel_pack: pack,
                    init_comparables_if_empty: true,
                    comparables_from_pack_max: 12,
                    source_label: 'seed_intel_pack',
                  },
                },
                apply: { mode: 'auto' },
              },
            });
            const cdData = cdRes.data as any;
            if (cdData?.ok) {
              console.log(`[DevSeed] canon-decisions APPLY_SEED_INTEL_PACK success: decisionId=${cdData.decisionId}`);
            } else {
              console.error(`[DevSeed] canon-decisions APPLY_SEED_INTEL_PACK failed:`, cdData?.error || cdRes.error);
            }
          } catch (cdErr: any) {
            console.error(`[DevSeed] canon-decisions invocation failed (non-fatal):`, cdErr?.message);
          }
        }

        // 7. Optional: Apply lane prefs (merge-safe)
        if (applyPrefs) {
          const prefsDraftForPrefs = buildPrefsDraft(devSeed, lane);
          // Set default writing voice if not already present
          if (!prefsDraftForPrefs.writing_voice) {
            const defaultVoice = getDefaultVoiceForLane(lane);
            if (defaultVoice) {
              (prefsDraftForPrefs as any).writing_voice = defaultVoice;
            }
          }
          if (Object.keys(prefsDraftForPrefs).length > 0) {
            await saveProjectLaneRulesetPrefs(project.id, lane, prefsDraftForPrefs as RulesetPrefs, user.id);
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

      // 8. Auto-fill stubs — only if autopilot is OFF (autopilot handles regen server-side)
      let regenResult: any = null;
      if (applyDocs && !enableAutopilot) {
        const startRes = await supabase.functions.invoke('dev-engine-v2', {
          body: { action: 'regen-insufficient-start', projectId: project.id, dryRun: false, docTypeWhitelist: [...DEVSEED_DOC_TYPES] },
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

      // 10. Start autopilot if enabled — run DevSeed stages, then hand off to Auto-Run
      if (enableAutopilot) {
        try {
          // Start devseed-autopilot (apply_seed_intel_pack + regen_foundation only)
          const { data: autopilotRes } = await supabase.functions.invoke('devseed-autopilot', {
            body: {
              action: 'start',
              projectId: project.id,
              pitchIdeaId: idea.id,
              options: {
                apply_seed_intel_pack: true,
                regen_foundation: applyDocs,
              },
            },
          });

          if (autopilotRes?.autopilot) {
            setAutopilotState(autopilotRes.autopilot);
            parts.push('autopilot started');
            // Run devseed tick loop to completion, then start Auto-Run
            runAutopilotTicks(project.id);
          }

          // Start Auto-Run job for ongoing development + fire first tick
          try {
            await supabase.functions.invoke('auto-run', {
              body: { action: 'start', projectId: project.id },
            });
            parts.push('auto-run started');
          } catch (arErr: any) {
            console.error('[DevSeed] auto-run start failed (non-fatal):', arErr?.message);
          }
        } catch (apErr: any) {
          console.error('[DevSeed] autopilot start failed (non-fatal):', apErr?.message);
          toast.error('Autopilot failed to start — project created successfully');
        }
      }

      toast.success(parts.join(', '));

      // Always navigate to development page — use autorun tab if autopilot enabled
      onOpenChange(false);
      if (enableAutopilot) {
        navigate(`/projects/${project.id}/development?tab=autorun`);
      } else {
        navigate(`/projects/${project.id}/development`);
      }

      // If backfill mode, enqueue after navigation
      if (withBackfill && !enableAutopilot) {
        const backfillLane = idea.recommended_lane || 'independent-film';
        backfill.startBackfill({
          pitchIdeaId: idea.id,
          projectId: project.id,
          lane: backfillLane,
          includeDevPack,
        });
        toast.success('Backfill pipeline started — check progress in Dev Engine');
      }

      return project.id;
    } catch (e: any) {
      toast.error(e.message || 'Failed to create project');
      return null;
    } finally {
      setCreating(false);
      setCreatingBackfill(false);
    }
  };

  const handleNavigateToProject = () => {
    if (createdProjectId) {
      onOpenChange(false);
      navigate(`/projects/${createdProjectId}/development`);
    }
  };

  const showAutopilotPanel = autopilotState != null || (createdProjectId != null && enableAutopilot);
  const autopilotDone = autopilotState?.status === 'complete';
  const autopilotRunning = autopilotState?.status === 'running' || autopilotTicking;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
              disabled={showAutopilotPanel}
            />
          </div>

          {/* Apply options */}
          <div className="rounded-md border border-border/40 p-3 space-y-3">
            <p className="text-xs font-medium text-foreground">Apply options</p>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={applyDocs} onCheckedChange={(v) => setApplyDocs(!!v)} className="mt-0.5" disabled={showAutopilotPanel} />
              <div>
                <span className="text-sm font-medium">Create starter doc pack</span>
                <p className="text-xs text-muted-foreground">Concept Brief, Treatment, Character Bible, Market Sheet (5 seed docs only)</p>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={applyCanon} onCheckedChange={(v) => setApplyCanon(!!v)} className="mt-0.5" disabled={showAutopilotPanel} />
              <div>
                <span className="text-sm font-medium">Apply Canon draft</span>
                <p className="text-xs text-muted-foreground">Seed logline, characters, world rules, tone into project canon (editable, not locked)</p>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={applyPrefs} onCheckedChange={(v) => setApplyPrefs(!!v)} className="mt-0.5" disabled={showAutopilotPanel} />
              <div>
                <span className="text-sm font-medium">Apply Lane Prefs suggestions</span>
                <p className="text-xs text-muted-foreground">Set restraint level and conflict mode from nuance contract</p>
              </div>
            </label>

            {/* Autopilot toggle */}
            <label className="flex items-start gap-2 cursor-pointer border-t border-border/30 pt-3">
              <Checkbox checked={enableAutopilot} onCheckedChange={(v) => setEnableAutopilot(!!v)} className="mt-0.5" disabled={showAutopilotPanel} />
              <div>
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                  Autorun Autopilot
                </span>
                 <p className="text-xs text-muted-foreground">
                   Apply trends intelligence, regenerate stubs, and hand off to Auto-Run for development
                 </p>
              </div>
            </label>
          </div>

          {/* Autopilot progress panel */}
          {showAutopilotPanel && autopilotState && (
            <AutopilotProgress
              autopilot={autopilotState}
              onResume={handleResumeAutopilot}
              isResuming={autopilotTicking}
            />
          )}

          {/* Backfill progress panel (shown if active) */}
          {backfill.job && (
            <DevSeedBackfillProgress
              job={backfill.job}
              items={backfill.items}
              isRunning={backfill.isRunning}
              onPause={backfill.pause}
              onResume={backfill.resume}
              projectId={createdProjectId || undefined}
            />
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground mb-1">Always created:</p>
            <p>• New project with lane: <span className="text-foreground">{idea.recommended_lane}</span></p>
            <p>• <span className="text-foreground">Idea</span> document + canon logline/premise planted</p>
            <p>• Genre: <span className="text-foreground">{idea.genre}</span> | Budget: <span className="text-foreground">{idea.budget_band}</span></p>
            {(() => {
              const dc = (idea as any).devseed_canon_json || {};
              let epCount = dc.season_episode_count;
              if (!epCount) {
                const raw = idea.raw_response as any || {};
                const fmt = raw.format_summary || raw.format || '';
                const m = fmt.match(/(\d+)\s*x\s*/i) || fmt.match(/(\d+)\s*episodes/i);
                if (m) epCount = parseInt(m[1]);
              }
              return epCount ? (
                <p>• <span className="text-foreground font-medium">Canon Episode Count: {epCount}</span> (will be locked on project){!dc.season_episode_count && <span className="text-muted-foreground"> — auto-detected from format</span>}</p>
              ) : (
                <p className="text-amber-400">⚠ No episode count detected — set it on the pitch card for series projects</p>
              );
            })()}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {showAutopilotPanel ? (
            <>
              <Button variant="outline" onClick={() => {
                autopilotAbortRef.current = true;
                onOpenChange(false);
              }}>
                Close
              </Button>
              <Button onClick={handleNavigateToProject} className="gap-1.5">
                <ArrowRight className="h-4 w-4" />
                {autopilotDone ? 'Open Project' : autopilotRunning ? 'Open Project (in progress)' : 'Open Project'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating || creatingBackfill}>Skip</Button>
              <Button onClick={() => handleCreate(false)} disabled={creating || creatingBackfill} className="gap-1.5">
                {creating && !creatingBackfill ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {enableAutopilot ? 'Create + Autopilot' : 'Create DevSeed'}
              </Button>
              {!enableAutopilot && (
                <Button
                  onClick={() => handleCreate(true)}
                  disabled={creating || creatingBackfill}
                  variant="secondary"
                  className="gap-1.5"
                >
                  {creatingBackfill ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Create + Backfill
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
