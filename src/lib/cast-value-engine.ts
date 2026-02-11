/**
 * Cast Value Engine
 *
 * Models how talent attachments shift financeability, budget bands,
 * and territory pre-sales potential. This is the intelligence layer
 * that Movie Magic cannot provide.
 *
 * Tiers:  marquee > a-list > b-list > emerging > unknown
 * Status: attached > offer-out > in-talks > interested > approached > wishlist
 */

import type { ProjectCastMember, ProjectHOD } from '@/hooks/useProjectAttachments';

// ---- Types ----

export type MarketTier = 'marquee' | 'a-list' | 'b-list' | 'emerging' | 'unknown';

export interface CastImpactResult {
  /** Overall cast package strength 0–100 */
  packageScore: number;
  /** How much ATL budget shifts due to cast cost pressure (multiplier, e.g. 1.4 = +40%) */
  atlMultiplier: number;
  /** Estimated pre-sales territory coverage from cast territory tags */
  territoryCoverage: TerritoryValue[];
  /** Per-member value contribution */
  memberImpacts: MemberImpact[];
  /** Budget band shift suggestion */
  budgetBandShift: 'none' | 'up-one' | 'up-two' | 'down-one';
  /** Financeability delta: how many points cast adds to finance readiness */
  financeabilityDelta: number;
  /** Strengths summary */
  strengths: string[];
  /** Risks */
  risks: string[];
}

export interface MemberImpact {
  id: string;
  name: string;
  role: string;
  tier: MarketTier;
  status: string;
  /** Individual value score 0–25 */
  valueScore: number;
  /** Territory sales leverage */
  territories: string[];
  /** Whether this person is a "package anchor" */
  isAnchor: boolean;
}

export interface TerritoryValue {
  territory: string;
  /** How many cast members cover this territory */
  coverage: number;
  /** Aggregate tier strength for this territory */
  strength: 'strong' | 'moderate' | 'weak';
}

// ---- Constants ----

const TIER_WEIGHTS: Record<MarketTier, number> = {
  marquee: 25,
  'a-list': 18,
  'b-list': 10,
  emerging: 4,
  unknown: 1,
};

const TIER_ATL_MULTIPLIER: Record<MarketTier, number> = {
  marquee: 0.25,   // adds 25% ATL pressure
  'a-list': 0.15,
  'b-list': 0.08,
  emerging: 0.03,
  unknown: 0,
};

const STATUS_DISCOUNT: Record<string, number> = {
  attached: 1.0,
  confirmed: 1.0,
  'offer-out': 0.7,
  'in-talks': 0.5,
  interested: 0.35,
  approached: 0.2,
  wishlist: 0.1,
};

const HOD_REPUTATION_BOOST: Record<string, number> = {
  marquee: 8,
  acclaimed: 5,
  established: 3,
  emerging: 1,
};

export const MARKET_TIER_OPTIONS = [
  { value: 'marquee', label: 'Marquee', desc: 'Global box-office draw. Opens a film. Top-tier pre-sales value worldwide.' },
  { value: 'a-list', label: 'A-List', desc: 'Strong name recognition. Unlocks major territory pre-sales and equity interest.' },
  { value: 'b-list', label: 'B-List', desc: 'Known in genre/market circles. Adds credibility and selective territory value.' },
  { value: 'emerging', label: 'Emerging', desc: 'Rising talent. Festival buzz or breakout potential. Limited pre-sales leverage.' },
  { value: 'unknown', label: 'Unknown', desc: 'Not yet assessed or no established market value.' },
] as const;

