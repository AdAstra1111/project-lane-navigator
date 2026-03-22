/**
 * compositionRules — Deterministic cinematic composition enforcement for lookbook slots.
 *
 * Maps slot/section types to explicit compositional parameters.
 * Used by both generation (prompt injection) and selection (scoring).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CompositionBalance =
  | 'centered'
  | 'rule_of_thirds'
  | 'symmetrical'
  | 'environment_weighted';

export type SubjectScale =
  | 'dominant'
  | 'balanced'
  | 'small_in_frame';

export type VisualDensity =
  | 'minimal'
  | 'balanced'
  | 'dense';

export interface CompositionRule {
  balance: CompositionBalance;
  subject_scale: SubjectScale;
  visual_density: VisualDensity;
  horizon_bias?: 'high' | 'mid' | 'low';
  headroom_bias?: 'tight' | 'balanced' | 'airy';
  negative_space_bias?: 'low' | 'medium' | 'high';
}

// ── Slot → Composition Map ───────────────────────────────────────────────────

const SLOT_COMPOSITION_MAP: Record<string, CompositionRule> = {
  // Character slides: subject-dominant, intimate framing
  characters: {
    balance: 'rule_of_thirds',
    subject_scale: 'dominant',
    visual_density: 'balanced',
    horizon_bias: 'mid',
    headroom_bias: 'tight',
    negative_space_bias: 'low',
  },

  // World/location slides: environment-weighted, spatial
  world: {
    balance: 'environment_weighted',
    subject_scale: 'small_in_frame',
    visual_density: 'balanced',
    horizon_bias: 'low',
    headroom_bias: 'airy',
    negative_space_bias: 'high',
  },

  // Key moments: balanced dramatic staging
  key_moments: {
    balance: 'rule_of_thirds',
    subject_scale: 'balanced',
    visual_density: 'balanced',
    horizon_bias: 'mid',
    headroom_bias: 'balanced',
    negative_space_bias: 'medium',
  },

  // Story engine: relational tension, balanced
  story_engine: {
    balance: 'rule_of_thirds',
    subject_scale: 'balanced',
    visual_density: 'balanced',
    horizon_bias: 'mid',
    headroom_bias: 'balanced',
    negative_space_bias: 'medium',
  },

  // Visual language: texture/material, denser, formal
  visual_language: {
    balance: 'centered',
    subject_scale: 'dominant',
    visual_density: 'dense',
    horizon_bias: 'mid',
    headroom_bias: 'tight',
    negative_space_bias: 'low',
  },

  // Themes: atmospheric, spacious
  themes: {
    balance: 'environment_weighted',
    subject_scale: 'small_in_frame',
    visual_density: 'minimal',
    horizon_bias: 'low',
    headroom_bias: 'airy',
    negative_space_bias: 'high',
  },

  // Cover: iconic, intentional, cinematic hero
  cover: {
    balance: 'centered',
    subject_scale: 'dominant',
    visual_density: 'balanced',
    horizon_bias: 'mid',
    headroom_bias: 'balanced',
    negative_space_bias: 'medium',
  },

  // Closing: bookend, atmospheric
  closing: {
    balance: 'symmetrical',
    subject_scale: 'small_in_frame',
    visual_density: 'minimal',
    horizon_bias: 'low',
    headroom_bias: 'airy',
    negative_space_bias: 'high',
  },

  // Creative statement: atmospheric backdrop
  creative_statement: {
    balance: 'environment_weighted',
    subject_scale: 'small_in_frame',
    visual_density: 'minimal',
    horizon_bias: 'low',
    headroom_bias: 'airy',
    negative_space_bias: 'high',
  },

  // Poster directions: iconic key art
  poster_directions: {
    balance: 'centered',
    subject_scale: 'dominant',
    visual_density: 'balanced',
    horizon_bias: 'mid',
    headroom_bias: 'tight',
    negative_space_bias: 'medium',
  },

  // Comparables
  comparables: {
    balance: 'centered',
    subject_scale: 'balanced',
    visual_density: 'balanced',
    horizon_bias: 'mid',
    headroom_bias: 'balanced',
    negative_space_bias: 'medium',
  },
};

const DEFAULT_COMPOSITION: CompositionRule = {
  balance: 'rule_of_thirds',
  subject_scale: 'balanced',
  visual_density: 'balanced',
  horizon_bias: 'mid',
  headroom_bias: 'balanced',
  negative_space_bias: 'medium',
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the canonical composition rule for a lookbook slot/section type.
 * Always returns a deterministic result.
 */
