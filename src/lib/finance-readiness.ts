/**
 * Finance Readiness Engine
 * 
 * Evaluates whether a project is structurally viable for financing
 * before detailed budgeting. Computes:
 * - Finance Readiness Score (0–100)
 * - Implied Budget Bands (Low / Target / Stretch)
 * - Volatility Index
 * - Budget Module assessments
 * - Structural Risk Flags
 * - Geography Sensitivity
 */

import type { Project, FullAnalysis } from '@/lib/types';
import type {
  ProjectCastMember,
  ProjectPartner,
  ProjectScript,
  ProjectFinanceScenario,
  ProjectHOD,
} from '@/hooks/useProjectAttachments';

// ---- Types ----

export type VolatilityLevel = 'Low' | 'Medium' | 'High';
export type ConfidenceLevel = 'Low' | 'Medium' | 'High';
export type GeographySensitivity = 'Neutral' | 'Incentive-Dependent' | 'Highly Dependent';

export interface BudgetBand {
  label: string;         // e.g. "Micro", "Low", "Mid", "Upper-Mid", "Studio-Scale"
  rangeHint: string;     // e.g. "$1M – $5M"
  confidence: ConfidenceLevel;
}

export interface BudgetModule {
  name: string;
  scopeConfidence: ConfidenceLevel;
  volatilityRisk: VolatilityLevel;
  narrativePressure: string;   // short explanation
  marketPressure: string;      // short explanation
}

export interface RiskFlag {
  tag: string;
  explanation: string;
  mitigation: string;
}

export interface FinanceReadinessSubscores {
  scriptClarity: number;
  packagingStrength: number;
  financeStructure: number;
  marketPosition: number;
  geography: number;
  narrativeCoherence: number;
}

export interface FinanceReadinessResult {
  score: number;                          // 0–100
  volatilityIndex: VolatilityLevel;
  geographySensitivity: GeographySensitivity;
  subscores: FinanceReadinessSubscores;
  budgetBands: {
    low: BudgetBand;
    target: BudgetBand;
    stretch: BudgetBand;
  };
  modules: BudgetModule[];
  riskFlags: RiskFlag[];
  strengths: string[];
}

// ---- Constants ----

const BUDGET_BAND_MAP: Record<string, { micro: string; low: string; target: string; stretch: string }> = {
  'under-250k':  { micro: 'Micro',     low: 'Under $250K', target: '$250K – $500K', stretch: '$500K – $1M' },
  '250k-1m':     { micro: 'Low',       low: '$250K – $500K', target: '$500K – $1M', stretch: '$1M – $3M' },
  '1m-5m':       { micro: 'Mid-Low',   low: '$1M – $2M', target: '$2M – $5M', stretch: '$5M – $8M' },
  '5m-15m':      { micro: 'Mid',       low: '$5M – $8M', target: '$8M – $15M', stretch: '$15M – $25M' },
  '15m-50m':     { micro: 'Upper-Mid', low: '$15M – $25M', target: '$25M – $50M', stretch: '$50M – $75M' },
  '50m-plus':    { micro: 'Studio-Scale', low: '$50M – $75M', target: '$75M – $120M', stretch: '$120M+' },
};

const MODULE_NAMES = [
  'Above the Line',
  'Below the Line',
  'Locations & Logistics',
  'Schedule',
  'Post-Production',
  'VFX / Scale',
  'Contingency',
  'Soft Money & Incentives',
] as const;

const REPUTATION_WEIGHT: Record<string, number> = {
  marquee: 4,
  acclaimed: 3,
  established: 2,
  emerging: 1,
};

// ---- Helpers ----

function hasVFXSignals(analysis: FullAnalysis | null): boolean {
  if (!analysis) return false;
  const text = JSON.stringify(analysis).toLowerCase();
  return text.includes('vfx') || text.includes('visual effects') || text.includes('cgi') || text.includes('special effects');
}

function hasPeriodSignals(analysis: FullAnalysis | null): boolean {
  if (!analysis) return false;
  const text = JSON.stringify(analysis).toLowerCase();
  return text.includes('period') || text.includes('historical') || text.includes('costume') || text.includes('1800') || text.includes('1900');
}

