/**
 * editorialFlow — Deterministic editorial sequencing and energy curve for lookbook.
 *
 * Defines canonical slide ordering and intensity weighting.
 * Selection can bias toward images that match the editorial energy of their position.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface EditorialSlidePosition {
  slideType: string;
  position: number;        // 0-based index in editorial sequence
  intensity: number;       // 0–1 editorial energy level
  phase: 'opening' | 'rising' | 'peak' | 'falling' | 'closing';
}

export interface EditorialFlowSequence {
  positions: EditorialSlidePosition[];
  peakSlideType: string;
}

// ── Canonical Editorial Sequence ─────────────────────────────────────────────
// This defines the narrative arc of the lookbook as a visual document.
//
// Energy curve:
// cover(0.7) → creative_statement(0.3) → world(0.4) → characters(0.5)
// → key_moments(0.9) → story_engine(0.8) → themes(0.5)
// → visual_language(0.4) → poster_directions(0.85) → comparables(0.2) → closing(0.6)

const CANONICAL_SEQUENCE: Array<{ slideType: string; intensity: number; phase: EditorialSlidePosition['phase'] }> = [
  { slideType: 'cover',              intensity: 0.70, phase: 'opening' },
  { slideType: 'creative_statement', intensity: 0.30, phase: 'opening' },
  { slideType: 'overview',           intensity: 0.40, phase: 'rising' },
  { slideType: 'world',              intensity: 0.40, phase: 'rising' },
  { slideType: 'characters',         intensity: 0.50, phase: 'rising' },
  { slideType: 'key_moments',        intensity: 0.90, phase: 'peak' },
  { slideType: 'story_engine',       intensity: 0.80, phase: 'peak' },
  { slideType: 'themes',             intensity: 0.50, phase: 'falling' },
  { slideType: 'visual_language',    intensity: 0.40, phase: 'falling' },
  { slideType: 'poster_directions',  intensity: 0.85, phase: 'peak' },
  { slideType: 'comparables',        intensity: 0.20, phase: 'falling' },
  { slideType: 'closing',            intensity: 0.60, phase: 'closing' },
];

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Build the canonical editorial flow sequence.
 * Returns position, intensity, and phase for each slide type.
 */
export function buildEditorialFlow(): EditorialFlowSequence {
  const positions: EditorialSlidePosition[] = CANONICAL_SEQUENCE.map((entry, idx) => ({
    slideType: entry.slideType,
    position: idx,
    intensity: entry.intensity,
    phase: entry.phase,
  }));

  return {
    positions,
    peakSlideType: 'key_moments',
  };
}

/**
 * Get editorial intensity for a specific slide type.
 * Returns 0.5 as default for unknown slide types.
 */
export function getEditorialIntensity(slideType: string): number {
  const entry = CANONICAL_SEQUENCE.find(e => e.slideType === slideType);
  return entry?.intensity ?? 0.5;
}

/**
 * Get editorial phase for a specific slide type.
 */
export function getEditorialPhase(slideType: string): EditorialSlidePosition['phase'] {
  const entry = CANONICAL_SEQUENCE.find(e => e.slideType === slideType);
  return entry?.phase ?? 'rising';
}

/**
 * Compute editorial intensity score for selection scoring.
 * Images with higher visual energy should score better on high-intensity slides,
 * and more atmospheric/quiet images should score better on low-intensity slides.
 *
 * Uses available metadata as proxy for image energy:
 * - shot_type: close_up/emotional_variant = high energy; wide/atmospheric = low energy
 * - asset_group: key_moment = high; world/visual_language = low
 *
 * Returns 0–100.
 */
export function scoreEditorialFit(
  slideType: string,
  shotType: string | null,
  assetGroup: string | null,
): number {
  const targetIntensity = getEditorialIntensity(slideType);
  let imageEnergy = 0.5; // neutral default

  // Infer image energy from shot type
  const HIGH_ENERGY_SHOTS = ['close_up', 'emotional_variant', 'tableau', 'over_shoulder'];
  const LOW_ENERGY_SHOTS = ['wide', 'atmospheric', 'detail', 'time_variant', 'texture_ref', 'lighting_ref'];
  const MID_ENERGY_SHOTS = ['medium', 'full_body', 'profile'];

  if (shotType) {
    if (HIGH_ENERGY_SHOTS.includes(shotType)) imageEnergy = 0.8;
    else if (LOW_ENERGY_SHOTS.includes(shotType)) imageEnergy = 0.3;
    else if (MID_ENERGY_SHOTS.includes(shotType)) imageEnergy = 0.5;
  }

  // Adjust by asset group
  if (assetGroup === 'key_moment') imageEnergy = Math.min(1, imageEnergy + 0.1);
  if (assetGroup === 'world') imageEnergy = Math.max(0, imageEnergy - 0.1);
  if (assetGroup === 'visual_language') imageEnergy = Math.max(0, imageEnergy - 0.15);

  // Score = how well image energy matches target intensity
  // Perfect match = 100, maximum mismatch = 0
  const diff = Math.abs(imageEnergy - targetIntensity);
  return Math.round(Math.max(0, 100 - (diff * 150)));
}
