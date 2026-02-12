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
import { ProjectIncentivePanel } from '@/components/ProjectIncentivePanel';
import { CashflowModelPanel } from '@/components/CashflowModelPanel';
import type { Project } from '@/lib/types';
import type { FinanceReadinessResult } from '@/lib/finance-readiness';

interface Props {
  project: Project;
  projectId: string;
  financeReadiness: FinanceReadinessResult | null;
  financeScenarios: any[];
  budgets: any[];
  deals: any[];
  isTV: boolean;
  shootDayCount: number;
  onIncentiveAnalysed?: (v: boolean) => void;
}

export function FinanceLayer({
  project, projectId, financeReadiness, financeScenarios, budgets, deals, isTV, shootDayCount, onIncentiveAnalysed,
}: Props) {
  const lockedBudget = budgets.find((b: any) => b.status === 'locked');
  const totalBudget = lockedBudget?.total_amount ? Number(lockedBudget.total_amount) : undefined;

  return (
    <div className="space-y-4">
      {financeReadiness && <FinanceReadinessPanel result={financeReadiness} />}
      <FinanceTab projectId={projectId} />
      <FinanceWaterfall scenarios={financeScenarios} />
      <ProjectIncentivePanel
        projectId={projectId}
        format={project.format}
        budget_range={project.budget_range}
        genres={project.genres || []}
        onAnalysed={onIncentiveAnalysed || (() => {})}
      />
      <DealTracker projectId={projectId} />
      <BudgetPanel projectId={projectId} assignedLane={project?.assigned_lane} projectTitle={project?.title} />
      <CashflowModelPanel
        projectId={projectId}
        totalBudget={totalBudget}
        deals={deals}
        budgets={budgets}
        incentiveScenarios={financeScenarios}
        shootDayCount={shootDayCount}
      />
      <CostTrackingPanel projectId={projectId} />
      <OwnershipWaterfallPanel projectId={projectId} />
      <RecoupmentWaterfallPanel projectId={projectId} />
      <IRRSalesProjectionPanel
        totalBudget={totalBudget}
      />
      {isTV && <MultiSeasonFinancePanel />}
    </div>
  );
}
