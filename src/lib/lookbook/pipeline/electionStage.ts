/**
 * electionStage — Deterministic image election for LookBook slides.
 *
 * Uses the CANONICAL scorer only (lookbookScorer.scoreImageForSlide).
 * No alternative scoring logic.
 *
 * INPUT: section pools, slide type, scoring context
 * OUTPUT: elected image URLs with diagnostics
 * SIDE EFFECTS: none (pure functions)
 */
import type { ProjectImage } from '@/lib/images/types';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import { scoreImageForSlide, getImageFingerprint, type ScoringContext } from './lookbookScorer';
import { SLIDE_SECTION_AFFINITY, type PoolKey } from './lookbookSlotRegistry';

// ── Election Context ─────────────────────────────────────────────────────────

export interface ElectionContext {
  /** Deck-level URL usage tracker */
  deckImageUsage: Map<string, { count: number; usedOnSlides: string[] }>;
  /** Semantic fingerprint tracker */
  usedFingerprints: Map<string, number>;
  /** URL → ProjectImage lookup */
  urlToImage: Map<string, ProjectImage>;
  /** Section pools by pool key */
  sectionPools: Record<PoolKey, ProjectImage[]>;
  /** Used background URLs for dedup */
  usedBackgroundUrls: string[];
}

/**
 * Create a fresh election context from inventory results.
 */
export function createElectionContext(
  sectionPools: Record<PoolKey, ProjectImage[]>,
): ElectionContext {
  const urlToImage = new Map<string, ProjectImage>();
  for (const pool of Object.values(sectionPools)) {
    for (const img of pool) {
      if (img.signedUrl) urlToImage.set(img.signedUrl, img);
    }
  }

  return {
    deckImageUsage: new Map(),
    usedFingerprints: new Map(),
    urlToImage,
    sectionPools,
    usedBackgroundUrls: [],
  };
}

// ── Tracking helpers ─────────────────────────────────────────────────────────

export function trackSelection(ctx: ElectionContext, url: string, slideType: string): void {
  // Track URL usage
  const entry = ctx.deckImageUsage.get(url);
  if (entry) {
    entry.count++;
    entry.usedOnSlides.push(slideType);
  } else {
    ctx.deckImageUsage.set(url, { count: 1, usedOnSlides: [slideType] });
  }
  // Track fingerprint
  const img = ctx.urlToImage.get(url);
  if (img) {
    const fp = getImageFingerprint(img);
    ctx.usedFingerprints.set(fp, (ctx.usedFingerprints.get(fp) || 0) + 1);
  }
}

function getScoringContext(ctx: ElectionContext): ScoringContext {
  return {
    deckImageUsage: ctx.deckImageUsage,
    usedFingerprints: ctx.usedFingerprints,
  };
}

// ── Foreground election ──────────────────────────────────────────────────────

/**
 * Pick the best N foreground images from a pool using the canonical scorer.
 * Returns unique URLs only, scored and sorted. Logs election diagnostics.
 */
export function pickForegroundImages(
  pool: ProjectImage[],
  slideType: string,
  maxCount: number,
  ctx: ElectionContext,
  excludeUrls: string[] = [],
): string[] {
  const seen = new Set(excludeUrls);
  const scoringCtx = getScoringContext(ctx);
  const scored = pool
    .filter(img => img.signedUrl && !seen.has(img.signedUrl!))
    .map(img => ({ img, score: scoreImageForSlide(img, slideType, true, scoringCtx) }))
    .sort((a, b) => b.score - a.score);

  const result: string[] = [];
  const winners: Array<{ id: string; score: number; primary: boolean; age: string }> = [];
  const losers: Array<{ id: string; score: number; primary: boolean; reason: string }> = [];

  for (const { img, score } of scored) {
    if (result.length >= maxCount) {
      losers.push({ id: img.id.slice(0, 8), score, primary: !!img.is_primary, reason: 'capacity' });
      continue;
    }
    if (seen.has(img.signedUrl!)) {
      losers.push({ id: img.id.slice(0, 8), score, primary: !!img.is_primary, reason: 'duplicate' });
      continue;
    }
    seen.add(img.signedUrl!);
    result.push(img.signedUrl!);
    const ageDays = Math.floor((Date.now() - new Date(img.created_at || 0).getTime()) / (1000 * 60 * 60 * 24));
    winners.push({ id: img.id.slice(0, 8), score, primary: !!img.is_primary, age: `${ageDays}d` });
  }

  if (winners.length > 0 || losers.length > 0) {
    console.log(`[LookBook:election] ${slideType} fg: winners=${JSON.stringify(winners)} | top-losers=${JSON.stringify(losers.slice(0, 3))}`);
  }

  return result;
}

