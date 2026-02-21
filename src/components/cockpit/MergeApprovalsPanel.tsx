import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldCheck, Check, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface MergeApproval {
  id: string;
  project_id: string;
  scenario_id: string;
  requested_by: string | null;
  requested_at: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  payload: any;
  decision_note: string | null;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
}

function scenarioName(id: string, scenarios: ProjectScenario[]): string {
  const s = scenarios.find(sc => sc.id === id);
  return s?.name ?? id.slice(0, 8);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  approved: 'default',
  rejected: 'destructive',
};

export function MergeApprovalsPanel({ projectId, scenarios }: Props) {
  const queryClient = useQueryClient();
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ['merge-approvals', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scenario_merge_approvals')
        .select('*')
        .eq('project_id', projectId)
        .order('requested_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as MergeApproval[];
    },
    enabled: !!projectId,
  });

  const reviewMutation = useMutation({
    mutationFn: async (params: { id: string; status: 'approved' | 'rejected'; note?: string }) => {
      const { error } = await supabase
        .from('scenario_merge_approvals')
        .update({
          status: params.status,
          reviewed_at: new Date().toISOString(),
          decision_note: params.note || null,
        })
        .eq('id', params.id);
      if (error) throw error;

      // Log decision event
      const approval = approvals.find(a => a.id === params.id);
      if (approval) {
        try {
          await supabase.from('scenario_decision_events').insert({
            project_id: projectId,
            event_type: 'merge_approval_decided',
            scenario_id: approval.scenario_id,
            payload: {
              approval_id: params.id,
              decision: params.status,
              note: params.note || null,
            },
          });
        } catch (_) { /* non-fatal */ }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merge-approvals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['decision-events', projectId] });
      toast.success('Approval updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pendingCount = approvals.filter(a => a.status === 'pending').length;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Merge Approvals
          {pendingCount > 0 && (
            <Badge variant="destructive" className="text-[10px] ml-1">{pendingCount} pending</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && approvals.length === 0 && (
          <div className="text-xs text-muted-foreground">No merge approval requests.</div>
        )}
        {approvals.map(a => (
          <div key={a.id} className="rounded-md border border-border/30 bg-muted/10 px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={STATUS_VARIANTS[a.status] ?? 'outline'} className="text-[10px]">
                {a.status}
              </Badge>
              <span className="text-xs font-medium">
                Target: {scenarioName(a.scenario_id, scenarios)}
              </span>
              {a.payload?.risk_level && (
                <Badge variant={a.payload.risk_level === 'critical' ? 'destructive' : 'outline'} className="text-[10px]">
                  Risk: {a.payload.risk_level}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {formatTime(a.requested_at)}
              </span>
            </div>

            {a.payload?.sourceScenarioId && (
              <div className="text-[10px] text-muted-foreground">
                Source: {scenarioName(a.payload.sourceScenarioId, scenarios)} · 
                Strategy: {a.payload.strategy ?? 'overwrite'} · 
                Paths: {a.payload.paths?.length ?? '?'}
              </div>
            )}

            {a.decision_note && (
              <div className="text-[10px] text-muted-foreground italic">Note: {a.decision_note}</div>
            )}

            {a.status === 'pending' && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  className="h-6 text-[10px] flex-1"
                  placeholder="Decision note (optional)"
                  value={noteMap[a.id] ?? ''}
                  onChange={e => setNoteMap(m => ({ ...m, [a.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate({ id: a.id, status: 'approved', note: noteMap[a.id] })}
                >
                  <Check className="h-3 w-3 mr-0.5" />Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[10px]"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate({ id: a.id, status: 'rejected', note: noteMap[a.id] })}
                >
                  <X className="h-3 w-3 mr-0.5" />Reject
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
