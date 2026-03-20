/**
 * Vertical Drama Compliance — Single canonical source of truth for
 * whether an image is "strict vertical compliant" for vertical-drama projects.
 *
 * THREE classifications (not two):
 *   - strict_vertical_compliant: true 9:16 (h/w ratio ≥ 1.65)
 *   - portrait_only: portrait but not 9:16 (h/w ≥ 1.0 but < 1.65)
 *   - non_compliant: landscape or square-ish (h/w < 1.0)
 *
 * STRICT RULE: For non-identity VD slots, ONLY strict_vertical_compliant wins.
 * No inference-based passing. No "assumed compliant". Measured truth only.
 *
 * Used by: scoring, selection, attachment, download, UI badges, rebuild reporting.
 */

import { SHOT_ASPECT_RATIO, type AspectRatio } from './requiredVisualSet';
import { isVerticalDrama as checkVerticalDrama } from '@/lib/format-helpers';

// ── Strict Vertical Aspect Contract ──────────────────────────────────────────

/**
 * Identity slots that are allowed controlled portrait exceptions.
 * These use their canonical aspect ratio (1:1 for headshot, 3:4 for profile, 2:3 for full_body)
 * because identity references need specific framing for face/body matching.
 * All other slots MUST be 9:16 in vertical-drama mode.
 */
export const VERTICAL_IDENTITY_EXCEPTIONS: Record<string, AspectRatio> = {
  identity_headshot: '1:1',    // Neutral face reference — needs square framing
  identity_profile: '3:4',    // Side profile — needs portrait-tall
  identity_full_body: '2:3',  // Full body reference — needs tall portrait
};

/** All non-identity slots in vertical drama MUST be 9:16 */
export const VERTICAL_STRICT_ASPECT: AspectRatio = '9:16';

// ── Classification Types ─────────────────────────────────────────────────────

export type VerticalComplianceLevel = 'strict_vertical_compliant' | 'portrait_only' | 'non_compliant';

export type DimensionSource = 'measured' | 'requested_fallback' | 'inferred' | 'unknown';

export interface VerticalComplianceResult {
  /** The compliance classification */
  level: VerticalComplianceLevel;
  /** Whether this image can win a slot in vertical-drama mode */
  eligibleForWinnerSelection: boolean;
  /** Expected aspect ratio for this slot */
  expectedAspectRatio: AspectRatio;
  /** Actual aspect ratio (computed from pixels) */
  actualAspectRatio: string;
  /** h/w ratio if pixels available */
  actualRatio: number | null;
  /** Whether this is an identity exception slot */
  isIdentityException: boolean;
  /** Whether dimensions are from measurement or inference */
  dimensionSource: DimensionSource;
  /** Human-readable reason */
  reason: string;
}

// ── Core Compliance Function ─────────────────────────────────────────────────

/**
 * Classify an image's vertical compliance for a specific slot.
 * This is THE canonical evaluator — all scoring, selection, attachment,
 * and download logic must use this function.
 *
 * STRICT POLICY: For non-identity VD slots, images without measured
 * dimensions are treated as NON-COMPLIANT. No inference-based passing.
 */
