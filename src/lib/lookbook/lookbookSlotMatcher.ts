/**
 * lookbookSlotMatcher — Deterministic slot-to-image assignment
 * that respects slot orientation expectations.
 *
 * Consumes a ResolvedLayoutFamily and available images,
 * returns ordered slot assignments the renderer can trust.
 */
import { classifyOrientation, type Orientation } from '@/lib/images/orientationUtils';
import type { SlotBlueprint, ResolvedLayoutFamily } from './lookbookLayoutFamilies';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ImageCandidate {
  url: string;
  width?: number | null;
  height?: number | null;
  /** Optional priority from upstream ranking (lower = better) */
  rankIndex?: number;
}

export interface SlotAssignment {
  slotKey: string;
  expectedOrientation: Orientation | 'any';
  intent: string;
  assignedUrl: string | null;
  assignedOrientation: Orientation;
  orientationMatch: boolean;
}

export interface SlotMatchResult {
  familyKey: string;
  assignments: SlotAssignment[];
  unassignedImages: ImageCandidate[];
  /** How many required slots got orientation-matched images */
  matchQuality: number;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function orientationScore(actual: Orientation, expected: Orientation | 'any'): number {
  if (expected === 'any') return 1;
  if (actual === expected) return 3;
  // Portrait into landscape slot or vice versa — penalty but not zero
  if (actual === 'square') return 1;
  return 0;
}

// ── Matcher ─────────────────────────────────────────────────────────────────

/**
 * Assign images to slots deterministically.
 * - Slots are filled in priority order (sizeWeight desc, then declaration order)
 * - Each slot prefers the best orientation-matched unassigned image
 * - Images are consumed once assigned (no duplication)
 */
export function matchImagesToSlots(
  layout: ResolvedLayoutFamily,
  candidates: ImageCandidate[],
): SlotMatchResult {
  const slots = [...layout.definition.slots].sort((a, b) => b.sizeWeight - a.sizeWeight);
  const available = candidates.map((c, i) => ({
    ...c,
    orientation: classifyOrientation(c.width, c.height),
    used: false,
    originalIndex: c.rankIndex ?? i,
  }));

  const assignments: SlotAssignment[] = [];
  let matchCount = 0;

  for (const slot of slots) {
    // Score all unused candidates for this slot
    const scored = available
      .filter(a => !a.used)
      .map(a => ({
        candidate: a,
        score: orientationScore(a.orientation, slot.expectedOrientation) * 10 + (100 - a.originalIndex),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (best && (best.score > 0 || !slot.optional)) {
      best.candidate.used = true;
      const isMatch = slot.expectedOrientation === 'any' || best.candidate.orientation === slot.expectedOrientation;
      if (isMatch) matchCount++;

      assignments.push({
        slotKey: slot.slotKey,
        expectedOrientation: slot.expectedOrientation,
        intent: slot.intent,
        assignedUrl: best.candidate.url,
        assignedOrientation: best.candidate.orientation,
        orientationMatch: isMatch,
      });
    } else if (slot.optional) {
      assignments.push({
        slotKey: slot.slotKey,
        expectedOrientation: slot.expectedOrientation,
        intent: slot.intent,
        assignedUrl: null,
        assignedOrientation: 'unknown',
        orientationMatch: false,
      });
    }
  }

  const totalRequired = slots.filter(s => !s.optional).length;

  return {
    familyKey: layout.familyKey,
    assignments,
    unassignedImages: available.filter(a => !a.used).map(a => ({
      url: a.url,
      width: a.width,
      height: a.height,
      rankIndex: a.originalIndex,
    })),
    matchQuality: totalRequired > 0 ? matchCount / totalRequired : 1,
  };
}
