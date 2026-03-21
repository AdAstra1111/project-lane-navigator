/**
 * qaStage — Final deck quality validation.
 *
 * INPUT: LookBookData
 * OUTPUT: QAResult
 * SIDE EFFECTS: none (pure function)
 */
import type { LookBookData } from '../types';
import type { QAResult } from './types';

/**
 * Run quality checks on the assembled LookBook deck.
 * Returns structured QA metrics and publishability assessment.
 */
export function runQAStage(data: LookBookData): QAResult {
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

  return {
    totalSlides: data.slides.length,
    slidesWithImages,
    slidesWithoutImages: data.slides.length - slidesWithImages,
    totalImageRefs: actualImageUrls.size,
    unresolvedSlides,
    reuseWarnings,
    fingerprintWarnings,
    publishable: unresolvedSlides.length <= 2 && slidesWithImages >= Math.floor(data.slides.length * 0.6),
  };
}
