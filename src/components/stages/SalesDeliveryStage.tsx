/**
 * Sales & Delivery Stage: Monetisation and recoupment optimisation.
 * Contains: Deals, buyer matches, festivals, territory heat map, market alerts.
 */

import { DealTracker } from '@/components/DealTracker';
import { ProjectBuyerMatches } from '@/components/ProjectBuyerMatches';
import { ProjectFestivalMatches } from '@/components/ProjectFestivalMatches';
import { TerritoryHeatMap } from '@/components/TerritoryHeatMap';
import { MarketWindowAlerts } from '@/components/MarketWindowAlerts';
import type { Project } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner } from '@/hooks/useProjectAttachments';

interface Props {
  project: Project;
  projectId: string;
  cast: ProjectCastMember[];
  partners: ProjectPartner[];
  trendSignals: any[];
}

export function SalesDeliveryStage({
  project, projectId, cast, partners, trendSignals,
}: Props) {
  return (
    <div className="space-y-4">
      <DealTracker projectId={projectId} />
      <ProjectBuyerMatches project={project} />
      <ProjectFestivalMatches
        format={project.format}
        genres={project.genres || []}
        budgetRange={project.budget_range}
        tone={project.tone}
        assignedLane={project.assigned_lane}
        pipelineStage={project.pipeline_stage}
      />
      {trendSignals.length > 0 && (
        <MarketWindowAlerts
          genres={project.genres || []}
          tone={project.tone}
          format={project.format}
          signals={trendSignals}
        />
      )}
      <TerritoryHeatMap
        partners={partners}
        castTerritories={[...new Set(cast.flatMap(c => c.territory_tags))]}
        incentiveJurisdictions={[]}
      />
    </div>
  );
}
