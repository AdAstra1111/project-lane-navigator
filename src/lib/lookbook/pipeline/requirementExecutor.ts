/**
 * requirementExecutor — Processes LookBook requirements in domain passes.
 *
 * Executes generation per requirement, tracks satisfaction, and produces
 * a working set of generated candidates for election.
 *
 * This replaces gap-driven generation for fresh_from_scratch mode.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from '@/lib/images/types';
import { resolvePromptTemplate, buildPromptFromTemplate, type PromptContext } from '@/lib/images/slotPromptRegistry';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import type { BuildWorkingSet, WorkingSetEntry } from '@/lib/images/lookbookImageOrchestrator';
import type { LookBookRequirement, RequirementPass, RequirementResult, RequirementSet, SatisfactionStatus } from './requirementBuilder';
import type { RequirementProgress, PipelineProgressCallback } from './types';
import { PipelineStage } from './types';

// ── Execution Result ─────────────────────────────────────────────────────────

export interface RequirementExecutionResult {
  results: RequirementResult[];
  workingSet: BuildWorkingSet;
  totalGenerated: number;
  totalFailed: number;
  totalSatisfied: number;
  totalPartial: number;
  totalBlocked: number;
}

// ── Pass order (deterministic) ───────────────────────────────────────────────

const PASS_ORDER: RequirementPass[] = ['character', 'world', 'key_moments', 'atmosphere', 'poster'];

// ── Constants ────────────────────────────────────────────────────────────────

/** Max images per single edge function call */
const BATCH_SIZE = 4;
/** Max generation calls per section to prevent runaway loops */
const MAX_CALLS_PER_SECTION = 5;
/** Max consecutive failures before aborting a section */
const MAX_CONSECUTIVE_FAILURES = 2;

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Execute all requirements in pass order.
 * Each pass generates images for its requirements in batched loops until
 * demand is met or failure thresholds are reached.
 */