export function classifyVerticalCompliance(
  image: {
    width?: number | null;
    height?: number | null;
    shot_type?: string | null;
    generation_purpose?: string | null;
  },
  slotShotType: string,
  projectFormat: string,
  projectLane?: string,
): VerticalComplianceResult {
  const isVD = checkVerticalDrama(projectFormat) || projectLane === 'vertical_drama';

  // Determine expected aspect ratio for this slot
  const isIdentityException = slotShotType in VERTICAL_IDENTITY_EXCEPTIONS;
  const expectedAspectRatio: AspectRatio = isVD
    ? (isIdentityException ? VERTICAL_IDENTITY_EXCEPTIONS[slotShotType] : VERTICAL_STRICT_ASPECT)
    : (SHOT_ASPECT_RATIO[slotShotType] || '16:9');

  // If not vertical drama, everything is compliant
  if (!isVD) {
    return {
      level: 'strict_vertical_compliant',
      eligibleForWinnerSelection: true,
      expectedAspectRatio,
      actualAspectRatio: 'n/a (non-VD)',
      actualRatio: null,
      isIdentityException: false,
      dimensionSource: 'unknown',
      reason: 'Non-vertical-drama project — all aspects valid',
    };
  }

  const w = image.width;
  const h = image.height;

  // ── Pixel-based classification (ONLY authoritative source) ──
  if (w && h && w > 0 && h > 0) {
    const ratio = h / w;
    const actualAR = `${w}:${h} (${ratio.toFixed(2)})`;

    // For identity exceptions, check against the exception AR
    if (isIdentityException) {
      const [ew, eh] = expectedAspectRatio.split(':').map(Number);
      const expectedRatio = eh / ew;
      const diff = Math.abs(ratio - expectedRatio);
      if (diff < 0.15) {
        return {
          level: 'strict_vertical_compliant',
          eligibleForWinnerSelection: true,
          expectedAspectRatio,
          actualAspectRatio: actualAR,
          actualRatio: ratio,
          isIdentityException: true,
          dimensionSource: 'measured',
          reason: `Identity exception slot "${slotShotType}" — matches expected ${expectedAspectRatio}`,
        };
      }
      // Even if not matching expected, portrait is OK for identity
      if (ratio >= 1.0) {
        return {
          level: 'portrait_only',
          eligibleForWinnerSelection: true, // identity exceptions allow portrait
          expectedAspectRatio,
          actualAspectRatio: actualAR,
          actualRatio: ratio,
          isIdentityException: true,
          dimensionSource: 'measured',
          reason: `Identity exception slot — portrait but not exact ${expectedAspectRatio}`,
        };
      }
    }

    // For strict 9:16 slots — 9:16 = h/w ratio of 1.778
    if (ratio >= 1.65) {
      return {
        level: 'strict_vertical_compliant',
        eligibleForWinnerSelection: true,
        expectedAspectRatio,
        actualAspectRatio: actualAR,
        actualRatio: ratio,
        isIdentityException,
        dimensionSource: 'measured',
        reason: `True vertical (h/w=${ratio.toFixed(2)} ≥ 1.65)`,
      };
    }

    if (ratio >= 1.0) {
      return {
        level: 'portrait_only',
        eligibleForWinnerSelection: false,
        expectedAspectRatio,
        actualAspectRatio: actualAR,
        actualRatio: ratio,
        isIdentityException,
        dimensionSource: 'measured',
        reason: `Portrait but not strict vertical (h/w=${ratio.toFixed(2)} < 1.65) — NOT eligible in VD`,
      };
    }

    return {
      level: 'non_compliant',
      eligibleForWinnerSelection: false,
      expectedAspectRatio,
      actualAspectRatio: actualAR,
      actualRatio: ratio,
      isIdentityException,
      dimensionSource: 'measured',
      reason: `Landscape (h/w=${ratio.toFixed(2)}) — NOT eligible in VD`,
    };
  }

  // ── No pixel data: STRICT POLICY — NOT eligible for VD winner selection ──
  // We cannot verify compliance without measured dimensions.
  // Identity exception slots with matching shot_type get a narrow pass
  // since their framing is known and controlled, but strict slots do not.
  if (isIdentityException) {
    const shotType = (image.shot_type || '').toLowerCase();
    if (shotType === slotShotType) {
      return {
        level: 'portrait_only',
        eligibleForWinnerSelection: true, // identity exception — trusted shot type
        expectedAspectRatio,
        actualAspectRatio: `inferred:${shotType}`,
        actualRatio: null,
        isIdentityException: true,
        dimensionSource: 'inferred',
        reason: `Identity exception — shot_type "${shotType}" matches slot, no dims but identity allowed`,
      };
    }
  }

  // No measured dimensions + strict VD slot = NOT eligible
  return {
    level: 'non_compliant',
    eligibleForWinnerSelection: false,
    expectedAspectRatio,
    actualAspectRatio: 'unknown (no measured dimensions)',
    actualRatio: null,
    isIdentityException,
    dimensionSource: 'unknown',
    reason: 'No measured dimensions available — NOT eligible for VD winner selection (strict policy)',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if a project is vertical drama from format + lane */
export function isProjectVerticalDrama(format: string, lane?: string): boolean {
  return checkVerticalDrama(format) || lane === 'vertical_drama';
}

/** Get the required aspect ratio for a slot in a given project context */
export function getSlotRequiredAspect(slotShotType: string, isVD: boolean): AspectRatio {
  if (!isVD) return SHOT_ASPECT_RATIO[slotShotType] || '16:9';
  if (slotShotType in VERTICAL_IDENTITY_EXCEPTIONS) return VERTICAL_IDENTITY_EXCEPTIONS[slotShotType];
  return VERTICAL_STRICT_ASPECT;
}

/** Get the required pixel dimensions for a slot in vertical-drama mode */
export function getSlotRequiredDimensions(slotShotType: string, isVD: boolean): { width: number; height: number; aspectRatio: AspectRatio } {
  const ar = getSlotRequiredAspect(slotShotType, isVD);
  const DIMS: Record<string, { width: number; height: number }> = {
    '1:1': { width: 1024, height: 1024 },
    '2:3': { width: 832, height: 1248 },
    '3:2': { width: 1248, height: 832 },
    '3:4': { width: 896, height: 1152 },
    '4:3': { width: 1152, height: 896 },
    '9:16': { width: 720, height: 1280 },
    '16:9': { width: 1280, height: 720 },
  };
  return { ...(DIMS[ar] || { width: 720, height: 1280 }), aspectRatio: ar };
}

/**
 * Compliance gate for attachment — call before setting is_primary.
 * Returns { allowed, reason }. If not allowed, do NOT attach.
 */
export function complianceGateForAttachment(
  image: { width?: number | null; height?: number | null; shot_type?: string | null; generation_purpose?: string | null },
  slotShotType: string,
  projectFormat: string,
  projectLane?: string,
): { allowed: boolean; reason: string; compliance: VerticalComplianceResult } {
  const compliance = classifyVerticalCompliance(image, slotShotType, projectFormat, projectLane);
  return {
    allowed: compliance.eligibleForWinnerSelection,
    reason: compliance.reason,
    compliance,
  };
}
