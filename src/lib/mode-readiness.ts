/**
 * Mode-specific readiness scoring — isolated per project format.
 * Each format has its own scoring algorithm that never cross-contaminates.
 */

import type { Project, FullAnalysis } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';
import type { BudgetSummary } from '@/lib/finance-readiness';
import { MODE_SCORING, type ScoringDimension } from '@/lib/mode-engine';

export interface ModeReadinessResult {
  score: number;
  stage: string;
  dimensions: { key: string; label: string; score: number; max: number }[];
  strengths: string[];
  blockers: string[];
  bestNextStep: string;
}

function getStage(score: number, format: string): string {
  if (format === 'commercial') {
    if (score >= 80) return 'Delivery-Ready';
    if (score >= 55) return 'In Production';
    if (score >= 30) return 'Awarded';
    return 'Pitching';
  }
  if (format === 'short-film') {
    if (score >= 80) return 'Festival-Ready';
    if (score >= 55) return 'In Post';
    if (score >= 30) return 'In Production';
    return 'Development';
  }
  if (format === 'documentary') {
    if (score >= 80) return 'Distribution-Ready';
    if (score >= 55) return 'In Production';
    if (score >= 30) return 'Funded';
    return 'Access Phase';
  }
  if (format === 'digital-series') {
    if (score >= 80) return 'Growth Phase';
    if (score >= 55) return 'Launched';
    if (score >= 30) return 'Funded';
    return 'Concept';
  }
  if (format === 'branded-content') {
    if (score >= 80) return 'Performance Phase';
    if (score >= 55) return 'In Production';
    if (score >= 30) return 'Funded';
    return 'Strategy';
  }
  // Default
  if (score >= 80) return 'Finance-Ready';
  if (score >= 55) return 'Packaged';
  if (score >= 30) return 'Building';
  return 'Early';
}

// ─── SHORT FILM ───

function scoreShortFilm(
  project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean, budgetSummary?: BudgetSummary,
): ModeReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // Festival Strength (25)
  let festival = 0;
  if (analysis?.structural_read) { festival += 10; strengths.push('AI analysis completed'); }
  if (project.genres?.length > 0) festival += 5;
  if (project.tone) festival += 5;
  if (project.comparable_titles) festival += 5;
  festival = Math.min(25, festival);

  // Talent Exposure (20)
  let talent = 0;
  const directorAttached = hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed'));
  if (directorAttached) { talent += 10; strengths.push('Director attached'); }
  else blockers.push('No director attached');
  if (cast.some(c => c.status === 'attached')) { talent += 5; strengths.push('Cast attached'); }
  if (hods.filter(h => h.status === 'attached' || h.status === 'confirmed').length >= 2) talent += 5;
  talent = Math.min(20, talent);

  // IP Expansion (20)
  let ip = 0;
  if (scripts.some(s => s.status === 'current')) { ip += 10; strengths.push('Current script attached'); }
  else if (scripts.length > 0) ip += 5;
  else blockers.push('No script attached');
  if (analysis?.creative_signal) ip += 5;
  if (project.comparable_titles) ip += 5;
  ip = Math.min(20, ip);

  // Proof of Concept (20)
  let poc = 0;
  if (budgetSummary && budgetSummary.count > 0) { poc += 10; strengths.push('Budget created'); }
  else blockers.push('No budget created');
  if (financeScenarios.length > 0) poc += 5;
  if (partners.length > 0) poc += 5;
  poc = Math.min(20, poc);

  // Awards (15)
  let awards = 0;
  if (project.tone) awards += 5;
  if (analysis?.market_reality) awards += 5;
  if (project.target_audience) awards += 5;
  awards = Math.min(15, awards);

  const score = festival + talent + ip + poc + awards;

  return {
    score,
    stage: getStage(score, 'short-film'),
    dimensions: [
      { key: 'festival', label: 'Festival Strength', score: festival, max: 25 },
      { key: 'talent-exposure', label: 'Talent Exposure', score: talent, max: 20 },
      { key: 'ip-expansion', label: 'IP Expansion', score: ip, max: 20 },
      { key: 'proof-of-concept', label: 'Proof of Concept', score: poc, max: 20 },
      { key: 'awards', label: 'Awards Probability', score: awards, max: 15 },
    ],
    strengths: strengths.slice(0, 3),
    blockers: blockers.slice(0, 3),
    bestNextStep: !directorAttached ? 'Attach a director to anchor your short.' :
      scripts.length === 0 ? 'Attach a script to define your creative.' :
      'Build your festival submission strategy.',
  };
}

