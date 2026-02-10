/**
 * Auto-checked gate requirements for each pipeline stage.
 * Returns which gates are met and which are blocking.
 */

import type { Project, FullAnalysis, PipelineStage } from '@/lib/types';
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
  const analysis = project.analysis_passes as FullAnalysis | null;
  let gates: GateCheck[] = [];

  switch (stage) {
    case 'development':
      gates = [
        { label: 'Project created with genre & format', met: project.genres.length > 0 && !!project.format },
        { label: 'Script or treatment attached', met: scripts.length > 0 },
        { label: 'AI analysis completed', met: !!analysis?.structural_read },
      ];
      break;

    case 'packaging':
      gates = [
        { label: 'Director attached', met: hods.some(h => h.department === 'Director' && (h.status === 'attached' || h.status === 'confirmed')) },
        { label: 'At least 1 cast member attached', met: cast.some(c => c.status === 'attached') },
        { label: '2+ territories identified', met: new Set(cast.flatMap(c => c.territory_tags)).size >= 2 || partners.filter(p => p.territory).length >= 2 },
        { label: 'Sales agent or co-producer engaged', met: partners.some(p => (p.partner_type === 'sales-agent' || p.partner_type === 'co-producer') && p.status !== 'identified') },
      ];
      break;

    case 'financing':
      gates = [
        { label: 'Finance scenario created', met: financeScenarios.length > 0 },
        { label: 'Finance gap < 20%', met: financeScenarios.some(s => {
          const total = parseFloat(s.total_budget) || 0;
          const gap = parseFloat(s.gap_amount) || 0;
          return total > 0 && (gap / total) < 0.2;
        })},
        { label: 'Incentive analysis completed', met: hasIncentiveInsights },
        { label: 'At least 1 partner confirmed', met: partners.some(p => p.status === 'confirmed') },
      ];
      break;

    case 'pre-production':
      gates = [
        { label: 'Director confirmed', met: hods.some(h => h.department === 'Director' && h.status === 'confirmed') },
        { label: '2+ HODs attached', met: hods.filter(h => h.status === 'attached' || h.status === 'confirmed').length >= 2 },
        { label: 'High-confidence finance scenario', met: financeScenarios.some(s => s.confidence === 'high') },
        { label: 'Current script version set', met: scripts.some(s => s.status === 'current') },
      ];
      break;
  }

  return {
    stage,
    gates,
    allMet: gates.every(g => g.met),
  };
}
