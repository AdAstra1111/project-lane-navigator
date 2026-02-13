/**
 * Role Gravity Engine — deterministic scoring for role attractiveness
 * across three packaging modes × three packaging stages.
 *
 * No actor names. No corpus references. Pure structural scoring.
 * Same input ⇒ same output (deterministic).
 */

// ── Types ──────────────────────────────────────────────────────────

export type PackagingMode = 'awards' | 'commercial' | 'streamer_prestige';
export type PackagingStage = 'early_dev' | 'packaging_now' | 'financing_live';

export const PACKAGING_MODE_LABELS: Record<PackagingMode, string> = {
  awards: 'Awards / Festival',
  commercial: 'Commercial / Franchise',
  streamer_prestige: 'Streamer Prestige',
};

export const PACKAGING_STAGE_LABELS: Record<PackagingStage, string> = {
  early_dev: 'Early Development',
  packaging_now: 'Packaging Now',
  financing_live: 'Financing Live',
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

export interface RoleGravityResult {
  character: string;
  role_type: string;
  sub_scores: SubScores;
  weighted_score: number;
  mode_used: PackagingMode;
  stage_used: PackagingStage;
  weights_used: ModeWeights;
}

export interface RewriteLever {
  area: string;
  description: string;
  priority: number; // 1 = highest
}

export interface StageRecommendation {
  heading: string;
  items: string[];
}

// ── Mode Base Weights ──────────────────────────────────────────────

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

// ── Stage Multipliers ──────────────────────────────────────────────

type WeightKey = keyof SubScores;
type StageMultipliers = Record<WeightKey, number>;

const STAGE_MULTIPLIERS: Record<PackagingStage, StageMultipliers> = {
  early_dev: {
    presence: 0.95,
    emotional_range: 1.0,
    transformation: 1.10,
    moral_conflict: 1.10,
    agency: 1.0,
    actor_moments: 0.95,
  },
  packaging_now: {
    presence: 1.10,
    emotional_range: 1.0,
    transformation: 0.95,
    moral_conflict: 1.0,
    agency: 1.0,
    actor_moments: 1.10,
  },
  financing_live: {
    presence: 1.05,
    emotional_range: 1.0,
    transformation: 1.0,
    moral_conflict: 0.95,
    agency: 1.10,
    actor_moments: 1.0,
  },
};

/**
 * Apply stage multipliers to base mode weights and renormalize to sum=1.
 */
function computeFinalWeights(mode: PackagingMode, stage: PackagingStage): ModeWeights {
  const base = MODE_WEIGHTS[mode];
  const mult = STAGE_MULTIPLIERS[stage];
  const keys: WeightKey[] = ['presence', 'emotional_range', 'transformation', 'moral_conflict', 'agency', 'actor_moments'];

  const raw: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) {
    raw[k] = base[k] * mult[k];
    sum += raw[k];
  }

  // Renormalize
  const result: any = {};
  for (const k of keys) {
    result[k] = Math.round((raw[k] / sum) * 10000) / 10000; // 4 decimal precision
  }
  return result as ModeWeights;
}

// ── Rewrite Levers (mode-specific, stage-prioritized) ──────────────

const AWARDS_LEVERS: RewriteLever[] = [
  { area: 'Moral Dilemma', description: 'Deepen the moral complexity — force the character into irreversible choices with no clean resolution.', priority: 1 },
  { area: 'Transformation', description: 'Amplify irreversible transformation — the character at the end must be unrecognisable from the start.', priority: 1 },
  { area: 'Actor Moments', description: 'Create intimate, contained "actor moments" — silence, restraint, physical vulnerability.', priority: 2 },
  { area: 'Thematic Pressure', description: 'Layer thematic pressure and contradiction so every scene tests the protagonist\'s core belief.', priority: 2 },
];

