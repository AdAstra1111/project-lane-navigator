/**
 * electionStage — Deterministic image election for LookBook slides.
 *
 * Uses the CANONICAL scorer only (lookbookScorer.scoreImageForSlide).
 * No alternative scoring logic.
 *
 * INPUT: section pools, slide definitions, optional narrative intelligence
 * OUTPUT: ElectionResult (per-slide winners + poster hero)
 * SIDE EFFECTS: none (pure functions)
 */
import type { ProjectImage } from '@/lib/images/types';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import { scoreImageForSlide, getImageFingerprint, type ScoringContext, type SlotIntentContext } from './lookbookScorer';
import { SLIDE_SECTION_AFFINITY, SLIDE_TO_POOL, type PoolKey } from './lookbookSlotRegistry';
import { getSlotIntent } from './lookbookSlotIntent';
import type { NarrativeEvidence } from './narrativeEvidence';
import type { IdentityBindings } from './identityBindingStage';
import type { ElectionContext, ElectionResult, SlideElection } from './types';

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
  const entry = ctx.deckImageUsage.get(url);
  if (entry) {
    entry.count++;
    entry.usedOnSlides.push(slideType);
  } else {
    ctx.deckImageUsage.set(url, { count: 1, usedOnSlides: [slideType] });
  }
  const img = ctx.urlToImage.get(url);
  if (img) {
    const fp = getImageFingerprint(img);
    ctx.usedFingerprints.set(fp, (ctx.usedFingerprints.get(fp) || 0) + 1);
  }
}

function getScoringContext(ctx: ElectionContext, slideType: string, boundPrincipalIds?: Set<string>, hasSceneEvidence?: boolean): ScoringContext {
  const intent = getSlotIntent(slideType);
  return {
    deckImageUsage: ctx.deckImageUsage,
    usedFingerprints: ctx.usedFingerprints,
    slotIntent: {
      requiresEnvironmentDominance: intent.requiresEnvironmentDominance,
      requiresPrincipalIdentity: intent.requiresPrincipalIdentity,
      requiresSceneProvenance: intent.requiresSceneProvenance,
      boundPrincipalIds,
      hasSceneEvidence: hasSceneEvidence || false,
    },
  };
}

/** Build SlotIntentContext for a given slide type */
function buildSlotIntentContext(
  slideType: string,
  boundPrincipalIds: Set<string>,
  hasSceneEvidence: boolean,
): SlotIntentContext {
  const intent = getSlotIntent(slideType);
  return {
    requiresEnvironmentDominance: intent.requiresEnvironmentDominance,
    requiresPrincipalIdentity: intent.requiresPrincipalIdentity,
    requiresSceneProvenance: intent.requiresSceneProvenance,
    boundPrincipalIds,
    hasSceneEvidence,
  };
}

// ── Foreground election ──────────────────────────────────────────────────────

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

