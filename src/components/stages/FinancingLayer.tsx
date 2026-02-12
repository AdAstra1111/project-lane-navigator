/**
 * Financing Layer: Raising capital — deals, incentives, finance scenarios, waterfall, readiness.
 */

import { FinanceReadinessPanel } from '@/components/FinanceReadinessPanel';
import { FinanceTab } from '@/components/ProjectAttachmentTabs';
import { FinanceWaterfall } from '@/components/FinanceWaterfall';
import { DealTracker } from '@/components/DealTracker';
import { ProjectIncentivePanel } from '@/components/ProjectIncentivePanel';
import type { Project } from '@/lib/types';
import type { FinanceReadinessResult } from '@/lib/finance-readiness';

interface Props {
  project: Project;
  projectId: string;
  financeReadiness: FinanceReadinessResult | null;
  financeScenarios: any[];
  onIncentiveAnalysed?: (v: boolean) => void;
}

export function FinancingLayer({
  project, projectId, financeReadiness, financeScenarios, onIncentiveAnalysed,
}: Props) {
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
    </div>
  );
}
