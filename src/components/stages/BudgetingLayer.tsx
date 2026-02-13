/**
 * Budgeting Layer: Cost planning — budget versions, cost tracking, cashflow model, script-to-budget.
 */

import { BudgetPanel } from '@/components/finance/BudgetPanel';
import { CostTrackingPanel } from '@/components/finance/CostTrackingPanel';
import { CashflowModelPanel } from '@/components/finance/CashflowModelPanel';
import { MultiSeasonFinancePanel } from '@/components/tv/MultiSeasonFinancePanel';
import type { Project } from '@/lib/types';

interface Props {
  project: Project;
  projectId: string;
  budgets: any[];
  deals: any[];
  financeScenarios: any[];
  isTV: boolean;
  shootDayCount: number;
}

export function BudgetingLayer({
  project, projectId, budgets, deals, financeScenarios, isTV, shootDayCount,
}: Props) {
  const lockedBudget = budgets.find((b: any) => b.status === 'locked');
  const totalBudget = lockedBudget?.total_amount ? Number(lockedBudget.total_amount) : undefined;

  return (
    <div className="space-y-4">
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
      {isTV && <MultiSeasonFinancePanel />}
    </div>
  );
}