// ─── DOCUMENTARY ───

function scoreDocumentary(
  project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean, budgetSummary?: BudgetSummary,
): ModeReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // Cultural Relevance (20)
  let cultural = 0;
  if (project.genres?.length > 0) cultural += 5;
  if (project.tone) cultural += 5;
  if (analysis?.creative_signal) { cultural += 5; strengths.push('Creative signal identified'); }
  if (project.comparable_titles) cultural += 5;
  cultural = Math.min(20, cultural);

  // Access Exclusivity (20)
  let access = 0;
  if (scripts.some(s => s.status === 'current')) { access += 10; strengths.push('Treatment/script attached'); }
  else if (scripts.length > 0) access += 5;
  else blockers.push('No treatment attached');
  if (analysis?.structural_read) access += 5;
  if (hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed'))) {
    access += 5; strengths.push('Director attached');
  }
  access = Math.min(20, access);

  // Festival Potential (15)
  let festival = 0;
  if (project.target_audience) festival += 5;
  if (analysis?.market_reality) festival += 5;
  if (project.tone) festival += 5;
  festival = Math.min(15, festival);

  // Broadcaster Fit (20)
  let broadcaster = 0;
  if (financeScenarios.length > 0) { broadcaster += 10; strengths.push('Finance scenario modelled'); }
  else blockers.push('No finance scenario');
  if (partners.some(p => p.status === 'confirmed')) broadcaster += 5;
  if (hasIncentiveInsights) broadcaster += 5;
  broadcaster = Math.min(20, broadcaster);

  // Impact Campaign (15)
  let impact = 0;
  if (budgetSummary && budgetSummary.count > 0) impact += 5;
  if (partners.length > 0) { impact += 5; strengths.push('Partners identified'); }
  if (project.budget_range) impact += 5;
  impact = Math.min(15, impact);

  // Clearance Risk (10)
  let clearance = 0;
  if (budgetSummary && budgetSummary.hasLocked) clearance += 5;
  if (analysis) clearance += 5;
  clearance = Math.min(10, clearance);

  const score = cultural + access + festival + broadcaster + impact + clearance;

  return {
    score,
    stage: getStage(score, 'documentary'),
    dimensions: [
      { key: 'cultural-relevance', label: 'Cultural Relevance', score: cultural, max: 20 },
      { key: 'access', label: 'Access Exclusivity', score: access, max: 20 },
      { key: 'festival', label: 'Festival Potential', score: festival, max: 15 },
      { key: 'broadcaster-fit', label: 'Broadcaster Fit', score: broadcaster, max: 20 },
      { key: 'impact', label: 'Impact Campaign', score: impact, max: 15 },
      { key: 'clearance', label: 'Clearance Risk', score: clearance, max: 10 },
    ],
    strengths: strengths.slice(0, 3),
    blockers: blockers.slice(0, 3),
    bestNextStep: scripts.length === 0 ? 'Attach a treatment to define your documentary.' :
      financeScenarios.length === 0 ? 'Create a funding model with grants and pre-sales.' :
      'Identify broadcasters and impact partners.',
  };
}

// ─── DIGITAL SERIES ───

