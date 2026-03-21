/**
 * qaStage — Final deck quality validation.
 *
 * INPUT: LookBookData + optional RequirementResult[]
 * OUTPUT: QAResult
 * SIDE EFFECTS: none (pure function)
 */
import type { LookBookData } from '../types';
import type { QAResult } from './types';
import type { RequirementResult } from './requirementBuilder';

/**
 * Run quality checks on the assembled LookBook deck.
 * Returns structured QA metrics and publishability assessment.
 */
export function runQAStage(data: LookBookData, requirementResults?: RequirementResult[]): QAResult {
  const actualImageUrls = new Set<string>();
  const unresolvedSlides: string[] = [];
  const reuseWarnings: string[] = [];
  const fingerprintWarnings: string[] = [];

  // Track URL usage across slides for reuse detection
  const urlSlideUsage = new Map<string, string[]>();
  const trackUrl = (url: string, slideType: string) => {
    actualImageUrls.add(url);
    const existing = urlSlideUsage.get(url) || [];
    existing.push(slideType);
    urlSlideUsage.set(url, existing);
  };

  for (const slide of data.slides) {
    if (slide.backgroundImageUrl) trackUrl(slide.backgroundImageUrl, slide.type);
    if (slide.imageUrl) trackUrl(slide.imageUrl, slide.type);
    if (slide.imageUrls) slide.imageUrls.forEach(u => trackUrl(u, slide.type));
    if (slide.characters) {
      for (const c of slide.characters) {
        if (c.imageUrl) trackUrl(c.imageUrl, slide.type);
      }
    }
    if (slide._has_unresolved) unresolvedSlides.push(slide.type);
  }

  // Detect cross-slide reuse
  for (const [url, slides] of urlSlideUsage.entries()) {
    if (slides.length > 1) {
      reuseWarnings.push(`Image used on ${slides.join(' + ')} (×${slides.length})`);
    }
  }

  const slidesWithImages = data.slides.filter(s =>
    s.backgroundImageUrl || s.imageUrl || (s.imageUrls && s.imageUrls.length > 0) ||
    (s.characters && s.characters.some(c => c.imageUrl)),
  ).length;

  // Requirement-aware publishability
  let publishable: boolean;
  if (requirementResults && requirementResults.length > 0) {
    const satisfied = requirementResults.filter(r => r.status === 'satisfied').length;
    const critical = requirementResults.filter(r => r.requirement.critical);
    const criticalBlocked = critical.filter(r => r.status === 'blocked').length;
    // Publishable if no critical requirements are fully blocked
    // and at least 50% of all requirements are satisfied
    publishable = criticalBlocked === 0 && satisfied >= Math.ceil(requirementResults.length * 0.5);
  } else {
    publishable = unresolvedSlides.length <= 2 && slidesWithImages >= Math.floor(data.slides.length * 0.6);
  }

  return {
    totalSlides: data.slides.length,
    slidesWithImages,
    slidesWithoutImages: data.slides.length - slidesWithImages,
    totalImageRefs: actualImageUrls.size,
    unresolvedSlides,
    reuseWarnings,
    fingerprintWarnings,
    publishable,
  };
}
