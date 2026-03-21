/**
 * LookBook Image Orchestrator — Retrieve → Reuse → Recreate engine.
 * 
 * For each gap identified by the Gap Analyzer, this orchestrator:
 * 1. Searches active pool for a better match
 * 2. Searches archive/candidate pool for reusable images
 * 3. Queues generation for truly missing images
 * 4. Returns a BuildWorkingSet — temporary overlay for the LookBook build
 *    WITHOUT promoting candidates into active canon
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

// ── Build Working Set Types ─────────────────────────────────────────────────

export type WorkingSetSource = 'active' | 'candidate' | 'archived' | 'generated';

export interface WorkingSetEntry {
  /** Slide ID this image is for (semantic, e.g. 'world:main') */
  slideId: string;
  /** Explicit slide type — NEVER parsed from slideId */
  slideType: string;
  /** Slot ID within the layout */
  slotId: string;
  /** The chosen image */
  image: ProjectImage;
  /** Where the image came from */
  source: WorkingSetSource;
  /** Confidence/match score */
  score: number;
  /** Signed URL for rendering */
  signedUrl: string;
}

export interface BuildWorkingSet {
  entries: WorkingSetEntry[];
  /** Quick lookup: slideId:slotId → entry */
  bySlotKey: Map<string, WorkingSetEntry>;
}

// ── Orchestration Result Types ───────────────────────────────────────────────

export type ResolutionMethod = 'active_match' | 'archive_reuse' | 'generation_queued' | 'unresolvable';

export interface GapResolution {
  gap: ImageGap;
  method: ResolutionMethod;
  /** Image if resolved from existing pool */
  resolvedImage?: ProjectImage;
  /** Image ID if resolved from existing pool */
  resolvedImageId?: string;
  /** Source pool */
  resolvedSource?: WorkingSetSource;
  /** Match score */
  resolvedScore?: number;
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
      resolvedImage: activeMatch.img,
      resolvedImageId: activeMatch.img.id,
      resolvedSource: 'active',
      resolvedScore: activeMatch.score,
      reason: `Found active image matching ${gap.shotType}/${gap.orientation} in ${assetGroup}`,
    };
  }

  // 2. Search candidate pool for reusable images
  const candidateMatch = await searchPool(projectId, gap, 'candidate', assetGroup);
  if (candidateMatch) {
    return {
      gap,
      method: 'archive_reuse',
      resolvedImage: candidateMatch.img,
      resolvedImageId: candidateMatch.img.id,
      resolvedSource: 'candidate',
      resolvedScore: candidateMatch.score,
      reason: `Found reusable candidate image for ${gap.slotId}`,
    };
  }

  // 3. Search archived pool
  const archivedMatch = await searchPool(projectId, gap, 'archived', assetGroup);
  if (archivedMatch) {
    return {
      gap,
      method: 'archive_reuse',
      resolvedImage: archivedMatch.img,
      resolvedImageId: archivedMatch.img.id,
      resolvedSource: 'archived',
      resolvedScore: archivedMatch.score,
      reason: `Found archived image that can be restored for ${gap.slotId}`,
    };
  }

  // 4. Queue generation
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
 * Returns the image AND its score for working-set construction.
 */
async function searchPool(
  projectId: string,
  gap: ImageGap,
  curationState: 'active' | 'candidate' | 'archived',
  assetGroup: string,
): Promise<{ img: ProjectImage; score: number } | null> {
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
  if (best && best.score >= 5) return best;

  return null;
}

/**
 * Get a summary of what the orchestrator would do, without executing.
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
    const section = SUBJECT_TO_SECTION[res.gap.subjectType] || 'visual_language';
    const existing = bySection.get(section) || [];
    existing.push(res);
    bySection.set(section, existing);
  }

  for (const [section, sectionResolutions] of bySection) {
    try {
      const count = sectionResolutions.length;
      const assetGroup = SUBJECT_TO_ASSET_GROUP[sectionResolutions[0].gap.subjectType] || 'visual_language';

      toast.info(`Generating ${count} ${section} image${count > 1 ? 's' : ''}…`);

      const { data, error } = await (supabase as any).functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section,
          count: Math.min(count, 4),
          asset_group: assetGroup,
          pack_mode: true,
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

// ── Build Working Set Construction ───────────────────────────────────────────

/**
 * Build a temporary working set from orchestration results.
 * This provides image URLs for the LookBook build WITHOUT promoting
 * any images into active canon.
 * 
 * Hydrates signed URLs for all resolved images.
 */