function scoreDigitalSeries(
  project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean, budgetSummary?: BudgetSummary,
): ModeReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // Platform Fit (25)
  let platform = 0;
  if (project.target_audience) { platform += 8; strengths.push('Target audience defined'); }
  if (project.genres?.length > 0) platform += 5;
  if (analysis?.market_reality) platform += 7;
  if (project.tone) platform += 5;
  platform = Math.min(25, platform);

  // Audience Growth (20)
  let growth = 0;
  if (project.comparable_titles) growth += 5;
  if (analysis?.creative_signal) growth += 8;
  if (cast.length > 0) { growth += 7; strengths.push('Talent identified'); }
  growth = Math.min(20, growth);

  // Repeatability (20)
  let repeat = 0;
  if (scripts.some(s => s.status === 'current')) { repeat += 10; strengths.push('Script attached'); }
  else if (scripts.length > 0) repeat += 5;
  else blockers.push('No script/pilot attached');
  if (analysis?.structural_read) repeat += 5;
  if (project.format) repeat += 5;
  repeat = Math.min(20, repeat);

  // Influencer (15)
  let influencer = 0;
  if (cast.some(c => c.status === 'attached')) influencer += 8;
  if (partners.length > 0) influencer += 7;
  influencer = Math.min(15, influencer);

  // Retention (20)
  let retention = 0;
  if (financeScenarios.length > 0) { retention += 10; strengths.push('Finance modelled'); }
  else blockers.push('No finance scenario');
  if (budgetSummary && budgetSummary.count > 0) retention += 5;
  if (hods.some(h => h.status === 'attached' || h.status === 'confirmed')) retention += 5;
  retention = Math.min(20, retention);

  const score = platform + growth + repeat + influencer + retention;

  return {
    score,
    stage: getStage(score, 'digital-series'),
    dimensions: [
      { key: 'platform-fit', label: 'Platform Fit', score: platform, max: 25 },
      { key: 'audience-growth', label: 'Audience Growth', score: growth, max: 20 },
      { key: 'repeatability', label: 'Format Repeatability', score: repeat, max: 20 },
      { key: 'influencer', label: 'Influencer Leverage', score: influencer, max: 15 },
      { key: 'retention', label: 'Retention Probability', score: retention, max: 20 },
    ],
    strengths: strengths.slice(0, 3),
    blockers: blockers.slice(0, 3),
    bestNextStep: scripts.length === 0 ? 'Create a pilot script to prove the concept.' :
      !project.target_audience ? 'Define your target platform and audience.' :
      'Build a platform pitch deck with audience projections.',
  };
}

// ─── COMMERCIAL ───

function scoreCommercial(
  project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean, budgetSummary?: BudgetSummary,
): ModeReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // Brand Alignment (25)
  let brand = 0;
  if (project.tone) { brand += 8; strengths.push('Tone defined'); }
  if (project.target_audience) brand += 7;
  if (project.comparable_titles) brand += 5;
  if (analysis?.creative_signal) brand += 5;
  brand = Math.min(25, brand);

  // Director Fit (20)
  let director = 0;
  const dirAttached = hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed'));
  if (dirAttached) { director += 15; strengths.push('Director attached'); }
  else blockers.push('No director attached');
  if (scripts.some(s => s.status === 'current')) { director += 5; strengths.push('Treatment attached'); }
  director = Math.min(20, director);

  // Win Probability (20)
  let win = 0;
  if (budgetSummary && budgetSummary.count > 0) { win += 8; strengths.push('Budget created'); }
  else blockers.push('No budget created');
  if (financeScenarios.length > 0) win += 7;
  if (partners.length > 0) win += 5;
  win = Math.min(20, win);

  // Portfolio Value (15)
  let portfolio = 0;
  if (project.genres?.length > 0) portfolio += 5;
  if (analysis?.market_reality) portfolio += 5;
  if (project.budget_range) portfolio += 5;
  portfolio = Math.min(15, portfolio);

  // Awards (20)
  let awards = 0;
  if (analysis?.structural_read) awards += 8;
  if (project.tone) awards += 4;
  if (dirAttached) awards += 4;
  if (cast.some(c => c.status === 'attached')) awards += 4;
  awards = Math.min(20, awards);

  const score = brand + director + win + portfolio + awards;

  return {
    score,
    stage: getStage(score, 'commercial'),
    dimensions: [
      { key: 'brand-alignment', label: 'Brand Alignment', score: brand, max: 25 },
      { key: 'director-fit', label: 'Director Fit', score: director, max: 20 },
      { key: 'win-probability', label: 'Win Probability', score: win, max: 20 },
      { key: 'portfolio-value', label: 'Portfolio Value', score: portfolio, max: 15 },
      { key: 'awards', label: 'Awards Potential', score: awards, max: 20 },
    ],
    strengths: strengths.slice(0, 3),
    blockers: blockers.slice(0, 3),
    bestNextStep: !dirAttached ? 'Attach a director to strengthen your pitch.' :
      !(budgetSummary && budgetSummary.count > 0) ? 'Create a production budget with margin calculation.' :
      'Finalise treatment and submit to client.',
  };
}

