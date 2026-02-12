/**
 * Per-stage readiness calculators for IFFY's 6 lifecycle stages.
 * Each returns a StageReadinessResult with score, strengths, blockers, and breakdown.
 */

import type { Project, FullAnalysis } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';
import type { BudgetSummary } from '@/lib/finance-readiness';
import type { ScheduleMetrics } from '@/lib/schedule-impact';
import type { LifecycleStage } from '@/lib/lifecycle-stages';

export interface StageBreakdownItem {
  label: string;
  score: number;
  max: number;
}

export interface StageReadinessResult {
  stage: LifecycleStage;
  score: number;
  strengths: string[];
  blockers: string[];
  bestNextStep: string;
  breakdown: StageBreakdownItem[];
}

// ─── DEVELOPMENT ───────────────────────────────────────────────

export function calculateDevelopmentReadiness(
  project: Project,
  scripts: ProjectScript[],
  coverageVerdict?: string,
): StageReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // Script Quality (30)
  let scriptQuality = 0;
  const currentScript = scripts.find(s => s.status === 'current');
  if (currentScript) {
    scriptQuality += 18;
    strengths.push('Current script attached');
    if (currentScript.notes) scriptQuality += 4;
    if (scripts.length > 1) { scriptQuality += 4; strengths.push('Script revision history'); }
  } else if (scripts.length > 0) {
    scriptQuality += 8;
  } else {
    blockers.push('No script attached');
  }
  if (analysis?.structural_read) scriptQuality = Math.min(30, scriptQuality + 4);

  const verdict = coverageVerdict || project.script_coverage_verdict;
  if (verdict === 'RECOMMEND') { scriptQuality = Math.min(30, scriptQuality + 5); strengths.push('Coverage: RECOMMEND'); }
  else if (verdict === 'CONSIDER') { scriptQuality = Math.min(30, scriptQuality + 2); }
  else if (verdict === 'PASS') { blockers.push('Coverage: PASS — revisions needed'); }

  // IP Clarity (20)
  let ipClarity = 0;
  if (project.comparable_titles) { ipClarity += 8; }
  if (analysis) { ipClarity += 7; strengths.push('Analysis passes completed'); }
  if ((project as any).logline) { ipClarity += 5; }
  else if (project.comparable_titles) { ipClarity += 3; }

  // Audience Clarity (25)
  let audienceClarity = 0;
  if (project.target_audience) { audienceClarity += 10; }
  else { blockers.push('Target audience not set'); }
  if (project.genres?.length > 0) { audienceClarity += 8; }
  if (project.tone) { audienceClarity += 7; }

  // Commercial Tension (25)
  let commercial = 0;
  if (project.budget_range) { commercial += 10; }
  if (project.assigned_lane) { commercial += 10; strengths.push(`Lane: ${project.assigned_lane}`); }
  if (project.confidence != null && project.confidence > 0.6) { commercial += 5; }

  scriptQuality = Math.min(30, scriptQuality);
  ipClarity = Math.min(20, ipClarity);
  audienceClarity = Math.min(25, audienceClarity);
  commercial = Math.min(25, commercial);

  const score = scriptQuality + ipClarity + audienceClarity + commercial;

  let bestNextStep = 'Continue developing your project.';
  if (scriptQuality < 15) bestNextStep = 'Attach a current script draft to unlock analysis.';
  else if (audienceClarity < 12) bestNextStep = 'Define your target audience and tone.';
  else if (commercial < 12) bestNextStep = 'Run analysis to classify your monetisation lane.';

  return {
    stage: 'development',
    score,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 4),
    bestNextStep,
    breakdown: [
      { label: 'Script Quality', score: scriptQuality, max: 30 },
      { label: 'IP Clarity', score: ipClarity, max: 20 },
      { label: 'Audience Clarity', score: audienceClarity, max: 25 },
      { label: 'Commercial Tension', score: commercial, max: 25 },
    ],
  };
}

// ─── PACKAGING ─────────────────────────────────────────────────

