/**
 * Trends Engine: Stage-aware persistent layer.
 */

import { TrendIntelligencePanel } from '@/components/TrendIntelligencePanel';
import { ProjectRelevantSignals } from '@/components/ProjectRelevantSignals';
import type { Project } from '@/lib/types';

interface Props {
  project: Project;
  projectId: string;
}

export function TrendsLayer({ project, projectId }: Props) {
  return (
    <div className="space-y-4">
      <TrendIntelligencePanel
        projectId={projectId}
        format={project.format}
        budgetRange={project.budget_range}
        primaryTerritory={(project as any).primary_territory || ''}
        assignedLane={project.assigned_lane}
      />
      <ProjectRelevantSignals project={project} />
    </div>
  );
}
