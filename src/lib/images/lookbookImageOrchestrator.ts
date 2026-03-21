/**
 * LookBook Image Orchestrator — Retrieve → Reuse → Recreate engine.
 * 
 * For each gap identified by the Gap Analyzer, this orchestrator:
 * 1. Searches active pool for a better match
 * 2. Searches archive/candidate pool for reusable images
 * 3. Queues generation for truly missing images
 * 4. Auto-promotes high-confidence results into active canon
 * 
 * Does NOT duplicate resolveCanonImages logic.
 * Uses project_images as the single source of truth.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from './types';
import type { ImageGap, GapAnalysisResult } from './lookbookGapAnalyzer';
import { resolvePromptTemplate, buildPromptFromTemplate, type PromptContext } from './slotPromptRegistry';
import { classifyOrientation } from './orientationUtils';
import { toast } from 'sonner';

// ── Orchestration Result Types ───────────────────────────────────────────────

export type ResolutionMethod = 'active_match' | 'archive_reuse' | 'generation_queued' | 'unresolvable';

export interface GapResolution {
  gap: ImageGap;
  method: ResolutionMethod;
  /** Image ID if resolved from existing pool */
  resolvedImageId?: string;
  /** Prompt if generation is queued */
  generationPrompt?: string;
  /** Reason for this resolution */
  reason: string;
}

export interface OrchestrationResult {
  resolutions: GapResolution[];
  activeMatches: number;
  archiveReuses: number;
  generationsQueued: number;
  unresolvable: number;
}

// ── Shot Type Mapping ────────────────────────────────────────────────────────

const SUBJECT_TO_ASSET_GROUP: Record<string, string> = {
  character: 'character',
  world: 'world',
  atmosphere: 'visual_language',
  moment: 'key_moment',
  texture: 'visual_language',
  poster: 'poster',
  generic: 'visual_language',
};

const SUBJECT_TO_STRATEGY_KEYS: Record<string, string[]> = {
  character: ['lookbook_character'],
  world: ['lookbook_world'],
  atmosphere: ['lookbook_visual_language'],
  moment: ['lookbook_key_moment'],
  texture: ['lookbook_visual_language'],
  poster: [],
  generic: ['lookbook_visual_language'],
};

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Orchestrate gap resolution for a set of identified gaps.
 * Searches existing images before queuing generation.
 */
export async function orchestrateGapResolution(
  projectId: string,
  gapAnalysis: GapAnalysisResult,
  promptContext: PromptContext,
): Promise<OrchestrationResult> {
  const resolutions: GapResolution[] = [];
  let activeMatches = 0;
  let archiveReuses = 0;
  let generationsQueued = 0;
  let unresolvable = 0;

  // Only process missing and weak gaps (skip improvable for auto-fill)
  const actionableGaps = gapAnalysis.gaps.filter(g => g.severity === 'missing' || g.severity === 'weak');

  for (const gap of actionableGaps) {
    const resolution = await resolveGap(projectId, gap, promptContext);
    resolutions.push(resolution);

    switch (resolution.method) {
      case 'active_match': activeMatches++; break;
      case 'archive_reuse': archiveReuses++; break;
      case 'generation_queued': generationsQueued++; break;
      case 'unresolvable': unresolvable++; break;
    }
  }

  return { resolutions, activeMatches, archiveReuses, generationsQueued, unresolvable };
}

/**
 * Attempt to resolve a single gap through the retrieve → reuse → recreate chain.
 */
async function resolveGap(
  projectId: string,
  gap: ImageGap,
  context: PromptContext,
): Promise<GapResolution> {
  const assetGroup = SUBJECT_TO_ASSET_GROUP[gap.subjectType] || 'visual_language';

  // 1. Search active pool for a better match
  const activeMatch = await searchPool(projectId, gap, 'active', assetGroup);
  if (activeMatch) {
    return {
      gap,
      method: 'active_match',
      resolvedImageId: activeMatch.id,
      reason: `Found active image matching ${gap.shotType}/${gap.orientation} in ${assetGroup}`,
    };
  }

  // 2. Search archive/candidate pool for reusable images
  const archiveMatch = await searchPool(projectId, gap, 'candidate', assetGroup);
  if (archiveMatch) {
    return {
      gap,
      method: 'archive_reuse',
      resolvedImageId: archiveMatch.id,
      reason: `Found reusable candidate image for ${gap.slotId}`,
    };
  }

  const archivedMatch = await searchPool(projectId, gap, 'archived', assetGroup);
  if (archivedMatch) {
    return {
      gap,
      method: 'archive_reuse',
      resolvedImageId: archivedMatch.id,
      reason: `Found archived image that can be restored for ${gap.slotId}`,
    };
  }

  // 3. Queue generation
  const template = resolvePromptTemplate(gap.subjectType, gap.shotType);
  const { prompt } = buildPromptFromTemplate(template, context);

  return {
    gap,
    method: 'generation_queued',
    generationPrompt: prompt,
    reason: `No existing image found — generation needed for ${gap.slideType}/${gap.slotId}`,
  };
}

