/**
 * Pre-Production Intelligence Engine
 *
 * Provides sensitivity modelling, cost-risk analysis,
 * completion bond readiness, and legal/insurance checklists.
 */

import type { ProjectHOD } from '@/hooks/useProjectAttachments';

// ---- Types ----

export interface SensitivityScenario {
  label: string;
  budgetDelta: number; // e.g. 0.10 = +10%
  cashflowImpact: 'minimal' | 'moderate' | 'severe';
  recoupmentShift: number; // months
  description: string;
}

export interface DepartmentRisk {
  department: string;
  budgetShare: number; // 0-1
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  mitigations: string[];
}

export interface BondChecklistItem {
  id: string;
  label: string;
  category: 'financial' | 'creative' | 'legal' | 'insurance';
  required: boolean;
  description: string;
}

export interface HODHiringStatus {
  department: string;
  personName: string | null;
  status: 'vacant' | 'searching' | 'in-talks' | 'hired';
  critical: boolean;
  impact: string;
}

// ---- Sensitivity Modelling ----

export function generateSensitivityScenarios(
  totalBudget: number | undefined,
  dealCount: number,
  cashflowCoverage: number, // 0-1
): SensitivityScenario[] {
  const budget = totalBudget || 0;

  return [
    {
      label: 'Budget +10%',
      budgetDelta: 0.10,
      cashflowImpact: cashflowCoverage > 0.8 ? 'minimal' : cashflowCoverage > 0.5 ? 'moderate' : 'severe',
      recoupmentShift: cashflowCoverage > 0.7 ? 1 : 3,
      description: budget > 0
        ? `Budget increases to ${formatCurrency(budget * 1.1)}. ${cashflowCoverage > 0.8 ? 'Current financing likely absorbs the increase.' : 'Financing gap widens — may need additional equity or gap finance.'}`
        : 'Set a locked budget to model sensitivity.',
    },
    {
      label: 'Budget +25%',
      budgetDelta: 0.25,
      cashflowImpact: cashflowCoverage > 0.9 ? 'moderate' : 'severe',
      recoupmentShift: cashflowCoverage > 0.8 ? 2 : 6,
      description: budget > 0
        ? `Budget increases to ${formatCurrency(budget * 1.25)}. ${cashflowCoverage > 0.9 ? 'Tight but may be manageable with deal restructuring.' : 'Significant restructuring required. Recoupment timeline extends substantially.'}`
        : 'Set a locked budget to model sensitivity.',
    },
    {
      label: 'Budget -10%',
      budgetDelta: -0.10,
      cashflowImpact: 'minimal',
      recoupmentShift: -1,
      description: budget > 0
        ? `Budget reduces to ${formatCurrency(budget * 0.9)}. Faster recoupment, but review department allocations for feasibility.`
        : 'Set a locked budget to model sensitivity.',
    },
    {
      label: 'Key Cast Drops',
      budgetDelta: -0.05,
      cashflowImpact: dealCount > 3 ? 'severe' : 'moderate',
      recoupmentShift: 2,
      description: 'Loss of attached cast may invalidate pre-sales commitments. ATL budget decreases but territory coverage shrinks.',
    },
    {
      label: 'Schedule +2 Weeks',
      budgetDelta: 0.15,
      cashflowImpact: cashflowCoverage > 0.7 ? 'moderate' : 'severe',
      recoupmentShift: 2,
      description: 'Extended shoot adds crew overtime, location fees, and equipment rental. Insurance implications if bond is in place.',
    },
  ];
}

// ---- Cost-Risk Heat Map ----

const STANDARD_DEPARTMENTS = [
  { department: 'Above the Line', baseShare: 0.25, volatility: 'high' },
  { department: 'Production', baseShare: 0.20, volatility: 'high' },
  { department: 'Art & Design', baseShare: 0.10, volatility: 'medium' },
  { department: 'Camera & Lighting', baseShare: 0.08, volatility: 'low' },
  { department: 'Sound', baseShare: 0.04, volatility: 'low' },
  { department: 'Wardrobe & Makeup', baseShare: 0.05, volatility: 'medium' },
  { department: 'VFX & Post', baseShare: 0.12, volatility: 'high' },
  { department: 'Music', baseShare: 0.04, volatility: 'medium' },
  { department: 'Locations', baseShare: 0.06, volatility: 'high' },
  { department: 'Insurance & Legal', baseShare: 0.04, volatility: 'low' },
  { department: 'Contingency', baseShare: 0.02, volatility: 'low' },
];

