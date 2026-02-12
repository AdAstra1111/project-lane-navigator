/**
 * Packaging Delta Engine
 *
 * Calculates how cast/crew attachment changes shift finance probability.
 * Provides before/after comparison and inline delta notifications.
 */

import type { ProjectCastMember, ProjectHOD } from '@/hooks/useProjectAttachments';
import { calculateCastImpact, type CastImpactResult, type MarketTier } from './cast-value-engine';

// ---- Types ----

export type AttachmentGrade = 'A' | 'B' | 'C' | 'D';

export interface AttachmentGrading {
  id: string;
  name: string;
  role: string;
  type: 'cast' | 'hod';
  grade: AttachmentGrade;
  factors: { commitment: number; marketValue: number; territoryRelevance: number };
  composite: number;
}

export interface PackagingDelta {
  /** Previous package score */
  previousScore: number;
  /** Current package score */
  currentScore: number;
  /** Absolute change */
  scoreDelta: number;
  /** Finance probability shift estimate (percentage points) */
  financeProbabilityShift: number;
  /** ATL multiplier delta */
  atlDelta: number;
  /** Territory coverage change */
  territoryCoverageDelta: number;
  /** Summary text */
  summary: string;
  /** Direction */
  direction: 'up' | 'down' | 'flat';
}

export interface ProductionTypePackagingContext {
  /** What matters most for this production type */
  primaryDrivers: string[];
  /** Weight adjustments for scoring */
  castWeight: number;
  directorWeight: number;
  producerWeight: number;
  /** Type-specific insights */
  insights: string[];
  /** Missing elements that would significantly improve packaging */
  missingElements: string[];
}

// ---- Attachment Grading ----

const COMMITMENT_SCORES: Record<string, number> = {
  attached: 100, confirmed: 100,
  'offer-out': 70, 'in-talks': 50,
  interested: 35, approached: 20, wishlist: 5,
};

const TIER_SCORES: Record<string, number> = {
  marquee: 100, 'a-list': 80, 'b-list': 55,
  emerging: 30, unknown: 10,
};

const REPUTATION_SCORES: Record<string, number> = {
  marquee: 100, acclaimed: 80, established: 55,
  emerging: 30, unknown: 10,
};

function gradeFromComposite(composite: number): AttachmentGrade {
  if (composite >= 75) return 'A';
  if (composite >= 50) return 'B';
  if (composite >= 25) return 'C';
  return 'D';
}

export function gradeCastMember(member: ProjectCastMember): AttachmentGrading {
  const tier = (member as any).market_value_tier as MarketTier || 'unknown';
  const commitment = COMMITMENT_SCORES[member.status] ?? 5;
  const marketValue = TIER_SCORES[tier] ?? 10;
  const territoryRelevance = Math.min(100, (member.territory_tags?.length || 0) * 25);
  const composite = Math.round(commitment * 0.4 + marketValue * 0.4 + territoryRelevance * 0.2);

  return {
    id: member.id,
    name: member.actor_name,
    role: member.role_name,
    type: 'cast',
    grade: gradeFromComposite(composite),
    factors: { commitment, marketValue, territoryRelevance },
    composite,
  };
}

export function gradeHOD(hod: ProjectHOD): AttachmentGrading {
  const commitment = COMMITMENT_SCORES[hod.status] ?? 5;
  const marketValue = REPUTATION_SCORES[hod.reputation_tier] ?? 10;
  const territoryRelevance = 50; // HODs have baseline territory value
  const composite = Math.round(commitment * 0.45 + marketValue * 0.45 + territoryRelevance * 0.1);

  return {
    id: hod.id,
    name: hod.person_name,
    role: hod.department,
    type: 'hod',
    grade: gradeFromComposite(composite),
    factors: { commitment, marketValue, territoryRelevance },
    composite,
  };
}

export function gradeAllAttachments(
  cast: ProjectCastMember[],
  hods: ProjectHOD[],
): AttachmentGrading[] {
  return [
    ...cast.map(gradeCastMember),
    ...hods.map(gradeHOD),
  ].sort((a, b) => b.composite - a.composite);
}

// ---- Packaging Delta ----

export function calculatePackagingDelta(
  previousCast: ProjectCastMember[],
  previousHods: ProjectHOD[],
  currentCast: ProjectCastMember[],
  currentHods: ProjectHOD[],
): PackagingDelta {
  const prev = calculateCastImpact(previousCast, previousHods);
  const curr = calculateCastImpact(currentCast, currentHods);

  const scoreDelta = curr.packageScore - prev.packageScore;
  const atlDelta = Math.round((curr.atlMultiplier - prev.atlMultiplier) * 100) / 100;
  const territoryCoverageDelta = curr.territoryCoverage.length - prev.territoryCoverage.length;

  // Estimate finance probability shift: ~0.6% per package point
  const financeProbabilityShift = Math.round(scoreDelta * 0.6 * 10) / 10;

  const direction = scoreDelta > 0 ? 'up' : scoreDelta < 0 ? 'down' : 'flat';

  let summary = '';
  if (direction === 'up') {
    summary = `Package strength increased by ${scoreDelta} points (+${financeProbabilityShift}% finance probability)`;
  } else if (direction === 'down') {
    summary = `Package strength decreased by ${Math.abs(scoreDelta)} points (${financeProbabilityShift}% finance probability)`;
  } else {
    summary = 'No change in package strength';
  }

  return {
    previousScore: prev.packageScore,
    currentScore: curr.packageScore,
    scoreDelta,
    financeProbabilityShift,
    atlDelta,
    territoryCoverageDelta,
    summary,
    direction,
  };
}

// ---- Production-Type Packaging Context ----

