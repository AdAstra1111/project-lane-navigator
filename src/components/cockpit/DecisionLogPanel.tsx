import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { History, ChevronDown, Play, Zap, GitBranch, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectScenario, ProjectionAssumptions } from '@/hooks/useStateGraph';

interface DecisionEvent {
  id: string;
  project_id: string;
  event_type: string;
  scenario_id: string | null;
  previous_scenario_id: string | null;
  payload: any;
  created_at: string;
  created_by: string | null;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  onSetActive: (scenarioId: string) => void;
  isSettingActive: boolean;
  onRunProjection: (params: { scenarioId?: string; months?: number; assumptions?: ProjectionAssumptions }) => void;
  isProjecting: boolean;
  onRunStressTest: (params: { scenarioId: string; months?: number }) => void;
  isRunningStress: boolean;
  onBranchFromEvent: (eventId: string) => void;
  isBranching: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  recommendation_computed: 'Recommendation',
  active_scenario_changed: 'Active Changed',
  projection_completed: 'Projection',
  stress_test_completed: 'Stress Test',
  branch_created: 'Branch Created',
  scenario_merged: 'Merged',
  scenario_lock_changed: 'Lock Changed',
  governance_scanned: 'Governance Scan',
  merge_risk_evaluated: 'Risk Evaluated',
  merge_approval_requested: 'Approval Requested',
  merge_approval_decided: 'Approval Decided',
  governance_policy_escalated: 'Policy Escalated',
  governance_memory_updated: 'Gov Memory Updated',
  merge_approval_consumed: 'Approval Used',
  merge_applied_from_approval: 'Applied (Approval)',
  merge_apply_attempted: 'Apply Attempted',
  approval_pending_blocked: 'Approval Blocked',
};

const EVENT_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  recommendation_computed: 'default',
  active_scenario_changed: 'secondary',
  projection_completed: 'outline',
  stress_test_completed: 'outline',
  branch_created: 'secondary',
  scenario_merged: 'secondary',
  scenario_lock_changed: 'outline',
  governance_scanned: 'outline',
  merge_risk_evaluated: 'secondary',
  merge_approval_requested: 'destructive',
  merge_approval_decided: 'default',
  governance_policy_escalated: 'destructive',
  governance_memory_updated: 'outline',
  merge_approval_consumed: 'outline',
  merge_applied_from_approval: 'secondary',
  merge_apply_attempted: 'outline',
  approval_pending_blocked: 'destructive',
};

