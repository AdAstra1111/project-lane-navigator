/**
 * Production Stage: Monitor burn and schedule stability.
 * Currently a structured placeholder — full implementation in Phase 6.
 */

import { Clapperboard, AlertTriangle, TrendingUp } from 'lucide-react';
import { CostTrackingPanel } from '@/components/CostTrackingPanel';
import { ScheduleTab } from '@/components/ScheduleTab';

interface Props {
  projectId: string;
}

export function ProductionStage({ projectId }: Props) {
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <Clapperboard className="h-5 w-5 text-emerald-400" />
          <h3 className="font-display font-semibold text-foreground text-lg">Production Monitoring</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Track actual spend vs budget, schedule adherence, and production risks in real time.
        </p>
      </div>

      <ScheduleTab projectId={projectId} />
      <CostTrackingPanel projectId={projectId} />

      {/* Placeholder panels for future Phase 6 features */}
      <div className="glass-card rounded-xl p-5 border border-dashed border-muted-foreground/20">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">Production Risk Log</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Daily report logging, incident tracking, and overage alerts will be available here. Coming soon.
        </p>
      </div>

      <div className="glass-card rounded-xl p-5 border border-dashed border-muted-foreground/20">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-sky-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">Production Stability Score</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Composite score based on spend variance, schedule slippage, and risk incidents. Coming soon.
        </p>
      </div>
    </div>
  );
}