export async function buildWorkingSetFromResolutions(
  resolutions: GapResolution[],
): Promise<BuildWorkingSet> {
  const entries: WorkingSetEntry[] = [];

  for (const res of resolutions) {
    if (!res.resolvedImage || !res.resolvedImageId) continue;

    const img = res.resolvedImage;
    let signedUrl = img.signedUrl || '';

    // Hydrate signed URL if missing
    if (!signedUrl && img.storage_path) {
      try {
        const bucket = img.storage_bucket || 'project-posters';
        const { data: signed } = await supabase.storage
          .from(bucket)
          .createSignedUrl(img.storage_path, 3600);
        signedUrl = signed?.signedUrl || '';
      } catch {
        // Skip if we can't get a URL
      }
    }

    if (!signedUrl) continue;

    entries.push({
      slideId: res.gap.slideId,
      slideType: res.gap.slideType,
      slotId: res.gap.slotId,
      image: img,
      source: res.resolvedSource || 'candidate',
      score: res.resolvedScore || 0,
      signedUrl,
    });
  }

  // Also pick up recently generated candidates (stored as candidate in DB)
  // These were created by executeGapGenerations moments ago
  const bySlotKey = new Map<string, WorkingSetEntry>();
  for (const entry of entries) {
    const key = `${entry.slideId}:${entry.slotId}`;
    const existing = bySlotKey.get(key);
    if (!existing || entry.score > existing.score) {
      bySlotKey.set(key, entry);
    }
  }

  console.log(`[WorkingSet] Built ${bySlotKey.size} working-set entries from ${entries.length} resolved images`);

  return { entries, bySlotKey };
}

/**
 * After generation, scan recent candidates and add them to the working set.
 * This picks up images that were just generated by executeGapGenerations.
 */
export async function augmentWorkingSetWithRecentGenerations(
  projectId: string,
  workingSet: BuildWorkingSet,
  resolutions: GapResolution[],
): Promise<BuildWorkingSet> {
  const generatedGaps = resolutions.filter(r => r.method === 'generation_queued');
  if (generatedGaps.length === 0) return workingSet;

  // Fetch recent candidates
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentCandidates } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', 'candidate')
    .gte('created_at', fiveMinAgo)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!recentCandidates?.length) return workingSet;

  const candidates = recentCandidates as ProjectImage[];

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

  // Try to match generated candidates to gaps
  for (const gap of generatedGaps) {
    const key = `${gap.gap.slideId}:${gap.gap.slotId}`;
    if (workingSet.bySlotKey.has(key)) continue; // already filled

    const assetGroup = SUBJECT_TO_ASSET_GROUP[gap.gap.subjectType] || 'visual_language';
    const matching = candidates.filter(c => {
      if ((c as any).asset_group && (c as any).asset_group !== assetGroup) return false;
      return !!c.signedUrl;
    });

    if (matching.length === 0) continue;

    // Score and pick best
    const scored = matching.map(img => {
      let score = 0;
      const orientation = classifyOrientation(img.width, img.height);
      if (gap.gap.orientation === 'any' || orientation === gap.gap.orientation) score += 10;
      if (img.shot_type === gap.gap.shotType) score += 8;
      if (img.entity_id || img.location_ref || img.moment_ref) score += 6;
      return { img, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.img.signedUrl) {
      const entry: WorkingSetEntry = {
        slideId: gap.gap.slideId,
        slotId: gap.gap.slotId,
        image: best.img,
        source: 'generated',
        score: best.score,
        signedUrl: best.img.signedUrl,
      };
      workingSet.entries.push(entry);
      workingSet.bySlotKey.set(key, entry);
    }
  }

  console.log(`[WorkingSet] Augmented to ${workingSet.bySlotKey.size} entries after generation scan`);
  return workingSet;
}
