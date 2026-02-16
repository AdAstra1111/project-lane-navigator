/**
 * IFFY Signals Engine v1 — Scoring + Clustering + Matching
 *
 * Pure functions, no DB calls — used by hooks and edge functions.
 */

import type { ClusterScoring, FormatBucket } from './signals-types';
import type { TrendSignal } from '@/hooks/useTrends';

// ── Observation Scoring ──

export interface ObservationScores {
  strength: number;
  velocity: number;
  freshness: number;
  confidence: number;
  saturation: number;
}

export function scoreObservation(
  rawMetrics: Record<string, any>,
  extractionConfidence: number,
  observedAt: string | null,
  saturationProxy: number,
): ObservationScores {
  // Strength: log-normalize views/likes/rank
  const views = rawMetrics.views || rawMetrics.count || 0;
  const strength = views > 0 ? Math.min(1, Math.log10(views + 1) / 7) : 0.3;

  // Velocity
  const velocity = rawMetrics.growth_rate ?? rawMetrics.delta ?? 0.3;

  // Freshness: exp decay by days since observed
  const daysSince = observedAt
    ? (Date.now() - new Date(observedAt).getTime()) / (1000 * 60 * 60 * 24)
    : 30;
  const freshness = Math.exp(-daysSince / 30);

  return {
    strength: Math.min(1, Math.max(0, strength)),
    velocity: Math.min(1, Math.max(0, velocity)),
    freshness: Math.min(1, Math.max(0, freshness)),
    confidence: Math.min(1, Math.max(0, extractionConfidence)),
    saturation: Math.min(1, Math.max(0, saturationProxy)),
  };
}

// ── Cluster Scoring from aggregated observations ──

export function computeClusterScoring(
  obsScores: ObservationScores[],
): ClusterScoring {
  if (obsScores.length === 0) {
    return { strength: 0, velocity: 0, freshness: 0, confidence: 0, saturation: 0, total: 0 };
  }

  const avg = (key: keyof ObservationScores) =>
    obsScores.reduce((s, o) => s + o[key], 0) / obsScores.length;

  const strength = avg('strength');
  const velocity = avg('velocity');
  const freshness = Math.max(...obsScores.map(o => o.freshness));
  const confidence = avg('confidence');
  const saturation = avg('saturation');
  const total = strength * velocity * freshness * confidence - saturation * 0.25;

  return {
    strength: Math.round(strength * 100) / 100,
    velocity: Math.round(velocity * 100) / 100,
    freshness: Math.round(freshness * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    saturation: Math.round(saturation * 100) / 100,
    total: Math.round(Math.max(0, total) * 100) / 100,
  };
}

// ── Tag-based Jaccard similarity ──

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

// ── Project Feature Extraction (V1: tag-based from project fields) ──

export function extractProjectFeaturesFromFields(project: {
  genres?: string[];
  tone?: string;
  format?: string;
  budget_range?: string;
  target_audience?: string;
  comparable_titles?: string;
  assigned_lane?: string | null;
  title?: string;
}): string[] {
  const features: string[] = [];

  // Genres
  for (const g of project.genres || []) {
    features.push(g.toLowerCase());
  }

  // Tone
  if (project.tone) {
    features.push(...project.tone.toLowerCase().split(/[\s,]+/).filter(Boolean));
  }

  // Format
  if (project.format) {
    features.push(project.format.toLowerCase().replace(/_/g, '-'));
  }

  // Budget
  if (project.budget_range) {
    features.push(project.budget_range.toLowerCase());
  }

  // Audience
  if (project.target_audience) {
    features.push(...project.target_audience.toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 3));
  }

  // Comps — extract individual titles
  if (project.comparable_titles) {
    const comps = project.comparable_titles.split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    features.push(...comps.slice(0, 5));
  }

  // Lane
  if (project.assigned_lane) {
    features.push(project.assigned_lane.toLowerCase());
  }

  // Deduplicate
  return [...new Set(features)];
}

// ── Match signals to project ──