const COMMERCIAL_LEVERS: RewriteLever[] = [
  { area: 'Agency', description: 'Make the protagonist proactive — every act break should show them choosing to escalate, not react.', priority: 1 },
  { area: 'Goal Clarity', description: 'Sharpen goal/obstacle clarity — audiences must know what the hero wants within 10 minutes.', priority: 1 },
  { area: 'Set-Pieces', description: 'Build showcase set-piece scenes that work as trailer moments and demonstrate star power.', priority: 2 },
  { area: 'Iconic Hook', description: 'Create a signature moment or line that defines the character and franchise potential.', priority: 2 },
];

const STREAMER_LEVERS: RewriteLever[] = [
  { area: 'Binge Propulsion', description: 'Engineer cliffhanger density and micro-mysteries that prevent viewer drop-off.', priority: 1 },
  { area: 'Relationship Engines', description: 'Build relationship dynamics that generate conflict organically across episodes.', priority: 1 },
  { area: 'Layered Reveals', description: 'Structure reveals in layers — each one recontextualises what came before.', priority: 2 },
  { area: 'Contained Intensity', description: 'Balance contained intensity with character depth — interior worlds drive exterior action.', priority: 2 },
];

const MODE_LEVERS: Record<PackagingMode, RewriteLever[]> = {
  awards: AWARDS_LEVERS,
  commercial: COMMERCIAL_LEVERS,
  streamer_prestige: STREAMER_LEVERS,
};

/**
 * Stage changes priority ordering of levers:
 * - early_dev: story/arc > moments > presentation
 * - packaging_now: moments/presence > clarity > story polish
 * - financing_live: clarity/risk/budget > moments > deep theme
 */
function prioritizeLevers(levers: RewriteLever[], stage: PackagingStage): RewriteLever[] {
  const sorted = [...levers];
  switch (stage) {
    case 'early_dev':
      // Story/arc first (transformation, moral), then moments
      return sorted.sort((a, b) => a.priority - b.priority);
    case 'packaging_now':
      // Moments/presence first, then clarity
      return sorted.sort((a, b) => b.priority - a.priority);
    case 'financing_live':
      // Clarity/risk items first
      return sorted.sort((a, b) => {
        const aIsClarity = /clarity|agency|hook|goal/i.test(a.area) ? 0 : 1;
        const bIsClarity = /clarity|agency|hook|goal/i.test(b.area) ? 0 : 1;
        return aIsClarity - bIsClarity || a.priority - b.priority;
      });
  }
}

// ── Stage-Specific Recommendations ─────────────────────────────────