export function calculatePackagingReadiness(
  project: Project,
  cast: ProjectCastMember[],
  partners: ProjectPartner[],
  hods: ProjectHOD[],
): StageReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];

  // Cast Strength (30)
  let castScore = 0;
  const attached = cast.filter(c => c.status === 'attached');
  const approached = cast.filter(c => c.status === 'approached' || c.status === 'interested');
  if (attached.length > 0) { castScore += 25; strengths.push(`${attached.length} cast attached`); if (attached.length >= 2) castScore += 5; }
  else if (approached.length > 0) { castScore += 12; strengths.push(`${approached.length} cast in discussion`); }
  else if (cast.length > 0) { castScore += 4; }
  else { blockers.push('No cast identified'); }

  // Director & Key HODs (30)
  let hodScore = 0;
  const REP: Record<string, number> = { marquee: 5, acclaimed: 4, established: 3, emerging: 2 };
  const attachedHods = hods.filter(h => h.status === 'attached' || h.status === 'confirmed');
  const director = attachedHods.find(h => h.department === 'Director');
  if (director) {
    hodScore += 15 + (REP[director.reputation_tier] || 2);
    strengths.push(`Director attached (${director.reputation_tier})`);
  } else if (hods.some(h => h.department === 'Director')) {
    hodScore += 5;
  } else {
    blockers.push('No director attached');
  }
  const otherKey = attachedHods.filter(h => h.department !== 'Director');
  hodScore += Math.min(10, otherKey.length * 3);
  if (otherKey.length >= 2) strengths.push(`${otherKey.length} key HODs attached`);

  // Partners & Sales Path (25)
  let partnerScore = 0;
  const confirmed = partners.filter(p => p.status === 'confirmed');
  const active = partners.filter(p => p.status === 'in-discussion' || p.status === 'confirmed');
  if (confirmed.length > 0) { partnerScore += 25; strengths.push(`${confirmed.length} partner(s) confirmed`); }
  else if (active.length > 0) { partnerScore += 12; strengths.push('Partner discussions active'); }
  else if (partners.length > 0) { partnerScore += 4; }
  else { blockers.push('No sales agent or partner identified'); }

  // Commitment Levels (15)
  let commitmentScore = 0;
  const hardCommits = attached.length + confirmed.length + attachedHods.length;
  if (hardCommits >= 4) { commitmentScore += 15; }
  else if (hardCommits >= 2) { commitmentScore += 10; }
  else if (hardCommits >= 1) { commitmentScore += 5; }
  else { blockers.push('No hard commitments yet'); }

  castScore = Math.min(30, castScore);
  hodScore = Math.min(30, hodScore);
  partnerScore = Math.min(25, partnerScore);
  commitmentScore = Math.min(15, commitmentScore);

  const score = castScore + hodScore + partnerScore + commitmentScore;

  let bestNextStep = 'Continue building your package.';
  if (!director) bestNextStep = 'Attach a director to significantly strengthen your package.';
  else if (attached.length === 0) bestNextStep = 'Secure at least one lead cast attachment.';
  else if (confirmed.length === 0) bestNextStep = 'Confirm a sales agent or co-production partner.';

  return {
    stage: 'packaging',
    score,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 4),
    bestNextStep,
    breakdown: [
      { label: 'Cast Strength', score: castScore, max: 30 },
      { label: 'Director & HODs', score: hodScore, max: 30 },
      { label: 'Partners & Sales', score: partnerScore, max: 25 },
      { label: 'Commitment Level', score: commitmentScore, max: 15 },
    ],
  };
}

// ─── PRE-PRODUCTION ────────────────────────────────────────────

