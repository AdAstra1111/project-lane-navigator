/**
 * Pre-Production Stage: Convert creative into executable plan.
 * Contains: Budget, schedule, incentives, cashflow, contracts.
 */

import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import { BudgetPanel } from '@/components/BudgetPanel';
import { ScheduleTab } from '@/components/ScheduleTab';
import { ScheduleIntelligencePanel } from '@/components/ScheduleIntelligencePanel';
import { ProjectIncentivePanel } from '@/components/ProjectIncentivePanel';
import { CashflowModelPanel } from '@/components/CashflowModelPanel';
import { ScriptToBudgetPanel } from '@/components/ScriptToBudgetPanel';
import { ContractManagerPanel } from '@/components/ContractManagerPanel';
import { DeadlinePanel } from '@/components/DeadlinePanel';
import type { Project } from '@/lib/types';
import type { StageReadinessResult } from '@/lib/stage-readiness';

interface Props {
  project: Project;
  projectId: string;
  budgets: any[];
  addBudget: any;
  deals: any[];
  financeScenarios: any[];
  scheduleMetrics: any;
  scriptText: string | null;
  onIncentiveAnalysed: (v: boolean) => void;
  stageReadiness: StageReadinessResult | null;
}

export function PreProductionStage({
  project, projectId, budgets, addBudget, deals, financeScenarios,
  scheduleMetrics, scriptText, onIncentiveAnalysed, stageReadiness,
}: Props) {
  return (
    <div className="space-y-4">
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}
      <ScheduleTab projectId={projectId} />
      <ScheduleIntelligencePanel
        projectId={projectId}
        format={project?.format}
        genres={project?.genres || []}
        budgetRange={project?.budget_range}
      />
      <ProjectIncentivePanel
        projectId={projectId}
        format={project.format}
        budget_range={project.budget_range}
        genres={project.genres || []}
        onAnalysed={onIncentiveAnalysed}
      />
      <BudgetPanel projectId={projectId} assignedLane={project?.assigned_lane} projectTitle={project?.title} />
      <ScriptToBudgetPanel
        projectId={projectId}
        scriptText={scriptText}
        format={project?.format}
        genres={project?.genres || []}
        budgetRange={project?.budget_range}
        lane={project?.assigned_lane}
        totalBudget={budgets.find(b => b.status === 'locked')?.total_amount ? Number(budgets.find(b => b.status === 'locked')?.total_amount) : undefined}
        onImport={async (lines, estimatedTotal) => {
          addBudget.mutate(
            {
              version_label: `AI Estimate v${budgets.length + 1}`,
              total_amount: estimatedTotal,
              lane_template: '',
              source: 'ai-estimate',
            },
            {
              onSuccess: async (newBudget: any) => {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const rows = lines.map((l: any, i: number) => ({
                  budget_id: newBudget.id,
                  project_id: projectId,
                  user_id: user.id,
                  category: l.category,
                  line_name: l.line_name,
                  amount: l.amount,
                  sort_order: i,
                }));
                await supabase.from('project_budget_lines').insert(rows as any);
                toast.success(`Created budget with ${lines.length} AI-estimated lines`);
              },
            }
          );
        }}
      />
      <CashflowModelPanel
        projectId={projectId}
        totalBudget={budgets.find(b => b.status === 'locked')?.total_amount ? Number(budgets.find(b => b.status === 'locked')?.total_amount) : undefined}
        deals={deals}
        budgets={budgets}
        incentiveScenarios={financeScenarios}
        shootDayCount={scheduleMetrics.shootDayCount}
      />
      <ContractManagerPanel projectId={projectId} />
      <DeadlinePanel projectId={projectId} />
    </div>
  );
}