function scenarioName(id: string | null, scenarios: ProjectScenario[]): string {
  if (!id) return '—';
  const s = scenarios.find(sc => sc.id === id);
  return s?.name ?? id.slice(0, 8);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function DecisionLogPanel({
  projectId,
  scenarios,
  onSetActive,
  isSettingActive,
  onRunProjection,
  isProjecting,
  onRunStressTest,
  isRunningStress,
  onBranchFromEvent,
  isBranching,
}: Props) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['decision-events', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scenario_decision_events')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as DecisionEvent[];
    },
    enabled: !!projectId,
  });

  const handleBranch = (eventId: string) => {
    if (confirm('Create a new scenario branch from this recommendation snapshot?')) {
      onBranchFromEvent(eventId);
    }
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />
          Decision Log
          {events.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-auto">{events.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && events.length === 0 && (
          <div className="text-xs text-muted-foreground">No decision events recorded yet.</div>
        )}
        {events.map(ev => (
          <Collapsible key={ev.id}>
            <div className="rounded-md border border-border/30 bg-muted/10">
              <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/20 transition-colors">
                <Badge variant={
                  ev.event_type === 'merge_approval_decided'
                    ? (ev.payload?.approved ? 'default' : 'destructive')
                    : (EVENT_VARIANTS[ev.event_type] ?? 'outline')
                } className="text-[10px] shrink-0">
                  {ev.event_type === 'merge_approval_decided'
                    ? (ev.payload?.approved ? 'Approved' : 'Rejected')
                    : (EVENT_LABELS[ev.event_type] ?? ev.event_type)}
                </Badge>
                {/* Phase 5.6: Domain badge */}
                {ev.payload?.domain && (
                  <Badge variant="outline" className="text-[9px] shrink-0 capitalize">
                    {ev.payload.domain}
                  </Badge>
                )}
                <span className="text-xs font-medium truncate">
                  {scenarioName(ev.scenario_id, scenarios)}
                </span>
                {ev.previous_scenario_id && ev.previous_scenario_id !== ev.scenario_id && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    ← {scenarioName(ev.previous_scenario_id, scenarios)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                  {formatTime(ev.created_at)}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 [&[data-state=open]]:rotate-180" />
              </CollapsibleTrigger>

              {/* Why changed bullets */}
              {ev.event_type === 'recommendation_computed' && ev.payload?.change_reasons?.length > 0 && (
                <div className="px-3 pb-1.5">
                  <div className="text-[10px] text-muted-foreground font-medium mb-0.5">Why changed:</div>
                  <ul className="list-disc list-inside text-[10px] text-muted-foreground space-y-0.5">
                    {(ev.payload.change_reasons as string[]).map((r: string) => (
                      <li key={r}>{r.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action buttons */}
              <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                <EventActions
                  ev={ev}
                  onSetActive={onSetActive}
                  isSettingActive={isSettingActive}
                  onRunProjection={onRunProjection}
                  isProjecting={isProjecting}
                  onRunStressTest={onRunStressTest}
                  isRunningStress={isRunningStress}
                  onBranch={handleBranch}
                  isBranching={isBranching}
                />
              </div>

              <CollapsibleContent>
                <div className="px-3 pb-2 pt-1 border-t border-border/20">
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}

function EventActions({
  ev,
  onSetActive,
  isSettingActive,
  onRunProjection,
  isProjecting,
  onRunStressTest,
  isRunningStress,
  onBranch,
  isBranching,
}: {
  ev: DecisionEvent;
  onSetActive: (id: string) => void;
  isSettingActive: boolean;
  onRunProjection: (params: { scenarioId?: string; months?: number; assumptions?: ProjectionAssumptions }) => void;
  isProjecting: boolean;
  onRunStressTest: (params: { scenarioId: string; months?: number }) => void;
  isRunningStress: boolean;
  onBranch: (eventId: string) => void;
  isBranching: boolean;
}) {
  const sid = ev.scenario_id;
  if (!sid && ev.event_type !== 'recommendation_computed') return null;

  const btnClass = "h-6 px-2 text-[10px]";

  switch (ev.event_type) {
    case 'recommendation_computed':
      return (
        <>
          {sid && (
            <>
              <Button variant="outline" size="sm" className={btnClass} disabled={isSettingActive} onClick={() => onSetActive(sid)}>
                <Target className="h-3 w-3 mr-1" />Set Active
              </Button>
              <Button variant="outline" size="sm" className={btnClass} disabled={isProjecting} onClick={() => onRunProjection({ scenarioId: sid, months: 12 })}>
                <Play className="h-3 w-3 mr-1" />Project
              </Button>
              <Button variant="outline" size="sm" className={btnClass} disabled={isRunningStress} onClick={() => onRunStressTest({ scenarioId: sid, months: 12 })}>
                <Zap className="h-3 w-3 mr-1" />Stress
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className={btnClass} disabled={isBranching} onClick={() => onBranch(ev.id)}>
            <GitBranch className="h-3 w-3 mr-1" />Branch
          </Button>
        </>
      );
    case 'active_scenario_changed':
      return sid ? (
        <Button variant="outline" size="sm" className={btnClass} disabled={isSettingActive} onClick={() => onSetActive(sid)}>
          <Target className="h-3 w-3 mr-1" />Set Active
        </Button>
      ) : null;
    case 'projection_completed':
      return sid ? (
        <Button variant="outline" size="sm" className={btnClass} disabled={isProjecting} onClick={() => onRunProjection({ scenarioId: sid, months: 12 })}>
          <Play className="h-3 w-3 mr-1" />Project Again
        </Button>
      ) : null;
    case 'stress_test_completed':
      return sid ? (
        <Button variant="outline" size="sm" className={btnClass} disabled={isRunningStress} onClick={() => onRunStressTest({ scenarioId: sid, months: 12 })}>
          <Zap className="h-3 w-3 mr-1" />Stress Again
        </Button>
      ) : null;
    default:
      return null;
  }
}
