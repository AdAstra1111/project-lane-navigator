/**
 * Budgeting Layer: Cost planning — budget versions, cost tracking, cashflow model, script-to-budget.
 */

import { BudgetPanel } from '@/components/finance/BudgetPanel';
import { BudgetAssumptionsPanel } from '@/components/finance/BudgetAssumptionsPanel';
import { CostTrackingPanel } from '@/components/finance/CostTrackingPanel';
import { CashflowModelPanel } from '@/components/finance/CashflowModelPanel';
import { ScriptToBudgetPanel } from '@/components/script/ScriptToBudgetPanel';
import { MultiSeasonFinancePanel } from '@/components/tv/MultiSeasonFinancePanel';
import { useBudgetLines } from '@/hooks/useBudgets';
import type { Project } from '@/lib/types';

interface Props {
  project: Project;
  projectId: string;
  budgets: any[];
  deals: any[];
  financeScenarios: any[];
  isTV: boolean;
  shootDayCount: number;
  scriptText?: string | null;
}

export function BudgetingLayer({
  project, projectId, budgets, deals, financeScenarios, isTV, shootDayCount, scriptText,
}: Props) {
  const lockedBudget = budgets.find((b: any) => b.status === 'locked');
  const totalBudget = lockedBudget?.total_amount ? Number(lockedBudget.total_amount) : undefined;

  // Find an active draft budget to import AI lines into
  const draftBudget = budgets.find((b: any) => b.status === 'draft');
  const { addLines } = useBudgetLines(draftBudget?.id || '', projectId);

  const handleScriptBudgetImport = (lines: { category: string; line_name: string; amount: number }[], estimatedTotal: number) => {
    if (!draftBudget) return;
    addLines.mutate(lines.map((l, i) => ({ ...l, sort_order: i })));
  };

  return (
    <div className="space-y-4">
      <BudgetAssumptionsPanel projectId={projectId} />
      <BudgetPanel projectId={projectId} assignedLane={project?.assigned_lane} projectTitle={project?.title} />
      <ScriptToBudgetPanel
        projectId={projectId}
        scriptText={scriptText ?? null}
        format={project?.format || undefined}
        genres={project?.genres || undefined}
        budgetRange={project?.budget_range || undefined}
        lane={project?.assigned_lane || undefined}
        totalBudget={totalBudget}
        onImport={handleScriptBudgetImport}
      />
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
