/**
 * runLookbookPipeline — Canonical entry point for all LookBook builds.
 * 
 * This is the ONLY entry point. It calls extracted stage modules directly:
 * MODE → NARRATIVE → INVENTORY → GAP_ANALYSIS → RESOLUTION/GENERATION → ELECTION → ASSEMBLY → QA
 * 
 * No legacy generateLookBookData dependency.
 */
import { supabase } from '@/integrations/supabase/client';
import { getCanonicalProjectState } from '@/lib/canon/getCanonicalProjectState';
import { normalizeCanonText } from '../normalizeCanonText';
import { isVerticalDrama as checkVD } from '@/lib/format-helpers';
import { analyzeLookBookGaps } from '@/lib/images/lookbookGapAnalyzer';
import {
  orchestrateGapResolution,
  executeGapGenerations,
  buildWorkingSetFromResolutions,
  augmentWorkingSetWithRecentGenerations,
  summarizeOrchestration,
  type BuildWorkingSet,
} from '@/lib/images/lookbookImageOrchestrator';
import { mergeUserDecisions } from './mergeUserDecisions';
import { runInventoryStage } from './inventoryStage';
import { runElectionStage, logElectionDiagnostics } from './electionStage';
import { runAssemblyStage } from './assemblyStage';
import { runQAStage } from './qaStage';
import { buildNarrativeEvidence, type NarrativeEvidence } from './narrativeEvidence';
import { runIdentityBindingStage, type IdentityBindings } from './identityBindingStage';
import { validateProvenance } from './provenanceValidator';
import type {
  PipelineOptions,
  PipelineResult,
  NarrativeContext,
  StageState,
} from './types';
import { PipelineStage } from './types';
import type { LookBookData, LookBookVisualIdentity, LookBookColorSystem } from '../types';

// ── Stage helpers ────────────────────────────────────────────────────────────

function makeStageState(stage: PipelineStage): StageState {
  return { stage, status: 'pending' };
}
function startStage(state: StageState): StageState {
  return { ...state, status: 'running', startedAt: Date.now() };
}
function completeStage(state: StageState, message?: string): StageState {
  return { ...state, status: 'complete', completedAt: Date.now(), message };
}
function warnStage(state: StageState, message: string): StageState {
  return { ...state, status: 'warning', completedAt: Date.now(), message };
}

// ── Color / Identity resolution ──────────────────────────────────────────────

const COLOR_PALETTES: Record<string, LookBookColorSystem> = {
  dark: { bg: '#0A0A0F', bgSecondary: '#131318', text: '#F0EDE8', textMuted: '#8A8680', accent: '#C4913A', accentMuted: 'rgba(196, 145, 58, 0.25)', gradientFrom: '#0A0A0F', gradientTo: '#1A1510' },
  thriller: { bg: '#070B12', bgSecondary: '#0D1420', text: '#E8ECF0', textMuted: '#6B7B8D', accent: '#4A90D9', accentMuted: 'rgba(74, 144, 217, 0.2)', gradientFrom: '#070B12', gradientTo: '#0A1525' },
  warm: { bg: '#100A06', bgSecondary: '#1A1208', text: '#F0E8DD', textMuted: '#9A8A72', accent: '#D4874A', accentMuted: 'rgba(212, 135, 74, 0.2)', gradientFrom: '#100A06', gradientTo: '#1F1508' },
  prestige: { bg: '#08080C', bgSecondary: '#111118', text: '#EEEEF2', textMuted: '#7A7A88', accent: '#B89A5A', accentMuted: 'rgba(184, 154, 90, 0.2)', gradientFrom: '#08080C', gradientTo: '#151218' },
  horror: { bg: '#0A0506', bgSecondary: '#160A0C', text: '#F0E5E5', textMuted: '#8A6565', accent: '#C44040', accentMuted: 'rgba(196, 64, 64, 0.2)', gradientFrom: '#0A0506', gradientTo: '#1A0A0A' },
  verdant: { bg: '#060C08', bgSecondary: '#0C180E', text: '#E8F0EA', textMuted: '#6A8A70', accent: '#5AAE6A', accentMuted: 'rgba(90, 174, 106, 0.2)', gradientFrom: '#060C08', gradientTo: '#0A1A0C' },
  oceanic: { bg: '#06090E', bgSecondary: '#0A1018', text: '#E5ECF5', textMuted: '#6580A0', accent: '#3A8ABF', accentMuted: 'rgba(58, 138, 191, 0.2)', gradientFrom: '#06090E', gradientTo: '#081520' },
};