// ── Background election ──────────────────────────────────────────────────────

/**
 * Pick the best background image from section-appropriate pools.
 * Uses section affinity to prevent cross-contamination.
 * Falls back to global pool ONLY when all affinity pools are empty.
 */
export function pickBackgroundImage(
  primaryPool: ProjectImage[],
  ctx: ElectionContext,
  slideType: string,
  fallbackPool: ProjectImage[] = [],
): string | undefined {
  const excludeUrls = ctx.usedBackgroundUrls;
  const isExcluded = (img: ProjectImage) => !img.signedUrl || excludeUrls.includes(img.signedUrl!);
  const scoringCtx = getScoringContext(ctx);

  // Build affinity-ordered pool from section pools
  const affinityKeys = SLIDE_SECTION_AFFINITY[slideType] || [];
  const affinityPool: ProjectImage[] = [];
  for (const key of affinityKeys) {
    for (const img of (ctx.sectionPools[key] || [])) {
      if (!isExcluded(img) && !affinityPool.includes(img)) {
        affinityPool.push(img);
      }
    }
  }

  // Merge primary + affinity, removing duplicates
  const combinedPrimary = [...primaryPool.filter(i => !isExcluded(i))];
  for (const img of affinityPool) {
    if (!combinedPrimary.includes(img)) combinedPrimary.push(img);
  }

  const scored = combinedPrimary.map(img => ({
    img,
    score: scoreImageForSlide(img, slideType, true, scoringCtx),
  }));
  scored.sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const top3 = scored.slice(0, 3).map(s => ({
      id: s.img.id.slice(0, 8),
      score: s.score,
      primary: !!s.img.is_primary,
      orient: classifyOrientation(s.img.width, s.img.height),
      age: `${Math.floor((Date.now() - new Date(s.img.created_at || 0).getTime()) / (1000 * 60 * 60 * 24))}d`,
    }));
    console.log(`[LookBook:election] ${slideType} bg: candidates=${scored.length} top3=${JSON.stringify(top3)}`);
  }

  // Prefer landscape for backgrounds
  const bestLandscape = scored.find(s => classifyOrientation(s.img.width, s.img.height) === 'landscape');
  if (bestLandscape) return bestLandscape.img.signedUrl!;
  if (scored.length > 0) return scored[0].img.signedUrl!;

  // Global fallback — LAST RESORT only
  const allSectionImages: ProjectImage[] = [];
  for (const pool of Object.values(ctx.sectionPools)) {
    for (const img of pool) {
      if (!isExcluded(img) && !allSectionImages.includes(img)) {
        allSectionImages.push(img);
      }
    }
  }
  const globalFallback = (fallbackPool.length > 0 ? fallbackPool : allSectionImages)
    .filter(i => !isExcluded(i))
    .map(img => ({ img, score: scoreImageForSlide(img, slideType, true, scoringCtx) }));
  globalFallback.sort((a, b) => b.score - a.score);
  const globalLandscape = globalFallback.find(s => classifyOrientation(s.img.width, s.img.height) === 'landscape');
  if (globalLandscape) return globalLandscape.img.signedUrl!;
  if (globalFallback.length > 0) return globalFallback[0].img.signedUrl!;

  return undefined;
}

// ── Poster Hero Election ─────────────────────────────────────────────────────

/**
 * Global election across all project images for the poster hero.
 * Returns the single best poster-worthy image.
 */
