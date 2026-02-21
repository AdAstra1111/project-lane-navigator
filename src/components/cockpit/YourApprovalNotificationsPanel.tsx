import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface ApprovalNotification {
  sourceScenarioId: string | null;
  targetScenarioId: string;
  requested_at: string;
  decided_at: string;
  approved: boolean;
  domain: string;
  note?: string | null;
  strategy?: string | null;
  has_merge_context: boolean;
  approval_valid_now: boolean;
  apply_ready: boolean;
  request_event_id: string;
}

interface ActionableItem {
  sourceScenarioId: string | null;
  targetScenarioId: string;
  approved_at: string;
  domain: string;
  strategy: string;
  request_event_id: string;
  paths_count: number;
  expires_at: string;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
}

function scenarioName(id: string | null, scenarios: ProjectScenario[]): string {
  if (!id) return '—';
  const s = scenarios.find(sc => sc.id === id);
  return s?.name ?? id.slice(0, 8);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function YourApprovalNotificationsPanel({ projectId, scenarios }: Props) {
  const queryClient = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  // Poll for requester notifications (toast on new)
  const { data: notifications = [] } = useQuery({
    queryKey: ['requester-notifications', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'list_requester_notifications', projectId },
      });
      if (error) return [];
      return (data?.notifications ?? []) as ApprovalNotification[];
    },
    enabled: !!projectId,
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
  });

  // Toast on new notifications
  useEffect(() => {
    for (const n of notifications) {
      const key = `${n.request_event_id}::${n.decided_at}`;
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key);
        // Only toast if decided recently (last 2 minutes)
        const age = Date.now() - new Date(n.decided_at).getTime();
        if (age < 2 * 60 * 1000) {
          if (n.approved) {
            toast.success(`Merge approved — ${n.apply_ready ? 'Apply now!' : 'Ready'}`, {
              description: `→ ${scenarioName(n.targetScenarioId, scenarios)} (${n.domain})`,
            });
          } else {
            toast.error(`Merge rejected`, {
              description: `→ ${scenarioName(n.targetScenarioId, scenarios)}${n.note ? `: ${n.note}` : ''}`,
            });
          }
        }
      }
    }
  }, [notifications, scenarios]);

  // Actionable items (user's approved merges ready to apply)
  const { data: actionableItems = [] } = useQuery({
    queryKey: ['actionable-approved-merges-for-user', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'list_actionable_approved_merges_for_user', projectId },
      });
      if (error) return [];
      return (data?.items ?? []) as ActionableItem[];
    },
    enabled: !!projectId,
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
  });

  const handleApply = async (item: ActionableItem) => {
    setApplyingId(item.request_event_id);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: {
          action: 'apply_approved_merge',
          projectId,
          sourceScenarioId: item.sourceScenarioId,
          targetScenarioId: item.targetScenarioId,
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
      } else {
        queryClient.invalidateQueries({ queryKey: ['actionable-approved-merges-for-user', projectId] });
        queryClient.invalidateQueries({ queryKey: ['actionable-approved-merges', projectId] });
        queryClient.invalidateQueries({ queryKey: ['merge-approvals', projectId] });
        queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] });
        queryClient.invalidateQueries({ queryKey: ['state-graph', projectId] });
        queryClient.invalidateQueries({ queryKey: ['decision-events', projectId] });
        toast.success('Approved merge applied');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Apply failed');
    }
    setApplyingId(null);
  };

  if (actionableItems.length === 0) return null;

  return (
    <Card className="border-border/40 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Your Approved Merges
          <Badge variant="default" className="text-[10px] ml-1">{actionableItems.length} ready</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actionableItems.map(item => (
          <div key={item.request_event_id} className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2 flex-wrap">
            <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
            <Badge variant="outline" className="text-[9px] capitalize">{item.domain}</Badge>
            <Badge variant="outline" className="text-[9px]">{item.strategy}</Badge>
            <span className="text-xs font-medium truncate">
              → {scenarioName(item.targetScenarioId, scenarios)}
            </span>
            {item.sourceScenarioId && (
              <span className="text-[10px] text-muted-foreground truncate">
                from {scenarioName(item.sourceScenarioId, scenarios)}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {item.paths_count} paths · approved {timeAgo(item.approved_at)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              <Clock className="inline h-3 w-3 mr-0.5" />
              expires {new Date(item.expires_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[10px] ml-auto"
              disabled={applyingId === item.request_event_id}
              onClick={() => handleApply(item)}
            >
              {applyingId === item.request_event_id ? 'Applying…' : 'Apply Now'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
