/**
 * Pre-Production Stage: Convert creative into executable plan.
 * Contains: Budget, schedule, incentives, cashflow, contracts,
 * sensitivity modelling, cost-risk, bond/legal, HOD hiring.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import { BudgetPanel } from '@/components/finance/BudgetPanel';
import { ScheduleTab } from '@/components/ScheduleTab';
import { ScheduleIntelligencePanel } from '@/components/intelligence/ScheduleIntelligencePanel';
import { ScriptToBudgetPanel } from '@/components/ScriptToBudgetPanel';
import { ContractManagerPanel } from '@/components/ContractManagerPanel';
import { DeadlinePanel } from '@/components/DeadlinePanel';
import { PreProductionIntelligencePanel } from '@/components/intelligence/PreProductionIntelligencePanel';
import type { Project } from '@/lib/types';
import type { ProjectHOD } from '@/hooks/useProjectAttachments';
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
  hods: ProjectHOD[];
  budgetLines: Array<{ category: string; amount: number }>;
  onIncentiveAnalysed: (v: boolean) => void;
  stageReadiness: StageReadinessResult | null;
}

export function PreProductionStage({
  project, projectId, budgets, addBudget, deals, financeScenarios,
  scheduleMetrics, scriptText, hods, budgetLines, onIncentiveAnalysed, stageReadiness,
}: Props) {
  // Bond checklist state — persisted in localStorage per project
  const [bondChecked, setBondChecked] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`bond-checklist-${projectId}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const toggleBondItem = useCallback((id: string) => {
    setBondChecked(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem(`bond-checklist-${projectId}`, JSON.stringify(next));
      return next;
    });
  }, [projectId]);

  const lockedBudget = budgets.find(b => b.status === 'locked');
  const totalBudget = lockedBudget?.total_amount ? Number(lockedBudget.total_amount) : undefined;
  const cashflowCoverage = totalBudget && deals.length > 0 ? Math.min(1, deals.filter((d: any) => d.status === 'closed').length / Math.max(1, deals.length)) : 0;

  return (
    <div className="space-y-4">
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}

      {/* Intelligence Panels */}
      <PreProductionIntelligencePanel
        format={project.format}
        hods={hods}
        totalBudget={totalBudget}
        dealCount={deals.length}
        cashflowCoverage={cashflowCoverage}
        budgetLines={budgetLines}
        bondChecked={bondChecked}
        onToggleBondItem={toggleBondItem}
      />

      <ScheduleTab projectId={projectId} />
      <ScheduleIntelligencePanel
        projectId={projectId}
        format={project?.format}
        genres={project?.genres || []}
        budgetRange={project?.budget_range}
      />
      <BudgetPanel projectId={projectId} assignedLane={project?.assigned_lane} projectTitle={project?.title} />
      <ScriptToBudgetPanel
        projectId={projectId}
        scriptText={scriptText}
        format={project?.format}
        genres={project?.genres || []}
        budgetRange={project?.budget_range}
        lane={project?.assigned_lane}
        totalBudget={totalBudget}
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
      <ContractManagerPanel projectId={projectId} />
      <DeadlinePanel projectId={projectId} />
    </div>
  );
}
