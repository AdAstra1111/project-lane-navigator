import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PromotionRecommendation } from '@/components/devengine/PromotionIntelligenceCard';
import type { NextAction } from '@/lib/next-action';
import { buildSeriesWriterAction, buildPromoteAction, buildNoAction } from '@/lib/next-action';
import {
  computePipelineState,
  isStageValidForFormat,
  type ExistingDoc,
} from '@/lib/pipeline-brain';
import { getLadderForFormat, mapDocTypeToLadderStage, getNextStage } from '@/lib/stages/registry';
import { BASE_DOC_TYPES } from '@/config/documentLadders';

// ── Canonical stage weights for readiness score computation ──────────────────
// Keys MUST be canonical doc_type values from BASE_DOC_TYPES / FORMAT_LADDERS.
// NO legacy keys (blueprint, architecture, draft, coverage) allowed.

const STAGE_WEIGHTS: Record<string, { ci: number; gp: number; gap: number; traj: number; hi: number; pen: number }> = {
  idea:                   { ci: 0.20, gp: 0.30, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  concept_brief:          { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  market_sheet:           { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  vertical_market_sheet:  { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  treatment:              { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  story_outline:          { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  character_bible:        { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  beat_sheet:             { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  episode_beats:          { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  format_rules:           { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  season_arc:             { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  episode_grid:           { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  vertical_episode_beats: { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  documentary_outline:    { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  feature_script:         { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  episode_script:         { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  season_script:          { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  season_master_script:   { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  production_draft:       { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  deck:                   { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
};
// Default for any canonical stage not explicitly listed
const DEFAULT_STAGE_WEIGHTS = { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 };

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
  /** Project format — used to route series formats to Series Writer instead of coverage */
  projectFormat?: string | null;
  /** All existing (non-stale) doc types in the project — used for vertical drama pipeline routing */
  existingDocTypes?: string[];
  /** Doc types that have at least one approved version — used to skip already-approved stages */
  approvedDocTypes?: string[];
  /** Season episode count — needed for vertical drama gating */
  seasonEpisodeCount?: number | null;
}

function computeLocally(input: PromotionInput): PromotionRecommendation {
  const {
    ci, gp, gap, trajectory, currentDocument,
    blockersCount, highImpactCount, iterationCount,
    blockerTexts = [], highImpactTexts = [],
    projectFormat,
    existingDocTypes = [],
    approvedDocTypes = [],
  } = input;

  const doc = mapDocTypeToLadderStage(currentDocument);
  const reasons: string[] = [];
  const mustFixNext: string[] = [];
  const riskFlags: string[] = [];

  if (doc !== currentDocument) riskFlags.push('document_type_mapped');

  const confidence = computeConfidence(iterationCount, highImpactCount, gap, trajectory);

  if (import.meta.env.DEV) {
    console.debug('Promotion Intel Input:', { ci, gp, gap, blockersCount, highImpactCount, trajectory, currentDocument: doc, iterationCount, projectFormat, existingDocTypes });
  }

  // ── Compute weighted score FIRST (always) ──
  const w = STAGE_WEIGHTS[doc] || DEFAULT_STAGE_WEIGHTS;
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
    return { recommendation: 'stabilise', next_document: null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags, next_action: buildNoAction() };
  }

  // Gate B — Eroding trajectory
  if ((trajectory || '').toLowerCase() === 'eroding') {
    riskFlags.push('hard_gate:eroding_trajectory');
    reasons.push('Trajectory is eroding');
    reasons.push(`Readiness score: ${readinessScore}/100`);
    mustFixNext.push('Run Executive Strategy Loop');
    return { recommendation: 'escalate', next_document: null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags, next_action: buildNoAction() };
  }

  // Gate D — Early-stage high-impact
  if ((doc === 'idea' || doc === 'concept_brief') && highImpactCount > 0) {
    riskFlags.push('hard_gate:early_stage_high_impact');
    reasons.push(`Promotion blocked by early-stage high-impact issues (${highImpactCount})`);
    reasons.push(`Readiness score: ${readinessScore}/100`);
    mustFixNext.push(...highImpactTexts.slice(0, 3));
    if (mustFixNext.length === 0) mustFixNext.push('Resolve high-impact notes');
    mustFixNext.push('Run another editorial pass');
    return { recommendation: 'stabilise', next_document: null, readiness_score: readinessScore, confidence, reasons, must_fix_next: mustFixNext, risk_flags: riskFlags, next_action: buildNoAction() };
  }

  // ── Determine next document (format-aware via Pipeline Brain) ──
    // NOTE: isVD/isSeries no longer needed — Pipeline Brain handles all lane routing

  let rawNext: string | null;
  let isSeriesWriterTarget = false;

  if (projectFormat && existingDocTypes.length > 0) {
    // Use Pipeline Brain for all formats
    const approvedSet = new Set(approvedDocTypes.map(dt => mapDocTypeToLadderStage(dt)));
    const pipelineDocs: ExistingDoc[] = existingDocTypes.map(dt => ({
      docType: dt, hasApproved: approvedSet.has(mapDocTypeToLadderStage(dt)), activeVersionId: null,
    }));
    const pState = computePipelineState(projectFormat, pipelineDocs, {
      seasonEpisodeCount: input.seasonEpisodeCount,
    });

    // ── CRITICAL FIX: anchor next-step to currentDocument, not the project's last existing stage ──
    // Without this, if a user is viewing an earlier doc (e.g. concept_brief) but the project has
    // later docs already created, the promote button incorrectly offers the globally-next stage
    // (e.g. production_draft) instead of the stage immediately after the viewed doc.
    const mappedCurrentDoc = mapDocTypeToLadderStage(doc);
    const currentDocIdxInPipeline = pState.pipeline.indexOf(mappedCurrentDoc as any);
    let primaryNext = pState.nextSteps.find(s => s.priority === 'primary');
    if (currentDocIdxInPipeline >= 0 && pState.currentStageIndex !== currentDocIdxInPipeline) {
      // User is viewing a doc that is NOT the project's last stage — find next stage after viewed doc
      const nextFromViewedDoc = pState.pipeline[currentDocIdxInPipeline + 1] ?? null;
      if (nextFromViewedDoc) {
        primaryNext = { docType: nextFromViewedDoc, label: nextFromViewedDoc, reason: `Next stage after ${mappedCurrentDoc}`, action: 'create', priority: 'primary' };
      }
    }

    if (primaryNext?.action === 'enter_series_writer') {
      rawNext = 'series_writer';
      isSeriesWriterTarget = true;
    } else if (primaryNext) {
      rawNext = primaryNext.docType;
      // Validate the next step is actually in the pipeline
      if (!isStageValidForFormat(rawNext, projectFormat)) {
        rawNext = null;
        reasons.push(`Computed next stage not valid for ${projectFormat} pipeline`);
      }

      // Sanity check: next_document must be AFTER current doc in the pipeline.
      // If the pipeline brain returns a stage that is EARLIER than or EQUAL TO the
      // current doc, something went wrong (e.g. wrong existingDocs state, alias mismatch).
      // Fall back to the simple "next stage after current" from the raw ladder.
      if (rawNext && rawNext !== 'series_writer' && currentDocIdxInPipeline >= 0) {
        const rawNextIdx = pState.pipeline.indexOf(rawNext as any);
        if (rawNextIdx >= 0 && rawNextIdx <= currentDocIdxInPipeline) {
          console.warn(`[PromotionIntel] Backwards/same promotion detected: "${mappedCurrentDoc}" → "${rawNext}" (indices ${currentDocIdxInPipeline} → ${rawNextIdx}). Falling back to ladder-next.`);
          rawNext = pState.pipeline[currentDocIdxInPipeline + 1] ?? null;
          reasons.push(`Auto-corrected backwards promotion: using next ladder stage`);
        }
      }
    } else {
      rawNext = null;
    }

    // Add explanation from pipeline state
    if (primaryNext && primaryNext.reason) {
      reasons.push(primaryNext.reason);
    }

    // Check for excluded stages — warn if current doc references them
    if (pState.excludedStages.length > 0) {
      const currentMapped = mapDocTypeToLadderStage(currentDocument);
      if (pState.excludedStages.includes(currentMapped as any)) {
        reasons.push(`Note: "${currentDocument}" is not part of the ${pState.formatKey} pipeline`);
      }
    }
  } else {
    // Fail closed: cannot compute next step without format + existing docs
    rawNext = null;
    reasons.push('Cannot determine next step: project format or existing documents missing');
    riskFlags.push('reason_code:MISSING_FORMAT_FOR_LADDER');
  }

  const next = isSeriesWriterTarget ? 'series_writer' : rawNext;

  // ── Runtime guard: next must be a canonical doc_type or series_writer ──
  if (next && next !== 'series_writer' && !BASE_DOC_TYPES[next]) {
    console.error(`[PromotionIntel] FATAL: computed next_document "${next}" is not in BASE_DOC_TYPES — failing closed`);
    riskFlags.push('hard_gate:non_canonical_next_doc');
    return {
      recommendation: 'stabilise',
      next_document: null,
      readiness_score: readinessScore,
      confidence,
      reasons: [...reasons, `Internal error: "${next}" is not a canonical doc_type`],
      must_fix_next: ['Report this issue — non-canonical doc type detected'],
      risk_flags: riskFlags,
      next_action: buildNoAction(),
    };
  }

  // ── Build NextAction ──
  let nextAction: NextAction;
  if (isSeriesWriterTarget) {
    nextAction = buildSeriesWriterAction();
  } else if (rawNext) {
    nextAction = buildPromoteAction(rawNext);
  } else {
    nextAction = buildNoAction();
  }

  // ── Decision bands (only reached when no hard gate fires) ──
  let recommendation: 'promote' | 'stabilise' | 'escalate';

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
    mustFixNext.push(nextAction.ctaLabel === 'Enter Series Writer' ? 'Enter Series Writer' : `Promote to ${nextAction.ctaLabel}`);
  } else if (recommendation === 'stabilise') {
    mustFixNext.push(...highImpactTexts.slice(0, 2));
    if (mustFixNext.length === 0) mustFixNext.push('Resolve high-impact notes');
    mustFixNext.push('Run another editorial pass');
  } else {
    mustFixNext.push('Run Executive Strategy Loop');
    mustFixNext.push('Consider repositioning format or lane');
  }

  // If not promoting, clear the next action
  const finalNextAction = recommendation === 'promote' ? nextAction : buildNoAction();

  return {
    recommendation,
    next_document: recommendation === 'promote' ? next : null,
    readiness_score: readinessScore,
    confidence,
    reasons,
    must_fix_next: mustFixNext,
    risk_flags: riskFlags,
    next_action: finalNextAction,
  };
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
