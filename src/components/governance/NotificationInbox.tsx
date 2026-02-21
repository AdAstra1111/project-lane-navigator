import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, Check, CheckCheck, ExternalLink } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface Notification {
  id: string;
  created_at: string;
  kind: string;
  domain: string;
  thread_key: string;
  sourceScenarioId: string | null;
  targetScenarioId: string | null;
  related_event_id: string | null;
  reason: string;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  onNavigateToThread?: (params: { sourceScenarioId: string | null; targetScenarioId: string }) => void;
}

const KIND_LABELS: Record<string, string> = {
  merge_approval_requested: 'Approval Requested',
  merge_approval_decided: 'Decision Made',
  merge_applied_from_approval: 'Merge Applied',
};

const KIND_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  merge_approval_requested: 'destructive',
  merge_approval_decided: 'default',
  merge_applied_from_approval: 'secondary',
};

function scenarioName(id: string | null, scenarios: ProjectScenario[]): string {
  if (!id) return '—';
  const s = scenarios.find(sc => sc.id === id);
  return s?.name ?? id.slice(0, 8);
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function NotificationInbox({ projectId, scenarios, onNavigateToThread }: Props) {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['governance-notifications', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'list_notifications', projectId, includeRead: false },
      });
      if (error) return [];
      return (data?.notifications ?? []) as Notification[];
    },
    enabled: !!projectId,
    refetchInterval: 25000,
    refetchIntervalInBackground: false,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'mark_notifications_read', projectId, notificationIds: ids },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-notifications', projectId] });
    },
  });

  const handleMarkRead = (id: string) => markReadMutation.mutate([id]);

  const handleMarkAllRead = () => {
    const ids = notifications.map(n => n.id);
    if (ids.length === 0) return;
    markReadMutation.mutate(ids);
    toast.success(`Marked ${ids.length} notifications read`);
  };

  if (notifications.length === 0 && !isLoading) return null;

  // Group by day
  const grouped: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const day = formatDay(n.created_at);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(n);
  }

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
            {notifications.length > 0 && (
              <Badge variant="destructive" className="text-[10px] ml-1">{notifications.length}</Badge>
            )}
          </CardTitle>
          {notifications.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={handleMarkAllRead}
              disabled={markReadMutation.isPending}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {Object.entries(grouped).map(([day, items]) => (
          <div key={day} className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{day}</div>
            {items.map(n => (
              <div
                key={n.id}
                className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 flex items-center gap-2 flex-wrap"
              >
                <Badge
                  variant={KIND_VARIANTS[n.kind] ?? 'outline'}
                  className="text-[9px] shrink-0"
                >
                  {KIND_LABELS[n.kind] ?? n.kind}
                </Badge>
                <Badge variant="outline" className="text-[9px] capitalize">{n.domain}</Badge>
                <span className="text-xs truncate">
                  → {scenarioName(n.targetScenarioId, scenarios)}
                </span>
                {n.sourceScenarioId && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    from {scenarioName(n.sourceScenarioId, scenarios)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">{formatTime(n.created_at)}</span>
                <span className="text-[10px] text-muted-foreground italic">{n.reason}</span>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {onNavigateToThread && n.targetScenarioId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      title="Open thread"
                      onClick={() => onNavigateToThread({
                        sourceScenarioId: n.sourceScenarioId,
                        targetScenarioId: n.targetScenarioId!,
                      })}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0"
                    title="Mark read"
                    disabled={markReadMutation.isPending}
                    onClick={() => handleMarkRead(n.id)}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
