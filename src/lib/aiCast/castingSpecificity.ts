/**
 * castingSpecificity — Casting Specificity Layer
 *
 * Computes a deterministic specificity profile for a character's casting brief,
 * classifying each identity dimension as known / inferred / missing.
 *
 * When specificity is low, search should intentionally broaden to produce
 * diverse results rather than falsely narrow on sparse data.
 *
 * DETERMINISTIC. READ-ONLY. No LLM.
 */

import type { CastingBrief, ExtractionSufficiency } from './castingBriefResolver';

// ── Types ────────────────────────────────────────────────────────────────────

export type DimensionStatus = 'known' | 'inferred' | 'missing';

export interface DimensionProfile {
  status: DimensionStatus;
  source: string;
}

export interface CastingSpecificityProfile {
  gender: DimensionProfile;
  ethnicity: DimensionProfile;
  age: DimensionProfile;
  physical: DimensionProfile;
  styling: DimensionProfile;
  presence: DimensionProfile;
  specificityScore: number;        // 0–100
  specificityBand: 'low' | 'medium' | 'high';
  recommendedMode: 'exploration' | 'precision';
}

export type CastingMode = 'exploration' | 'precision';

export type ConstraintSource = 'grounded' | 'inferred' | 'directed';

export interface CastingConstraint {
  dimension: string;
  value: string;
  source: ConstraintSource;
}

export interface CastingSearchPlan {
  mode: CastingMode;
  groundedFilters: CastingConstraint[];
  softSignals: CastingConstraint[];
  directedConstraints: CastingConstraint[];
  diversityStrategy: 'wide' | 'balanced' | 'narrow';
  rationale: string;
}

// ── Scoring weights per dimension ────────────────────────────────────────────

const DIMENSION_WEIGHTS: Record<string, number> = {
  gender: 15,
  ethnicity: 15,
  age: 20,
  physical: 30,
  styling: 10,
  presence: 10,
};

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Classify a dimension as known (structured truth), inferred (context-derived),
 * or missing based on extraction sufficiency and brief content.
 */
function classifyDimension(
  hasSignal: boolean,
  briefValue: string | string[] | null | undefined,
  dimensionName: string,
): DimensionProfile {
  if (!hasSignal && !briefValue) {
    return { status: 'missing', source: 'no data in source documents' };
  }

  // Has signal from extraction sufficiency but value may be inferred
  const hasContent = Array.isArray(briefValue)
    ? briefValue.length > 0
    : !!briefValue;

  if (!hasContent) {
    return { status: 'missing', source: 'no data in source documents' };
  }

  // If extraction sufficiency says the signal exists, it's from structured/document sources
  if (hasSignal) {
    return { status: 'known', source: `extracted from project documents` };
  }

  // Signal exists in brief but not flagged in extraction sufficiency = inferred
  return { status: 'inferred', source: `inferred from context` };
}

/**
 * Build a casting specificity profile from a CastingBrief.
 */
export function buildCastingSpecificityProfile(brief: CastingBrief): CastingSpecificityProfile {
  const suff = brief.extraction_sufficiency;

  const gender = classifyDimension(suff.has_gender, brief.gender_presentation, 'gender');
  const ethnicity = classifyDimension(suff.has_ethnicity, brief.ethnicity_or_cultural_appearance, 'ethnicity');
  const age = classifyDimension(suff.has_age, brief.age_hint, 'age');
  const physical = classifyDimension(
    suff.has_physical_description_signals,
    brief.appearance_markers,
    'physical',
  );
  const styling = classifyDimension(suff.has_styling_signals, brief.styling_cues, 'styling');
  const presence = classifyDimension(suff.has_presence_signals, brief.performance_vibe, 'presence');

  // Score: sum weights for known/inferred dimensions
  const dimensions = { gender, ethnicity, age, physical, styling, presence };
  let score = 0;
  for (const [key, profile] of Object.entries(dimensions)) {
    if (profile.status === 'known') {
      score += DIMENSION_WEIGHTS[key] ?? 0;
    } else if (profile.status === 'inferred') {
      score += (DIMENSION_WEIGHTS[key] ?? 0) * 0.5; // inferred = half weight
    }
  }
  const specificityScore = Math.round(Math.min(100, score));

  const specificityBand: 'low' | 'medium' | 'high' =
    specificityScore >= 60 ? 'high' : specificityScore >= 30 ? 'medium' : 'low';

  const recommendedMode: CastingMode =
    specificityBand === 'high' ? 'precision' : 'exploration';

  return {
    gender,
    ethnicity,
    age,
    physical,
    styling,
    presence,
    specificityScore,
    specificityBand,
    recommendedMode,
  };
}