/**
 * Search project_images pool for a match suitable for a gap.
 */
async function searchPool(
  projectId: string,
  gap: ImageGap,
  curationState: 'active' | 'candidate' | 'archived',
  assetGroup: string,
): Promise<ProjectImage | null> {
  const strategyKeys = SUBJECT_TO_STRATEGY_KEYS[gap.subjectType] || [];

  let q = (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', curationState)
    .eq('asset_group', assetGroup)
    .limit(10)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false });

  if (strategyKeys.length > 0) {
    q = q.in('strategy_key', strategyKeys);
  }

  const { data } = await q;
  if (!data?.length) return null;

  const images = data as ProjectImage[];

  // Score candidates for this specific gap
  const scored = images.map(img => {
    let score = 0;
    const orientation = classifyOrientation(img.width, img.height);

    // Orientation match
    if (gap.orientation === 'any' || orientation === gap.orientation) score += 10;
    else if (orientation === 'square') score += 3;

    // Shot type match
    if (img.shot_type === gap.shotType) score += 8;

    // Primary bonus
    if (img.is_primary) score += 5;

    // Narrative binding
    if (img.entity_id || img.location_ref || img.moment_ref) score += 6;

    return { img, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Only return if score is above minimum threshold
  const best = scored[0];
  if (best && best.score >= 5) return best.img;

  return null;
}

/**
 * Get a summary of what the orchestrator would do, without executing.
 * Useful for preview/confirmation UI.
 */
export function summarizeOrchestration(result: OrchestrationResult): string {
  const parts: string[] = [];
  if (result.activeMatches > 0) parts.push(`${result.activeMatches} already available`);
  if (result.archiveReuses > 0) parts.push(`${result.archiveReuses} can be reused`);
  if (result.generationsQueued > 0) parts.push(`${result.generationsQueued} need generation`);
  if (result.unresolvable > 0) parts.push(`${result.unresolvable} unresolvable`);
  return parts.join(', ') || 'No gaps to resolve';
}

// ── Subject → Edge Function section mapping ──────────────────────────────────
// These MUST match the valid sections in generate-lookbook-image edge function:
// "world" | "character" | "key_moment" | "visual_language"

const SUBJECT_TO_SECTION: Record<string, string> = {
  character: 'character',
  world: 'world',
  atmosphere: 'visual_language',
  moment: 'key_moment',
  texture: 'visual_language',
  poster: 'key_moment',
  generic: 'visual_language',
};

// ── Closed-Loop Generation Executor ──────────────────────────────────────────

/**
 * Execute actual image generation for all generation_queued resolutions.
 * Calls the generate-lookbook-image edge function for each gap, writes results
 * as candidates into project_images. Returns count of successfully generated images.
 */
export async function executeGapGenerations(
  projectId: string,
  resolutions: GapResolution[],
  context: PromptContext,
): Promise<{ generated: number; failed: number }> {
  const queued = resolutions.filter(r => r.method === 'generation_queued');
  if (queued.length === 0) return { generated: 0, failed: 0 };

  let generated = 0;
  let failed = 0;

  // Group by section to batch where possible
  const bySection = new Map<string, GapResolution[]>();
  for (const res of queued) {
    const section = SUBJECT_TO_SECTION[res.gap.subjectType] || 'atmosphere_lighting';
    const existing = bySection.get(section) || [];
    existing.push(res);
    bySection.set(section, existing);
  }

  for (const [section, sectionResolutions] of bySection) {
    try {
      // Generate one image per gap in this section
      const count = sectionResolutions.length;
      const assetGroup = SUBJECT_TO_ASSET_GROUP[sectionResolutions[0].gap.subjectType] || 'visual_language';

      toast.info(`Generating ${count} ${section} image${count > 1 ? 's' : ''}…`);

      const { data, error } = await (supabase as any).functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section,
          count: Math.min(count, 4), // Cap at 4 per batch
          asset_group: assetGroup,
          pack_mode: true,
          // Pass first gap's shot type as hint
          forced_shot_type: sectionResolutions[0].gap.shotType,
          auto_complete_context: {
            prompt_override: sectionResolutions[0].generationPrompt,
            slot_ids: sectionResolutions.map(r => r.gap.slotId),
            orientations: sectionResolutions.map(r => r.gap.orientation),
          },
        },
      });

      if (error) {
        console.error(`[AutoComplete] Generation failed for ${section}:`, error);
        failed += count;
        continue;
      }

      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      generated += successCount;
      failed += (count - successCount);
    } catch (e: any) {
      console.error(`[AutoComplete] Generation error for ${section}:`, e);
      failed += sectionResolutions.length;
    }
  }

  return { generated, failed };
}

