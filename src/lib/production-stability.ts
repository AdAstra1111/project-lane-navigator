/**
 * Production Stability Engine
 *
 * Computes production stability score from cost actuals,
 * daily reports, and schedule data.
 */

import type { DailyReport, CostActual } from '@/hooks/useProductionMonitoring';

export interface ProductionStabilityResult {
  score: number; // 0-100
  spendVariance: { score: number; totalBudgeted: number; totalActual: number; overagePct: number };
  scheduleAdherence: { score: number; daysReported: number; avgScenesPerDay: number; avgPagesPerDay: number };
  riskIncidents: { score: number; totalIncidents: number; severeCount: number };
  overageAlerts: OverageAlert[];
  slippageProbability: number; // 0-100
  slippageFactors: string[];
}

export interface OverageAlert {
  department: string;
  budgeted: number;
  actual: number;
  variancePct: number;
  severity: 'warning' | 'critical';
}

export function calculateProductionStability(
  reports: DailyReport[],
  actuals: CostActual[],
  totalPlannedScenes: number,
  totalShootDays: number,
): ProductionStabilityResult {
  // ── Spend Variance (40% of score) ──
  const totalBudgeted = actuals.reduce((s, a) => s + Number(a.budgeted), 0);
  const totalActual = actuals.reduce((s, a) => s + Number(a.actual), 0);
  const overagePct = totalBudgeted > 0 ? ((totalActual - totalBudgeted) / totalBudgeted) * 100 : 0;
  const spendScore = Math.max(0, Math.min(100,
    overagePct <= 0 ? 100 :
    overagePct <= 5 ? 85 :
    overagePct <= 10 ? 65 :
    overagePct <= 20 ? 40 :
    overagePct <= 30 ? 20 : 5
  ));

  // ── Schedule Adherence (35% of score) ──
  const daysReported = reports.length;
  const totalScenesShot = reports.reduce((s, r) => s + r.scenes_shot, 0);
  const totalPagesShot = reports.reduce((s, r) => s + Number(r.pages_shot), 0);
  const avgScenesPerDay = daysReported > 0 ? totalScenesShot / daysReported : 0;
  const avgPagesPerDay = daysReported > 0 ? totalPagesShot / daysReported : 0;

  let scheduleScore = 50; // baseline if no data
  if (daysReported > 0 && totalPlannedScenes > 0 && totalShootDays > 0) {
    const requiredScenesPerDay = totalPlannedScenes / totalShootDays;
    const ratio = avgScenesPerDay / requiredScenesPerDay;
    scheduleScore = Math.max(0, Math.min(100,
      ratio >= 1.1 ? 100 :
      ratio >= 1.0 ? 90 :
      ratio >= 0.85 ? 70 :
      ratio >= 0.7 ? 45 :
      ratio >= 0.5 ? 25 : 10
    ));
  }

  // ── Risk Incidents (25% of score) ──
  const incidentReports = reports.filter(r => r.incidents.trim().length > 0);
  const totalIncidents = incidentReports.length;
  const severeCount = reports.filter(r => r.incident_severity === 'major' || r.incident_severity === 'critical').length;
  let riskScore = 100;
  if (totalIncidents > 0) riskScore -= Math.min(40, totalIncidents * 8);
  if (severeCount > 0) riskScore -= Math.min(40, severeCount * 15);
  riskScore = Math.max(0, riskScore);

  // ── Composite Score ──
  const score = Math.round(spendScore * 0.4 + scheduleScore * 0.35 + riskScore * 0.25);

  // ── Overage Alerts ──
  const overageAlerts: OverageAlert[] = actuals
    .filter(a => Number(a.budgeted) > 0 && Number(a.variance_pct) > 5)
    .map(a => ({
      department: a.department,
      budgeted: Number(a.budgeted),
      actual: Number(a.actual),
      variancePct: Number(a.variance_pct),
      severity: Number(a.variance_pct) > 15 ? 'critical' as const : 'warning' as const,
    }))
    .sort((a, b) => b.variancePct - a.variancePct);

  // ── Slippage Probability ──
  const slippageFactors: string[] = [];
  let slippageProbability = 10; // baseline

  if (daysReported >= 3 && totalShootDays > 0 && totalPlannedScenes > 0) {
    const scenesRemaining = totalPlannedScenes - totalScenesShot;
    const daysRemaining = totalShootDays - daysReported;
    if (daysRemaining > 0 && avgScenesPerDay > 0) {
      const projectedDaysNeeded = scenesRemaining / avgScenesPerDay;
      if (projectedDaysNeeded > daysRemaining * 1.2) {
        slippageProbability += 30;
        slippageFactors.push(`At current pace, ${Math.ceil(projectedDaysNeeded)} days needed for ${scenesRemaining} remaining scenes (${daysRemaining} available)`);
      }
    }
  }

  if (severeCount >= 2) {
    slippageProbability += 20;
    slippageFactors.push(`${severeCount} severe incidents may cause production delays`);
  }

  if (overagePct > 15) {
    slippageProbability += 15;
    slippageFactors.push(`Budget overage of ${Math.round(overagePct)}% may force schedule compression`);
  }

  if (overageAlerts.filter(a => a.severity === 'critical').length >= 2) {
    slippageProbability += 10;
    slippageFactors.push('Multiple departments in critical overage');
  }

  slippageProbability = Math.min(95, slippageProbability);

  return {
    score,
    spendVariance: { score: spendScore, totalBudgeted, totalActual, overagePct },
    scheduleAdherence: { score: scheduleScore, daysReported, avgScenesPerDay: Math.round(avgScenesPerDay * 10) / 10, avgPagesPerDay: Math.round(avgPagesPerDay * 10) / 10 },
    riskIncidents: { score: riskScore, totalIncidents, severeCount },
    overageAlerts,
    slippageProbability,
    slippageFactors,
  };
}