// ── Search Plan Builder ──────────────────────────────────────────────────────

/**
 * Build a search plan from a casting brief and optional user-directed constraints.
 */
export function buildCastingSearchPlan(
  brief: CastingBrief,
  profile: CastingSpecificityProfile,
  directedOverrides?: CastingConstraint[],
): CastingSearchPlan {
  const groundedFilters: CastingConstraint[] = [];
  const softSignals: CastingConstraint[] = [];
  const directedConstraints = directedOverrides || [];

  // Gender
  if (profile.gender.status === 'known' && brief.gender_presentation) {
    groundedFilters.push({ dimension: 'gender', value: brief.gender_presentation, source: 'grounded' });
  } else if (profile.gender.status === 'inferred' && brief.gender_presentation) {
    softSignals.push({ dimension: 'gender', value: brief.gender_presentation, source: 'inferred' });
  }

  // Ethnicity
  if (profile.ethnicity.status === 'known' && brief.ethnicity_or_cultural_appearance) {
    groundedFilters.push({ dimension: 'ethnicity', value: brief.ethnicity_or_cultural_appearance, source: 'grounded' });
  } else if (profile.ethnicity.status === 'inferred' && brief.ethnicity_or_cultural_appearance) {
    softSignals.push({ dimension: 'ethnicity', value: brief.ethnicity_or_cultural_appearance, source: 'inferred' });
  }

  // Age
  if (profile.age.status === 'known' && brief.age_hint) {
    groundedFilters.push({ dimension: 'age', value: brief.age_hint, source: 'grounded' });
  } else if (profile.age.status === 'inferred' && brief.age_hint) {
    softSignals.push({ dimension: 'age', value: brief.age_hint, source: 'inferred' });
  }

  // Physical markers
  for (const marker of brief.appearance_markers) {
    if (profile.physical.status === 'known') {
      groundedFilters.push({ dimension: 'physical', value: marker, source: 'grounded' });
    } else {
      softSignals.push({ dimension: 'physical', value: marker, source: 'inferred' });
    }
  }

  // Presence
  for (const vibe of brief.performance_vibe) {
    softSignals.push({ dimension: 'presence', value: vibe, source: 'inferred' });
  }

  // Styling
  for (const cue of brief.styling_cues) {
    softSignals.push({ dimension: 'styling', value: cue, source: 'inferred' });
  }

  const mode = profile.recommendedMode;
  const diversityStrategy: 'wide' | 'balanced' | 'narrow' =
    profile.specificityBand === 'low' ? 'wide'
    : profile.specificityBand === 'medium' ? 'balanced'
    : 'narrow';

  const rationale = profile.specificityBand === 'low'
    ? 'Limited appearance data in source documents. Search is intentionally broad to show diverse candidates.'
    : profile.specificityBand === 'medium'
    ? 'Partial appearance data available. Search balances grounded filters with diverse results.'
    : 'Rich appearance data available. Search uses precise matching.';

  return {
    mode,
    groundedFilters,
    softSignals,
    directedConstraints,
    diversityStrategy,
    rationale,
  };
}

// ── Display helpers ──────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  gender: 'Gender',
  ethnicity: 'Ethnicity',
  age: 'Age',
  physical: 'Physical',
  styling: 'Styling',
  presence: 'Presence',
};

export function getSpecificityDimensionEntries(profile: CastingSpecificityProfile) {
  return (['gender', 'ethnicity', 'age', 'physical', 'styling', 'presence'] as const).map(key => ({
    key,
    label: DIMENSION_LABELS[key],
    ...profile[key],
  }));
}

export function getSearchBehaviorLabel(band: 'low' | 'medium' | 'high'): string {
  return band === 'low' ? 'Broad' : band === 'medium' ? 'Balanced' : 'Narrow';
}
