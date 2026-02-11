/**
 * TV Series Readiness Score — prioritises:
 * 1. Engine sustainability (25 pts)
 * 2. Format clarity (20 pts)
 * 3. Platform alignment (20 pts)
 * 4. Showrunner attachment (20 pts)
 * 5. Market & finance (15 pts)
 */

import type { Project } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';
import type { BudgetSummary } from '@/lib/finance-readiness';

export type TVReadinessStage = 'Concept' | 'Bible-Ready' | 'Packaged' | 'Commission-Ready';

export interface TVReadinessResult {
  score: number;
  stage: TVReadinessStage;
  strengths: string[];
  blockers: string[];
  bestNextStep: string;
  breakdown: {
    engine: number;
    format: number;
    platform: number;
    showrunner: number;
    market: number;
  };
}

function getStage(score: number): TVReadinessStage {
  if (score >= 80) return 'Commission-Ready';
  if (score >= 55) return 'Packaged';
  if (score >= 30) return 'Bible-Ready';
  return 'Concept';
}

export function calculateTVReadiness(
  project: Project,
  cast: ProjectCastMember[],
  partners: ProjectPartner[],
  scripts: ProjectScript[],
  financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
  hasIncentiveInsights: boolean,
  budgetSummary?: BudgetSummary,
): TVReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];

  // ---- Engine Sustainability (25 pts) ----
  let engineScore = 0;
  const currentScript = scripts.find(s => s.status === 'current');
  if (currentScript) {
    engineScore += 12;
    strengths.push('Pilot / bible attached');
    if (currentScript.notes) engineScore += 3;
    if (scripts.length > 1) {
      engineScore += 5;
      strengths.push('Script has revision history');
    }
  } else if (scripts.length > 0) {
    engineScore += 5;
  } else {
    blockers.push('No pilot or series bible attached');
  }
  // Analysis bonus
  if (project.analysis_passes) engineScore = Math.min(25, engineScore + 5);

  // ---- Format Clarity (20 pts) ----
  let formatScore = 0;
  if (project.format === 'tv-series') formatScore += 8;
  if (project.genres?.length > 0) {
    formatScore += 4;
    strengths.push(`Genre defined: ${project.genres.join(', ')}`);
  }
  if (project.tone) formatScore += 4;
  if (project.target_audience) formatScore += 4;

  // ---- Platform Alignment (20 pts) ----
  let platformScore = 0;
  if (project.budget_range) {
    platformScore += 6;
  }
  if (project.comparable_titles) {
    platformScore += 4;
  }
  const confirmedPartners = partners.filter(p => p.status === 'confirmed');
  if (confirmedPartners.length > 0) {
    platformScore += 10;
    strengths.push(`${confirmedPartners.length} partner(s) confirmed`);
  } else if (partners.length > 0) {
    platformScore += 4;
    strengths.push('Partner discussions active');
  } else {
    blockers.push('No platform or distribution partner identified');
  }

  // ---- Showrunner (20 pts) ----
  let showrunnerScore = 0;
  const REPUTATION_SCORE: Record<string, number> = { marquee: 6, acclaimed: 5, established: 4, emerging: 2 };
  const showrunnerDepts = ['Showrunner', 'Creator', 'Writer', 'Executive Producer'];
  const attachedShowrunners = hods.filter(h =>
    showrunnerDepts.includes(h.department) &&
    (h.status === 'attached' || h.status === 'confirmed')
  );

  if (attachedShowrunners.length > 0) {
    const best = attachedShowrunners.reduce((a, b) =>
      (REPUTATION_SCORE[a.reputation_tier] || 0) >= (REPUTATION_SCORE[b.reputation_tier] || 0) ? a : b
    );
    showrunnerScore += 10 + (REPUTATION_SCORE[best.reputation_tier] || 2);
    strengths.push(`${best.person_name} as ${best.department}`);
    if (best.status === 'confirmed') showrunnerScore += 4;
  } else {
    blockers.push('No showrunner or creator attached');
  }

  // Cast bonus (up to 4 pts)
  const attachedCast = cast.filter(c => c.status === 'attached' || c.status === 'confirmed');
  if (attachedCast.length > 0) {
    showrunnerScore = Math.min(20, showrunnerScore + Math.min(4, attachedCast.length * 2));
  }

  // ---- Market & Finance (15 pts) ----
  let marketScore = 0;
  if (financeScenarios.length > 0) {
    marketScore += 6;
    strengths.push('Finance scenario modelled');
  } else {
    blockers.push('No finance scenario created');
  }
  if (hasIncentiveInsights) {
    marketScore += 4;
  }
  if (budgetSummary?.count && budgetSummary.count > 0) {
    marketScore += 3;
  }
  if (project.assigned_lane) {
    marketScore += 2;
  }

  // Clamp
  engineScore = Math.min(25, engineScore);
  formatScore = Math.min(20, formatScore);
  platformScore = Math.min(20, platformScore);
  showrunnerScore = Math.min(20, showrunnerScore);
  marketScore = Math.min(15, marketScore);

  const totalScore = engineScore + formatScore + platformScore + showrunnerScore + marketScore;
  const stage = getStage(totalScore);

  // Best next step
  let bestNextStep = 'Continue developing your series package.';
  const sorted = [
    { area: 'engine', score: engineScore, max: 25 },
    { area: 'format', score: formatScore, max: 20 },
    { area: 'platform', score: platformScore, max: 20 },
    { area: 'showrunner', score: showrunnerScore, max: 20 },
    { area: 'market', score: marketScore, max: 15 },
  ].sort((a, b) => (a.score / a.max) - (b.score / b.max));

  const weakest = sorted[0];
  if (weakest.area === 'engine') bestNextStep = 'Attach a pilot script or series bible to demonstrate story engine sustainability.';
  else if (weakest.area === 'showrunner') bestNextStep = 'Attach a showrunner or creator — this is the #1 packaging signal for TV.';
  else if (weakest.area === 'platform') bestNextStep = 'Confirm a platform partner or distribution path to unlock commissioning.';
  else if (weakest.area === 'format') bestNextStep = 'Complete format details — genre, tone, and audience clarity drive platform decisions.';
  else if (weakest.area === 'market') bestNextStep = 'Create a finance scenario to model your series economics.';

  return {
    score: totalScore,
    stage,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 3),
    bestNextStep,
    breakdown: {
      engine: engineScore,
      format: formatScore,
      platform: platformScore,
      showrunner: showrunnerScore,
      market: marketScore,
    },
  };
}