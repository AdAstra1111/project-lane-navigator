/**
 * qaStage — Final deck quality validation.
 *
 * INPUT: LookBookData + optional RequirementResult[]
 * OUTPUT: QAResult with slot-purpose, identity, diversity, and fill diagnostics
 * SIDE EFFECTS: none (pure function)
 */
import type { LookBookData } from '../types';
import type { QAResult } from './types';
import type { RequirementResult } from './requirementBuilder';
import { validateCandidateForSlidePurpose, isEditorialSlide } from './slotPurposeValidator';

// ── Diagnostic types ─────────────────────────────────────────────────────────

export interface QADiagnostic {
  category: 'slot_purpose' | 'identity' | 'diversity' | 'fill' | 'editorial';
  severity: 'info' | 'warning' | 'error';
  slideType: string;
  message: string;
}

/**
 * Run quality checks on the assembled LookBook deck.
 */
export function runQAStage(data: LookBookData, requirementResults?: RequirementResult[]): QAResult {
  const actualImageUrls = new Set<string>();
  const unresolvedSlides: string[] = [];
  const reuseWarnings: string[] = [];
  const fingerprintWarnings: string[] = [];
  const diagnostics: QADiagnostic[] = [];

  // Track URL usage across slides for reuse detection
  const urlSlideUsage = new Map<string, string[]>();
  const trackUrl = (url: string, slideType: string) => {
    actualImageUrls.add(url);
    const existing = urlSlideUsage.get(url) || [];
    existing.push(slideType);
    urlSlideUsage.set(url, existing);
  };

  // Track scene signature diversity across editorial slides
  const editorialSignatures = new Map<string, string[]>();

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

    // ── Character slide under-fill check ──
    if (slide.type === 'characters') {
      const charCount = slide.characters?.filter(c => c.imageUrl).length || 0;
      if (charCount === 0) {
        diagnostics.push({
          category: 'fill',
          severity: 'error',
          slideType: 'characters',
          message: 'Characters slide has no character images — critically under-filled',
        });
      } else if (charCount < 2) {
        diagnostics.push({
          category: 'fill',
          severity: 'warning',
          slideType: 'characters',
          message: `Characters slide has only ${charCount} character(s) — consider more coverage`,
        });
      }
    }

    // ── Editorial slide content check ──
    if (isEditorialSlide(slide.type)) {
      const imageCount = (slide.imageUrls?.length || 0) + (slide.backgroundImageUrl ? 1 : 0) + (slide.imageUrl ? 1 : 0);
      if (imageCount === 0) {
        diagnostics.push({
          category: 'fill',
          severity: 'warning',
          slideType: slide.type,
          message: `Editorial slide "${slide.type}" has no images`,
        });
      }
    }
  }

  // Detect cross-slide reuse
  for (const [url, slides] of urlSlideUsage.entries()) {
    if (slides.length > 1) {
      reuseWarnings.push(`Image used on ${slides.join(' + ')} (×${slides.length})`);
    }
  }

  // ── Requirement-level diagnostics ──
  if (requirementResults) {
    // Slot-purpose violation detection
    const editorialBlocked = requirementResults.filter(r =>
      isEditorialSlide(r.requirement.slideType) && r.status === 'blocked'
    );
    for (const r of editorialBlocked) {
      diagnostics.push({
        category: 'slot_purpose',
        severity: 'warning',
        slideType: r.requirement.slideType,
        message: `Editorial requirement "${r.requirement.label}" is blocked: ${r.blockingReason || 'unknown reason'}`,
      });
    }

    // Identity-related diagnostics
    const characterReqs = requirementResults.filter(r => r.requirement.pass === 'character');
    const charBlocked = characterReqs.filter(r => r.status === 'blocked');
    if (charBlocked.length > 0) {
      diagnostics.push({
        category: 'identity',
        severity: 'error',
        slideType: 'characters',
        message: `${charBlocked.length} character requirement(s) blocked: ${charBlocked.map(r => r.requirement.label).join(', ')}`,
      });
    }

    // Under-fill detection
    const partialReqs = requirementResults.filter(r => r.status === 'partial');
    for (const r of partialReqs) {
      diagnostics.push({
        category: 'fill',
        severity: 'warning',
        slideType: r.requirement.slideType,
        message: `Requirement "${r.requirement.label}" only partially filled: ${r.generatedCount}/${r.requirement.minRequired}`,
      });
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
    publishable = criticalBlocked === 0 && satisfied >= Math.ceil(requirementResults.length * 0.5);
  } else {
    publishable = unresolvedSlides.length <= 2 && slidesWithImages >= Math.floor(data.slides.length * 0.6);
  }

  // Log diagnostics summary
  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity === 'warning');
  if (errors.length > 0 || warnings.length > 0) {
    console.log(`[QA] ${errors.length} errors, ${warnings.length} warnings`);
    for (const d of diagnostics) {
      console.log(`[QA:${d.severity}:${d.category}] ${d.slideType}: ${d.message}`);
    }
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
    diagnostics,
  };
}