export function calculatePreProductionReadiness(
  project: Project,
  financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
  hasIncentiveInsights: boolean,
  budgetSummary?: BudgetSummary,
  scheduleMetrics?: ScheduleMetrics,
): StageReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];

  // Budget Completeness (30)
  let budgetScore = 0;
  if (budgetSummary?.hasLocked) { budgetScore += 25; strengths.push('Budget locked'); }
  else if (budgetSummary && budgetSummary.count > 0) { budgetScore += 10; strengths.push('Budget draft created'); }
  else { blockers.push('No budget created'); }
  if (financeScenarios.length > 0) { budgetScore += 5; strengths.push('Finance scenario modelled'); }

  // Schedule (25)
  let scheduleScore = 0;
  if (scheduleMetrics?.hasSchedule) {
    if (scheduleMetrics.scheduleConfidence === 'high') {
      scheduleScore += 25;
      strengths.push(`Schedule locked (${scheduleMetrics.shootDayCount} days)`);
    } else if (scheduleMetrics.scheduleConfidence === 'medium') {
      scheduleScore += 15;
      strengths.push('Schedule in progress');
    } else {
      scheduleScore += 8;
    }
    if (scheduleMetrics.overtimeRiskLevel === 'high') blockers.push('High overtime risk flagged');
  } else {
    blockers.push('No production schedule created');
  }

  // Incentives & Finance (25)
  let financeScore = 0;
  if (hasIncentiveInsights) { financeScore += 15; strengths.push('Incentive analysis completed'); }
  else { blockers.push('Incentive analysis not run'); }
  if (financeScenarios.some(s => s.confidence === 'high')) { financeScore += 10; }
  else if (financeScenarios.length > 0) { financeScore += 5; }

  // Department Readiness (20)
  let deptScore = 0;
  const confirmedHods = hods.filter(h => h.status === 'attached' || h.status === 'confirmed');
  const KEY_DEPTS = ['Director', 'Producer', 'Director of Photography', 'Production Designer', 'Line Producer'];
  const filledKey = confirmedHods.filter(h => KEY_DEPTS.includes(h.department));
  deptScore += Math.min(20, filledKey.length * 4);
  if (filledKey.length >= 4) strengths.push('Key departments staffed');
  else if (filledKey.length < 2) blockers.push('Key department heads not yet hired');

  budgetScore = Math.min(30, budgetScore);
  scheduleScore = Math.min(25, scheduleScore);
  financeScore = Math.min(25, financeScore);
  deptScore = Math.min(20, deptScore);

  const score = budgetScore + scheduleScore + financeScore + deptScore;

  let bestNextStep = 'Continue pre-production planning.';
  if (!budgetSummary?.hasLocked) bestNextStep = 'Lock your production budget.';
  else if (!scheduleMetrics?.hasSchedule) bestNextStep = 'Create a production schedule.';
  else if (!hasIncentiveInsights) bestNextStep = 'Run incentive analysis to identify financing.';

  return {
    stage: 'pre-production',
    score,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 4),
    bestNextStep,
    breakdown: [
      { label: 'Budget', score: budgetScore, max: 30 },
      { label: 'Schedule', score: scheduleScore, max: 25 },
      { label: 'Incentives & Finance', score: financeScore, max: 25 },
      { label: 'Department Readiness', score: deptScore, max: 20 },
    ],
  };
}

// ─── PRODUCTION ────────────────────────────────────────────────

export function calculateProductionReadiness(
  budgetSummary?: BudgetSummary,
  scheduleMetrics?: ScheduleMetrics,
  costEntries?: { amount: number; entry_date: string }[],
): StageReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];

  // Spend vs Budget (35)
  let spendScore = 0;
  const totalSpent = costEntries?.reduce((s, c) => s + Number(c.amount || 0), 0) || 0;
  const totalBudget = budgetSummary?.lockedTotal || 0;
  if (totalBudget > 0 && totalSpent > 0) {
    const ratio = totalSpent / totalBudget;
    if (ratio <= 1.0) { spendScore = 35; strengths.push('Spending within budget'); }
    else if (ratio <= 1.05) { spendScore = 25; strengths.push('Slight overage (<5%)'); }
    else if (ratio <= 1.15) { spendScore = 15; blockers.push(`Budget overage: ${Math.round((ratio - 1) * 100)}%`); }
    else { spendScore = 5; blockers.push(`Significant overage: ${Math.round((ratio - 1) * 100)}%`); }
  } else if (totalBudget > 0) {
    spendScore = 20; // Budget exists, no spend tracked yet
  } else {
    blockers.push('No budget to track against');
  }

  // Schedule Adherence (35)
  let scheduleScore = 0;
  if (scheduleMetrics?.hasSchedule) {
    const coverage = scheduleMetrics.totalScenes > 0
      ? scheduleMetrics.scheduledScenes / scheduleMetrics.totalScenes
      : 0;
    if (coverage >= 0.9) { scheduleScore = 35; strengths.push('Schedule on track'); }
    else if (coverage >= 0.7) { scheduleScore = 25; strengths.push('Schedule mostly on track'); }
    else { scheduleScore = 15; blockers.push('Schedule gaps detected'); }
    if (scheduleMetrics.overtimeRiskLevel === 'high') { scheduleScore = Math.max(5, scheduleScore - 10); blockers.push('High overtime risk'); }
  } else {
    scheduleScore = 10;
    blockers.push('No schedule to track adherence');
  }

  // Risk Management (30)
  let riskScore = 15; // Base score — full risk log tracking is future phase
  if (totalBudget > 0 && totalSpent > 0 && (totalSpent / totalBudget) <= 1.0) riskScore += 10;
  if (scheduleMetrics?.hasSchedule && scheduleMetrics.overtimeRiskLevel !== 'high') riskScore += 5;

  spendScore = Math.min(35, spendScore);
  scheduleScore = Math.min(35, scheduleScore);
  riskScore = Math.min(30, riskScore);

  const score = spendScore + scheduleScore + riskScore;

  let bestNextStep = 'Monitor production progress.';
  if (!totalBudget) bestNextStep = 'Lock a budget to enable spend tracking.';
  else if (totalSpent === 0) bestNextStep = 'Begin logging production costs.';
  else if (scheduleScore < 20) bestNextStep = 'Address schedule gaps and slippage risks.';

  return {
    stage: 'production',
    score,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 4),
    bestNextStep,
    breakdown: [
      { label: 'Spend vs Budget', score: spendScore, max: 35 },
      { label: 'Schedule Adherence', score: scheduleScore, max: 35 },
      { label: 'Risk Management', score: riskScore, max: 30 },
    ],
  };
}

