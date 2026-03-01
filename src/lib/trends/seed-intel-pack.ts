/**
 * Seed Intelligence Pack — Deterministic normalizer
 * 
 * Converts existing trend_signals + cast_trends data into a structured
 * SeedIntelPack for canon injection during DevSeed.
 * 
 * NO LLM calls. Fully deterministic. Stable ordering.
 */

import type { TrendSignal, CastTrend } from '@/hooks/useTrends';

// ── Types ──

export interface SeedIntelSource {
  name: string;
  updated_at: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DemandSignal {
  label: string;
  score?: number;
  reason?: string;
  source?: string;
}

export interface PlatformFit {
  recommended_lanes?: string[];
  recommended_formats?: string[];
  notes?: string[];
}

export interface GenreHeat {
  genre: string;
  score?: number;
  reason?: string;
  source?: string;
}

export type ReferenceAxis =
  | 'tone' | 'pacing' | 'stakes' | 'structure'
  | 'character' | 'dialogue' | 'visual_language' | 'budget_scale';

export interface ComparableCandidate {
  title: string;
  type?: string;
  year?: number;
  reference_axis?: ReferenceAxis;
  weight?: number;
  reason?: string;
  source?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface ToneStyleSignals {
  tone_band?: string;
  pacing?: string;
  dialogue_density?: string;
  humor_darkness?: string;
  notes?: string[];
}

export interface ConstraintsSuggestions {
  rating?: string;
  runtime_band?: string;
  budget_band?: string;
  episode_length?: string;
  notes?: string[];
}

export interface RiskItem {
  label: string;
  severity?: 'low' | 'medium' | 'high';
  reason?: string;
}

export interface SeedIntelPack {
  generated_at: string;
  scope: {
    lane?: string;
    region?: string;
    time_window?: string;
    production_type?: string;
  };
  sources: SeedIntelSource[];
  demand_signals: DemandSignal[];
  platform_fit: PlatformFit;
  genre_heat: GenreHeat[];
  comparable_candidates: ComparableCandidate[];
  tone_style_signals: ToneStyleSignals;
  constraints_suggestions: ConstraintsSuggestions;
  risks: RiskItem[];
  notes: string[];
}

// ── Helpers ──

/** Stable sort: by score desc, then label/title asc */
function stableSort<T>(arr: T[], scoreKey: keyof T, labelKey: keyof T): T[] {
  return [...arr].sort((a, b) => {
    const sa = (a[scoreKey] as number) ?? 0;
    const sb = (b[scoreKey] as number) ?? 0;
    if (sb !== sa) return sb - sa;
    const la = String(a[labelKey] ?? '');
    const lb = String(b[labelKey] ?? '');
    return la.localeCompare(lb);
  });
}

function clamp<T>(arr: T[], max: number): T[] {
  return arr.slice(0, max);
}

function mapConfidence(strength: number): 'high' | 'medium' | 'low' {
  if (strength >= 7) return 'high';
  if (strength >= 4) return 'medium';
  return 'low';
}

function mapSeverity(satRisk: string, strength: number): 'low' | 'medium' | 'high' {
  if (satRisk === 'High' && strength >= 6) return 'high';
  if (satRisk === 'High' || strength >= 7) return 'medium';
  return 'low';
}

function inferReferenceAxis(signal: TrendSignal): ReferenceAxis {
  const cat = (signal.category || '').toLowerCase();
  if (cat.includes('narrative') || cat.includes('ip')) return 'structure';
  if (cat.includes('genre')) return 'tone';
  if (cat.includes('market') || cat.includes('buyer')) return 'budget_scale';
  if (cat.includes('format') || cat.includes('platform')) return 'pacing';
  return 'tone';
}

function deriveToneBand(signals: TrendSignal[]): string | undefined {
  const toneTags = signals.flatMap(s => s.tone_tags || []);
  if (toneTags.length === 0) return undefined;
  // Most frequent tone tag
  const freq: Record<string, number> = {};
  for (const t of toneTags) {
    const key = t.toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0];
}

function derivePacing(signals: TrendSignal[]): string | undefined {
  const rising = signals.filter(s => s.velocity === 'Rising').length;
  const total = signals.length;
  if (total === 0) return undefined;
  const ratio = rising / total;
  if (ratio >= 0.6) return 'accelerating';
  if (ratio >= 0.3) return 'measured';
  return 'deliberate';
}

// ── Main Builder ──

export interface BuildSeedIntelPackOpts {
  lane?: string;
  region?: string;
  productionType?: string;
}

export function buildSeedIntelPack(
  signals: TrendSignal[],
  castTrends: CastTrend[],
  opts?: BuildSeedIntelPackOpts,
): SeedIntelPack {
  const now = new Date().toISOString();
  const lane = opts?.lane;
  const region = opts?.region;
  const productionType = opts?.productionType;

  // Filter to active + optionally production type
  let filteredSignals = signals.filter(s => s.status === 'active');
  let filteredCast = castTrends.filter(c => c.status === 'active');

  if (productionType) {
    filteredSignals = filteredSignals.filter(s => s.production_type === productionType);
    filteredCast = filteredCast.filter(c => c.production_type === productionType);
  }

  // Sort by recency first to determine latest window
  const sortedByDate = [...filteredSignals].sort((a, b) =>
    new Date(b.last_updated_at).getTime() - new Date(a.last_updated_at).getTime()
  );
  const latestDate = sortedByDate[0]?.last_updated_at;

  // ── Sources ──
  const sourceNames = new Set<string>();
  const sources: SeedIntelSource[] = [];
  for (const s of sortedByDate.slice(0, 20)) {
    const name = s.category || 'trend_signals';
    if (!sourceNames.has(name)) {
      sourceNames.add(name);
      sources.push({
        name,
        updated_at: s.last_updated_at,
        confidence: mapConfidence(s.strength),
      });
    }
  }

  // ── Demand Signals ── (top 10 by strength)
  const demandSignals: DemandSignal[] = clamp(
    stableSort(
      filteredSignals.map(s => ({
        label: s.name,
        score: s.strength,
        reason: `${s.velocity} — ${s.cycle_phase} phase, ${s.saturation_risk} saturation`,
        source: s.category,
      })),
      'score' as keyof DemandSignal,
      'label' as keyof DemandSignal,
    ),
    10,
  );

  // ── Platform Fit ──
  const laneSet = new Set<string>();
  const formatSet = new Set<string>();
  const platformNotes: string[] = [];

  for (const s of filteredSignals) {
    for (const lr of s.lane_relevance || []) laneSet.add(lr);
    for (const ft of s.format_tags || []) formatSet.add(ft);
    if (s.target_buyer && s.strength >= 6) {
      platformNotes.push(`${s.target_buyer} appetite: ${s.velocity} (${s.name})`);
    }
  }

  const platformFit: PlatformFit = {
    recommended_lanes: [...laneSet].sort(),
    recommended_formats: [...formatSet].sort(),
    notes: clamp([...new Set(platformNotes)].sort(), 5),
  };

  // ── Genre Heat ── (top 10)
  const genreScoreMap: Record<string, { totalStrength: number; count: number; reasons: string[] }> = {};
  for (const s of filteredSignals) {
    for (const g of s.genre_tags || []) {
      const key = g.toLowerCase();
      if (!genreScoreMap[key]) genreScoreMap[key] = { totalStrength: 0, count: 0, reasons: [] };
      genreScoreMap[key].totalStrength += s.strength;
      genreScoreMap[key].count++;
      if (genreScoreMap[key].reasons.length < 2) {
        genreScoreMap[key].reasons.push(`${s.name} (${s.velocity})`);
      }
    }
  }

  const genreHeat: GenreHeat[] = clamp(
    stableSort(
      Object.entries(genreScoreMap).map(([genre, data]) => ({
        genre,
        score: Math.round((data.totalStrength / data.count) * 10) / 10,
        reason: data.reasons.join('; '),
        source: 'trend_signals',
      })),
      'score' as keyof GenreHeat,
      'genre' as keyof GenreHeat,
    ),
    10,
  );

  // ── Comparable Candidates ── (from example_titles, top 12)
  const compMap = new Map<string, ComparableCandidate>();
  for (const s of filteredSignals) {
    const exampleTitles = (s as any).example_titles as string[] | undefined;
    if (!exampleTitles || exampleTitles.length === 0) continue;
    for (const title of exampleTitles) {
      const key = title.toLowerCase().trim();
      if (!key || compMap.has(key)) continue;
      compMap.set(key, {
        title: title.trim(),
        reference_axis: inferReferenceAxis(s),
        weight: Math.round((s.strength / 10) * 100) / 100,
        reason: `Referenced in ${s.name} (${s.category})`,
        source: s.name,
        confidence: mapConfidence(s.strength),
      });
    }
  }
  const comparableCandidates: ComparableCandidate[] = clamp(
    stableSort([...compMap.values()], 'weight' as keyof ComparableCandidate, 'title' as keyof ComparableCandidate),
    12,
  );

  // ── Tone/Style Signals ──
  const toneNotes: string[] = [];
  for (const c of filteredCast.slice(0, 3)) {
    toneNotes.push(`${c.actor_name}: ${c.trend_type}, ${c.market_alignment}`);
  }

  const toneStyleSignals: ToneStyleSignals = {
    tone_band: deriveToneBand(filteredSignals),
    pacing: derivePacing(filteredSignals),
    notes: clamp(toneNotes, 5),
  };

  // ── Constraints Suggestions ──
  const budgetTiers = filteredSignals.map(s => s.budget_tier).filter(Boolean);
  const mostCommonBudget = budgetTiers.length > 0
    ? Object.entries(
        budgetTiers.reduce<Record<string, number>>((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1])[0]?.[0]
    : undefined;

  const constraintsSuggestions: ConstraintsSuggestions = {
    budget_band: mostCommonBudget,
    notes: [],
  };

  // ── Risks ── (from declining + high saturation signals)
  const risks: RiskItem[] = [];
  for (const s of filteredSignals) {
    if (s.saturation_risk === 'High' && s.strength >= 5) {
      risks.push({
        label: `Saturation: ${s.name}`,
        severity: mapSeverity(s.saturation_risk, s.strength),
        reason: `${s.cycle_phase} phase, strength ${s.strength}/10`,
      });
    }
    if (s.velocity === 'Declining' && s.strength >= 6) {
      risks.push({
        label: `Declining momentum: ${s.name}`,
        severity: s.strength >= 8 ? 'high' : 'medium',
        reason: `Strength ${s.strength}/10 but declining velocity`,
      });
    }
  }

  // ── Notes ──
  const notes: string[] = [];
  notes.push(`Pack built from ${filteredSignals.length} signals and ${filteredCast.length} cast trends.`);
  if (latestDate) notes.push(`Latest signal: ${latestDate}`);
  if (lane) notes.push(`Lane scope: ${lane}`);
  if (region) notes.push(`Region scope: ${region}`);

  return {
    generated_at: now,
    scope: {
      lane,
      region,
      time_window: latestDate ? `up to ${latestDate}` : undefined,
      production_type: productionType,
    },
    sources: clamp(sources, 10),
    demand_signals: demandSignals,
    platform_fit: platformFit,
    genre_heat: genreHeat,
    comparable_candidates: comparableCandidates,
    tone_style_signals: toneStyleSignals,
    constraints_suggestions: constraintsSuggestions,
    risks: clamp(stableSort(risks, 'severity' as any, 'label' as keyof RiskItem), 10),
    notes,
  };
}