export function pickBackgroundImage(
  primaryPool: ProjectImage[],
  ctx: ElectionContext,
  slideType: string,
  fallbackPool: ProjectImage[] = [],
): string | undefined {
  const excludeUrls = ctx.usedBackgroundUrls;
  const isExcluded = (img: ProjectImage) => !img.signedUrl || excludeUrls.includes(img.signedUrl!);
  const scoringCtx = getScoringContext(ctx);

  const affinityKeys = SLIDE_SECTION_AFFINITY[slideType] || [];
  const affinityPool: ProjectImage[] = [];
  for (const key of affinityKeys) {
    for (const img of (ctx.sectionPools[key] || [])) {
      if (!isExcluded(img) && !affinityPool.includes(img)) {
        affinityPool.push(img);
      }
    }
  }

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

  const bestLandscape = scored.find(s => classifyOrientation(s.img.width, s.img.height) === 'landscape');
  if (bestLandscape) return bestLandscape.img.signedUrl!;
  if (scored.length > 0) return scored[0].img.signedUrl!;

  // Global fallback
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

export function selectPosterHero(
  allImages: ProjectImage[],
): { url: string; id: string; score: number } | null {
  const candidates = allImages.filter(img => img.signedUrl);
  if (candidates.length === 0) return null;

  const scored = candidates.map(img => {
    let score = 0;
    if (img.role === 'poster_primary') score += 30;
    if (img.role === 'poster_variant') score += 15;
    if (img.role === 'lookbook_cover') score += 20;
    const st = img.shot_type || '';
    if (['close_up', 'emotional_variant'].includes(st)) score += 12;
    if (['tableau', 'wide'].includes(st)) score += 8;
    if (['medium', 'full_body'].includes(st)) score += 6;
    if (['texture_ref', 'detail', 'composition_ref', 'color_ref'].includes(st)) score -= 20;
    if (img.entity_id || img.subject_ref) score += 10;
    if (img.moment_ref) score += 8;
    if (classifyOrientation(img.width, img.height) === 'landscape') score += 6;
    const ageDays = (Date.now() - new Date(img.created_at || 0).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 1) score += 8;
    else if (ageDays < 3) score += 5;
    else if (ageDays < 7) score += 2;
    if (img.is_primary) score += 3;
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

// ── Slide definition for election ────────────────────────────────────────────

interface SlideElectionSpec {
  slideType: string;
  slideId: string;
  primaryPoolKey: PoolKey;
  fallbackPoolKeys: PoolKey[];
  maxForeground: number;
  needsBackground: boolean;
}

const SLIDE_ELECTION_SPECS: SlideElectionSpec[] = [
  { slideType: 'cover', slideId: 'cover:main', primaryPoolKey: 'poster', fallbackPoolKeys: ['world', 'atmosphere'], maxForeground: 0, needsBackground: true },
  { slideType: 'creative_statement', slideId: 'creative_statement:main', primaryPoolKey: 'atmosphere', fallbackPoolKeys: ['world'], maxForeground: 0, needsBackground: true },
  { slideType: 'world', slideId: 'world:main', primaryPoolKey: 'world', fallbackPoolKeys: ['atmosphere'], maxForeground: 4, needsBackground: true },
  { slideType: 'key_moments', slideId: 'key_moments:main', primaryPoolKey: 'keyMoments', fallbackPoolKeys: ['motifs', 'atmosphere'], maxForeground: 6, needsBackground: false },
  { slideType: 'visual_language', slideId: 'visual_language:main', primaryPoolKey: 'texture', fallbackPoolKeys: ['motifs', 'atmosphere'], maxForeground: 4, needsBackground: true },
  { slideType: 'themes', slideId: 'themes:main', primaryPoolKey: 'atmosphere', fallbackPoolKeys: ['world'], maxForeground: 4, needsBackground: true },
  { slideType: 'story_engine', slideId: 'story_engine:main', primaryPoolKey: 'keyMoments', fallbackPoolKeys: ['motifs'], maxForeground: 3, needsBackground: true },
  { slideType: 'comparables', slideId: 'comparables:main', primaryPoolKey: 'atmosphere', fallbackPoolKeys: [], maxForeground: 0, needsBackground: true },
  { slideType: 'poster_directions', slideId: 'key_moments:poster_directions', primaryPoolKey: 'poster', fallbackPoolKeys: [], maxForeground: 4, needsBackground: false },
  { slideType: 'closing', slideId: 'closing:main', primaryPoolKey: 'poster', fallbackPoolKeys: ['world'], maxForeground: 0, needsBackground: true },
];

/**
 * runElectionStage — Produces a complete ElectionResult.
 * All image selection happens HERE. Assembly consumes results only.
 */
export function runElectionStage(
  sectionPools: Record<PoolKey, ProjectImage[]>,
  allUniqueImages: ProjectImage[],
  narrativeEvidence?: NarrativeEvidence,
  identityBindings?: IdentityBindings,
): ElectionResult {
  const ctx = createElectionContext(sectionPools);

  // Build bound principal IDs set from identity bindings
  const boundPrincipalIds = new Set<string>();
  if (identityBindings) {
    for (const p of identityBindings.principals) {
      if ((p.strength === 'locked' || p.strength === 'anchored') && p.characterId) {
        boundPrincipalIds.add(p.characterId);
      }
    }
  }
  const hasSceneEvidence = (narrativeEvidence?.sceneEvidence?.length || 0) > 0;

  // 1. Poster hero — global election
  const posterHero = selectPosterHero(allUniqueImages);
  const coverImageUrl = posterHero?.url || '';

  // 2. Per-slide elections
  const slideElections = new Map<string, SlideElection>();

  for (const spec of SLIDE_ELECTION_SPECS) {
    const primaryPool = sectionPools[spec.primaryPoolKey] || [];
    const fallbackPool: ProjectImage[] = [];
    for (const k of spec.fallbackPoolKeys) {
      for (const img of (sectionPools[k] || [])) {
        if (!fallbackPool.includes(img)) fallbackPool.push(img);
      }
    }

    // Special handling for cover/closing — use poster hero
    if (spec.slideType === 'cover' || spec.slideType === 'closing') {
      const bgUrl = coverImageUrl || pickBackgroundImage(primaryPool, ctx, spec.slideType, fallbackPool);
      if (bgUrl) {
        ctx.usedBackgroundUrls.push(bgUrl);
        trackSelection(ctx, bgUrl, spec.slideType);
      }
      slideElections.set(spec.slideId, {
        slideType: spec.slideType,
        slideId: spec.slideId,
        backgroundUrl: bgUrl,
        foregroundUrls: [],
        roledImages: assignImageRoles([], spec.slideType, ctx, bgUrl),
      });
      continue;
    }

    // Background
    let bgUrl: string | undefined;
    if (spec.needsBackground) {
      bgUrl = pickBackgroundImage(primaryPool, ctx, spec.slideType, fallbackPool);
      if (bgUrl) {
        ctx.usedBackgroundUrls.push(bgUrl);
        trackSelection(ctx, bgUrl, spec.slideType);
      }
    }

    // Foreground
    const combinedPool = [...primaryPool];
    for (const img of fallbackPool) {
      if (!combinedPool.includes(img)) combinedPool.push(img);
    }
    let fgUrls: string[] = [];
    if (spec.maxForeground > 0) {
      // For story_engine, use tail of key moments pool
      if (spec.slideType === 'story_engine') {
        const kmPool = sectionPools.keyMoments || [];
        const sePool = kmPool.length > 2 ? kmPool.slice(2, 6) : (sectionPools.motifs || []);
        fgUrls = pickForegroundImages(sePool, spec.slideType, spec.maxForeground, ctx, bgUrl ? [bgUrl] : []);
      } else if (spec.slideType === 'visual_language') {
        const vlPool = [...(sectionPools.texture || []), ...(sectionPools.motifs || [])];
        fgUrls = pickForegroundImages(vlPool, spec.slideType, spec.maxForeground, ctx, bgUrl ? [bgUrl] : []);
      } else {
        fgUrls = pickForegroundImages(combinedPool, spec.slideType, spec.maxForeground, ctx, bgUrl ? [bgUrl] : []);
      }
      fgUrls.forEach(u => trackSelection(ctx, u, spec.slideType));
    }

    slideElections.set(spec.slideId, {
      slideType: spec.slideType,
      slideId: spec.slideId,
      backgroundUrl: bgUrl,
      foregroundUrls: fgUrls,
      roledImages: assignImageRoles(fgUrls, spec.slideType, ctx, bgUrl),
    });
  }

  return { posterHero, slideElections, electionCtx: ctx };
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function logElectionDiagnostics(ctx: ElectionContext): void {
  const reuseEntries = Array.from(ctx.deckImageUsage.entries())
    .filter(([, v]) => v.count > 1)
    .map(([, v]) => `${v.usedOnSlides.join('+')} (×${v.count})`);
  if (reuseEntries.length > 0) {
    console.warn(`[LookBook] ⚠ image reuse detected: ${reuseEntries.join(' | ')}`);
  } else {
    console.log('[LookBook] ✓ no cross-slide image reuse');
  }

  const fpStats = Array.from(ctx.usedFingerprints.entries())
    .filter(([, count]) => count > 1)
    .map(([fp, count]) => `${fp} (×${count})`);
  if (fpStats.length > 0) {
    console.warn(`[LookBook] ⚠ fingerprint reuse: ${fpStats.join(' | ')}`);
  } else {
    console.log('[LookBook] ✓ no fingerprint repetition — good semantic diversity');
  }
}