// ─── POST-PRODUCTION ───────────────────────────────────────────

export function calculatePostReadiness(
  deliverables?: { status: string }[],
  budgetSummary?: BudgetSummary,
  costEntries?: { amount: number }[],
  milestones?: { status: string; due_date: string | null }[],
  editVersions?: { screening_score: number | null }[],
  vfxShots?: { status: string; due_date: string | null }[],
): StageReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];

  // Milestone Completion (25)
  let milestoneScore = 0;
  const allMilestones = milestones || [];
  const completedMs = allMilestones.filter(m => m.status === 'complete');
  const overdueMs = allMilestones.filter(m => m.status !== 'complete' && m.due_date && new Date(m.due_date) < new Date());
  if (allMilestones.length > 0) {
    const pct = completedMs.length / allMilestones.length;
    milestoneScore = Math.round(pct * 25);
    if (pct >= 0.9) strengths.push('Post milestones nearly complete');
    else if (pct >= 0.5) strengths.push(`${completedMs.length}/${allMilestones.length} milestones done`);
    if (overdueMs.length > 0) blockers.push(`${overdueMs.length} overdue milestone(s)`);
  } else {
    milestoneScore = 3;
    blockers.push('No post milestones tracked');
  }

  // Delivery Readiness (25)
  let deliveryScore = 0;
  const allDeliverables = deliverables || [];
  const completed = allDeliverables.filter(d => d.status === 'delivered' || d.status === 'approved');
  if (allDeliverables.length > 0) {
    const pct = completed.length / allDeliverables.length;
    deliveryScore = Math.round(pct * 25);
    if (pct >= 0.9) strengths.push('Deliverables nearly complete');
    else if (pct >= 0.5) strengths.push(`${completed.length}/${allDeliverables.length} deliverables done`);
    else blockers.push(`Only ${completed.length}/${allDeliverables.length} deliverables complete`);
  } else {
    deliveryScore = 3;
    blockers.push('No deliverables tracked');
  }

  // VFX & Creative Lock (25)
  let creativeLock = 0;
  const allVfx = vfxShots || [];
  const doneVfx = allVfx.filter(s => s.status === 'final' || s.status === 'approved');
  const allVersions = editVersions || [];
  if (allVfx.length > 0) {
    const vfxPct = doneVfx.length / allVfx.length;
    creativeLock += Math.round(vfxPct * 15);
    if (vfxPct >= 0.9) strengths.push('VFX shots nearly finalized');
    const overdueVfx = allVfx.filter(s => !['final', 'approved'].includes(s.status) && s.due_date && new Date(s.due_date) < new Date());
    if (overdueVfx.length > 0) blockers.push(`${overdueVfx.length} overdue VFX shot(s)`);
  } else {
    creativeLock += 5; // No VFX needed is fine
  }
  if (allVersions.length > 0) {
    creativeLock += Math.min(10, allVersions.length * 3);
    strengths.push(`${allVersions.length} edit version(s) logged`);
  }

  // Post Budget Adherence (25)
  let postBudgetScore = 10;
  if (budgetSummary?.hasLocked) {
    postBudgetScore += 8;
    strengths.push('Budget tracked through post');
  }
  const totalSpent = costEntries?.reduce((s, c) => s + Number(c.amount || 0), 0) || 0;
  if (budgetSummary?.lockedTotal && totalSpent > 0) {
    const ratio = totalSpent / budgetSummary.lockedTotal;
    if (ratio <= 1.0) postBudgetScore += 7;
    else blockers.push('Post budget overrun detected');
  }

  milestoneScore = Math.min(25, milestoneScore);
  deliveryScore = Math.min(25, deliveryScore);
  creativeLock = Math.min(25, creativeLock);
  postBudgetScore = Math.min(25, postBudgetScore);

  const score = milestoneScore + deliveryScore + creativeLock + postBudgetScore;

  let bestNextStep = 'Continue post-production.';
  if (allMilestones.length === 0) bestNextStep = 'Set up post-production milestones.';
  else if (allDeliverables.length === 0) bestNextStep = 'Set up your delivery checklist.';
  else if (overdueMs.length > 0) bestNextStep = 'Address overdue milestones.';
  else if (completed.length < allDeliverables.length) bestNextStep = 'Complete outstanding deliverables.';

  return {
    stage: 'post-production',
    score,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 4),
    bestNextStep,
    breakdown: [
      { label: 'Milestones', score: milestoneScore, max: 25 },
      { label: 'Deliverables', score: deliveryScore, max: 25 },
      { label: 'VFX & Creative', score: creativeLock, max: 25 },
      { label: 'Post Budget', score: postBudgetScore, max: 25 },
    ],
  };
}

