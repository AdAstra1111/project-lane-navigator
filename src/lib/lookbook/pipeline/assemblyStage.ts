/**
 * assemblyStage — Assembles LookBook slides from elected images and narrative context.
 *
 * INPUT: narrative context, elected images per slide, identity
 * OUTPUT: SlideContent[] array
 * SIDE EFFECTS: none (pure function)
 *
 * This stage handles:
 * - Slide ordering and construction
 * - Layout hint resolution
 * - Composition mode resolution
 * - Visual rhythm tracking
 * - Per-slide deduplication
 * - Layout family resolution + slot matching
 */
import type { SlideContent, SlideComposition, LayoutHint, LookBookVisualIdentity } from '../types';
import { resolveLookbookLayoutFamily, summarizeOrientations } from '../lookbookLayoutFamilies';
import { matchImagesToSlots, type ImageCandidate } from '../lookbookSlotMatcher';
import type { ElectionContext } from './electionStage';
import { pickForegroundImages, pickBackgroundImage, selectPosterHero, assignImageRoles, trackSelection } from './electionStage';
import type { NarrativeContext } from './types';
import type { SectionImageResult } from '../resolveCanonImages';
import { normalizeCanonText } from '../normalizeCanonText';
import type { ProjectImage } from '@/lib/images/types';

// ── Rhythm Engine ────────────────────────────────────────────────────────────

class RhythmTracker {
  private history: SlideComposition[] = [];

  getRhythmPenalty(composition: SlideComposition): number {
    if (this.history.length === 0) return 0;
    const last = this.history[this.history.length - 1];
    if (last === composition) return -1;
    const imageDense: SlideComposition[] = ['full_bleed_hero', 'montage_grid', 'split_cinematic'];
    const textDense: SlideComposition[] = ['text_over_atmosphere', 'editorial_panel', 'gradient_only'];
    if (imageDense.includes(last) && imageDense.includes(composition)) return -0.5;
    if (textDense.includes(last) && textDense.includes(composition)) return -0.5;
    return 0;
  }

  resolveComposition(
    slideType: string,
    hasBackground: boolean,
    hasForegroundImages: boolean,
    imageCount: number,
  ): SlideComposition {
    let primary: SlideComposition;

    if (slideType === 'characters') primary = 'character_feature';
    else if (slideType === 'key_moments' && imageCount >= 2) primary = 'montage_grid';
    else if (slideType === 'cover' || slideType === 'closing') primary = 'full_bleed_hero';
    else if (slideType === 'creative_statement') primary = hasBackground ? 'text_over_atmosphere' : 'gradient_only';
    else if (slideType === 'comparables') primary = hasBackground ? 'text_over_atmosphere' : 'editorial_panel';
    else if (!hasBackground && !hasForegroundImages) primary = 'gradient_only';
    else if (hasBackground && hasForegroundImages) primary = 'split_cinematic';
    else if (hasBackground) primary = 'text_over_atmosphere';
    else primary = 'editorial_panel';

    const penalty = this.getRhythmPenalty(primary);
    if (penalty < -0.5 && hasBackground && hasForegroundImages) {
      if (primary === 'split_cinematic') primary = 'montage_grid';
      else if (primary === 'montage_grid' && imageCount >= 1) primary = 'split_cinematic';
      else if (primary === 'text_over_atmosphere') primary = 'editorial_panel';
      else if (primary === 'editorial_panel' && hasBackground) primary = 'text_over_atmosphere';
    }

    this.history.push(primary);
    return primary;
  }
}

// ── Layout hint resolver ─────────────────────────────────────────────────────