const STAGE_RECOMMENDATIONS: Record<PackagingStage, StageRecommendation[]> = {
  early_dev: [
    {
      heading: 'Script Upgrades for Attachability',
      items: [
        'Strengthen protagonist spine — clear want, clear flaw, clear transformation arc',
        'Build at least 2 "undeniable" scenes (midpoint turn, climax confrontation)',
        'Clarify set-piece moments that demonstrate the role\'s range',
        'Ensure the antagonist pressure is specific and escalating',
      ],
    },
    {
      heading: 'What to Write Next',
      items: [
        'Sharpen the midpoint reversal — it must redefine the character\'s journey',
        'Add a contained "actor audition" scene (2-page emotional showcase)',
        'Tighten goal/obstacle clarity in Act 1 (first 15 pages)',
        'Write the climax scene as a standalone — it should work as a proof of concept',
      ],
    },
    {
      heading: 'Role Shaping',
      items: [
        'Deepen the moral dilemma so the role demands range',
        'Build reversals that reveal hidden character layers',
        'Create physical or emotional transformation markers',
      ],
    },
  ],
  packaging_now: [
    {
      heading: 'Attachment Readiness Checklist',
      items: [
        'Role one-pager prepared for each star-driver role',
        'Scene list (3-5 showcase scenes per key role) ready to send',
        'Hook lines and logline refined for talent pitches',
        'Director profile type identified and shortlist criteria clear',
      ],
    },
    {
      heading: 'What to Send to Director / Cast',
      items: [
        'Role one-pager: character arc summary + 3 defining scenes',
        'Showcase scene packet (5 strongest scenes with page numbers)',
        'Tone document: visual and performance references',
        'Genre positioning statement (1 paragraph)',
      ],
    },
    {
      heading: 'Star Drivers vs Supporting Heat',
      items: [
        'Identify which roles are "star drivers" (score ≥ 7) vs "supporting heat" (score 5-6)',
        'Star drivers should be packaged first — they unlock financing',
        'Supporting heat roles can be cast later but signal quality to buyers',
      ],
    },
  ],
  financing_live: [
    {
      heading: 'Buyer / Investor Packaging Summary',
      items: [
        'One-page packaging overview: genre, scale, talent attached, territories open',
        'Comparable titles with performance data (box office / streams)',
        'Clear budget range with financing structure summary',
        'Festival strategy (if applicable) with timeline',
      ],
    },
    {
      heading: 'Risk Reduction Notes',
      items: [
        'Genre promise is clear and consistent across all materials',
        'Runtime fits market expectations for the genre/format',
        'Budget has identifiable levers (locations, schedule, VFX scope)',
        'Completion bond readiness assessed',
      ],
    },
    {
      heading: 'Finance Path Readiness',
      items: [
        'Pre-sales logic mapped: which territories, which buyers, what triggers',
        'Tax incentive fit confirmed for target shoot locations',
        'Sales materials list: trailer, key art, synopsis, EPK',
        'Gap financing strategy identified if applicable',
      ],
    },
  ],
};

// ── Public API ─────────────────────────────────────────────────────

/**
 * Compute role gravity score given sub-scores, packaging mode, and stage.
 * Sub-scores are 0-10 integers. Returns weighted score 0-10.
 * Deterministic: same input ⇒ same output.
 */
export function computeRoleGravity(
  character: string,
  roleType: string,
  subScores: SubScores,
  mode: PackagingMode,
  stage: PackagingStage = 'early_dev',
): RoleGravityResult {
  const weights = computeFinalWeights(mode, stage);
  const keys: WeightKey[] = ['presence', 'emotional_range', 'transformation', 'moral_conflict', 'agency', 'actor_moments'];

  let weighted = 0;
  for (const k of keys) {
    weighted += subScores[k] * weights[k];
  }

  const score = Math.round(weighted * 10) / 10;

  return {
    character,
    role_type: roleType,
    sub_scores: subScores,
    weighted_score: Math.min(10, Math.max(0, score)),
    mode_used: mode,
    stage_used: stage,
    weights_used: weights,
  };
}

/**
 * Get rewrite levers for a mode, prioritized by stage.
 */
export function getRewriteLevers(mode: PackagingMode, stage: PackagingStage = 'early_dev'): RewriteLever[] {
  return prioritizeLevers(MODE_LEVERS[mode], stage);
}

/**
 * Get stage-specific recommendations.
 */
export function getStageRecommendations(stage: PackagingStage): StageRecommendation[] {
  return STAGE_RECOMMENDATIONS[stage];
}

/**
 * Get finance assumption multipliers for a packaging mode.
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

/**
 * Get stage-sensitive finance guidance text.
 */
export function getStageFinanceGuidance(stage: PackagingStage): { label: string; guidance: string } {
  switch (stage) {
    case 'early_dev':
      return { label: 'What to fix before packaging', guidance: 'Focus on script-level changes that unlock attachability. Finance conversations are premature — prioritize creative readiness.' };
    case 'packaging_now':
      return { label: 'What attachments unlock next', guidance: 'Each confirmed attachment changes the finance picture. Track which attachments trigger pre-sale conversations and equity interest.' };
    case 'financing_live':
      return { label: 'Closing checklist & materials', guidance: 'Ensure all sales materials are ready, tax incentive applications filed, and gap financing strategy confirmed. Every day in financing costs money.' };
  }
}