// ─── SALES & DELIVERY ──────────────────────────────────────────

export function calculateSalesReadiness(
  project: Project,
  partners: ProjectPartner[],
  deals?: { status: string; territory: string }[],
  deliverables?: { status: string }[],
): StageReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];

  // Territory Sales (35)
  let salesScore = 0;
  const allDeals = deals || [];
  const closedDeals = allDeals.filter(d => d.status === 'closed' || d.status === 'signed');
  const activeDeals = allDeals.filter(d => d.status === 'negotiating' || d.status === 'offered');
  if (closedDeals.length > 0) {
    salesScore += 25;
    strengths.push(`${closedDeals.length} deal(s) closed`);
    const territories = new Set(closedDeals.map(d => d.territory));
    if (territories.size >= 3) { salesScore += 10; strengths.push(`${territories.size} territories sold`); }
    else { salesScore += 5; }
  } else if (activeDeals.length > 0) {
    salesScore += 12;
    strengths.push(`${activeDeals.length} deal(s) in negotiation`);
  } else if (allDeals.length > 0) {
    salesScore += 5;
  } else {
    blockers.push('No deals tracked');
  }

  // Distribution Path (25)
  let distScore = 0;
  const confirmedPartners = partners.filter(p => p.status === 'confirmed');
  if (confirmedPartners.length > 0) {
    distScore += 25;
    strengths.push('Distribution partner confirmed');
  } else if (partners.some(p => p.status === 'in-discussion')) {
    distScore += 12;
  } else {
    blockers.push('No distribution partner');
  }

  // Delivery Compliance (25)
  let deliveryScore = 0;
  const allDeliverables = deliverables || [];
  const completed = allDeliverables.filter(d => d.status === 'delivered' || d.status === 'approved');
  if (allDeliverables.length > 0) {
    const pct = completed.length / allDeliverables.length;
    deliveryScore = Math.round(pct * 25);
    if (pct >= 0.9) strengths.push('Delivery materials ready');
    else blockers.push('Delivery materials incomplete');
  } else {
    deliveryScore = 5;
  }

  // Marketing & Positioning (15)
  let marketingScore = 0;
  if (project.comparable_titles) marketingScore += 5;
  if (project.genres?.length > 0) marketingScore += 5;
  if (project.target_audience) marketingScore += 5;

  salesScore = Math.min(35, salesScore);
  distScore = Math.min(25, distScore);
  deliveryScore = Math.min(25, deliveryScore);
  marketingScore = Math.min(15, marketingScore);

  const score = salesScore + distScore + deliveryScore + marketingScore;

  let bestNextStep = 'Continue sales efforts.';
  if (closedDeals.length === 0 && activeDeals.length === 0) bestNextStep = 'Begin territory sales outreach.';
  else if (confirmedPartners.length === 0) bestNextStep = 'Confirm a distribution partner.';
  else if (deliveryScore < 15) bestNextStep = 'Complete delivery materials for buyers.';

  return {
    stage: 'sales-delivery',
    score,
    strengths: strengths.slice(0, 4),
    blockers: blockers.slice(0, 4),
    bestNextStep,
    breakdown: [
      { label: 'Territory Sales', score: salesScore, max: 35 },
      { label: 'Distribution Path', score: distScore, max: 25 },
      { label: 'Delivery Compliance', score: deliveryScore, max: 25 },
      { label: 'Marketing & Position', score: marketingScore, max: 15 },
    ],
  };
}
