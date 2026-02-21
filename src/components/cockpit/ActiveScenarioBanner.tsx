import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Zap } from 'lucide-react';
import type { ProjectScenario, ProjectStateGraph } from '@/hooks/useStateGraph';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  activeScenario: ProjectScenario | undefined;
  baseline: ProjectScenario | undefined;
  stateGraph: ProjectStateGraph;
  onSetBaselineActive: () => void;
  isPending: boolean;
}

export function ActiveScenarioBanner({ activeScenario, baseline, stateGraph, onSetBaselineActive, isPending }: Props) {
  if (!activeScenario) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-medium">No Active Scenario</p>
            <p className="text-xs text-muted-foreground">The cockpit requires an active scenario to drive planning. Set the baseline as active to continue.</p>
          </div>
        </div>
        {baseline && (
          <Button size="sm" onClick={onSetBaselineActive} disabled={isPending}>
            {isPending ? 'Setting…' : 'Set Baseline Active'}
          </Button>
        )}
      </div>
    );
  }

  const setAt = stateGraph.active_scenario_set_at
    ? formatDistanceToNow(new Date(stateGraph.active_scenario_set_at), { addSuffix: true })
    : null;

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Zap className="h-4 w-4 text-primary" />
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Active Plan:</span>
          <span className="text-sm">{activeScenario.name}</span>
          <Badge variant="outline" className="text-[10px]">{activeScenario.scenario_type}</Badge>
        </div>
      </div>
      {setAt && (
        <span className="text-xs text-muted-foreground">Set {setAt}</span>
      )}
    </div>
  );
}