function resolveColorPalette(tone?: string, genre?: string): LookBookColorSystem {
  const t = (tone || '').toLowerCase();
  const g = (genre || '').toLowerCase();
  if (t.includes('dark') || t.includes('noir') || g.includes('drama')) return COLOR_PALETTES.dark;
  if (g.includes('thriller') || g.includes('crime') || t.includes('cold')) return COLOR_PALETTES.thriller;
  if (g.includes('horror') || t.includes('horror')) return COLOR_PALETTES.horror;
  if (t.includes('warm') || g.includes('romance') || g.includes('comedy')) return COLOR_PALETTES.warm;
  if (g.includes('adventure') || g.includes('nature') || g.includes('fantasy')) return COLOR_PALETTES.verdant;
  if (g.includes('sci-fi') || g.includes('scifi')) return COLOR_PALETTES.oceanic;
  return COLOR_PALETTES.prestige;
}

function resolveIdentity(toneStyle: string, genre?: string): LookBookVisualIdentity {
  const colors = resolveColorPalette(toneStyle, genre);
  const t = toneStyle.toLowerCase();
  return {
    colors,
    typography: {
      titleFont: 'Fraunces',
      bodyFont: 'DM Sans',
      titleUppercase: t.includes('thriller') || t.includes('action') || t.includes('horror'),
    },
    imageStyle: t.includes('cold') || t.includes('thriller') ? 'cinematic-cold'
      : t.includes('vintage') || t.includes('period') ? 'vintage'
      : t.includes('dark') ? 'high-contrast'
      : 'cinematic-warm',
  };
}

// ── Narrative extraction ─────────────────────────────────────────────────────

async function extractNarrative(projectId: string): Promise<NarrativeContext & { isVD: boolean; effectiveLane: string | null }> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('title, genres, format, tone, assigned_lane, comparable_titles, target_audience')
    .eq('id', projectId)
    .maybeSingle();

  if (error) throw new Error('Could not load project data: ' + error.message);
  if (!project) throw new Error('Project not found');

  const genre = Array.isArray((project as any).genres)
    ? (project as any).genres.map((v: unknown, i: number) => normalizeCanonText(v, `genres.${i}`)).filter(Boolean).join(', ')
    : normalizeCanonText((project as any).genres, 'genres');
  const formatLabel = normalizeCanonText((project as any).format, 'format');
  const format = formatLabel.toLowerCase();
  const tone = normalizeCanonText((project as any).tone, 'tone');
  const targetAudience = normalizeCanonText((project as any).target_audience, 'target_audience');
  const assignedLane = normalizeCanonText((project as any).assigned_lane, 'assigned_lane');
  const comparableTitles = normalizeCanonText((project as any).comparable_titles, 'comparable_titles');

  const isVD = checkVD(format) || format.includes('vertical') || assignedLane === 'vertical_drama';
  const effectiveLane = isVD ? 'vertical_drama' : (assignedLane || null);

  const canonicalState = await getCanonicalProjectState(projectId);
  const canon = canonicalState.state as Record<string, unknown>;

  const { data: docs } = await supabase
    .from('project_documents')
    .select('doc_type, latest_version_id')
    .eq('project_id', projectId)
    .in('doc_type', ['concept_brief', 'topline_narrative', 'treatment', 'blueprint']);

  let synopsis = '';
  let creativeStatement = '';
  if (docs?.length) {
    const versionIds = docs.map((d: any) => d.latest_version_id).filter(Boolean);
    if (versionIds.length) {
      const { data: versions } = await supabase
        .from('project_document_versions')
        .select('plaintext, deliverable_type, is_current')
        .in('id', versionIds)
        .eq('is_current', true);
      for (const v of versions || []) {
        const text = (v as any).plaintext || '';
        if (text.length > synopsis.length && (v as any).deliverable_type !== 'treatment') synopsis = text.slice(0, 800);
        if ((v as any).deliverable_type === 'treatment' || (v as any).deliverable_type === 'blueprint') creativeStatement = text.slice(0, 600);
      }
    }
  }

  return {
    projectTitle: normalizeCanonText((project as any).title, 'title') || 'Untitled Project',
    genre, format, formatLabel, tone, targetAudience, assignedLane,
    comparableTitles, comparables: comparableTitles,
    logline: normalizeCanonText(canon.logline, 'logline'),
    premise: normalizeCanonText(canon.premise, 'premise'),
    worldRules: normalizeCanonText(canon.world_rules, 'world_rules'),
    locations: normalizeCanonText(canon.locations, 'locations'),
    timeline: normalizeCanonText(canon.timeline, 'timeline'),
    toneStyle: normalizeCanonText(canon.tone_style, 'tone_style') || tone,
    formatConstraints: normalizeCanonText(canon.format_constraints, 'format_constraints'),
    synopsis, creativeStatement,
    characters: canon.characters,
    isVD,
    effectiveLane,
  };
}

