import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ShieldCheck, Check, X, ChevronDown, Inbox, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface PendingApproval {
  sourceScenarioId: string | null;
  targetScenarioId: string;
  requested_at: string;
  requested_by_user_id: string | null;
  domain: string;
  risk_score: number | null;
  risk_level: string | null;
  conflicts_count: number;
  paths: string[];
  request_event_id: string;
  has_merge_context?: boolean;
  strategy?: string | null;
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const RISK_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  low: 'outline',
  medium: 'secondary',
  high: 'destructive',
  critical: 'destructive',
};

export function MergeApprovalInbox({ projectId, scenarios }: Props) {
  const queryClient = useQueryClient();
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  const [forceConfirm, setForceConfirm] = useState<PendingApproval | null>(null);

  const { data: pendingApprovals = [], isLoading } = useQuery({
    queryKey: ['merge-approvals', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'list_pending_merge_approvals', projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.pending ?? []) as PendingApproval[];
    },
    enabled: !!projectId,
  });

  const decideMutation = useMutation({
    mutationFn: async (params: { sourceScenarioId?: string | null; targetScenarioId: string; approved: boolean; note?: string }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: {
          action: 'decide_merge_approval',
          projectId,
          sourceScenarioId: params.sourceScenarioId,
          targetScenarioId: params.targetScenarioId,
          approved: params.approved,
          note: params.note,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['merge-approvals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['decision-events', projectId] });
      queryClient.invalidateQueries({ queryKey: ['merge-approval-status', projectId] });
      toast.success(vars.approved ? 'Merge approved' : 'Merge rejected');
    },
    onError: (e: any) => {
      const msg = e.message ?? '';
      if (msg.includes('Not authorized')) {
        toast.error(`You're not authorized to approve this merge. ${msg}`);
      } else {
        toast.error(msg);
      }
    },
  });

  const handleReject = (item: PendingApproval) => {
    const note = noteMap[item.request_event_id] || window.prompt('Rejection reason (optional):') || '';
    decideMutation.mutate({
      sourceScenarioId: item.sourceScenarioId,
      targetScenarioId: item.targetScenarioId,
      approved: false,
      note,
    });
  };

  const applyMutation = useMutation({
    mutationFn: async (params: { sourceScenarioId?: string | null; targetScenarioId: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'apply_approved_merge', projectId, ...params },
      });
      if (error) throw error;
      if (data?.error) {
        const err: any = new Error(data.error);
        err.code = data.code;
        err.protected_hits = data.protected_hits;
        err.is_locked = data.is_locked;
        throw err;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merge-approvals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['decision-events', projectId] });
      queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] });
      queryClient.invalidateQueries({ queryKey: ['state-graph', projectId] });
      queryClient.invalidateQueries({ queryKey: ['merge-approval-status', projectId] });
      toast.success('Approved merge applied');
    },
    onError: (e: any) => {
      const code = e.code ?? '';
      if (code === 'protected_paths' || code === 'locked') {
        // Don't toast — force confirm dialog will handle
      } else if (code === 'force_not_authorized') {
        toast.error('Not authorized to force apply. Only owners/admins can force.');
      } else {
        toast.error(e.message ?? 'Apply failed');
      }
    },
  });

  const [applyingId, setApplyingId] = useState<string | null>(null);

  const handleApproveAndApply = async (item: PendingApproval) => {
    setApplyingId(item.request_event_id);
    try {
      // Step 1: Approve
      await decideMutation.mutateAsync({
        sourceScenarioId: item.sourceScenarioId,
        targetScenarioId: item.targetScenarioId,
        approved: true,
        note: noteMap[item.request_event_id] || 'Approved and applied',
      });
      // Step 2: Apply
      await applyMutation.mutateAsync({
        sourceScenarioId: item.sourceScenarioId,
        targetScenarioId: item.targetScenarioId,
      });
    } catch (err: any) {
      const code = err.code ?? '';
      if (code === 'protected_paths' || code === 'locked') {
        setForceConfirm(item);
      } else if (code === 'approval_pending') {
        toast.error('Approval not valid yet — still pending decision.');
      } else if (code === 'approval_invalid') {
        toast.error('Approval expired or invalid — request again.');
      }
    }
    setApplyingId(null);
  };

  const handleForceApply = async () => {
    if (!forceConfirm) return;
    setApplyingId(forceConfirm.request_event_id);
    setForceConfirm(null);
    try {
      await applyMutation.mutateAsync({
        sourceScenarioId: forceConfirm.sourceScenarioId,
        targetScenarioId: forceConfirm.targetScenarioId,
        force: true,
      });
    } catch (_) { /* handled by mutation */ }
    setApplyingId(null);
  };

  const cannotApply = (item: PendingApproval) =>
    !item.has_merge_context && !item.sourceScenarioId;

  return (
    <>
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Merge Approval Inbox
            {pendingApprovals.length > 0 && (
              <Badge variant="destructive" className="text-[10px] ml-1">{pendingApprovals.length} pending</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {!isLoading && pendingApprovals.length === 0 && (
            <div className="text-xs text-muted-foreground">No pending approval requests.</div>
          )}
          {pendingApprovals.map(item => (
            <Collapsible key={item.request_event_id}>
              <div className="rounded-md border border-border/30 bg-muted/10">
                <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/20 transition-colors">
                  <Badge variant="destructive" className="text-[10px] shrink-0">Pending</Badge>
                  <Badge variant="outline" className="text-[9px] shrink-0 capitalize">{item.domain}</Badge>
                  {item.risk_level && (
                    <Badge variant={RISK_BADGE_VARIANT[item.risk_level] ?? 'outline'} className="text-[10px] shrink-0">
                      Risk: {item.risk_level}{item.risk_score != null ? ` (${item.risk_score})` : ''}
                    </Badge>
                  )}
                  {!item.has_merge_context && (
                    <Badge variant="outline" className="text-[9px] shrink-0 text-muted-foreground">no context</Badge>
                  )}
                  <span className="text-xs font-medium truncate">
                    → {scenarioName(item.targetScenarioId, scenarios)}
                  </span>
                  {item.sourceScenarioId && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      from {scenarioName(item.sourceScenarioId, scenarios)}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                    {formatTime(item.requested_at)}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                </CollapsibleTrigger>

                <div className="px-3 pb-2 flex items-center gap-2">
                  <Input
                    className="h-6 text-[10px] flex-1"
                    placeholder="Decision note (optional)"
                    value={noteMap[item.request_event_id] ?? ''}
                    onChange={e => setNoteMap(m => ({ ...m, [item.request_event_id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    disabled={decideMutation.isPending || applyingId === item.request_event_id}
                    onClick={() => decideMutation.mutate({
                      sourceScenarioId: item.sourceScenarioId,
                      targetScenarioId: item.targetScenarioId,
                      approved: true,
                      note: noteMap[item.request_event_id],
                    })}
                  >
                    <Check className="h-3 w-3 mr-0.5" />Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-6 px-2 text-[10px]"
                    disabled={decideMutation.isPending || applyMutation.isPending || applyingId === item.request_event_id || cannotApply(item)}
                    title={cannotApply(item) ? 'Missing merge context — cannot auto-apply' : undefined}
                    onClick={() => handleApproveAndApply(item)}
                  >
                    {applyingId === item.request_event_id ? '…' : '✓ Approve + Apply'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-[10px]"
                    disabled={decideMutation.isPending || applyingId === item.request_event_id}
                    onClick={() => handleReject(item)}
                  >
                    <X className="h-3 w-3 mr-0.5" />Reject
                  </Button>
                </div>

                <CollapsibleContent>
                  <div className="px-3 pb-2 pt-1 border-t border-border/20 space-y-1">
                    <div className="text-[10px] text-muted-foreground">
                      Conflicts: {item.conflicts_count} · Paths: {item.paths.length}
                      {item.strategy && <> · Strategy: {item.strategy}</>}
                    </div>
                    {item.paths.length > 0 && (
                      <div className="text-[10px] text-muted-foreground font-mono space-y-0.5">
                        {item.paths.slice(0, 12).map(p => (
                          <div key={p}>{p}</div>
                        ))}
                        {item.paths.length > 12 && (
                          <div className="text-muted-foreground/60">+{item.paths.length - 12} more</div>
                        )}
                      </div>
                    )}
                    {item.requested_by_user_id && (
                      <div className="text-[10px] text-muted-foreground">
                        Requested by: {item.requested_by_user_id.slice(0, 8)}…
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      {/* Force Apply Confirmation Dialog */}
      <Dialog open={!!forceConfirm} onOpenChange={(open) => { if (!open) setForceConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Force Apply Required
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              This merge requires force due to locked or protected paths. Only project owners and admins can force apply.
            </DialogDescription>
          </DialogHeader>
          {forceConfirm && (
            <div className="text-xs space-y-1 py-2">
              <div>Target: <strong>{scenarioName(forceConfirm.targetScenarioId, scenarios)}</strong></div>
              <div>Domain: <Badge variant="outline" className="text-[9px] capitalize">{forceConfirm.domain}</Badge></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setForceConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" className="text-xs" onClick={handleForceApply}>
              Force Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
