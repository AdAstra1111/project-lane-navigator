/**
 * Rule-based insight engine for Project pages.
 * Generates Cast Intelligence, Idea Positioning, and Timing & Market Window
 * insights by cross-referencing project data with active Cast Trends.
 */

import type { Project } from '@/lib/types';
import type { CastTrend } from '@/hooks/useTrends';

// ---- Output types ----

export interface CastInsight {
  archetype_guidance: string;
  territory_note: string;
  warning: string | null;
  suggested_cast: { name: string; reason: string }[];
}

export interface IdeaPositioning {
  genre_alignment: string;
  saturation: 'emerging' | 'well-timed' | 'saturated' | 'cooling';
  buyer_context: string;
}

export interface TimingWindow {
  optimal_market: string;
  financing_window: string;
  risk_signal: string | null;
}

export interface ProjectInsights {
  cast: CastInsight;
  idea: IdeaPositioning;
  timing: TimingWindow;
}

// ---- Genre cycle data (rule-based) ----

const GENRE_CYCLES: Record<string, { phase: IdeaPositioning['saturation']; note: string }> = {
  thriller: { phase: 'well-timed', note: 'EU thriller demand remains strong, particularly for elevated and psychological sub-genres.' },
  horror: { phase: 'well-timed', note: 'Horror continues to deliver outsized ROI at low-to-mid budgets. Streamer appetite high.' },
  comedy: { phase: 'cooling', note: 'Pure comedy is harder to pre-sell internationally. Hybrid comedy-drama or genre-comedy performs better.' },
  drama: { phase: 'well-timed', note: 'Character-driven drama with festival potential remains financeable, especially as EU co-productions.' },
  action: { phase: 'saturated', note: 'Action market is crowded at studio level. Mid-budget action requires strong cast packaging.' },
  'sci-fi': { phase: 'emerging', note: 'Mid-budget sci-fi is underserved. Concept-driven sci-fi with contained scope attracts streamer interest.' },
  romance: { phase: 'emerging', note: 'Romance is seeing renewed streamer demand, especially with younger demos and diverse casting.' },
  documentary: { phase: 'well-timed', note: 'Feature docs with strong social hooks continue to attract streamer and festival buyers.' },
  animation: { phase: 'well-timed', note: 'Adult and hybrid animation gaining traction internationally beyond family market.' },
  'coming-of-age': { phase: 'cooling', note: 'YA/coming-of-age cycle is past peak. Requires distinctive voice or genre-hybrid to cut through.' },
};

// ---- Budget-to-market mapping ----

const BUDGET_MARKET_MAP: Record<string, { market: string; financing: string }> = {
  micro: { market: 'Festival circuit (SXSW, Tribeca, Rotterdam) or direct streamer acquisition', financing: 'Equity + regional incentives. Pre-sales unlikely at this budget.' },
  low: { market: 'Cannes Marché, Berlin EFM, or targeted streamer pitch', financing: 'Gap financing + tax credits + small pre-sales. 6-12 month window.' },
  mid: { market: 'Cannes, Berlin, or AFM depending on genre and cast package', financing: 'Pre-sales viable with cast attachment. 9-15 month optimal window.' },
  high: { market: 'Major market premiere (Cannes, Venice, Toronto) or studio/streamer direct', financing: 'Requires significant pre-sales or streamer commitment. Cast-dependent.' },
  'studio-level': { market: 'Studio or major streamer direct. Market screenings secondary.', financing: 'Studio financing or major streamer deal. Cast packaging essential.' },
};

function normaliseBudget(budgetRange: string): string {
  const lower = budgetRange.toLowerCase();
  if (lower.includes('micro') || lower.includes('under')) return 'micro';
  if (lower.includes('low') || lower.includes('1m') || lower.includes('2m')) return 'low';
  if (lower.includes('mid') || lower.includes('5m') || lower.includes('10m')) return 'mid';
  if (lower.includes('high') || lower.includes('15m') || lower.includes('20m')) return 'high';
  if (lower.includes('studio') || lower.includes('30m') || lower.includes('50m')) return 'studio-level';
  return 'mid'; // default
}

// ---- Core insight generation ----

