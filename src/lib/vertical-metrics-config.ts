/**
 * Vertical Drama Episode Metrics Configuration
 * Tension Tracker, Retention Simulator, Engagement Simulator
 */

// ── Weight configs (tuneable per project) ──

export const DEFAULT_TENSION_WEIGHTS = {
  conflict_intensity: 0.20,
  stakes_level: 0.20,
  emotional_intensity: 0.20,
  momentum: 0.15,
  twist_impact: 0.10,
  cliffhanger_strength: 0.15,
};

export const DEFAULT_RETENTION_WEIGHTS = {
  hook_strength: 0.25,
  clarity: 0.15,
  pacing: 0.20,
  payoff_density: 0.15,
  emotional_resonance: 0.10,
  cliffhanger_strength: 0.15,
};

export const DEFAULT_ENGAGEMENT_WEIGHTS = {
  comment_bait: 0.20,
  shareability: 0.20,
  rewatch_magnet: 0.15,
  dominant_genre_driver: 0.20,
  character_attachment: 0.25,
};

export type TensionWeights = typeof DEFAULT_TENSION_WEIGHTS;
export type RetentionWeights = typeof DEFAULT_RETENTION_WEIGHTS;
export type EngagementWeights = typeof DEFAULT_ENGAGEMENT_WEIGHTS;

// ── Metric types ──

export interface TensionMetrics {
  tension_level: number;
  tension_delta: number;
  target_level: number;
  tension_gap: number;
  stakes_level: number;
  conflict_intensity: number;
  momentum: number;
  emotional_intensity: number;
  twist_impact: number;
  flags: TensionFlag[];
}

export type TensionFlag = 'overheat_risk' | 'flatline_risk' | 'whiplash_risk';

export interface CliffhangerMetrics {
  cliffhanger_strength: number;
}

export interface RetentionMetrics {
  score: number;
  next_ep_click_likelihood: number;
  reasons: string[];
  components: {
    hook_strength: number;
    clarity: number;
    pacing: number;
    payoff_density: number;
    emotional_resonance: number;
    cliffhanger_strength: number;
    confusion_risk: number;
  };
}

export interface EngagementMetrics {
  score: number;
  components: {
    comment_bait: number;
    shareability: number;
    rewatch_magnet: number;
    dominant_genre_driver: number;
    character_attachment: number;
  };
}

export interface Recommendation {
  type: 'hook' | 'pacing' | 'emotion' | 'stakes' | 'cliffhanger' | 'clarity';
  severity: 'low' | 'med' | 'high';
  note: string;
  example: string;
}

export interface EpisodeMetrics {
  tension: TensionMetrics;
  cliffhanger: CliffhangerMetrics;
  retention: RetentionMetrics;
  engagement: EngagementMetrics;
  recommendations: Recommendation[];
}

export interface VerticalEpisodeMetricRow {
  id: string;
  project_id: string;
  episode_number: number;
  canon_snapshot_version: string;
  metrics: EpisodeMetrics;
  created_at: string;
}

// ── Target tension curve ──

export function targetTension(episodeNumber: number, seasonEpisodeCount: number): number {
  const pct = episodeNumber / seasonEpisodeCount;

  if (pct <= 0.15) {
    // Early: rapid ramp from 40 to 65
    return 40 + (pct / 0.15) * 25;
  } else if (pct <= 0.6) {
    // Mid-season: rising sawtooth 60-80
    const midPct = (pct - 0.15) / 0.45;
    const base = 60 + midPct * 15;
    // Sawtooth: small dips every ~4 episodes
    const sawtoothDip = Math.sin(midPct * Math.PI * 4) * 5;
    return Math.min(85, base + sawtoothDip);
  } else if (pct <= 0.85) {
    // Late season: sustained high 78-88
    const latePct = (pct - 0.6) / 0.25;
    return 78 + latePct * 10;
  } else {
    // Final crescendo: 85-95
    const finalPct = (pct - 0.85) / 0.15;
    return 85 + finalPct * 10;
  }
}

// ── Threshold constants ──

export const METRIC_THRESHOLDS = {
  retention_min: 60,
  cliffhanger_min: 60,
  confusion_max: 70,
  tension_overheat_delta: 15,
  tension_overheat_consecutive: 2,
  tension_flatline_range: 5,
  tension_flatline_consecutive: 3,
  tension_whiplash_delta: 35,
};

// ── Flag detection (requires history of previous episodes) ──

export function detectTensionFlags(
  currentMetrics: EpisodeMetrics,
  previousMetrics: EpisodeMetrics[],
): TensionFlag[] {
  const flags: TensionFlag[] = [];
  const t = currentMetrics.tension;

  // Overheat: tension > target+15 for 2+ consecutive
  if (previousMetrics.length >= 1) {
    const prevOverheat = previousMetrics.slice(-1).every(
      m => m.tension.tension_level > m.tension.target_level + METRIC_THRESHOLDS.tension_overheat_delta
    );
    if (prevOverheat && t.tension_level > t.target_level + METRIC_THRESHOLDS.tension_overheat_delta) {
      flags.push('overheat_risk');
    }
  }

  // Flatline: delta in [-5,+5] for 3+ consecutive
  if (previousMetrics.length >= 2) {
    const prevFlat = previousMetrics.slice(-2).every(
      m => Math.abs(m.tension.tension_delta) <= METRIC_THRESHOLDS.tension_flatline_range
    );
    if (prevFlat && Math.abs(t.tension_delta) <= METRIC_THRESHOLDS.tension_flatline_range) {
      flags.push('flatline_risk');
    }
  }

  // Whiplash: abs(delta) > 35 without bridge
  if (Math.abs(t.tension_delta) > METRIC_THRESHOLDS.tension_whiplash_delta) {
    flags.push('whiplash_risk');
  }

  return flags;
}

// ── Gating check ──

export function metricsPassGate(metrics: EpisodeMetrics): {
  passed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (metrics.retention.score < METRIC_THRESHOLDS.retention_min) {
    reasons.push(`Retention score ${Math.round(metrics.retention.score)} < ${METRIC_THRESHOLDS.retention_min}`);
  }
  if (metrics.cliffhanger.cliffhanger_strength < METRIC_THRESHOLDS.cliffhanger_min) {
    reasons.push(`Cliffhanger strength ${Math.round(metrics.cliffhanger.cliffhanger_strength)} < ${METRIC_THRESHOLDS.cliffhanger_min}`);
  }
  if (metrics.retention.components.confusion_risk > METRIC_THRESHOLDS.confusion_max) {
    reasons.push(`Confusion risk ${Math.round(metrics.retention.components.confusion_risk)} > ${METRIC_THRESHOLDS.confusion_max}`);
  }
  if (metrics.recommendations.some(r => r.severity === 'high')) {
    reasons.push('High severity recommendations need resolution');
  }

  return { passed: reasons.length === 0, reasons };
}