export const MARKET_TIER_COLORS: Record<MarketTier, string> = {
  marquee: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'a-list': 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  'b-list': 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  emerging: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

// Key pre-sales territories
const KEY_TERRITORIES = [
  'US', 'UK', 'France', 'Germany', 'Italy', 'Spain', 'Japan',
  'South Korea', 'Australia', 'Scandinavia', 'Benelux', 'China',
  'Latin America', 'Middle East', 'India', 'Canada',
];

// ---- Engine ----

export function calculateCastImpact(
  cast: ProjectCastMember[],
  hods: ProjectHOD[],
): CastImpactResult {
  const strengths: string[] = [];
  const risks: string[] = [];

  // ── Per-member impacts ──
  const memberImpacts: MemberImpact[] = cast.map(c => {
    const tier = (c as any).market_value_tier as MarketTier || 'unknown';
    const statusMult = STATUS_DISCOUNT[c.status] ?? 0.1;
    const baseValue = TIER_WEIGHTS[tier] || 1;
    const valueScore = Math.round(baseValue * statusMult);
    const isAnchor = tier === 'marquee' || (tier === 'a-list' && (c.status === 'attached' || c.status === 'confirmed'));

    return {
      id: c.id,
      name: c.actor_name,
      role: c.role_name,
      tier,
      status: c.status,
      valueScore,
      territories: c.territory_tags || [],
      isAnchor,
    };
  });

  // ── Package score (0–100) ──
  const rawScore = memberImpacts.reduce((s, m) => s + m.valueScore, 0);
  
  // Director reputation bonus
  const directorAttached = hods.find(h =>
    h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed')
  );
  const directorBonus = directorAttached
    ? (HOD_REPUTATION_BOOST[directorAttached.reputation_tier] || 1)
    : 0;

  const packageScore = Math.min(100, rawScore + directorBonus);

  // ── ATL multiplier ──
  const attachedOrBetter = cast.filter(c =>
    ['attached', 'confirmed', 'offer-out'].includes(c.status)
  );
  let atlMultiplier = 1.0;
  for (const c of attachedOrBetter) {
    const tier = (c as any).market_value_tier as MarketTier || 'unknown';
    atlMultiplier += TIER_ATL_MULTIPLIER[tier] || 0;
  }
  atlMultiplier = Math.round(atlMultiplier * 100) / 100;

  // ── Territory coverage ──
  const territoryMap: Record<string, { count: number; bestTier: MarketTier }> = {};
  for (const m of memberImpacts) {
    if (m.status === 'wishlist' && m.tier === 'unknown') continue; // skip unassessed wishlist
    for (const t of m.territories) {
      if (!territoryMap[t]) territoryMap[t] = { count: 0, bestTier: 'unknown' };
      territoryMap[t].count += 1;
      if (TIER_WEIGHTS[m.tier] > TIER_WEIGHTS[territoryMap[t].bestTier]) {
        territoryMap[t].bestTier = m.tier;
      }
    }
  }

  const territoryCoverage: TerritoryValue[] = Object.entries(territoryMap)
    .map(([territory, { count, bestTier }]) => ({
      territory,
      coverage: count,
      strength: bestTier === 'marquee' || bestTier === 'a-list'
        ? 'strong' as const
        : bestTier === 'b-list'
          ? 'moderate' as const
          : 'weak' as const,
    }))
    .sort((a, b) => {
      const strengthOrder = { strong: 0, moderate: 1, weak: 2 };
      return strengthOrder[a.strength] - strengthOrder[b.strength] || b.coverage - a.coverage;
    });

  // ── Budget band shift ──
  const anchors = memberImpacts.filter(m => m.isAnchor);
  let budgetBandShift: CastImpactResult['budgetBandShift'] = 'none';
  if (anchors.length >= 2 || anchors.some(a => a.tier === 'marquee')) {
    budgetBandShift = 'up-two';
  } else if (anchors.length >= 1) {
    budgetBandShift = 'up-one';
  }

  // ── Financeability delta ──
  // Extra points this cast package adds to the finance readiness packaging subscore
  let financeabilityDelta = 0;
  const attachedCount = memberImpacts.filter(m => m.status === 'attached' || m.status === 'confirmed').length;
  if (attachedCount > 0) {
    financeabilityDelta += Math.min(6, attachedCount * 2);
  }
  if (anchors.length > 0) {
    financeabilityDelta += Math.min(6, anchors.length * 3);
  }
  if (territoryCoverage.filter(t => t.strength === 'strong').length >= 3) {
    financeabilityDelta += 3;
  }
  if (directorBonus >= 5) financeabilityDelta += 2;
  financeabilityDelta = Math.min(15, financeabilityDelta);

  // ── Strengths & Risks ──
  if (anchors.length > 0) {
    strengths.push(`${anchors.length} package anchor${anchors.length > 1 ? 's' : ''} (${anchors.map(a => a.name).join(', ')})`);
  }
  if (territoryCoverage.filter(t => t.strength === 'strong').length >= 3) {
    strengths.push('Strong coverage across 3+ key territories');
  }
  if (directorAttached && (directorAttached.reputation_tier === 'marquee' || directorAttached.reputation_tier === 'acclaimed')) {
    strengths.push(`${directorAttached.reputation_tier} director anchors creative package`);
  }
  if (atlMultiplier >= 1.4) {
    strengths.push(`Cast package commands premium ATL allocation (${Math.round((atlMultiplier - 1) * 100)}% above baseline)`);
  }

  if (cast.length > 0 && attachedCount === 0) {
    risks.push('No cast attached yet — all value is speculative');
  }
  if (atlMultiplier >= 1.5 && budgetBandShift !== 'up-two') {
    risks.push('Cast cost pressure may exceed current budget band');
  }
  if (territoryCoverage.length <= 1 && cast.length >= 2) {
    risks.push('Narrow territory coverage — cast lacks international pre-sales leverage');
  }
  const unknownCount = memberImpacts.filter(m => m.tier === 'unknown').length;
  if (unknownCount > cast.length / 2 && cast.length >= 2) {
    risks.push(`${unknownCount} cast members untiered — assess market value for accurate modeling`);
  }

  return {
    packageScore,
    atlMultiplier,
    territoryCoverage,
    memberImpacts,
    budgetBandShift,
    financeabilityDelta,
    strengths,
    risks,
  };
}