// ── Character normalization ──────────────────────────────────────────────────

function normalizeCharacters(
  rawCharacters: unknown,
  characterImageMap: Map<string, string>,
  characterNameImageMap: Map<string, string>,
): any[] {
  if (!Array.isArray(rawCharacters)) return [];
  return rawCharacters.slice(0, 6).map((raw, i) => {
    const c = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const id = normalizeCanonText(c.id, `char.${i}.id`);
    const name = normalizeCanonText(c.name, `char.${i}.name`) || 'Unnamed';
    const role = normalizeCanonText(c.role, `char.${i}.role`) || normalizeCanonText(c.archetype, `char.${i}.archetype`);
    const desc = [
      normalizeCanonText(c.goals, `char.${i}.goals`),
      normalizeCanonText(c.traits, `char.${i}.traits`),
      normalizeCanonText(c.description, `char.${i}.description`),
    ].filter(Boolean);
    const imageUrl = (id && characterImageMap.get(id)) || characterNameImageMap.get(name.toLowerCase()) || undefined;
    return { name, role, description: (desc.join(' — ') || 'Role to be defined.').slice(0, 200), imageUrl };
  });
}

// ── Pipeline-native gap analysis ─────────────────────────────────────────────

/**
 * Build a minimal LookBookData from pipeline inventory for gap analysis.
 * No legacy generateLookBookData dependency — uses inventory data directly.
 */
function buildPreliminaryDeckForGapAnalysis(
  projectId: string,
  narrative: NarrativeContext,
  inventory: Awaited<ReturnType<typeof runInventoryStage>>,
  identity: LookBookVisualIdentity,
  isVD: boolean,
  companyName: string,
): LookBookData {
  // Run a quick election + assembly to get a preliminary deck structure
  const electionResult = runElectionStage(inventory.sectionPools, inventory.allUniqueImages);
  const normalizedChars = normalizeCharacters(
    narrative.characters,
    inventory.characterImageMap,
    inventory.characterNameImageMap,
  );
  const slides = runAssemblyStage({
    narrative: { ...narrative, characters: normalizedChars },
    identity,
    canonImages: inventory.canonImages as any,
    electionResult,
    companyName,
    companyLogoUrl: null,
    isVerticalDrama: isVD,
    assignedLane: narrative.assignedLane,
    format: narrative.format,
  });

  return {
    projectId,
    projectTitle: narrative.projectTitle,
    identity,
    slides,
    deckFormat: isVD ? 'portrait' : 'landscape',
    generatedAt: new Date().toISOString(),
    writerCredit: '',
    companyName,
    companyLogoUrl: null,
  };
}

// ── Pipeline Runner ──────────────────────────────────────────────────────────

