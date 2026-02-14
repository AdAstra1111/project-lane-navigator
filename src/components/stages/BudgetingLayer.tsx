/**
 * Budgeting Layer: Cost planning — budget versions, cost tracking, cashflow model, script-to-budget.
 */

import { BudgetPanel } from '@/components/finance/BudgetPanel';
import { BudgetAssumptionsPanel } from '@/components/finance/BudgetAssumptionsPanel';
import { CostTrackingPanel } from '@/components/finance/CostTrackingPanel';
import { CashflowModelPanel } from '@/components/finance/CashflowModelPanel';
import { ScriptToBudgetPanel } from '@/components/script/ScriptToBudgetPanel';
import { MultiSeasonFinancePanel } from '@/components/tv/MultiSeasonFinancePanel';
import { useProjectBudgets } from '@/hooks/useBudgets';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
  const { addBudget } = useProjectBudgets(projectId);

  const handleScriptBudgetImport = async (lines: { category: string; line_name: string; amount: number }[], estimatedTotal: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      // Find or create a draft budget
      let targetBudgetId: string;
      const draftBudget = budgets.find((b: any) => b.status === 'draft');

      if (draftBudget) {
        targetBudgetId = draftBudget.id;
      } else {
        // Create a new budget
        const { data, error } = await supabase.from('project_budgets').insert({
          project_id: projectId,
          user_id: user.id,
          version_label: `AI Estimate v${budgets.length + 1}`,
          total_amount: estimatedTotal,
          currency: 'USD',
          lane_template: '',
          status: 'draft',
          notes: 'Auto-created from Script → Budget estimate',
        } as any).select().single();
        if (error) throw error;
        targetBudgetId = (data as any).id;
      }

      // Insert all lines
      const rows = lines.map((l, i) => ({
        budget_id: targetBudgetId,
        project_id: projectId,
        user_id: user.id,
        category: l.category,
        line_name: l.line_name,
        amount: l.amount,
        sort_order: i,
      }));
      const { error: lineErr } = await supabase.from('project_budget_lines').insert(rows as any);
      if (lineErr) throw lineErr;

      toast.success(`Imported ${lines.length} line items into budget`);
      // Refresh budgets
      addBudget.reset();
      window.location.reload(); // simplest way to refresh all budget queries
    } catch (err: any) {
      toast.error(err.message || 'Failed to import budget lines');
    }
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
