/**
 * Trend Influence Engine
 *
 * Calculates how active trends affect:
 * - Lane classification bias
 * - Readiness score adjustments
 * - Financing recommendation logic
 * - Risk assessment overlays
 *
 * Isolated per production type — no cross-type contamination.
 */

import type { Project, MonetisationLane } from '@/lib/types';
import type { TrendSignal, CastTrend } from '@/hooks/useTrends';

// ---- Output Types ----

export interface TrendLaneInfluence {
  lane: string;
  boost: number; // -10 to +10
  reason: string;
}

export interface TrendReadinessAdjustment {
  adjustment: number; // -5 to +5
  factors: string[];
}

export interface TrendFinanceRecommendation {
  recommendation: string;
  confidence: 'high' | 'medium' | 'low';
  source: string; // which trend drove this
}

export interface TrendRiskFlag {
  risk: string;
  severity: 'low' | 'medium' | 'high';
  source: string;
}

export interface TrendInfluenceResult {
  laneInfluences: TrendLaneInfluence[];
  readinessAdjustment: TrendReadinessAdjustment;
  financeRecommendations: TrendFinanceRecommendation[];
  riskFlags: TrendRiskFlag[];
  matchingSignalCount: number;
  matchingCastCount: number;
  trendMomentum: 'strong' | 'moderate' | 'weak' | 'none';
}

// ---- Matching Logic ----

function matchesProject(signal: TrendSignal, project: Project): number {
  let score = 0;
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = project.tone?.toLowerCase() || '';
  const format = project.format?.toLowerCase() || '';

  if (signal.genre_tags?.some(gt => genres.some(pg => gt.toLowerCase().includes(pg) || pg.includes(gt.toLowerCase())))) score += 3;
  if (tone && signal.tone_tags?.some(tt => tt.toLowerCase().includes(tone) || tone.includes(tt.toLowerCase()))) score += 2;
  if (format && signal.format_tags?.some(ft => ft.toLowerCase().includes(format) || format.includes(ft.toLowerCase()))) score += 2;
  if (signal.lane_relevance?.some(lr => lr.toLowerCase().includes(project.assigned_lane?.toLowerCase() || ''))) score += 1;

  // Production type match is critical
  if (signal.production_type === project.format) score += 5;

  return score;
}

function matchesCast(cast: CastTrend, project: Project): number {
  let score = 0;
  const genres = (project.genres || []).map(g => g.toLowerCase());
  if (cast.genre_relevance?.some(gr => genres.some(pg => gr.toLowerCase().includes(pg)))) score += 3;
  if (cast.production_type === project.format) score += 5;
  return score;
}

// ---- Lane Influence ----

function computeLaneInfluences(signals: TrendSignal[], project: Project): TrendLaneInfluence[] {
  const laneBoosts: Record<string, { total: number; reasons: string[] }> = {};

  for (const signal of signals) {
    if (signal.strength < 3) continue;

    const velocityMultiplier = signal.velocity === 'Rising' ? 1.5 : signal.velocity === 'Declining' ? 0.5 : 1;
    const boost = Math.round((signal.strength / 10) * velocityMultiplier * 3);

    for (const lane of signal.lane_relevance || []) {
      if (!laneBoosts[lane]) laneBoosts[lane] = { total: 0, reasons: [] };
      laneBoosts[lane].total += boost;
      if (laneBoosts[lane].reasons.length < 2) {
        laneBoosts[lane].reasons.push(`${signal.name} (${signal.velocity})`);
      }
    }
  }

  return Object.entries(laneBoosts)
    .map(([lane, { total, reasons }]) => ({
      lane,
      boost: Math.min(10, Math.max(-10, total)),
      reason: reasons.join('; '),
    }))
    .sort((a, b) => b.boost - a.boost)
    .slice(0, 5);
}

// ---- Readiness Adjustment ----

function computeReadinessAdjustment(signals: TrendSignal[], casts: CastTrend[]): TrendReadinessAdjustment {
  const factors: string[] = [];
  let adjustment = 0;

  // Strong rising signals in the project's production type boost readiness
  const risingStrong = signals.filter(s => s.velocity === 'Rising' && s.strength >= 7);
  if (risingStrong.length >= 2) {
    adjustment += 3;
    factors.push(`${risingStrong.length} strong rising signals boost market positioning`);
  } else if (risingStrong.length === 1) {
    adjustment += 1;
    factors.push(`Rising signal: ${risingStrong[0].name}`);
  }

  // Declining signals reduce readiness
  const declining = signals.filter(s => s.velocity === 'Declining' && s.strength >= 5);
  if (declining.length >= 2) {
    adjustment -= 3;
    factors.push(`${declining.length} declining signals flag market cooling`);
  }

  // High saturation risk signals reduce readiness
  const saturated = signals.filter(s => s.saturation_risk === 'High');
  if (saturated.length >= 2) {
    adjustment -= 2;
    factors.push('High saturation risk in multiple trend areas');
  }

  // Matching cast momentum
  const peakingCast = casts.filter(c => c.cycle_phase === 'Peaking' && c.strength >= 7);
  if (peakingCast.length >= 1) {
    adjustment += 2;
    factors.push(`Peaking talent momentum: ${peakingCast.map(c => c.actor_name).slice(0, 2).join(', ')}`);
  }

  return {
    adjustment: Math.min(5, Math.max(-5, adjustment)),
    factors,
  };
}