export function getProductionTypePackagingContext(
  format: string,
  cast: ProjectCastMember[],
  hods: ProjectHOD[],
): ProductionTypePackagingContext {
  const hasDirector = hods.some(h => h.department === 'Director' && ['attached', 'confirmed'].includes(h.status));
  const hasWriter = hods.some(h => h.department === 'Writer' && ['attached', 'confirmed'].includes(h.status));
  const hasProducer = hods.some(h => h.department === 'Producer' && ['attached', 'confirmed'].includes(h.status));
  const hasShowrunner = hods.some(h => h.department === 'Showrunner' && ['attached', 'confirmed'].includes(h.status));
  const hasDP = hods.some(h => h.department === 'Director of Photography' && ['attached', 'confirmed'].includes(h.status));
  const attachedCast = cast.filter(c => ['attached', 'confirmed'].includes(c.status));
  const marqueeCast = cast.filter(c => (c as any).market_value_tier === 'marquee');

  switch (format) {
    case 'tv-series':
    case 'digital-series':
      return {
        primaryDrivers: ['Showrunner/Creator', 'Lead cast', 'Commissioner relationship'],
        castWeight: 0.3,
        directorWeight: 0.15,
        producerWeight: 0.35,
        insights: [
          ...(hasShowrunner ? ['✓ Showrunner attached — key commissioner signal'] : []),
          ...(attachedCast.length >= 2 ? [`✓ ${attachedCast.length} cast attached — strong series anchor`] : []),
          ...(!hasWriter ? ['Writer attachment critical for TV packaging'] : []),
        ],
        missingElements: [
          ...(!hasShowrunner && !hasWriter ? ['Showrunner or head writer'] : []),
          ...(attachedCast.length === 0 ? ['Lead cast attachment'] : []),
          ...(!hasProducer ? ['Producing partner with commissioner relationships'] : []),
        ],
      };

    case 'documentary':
    case 'documentary-series':
      return {
        primaryDrivers: ['Access/subject matter', 'Director reputation', 'Archive rights'],
        castWeight: 0.05,
        directorWeight: 0.5,
        producerWeight: 0.3,
        insights: [
          ...(hasDirector ? ['✓ Director attached — primary packaging element for docs'] : []),
          ...(hasProducer ? ['✓ Producer attached — commissioning credibility'] : []),
        ],
        missingElements: [
          ...(!hasDirector ? ['Director with documentary track record'] : []),
          ...(!hasProducer ? ['Producer with broadcaster relationships'] : []),
        ],
      };

    case 'commercial':
    case 'branded-content':
    case 'music-video':
      return {
        primaryDrivers: ['Director reel/aesthetic', 'Brand alignment', 'Production company'],
        castWeight: 0.1,
        directorWeight: 0.5,
        producerWeight: 0.25,
        insights: [
          ...(hasDirector ? ['✓ Director attached — reel drives brand confidence'] : []),
          ...(hasDP ? ['✓ DP attached — visual quality assurance'] : []),
        ],
        missingElements: [
          ...(!hasDirector ? ['Director with commercial reel'] : []),
          ...(!hasDP ? ['DP with high-end commercial work'] : []),
        ],
      };

    case 'short-film':
    case 'proof-of-concept':
      return {
        primaryDrivers: ['Director vision', 'Cast recognition', 'Festival potential'],
        castWeight: 0.3,
        directorWeight: 0.4,
        producerWeight: 0.15,
        insights: [
          ...(hasDirector ? ['✓ Director attached — festival submission strength'] : []),
          ...(marqueeCast.length > 0 ? ['✓ Recognisable cast — elevates short to festival contention'] : []),
        ],
        missingElements: [
          ...(!hasDirector ? ['Director attachment'] : []),
        ],
      };

    case 'vertical-drama':
      return {
        primaryDrivers: ['Platform-native creators', 'Short-form stars', 'Social reach'],
        castWeight: 0.45,
        directorWeight: 0.2,
        producerWeight: 0.2,
        insights: [
          ...(attachedCast.length > 0 ? ['✓ Cast with social reach attached — platform leverage'] : []),
        ],
        missingElements: [
          ...(attachedCast.length === 0 ? ['Cast with social media following'] : []),
          ...(!hasDirector ? ['Director experienced in short-form content'] : []),
        ],
      };

    // Default: narrative feature film
    default:
      return {
        primaryDrivers: ['Lead cast pre-sales value', 'Director attachment', 'Producer track record'],
        castWeight: 0.45,
        directorWeight: 0.3,
        producerWeight: 0.15,
        insights: [
          ...(marqueeCast.length > 0 ? [`✓ ${marqueeCast.length} marquee cast — unlocks major territory pre-sales`] : []),
          ...(hasDirector ? ['✓ Director attached — creative package anchor'] : []),
          ...(attachedCast.length >= 2 ? ['✓ Multiple cast attached — strong ensemble signal'] : []),
        ],
        missingElements: [
          ...(!hasDirector ? ['Director attachment'] : []),
          ...(attachedCast.length === 0 ? ['Lead cast with territory pre-sales value'] : []),
          ...(!hasProducer ? ['Producer with financing track record'] : []),
        ],
      };
  }
}

// ---- Grade Colors & Labels ----

export const GRADE_CONFIG: Record<AttachmentGrade, { color: string; label: string; desc: string }> = {
  A: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'A', desc: 'Strong attachment — high commitment + market value' },
  B: { color: 'bg-sky-500/15 text-sky-400 border-sky-500/30', label: 'B', desc: 'Solid attachment — good commitment or market value' },
  C: { color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'C', desc: 'Developing — low commitment or untiered talent' },
  D: { color: 'bg-muted text-muted-foreground border-border', label: 'D', desc: 'Speculative — wishlist or unknown market value' },
};