export function generateProjectInsights(
  project: Project,
  castTrends: CastTrend[]
): ProjectInsights {
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const budget = normaliseBudget(project.budget_range);
  const format = project.format;

  // --- Cast Intelligence ---
  const matchingCast = castTrends
    .filter(ct => {
      const genreMatch = ct.genre_relevance?.some(gr =>
        genres.some(pg => gr.toLowerCase().includes(pg) || pg.includes(gr.toLowerCase()))
      );
      return genreMatch && ct.status === 'active';
    })
    .sort((a, b) => {
      // Prioritise by phase: Peaking > Building > Early
      const phaseOrder = { Peaking: 3, Building: 2, Early: 1 };
      return (phaseOrder[b.cycle_phase] || 0) - (phaseOrder[a.cycle_phase] || 0);
    })
    .slice(0, 6);

  const hasInternationalSpread = matchingCast.some(c => c.region !== 'US') && matchingCast.some(c => c.region === 'US' || c.region === 'UK');

  let archetypeGuidance: string;
  if (budget === 'micro' || budget === 'low') {
    archetypeGuidance = 'At this budget level, prioritise 1 emerging talent with festival credibility over expensive name recognition. Regional rising stars offer the best value-to-profile ratio.';
  } else if (budget === 'mid') {
    archetypeGuidance = 'This project benefits from 1 internationally recognisable lead paired with 1-2 rising regional actors. This combination maximises pre-sales value while keeping costs manageable.';
  } else {
    archetypeGuidance = 'At this budget level, at least 1 bankable international name is essential for pre-sales. Complement with rising talent to signal freshness to streamers and festival programmers.';
  }

  let territoryNote = 'Cast with multi-territory recognition strengthens the international financing package.';
  if (hasInternationalSpread) {
    territoryNote = 'Matching cast spans US/UK and international territories — strong co-production and pre-sales positioning.';
  }

  let castWarning: string | null = null;
  if (matchingCast.every(c => c.region === 'US')) {
    castWarning = 'Over-indexing on US-only recognition limits EU pre-sales and co-production eligibility. Consider talent with European or international festival credibility.';
  } else if (matchingCast.length === 0) {
    castWarning = 'No trending talent matches this project\'s genre profile. Consider broadening genre positioning or reviewing cast strategy.';
  }

  const suggestedCast = matchingCast.map(c => ({
    name: c.actor_name,
    reason: `${c.trend_type} (${c.cycle_phase}) · ${c.region} · ${c.sales_leverage || c.market_alignment}${c.timing_window ? ` · ${c.timing_window}` : ''}`,
  }));

  // --- Idea Positioning ---
  const primaryGenre = genres[0] || 'drama';
  const cycle = GENRE_CYCLES[primaryGenre] || { phase: 'well-timed' as const, note: 'Market positioning should be evaluated against current buyer appetite.' };

  let buyerContext: string;
  if (budget === 'micro' || budget === 'low') {
    buyerContext = 'Primary buyers: independent distributors, regional streamers, and festival-driven acquisitions.';
  } else if (budget === 'mid') {
    buyerContext = 'Target both independent distributors for pre-sales and mid-tier streamers. Festival premiere can significantly increase value.';
  } else {
    buyerContext = 'Major streamers and studio distributors are the primary targets. Strong cast packaging is prerequisite for serious engagement.';
  }

  if (format === 'tv-series') {
    buyerContext = 'Series format favours streamer-first strategy. International broadcaster pre-sales viable with strong concept and cast. Festival launch less relevant than for film.';
  }

  // --- Timing & Market Window ---
  const budgetMarket = BUDGET_MARKET_MAP[budget] || BUDGET_MARKET_MAP.mid;

  let riskSignal: string | null = null;
  if (cycle.phase === 'cooling') {
    riskSignal = `Genre momentum is cooling. Delay increases risk — move quickly or reposition the concept as a genre hybrid.`;
  } else if (cycle.phase === 'saturated') {
    riskSignal = `Market is crowded in this genre space. Differentiation through cast, tone, or visual approach is critical.`;
  } else if (cycle.phase === 'emerging') {
    riskSignal = null; // Positive — no risk signal needed
  }

  return {
    cast: {
      archetype_guidance: archetypeGuidance,
      territory_note: territoryNote,
      warning: castWarning,
      suggested_cast: suggestedCast,
    },
    idea: {
      genre_alignment: cycle.note,
      saturation: cycle.phase,
      buyer_context: buyerContext,
    },
    timing: {
      optimal_market: budgetMarket.market,
      financing_window: budgetMarket.financing,
      risk_signal: riskSignal,
    },
  };
}