function hasActionSignals(analysis: FullAnalysis | null, genres: string[]): boolean {
  const genreLower = genres.map(g => g.toLowerCase());
  if (genreLower.includes('action') || genreLower.includes('adventure') || genreLower.includes('war')) return true;
  if (!analysis) return false;
  const text = JSON.stringify(analysis).toLowerCase();
  return text.includes('action') || text.includes('stunt') || text.includes('chase');
}

function countLocations(analysis: FullAnalysis | null): number {
  if (!analysis?.structural_read) return 0;
  const text = JSON.stringify(analysis.structural_read).toLowerCase();
  // rough heuristic from structural read
  if (text.includes('many locations') || text.includes('multiple locations') || text.includes('globe')) return 3;
  if (text.includes('few locations') || text.includes('contained')) return 1;
  return 2;
}

// ---- Main Engine ----

export function calculateFinanceReadiness(
  project: Project,
  cast: ProjectCastMember[],
  partners: ProjectPartner[],
  scripts: ProjectScript[],
  financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
  hasIncentiveInsights: boolean,
): FinanceReadinessResult {
  const analysis = project.analysis_passes as FullAnalysis | null;
  const genres = project.genres || [];
  const strengths: string[] = [];
  const riskFlags: RiskFlag[] = [];

  // ═══ SCORE COMPONENTS (100 total) ═══
  // Script Clarity: 15pts, Packaging Strength: 25pts, Finance Structure: 25pts
  // Market Position: 15pts, Geography: 10pts, Narrative Coherence: 10pts

  // ── Script Clarity (15) ──
  let scriptClarity = 0;
  const currentScript = scripts.find(s => s.status === 'current');
  if (currentScript) {
    scriptClarity += 8;
    if (scripts.length > 1) scriptClarity += 3; // revision history
    if (analysis?.structural_read) scriptClarity += 4;
  } else if (scripts.length > 0) {
    scriptClarity += 4;
  }

  // ── Packaging Strength (25) ──
  let packagingStrength = 0;
  const attachedCast = cast.filter(c => c.status === 'attached');
  const approachedCast = cast.filter(c => c.status === 'approached' || c.status === 'interested');
  const attachedHods = hods.filter(h => h.status === 'attached' || h.status === 'confirmed');
  const directorAttached = attachedHods.find(h => h.department === 'Director');
  const writerAttached = attachedHods.find(h => h.department === 'Writer');
  const confirmedPartners = partners.filter(p => p.status === 'confirmed');
  const salesAgent = partners.find(p => p.partner_type === 'sales-agent' && (p.status === 'confirmed' || p.status === 'in-discussion'));

  if (attachedCast.length > 0) {
    packagingStrength += Math.min(8, 4 + attachedCast.length * 2);
    strengths.push(`${attachedCast.length} cast member${attachedCast.length > 1 ? 's' : ''} attached`);
  } else if (approachedCast.length > 0) {
    packagingStrength += 3;
  }

  if (directorAttached) {
    const rep = REPUTATION_WEIGHT[directorAttached.reputation_tier] || 1;
    packagingStrength += Math.min(5, rep + 2);
    strengths.push(`Director attached (${directorAttached.reputation_tier})`);
  }

  if (writerAttached) {
    const rep = REPUTATION_WEIGHT[writerAttached.reputation_tier] || 1;
    packagingStrength += Math.min(4, rep + 1);
  }

  if (salesAgent) {
    packagingStrength += 4;
    strengths.push('Sales agent engaged');
  } else if (confirmedPartners.length > 0) {
    packagingStrength += 3;
  }

  if (attachedHods.length >= 3) {
    packagingStrength += 2;
  }

  // ── Finance Structure (25) ──
  let financeStructure = 0;
  if (financeScenarios.length > 0) {
    financeStructure += 8;
    strengths.push('Finance scenario modelled');
    const highConf = financeScenarios.some(s => s.confidence === 'high');
    if (highConf) financeStructure += 4;
    if (financeScenarios.length > 1) financeStructure += 3; // multiple scenarios
  }

  if (hasIncentiveInsights) {
    financeStructure += 6;
    strengths.push('Incentive analysis completed');
  }

  if (project.assigned_lane) financeStructure += 2;
  if (confirmedPartners.some(p => p.partner_type === 'financier')) financeStructure += 2;

  // ── Market Position (15) ──
  let marketPosition = 0;
  if (genres.length > 0) marketPosition += 3;
  if (project.budget_range) marketPosition += 2;
  if (project.target_audience) marketPosition += 2;
  if (project.tone) marketPosition += 2;
  if (project.comparable_titles) marketPosition += 2;
  if (project.confidence && project.confidence > 0.7) marketPosition += 2;
  if (analysis) marketPosition += 2;

  // ── Geography (10) ──
  let geographyScore = 0;
  const primaryTerritory = (project as any).primary_territory || '';
  const secondaryTerritories: string[] = (project as any).secondary_territories || [];

  if (primaryTerritory) {
    geographyScore += 5;
    strengths.push(`Production territory: ${primaryTerritory}`);
  }
  if (secondaryTerritories.length > 0) {
    geographyScore += Math.min(5, secondaryTerritories.length * 2);
  }

  // ── Narrative Coherence (10) ──
  let narrativeCoherence = 0;
  if (analysis?.structural_read) narrativeCoherence += 4;
  if (analysis?.creative_signal) narrativeCoherence += 3;
  if (analysis?.market_reality) narrativeCoherence += 3;

  // Clamp subscores
  scriptClarity = Math.min(15, scriptClarity);
  packagingStrength = Math.min(25, packagingStrength);
  financeStructure = Math.min(25, financeStructure);
  marketPosition = Math.min(15, marketPosition);
  geographyScore = Math.min(10, geographyScore);
  narrativeCoherence = Math.min(10, narrativeCoherence);

  const totalScore = scriptClarity + packagingStrength + financeStructure + marketPosition + geographyScore + narrativeCoherence;

  // ═══ VOLATILITY INDEX ═══
  let volatilityFactors = 0;
  if (hasVFXSignals(analysis)) volatilityFactors++;
  if (hasPeriodSignals(analysis)) volatilityFactors++;
  if (hasActionSignals(analysis, genres)) volatilityFactors++;
  if (countLocations(analysis) >= 3) volatilityFactors++;
  if (!currentScript) volatilityFactors++;
  if (attachedCast.length === 0 && approachedCast.length > 0) volatilityFactors++; // cast uncertainty
  const volatilityIndex: VolatilityLevel = volatilityFactors >= 3 ? 'High' : volatilityFactors >= 1 ? 'Medium' : 'Low';

  // ═══ GEOGRAPHY SENSITIVITY ═══
  const hasIncentiveScenarios = financeScenarios.some(s =>
    parseFloat(s.incentive_amount || '0') > 0 || parseFloat(s.other_sources || '0') > 0
  );
  const incentiveDependence = hasIncentiveScenarios && financeScenarios.some(s => {
    const total = parseFloat(s.total_budget || '0');
    const incentive = parseFloat(s.incentive_amount || '0') + parseFloat(s.other_sources || '0');
    return total > 0 && incentive / total > 0.3;
  });

  let geographySensitivity: GeographySensitivity = 'Neutral';
  if (incentiveDependence) {
    geographySensitivity = 'Highly Dependent';
  } else if (hasIncentiveScenarios || hasIncentiveInsights) {
    geographySensitivity = 'Incentive-Dependent';
  }

  // ═══ BUDGET BANDS ═══
  const bandConfig = BUDGET_BAND_MAP[project.budget_range] || BUDGET_BAND_MAP['1m-5m'];
  const bandConfidence: ConfidenceLevel = analysis ? (packagingStrength >= 15 ? 'High' : 'Medium') : 'Low';

  const budgetBands = {
    low: { label: bandConfig.micro, rangeHint: bandConfig.low, confidence: bandConfidence },
    target: { label: bandConfig.micro, rangeHint: bandConfig.target, confidence: bandConfidence },
    stretch: { label: bandConfig.micro, rangeHint: bandConfig.stretch, confidence: volatilityIndex === 'High' ? 'Low' as ConfidenceLevel : bandConfidence },
  };

  // ═══ BUDGET MODULES ═══
  const modules: BudgetModule[] = MODULE_NAMES.map(name => {
    let scopeConfidence: ConfidenceLevel = 'Low';
    let volatilityRisk: VolatilityLevel = 'Medium';
    let narrativePressure = 'Not yet assessed';
    let marketPressure = 'Not yet assessed';

    switch (name) {
      case 'Above the Line':
        scopeConfidence = attachedCast.length > 0 && directorAttached ? 'High' : attachedCast.length > 0 || directorAttached ? 'Medium' : 'Low';
        volatilityRisk = approachedCast.length > 2 && attachedCast.length === 0 ? 'High' : attachedCast.length > 0 ? 'Low' : 'Medium';
        narrativePressure = cast.length > 0 ? `${cast.length} cast roles identified` : 'No cast roles defined';
        marketPressure = directorAttached ? `Director (${directorAttached.reputation_tier}) anchors package` : 'No director attached';
        break;

      case 'Below the Line':
        scopeConfidence = attachedHods.length >= 3 ? 'High' : attachedHods.length >= 1 ? 'Medium' : 'Low';
        volatilityRisk = attachedHods.length === 0 ? 'High' : 'Medium';
        narrativePressure = `${hods.length} HOD positions tracked`;
        marketPressure = attachedHods.length > 0 ? `${attachedHods.length} HODs attached/confirmed` : 'No crew commitments yet';
        break;

      case 'Locations & Logistics':
        const locCount = countLocations(analysis);
        scopeConfidence = analysis?.structural_read ? 'Medium' : 'Low';
        volatilityRisk = locCount >= 3 ? 'High' : locCount <= 1 ? 'Low' : 'Medium';
        narrativePressure = locCount >= 3 ? 'Multiple locations detected in script' : locCount <= 1 ? 'Contained location scope' : 'Moderate location requirements';
        marketPressure = primaryTerritory ? `Primary territory: ${primaryTerritory}` : 'No production territory set';
        break;

      case 'Schedule':
        scopeConfidence = currentScript && analysis ? 'Medium' : 'Low';
        volatilityRisk = hasActionSignals(analysis, genres) || countLocations(analysis) >= 3 ? 'High' : 'Medium';
        narrativePressure = hasActionSignals(analysis, genres) ? 'Action/logistics elements increase schedule pressure' : 'Standard schedule complexity';
        marketPressure = currentScript ? 'Script available for scheduling' : 'No current script for schedule estimation';
        break;

      case 'Post-Production':
        scopeConfidence = analysis ? 'Medium' : 'Low';
        volatilityRisk = hasVFXSignals(analysis) ? 'High' : 'Medium';
        narrativePressure = hasVFXSignals(analysis) ? 'VFX/visual effects elements detected' : 'Standard post-production scope';
        marketPressure = genres.includes('Animation') ? 'Animation requires extended post timeline' : 'Standard post timeline expected';
        break;

      case 'VFX / Scale':
        scopeConfidence = analysis ? 'Medium' : 'Low';
        volatilityRisk = hasVFXSignals(analysis) || hasPeriodSignals(analysis) ? 'High' : 'Low';
        narrativePressure = hasVFXSignals(analysis) ? 'Script indicates VFX requirements' : hasPeriodSignals(analysis) ? 'Period elements increase production scale' : 'No major scale factors detected';
        marketPressure = project.budget_range === '50m-plus' || project.budget_range === '15m-50m' ? 'Budget band supports VFX allocation' : 'VFX budget may be constrained at this band';
        break;

      case 'Contingency':
        scopeConfidence = financeScenarios.length > 0 ? 'Medium' : 'Low';
        volatilityRisk = volatilityFactors >= 2 ? 'High' : 'Medium';
        narrativePressure = `${volatilityFactors} volatility factor${volatilityFactors !== 1 ? 's' : ''} identified`;
        marketPressure = financeScenarios.length > 1 ? 'Multiple scenarios provide contingency flexibility' : 'Single scenario increases contingency risk';
        break;

      case 'Soft Money & Incentives':
        scopeConfidence = hasIncentiveInsights ? 'High' : financeScenarios.some(s => parseFloat(s.incentive_amount || '0') > 0) ? 'Medium' : 'Low';
        volatilityRisk = geographySensitivity === 'Highly Dependent' ? 'High' : geographySensitivity === 'Incentive-Dependent' ? 'Medium' : 'Low';
        narrativePressure = hasIncentiveInsights ? 'Incentive analysis completed' : 'No incentive research conducted';
        marketPressure = primaryTerritory ? `Territory-specific incentives may apply (${primaryTerritory})` : 'No territory set for incentive matching';
        break;
    }

    return { name, scopeConfidence, volatilityRisk, narrativePressure, marketPressure };
  });

  // ═══ RISK FLAGS ═══

  // ATL ambition vs budget
  const highCastAmbition = cast.length >= 3 && attachedCast.length === 0;
  if (highCastAmbition) {
    riskFlags.push({
      tag: 'ATL Ambition',
      explanation: 'Multiple cast targets identified but none attached — above-the-line cost is speculative.',
      mitigation: 'Secure at least one lead attachment or adjust cast ambition to match budget band.',
    });
  }

  // Incentive dependence
  if (geographySensitivity === 'Highly Dependent') {
    riskFlags.push({
      tag: 'Incentive Dependence',
      explanation: 'Project structurally dependent on incentives (>30% of budget). Location lock failure could collapse finance plan.',
      mitigation: 'Diversify funding sources or confirm incentive eligibility before committing to locations.',
    });
  }

  // Schedule volatility
  if (volatilityIndex === 'High') {
    riskFlags.push({
      tag: 'Schedule Volatility',
      explanation: 'Multiple scale factors (VFX, action, locations, period) create high schedule uncertainty.',
      mitigation: 'Prioritise a detailed script breakdown and schedule estimation before financing conversations.',
    });
  }

  // No script
  if (!currentScript) {
    riskFlags.push({
      tag: 'No Current Script',
      explanation: 'Without a current script, all budget and schedule assessments are speculative.',
      mitigation: 'Attach a current script draft to enable meaningful finance assessment.',
    });
  }

  // No director
  if (!directorAttached) {
    riskFlags.push({
      tag: 'Director Vacancy',
      explanation: 'No director attached — financiers and sales agents typically require a director before engaging.',
      mitigation: 'Prioritise director attachment to unlock packaging momentum.',
    });
  }

  // No sales path
  if (!salesAgent && confirmedPartners.length === 0) {
    riskFlags.push({
      tag: 'No Sales Path',
      explanation: 'No sales agent or distribution partner identified. Pre-sales and territory revenue cannot be estimated.',
      mitigation: 'Engage a sales agent or identify distribution partners for key territories.',
    });
  }

  // Post under-scoped
  if (hasVFXSignals(analysis) && (!analysis?.market_reality || !JSON.stringify(analysis.market_reality).toLowerCase().includes('vfx'))) {
    riskFlags.push({
      tag: 'Post Under-Scoped',
      explanation: 'Script indicates VFX requirements but market analysis does not account for post-production scale.',
      mitigation: 'Factor VFX complexity into budget module assessments and ensure post-production is properly scoped.',
    });
  }

  // Geography not set
  if (!primaryTerritory && project.budget_range !== 'under-250k') {
    riskFlags.push({
      tag: 'No Territory Set',
      explanation: 'No primary production territory defined — incentive eligibility and labour costs cannot be evaluated.',
      mitigation: 'Set a primary production territory to unlock geography-aware assessments.',
    });
  }

  return {
    score: Math.min(100, totalScore),
    volatilityIndex,
    geographySensitivity,
    subscores: {
      scriptClarity,
      packagingStrength,
      financeStructure,
      marketPosition,
      geography: geographyScore,
      narrativeCoherence,
    },
    budgetBands,
    modules,
    riskFlags,
    strengths: strengths.slice(0, 5),
  };
}
