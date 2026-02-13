/**
 * Production Stage: Monitor burn and schedule stability.
 * Contains: Daily reports, cost actuals, stability score, schedule, cost tracking.
 */

import { useMemo } from 'react';
import { ScheduleTab } from '@/components/ScheduleTab';
import { CostTrackingPanel } from '@/components/finance/CostTrackingPanel';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import { DailyReportLogger } from '@/components/DailyReportLogger';
import { CostActualsTracker } from '@/components/finance/CostActualsTracker';
import { ProductionStabilityPanel } from '@/components/intelligence/ProductionStabilityPanel';
import { useDailyReports, useCostActuals } from '@/hooks/useProductionMonitoring';
import type { StageReadinessResult } from '@/lib/stage-readiness';

interface Props {
  projectId: string;
  totalPlannedScenes: number;
  totalShootDays: number;
  stageReadiness: StageReadinessResult | null;
}

export function ProductionStage({ projectId, totalPlannedScenes, totalShootDays, stageReadiness }: Props) {
  const { reports } = useDailyReports(projectId);
  const { actuals } = useCostActuals(projectId);

  return (
    <div className="space-y-4">
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}

      <ProductionStabilityPanel
        reports={reports}
        actuals={actuals}
        totalPlannedScenes={totalPlannedScenes}
        totalShootDays={totalShootDays}
      />

      <DailyReportLogger projectId={projectId} />
      <CostActualsTracker projectId={projectId} />

      <ScheduleTab projectId={projectId} />
      <CostTrackingPanel projectId={projectId} />
    </div>
  );
}