export function resolveCompositionRuleForLookbookSlot(slotKey: string): CompositionRule {
  return SLOT_COMPOSITION_MAP[slotKey] || DEFAULT_COMPOSITION;
}

/**
 * Serialize a composition rule into a prompt-injectable directive.
 */
export function serializeCompositionRule(rule: CompositionRule): string {
  const BALANCE_MAP: Record<CompositionBalance, string> = {
    centered: 'Centered composition — subject anchored in the visual center, symmetrical weight',
    rule_of_thirds: 'Rule-of-thirds composition — subject placed at power points, dynamic balance',
    symmetrical: 'Symmetrical composition — formal, architectural balance, mirror-weight left/right',
    environment_weighted: 'Environment-weighted composition — space dominates, subject contextualized within geography',
  };
  const SCALE_MAP: Record<SubjectScale, string> = {
    dominant: 'Subject scale: dominant — fills 40-70% of frame, intimate and impactful',
    balanced: 'Subject scale: balanced — occupies 20-40% of frame, equal weight with environment',
    small_in_frame: 'Subject scale: small in frame — occupies under 20%, environment tells the story',
  };
  const DENSITY_MAP: Record<VisualDensity, string> = {
    minimal: 'Visual density: minimal — clean negative space, few compositional elements, breathing room',
    balanced: 'Visual density: balanced — moderate detail, clear focal hierarchy without clutter',
    dense: 'Visual density: dense — rich detail, layered textures, information-dense frame',
  };

  const lines = [
    '[COMPOSITION RULE — CINEMATIC FRAMING DIRECTIVE]',
    BALANCE_MAP[rule.balance],
    SCALE_MAP[rule.subject_scale],
    DENSITY_MAP[rule.visual_density],
  ];

  if (rule.horizon_bias) {
    const hMap: Record<string, string> = {
      high: 'Horizon line: high placement — ground/subject dominates, sky minimal',
      mid: 'Horizon line: mid placement — balanced ground and sky weight',
      low: 'Horizon line: low placement — sky/ceiling dominant, expansive overhead space',
    };
    lines.push(hMap[rule.horizon_bias]);
  }

  if (rule.headroom_bias) {
    const hrMap: Record<string, string> = {
      tight: 'Headroom: tight — minimal space above subject, intimate and close',
      balanced: 'Headroom: balanced — comfortable breathing space above subject',
      airy: 'Headroom: airy — generous space above, expansive and atmospheric',
    };
    lines.push(hrMap[rule.headroom_bias]);
  }

  if (rule.negative_space_bias) {
    const nsMap: Record<string, string> = {
      low: 'Negative space: low — frame is filled with subject and detail',
      medium: 'Negative space: medium — purposeful empty areas for visual breathing',
      high: 'Negative space: high — significant empty space, isolation or grandeur',
    };
    lines.push(nsMap[rule.negative_space_bias]);
  }

  return lines.join('\n');
}

/**
 * Compute a simple deterministic hash of a composition rule for provenance.
 */
export function hashCompositionRule(rule: CompositionRule): string {
  return `${rule.balance}:${rule.subject_scale}:${rule.visual_density}:${rule.horizon_bias || '-'}:${rule.headroom_bias || '-'}:${rule.negative_space_bias || '-'}`;
}