export async function executeRequirements(
  projectId: string,
  requirementSet: RequirementSet,
  narrativeContext: { projectTitle: string; genre: string; tone: string },
  onProgress?: PipelineProgressCallback,
  logs?: string[],
): Promise<RequirementExecutionResult> {
  const log = (msg: string) => {
    logs?.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`[ReqExecutor] ${msg}`);
  };

  const results: RequirementResult[] = [];
  const allEntries: WorkingSetEntry[] = [];
  let totalGenerated = 0;
  let totalFailed = 0;

  // Build progress entries for UI
  const progressReqs: RequirementProgress[] = requirementSet.requirements.map(r => ({
    id: r.id,
    label: r.label,
    slideType: r.slideType,
    status: 'pending' as const,
    generatedCount: 0,
    selectedCount: 0,
  }));

  const reportReqs = (stage: PipelineStage, message: string, percent?: number) => {
    onProgress?.({
      currentStage: stage,
      stageStatus: 'running',
      message,
      percent,
      logs: logs || [],
      requirements: progressReqs,
    });
  };

  // Track all generation call metadata for matching
  const generationBatches: GenerationBatchRecord[] = [];

  // Process each pass in order
  for (const pass of PASS_ORDER) {
    const passReqs = requirementSet.byPass[pass];
    if (!passReqs || passReqs.length === 0) continue;

    log(`── PASS: ${pass.toUpperCase()} (${passReqs.length} requirements) ──`);

    // Mark requirements as planning
    for (const req of passReqs) {
      const pIdx = progressReqs.findIndex(p => p.id === req.id);
      if (pIdx >= 0) progressReqs[pIdx].status = 'planning';
    }
    reportReqs(PipelineStage.GENERATION, `Planning ${pass} pass...`, 30);

    // Group requirements by section for batched generation
    const bySection = new Map<string, LookBookRequirement[]>();
    for (const req of passReqs) {
      const existing = bySection.get(req.section) || [];
      existing.push(req);
      bySection.set(req.section, existing);
    }

    for (const [section, sectionReqs] of bySection) {
      // Mark as generating
      for (const req of sectionReqs) {
        const pIdx = progressReqs.findIndex(p => p.id === req.id);
        if (pIdx >= 0) progressReqs[pIdx].status = 'generating';
      }
      reportReqs(PipelineStage.GENERATION, `Generating ${pass}: ${section}...`, 50);

      const totalNeeded = sectionReqs.reduce((sum, r) => sum + r.preferred, 0);
      let totalGeneratedForSection = 0;
      let consecutiveFailures = 0;
      let callCount = 0;

      // ── BATCHED GENERATION LOOP ──
      // Loop until we have enough images or hit failure thresholds
      while (
        totalGeneratedForSection < totalNeeded &&
        callCount < MAX_CALLS_PER_SECTION &&
        consecutiveFailures < MAX_CONSECUTIVE_FAILURES
      ) {
        const remaining = totalNeeded - totalGeneratedForSection;
        const count = Math.min(remaining, BATCH_SIZE);
        callCount++;

        // Rotate through requirements for prompt diversity
        const reqIndex = (callCount - 1) % sectionReqs.length;
        const targetReq = sectionReqs[reqIndex];

        const promptCtx: PromptContext = {
          projectTitle: narrativeContext.projectTitle,
          genre: narrativeContext.genre,
          tone: narrativeContext.tone,
          ...targetReq.promptContext,
        };

        const template = resolvePromptTemplate(targetReq.subjectType as any, targetReq.shotType);
        const { prompt } = buildPromptFromTemplate(template, promptCtx);

        log(`[${section}] batch ${callCount}: generating ${count} (${totalGeneratedForSection}/${totalNeeded} done, req=${targetReq.id})`);

        try {
          const { data, error } = await (supabase as any).functions.invoke('generate-lookbook-image', {
            body: {
              project_id: projectId,
              section,
              count,
              asset_group: targetReq.assetGroup,
              pack_mode: true,
              forced_shot_type: targetReq.shotType,
              auto_complete_context: {
                prompt_override: prompt,
                requirement_ids: sectionReqs.map(r => r.id),
                target_requirement_id: targetReq.id,
                orientations: sectionReqs.map(r => r.orientation),
                batch_index: callCount,
                slide_type: targetReq.slideType,
                pass,
                requested_shot_type: targetReq.shotType,
              },
            },
          });

          if (error) {
            log(`[${section}] batch ${callCount} FAILED: ${error.message || error}`);
            totalFailed += count;
            consecutiveFailures++;
            continue;
          }

          const genResults = data?.results || [];
          const successCount = genResults.filter((r: any) => r.status === 'ready').length;
          totalGenerated += successCount;
          totalGeneratedForSection += successCount;
          totalFailed += (count - successCount);

          if (successCount > 0) {
            consecutiveFailures = 0; // Reset on success
          } else {
            consecutiveFailures++;
          }

          // Record batch metadata for matching
          generationBatches.push({
            section,
            pass,
            batchIndex: callCount,
            targetRequirementId: targetReq.id,
            slideType: targetReq.slideType,
            shotType: targetReq.shotType,
            subjectType: targetReq.subjectType,
            characterName: targetReq.promptContext.characterName,
            generatedAt: new Date().toISOString(),
            successCount,
          });

          log(`[${section}] batch ${callCount}: ${successCount}/${count} ok (total ${totalGeneratedForSection}/${totalNeeded})`);
        } catch (e: any) {
          log(`[${section}] batch ${callCount} ERROR: ${e.message}`);
          totalFailed += count;
          consecutiveFailures++;
        }
      }

      if (totalGeneratedForSection < totalNeeded) {
        log(`[${section}] WARNING: under-generated ${totalGeneratedForSection}/${totalNeeded} (${callCount} calls, ${consecutiveFailures} failures)`);
      }

      // Update per-requirement progress
      const perReqShare = sectionReqs.length > 0 ? Math.ceil(totalGeneratedForSection / sectionReqs.length) : 0;
      for (const req of sectionReqs) {
        const pIdx = progressReqs.findIndex(p => p.id === req.id);
        if (pIdx >= 0) {
          progressReqs[pIdx].generatedCount = perReqShare;
          progressReqs[pIdx].status = totalGeneratedForSection > 0 ? 'generated' : 'blocked';
          if (totalGeneratedForSection === 0) progressReqs[pIdx].blockingReason = 'No images generated';
        }
      }
    }

    reportReqs(PipelineStage.GENERATION, `${pass} pass complete`, 70);
  }

  // ── Harvest generated candidates ──
  // Use 15-minute window to account for multi-pass generation time
  log('Harvesting recently generated candidates...');
  const harvestWindowMs = 15 * 60 * 1000;
  const harvestCutoff = new Date(Date.now() - harvestWindowMs).toISOString();
  const { data: recentCandidates } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', 'candidate')
    .gte('created_at', harvestCutoff)
    .order('created_at', { ascending: false })
    .limit(200);

  const candidates = (recentCandidates || []) as ProjectImage[];

  // Hydrate signed URLs
  await Promise.all(candidates.map(async (img) => {
    if (!img.signedUrl && img.storage_path) {
      try {
        const bucket = img.storage_bucket || 'project-posters';
        const { data: signed } = await supabase.storage
          .from(bucket)
          .createSignedUrl(img.storage_path, 3600);
        img.signedUrl = signed?.signedUrl || '';
      } catch { /* skip */ }
    }
  }));

  log(`Harvested ${candidates.length} candidate images`);

  // ── Match candidates to requirements with strengthened scoring ──
  for (const req of requirementSet.requirements) {
    const matching = candidates.filter(c => {
      if (!c.signedUrl) return false;
      // Asset group filter — but allow through if no asset_group on image
      if ((c as any).asset_group && (c as any).asset_group !== req.assetGroup) return false;
      return true;
    });

    const scored = matching.map(img => {
      let score = 0;

      // ── Requirement-origin matching (strongest signal) ──
      const gc = (img as any).generation_config as Record<string, unknown> | null;
      const autoCtx = gc?.auto_complete_context as Record<string, unknown> | null;
      if (autoCtx?.target_requirement_id === req.id) {
        score += 25; // Direct requirement match
      } else if (autoCtx?.slide_type === req.slideType) {
        score += 12; // Same slide type
      } else if (autoCtx?.pass === req.pass) {
        score += 6; // Same pass
      }

      // ── Orientation match ──
      const orient = classifyOrientation(img.width, img.height);
      if (req.orientation === 'any' || orient === req.orientation) score += 10;
      else if (orient === 'square') score += 3;

      // ── Shot type match (with compatibility normalization) ──
      if (img.shot_type === req.shotType) score += 8;
      else if (areShotTypesCompatible(img.shot_type, req.shotType)) score += 6;
      else if (autoCtx?.requested_shot_type === req.shotType) score += 5;

      // ── Entity/provenance match ──
      if (img.entity_id || img.location_ref || img.moment_ref) score += 6;

      // ── Character name match ──
      if (req.promptContext.characterName && img.subject) {
        if ((img.subject as string).toLowerCase().includes(req.promptContext.characterName.toLowerCase())) {
          score += 15;
        }
      }

      // ── Batch metadata match (fallback for when generation_config isn't populated) ──
      const batchMatch = generationBatches.find(b =>
        b.targetRequirementId === req.id &&
        b.section === req.section
      );
      if (batchMatch && batchMatch.successCount > 0) {
        // Images from the batch targeting this requirement get a mild boost
        const imgCreated = (img as any).created_at;
        if (imgCreated && batchMatch.generatedAt && Math.abs(new Date(imgCreated).getTime() - new Date(batchMatch.generatedAt).getTime()) < 30000) {
          score += 8;
        }
      }

      return { img, score };
    });
    scored.sort((a, b) => b.score - a.score);

    // Take best matches up to preferred count
    const winners = scored.slice(0, req.preferred);
    const satisfiedCount = winners.length;

    // Determine satisfaction
    let status: SatisfactionStatus;
    let blockingReason: string | undefined;
    if (satisfiedCount >= req.minRequired) {
      status = 'satisfied';
    } else if (satisfiedCount > 0) {
      status = 'partial';
      blockingReason = `${satisfiedCount}/${req.minRequired} minimum met`;
    } else {
      status = 'blocked';
      blockingReason = 'No matching images generated';
    }

    results.push({
      requirement: req,
      status,
      generatedCount: satisfiedCount,
      selectedCount: winners.length,
      blockingReason,
    });

    // Update progress
    const pIdx = progressReqs.findIndex(p => p.id === req.id);
    if (pIdx >= 0) {
      progressReqs[pIdx].selectedCount = winners.length;
      progressReqs[pIdx].generatedCount = satisfiedCount;
      progressReqs[pIdx].status = status === 'satisfied' ? 'selected' : (status === 'partial' ? 'generated' : 'blocked');
      if (blockingReason) progressReqs[pIdx].blockingReason = blockingReason;
    }

    // Add to working set
    for (let i = 0; i < winners.length; i++) {
      const { img, score } = winners[i];
      allEntries.push({
        slideId: `${req.slideType}:main`,
        slideType: req.slideType,
        slotId: `req_${req.id}_${i}`,
        image: img,
        source: 'generated',
        score,
        signedUrl: img.signedUrl!,
      });
    }
  }

  // Build working set
  const bySlotKey = new Map<string, WorkingSetEntry>();
  for (const entry of allEntries) {
    const key = `${entry.slideId}:${entry.slotId}`;
    const existing = bySlotKey.get(key);
    if (!existing || entry.score > existing.score) {
      bySlotKey.set(key, entry);
    }
  }

  const totalSatisfied = results.filter(r => r.status === 'satisfied').length;
  const totalPartial = results.filter(r => r.status === 'partial').length;
  const totalBlocked = results.filter(r => r.status === 'blocked').length;

  log(`Requirement fulfillment: ${totalSatisfied} satisfied, ${totalPartial} partial, ${totalBlocked} blocked (${totalGenerated} generated, ${totalFailed} failed)`);

  reportReqs(PipelineStage.GENERATION, `${totalSatisfied}/${results.length} requirements satisfied`, 100);

  return {
    results,
    workingSet: { entries: allEntries, bySlotKey },
    totalGenerated,
    totalFailed,
    totalSatisfied,
    totalPartial,
    totalBlocked,
  };
}

// ── Internal types ───────────────────────────────────────────────────────────

interface GenerationBatchRecord {
  section: string;
  pass: string;
  batchIndex: number;
  targetRequirementId: string;
  slideType: string;
  shotType: string;
  subjectType: string;
  characterName?: string;
  generatedAt: string;
  successCount: number;
}
