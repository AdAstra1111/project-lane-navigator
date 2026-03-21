/**
 * runLookbookPipeline — Canonical entry point for all LookBook builds.
 * 
 * This is the ONLY entry point for:
 * - Manual builds (Build Look Book button)
 * - Auto Complete flows
 * - Future rebuild triggers
 * 
 * Orchestrates the 8-stage pipeline:
 * MODE → NARRATIVE → SLOT_PLANNING → IDENTITY → INVENTORY → GAP_ANALYSIS → 
 * RESOLUTION/GENERATION → ELECTION → ASSEMBLY → QA
 * 
 * Currently wraps generateLookBookData for assembly while stages are incrementally
 * extracted. This is the controlled evolution path — no big-bang rewrite.
 */
import { generateLookBookData, mergeUserDecisions } from '../generateLookBookData';
import { analyzeLookBookGaps } from '@/lib/images/lookbookGapAnalyzer';
import {
  orchestrateGapResolution,
  executeGapGenerations,
  buildWorkingSetFromResolutions,
  augmentWorkingSetWithRecentGenerations,
  summarizeOrchestration,
  type BuildWorkingSet,
} from '@/lib/images/lookbookImageOrchestrator';
import { supabase } from '@/integrations/supabase/client';
import type {
  PipelineOptions,
  PipelineResult,
  PipelineProgress,
  StageState,
  QAResult,
} from './types';
import { PipelineStage } from './types';

// ── Stage Runner ─────────────────────────────────────────────────────────────

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
    // Currently handled inside generateLookBookData (project + canon load)
    // This is a pass-through stage that will be extracted later
    updateStage(PipelineStage.NARRATIVE_EXTRACTION, startStage);
    log('Narrative extraction: delegated to assembly (incremental extraction)');
    updateStage(PipelineStage.NARRATIVE_EXTRACTION, s => completeStage(s, 'delegated'));
    reportProgress(PipelineStage.NARRATIVE_EXTRACTION, 'Extracting narrative context...', 100);

    // ── STAGE: SLOT_PLANNING ──
    updateStage(PipelineStage.SLOT_PLANNING, startStage);
    log('Slot planning: using canonical slide definitions');
    updateStage(PipelineStage.SLOT_PLANNING, s => completeStage(s, 'canonical slots'));
    reportProgress(PipelineStage.SLOT_PLANNING, 'Planning image slots...', 100);

    // ── STAGE: IDENTITY_BINDING ──
    updateStage(PipelineStage.IDENTITY_BINDING, startStage);
    log('Identity binding: pass-through (future expansion)');
    updateStage(PipelineStage.IDENTITY_BINDING, s => completeStage(s, 'pass-through'));
    reportProgress(PipelineStage.IDENTITY_BINDING, 'Binding character identities...', 100);

    // ── STAGE: INVENTORY + ELECTION + ASSEMBLY ──
    // These are currently fused inside generateLookBookData.
    // The pipeline wraps them as a unit and will decompose incrementally.

    let workingSet = options.workingSet || null;

    // In reuse_recovery mode, run gap analysis + orchestration first
    if (options.mode === 'reuse_recovery' && !workingSet) {
      // Need a preliminary build to analyze gaps
      updateStage(PipelineStage.INVENTORY, startStage);
      reportProgress(PipelineStage.INVENTORY, 'Building preliminary inventory...', 20);

      const prelimData = await generateLookBookData(options.projectId, {
        companyName: options.companyName,
        companyLogoUrl: options.companyLogoUrl,
        workingSet: null,
      });

      updateStage(PipelineStage.INVENTORY, s => completeStage(s, `${prelimData.totalImageRefs} images`));
      reportProgress(PipelineStage.INVENTORY, 'Inventory complete', 100);

      // ── GAP_ANALYSIS ──
      updateStage(PipelineStage.GAP_ANALYSIS, startStage);
      reportProgress(PipelineStage.GAP_ANALYSIS, 'Analyzing gaps...', 30);

      const gapAnalysis = analyzeLookBookGaps(prelimData);
      log(`Gap analysis: ${gapAnalysis.gaps.length} gaps (${gapAnalysis.missingSlots} missing, ${gapAnalysis.weakSlots} weak)`);
      updateStage(PipelineStage.GAP_ANALYSIS, s =>
        gapAnalysis.gaps.length > 0
          ? warnStage(s, `${gapAnalysis.gaps.length} gaps`)
          : completeStage(s, 'no gaps'),
      );
      reportProgress(PipelineStage.GAP_ANALYSIS, `${gapAnalysis.gaps.length} gaps found`, 100);

      if (gapAnalysis.gaps.length > 0) {
        // ── RESOLUTION ──
        updateStage(PipelineStage.RESOLUTION, startStage);
        reportProgress(PipelineStage.RESOLUTION, 'Resolving gaps...', 40);

        const { data: proj } = await supabase
          .from('projects')
          .select('title, genres, tone, format')
          .eq('id', options.projectId)
          .maybeSingle();

        const promptContext = {
          projectTitle: (proj as any)?.title || '',
          genre: Array.isArray((proj as any)?.genres) ? (proj as any).genres.join(', ') : '',
          tone: (proj as any)?.tone || '',
        };

        const orchResult = await orchestrateGapResolution(options.projectId, gapAnalysis, promptContext);
        const summary = summarizeOrchestration(orchResult);
        log(`Resolution: ${summary}`);
        updateStage(PipelineStage.RESOLUTION, s => completeStage(s, summary));
        reportProgress(PipelineStage.RESOLUTION, summary, 100);

        // ── GENERATION ──
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
          reportProgress(PipelineStage.GENERATION, `Generated ${genResult.generated} images`, 100);
        } else {
          updateStage(PipelineStage.GENERATION, s => completeStage(s, 'none needed'));
        }

        // Build working set
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
    } else {
      // Fresh build or working set already provided
      updateStage(PipelineStage.INVENTORY, startStage);
      updateStage(PipelineStage.GAP_ANALYSIS, s => completeStage(s, options.mode === 'fresh_build' ? 'skipped (fresh)' : 'pre-resolved'));
      updateStage(PipelineStage.RESOLUTION, s => completeStage(s, options.mode === 'fresh_build' ? 'skipped (fresh)' : 'pre-resolved'));
      updateStage(PipelineStage.GENERATION, s => completeStage(s, options.mode === 'fresh_build' ? 'skipped (fresh)' : 'pre-resolved'));
    }

    // ── ELECTION + ASSEMBLY (fused in generateLookBookData) ──
    updateStage(PipelineStage.ELECTION, startStage);
    reportProgress(PipelineStage.ELECTION, 'Electing winners and assembling deck...', 70);

    const lookBookData = await generateLookBookData(options.projectId, {
      companyName: options.companyName,
      companyLogoUrl: options.companyLogoUrl,
      workingSet,
    });

    updateStage(PipelineStage.INVENTORY, s => completeStage(s, `resolved`));
    updateStage(PipelineStage.ELECTION, s => completeStage(s, `${lookBookData.totalImageRefs} images elected`));
    reportProgress(PipelineStage.ELECTION, 'Election complete', 100);

    // ── Merge user decisions from previous build ──
    if (options.previousSlides && options.previousSlides.length > 0) {
      const { merged, preservedCount, droppedCount, migratedCount } = mergeUserDecisions(
        lookBookData.slides,
        options.previousSlides,
      );
      lookBookData.slides = merged;
      log(`User decisions: ${preservedCount} preserved, ${droppedCount} dropped, ${migratedCount} migrated`);
    }

    // ── ASSEMBLY ──
    updateStage(PipelineStage.ASSEMBLY, startStage);
    log(`Assembly: ${lookBookData.slides.length} slides, ${lookBookData.totalImageRefs} images`);
    updateStage(PipelineStage.ASSEMBLY, s => completeStage(s, `${lookBookData.slides.length} slides`));
    reportProgress(PipelineStage.ASSEMBLY, `${lookBookData.slides.length} slides assembled`, 90);

    // ── QA ──
    updateStage(PipelineStage.QA, startStage);
    reportProgress(PipelineStage.QA, 'Running quality checks...', 95);

    const qa = runQA(lookBookData);
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

