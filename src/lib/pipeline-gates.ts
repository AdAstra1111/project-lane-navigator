/**
 * Auto-checked gate requirements for each pipeline stage.
 * Returns which gates are met and which are blocking.
 * Now format-aware — each production type can have its own stage gates.
 */

import type { Project, FullAnalysis, PipelineStage, ProjectFormat } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';

export interface GateCheck {
  label: string;
  met: boolean;
}

export interface StageGates {
  stage: PipelineStage;
  gates: GateCheck[];
  allMet: boolean;
}

// Format-specific gate definitions
function getCommercialGates(
  stage: string, project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
): GateCheck[] {
  switch (stage) {
    case 'brief': return [
      { label: 'Project created with format', met: !!project.format },
      { label: 'Client brief defined', met: !!project.comparable_titles || !!project.tone },
    ];
    case 'treatment': return [
      { label: 'Treatment/script attached', met: scripts.length > 0 },
      { label: 'Director attached', met: hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed')) },
    ];
    case 'awarded': return [
      { label: 'Budget created', met: financeScenarios.length > 0 },
      { label: 'Director confirmed', met: hods.some(h => h.department === 'Director' && h.status === 'confirmed') },
    ];
    default: return [
      { label: 'Previous stage complete', met: true },
    ];
  }
}

function getMusicVideoGates(
  stage: string, project: Project,
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
): GateCheck[] {
  switch (stage) {
    case 'brief': return [
      { label: 'Project created', met: !!project.format },
    ];
    case 'treatment': return [
      { label: 'Treatment attached', met: scripts.length > 0 },
      { label: 'Director identified', met: hods.some(h => h.department === 'Director') },
    ];
    case 'awarded': return [
      { label: 'Budget confirmed', met: financeScenarios.length > 0 },
      { label: 'Director attached', met: hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed')) },
    ];
    default: return [{ label: 'Previous stage complete', met: true }];
  }
}

function getDocumentaryGates(
  stage: string, project: Project, partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
): GateCheck[] {
  switch (stage) {
    case 'development': return [
      { label: 'Project created with genre', met: project.genres.length > 0 },
      { label: 'Treatment attached', met: scripts.length > 0 },
    ];
    case 'access-secured': return [
      { label: 'Director attached', met: hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed')) },
      { label: 'Subject access documented', met: scripts.some(s => s.status === 'current') },
    ];
    case 'funding-raised': return [
      { label: 'Finance scenario created', met: financeScenarios.length > 0 },
      { label: 'At least 1 partner confirmed', met: partners.some(p => p.status === 'confirmed') },
    ];
    default: return [{ label: 'Previous stage complete', met: true }];
  }
}

// Default film/series gates
function getDefaultGates(
  stage: PipelineStage, project: Project, cast: ProjectCastMember[], partners: ProjectPartner[],
  scripts: ProjectScript[], financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[], hasIncentiveInsights: boolean,
): GateCheck[] {
  const analysis = project.analysis_passes as FullAnalysis | null;
  switch (stage) {
    case 'development': return [
      { label: 'Project created with genre & format', met: project.genres.length > 0 && !!project.format },
      { label: 'Script or treatment attached', met: scripts.length > 0 },
      { label: 'AI analysis completed', met: !!analysis?.structural_read },
    ];
    case 'packaging': return [
      { label: 'Director attached', met: hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed')) },
      { label: 'At least 1 cast member attached', met: cast.some(c => c.status === 'attached') },
      { label: '2+ territories identified', met: new Set(cast.flatMap(c => c.territory_tags)).size >= 2 || partners.filter(p => p.territory).length >= 2 },
      { label: 'Sales agent or co-producer engaged', met: partners.some(p => (p.partner_type === 'sales-agent' || p.partner_type === 'co-producer') && p.status !== 'identified') },
    ];
    case 'financing': return [
      { label: 'Finance scenario created', met: financeScenarios.length > 0 },
      { label: 'Finance gap < 20%', met: financeScenarios.some(s => {
        const total = parseFloat(s.total_budget) || 0;
        const gap = parseFloat(s.gap_amount) || 0;
        return total > 0 && (gap / total) < 0.2;
      })},
      { label: 'Incentive analysis completed', met: hasIncentiveInsights },
      { label: 'At least 1 partner confirmed', met: partners.some(p => p.status === 'confirmed') },
    ];
    case 'pre-production': return [
      { label: 'Director confirmed', met: hods.some(h => h.department === 'Director' && h.status === 'confirmed') },
      { label: '2+ HODs attached', met: hods.filter(h => h.status === 'attached' || h.status === 'confirmed').length >= 2 },
      { label: 'High-confidence finance scenario', met: financeScenarios.some(s => s.confidence === 'high') },
      { label: 'Current script version set', met: scripts.some(s => s.status === 'current') },
    ];
    default: return [{ label: 'Previous stage complete', met: true }];
  }
}

export function getStageGates(
  stage: PipelineStage,
  project: Project,
  cast: ProjectCastMember[],
  partners: ProjectPartner[],
  scripts: ProjectScript[],
  financeScenarios: ProjectFinanceScenario[],
  hods: ProjectHOD[],
  hasIncentiveInsights: boolean,
): StageGates {
  let gates: GateCheck[];

  const format = project.format as ProjectFormat;

  switch (format) {
    case 'commercial':
    case 'branded-content':
      gates = getCommercialGates(stage, project, cast, partners, scripts, financeScenarios, hods);
      break;
    case 'music-video':
      gates = getMusicVideoGates(stage, project, scripts, financeScenarios, hods);
      break;
    case 'documentary':
    case 'documentary-series':
      gates = getDocumentaryGates(stage, project, partners, scripts, financeScenarios, hods);
      break;
    default:
      gates = getDefaultGates(stage, project, cast, partners, scripts, financeScenarios, hods, hasIncentiveInsights);
  }

  return {
    stage,
    gates,
    allMet: gates.every(g => g.met),
  };
}