export function selectPosterHero(
  allImages: ProjectImage[],
): { url: string; id: string; score: number } | null {
  const candidates = allImages.filter(img => img.signedUrl);
  if (candidates.length === 0) return null;

  const scored = candidates.map(img => {
    let score = 0;

    // Role-based scoring
    if (img.role === 'poster_primary') score += 30;
    if (img.role === 'poster_variant') score += 15;
    if (img.role === 'lookbook_cover') score += 20;

    // Shot type scoring
    const st = img.shot_type || '';
    if (['close_up', 'emotional_variant'].includes(st)) score += 12;
    if (['tableau', 'wide'].includes(st)) score += 8;
    if (['medium', 'full_body'].includes(st)) score += 6;
    if (['texture_ref', 'detail', 'composition_ref', 'color_ref'].includes(st)) score -= 20;

    // Narrative truth
    if (img.entity_id || img.subject_ref) score += 10;
    if (img.moment_ref) score += 8;

    // Landscape bonus
    if (classifyOrientation(img.width, img.height) === 'landscape') score += 6;

    // Freshness
    const ageDays = (Date.now() - new Date(img.created_at || 0).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 1) score += 8;
    else if (ageDays < 3) score += 5;
    else if (ageDays < 7) score += 2;

    // Primary status
    if (img.is_primary) score += 3;

    // Anti-pattern: craft imagery
    const prompt = ((img as any).prompt_used || '').toLowerCase();
    if (prompt.includes('pottery') || prompt.includes('ceramic') || prompt.includes('workshop') ||
        prompt.includes('kiln') || prompt.includes('craftsman')) {
      score -= 30;
    }

    return { img, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const top3 = scored.slice(0, 3).map(s => ({
    id: s.img.id.slice(0, 8),
    score: s.score,
    role: s.img.role,
    shot: s.img.shot_type || 'none',
    orient: classifyOrientation(s.img.width, s.img.height),
  }));
  console.log(`[LookBook:posterHero] election: top3=${JSON.stringify(top3)} pool=${candidates.length}`);

  const winner = scored[0];
  return { url: winner.img.signedUrl!, id: winner.img.id, score: winner.score };
}

// ── Image Role Assignment ────────────────────────────────────────────────────

export function assignImageRoles(
  urls: string[],
  slideType: string,
  ctx: ElectionContext,
  bgUrl?: string,
): Array<{ url: string; role: 'hero' | 'support' | 'background'; score: number }> {
  const roles: Array<{ url: string; role: 'hero' | 'support' | 'background'; score: number }> = [];

  if (bgUrl) {
    const bgImg = ctx.urlToImage.get(bgUrl);
    roles.push({ url: bgUrl, role: 'background', score: bgImg ? scoreImageForSlide(bgImg, slideType, false) : 0 });
  }

  for (let i = 0; i < urls.length; i++) {
    const img = ctx.urlToImage.get(urls[i]);
    const score = img ? scoreImageForSlide(img, slideType, false) : 0;
    roles.push({
      url: urls[i],
      role: i === 0 ? 'hero' : 'support',
      score,
    });
  }

  return roles;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function logElectionDiagnostics(ctx: ElectionContext): void {
  // Reuse diagnostics
  const reuseEntries = Array.from(ctx.deckImageUsage.entries())
    .filter(([, v]) => v.count > 1)
    .map(([, v]) => `${v.usedOnSlides.join('+')} (×${v.count})`);
  if (reuseEntries.length > 0) {
    console.warn(`[LookBook] ⚠ image reuse detected: ${reuseEntries.join(' | ')}`);
  } else {
    console.log('[LookBook] ✓ no cross-slide image reuse');
  }

  // Fingerprint diagnostics
  const fpStats = Array.from(ctx.usedFingerprints.entries())
    .filter(([, count]) => count > 1)
    .map(([fp, count]) => `${fp} (×${count})`);
  if (fpStats.length > 0) {
    console.warn(`[LookBook] ⚠ fingerprint reuse: ${fpStats.join(' | ')}`);
  } else {
    console.log('[LookBook] ✓ no fingerprint repetition — good semantic diversity');
  }
}