// ── QA Stage ─────────────────────────────────────────────────────────────────

function runQA(data: import('../types').LookBookData): QAResult {
  const actualImageUrls = new Set<string>();
  const unresolvedSlides: string[] = [];

  for (const slide of data.slides) {
    if (slide.backgroundImageUrl) actualImageUrls.add(slide.backgroundImageUrl);
    if (slide.imageUrl) actualImageUrls.add(slide.imageUrl);
    if (slide.imageUrls) slide.imageUrls.forEach(u => actualImageUrls.add(u));
    if (slide.characters) {
      for (const c of slide.characters) {
        if (c.imageUrl) actualImageUrls.add(c.imageUrl);
      }
    }
    if (slide._has_unresolved) {
      unresolvedSlides.push(slide.type);
    }
  }

  const slidesWithImages = data.slides.filter(s =>
    s.backgroundImageUrl || s.imageUrl || (s.imageUrls && s.imageUrls.length > 0) ||
    (s.characters && s.characters.some(c => c.imageUrl)),
  ).length;

  return {
    totalSlides: data.slides.length,
    slidesWithImages,
    slidesWithoutImages: data.slides.length - slidesWithImages,
    totalImageRefs: actualImageUrls.size,
    unresolvedSlides,
    reuseWarnings: [],
    fingerprintWarnings: [],
    publishable: unresolvedSlides.length <= 2 && slidesWithImages >= Math.floor(data.slides.length * 0.6),
  };
}
