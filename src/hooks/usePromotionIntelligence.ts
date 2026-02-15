import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PromotionRecommendation } from '@/components/devengine/PromotionIntelligenceCard';

// ── Local computation (same algorithm as edge function) for when no sessionId exists ──

const LADDER = ['idea', 'concept_brief', 'blueprint', 'architecture', 'draft', 'coverage'] as const;
type DocStage = (typeof LADDER)[number];

function nextDoc(current: DocStage): string | null {
  const idx = LADDER.indexOf(current);
  return idx >= 0 && idx < LADDER.length - 1 ? LADDER[idx + 1] : null;
}

const WEIGHTS: Record<string, { ci: number; gp: number; gap: number; traj: number; hi: number; pen: number }> = {
  idea:          { ci: 0.20, gp: 0.30, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  concept_brief: { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  blueprint:     { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  architecture:  { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  draft:         { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  coverage:      { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function trajectoryScore(t: string | null): number {
  const norm = (t || '').toLowerCase().replace(/[_-]/g, '');
  if (norm === 'converging') return 90;
  if (norm === 'strengthened') return 85;
  if (norm === 'overoptimised' || norm === 'overoptimized') return 60;
  if (norm === 'stalled') return 55;
  if (norm === 'eroding') return 25;
  return 55;
}

// ── Semantic blocker detection ──
const SEMANTIC_BLOCKER_PHRASES = [
  "major blocker", "narrative blocker", "fatal flaw", "core flaw",
  "doesn't work", "does not work", "fundamental problem", "story breaks",
  "no clear protagonist", "no stakes", "no engine",
];

function isSemanticBlocker(text: string): boolean {
  const lower = text.toLowerCase();
  return SEMANTIC_BLOCKER_PHRASES.some(p => lower.includes(p));
}

// ── Robust note extraction from any analysis shape ──
function noteToText(n: any): string {
  if (typeof n === 'string') return n;
  return n?.description || n?.note || '';
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

export function extractNoteCounts(latestAnalysis: any, latestNotes?: any): {
  blockers: string[];
  highImpact: string[];
} {
  if (!latestAnalysis && !latestNotes) return { blockers: [], highImpact: [] };

  const sources = [latestAnalysis, latestNotes].filter(Boolean);

  const rawBlockers: any[] = [];
  const rawHigh: any[] = [];

  for (const src of sources) {
    rawBlockers.push(...asArray(src?.blocking_issues));
    rawBlockers.push(...asArray(src?.blockers));
    rawHigh.push(...asArray(src?.high_impact_notes));
    rawHigh.push(...asArray(src?.high_impact));
  }

  const dedup = (items: any[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const text = noteToText(item);
      if (text && !seen.has(text)) {
        seen.add(text);
        result.push(text);
      }
    }
    return result;
  };

  const blockers = dedup(rawBlockers);
  const highImpact = dedup(rawHigh);

  // Promote semantic blockers from highImpact into blockers
  const promoted: string[] = [];
  const filteredHigh: string[] = [];
  for (const text of highImpact) {
    if (isSemanticBlocker(text) && !blockers.includes(text)) {
      promoted.push(text);
    } else {
      filteredHigh.push(text);
    }
  }

  if (import.meta.env.DEV && promoted.length > 0) {
    console.debug(`[PromotionIntel] semanticBlockerHits: ${promoted.length}`, promoted);
  }

  return {
    blockers: [...blockers, ...promoted],
    highImpact: filteredHigh,
  };
}

export interface PromotionInput {
  ci: number;
  gp: number;
  gap: number;
  trajectory: string | null;
  convergenceStatus: string | null;
  currentDocument: string;
  blockersCount: number;
  highImpactCount: number;
  iterationCount: number;
  blockerTexts?: string[];
  highImpactTexts?: string[];
}

function computeLocally(input: PromotionInput): PromotionRecommendation {
  const {
    ci, gp, gap, trajectory, currentDocument,
    blockersCount, highImpactCount, iterationCount,
    blockerTexts = [], highImpactTexts = [],
  } = input;

  const doc = (LADDER.includes(currentDocument as DocStage) ? currentDocument : 'concept_brief') as DocStage;
  const reasons: string[] = [];
  const mustFixNext: string[] = [];
  const riskFlags: string[] = [];

  if (doc !== currentDocument) riskFlags.push('document_type_assumed');

  const confidence = computeConfidence(iterationCount, highImpactCount, gap, trajectory);

  if (import.meta.env.DEV) {
    console.debug('Promotion Intel Input:', { ci, gp, gap, blockersCount, highImpactCount, trajectory, currentDocument: doc, iterationCount });
  }

  // ── Compute weighted score FIRST (always) ──
  const w = WEIGHTS[doc] || WEIGHTS.concept_brief;
  const gapScore = 100 - clamp(gap * 2, 0, 100);
  const trajScore = trajectoryScore(trajectory);
  const hiScore = 100 - clamp(highImpactCount * 10, 0, 60);
  const iterPenalty = clamp((iterationCount - 2) * 4, 0, 20);

  let readinessScore = Math.round(
    ci * w.ci + gp * w.gp + gapScore * w.gap + trajScore * w.traj + hiScore * w.hi - iterPenalty * w.pen
  );
  readinessScore = clamp(readinessScore, 0, 100);

  // ── Hard Gates (override recommendation but keep readinessScore) ──

  // Gate A — Blockers
  if (blockersCount > 0) {
    riskFlags.push('hard_gate:blockers');
    reasons.push(`Promotion blocked by active blocking issues (${blockersCount})`);
    reasons.push(`Readiness score: ${readinessScore}/100`);
    mustFixNext.push(...blockerTexts.slice(0, 3));
    if (mustFixNext.length === 0) mustFixNext.push('Resolve blocking issues');
    return { recommendation: 'stabilise', next_document: null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags };
  }

  // Gate B — Eroding trajectory
  if ((trajectory || '').toLowerCase() === 'eroding') {
    riskFlags.push('hard_gate:eroding_trajectory');
    reasons.push('Trajectory is eroding');
    reasons.push(`Readiness score: ${readinessScore}/100`);
    mustFixNext.push('Run Executive Strategy Loop');
    return { recommendation: 'escalate', next_document: null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags };
  }

  // Gate D — Early-stage high-impact
  if ((doc === 'idea' || doc === 'concept_brief') && highImpactCount > 0) {
    riskFlags.push('hard_gate:early_stage_high_impact');
    reasons.push(`Promotion blocked by early-stage high-impact issues (${highImpactCount})`);
    reasons.push(`Readiness score: ${readinessScore}/100`);
    mustFixNext.push(...highImpactTexts.slice(0, 3));
    if (mustFixNext.length === 0) mustFixNext.push('Resolve high-impact notes');
    mustFixNext.push('Run another editorial pass');
    return { recommendation: 'stabilise', next_document: null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags };
  }

  // ── Decision bands (only reached when no hard gate fires) ──
  let recommendation: 'promote' | 'stabilise' | 'escalate';
  const next = nextDoc(doc);

  if (readinessScore >= 78) recommendation = 'promote';
  else if (readinessScore >= 65) recommendation = 'stabilise';
  else recommendation = 'escalate';

  // Over-optimised nudge
  const normTraj = (trajectory || '').toLowerCase().replace(/[_-]/g, '');
  if (normTraj === 'overoptimised' && blockersCount === 0 && gp >= 60 && readinessScore >= 72) {
    recommendation = 'promote';
    reasons.push('Over-optimised: promote to avoid endless polishing');
  }

  reasons.push(`Readiness score: ${readinessScore}/100`);
  reasons.push(`CI: ${ci}, GP: ${gp}, Gap: ${gap}`);
  reasons.push(`Trajectory: ${trajectory || 'unknown'}`);
  if (highImpactCount > 0) reasons.push(`${highImpactCount} high-impact note(s) remaining`);
  if (iterationCount > 3) reasons.push(`${iterationCount} iterations completed — diminishing returns possible`);

  if (recommendation === 'promote' && next) {
    mustFixNext.push(`Promote to ${next}`);
  } else if (recommendation === 'stabilise') {
    mustFixNext.push(...highImpactTexts.slice(0, 2));
    if (mustFixNext.length === 0) mustFixNext.push('Resolve high-impact notes');
    mustFixNext.push('Run another editorial pass');
  } else {
    mustFixNext.push('Run Executive Strategy Loop');
    mustFixNext.push('Consider repositioning format or lane');
  }

  return { recommendation, next_document: recommendation === 'promote' ? next : null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags };
}

function computeConfidence(iter: number, hi: number, gap: number, traj: string | null): number {
  let c = 70;
  if (iter <= 1) c -= 10;
  if (hi >= 5) c -= 10;
  if (gap >= 20) c -= 15;
  const t = (traj || '').toLowerCase().replace(/[_-]/g, '');
  if (t === 'converging' || t === 'strengthened') c += 10;
  return clamp(c, 0, 100);
}

export function usePromotionIntelligence() {
  const [data, setData] = useState<PromotionRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Remote call (for session-based flow)
  const fetchRecommendation = useCallback(async (sessionId: string, currentDocument?: string) => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-promotion`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ sessionId, current_document: currentDocument || 'concept_brief' }),
        }
      );
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Error');
      setData(result as PromotionRecommendation);
      return result as PromotionRecommendation;
    } catch {
      setData(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Local computation (for document-based dev-engine-v2 flow)
  const computeLocal = useCallback((input: PromotionInput) => {
    const result = computeLocally(input);
    setData(result);
    return result;
  }, []);

  const clear = useCallback(() => setData(null), []);

  return { data, isLoading, fetchRecommendation, computeLocal, clear };
}