// ─── BRANDED CONTENT ───

function scoreBrandedContent(
  project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean, budgetSummary?: BudgetSummary,
): ModeReadinessResult {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const analysis = project.analysis_passes as FullAnalysis | null;

  // Brand Story (25)
  let brandStory = 0;
  if (project.tone) brandStory += 8;
  if (project.target_audience) { brandStory += 7; strengths.push('Target audience defined'); }
  if (analysis?.creative_signal) brandStory += 5;
  if (project.comparable_titles) brandStory += 5;
  brandStory = Math.min(25, brandStory);

  // Cultural Authenticity (20)
  let cultural = 0;
  if (scripts.some(s => s.status === 'current')) { cultural += 10; strengths.push('Script attached'); }
  else if (scripts.length > 0) cultural += 5;
  else blockers.push('No creative material attached');
  if (analysis?.structural_read) cultural += 5;
  if (project.genres?.length > 0) cultural += 5;
  cultural = Math.min(20, cultural);

  // Platform Amplification (20)
  let platform = 0;
  if (partners.length > 0) { platform += 8; strengths.push('Distribution partners identified'); }
  if (financeScenarios.length > 0) platform += 7;
  if (hods.some(h => h.status === 'attached' || h.status === 'confirmed')) platform += 5;
  platform = Math.min(20, platform);

  // IP Expansion (15)
  let ip = 0;
  if (analysis?.market_reality) ip += 5;
  if (project.comparable_titles) ip += 5;
  if (budgetSummary && budgetSummary.count > 0) ip += 5;
  ip = Math.min(15, ip);

  // Engagement (20)
  let engagement = 0;
  if (cast.length > 0) engagement += 8;
  if (project.budget_range) engagement += 4;
  if (budgetSummary && budgetSummary.hasLocked) { engagement += 4; strengths.push('Budget locked'); }
  if (hasIncentiveInsights) engagement += 4;
  engagement = Math.min(20, engagement);

  const score = brandStory + cultural + platform + ip + engagement;

  return {
    score,
    stage: getStage(score, 'branded-content'),
    dimensions: [
      { key: 'brand-story', label: 'Brand Story Alignment', score: brandStory, max: 25 },
      { key: 'cultural-auth', label: 'Cultural Authenticity', score: cultural, max: 20 },
      { key: 'platform-amp', label: 'Platform Amplification', score: platform, max: 20 },
      { key: 'ip-expansion', label: 'IP Expansion', score: ip, max: 15 },
      { key: 'engagement', label: 'Audience Engagement', score: engagement, max: 20 },
    ],
    strengths: strengths.slice(0, 3),
    blockers: blockers.slice(0, 3),
    bestNextStep: scripts.length === 0 ? 'Develop creative material that aligns with brand values.' :
      partners.length === 0 ? 'Identify distribution and amplification partners.' :
      'Build performance analytics framework.',
  };
}

// ─── ROUTER ───

export function calculateModeReadiness(
  project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean, budgetSummary?: BudgetSummary,
): ModeReadinessResult | null {
  switch (project.format) {
    case 'short-film':
      return scoreShortFilm(project, cast, partners, scripts, financeScenarios, hods, hasIncentiveInsights, budgetSummary);
    case 'documentary':
      return scoreDocumentary(project, cast, partners, scripts, financeScenarios, hods, hasIncentiveInsights, budgetSummary);
    case 'digital-series':
      return scoreDigitalSeries(project, cast, partners, scripts, financeScenarios, hods, hasIncentiveInsights, budgetSummary);
    case 'commercial':
      return scoreCommercial(project, cast, partners, scripts, financeScenarios, hods, hasIncentiveInsights, budgetSummary);
    case 'branded-content':
      return scoreBrandedContent(project, cast, partners, scripts, financeScenarios, hods, hasIncentiveInsights, budgetSummary);
    default:
      return null; // film and tv-series use their own dedicated scoring
  }
}