function resolveLayoutHint(
  slideType: string,
  imageCount: number,
  hasBackground: boolean,
  hasHeroImage: boolean,
): LayoutHint {
  switch (slideType) {
    case 'key_moments':
      if (imageCount >= 4) return 'hero_top_grid';
      if (imageCount >= 2) return 'asymmetric_split';
      if (imageCount === 1) return 'cinematic_stack';
      return 'default';
    case 'world':
      if (hasBackground && imageCount >= 2) return 'environment_grid';
      if (hasBackground) return 'landscape_hero';
      return 'default';
    case 'characters':
      return imageCount >= 2 ? 'dual_character_split' : 'portrait_dominant';
    case 'themes':
    case 'creative_statement':
      return hasBackground ? 'text_overlay_bg' : 'minimal_text_center';
    case 'visual_language':
      return imageCount >= 2 ? 'environment_grid' : 'default';
    case 'story_engine':
      return hasBackground ? 'text_overlay_bg' : 'default';
    default:
      return 'default';
  }
}

// ── Semantic slide IDs ───────────────────────────────────────────────────────

export function makeSemanticSlideId(kind: string, variant: string = 'main'): string {
  return `${kind}:${variant}`;
}

// ── Slide provenance converter ───────────────────────────────────────────────

function toSlideProvenance(result: SectionImageResult) {
  return result.provenance.map(p => ({
    imageId: p.imageId,
    source: p.source,
    complianceClass: p.complianceClass,
    actualWidth: p.actualWidth,
    actualHeight: p.actualHeight,
  }));
}

// ── Main Assembly ────────────────────────────────────────────────────────────

export interface AssemblyInput {
  narrative: NarrativeContext;
  identity: LookBookVisualIdentity;
  canonImages: Record<string, SectionImageResult>;
  sectionPools: Record<string, ProjectImage[]>;
  electionCtx: ElectionContext;
  companyName: string;
  companyLogoUrl: string | null;
  isVerticalDrama: boolean;
  assignedLane: string;
  format: string;
}