// ── Auto-Promotion Scoring ───────────────────────────────────────────────────

const AUTO_PROMOTE_THRESHOLD = 12; // Minimum score to auto-promote

/**
 * Score a candidate image for auto-promotion eligibility.
 * Reuses the same scoring signals as the gap search — no duplicate logic.
 */
function scoreForAutoPromotion(img: ProjectImage, gap: ImageGap): number {
  let score = 0;
  const orientation = classifyOrientation(img.width, img.height);

  // Orientation match (+10)
  if (gap.orientation === 'any' || orientation === gap.orientation) score += 10;
  else if (orientation === 'square') score += 3;

  // Shot type match (+8)
  if (img.shot_type === gap.shotType) score += 8;

  // Narrative binding (+6)
  if (img.entity_id || img.location_ref || img.moment_ref) score += 6;

  // Asset group alignment (+4)
  const expectedAssetGroup = SUBJECT_TO_ASSET_GROUP[gap.subjectType] || 'visual_language';
  if ((img as any).asset_group === expectedAssetGroup) score += 4;

  return score;
}

/**
 * Auto-promote the best newly generated candidate per slot into active canon.
 * Only promotes images scoring above AUTO_PROMOTE_THRESHOLD.
 * Reuses the same slot-primary demotion logic as approveIntoCanon.
 * 
 * Returns { promoted, skipped } counts.
 */
export async function autoPromoteGeneratedImages(
  projectId: string,
  resolutions: GapResolution[],
): Promise<{ promoted: number; skipped: number }> {
  // Collect all gaps that had generation queued or archive reuse
  const promotable = resolutions.filter(
    r => r.method === 'generation_queued' || r.method === 'archive_reuse'
  );
  if (promotable.length === 0) return { promoted: 0, skipped: 0 };

  let promoted = 0;
  let skipped = 0;

  // Fetch all recent candidates for this project (generated in last 5 min)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentCandidates } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', 'candidate')
    .gte('created_at', fiveMinAgo)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!recentCandidates?.length) {
    console.log('[AutoPromote] No recent candidates found');
    return { promoted: 0, skipped: promotable.length };
  }

  const candidates = recentCandidates as ProjectImage[];

  // Track which slots already got a promoted image (one winner per slot)
  const promotedSlots = new Set<string>();

  for (const res of promotable) {
    const slotKey = `${res.gap.subjectType}:${res.gap.shotType}:${res.gap.orientation}`;
    if (promotedSlots.has(slotKey)) {
      skipped++;
      continue;
    }

    // Find best candidate for this gap
    const assetGroup = SUBJECT_TO_ASSET_GROUP[res.gap.subjectType] || 'visual_language';
    const matching = candidates.filter(c => {
      // Must be same asset group
      if ((c as any).asset_group && (c as any).asset_group !== assetGroup) return false;
      return true;
    });

    if (matching.length === 0) {
      skipped++;
      continue;
    }

    // Score and pick best
    const scored = matching.map(img => ({
      img,
      score: scoreForAutoPromotion(img, res.gap),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score < AUTO_PROMOTE_THRESHOLD) {
      console.log(`[AutoPromote] Skipping ${slotKey} — best score ${best.score} < threshold ${AUTO_PROMOTE_THRESHOLD}`);
      skipped++;
      continue;
    }

    // Promote: demote existing primaries in same slot, then activate
    try {
      // Demote existing primaries in same asset_group + subject + shot_type
      let demoteQ = (supabase as any)
        .from('project_images')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('is_primary', true);

      if ((best.img as any).asset_group) demoteQ = demoteQ.eq('asset_group', (best.img as any).asset_group);
      if (best.img.subject) demoteQ = demoteQ.eq('subject', best.img.subject);
      if (best.img.shot_type) demoteQ = demoteQ.eq('shot_type', best.img.shot_type);
      await demoteQ;

      // Promote the winner
      await (supabase as any)
        .from('project_images')
        .update({
          is_primary: true,
          is_active: true,
          curation_state: 'active',
          archived_from_active_at: null,
        })
        .eq('id', best.img.id);

      promotedSlots.add(slotKey);
      promoted++;
      console.log(`[AutoPromote] ✓ Promoted ${best.img.id} for ${slotKey} (score: ${best.score})`);
    } catch (e) {
      console.error(`[AutoPromote] Failed to promote ${best.img.id}:`, e);
      skipped++;
    }
  }

  return { promoted, skipped };
}