export function calculateDepartmentRisks(
  format: string,
  budgetLines: Array<{ category: string; amount: number }>,
  totalBudget: number | undefined,
): DepartmentRisk[] {
  const budget = totalBudget || 0;
  const isVFXHeavy = format === 'film' || format === 'tv-series';

  return STANDARD_DEPARTMENTS.map(dept => {
    // Find matching budget lines
    const matchingLines = budgetLines.filter(l =>
      l.category.toLowerCase().includes(dept.department.toLowerCase().split(' ')[0])
    );
    const actualSpend = matchingLines.reduce((s, l) => s + l.amount, 0);
    const budgetShare = budget > 0 ? actualSpend / budget : dept.baseShare;

    const riskFactors: string[] = [];
    const mitigations: string[] = [];

    // Over-allocation risk
    if (budgetShare > dept.baseShare * 1.5 && budget > 0) {
      riskFactors.push(`${Math.round(budgetShare * 100)}% of budget — above typical ${Math.round(dept.baseShare * 100)}%`);
    }

    // Volatility risk
    if (dept.volatility === 'high') {
      riskFactors.push('High cost volatility — prone to overruns');
      mitigations.push('Lock rates early, build contingency');
    }

    // VFX-specific
    if (dept.department === 'VFX & Post' && isVFXHeavy) {
      riskFactors.push('VFX-heavy format — scope creep risk');
      mitigations.push('Define shot count and complexity early');
    }

    // Locations
    if (dept.department === 'Locations') {
      riskFactors.push('Weather and permit dependencies');
      mitigations.push('Scout early, secure backup locations');
    }

    let riskLevel: DepartmentRisk['riskLevel'] = 'low';
    if (riskFactors.length >= 3) riskLevel = 'critical';
    else if (riskFactors.length >= 2) riskLevel = 'high';
    else if (riskFactors.length >= 1) riskLevel = 'medium';

    return {
      department: dept.department,
      budgetShare,
      riskLevel,
      riskFactors,
      mitigations,
    };
  });
}

// ---- Completion Bond Checklist ----

export const BOND_CHECKLIST: BondChecklistItem[] = [
  { id: 'locked-budget', label: 'Locked production budget', category: 'financial', required: true, description: 'Final approved budget with contingency' },
  { id: 'cashflow', label: 'Cashflow schedule', category: 'financial', required: true, description: 'Month-by-month spend and income projections' },
  { id: 'financing-plan', label: 'Financing plan closed', category: 'financial', required: true, description: 'All funding sources confirmed with executed agreements' },
  { id: 'completion-guarantee', label: 'Completion guarantee application', category: 'financial', required: true, description: 'Bond company application submitted and approved' },
  { id: 'director-contract', label: 'Director deal memo', category: 'creative', required: true, description: 'Director contracted with approved schedule' },
  { id: 'cast-contracts', label: 'Lead cast deal memos', category: 'creative', required: true, description: 'Principal cast contracted with availability confirmed' },
  { id: 'script-locked', label: 'Shooting script locked', category: 'creative', required: true, description: 'Final shooting script approved by all parties' },
  { id: 'schedule-locked', label: 'Production schedule locked', category: 'creative', required: true, description: 'Day-out-of-days approved with all HODs' },
  { id: 'chain-of-title', label: 'Chain of title', category: 'legal', required: true, description: 'All underlying rights secured and documented' },
  { id: 'distribution-agreements', label: 'Distribution agreements', category: 'legal', required: false, description: 'Pre-sales or distribution commitments executed' },
  { id: 'guild-agreements', label: 'Guild/union agreements', category: 'legal', required: true, description: 'SAG-AFTRA, DGA, WGA agreements in place' },
  { id: 'location-permits', label: 'Location permits', category: 'legal', required: true, description: 'All primary locations permitted and contracted' },
  { id: 'production-insurance', label: 'Production insurance', category: 'insurance', required: true, description: 'Comprehensive production insurance policy bound' },
  { id: 'eo-insurance', label: 'E&O insurance', category: 'insurance', required: true, description: 'Errors & omissions insurance in place' },
  { id: 'cast-insurance', label: 'Cast insurance / medicals', category: 'insurance', required: true, description: 'Cast medical exams completed and insured' },
  { id: 'workers-comp', label: 'Workers compensation', category: 'insurance', required: true, description: 'Workers comp policy for all crew territories' },
];

// ---- HOD Hiring Tracker ----

const CRITICAL_DEPARTMENTS = ['Director', 'Producer', 'Line Producer', 'Director of Photography', 'Production Designer', 'Editor'];

export function calculateHODHiringStatus(
  hods: ProjectHOD[],
  format: string,
): HODHiringStatus[] {
  const requiredDepts = format === 'documentary' || format === 'documentary-series'
    ? ['Director', 'Producer', 'Editor', 'Director of Photography']
    : format === 'commercial' || format === 'branded-content' || format === 'music-video'
      ? ['Director', 'Producer', 'Director of Photography', 'Editor']
      : ['Director', 'Producer', 'Line Producer', 'Director of Photography', 'Production Designer', '1st AD', 'Editor', 'Composer', 'Casting Director'];

  return requiredDepts.map(dept => {
    const hod = hods.find(h => h.department === dept);
    let status: HODHiringStatus['status'] = 'vacant';
    if (hod) {
      if (['attached', 'confirmed'].includes(hod.status)) status = 'hired';
      else if (['in-talks', 'offer-out'].includes(hod.status)) status = 'in-talks';
      else status = 'searching';
    }

    return {
      department: dept,
      personName: hod?.person_name || null,
      status,
      critical: CRITICAL_DEPARTMENTS.includes(dept),
      impact: status === 'vacant' && CRITICAL_DEPARTMENTS.includes(dept)
        ? 'Blocks production start'
        : status === 'vacant'
          ? 'Should be filled before production'
          : status === 'hired'
            ? 'Ready'
            : 'In progress',
    };
  });
}

// ---- Helpers ----

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
