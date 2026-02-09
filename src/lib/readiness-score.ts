/**
 * Calculates a 0-100 readiness score for a project based on:
 * - Script readiness
 * - Packaging (cast + partners)
 * - Finance fit (incentives, co-pro, scenarios)
 * - Market & timing
 */

import type { Project, FullAnalysis } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';

export type ReadinessStage = 'Early' | 'Building' | 'Packaged' | 'Finance-Ready';

export interface ReadinessResult {
  score: number;
  stage: ReadinessStage;
  strengths: string[];
  blockers: string[];
  bestNextStep: string;
  breakdown: {
    script: number;
    packaging: number;
    finance: number;
    market: number;
  };
}

function getStage(score: number): ReadinessStage {
  if (score >= 80) return 'Finance-Ready';
  if (score >= 55) return 'Packaged';
  if (score >= 30) return 'Building';
  return 'Early';
}

export function calculateReadiness(
  project: Project,
  cast: ProjectCastMember[],
  partners: ProjectPartner[],
  scripts: ProjectScript[],
  financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
  hasIncentiveInsights: boolean,
): ReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // ---- Script (25 points) ----
  let scriptScore = 0;
  const currentScript = scripts.find(s => s.status === 'current');
  if (currentScript) {
    scriptScore += 15;
    strengths.push('Current script version attached');
    if (currentScript.notes) scriptScore += 5;
    if (scripts.length > 1) {
      scriptScore += 5;
      strengths.push('Script has revision history');
    }
  } else if (scripts.length > 0) {
    scriptScore += 8;
  } else {
    blockers.push('No script attached');
  }
  if (analysis?.structural_read) {
    scriptScore = Math.min(25, scriptScore + 5);
  }

  // ---- Packaging (30 points): Cast 10 + HODs 10 + Partners 10 ----
  let packagingScore = 0;

  // Cast (10 pts)
  const attachedCast = cast.filter(c => c.status === 'attached');
  const approachedCast = cast.filter(c => c.status === 'approached' || c.status === 'interested');
  
  if (attachedCast.length > 0) {
    packagingScore += 10;
    strengths.push(`${attachedCast.length} cast attached`);
  } else if (approachedCast.length > 0) {
    packagingScore += 5;
    strengths.push(`${approachedCast.length} cast in discussion`);
  } else if (cast.length > 0) {
    packagingScore += 2;
  } else {
    blockers.push('No cast identified');
  }

  // HODs (10 pts) — Director is worth the most
  const REPUTATION_SCORE: Record<string, number> = { marquee: 4, acclaimed: 3, established: 2, emerging: 1 };
  const KEY_DEPARTMENTS = ['Writer', 'Director', 'Director of Photography', 'Producer', 'Executive Producer'];
  const attachedHods = hods.filter(h => h.status === 'attached' || h.status === 'confirmed');
  const directorAttached = attachedHods.find(h => h.department === 'Director');

  if (directorAttached) {
    const directorRep = REPUTATION_SCORE[directorAttached.reputation_tier] || 1;
    packagingScore += Math.min(5, directorRep + 2); // 3-5 pts based on reputation
    strengths.push(`Director attached (${directorAttached.reputation_tier})`);
  } else if (hods.some(h => h.department === 'Director')) {
    packagingScore += 1;
  } else {
    blockers.push('No director attached');
  }

  const otherKeyHods = attachedHods.filter(h => h.department !== 'Director' && KEY_DEPARTMENTS.includes(h.department));
  if (otherKeyHods.length > 0) {
    const bestRep = Math.max(...otherKeyHods.map(h => REPUTATION_SCORE[h.reputation_tier] || 1));
    packagingScore += Math.min(5, otherKeyHods.length + bestRep); // up to 5 pts
    if (otherKeyHods.length >= 2) strengths.push(`${otherKeyHods.length} key HODs attached`);
  }

  // Partners (10 pts)
  const confirmedPartners = partners.filter(p => p.status === 'confirmed');
  const activePartners = partners.filter(p => p.status === 'in-discussion' || p.status === 'confirmed');
  
  if (confirmedPartners.length > 0) {
    packagingScore += 10;
    strengths.push(`${confirmedPartners.length} partner(s) confirmed`);
  } else if (activePartners.length > 0) {
    packagingScore += 5;
    strengths.push('Partner discussions active');
  } else if (partners.length > 0) {
    packagingScore += 2;
  } else {
    blockers.push('No partners or sales path identified');
  }

  // ---- Finance (25 points) ----
  let financeScore = 0;
  if (financeScenarios.length > 0) {
    financeScore += 10;
    strengths.push('Finance scenario modelled');
    const highConf = financeScenarios.some(s => s.confidence === 'high');
    if (highConf) financeScore += 5;
  } else {
    blockers.push('No finance scenario created');
  }

  if (hasIncentiveInsights) {
    financeScore += 8;
    strengths.push('Incentive analysis completed');
  } else {
    blockers.push('Incentive analysis not yet run');
  }

  if (project.assigned_lane) {
    financeScore += 2;
  }

  // ---- Market & Timing (20 points) ----
  let marketScore = 0;
  if (project.genres?.length > 0) marketScore += 5;
  if (project.budget_range) marketScore += 3;
  if (project.target_audience) marketScore += 3;
  if (project.tone) marketScore += 2;
  if (project.comparable_titles) marketScore += 2;
  if (analysis) marketScore += 5;

  // Clamp subscores
  scriptScore = Math.min(25, scriptScore);
  packagingScore = Math.min(30, packagingScore);
  financeScore = Math.min(25, financeScore);
  marketScore = Math.min(20, marketScore);

  const totalScore = scriptScore + packagingScore + financeScore + marketScore;
  const stage = getStage(totalScore);

  // Best next step
  let bestNextStep = 'Continue building your project dossier.';
  const sortedBlockers = [
    { area: 'script', score: scriptScore, max: 25 },
    { area: 'packaging', score: packagingScore, max: 30 },
    { area: 'finance', score: financeScore, max: 25 },
    { area: 'market', score: marketScore, max: 20 },
  ].sort((a, b) => (a.score / a.max) - (b.score / b.max));

  const weakest = sortedBlockers[0];
  if (weakest.area === 'script') bestNextStep = 'Attach a current script version to strengthen your package.';
  else if (weakest.area === 'packaging') {
    if (!directorAttached) bestNextStep = 'Attach a director to significantly strengthen your package.';
    else if (attachedCast.length === 0) bestNextStep = 'Attach at least one lead cast member to unlock pre-sales potential.';
    else bestNextStep = 'Confirm a sales agent or co-production partner.';
  }
  else if (weakest.area === 'finance') bestNextStep = !hasIncentiveInsights
    ? 'Run the Incentive Analysis to identify financing opportunities.'
    : 'Create a finance scenario to model your capital stack.';
  else if (weakest.area === 'market') bestNextStep = 'Complete your project details (genre, budget, audience, tone).';

  return {
    score: totalScore,
    stage,
    strengths: strengths.slice(0, 3),
    blockers: blockers.slice(0, 3),
    bestNextStep,
    breakdown: {
      script: scriptScore,
      packaging: packagingScore,
      finance: financeScore,
      market: marketScore,
    },
  };
}
