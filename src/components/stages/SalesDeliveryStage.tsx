/**
 * Sales & Delivery Stage: Monetisation and recoupment optimisation.
 * Contains: Sales intelligence, deals, buyer matches, festivals, territory heat map, market alerts.
 */

import { DealTracker } from '@/components/finance/DealTracker';
import { ProjectBuyerMatches } from '@/components/project/ProjectBuyerMatches';
import { ProjectFestivalMatches } from '@/components/project/ProjectFestivalMatches';
import { TerritoryHeatMap } from '@/components/market/TerritoryHeatMap';
import { MarketWindowAlerts } from '@/components/market/MarketWindowAlerts';
import { SalesIntelligencePanel } from '@/components/intelligence/SalesIntelligencePanel';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import type { Project } from '@/lib/types';
import type { ProjectCastMember, ProjectPartner } from '@/hooks/useProjectAttachments';
import type { ProjectDeal } from '@/hooks/useDeals';
import type { StageReadinessResult } from '@/lib/stage-readiness';

interface Props {
  project: Project;
  projectId: string;
  cast: ProjectCastMember[];
  partners: ProjectPartner[];
  deals: ProjectDeal[];
  deliverables: { territory: string; status: string; item_name: string }[];
  trendSignals: any[];
  stageReadiness: StageReadinessResult | null;
}

export function SalesDeliveryStage({
  project, projectId, cast, partners, deals, deliverables, trendSignals, stageReadiness,
}: Props) {
  return (
    <div className="space-y-4">
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}

      <SalesIntelligencePanel project={project} deals={deals} deliverables={deliverables} />

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
