/**
 * Finance & Recoupment: Persistent cross-stage layer.
 * Contains: Finance readiness, scenarios, waterfall, deals, budget, costs, ownership, recoupment, IRR.
 */

import { FinanceReadinessPanel } from '@/components/FinanceReadinessPanel';
import { FinanceTab } from '@/components/ProjectAttachmentTabs';
import { FinanceWaterfall } from '@/components/FinanceWaterfall';
import { DealTracker } from '@/components/DealTracker';
import { BudgetPanel } from '@/components/BudgetPanel';
import { CostTrackingPanel } from '@/components/CostTrackingPanel';
import { OwnershipWaterfallPanel } from '@/components/OwnershipWaterfallPanel';
import { RecoupmentWaterfallPanel } from '@/components/RecoupmentWaterfallPanel';
import { IRRSalesProjectionPanel } from '@/components/IRRSalesProjectionPanel';
import { MultiSeasonFinancePanel } from '@/components/tv/MultiSeasonFinancePanel';
import type { Project } from '@/lib/types';
import type { FinanceReadinessResult } from '@/lib/finance-readiness';

interface Props {
  project: Project;
  projectId: string;
  financeReadiness: FinanceReadinessResult | null;
  financeScenarios: any[];
  budgets: any[];
  isTV: boolean;
}

export function FinanceLayer({
  project, projectId, financeReadiness, financeScenarios, budgets, isTV,
}: Props) {
  return (
    <div className="space-y-4">
      {financeReadiness && <FinanceReadinessPanel result={financeReadiness} />}
      <FinanceTab projectId={projectId} />
      <FinanceWaterfall scenarios={financeScenarios} />
      <DealTracker projectId={projectId} />
      <BudgetPanel projectId={projectId} assignedLane={project?.assigned_lane} projectTitle={project?.title} />
      <CostTrackingPanel projectId={projectId} />
      <OwnershipWaterfallPanel projectId={projectId} />
      <RecoupmentWaterfallPanel projectId={projectId} />
      <IRRSalesProjectionPanel
        totalBudget={budgets.find((b: any) => b.status === 'locked')?.total_amount ? Number(budgets.find((b: any) => b.status === 'locked')?.total_amount) : undefined}
      />
      {isTV && <MultiSeasonFinancePanel />}
    </div>
  );
}