export function runAssemblyStage(input: AssemblyInput): SlideContent[] {
  const {
    narrative, identity, canonImages, sectionPools, electionCtx,
    companyName, companyLogoUrl, isVerticalDrama, assignedLane, format,
  } = input;

  const rhythm = new RhythmTracker();
  const slides: SlideContent[] = [];
  const writerCredit = 'Written by Sebastian Street';

  // Convenience pool aliases
  const worldImages = sectionPools.world || [];
  const atmosphereImages = sectionPools.atmosphere || [];
  const textureImages = sectionPools.texture || [];
  const motifImages = sectionPools.motifs || [];
  const keyMomentImages = sectionPools.keyMoments || [];

  // ── Poster Hero Election ──
  const allUniqueImages: ProjectImage[] = [];
  const seenIds = new Set<string>();
  for (const pool of Object.values(sectionPools)) {
    for (const img of pool as ProjectImage[]) {
      if (!seenIds.has(img.id)) {
        seenIds.add(img.id);
        allUniqueImages.push(img);
      }
    }
  }
  const posterHero = selectPosterHero(allUniqueImages);
  const coverImageUrl = posterHero?.url || '';

  // ── 1. COVER ──
  const coverBg = coverImageUrl || pickBackgroundImage(worldImages, electionCtx, 'cover') || undefined;
  slides.push({
    type: 'cover',
    slide_id: makeSemanticSlideId('cover'),
    title: narrative.projectTitle,
    subtitle: narrative.logline || undefined,
    credit: writerCredit,
    companyName,
    companyLogoUrl,
    imageUrl: coverImageUrl || undefined,
    backgroundImageUrl: coverBg,
    composition: 'full_bleed_hero',
    _debug_image_ids: canonImages.poster_directions?.imageIds?.slice(0, 1),
    _debug_provenance: canonImages.poster_directions ? toSlideProvenance(canonImages.poster_directions).slice(0, 1) : [],
    _has_unresolved: canonImages.poster_directions?.unresolvedCount > 0,
  });
  if (coverBg) { electionCtx.usedBackgroundUrls.push(coverBg); trackSelection(electionCtx, coverBg, 'cover'); }
  if (coverImageUrl && coverImageUrl !== coverBg) trackSelection(electionCtx, coverImageUrl, 'cover');

  // ── 2. CREATIVE VISION ──
  {
    const cvRaw = narrative.creativeStatement?.slice(0, 500)
      || narrative.premise
      || narrative.logline
      || narrative.synopsis?.slice(0, 300)
      || '';
    const cvPrimary = cvRaw
      .replace(/^#{1,6}\s+.*$/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^[-*]\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const cvBullets = [
      narrative.genre ? `Genre: ${narrative.genre}` : '',
      narrative.formatLabel ? `Format: ${narrative.formatLabel}` : '',
      narrative.toneStyle ? `Tone: ${narrative.toneStyle}` : '',
      narrative.targetAudience ? `Audience: ${narrative.targetAudience}` : '',
    ].filter(Boolean);
    const cvSecondary = narrative.creativeStatement && narrative.premise && narrative.premise !== narrative.creativeStatement
      ? narrative.premise.slice(0, 300) : undefined;
    const cvBg = pickBackgroundImage(atmosphereImages, electionCtx, 'creative_statement');
    if (cvBg) { electionCtx.usedBackgroundUrls.push(cvBg); trackSelection(electionCtx, cvBg, 'creative_statement'); }
    slides.push({
      type: 'creative_statement',
      slide_id: makeSemanticSlideId('creative_statement'),
      title: 'Creative Vision',
      body: cvPrimary,
      bodySecondary: cvSecondary,
      bullets: cvBullets.length > 0 ? cvBullets : undefined,
      credit: writerCredit,
      backgroundImageUrl: cvBg,
      composition: cvBg ? 'text_over_atmosphere' : 'gradient_only',
      layoutHint: resolveLayoutHint('creative_statement', 0, !!cvBg, false),
    });
  }

  // ── 3. WORLD ──
  if (narrative.worldRules || narrative.locations || narrative.timeline || worldImages.length > 0) {
    const worldBg = pickBackgroundImage(worldImages, electionCtx, 'world');
    if (worldBg) { electionCtx.usedBackgroundUrls.push(worldBg); trackSelection(electionCtx, worldBg, 'world'); }
    const worldForeground = pickForegroundImages(worldImages, 'world', 4, electionCtx, worldBg ? [worldBg] : []);
    worldForeground.forEach(u => trackSelection(electionCtx, u, 'world'));
    const worldComp = rhythm.resolveComposition('world', !!worldBg, worldForeground.length > 1, worldForeground.length);
    const worldHint = resolveLayoutHint('world', worldForeground.length, !!worldBg, !!worldForeground[0]);
    slides.push({
      type: 'world',
      slide_id: makeSemanticSlideId('world'),
      title: 'The World',
      body: narrative.worldRules || undefined,
      bodySecondary: narrative.locations || undefined,
      quote: narrative.timeline || undefined,
      imageUrl: worldForeground[0] || undefined,
      imageUrls: worldForeground,
      backgroundImageUrl: worldBg,
      composition: worldComp,
      layoutHint: worldHint,
      roledImages: assignImageRoles(worldForeground, 'world', electionCtx, worldBg),
      _debug_image_ids: canonImages.world_locations?.imageIds,
      _debug_provenance: canonImages.world_locations ? toSlideProvenance(canonImages.world_locations) : [],
      _has_unresolved: canonImages.world_locations?.unresolvedCount > 0,
    });
  }

  // ── 4. KEY MOMENTS ──
  {
    const keyMomentBody = keyMomentImages.length > 0
      ? 'The defining visual beats — the frames that sell the story, anchor the trailer, and live in the audience\'s memory.'
      : 'Key visual moments will be populated as the project\'s visual canon develops.';
    const kmForeground = pickForegroundImages(keyMomentImages, 'key_moments', 6, electionCtx);
    kmForeground.forEach(u => trackSelection(electionCtx, u, 'key_moments'));
    const kmComp = rhythm.resolveComposition('key_moments', false, kmForeground.length > 0, kmForeground.length);
    const kmHint = resolveLayoutHint('key_moments', kmForeground.length, false, !!kmForeground[0]);
    slides.push({
      type: 'key_moments',
      slide_id: makeSemanticSlideId('key_moments'),
      title: 'Key Moments',
      body: keyMomentBody,
      imageUrl: keyMomentImages[0]?.signedUrl || undefined,
      imageUrls: kmForeground,
      composition: kmComp,
      layoutHint: kmHint,
      roledImages: assignImageRoles(kmForeground, 'key_moments', electionCtx),
      _debug_image_ids: canonImages.key_moments?.imageIds,
      _debug_provenance: canonImages.key_moments ? toSlideProvenance(canonImages.key_moments) : [],
      _has_unresolved: canonImages.key_moments?.unresolvedCount > 0,
    });
  }

  // ── 5. CHARACTERS ──
  if (narrative.characters && Array.isArray(narrative.characters) && (narrative.characters as any[]).length > 0) {
    // Character normalization is done here using the narrative context
    // The character image maps come from the inventory stage
    slides.push({
      type: 'characters',
      slide_id: makeSemanticSlideId('characters'),
      title: 'Characters',
      characters: narrative.characters as any,
      composition: 'character_feature',
      _debug_image_ids: canonImages.character_identity?.imageIds,
      _debug_provenance: canonImages.character_identity ? toSlideProvenance(canonImages.character_identity) : [],
      _has_unresolved: canonImages.character_identity?.unresolvedCount > 0,
    });
  }

  // ── 6. VISUAL LANGUAGE ──
  {
    const vlImages = [...textureImages, ...motifImages];
    const vlBg = pickBackgroundImage(vlImages, electionCtx, 'visual_language', atmosphereImages);
    if (vlBg) { electionCtx.usedBackgroundUrls.push(vlBg); trackSelection(electionCtx, vlBg, 'visual_language'); }
    const vlForeground = pickForegroundImages(vlImages, 'visual_language', 4, electionCtx, vlBg ? [vlBg] : []);
    vlForeground.forEach(u => trackSelection(electionCtx, u, 'visual_language'));
    slides.push({
      type: 'visual_language',
      slide_id: makeSemanticSlideId('visual_language'),
      title: 'Visual Language',
      body: 'A unified visual philosophy where atmosphere, colour, and composition serve the narrative.',
      imageUrl: vlImages[0]?.signedUrl || undefined,
      imageUrls: vlForeground,
      backgroundImageUrl: vlBg,
      composition: rhythm.resolveComposition('visual_language', !!vlBg, vlForeground.length > 1, vlForeground.length),
      layoutHint: resolveLayoutHint('visual_language', vlForeground.length, !!vlBg, !!vlForeground[0]),
      roledImages: assignImageRoles(vlForeground, 'visual_language', electionCtx, vlBg),
      _debug_image_ids: [...(canonImages.texture_detail?.imageIds || []), ...(canonImages.symbolic_motifs?.imageIds || [])].slice(0, 4),
      _debug_provenance: [...(canonImages.texture_detail ? toSlideProvenance(canonImages.texture_detail) : []), ...(canonImages.symbolic_motifs ? toSlideProvenance(canonImages.symbolic_motifs) : [])].slice(0, 4),
      _has_unresolved: (canonImages.texture_detail?.unresolvedCount || 0) + (canonImages.symbolic_motifs?.unresolvedCount || 0) > 0,
    });
  }

  // ── 7. THEMES & TONE ──
  if (narrative.toneStyle) {
    const themesBg = pickBackgroundImage(atmosphereImages, electionCtx, 'themes', worldImages);
    if (themesBg) { electionCtx.usedBackgroundUrls.push(themesBg); trackSelection(electionCtx, themesBg, 'themes'); }
    const themesForeground = pickForegroundImages(atmosphereImages, 'themes', 4, electionCtx, themesBg ? [themesBg] : []);
    themesForeground.forEach(u => trackSelection(electionCtx, u, 'themes'));
    slides.push({
      type: 'themes',
      slide_id: makeSemanticSlideId('themes'),
      title: 'Themes & Tone',
      body: narrative.toneStyle,
      imageUrl: themesForeground[0] || undefined,
      imageUrls: themesForeground,
      backgroundImageUrl: themesBg,
      composition: rhythm.resolveComposition('themes', !!themesBg, themesForeground.length > 1, themesForeground.length),
      layoutHint: resolveLayoutHint('themes', themesForeground.length, !!themesBg, false),
      roledImages: assignImageRoles(themesForeground, 'themes', electionCtx, themesBg),
      _debug_image_ids: canonImages.atmosphere_lighting?.imageIds?.slice(0, 4),
      _debug_provenance: canonImages.atmosphere_lighting ? toSlideProvenance(canonImages.atmosphere_lighting).slice(0, 4) : [],
      _has_unresolved: canonImages.atmosphere_lighting?.unresolvedCount > 0,
    });
  }

  // ── 8. STORY ENGINE ──
  {
    const fmt = narrative.format.toLowerCase();
    if (fmt.includes('series') || fmt.includes('vertical') || fmt.includes('limited') || fmt.includes('feature') || fmt.includes('film') || narrative.logline) {
      const seImages = keyMomentImages.length > 2 ? keyMomentImages.slice(2, 6) : motifImages;
      const seBg = pickBackgroundImage(seImages, electionCtx, 'story_engine', keyMomentImages);
      if (seBg) { electionCtx.usedBackgroundUrls.push(seBg); trackSelection(electionCtx, seBg, 'story_engine'); }
      const seForeground = pickForegroundImages(seImages, 'story_engine', 3, electionCtx, seBg ? [seBg] : []);
      seForeground.forEach(u => trackSelection(electionCtx, u, 'story_engine'));
      slides.push({
        type: 'story_engine',
        slide_id: makeSemanticSlideId('story_engine'),
        title: 'Story Engine',
        body: narrative.formatConstraints || 'A tightly structured narrative built around escalating dramatic pressure.',
        imageUrl: seForeground[0] || undefined,
        imageUrls: seForeground,
        backgroundImageUrl: seBg,
        composition: rhythm.resolveComposition('story_engine', !!seBg, seForeground.length > 1, seForeground.length),
        layoutHint: resolveLayoutHint('story_engine', seForeground.length, !!seBg, !!seForeground[0]),
        roledImages: assignImageRoles(seForeground, 'story_engine', electionCtx, seBg),
        _has_unresolved: seImages.length === 0,
      });
    }
  }

  // ── 9. COMPARABLES ──
  if (narrative.comparables) {
    const comps = narrative.comparables.split('\n').filter(Boolean).slice(0, 4).map(line => {
      const match = line.match(/^[•\-*]?\s*(.+?)(?:\s*[-–—:]\s*(.+))?$/);
      if (match) return { title: match[1].trim(), reason: match[2]?.trim() || '' };
      return { title: line.trim(), reason: '' };
    });
    if (comps.length > 0) {
      const compBg = pickBackgroundImage([], electionCtx, 'comparables');
      if (compBg) { electionCtx.usedBackgroundUrls.push(compBg); trackSelection(electionCtx, compBg, 'comparables'); }
      slides.push({
        type: 'comparables',
        slide_id: makeSemanticSlideId('comparables'),
        title: 'Comparables',
        comparables: comps,
        backgroundImageUrl: compBg,
        composition: compBg ? 'text_over_atmosphere' : 'gradient_only',
      });
    }
  }

  // ── 10. POSTER DIRECTIONS ──
  const posterImages = canonImages.poster_directions?.images || [];
  if (posterImages.length > 1) {
    const posterForeground = pickForegroundImages(posterImages, 'cover', 4, electionCtx);
    posterForeground.forEach(u => trackSelection(electionCtx, u, 'poster_directions'));
    slides.push({
      type: 'key_moments' as any,
      slide_id: makeSemanticSlideId('key_moments', 'poster_directions'),
      title: 'Poster Directions',
      body: 'Key art explorations — the visual identity that anchors the marketing campaign.',
      imageUrl: posterForeground[0] || undefined,
      imageUrls: posterForeground,
      composition: 'montage_grid',
    });
  }

  // ── 11. CLOSING ──
  const closingBg = coverImageUrl || pickBackgroundImage(worldImages, electionCtx, 'closing');
  slides.push({
    type: 'closing',
    slide_id: makeSemanticSlideId('closing'),
    title: narrative.projectTitle,
    subtitle: narrative.logline || undefined,
    credit: writerCredit,
    companyName,
    companyLogoUrl,
    imageUrl: coverImageUrl || undefined,
    backgroundImageUrl: closingBg,
    composition: 'full_bleed_hero',
  });

  // ── Layout family resolution (landscape decks) ──
  const deckFormat = isVerticalDrama ? 'portrait' as const : 'landscape' as const;
  if (deckFormat === 'landscape') {
    for (const slide of slides) {
      const slideImages: Array<{ width?: number | null; height?: number | null; signedUrl?: string }> = [];
      if (slide._debug_provenance?.length) {
        for (const p of slide._debug_provenance) {
          const url = slide.imageUrls?.find((_, i) => slide._debug_image_ids?.[i] === p.imageId)
            || (slide._debug_image_ids?.[0] === p.imageId ? slide.imageUrl : undefined);
          slideImages.push({ width: p.actualWidth, height: p.actualHeight, signedUrl: url || undefined });
        }
      }
      const resolved = resolveLookbookLayoutFamily({
        slideType: slide.type,
        images: slideImages,
        lane: assignedLane || null,
        format,
        isCharacterSection: slide.type === 'characters',
      });
      slide.layoutFamily = resolved.familyKey;
      slide.layoutFamilyReason = resolved.reason;
      slide.layoutFamilyEffective = resolved.familyKey;
      slide.imageOrientationSummary = summarizeOrientations(slideImages);
      if (slideImages.length > 0) {
        const candidates: ImageCandidate[] = slideImages.map((img, i) => ({
          url: slide.imageUrls?.[i] || slide.imageUrl || '',
          width: img.width,
          height: img.height,
          rankIndex: i,
        })).filter(c => c.url);
        const matchResult = matchImagesToSlots(resolved, candidates);
        slide.slotAssignments = matchResult.assignments;
      }
    }
    console.log('[LookBook:assembly] ✓ layout families resolved:',
      slides.filter(s => s.layoutFamily).map(s => `${s.type}→${s.layoutFamily}`).join(', '));
  }

  // ── Per-slide deduplication ──
  for (const slide of slides) {
    const usedOnSlide = new Set<string>();
    if (slide.backgroundImageUrl) usedOnSlide.add(slide.backgroundImageUrl);
    if (slide.imageUrl && usedOnSlide.has(slide.imageUrl)) {
      if (slide.type !== 'cover' && slide.type !== 'closing') {
        slide.imageUrl = undefined;
      }
    } else if (slide.imageUrl) {
      usedOnSlide.add(slide.imageUrl);
    }
    if (slide.imageUrls?.length) {
      const deduped: string[] = [];
      for (const url of slide.imageUrls) {
        if (!usedOnSlide.has(url)) {
          usedOnSlide.add(url);
          deduped.push(url);
        }
      }
      slide.imageUrls = deduped.length > 0 ? deduped : undefined;
    }
  }

  return slides;
}
