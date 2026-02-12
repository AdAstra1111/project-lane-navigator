/**
 * Recoupment Layer: Returns modelling — ownership waterfall, recoupment waterfall, IRR projections.
 */

import { OwnershipWaterfallPanel } from '@/components/OwnershipWaterfallPanel';
import { RecoupmentWaterfallPanel } from '@/components/RecoupmentWaterfallPanel';
import { IRRSalesProjectionPanel } from '@/components/IRRSalesProjectionPanel';

interface Props {
  projectId: string;
  budgets: any[];
}

export function RecoupmentLayer({ projectId, budgets }: Props) {
  const lockedBudget = budgets.find((b: any) => b.status === 'locked');
  const totalBudget = lockedBudget?.total_amount ? Number(lockedBudget.total_amount) : undefined;

  return (
    <div className="space-y-4">
      <OwnershipWaterfallPanel projectId={projectId} />
      <RecoupmentWaterfallPanel projectId={projectId} />
      <IRRSalesProjectionPanel totalBudget={totalBudget} />
    </div>
  );
}