export async function runLookbookPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  const stages: StageState[] = Object.values(PipelineStage).map(s => makeStageState(s));

  const log = (msg: string) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`[Pipeline] ${msg}`);
  };

  const updateStage = (stage: PipelineStage, updater: (s: StageState) => StageState) => {
    const idx = stages.findIndex(s => s.stage === stage);
    if (idx >= 0) stages[idx] = updater(stages[idx]);
  };

  const reportProgress = (stage: PipelineStage, message: string, percent?: number) => {
    const stageState = stages.find(s => s.stage === stage);
    options.onProgress?.({
      currentStage: stage,
      stageStatus: stageState?.status || 'running',
      message,
      percent,
      logs,
    });
  };

  try {
    // ── STAGE: MODE_SELECTION ──
    updateStage(PipelineStage.MODE_SELECTION, startStage);
    log(`Mode: ${options.mode}`);
    updateStage(PipelineStage.MODE_SELECTION, s => completeStage(s, options.mode));
    reportProgress(PipelineStage.MODE_SELECTION, `Mode: ${options.mode}`, 100);

    // ── STAGE: NARRATIVE_EXTRACTION ──
    updateStage(PipelineStage.NARRATIVE_EXTRACTION, startStage);
    reportProgress(PipelineStage.NARRATIVE_EXTRACTION, 'Extracting narrative context...', 10);

    const narrativeRaw = await extractNarrative(options.projectId);
    const { isVD, effectiveLane, ...narrative } = narrativeRaw;

    // Build structured narrative evidence (canonical output of this stage)
    const narrativeEvidence = buildNarrativeEvidence(narrative, {
      isVerticalDrama: isVD,
      effectiveLane,
    });

    log(`Narrative: "${narrative.projectTitle}" (${narrative.genre}, ${narrative.formatLabel}) coverage=${(narrativeEvidence.evidenceCoverage.score * 100).toFixed(0)}%`);
    updateStage(PipelineStage.NARRATIVE_EXTRACTION, s => completeStage(s, `${narrative.projectTitle} (${(narrativeEvidence.evidenceCoverage.score * 100).toFixed(0)}% coverage)`));
    reportProgress(PipelineStage.NARRATIVE_EXTRACTION, 'Narrative extracted', 100);

    // ── STAGE: SLOT_PLANNING ──
    updateStage(PipelineStage.SLOT_PLANNING, startStage);
    log('Slot planning: using canonical slide definitions with slot intent registry');
    updateStage(PipelineStage.SLOT_PLANNING, s => completeStage(s, 'canonical slots'));
    reportProgress(PipelineStage.SLOT_PLANNING, 'Planning image slots...', 100);

    // ── STAGE: IDENTITY_BINDING ──
    updateStage(PipelineStage.IDENTITY_BINDING, startStage);
    const identity = resolveIdentity(narrative.toneStyle, narrative.genre);
    log('Identity binding: visual identity resolved');
    updateStage(PipelineStage.IDENTITY_BINDING, s => completeStage(s, identity.imageStyle));
    reportProgress(PipelineStage.IDENTITY_BINDING, 'Identity bound', 100);

    // ── STAGE: INVENTORY ──
    updateStage(PipelineStage.INVENTORY, startStage);
    reportProgress(PipelineStage.INVENTORY, 'Resolving image inventory...', 20);

    let workingSet = options.workingSet || null;

    let inventory = await runInventoryStage({
      projectId: options.projectId,
      effectiveLane,
      strictDeckMode: isVD,
      format: narrative.format,
      assignedLane: narrative.assignedLane,
      workingSet,
    });

    log(`Inventory: ${inventory.allUniqueImages.length} unique images across ${Object.keys(inventory.sectionPools).length} pools`);
    updateStage(PipelineStage.INVENTORY, s => completeStage(s, `${inventory.allUniqueImages.length} images`));
    reportProgress(PipelineStage.INVENTORY, 'Inventory complete', 100);

    // ── Run character identity binding (post-inventory, uses image maps) ──
    const identityBindings = runIdentityBindingStage(
      narrativeEvidence.characters,
      inventory.characterImageMap,
      inventory.characterNameImageMap,
    );
    log(`Identity bindings: ${identityBindings.metrics.boundCount}/${identityBindings.metrics.totalCharacters} bound, ${identityBindings.metrics.unboundPrincipals} unbound principals`);

    // ── STAGE: GAP_ANALYSIS + RESOLUTION + GENERATION ──
    if (options.mode === 'reuse_recovery' && !workingSet) {
      updateStage(PipelineStage.GAP_ANALYSIS, startStage);
      reportProgress(PipelineStage.GAP_ANALYSIS, 'Analyzing gaps...', 30);

      // Pipeline-native gap analysis — no legacy dependency
      const prelimDeck = buildPreliminaryDeckForGapAnalysis(
        options.projectId, narrative, inventory, identity, isVD, options.companyName || 'Paradox House',
      );
      const gapAnalysis = analyzeLookBookGaps(prelimDeck);
      log(`Gap analysis: ${gapAnalysis.gaps.length} gaps (pipeline-native)`);
      updateStage(PipelineStage.GAP_ANALYSIS, s =>
        gapAnalysis.gaps.length > 0
          ? warnStage(s, `${gapAnalysis.gaps.length} gaps`)
          : completeStage(s, 'no gaps'),
      );
      reportProgress(PipelineStage.GAP_ANALYSIS, `${gapAnalysis.gaps.length} gaps found`, 100);

      if (gapAnalysis.gaps.length > 0) {
        updateStage(PipelineStage.RESOLUTION, startStage);
        reportProgress(PipelineStage.RESOLUTION, 'Resolving gaps...', 40);

        const promptContext = {
          projectTitle: narrative.projectTitle,
          genre: narrative.genre,
          tone: narrative.tone,
        };

        const orchResult = await orchestrateGapResolution(options.projectId, gapAnalysis, promptContext);
        const summary = summarizeOrchestration(orchResult);
        log(`Resolution: ${summary}`);
        updateStage(PipelineStage.RESOLUTION, s => completeStage(s, summary));

        if (orchResult.generationsQueued > 0) {
          updateStage(PipelineStage.GENERATION, startStage);
          reportProgress(PipelineStage.GENERATION, `Generating ${orchResult.generationsQueued} images...`, 50);
          const genResult = await executeGapGenerations(options.projectId, orchResult.resolutions, promptContext);
          log(`Generation: ${genResult.generated} succeeded, ${genResult.failed} failed`);
          updateStage(PipelineStage.GENERATION, s =>
            genResult.failed > 0
              ? warnStage(s, `${genResult.generated} ok, ${genResult.failed} failed`)
              : completeStage(s, `${genResult.generated} generated`),
          );
        } else {
          updateStage(PipelineStage.GENERATION, s => completeStage(s, 'none needed'));
        }

        workingSet = await buildWorkingSetFromResolutions(orchResult.resolutions);
        if (orchResult.generationsQueued > 0) {
          workingSet = await augmentWorkingSetWithRecentGenerations(
            options.projectId, workingSet, orchResult.resolutions,
          );
        }
        log(`Working set: ${workingSet.bySlotKey.size} slots filled`);
      } else {
        updateStage(PipelineStage.RESOLUTION, s => completeStage(s, 'no gaps'));
        updateStage(PipelineStage.GENERATION, s => completeStage(s, 'no gaps'));
      }

      // Re-run inventory with working set if we built one
      if (workingSet && workingSet.bySlotKey.size > 0) {
        inventory = await runInventoryStage({
          projectId: options.projectId,
          effectiveLane,
          strictDeckMode: isVD,
          format: narrative.format,
          assignedLane: narrative.assignedLane,
          workingSet,
        });
      }
    } else {
      updateStage(PipelineStage.GAP_ANALYSIS, s => completeStage(s, options.mode === 'fresh_build' ? 'skipped (fresh)' : 'pre-resolved'));
      updateStage(PipelineStage.RESOLUTION, s => completeStage(s, options.mode === 'fresh_build' ? 'skipped (fresh)' : 'pre-resolved'));
      updateStage(PipelineStage.GENERATION, s => completeStage(s, options.mode === 'fresh_build' ? 'skipped (fresh)' : 'pre-resolved'));
    }

    // ── STAGE: ELECTION ──
    updateStage(PipelineStage.ELECTION, startStage);
    reportProgress(PipelineStage.ELECTION, 'Electing winners...', 70);

    const electionResult = runElectionStage(inventory.sectionPools, inventory.allUniqueImages);

    log(`Election: poster=${electionResult.posterHero ? 'yes' : 'none'}, slides=${electionResult.slideElections.size}`);
    updateStage(PipelineStage.ELECTION, s => completeStage(s, `${electionResult.slideElections.size} slides elected`));
    reportProgress(PipelineStage.ELECTION, 'Election complete', 80);

    // ── STAGE: ASSEMBLY ──
    updateStage(PipelineStage.ASSEMBLY, startStage);
    reportProgress(PipelineStage.ASSEMBLY, 'Assembling deck...', 85);

    // Normalize characters with image maps from inventory
    const normalizedCharacters = normalizeCharacters(
      narrative.characters,
      inventory.characterImageMap,
      inventory.characterNameImageMap,
    );

    const slides = runAssemblyStage({
      narrative: { ...narrative, characters: normalizedCharacters },
      identity,
      canonImages: inventory.canonImages as any,
      electionResult,
      companyName: options.companyName || 'Paradox House',
      companyLogoUrl: options.companyLogoUrl,
      isVerticalDrama: isVD,
      assignedLane: narrative.assignedLane,
      format: narrative.format,
    });

    // Log election diagnostics
    logElectionDiagnostics(electionResult.electionCtx);

    // Log slide selection summary
    const selectionDiag = slides.map(s => {
      const parts = [`${s.type}:`];
      if (s.backgroundImageUrl) parts.push('bg=✓'); else parts.push('bg=✗');
      if (s.imageUrls?.length) parts.push(`fg=${s.imageUrls.length}`);
      if (s._has_unresolved) parts.push('UNRESOLVED');
      return parts.join(' ');
    });
    console.log('[LookBook] ✓ slide image selection:', selectionDiag.join(' | '));

    log(`Assembly: ${slides.length} slides`);
    updateStage(PipelineStage.ASSEMBLY, s => completeStage(s, `${slides.length} slides`));
    reportProgress(PipelineStage.ASSEMBLY, `${slides.length} slides assembled`, 90);

    // ── Merge user decisions from previous build ──
    let finalSlides = slides;
    if (options.previousSlides && options.previousSlides.length > 0) {
      const { merged, preservedCount, droppedCount, migratedCount } = mergeUserDecisions(
        slides,
        options.previousSlides,
      );
      finalSlides = merged;
      log(`User decisions: ${preservedCount} preserved, ${droppedCount} dropped, ${migratedCount} migrated`);
    }

    // ── Build final data object ──
    const actualImageUrls = new Set<string>();
    for (const slide of finalSlides) {
      if (slide.backgroundImageUrl) actualImageUrls.add(slide.backgroundImageUrl);
      if (slide.imageUrl) actualImageUrls.add(slide.imageUrl);
      if (slide.imageUrls) slide.imageUrls.forEach(u => actualImageUrls.add(u));
      if (slide.characters) slide.characters.forEach(c => { if (c.imageUrl) actualImageUrls.add(c.imageUrl); });
    }

    const upstreamIds = inventory.diagnostics?.resolvedImageIds || [];
    const wsIds = workingSet?.entries?.map(e => e.image.id) || [];
    const resolvedImageIds = [...new Set([...upstreamIds, ...wsIds])].sort();

    const buildId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const deckFormat = isVD ? 'portrait' as const : 'landscape' as const;

    const lookBookData: LookBookData = {
      projectId: options.projectId,
      projectTitle: narrative.projectTitle,
      identity,
      slides: finalSlides,
      deckFormat,
      generatedAt: new Date().toISOString(),
      writerCredit: 'Written by Sebastian Street',
      companyName: options.companyName || 'Paradox House',
      companyLogoUrl: options.companyLogoUrl,
      buildId,
      totalImageRefs: actualImageUrls.size,
      resolvedImageIds,
    };

    // ── STAGE: QA ──
    updateStage(PipelineStage.QA, startStage);
    reportProgress(PipelineStage.QA, 'Running quality checks...', 95);

    const qa = runQAStage(lookBookData);
    log(`QA: ${qa.totalSlides} slides, ${qa.totalImageRefs} images, ${qa.unresolvedSlides.length} unresolved, publishable=${qa.publishable}`);

    if (qa.unresolvedSlides.length > 0) {
      updateStage(PipelineStage.QA, s => warnStage(s, `${qa.unresolvedSlides.length} unresolved slides`));
    } else {
      updateStage(PipelineStage.QA, s => completeStage(s, 'all clear'));
    }
    reportProgress(PipelineStage.QA, qa.publishable ? 'Deck ready' : 'Deck has issues', 100);

    return {
      data: lookBookData,
      qa,
      stages,
      logs,
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    log(`PIPELINE ERROR: ${error.message}`);
    throw error;
  }
}
