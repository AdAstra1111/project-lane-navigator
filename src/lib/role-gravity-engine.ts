/**
 * Role Gravity Engine — deterministic scoring for role attractiveness
 * across three packaging modes: awards, commercial, streamer_prestige.
 *
 * No actor names. No corpus references. Pure structural scoring.
 */

export type PackagingMode = 'awards' | 'commercial' | 'streamer_prestige';

export const PACKAGING_MODE_LABELS: Record<PackagingMode, string> = {
  awards: 'Awards / Festival',
  commercial: 'Commercial / Franchise',
  streamer_prestige: 'Streamer Prestige',
};

export interface SubScores {
  presence: number;
  emotional_range: number;
  transformation: number;
  moral_conflict: number;
  agency: number;
  actor_moments: number;
}

export interface ModeWeights {
  presence: number;
  emotional_range: number;
  transformation: number;
  moral_conflict: number;
  agency: number;
  actor_moments: number;
}

const MODE_WEIGHTS: Record<PackagingMode, ModeWeights> = {
  awards: {
    presence: 0.12,
    emotional_range: 0.22,
    transformation: 0.22,
    moral_conflict: 0.18,
    agency: 0.12,
    actor_moments: 0.14,
  },
  commercial: {
    presence: 0.20,
    emotional_range: 0.10,
    transformation: 0.12,
    moral_conflict: 0.08,
    agency: 0.25,
    actor_moments: 0.25,
  },
  streamer_prestige: {
    presence: 0.15,
    emotional_range: 0.18,
    transformation: 0.18,
    moral_conflict: 0.15,
    agency: 0.17,
    actor_moments: 0.17,
  },
};

export interface RoleGravityResult {
  character: string;
  role_type: string;
  sub_scores: SubScores;
  weighted_score: number;
  mode_used: PackagingMode;
  weights_used: ModeWeights;
}

export interface RewriteLever {
  area: string;
  description: string;
}

const AWARDS_LEVERS: RewriteLever[] = [
  { area: 'Moral Dilemma', description: 'Deepen the moral complexity — force the character into irreversible choices with no clean resolution.' },
  { area: 'Transformation', description: 'Amplify irreversible transformation — the character at the end must be unrecognisable from the start.' },
  { area: 'Actor Moments', description: 'Create intimate, contained "actor moments" — silence, restraint, physical vulnerability.' },
  { area: 'Thematic Pressure', description: 'Layer thematic pressure so every scene tests the protagonist\'s core belief.' },
];

const COMMERCIAL_LEVERS: RewriteLever[] = [
  { area: 'Agency', description: 'Make the protagonist proactive — every act break should show them choosing to escalate, not react.' },
  { area: 'Goal Clarity', description: 'Sharpen goal/obstacle clarity — audiences must know what the hero wants within 10 minutes.' },
  { area: 'Set-Pieces', description: 'Build showcase set-piece scenes that work as trailer moments and demonstrate star power.' },
  { area: 'Iconic Hook', description: 'Create a signature moment or line that defines the character and franchise potential.' },
];

const STREAMER_LEVERS: RewriteLever[] = [
  { area: 'Binge Propulsion', description: 'Engineer cliffhanger density and micro-mysteries that prevent viewer drop-off.' },
  { area: 'Relationship Engines', description: 'Build relationship dynamics that generate conflict organically across episodes.' },
  { area: 'Layered Reveals', description: 'Structure reveals in layers — each one recontextualises what came before.' },
  { area: 'Contained Intensity', description: 'Balance contained intensity with character depth — interior worlds drive exterior action.' },
];

const MODE_LEVERS: Record<PackagingMode, RewriteLever[]> = {
  awards: AWARDS_LEVERS,
  commercial: COMMERCIAL_LEVERS,
  streamer_prestige: STREAMER_LEVERS,
};

/**
 * Compute role gravity score given sub-scores and packaging mode.
 * Sub-scores are 0-10 integers. Returns weighted score 0-10.
 */
export function computeRoleGravity(
  character: string,
  roleType: string,
  subScores: SubScores,
  mode: PackagingMode,
): RoleGravityResult {
  const weights = MODE_WEIGHTS[mode];

  const weighted =
    subScores.presence * weights.presence +
    subScores.emotional_range * weights.emotional_range +
    subScores.transformation * weights.transformation +
    subScores.moral_conflict * weights.moral_conflict +
    subScores.agency * weights.agency +
    subScores.actor_moments * weights.actor_moments;

  // Round to 1 decimal
  const score = Math.round(weighted * 10) / 10;

  return {
    character,
    role_type: roleType,
    sub_scores: subScores,
    weighted_score: Math.min(10, Math.max(0, score)),
    mode_used: mode,
    weights_used: weights,
  };
}

/**
 * Get the rewrite levers for a given packaging mode.
 */
export function getRewriteLevers(mode: PackagingMode): RewriteLever[] {
  return MODE_LEVERS[mode];
}

/**
 * Get the finance assumption multipliers for a packaging mode.
 * Returns relative indicators — NOT dollar amounts.
 */
export function getFinanceMultipliers(mode: PackagingMode): Record<string, 'low' | 'medium' | 'high'> {
  switch (mode) {
    case 'awards':
      return {
        presales_uplift: 'low',
        brand_value_uplift: 'high',
        financing_speed: 'low',
        casting_breadth: 'medium',
        buyer_interest: 'medium',
        series_viability: 'low',
      };
    case 'commercial':
      return {
        presales_uplift: 'high',
        brand_value_uplift: 'low',
        financing_speed: 'high',
        casting_breadth: 'high',
        buyer_interest: 'medium',
        series_viability: 'medium',
      };
    case 'streamer_prestige':
      return {
        presales_uplift: 'medium',
        brand_value_uplift: 'medium',
        financing_speed: 'medium',
        casting_breadth: 'medium',
        buyer_interest: 'high',
        series_viability: 'high',
      };
  }
}