export interface SignalMatchResult {
  clusterId: string;
  relevanceScore: number;
  impactScore: number;
  matchedTags: string[];
  explanation: string;
}

export function matchSignalsToFeatures(
  projectFeatures: string[],
  signals: TrendSignal[],
  formatBucket: FormatBucket,
): SignalMatchResult[] {
  const results: SignalMatchResult[] = [];

  for (const signal of signals) {
    // Format applicability check
    const applicability = (signal as any).format_applicability as string[] | undefined;
    if (applicability && applicability.length > 0 && !applicability.some(f => f === formatBucket)) {
      continue;
    }

    // Build signal tags
    const signalTags = [
      ...(signal.genre_tags || []),
      ...(signal.tone_tags || []),
      ...(signal.format_tags || []),
      ...(signal.lane_relevance || []),
      signal.category,
    ].map(t => t.toLowerCase());

    // Jaccard overlap
    const jaccard = jaccardSimilarity(projectFeatures, signalTags);

    // Comp title boost
    const exampleTitles = ((signal as any).example_titles || []) as string[];
    const compBoost = exampleTitles.some(t =>
      projectFeatures.some(f => f.includes(t.toLowerCase()) || t.toLowerCase().includes(f))
    ) ? 0.1 : 0;

    const relevanceScore = Math.min(1, jaccard + compBoost);
    if (relevanceScore < 0.05) continue;

    // Impact = cluster total * relevance
    const clusterScoring = (signal as any).cluster_scoring as ClusterScoring | undefined;
    const total = clusterScoring?.total ?? (signal.strength / 10);
    const impactScore = total * relevanceScore;

    const matchedTags = signalTags.filter(t => projectFeatures.includes(t));

    results.push({
      clusterId: signal.id,
      relevanceScore: Math.round(relevanceScore * 100) / 100,
      impactScore: Math.round(impactScore * 100) / 100,
      matchedTags,
      explanation: `${signal.name}: ${matchedTags.length} tag overlap (Jaccard ${(jaccard * 100).toFixed(0)}%)`,
    });
  }

  return results
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 20);
}

// ── Build signal context block for prompt injection ──

export function buildSignalContextBlock(
  matches: Array<{
    signal_name: string;
    category: string;
    strength: number;
    velocity: string;
    saturation_risk: string;
    matched_tags: string[];
    explanation: string;
  }>,
  influence: number,
  formatBucket: FormatBucket,
): string {
  if (matches.length === 0) return '';

  const top = matches.slice(0, 3);

  let influenceNote = '';
  if (influence >= 0.65) {
    influenceNote = 'SIGNAL INFLUENCE: HIGH — signals may shape logline framing, comps, buyer angle, and format mechanics.';
  } else if (influence >= 0.35) {
    influenceNote = 'SIGNAL INFLUENCE: MODERATE — signals should shape comps and buyer positioning only.';
  } else {
    influenceNote = 'SIGNAL INFLUENCE: LOW — signals add risk flags and optional comps only.';
  }

  let formatNote = '';
  if (formatBucket === 'vertical_drama') {
    formatNote = '\nVERTICAL DRAMA: Apply retention mechanics — cliff cadence, reveal pacing, twist density from signal tropes.';
  } else if (formatBucket === 'documentary') {
    formatNote = '\nDOCUMENTARY: Apply truth constraints — access/evidence plan, non-fabrication. Signals inform subject positioning only.';
  } else {
    formatNote = '\nFEATURE FILM: Apply budget realism, lane liquidity, and saturation warnings from signals.';
  }

  const signalLines = top.map((m, i) =>
    `${i + 1}. ${m.signal_name} [${m.category}] — strength ${m.strength}/10, ${m.velocity}, saturation ${m.saturation_risk}\n   Tags: ${m.matched_tags.join(', ')}\n   ${m.explanation}`
  ).join('\n');

  return `\n=== MARKET & FORMAT SIGNALS ===\n${influenceNote}${formatNote}\n\nTop matched signals:\n${signalLines}\n=== END SIGNALS ===\n`;
}
