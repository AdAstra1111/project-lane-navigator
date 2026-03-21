/**
 * LookBook Gap Analyzer — Analyzes a built LookBook to identify missing or weak image slots.
 * 
 * Consumes a built LookBookData + layout family definitions to produce a structured
 * gap manifest. Does NOT duplicate resolveCanonImages logic — instead inspects the
 * *output* of a build to determine what's missing or improvable.
 */
import type { LookBookData, SlideContent, SlideComposition } from '@/lib/lookbook/types';
import type { LayoutFamilyKey, SlotBlueprint } from '@/lib/lookbook/lookbookLayoutFamilies';
import { LAYOUT_FAMILIES } from '@/lib/lookbook/lookbookLayoutFamilies';
import { classifyOrientation, type Orientation } from './orientationUtils';
import type { RequiredImageSpec } from './lookbookLayoutImageSpecs';
import { LAYOUT_IMAGE_SPECS } from './lookbookLayoutImageSpecs';

// ── Gap Types ────────────────────────────────────────────────────────────────

export type GapSeverity = 'missing' | 'weak' | 'improvable';
export type SubjectType = 'character' | 'world' | 'atmosphere' | 'moment' | 'texture' | 'poster' | 'generic';

export interface ImageGap {
  /** Which slide this gap belongs to */
  slideId: string;
  slideType: string;
  /** Slot identifier within the layout */
  slotId: string;
  /** Required shot type for this slot */
  shotType: string;
  /** Required orientation */
  orientation: Orientation | 'any';
  /** What kind of subject is needed */
  subjectType: SubjectType;
  /** How bad is this gap */
  severity: GapSeverity;
  /** Human-readable reason */
  reason: string;
  /** Priority for auto-fill (lower = more urgent) */
  priority: number;
  /** Whether an existing archived/candidate image could potentially fill this */
  canReuse: boolean;
  /** Whether new generation is needed */
  needsGeneration: boolean;
}

export interface GapAnalysisResult {
  /** All identified gaps */
  gaps: ImageGap[];
  /** Summary counts */
  totalSlots: number;
  filledSlots: number;
  missingSlots: number;
  weakSlots: number;
  /** Overall quality score 0–100 */
  qualityScore: number;
  /** Whether the deck is publishable as-is */
  publishable: boolean;
}

// ── Slide Type → Subject Type Mapping ────────────────────────────────────────

const SLIDE_SUBJECT_TYPE: Record<string, SubjectType> = {
  cover: 'poster',
  creative_statement: 'atmosphere',
  world: 'world',
  key_moments: 'moment',
  characters: 'character',
  visual_language: 'texture',
  themes: 'atmosphere',
  story_engine: 'moment',
  comparables: 'atmosphere',
  closing: 'poster',
};

// ── Analyzer ─────────────────────────────────────────────────────────────────

/**
 * Analyze a built LookBook for image gaps.
 * Uses the layout family slot definitions to determine what's needed vs what's present.
 */
export function analyzeLookBookGaps(data: LookBookData): GapAnalysisResult {
  const gaps: ImageGap[] = [];
  let totalSlots = 0;
  let filledSlots = 0;

  for (const slide of data.slides) {
    const familyKey = (slide.layoutFamilyEffective || slide.layoutFamily || 'landscape_standard') as LayoutFamilyKey;
    const family = LAYOUT_FAMILIES[familyKey];
    if (!family) continue;

    const specs = LAYOUT_IMAGE_SPECS[familyKey];
    const subjectType = SLIDE_SUBJECT_TYPE[slide.type] || 'generic';

    // Check each slot in the layout family
    for (const slot of family.slots) {
      totalSlots++;
      const spec = specs?.find(s => s.slotId === slot.slotKey);

      // Check if this slot has an assigned image
      const assignment = slide.slotAssignments?.find(a => a.slotKey === slot.slotKey);
      const hasImage = assignment?.assignedUrl != null;

      if (hasImage) {
        filledSlots++;

        // Check orientation match quality
        if (assignment && !assignment.orientationMatch && slot.expectedOrientation !== 'any') {
          gaps.push({
            slideId: slide.slide_id,
            slideType: slide.type,
            slotId: slot.slotKey,
            shotType: spec?.shotType || slot.intent,
            orientation: slot.expectedOrientation as Orientation,
            subjectType: (spec?.subjectType as SubjectType) || subjectType,
            severity: 'weak',
            reason: `Image orientation mismatch: expected ${slot.expectedOrientation}, got ${assignment.assignedOrientation}`,
            priority: 30,
            canReuse: true,
            needsGeneration: false,
          });
        }
        continue;
      }

      // Slot is empty
      if (!slot.optional) {
        gaps.push({
          slideId: slide.slide_id,
          slideType: slide.type,
          slotId: slot.slotKey,
          shotType: spec?.shotType || 'wide',
          orientation: slot.expectedOrientation === 'any' ? 'landscape' : slot.expectedOrientation as Orientation,
          subjectType: (spec?.subjectType as SubjectType) || subjectType,
          severity: 'missing',
          reason: `Required slot "${slot.slotKey}" has no image`,
          priority: 10,
          canReuse: false,
          needsGeneration: true,
        });
      } else {
        gaps.push({
          slideId: slide.slide_id,
          slideType: slide.type,
          slotId: slot.slotKey,
          shotType: spec?.shotType || slot.intent,
          orientation: slot.expectedOrientation === 'any' ? 'landscape' : slot.expectedOrientation as Orientation,
          subjectType: (spec?.subjectType as SubjectType) || subjectType,
          severity: 'improvable',
          reason: `Optional slot "${slot.slotKey}" is empty — filling it would improve quality`,
          priority: 50,
          canReuse: true,
          needsGeneration: true,
        });
      }
    }

    // Check background image
    const needsBg = slide.composition !== 'gradient_only' && slide.composition !== 'character_feature';
    if (needsBg && !slide.backgroundImageUrl && slide.type !== 'characters') {
      gaps.push({
        slideId: slide.slide_id,
        slideType: slide.type,
        slotId: 'background',
        shotType: 'atmospheric',
        orientation: 'landscape',
        subjectType,
        severity: slide.composition === 'full_bleed_hero' ? 'missing' : 'weak',
        reason: 'No background image — slide falls back to gradient',
        priority: slide.type === 'cover' || slide.type === 'closing' ? 5 : 20,
        canReuse: true,
        needsGeneration: true,
      });
    }
  }

  const missingSlots = gaps.filter(g => g.severity === 'missing').length;
  const weakSlots = gaps.filter(g => g.severity === 'weak').length;
  const qualityScore = totalSlots > 0
    ? Math.round(((filledSlots - weakSlots * 0.3) / totalSlots) * 100)
    : 0;

  return {
    gaps: gaps.sort((a, b) => a.priority - b.priority),
    totalSlots,
    filledSlots,
    missingSlots,
    weakSlots,
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
    publishable: missingSlots === 0 && qualityScore >= 60,
  };
}
