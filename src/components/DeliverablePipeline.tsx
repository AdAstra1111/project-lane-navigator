/**
 * DeliverablePipeline — Visual pipeline strip showing deliverable stages.
 * Grey = Not Started, Yellow = In Progress, Green = Converged.
 * Automatically switches to vertical drama order when isVerticalDrama is true.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DELIVERABLE_PIPELINE_ORDER, VERTICAL_DRAMA_PIPELINE_ORDER, DELIVERABLE_LABELS, getDeliverableLabel, type DeliverableType } from '@/lib/dev-os-config';

export type PipelineStageStatus = 'not_started' | 'in_progress' | 'converged';

interface Props {
  stageStatuses: Record<string, PipelineStageStatus>;
  activeDeliverable?: DeliverableType | null;
  onStageClick?: (deliverable: DeliverableType) => void;
  isVerticalDrama?: boolean;
  projectFormat?: string | null;
}

const STATUS_STYLES: Record<PipelineStageStatus, string> = {
  not_started: 'bg-muted/40 text-muted-foreground border-border/30',
  in_progress: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  converged: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

export function DeliverablePipeline({ stageStatuses, activeDeliverable, onStageClick, isVerticalDrama, projectFormat }: Props) {
  const order = isVerticalDrama ? VERTICAL_DRAMA_PIPELINE_ORDER : DELIVERABLE_PIPELINE_ORDER;

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {order.map((dt, idx) => {
        const status = stageStatuses[dt] || 'not_started';
        const isActive = activeDeliverable === dt;
        return (
          <div key={dt} className="flex items-center">
            {idx > 0 && <div className="w-3 h-px bg-border/40 shrink-0" />}
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] px-1.5 py-0.5 cursor-pointer transition-all whitespace-nowrap',
                STATUS_STYLES[status],
                isActive && 'ring-1 ring-primary/50',
              )}
              onClick={() => onStageClick?.(dt)}
            >
              {getDeliverableLabel(dt, projectFormat)}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
