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

// ── Subject → Edge Function section ──────────────────────────────────────────

const SUBJECT_TO_SECTION: Record<string, string> = {
  character: 'character',
  world: 'world',
  atmosphere: 'visual_language',
  moment: 'key_moment',
  texture: 'visual_language',
  poster: 'key_moment',
};

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Execute all requirements in pass order.
 * Each pass generates images for its requirements, then checks satisfaction.
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

      // Build generation request
      const totalNeeded = sectionReqs.reduce((sum, r) => sum + r.preferred, 0);
      const count = Math.min(totalNeeded, 4); // Edge function max per call

      // Build prompt from first requirement's context (they share section)
      const firstReq = sectionReqs[0];
      const promptCtx: PromptContext = {
        projectTitle: narrativeContext.projectTitle,
        genre: narrativeContext.genre,
        tone: narrativeContext.tone,
        ...firstReq.promptContext,
      };

      const template = resolvePromptTemplate(firstReq.subjectType as any, firstReq.shotType);
      const { prompt } = buildPromptFromTemplate(template, promptCtx);

      log(`Generating ${count} ${section} images (prompt: ${prompt.slice(0, 80)}...)`);

      try {
        const { data, error } = await (supabase as any).functions.invoke('generate-lookbook-image', {
          body: {
            project_id: projectId,
            section,
            count,
            asset_group: firstReq.assetGroup,
            pack_mode: true,
            forced_shot_type: firstReq.shotType,
            auto_complete_context: {
              prompt_override: prompt,
              requirement_ids: sectionReqs.map(r => r.id),
              orientations: sectionReqs.map(r => r.orientation),
            },
          },
        });

        if (error) {
          log(`Generation FAILED for ${section}: ${error.message || error}`);
          totalFailed += count;
          for (const req of sectionReqs) {
            const pIdx = progressReqs.findIndex(p => p.id === req.id);
            if (pIdx >= 0) {
              progressReqs[pIdx].status = 'blocked';
              progressReqs[pIdx].blockingReason = `Generation failed: ${error.message || 'unknown'}`;
            }
          }
          continue;
        }

        const genResults = data?.results || [];
        const successCount = genResults.filter((r: any) => r.status === 'ready').length;
        totalGenerated += successCount;
        totalFailed += (count - successCount);

        log(`${section}: ${successCount}/${count} generated successfully`);

        // Update progress
        for (const req of sectionReqs) {
          const pIdx = progressReqs.findIndex(p => p.id === req.id);
          if (pIdx >= 0) {
            progressReqs[pIdx].generatedCount = successCount > 0 ? Math.ceil(successCount / sectionReqs.length) : 0;
            progressReqs[pIdx].status = successCount > 0 ? 'generated' : 'blocked';
            if (successCount === 0) progressReqs[pIdx].blockingReason = 'No images generated';
          }
        }
      } catch (e: any) {
        log(`Generation ERROR for ${section}: ${e.message}`);
        totalFailed += count;
        for (const req of sectionReqs) {
          const pIdx = progressReqs.findIndex(p => p.id === req.id);
          if (pIdx >= 0) {
            progressReqs[pIdx].status = 'blocked';
            progressReqs[pIdx].blockingReason = e.message;
          }
        }
      }
    }

    reportReqs(PipelineStage.GENERATION, `${pass} pass complete`, 70);
  }

  // ── Harvest generated candidates ──
  log('Harvesting recently generated candidates...');
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentCandidates } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', 'candidate')
    .gte('created_at', fiveMinAgo)
    .order('created_at', { ascending: false })
    .limit(100);

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

  // Match candidates to requirements and assess satisfaction
  for (const req of requirementSet.requirements) {
    const matching = candidates.filter(c => {
      if ((c as any).asset_group && (c as any).asset_group !== req.assetGroup) return false;
      if (!c.signedUrl) return false;
      return true;
    });

    // Score and rank matches for this requirement
    const scored = matching.map(img => {
      let score = 0;
      const orient = classifyOrientation(img.width, img.height);
      if (req.orientation === 'any' || orient === req.orientation) score += 10;
      else if (orient === 'square') score += 3;
      if (img.shot_type === req.shotType) score += 8;
      if (img.entity_id || img.location_ref || img.moment_ref) score += 6;
      // Character name match
      if (req.promptContext.characterName && img.subject) {
        if ((img.subject as string).toLowerCase().includes(req.promptContext.characterName.toLowerCase())) {
          score += 15;
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
        slotId: `req_${i}`,
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
