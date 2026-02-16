/**
 * IFFY Signals Engine v1 — Canonical Types
 *
 * These types map 1:1 to the DB tables created/extended in the signals migration.
 * trend_signals serves as the canonical "cluster" table.
 */

// ── Format Bucket ──

export type FormatBucket = 'vertical_drama' | 'film' | 'documentary';

export function getFormatBucket(format: string | undefined | null): FormatBucket {
  const f = (format || '').toLowerCase().replace(/_/g, '-');
  if (['vertical-drama'].includes(f)) return 'vertical_drama';
  if (['documentary', 'documentary-series', 'hybrid-documentary'].includes(f)) return 'documentary';
  return 'film';
}

// ── Observations (raw inputs) ──

export interface TrendObservation {
  id: string;
  created_at: string;
  observed_at: string | null;
  source_type: string;
  source_name: string;
  source_url: string | null;
  raw_text: string | null;
  raw_metrics: Record<string, any>;
  extraction_confidence: number;
  format_hint: string | null;
  tags: string[];
  cluster_id: string | null;
  ingested_by: string;
  user_id: string | null;
}

// ── Cluster Scoring (stored in trend_signals.cluster_scoring JSONB) ──

export interface ClusterScoring {
  strength: number;
  velocity: number;
  freshness: number;
  confidence: number;
  saturation: number;
  total: number;
}

// ── Project ↔ Signal Match ──

export interface ProjectSignalMatch {
  id: string;
  created_at: string;
  project_id: string;
  cluster_id: string;
  relevance_score: number;
  impact_score: number;
  rationale: {
    project_features?: string[];
    matched_tags?: string[];
    explanation?: string;
    sources_used?: string[];
  };
  applied_to: string[];
  last_applied_at: string | null;
  // Joined from trend_signals
  cluster?: {
    name: string;
    category: string;
    strength: number;
    velocity: string;
    saturation_risk: string;
    cluster_scoring: ClusterScoring;
    genre_tags: string[];
    tone_tags: string[];
    format_tags: string[];
    explanation: string;
    sources_used: any[];
  };
}

// ── Doc Fact Ledger (documentary safety) ──

export interface DocFactLedgerItem {
  id: string;
  created_at: string;
  project_id: string;
  claim: string;
  evidence_type: string;
  evidence_link: string | null;
  status: 'verified' | 'needs_check' | 'unknown' | 'rejected';
  notes: string;
  user_id: string | null;
}

// ── Project Signals Settings (stored on projects table) ──

export interface SignalsApplyConfig {
  pitch: boolean;
  dev: boolean;
  grid: boolean;
  doc: boolean;
}

export const DEFAULT_SIGNALS_APPLY: SignalsApplyConfig = {
  pitch: true,
  dev: true,
  grid: true,
  doc: true,
};

export function getDefaultInfluence(bucket: FormatBucket): number {
  switch (bucket) {
    case 'vertical_drama': return 0.7;
    case 'documentary': return 0.35;
    default: return 0.5;
  }
}