// ---- Finance Recommendations ----

function computeFinanceRecommendations(signals: TrendSignal[], casts: CastTrend[], project: Project): TrendFinanceRecommendation[] {
  const recs: TrendFinanceRecommendation[] = [];

  // Rising buyer appetite signals → recommend targeting those buyers
  const buyerSignals = signals.filter(s => 
    (s.category?.toLowerCase().includes('buyer') || s.category?.toLowerCase().includes('demand') || s.category?.toLowerCase().includes('appetite')) 
    && s.velocity === 'Rising'
  );
  for (const bs of buyerSignals.slice(0, 2)) {
    recs.push({
      recommendation: `Target ${bs.target_buyer || 'buyers'} — ${bs.name} signal is rising (strength ${bs.strength}/10)`,
      confidence: bs.strength >= 7 ? 'high' : 'medium',
      source: bs.name,
    });
  }

  // High-strength peaking cast → recommend packaging now
  const peakingTalent = casts.filter(c => c.cycle_phase === 'Peaking' && c.strength >= 7);
  if (peakingTalent.length > 0) {
    recs.push({
      recommendation: `Package now — ${peakingTalent[0].actor_name} is peaking with maximum market leverage`,
      confidence: 'high',
      source: `${peakingTalent[0].actor_name} (Cast Trend)`,
    });
  }

  // Low saturation + rising velocity = good financing window
  const greenLight = signals.filter(s => s.saturation_risk === 'Low' && s.velocity === 'Rising' && s.strength >= 6);
  if (greenLight.length > 0) {
    recs.push({
      recommendation: `Favourable financing window — ${greenLight[0].name} shows low saturation with rising momentum`,
      confidence: greenLight[0].strength >= 8 ? 'high' : 'medium',
      source: greenLight[0].name,
    });
  }

  return recs.slice(0, 4);
}

// ---- Risk Assessment ----

function computeRiskFlags(signals: TrendSignal[], casts: CastTrend[]): TrendRiskFlag[] {
  const flags: TrendRiskFlag[] = [];

  // High saturation risk
  const highSat = signals.filter(s => s.saturation_risk === 'High' && s.strength >= 5);
  for (const hs of highSat.slice(0, 2)) {
    flags.push({
      risk: `Market saturation: ${hs.name} — crowded space reduces differentiation`,
      severity: hs.strength >= 8 ? 'high' : 'medium',
      source: hs.name,
    });
  }

  // Declining strong signals = timing risk
  const decliningStrong = signals.filter(s => s.velocity === 'Declining' && s.strength >= 6);
  for (const ds of decliningStrong.slice(0, 2)) {
    flags.push({
      risk: `Timing risk: ${ds.name} momentum is declining — accelerate or reposition`,
      severity: ds.strength >= 8 ? 'high' : 'medium',
      source: ds.name,
    });
  }

  // Cast declining
  const decliningCast = casts.filter(c => c.velocity === 'Declining' && c.strength >= 5);
  for (const dc of decliningCast.slice(0, 1)) {
    flags.push({
      risk: `Talent timing: ${dc.actor_name}'s market momentum is declining`,
      severity: 'medium',
      source: dc.actor_name,
    });
  }

  return flags;
}

// ---- Main Engine ----

export function calculateTrendInfluence(
  project: Project,
  allSignals: TrendSignal[],
  allCasts: CastTrend[],
): TrendInfluenceResult {
  // Filter to matching production type + project relevance
  const typeSignals = allSignals.filter(s => s.production_type === project.format && s.status === 'active');
  const typeCasts = allCasts.filter(c => c.production_type === project.format && c.status === 'active');

  const matchingSignals = typeSignals
    .map(s => ({ signal: s, score: matchesProject(s, project) }))
    .filter(x => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .map(x => x.signal);

  const matchingCasts = typeCasts
    .map(c => ({ cast: c, score: matchesCast(c, project) }))
    .filter(x => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .map(x => x.cast);

  const avgStrength = matchingSignals.length > 0
    ? matchingSignals.reduce((sum, s) => sum + s.strength, 0) / matchingSignals.length
    : 0;

  const risingCount = matchingSignals.filter(s => s.velocity === 'Rising').length;

  let trendMomentum: TrendInfluenceResult['trendMomentum'] = 'none';
  if (matchingSignals.length >= 3 && avgStrength >= 7 && risingCount >= 2) trendMomentum = 'strong';
  else if (matchingSignals.length >= 2 && avgStrength >= 5) trendMomentum = 'moderate';
  else if (matchingSignals.length >= 1) trendMomentum = 'weak';

  return {
    laneInfluences: computeLaneInfluences(matchingSignals, project),
    readinessAdjustment: computeReadinessAdjustment(matchingSignals, matchingCasts),
    financeRecommendations: computeFinanceRecommendations(matchingSignals, matchingCasts, project),
    riskFlags: computeRiskFlags(matchingSignals, matchingCasts),
    matchingSignalCount: matchingSignals.length,
    matchingCastCount: matchingCasts.length,
    trendMomentum,
  };
}
