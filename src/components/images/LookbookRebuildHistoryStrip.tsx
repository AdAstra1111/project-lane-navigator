/**
 * LookbookRebuildHistoryStrip — Displays recent lookbook rebuild runs
 * from the canonical lookbook_rebuild_runs audit table.
 *
 * Consumes persisted data only. No metric recomputation.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { History, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchRecentRebuildRuns,
  getRebuildStatusSeverity,
  getRebuildStatusLabel,
  type LookbookRebuildRun,
} from '@/lib/images/canonRebuildExecutor';

interface LookbookRebuildHistoryStripProps {
  projectId: string;
  /** Increment to force refresh after a rebuild completes */
  refreshEpoch?: number;
  /** Max runs to show */
  limit?: number;
}

export function LookbookRebuildHistoryStrip({
  projectId,
  refreshEpoch = 0,
  limit = 5,
}: LookbookRebuildHistoryStripProps) {
  const [runs, setRuns] = useState<LookbookRebuildRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRecentRebuildRuns(projectId, limit).then(data => {
      if (!cancelled) {
        setRuns(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [projectId, refreshEpoch, limit]);

  if (loading || runs.length === 0) return null;

  const latest = runs[0];
  const severity = getRebuildStatusSeverity(latest.execution_status as any);

  const severityColor = {
    success: 'border-emerald-500/30 bg-emerald-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    error: 'border-destructive/30 bg-destructive/5',
    neutral: 'border-border bg-muted/30',
  }[severity];

  const severityIcon = {
    success: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
    warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
    error: <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
    neutral: <Minus className="h-3.5 w-3.5 text-muted-foreground" />,
  }[severity];

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={cn('rounded-lg border px-3 py-2', severityColor)}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center gap-2 text-left text-xs">
            <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium">Last rebuild</span>
            {severityIcon}
            <span className="text-muted-foreground">
              {getRebuildStatusLabel(latest.execution_status as any)}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">
              {latest.rebuild_mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD' ? 'Preserve' : 'Reset'}
            </Badge>
            <span className="text-muted-foreground ml-auto">
              {latest.resolved_slots}/{latest.total_slots} resolved
            </span>
            {expanded
              ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {runs.map(run => (
              <RebuildRunRow key={run.id} run={run} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function RebuildRunRow({ run }: { run: LookbookRebuildRun }) {
  const severity = getRebuildStatusSeverity(run.execution_status as any);
  const modeLabel = run.rebuild_mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD'
    ? 'Preserve' : 'Reset';

  const timeAgo = formatTimeAgo(run.started_at);

  return (
    <div className="border-t border-border/50 pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-[11px]">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {modeLabel}
        </Badge>
        <span className="text-muted-foreground">{timeAgo}</span>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] px-1.5 py-0',
            severity === 'success' && 'border-emerald-500/30 text-emerald-500',
            severity === 'warning' && 'border-amber-500/30 text-amber-500',
            severity === 'error' && 'border-destructive/30 text-destructive',
          )}
        >
          {getRebuildStatusLabel(run.execution_status as any)}
        </Badge>
        {run.trigger_source !== 'manual_ui' && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {run.trigger_source}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 mt-1 text-[10px] text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">{run.resolved_slots}</span>/{run.total_slots} resolved
        </div>
        <div>
          <span className="font-medium text-foreground">{run.generated_count}</span> generated
        </div>
        <div>
          <span className="font-medium text-foreground">{run.preserved_primary_count}</span> preserved
        </div>
        <div>
          <span className="font-medium text-foreground">{run.replaced_primary_count}</span> replaced
        </div>
      </div>

      {run.failure_stage && (
        <div className="text-[10px] text-destructive mt-1">
          Failed at: {run.failure_stage} — {run.failure_message || 'Unknown'}
        </div>
      )}

      {run.unresolved_slots > 0 && run.unresolved_reasons?.length > 0 && (
        <div className="text-[10px] text-amber-500 mt-1">
          {run.unresolved_reasons.slice(0, 3).map((r: any, i: number) => (
            <div key={i}>{r.slotKey}: {r.reason}</div>
          ))}
          {run.unresolved_reasons.length > 3 && (
            <div>+{run.unresolved_reasons.length - 3} more</div>
          )}
        </div>
      )}

      {run.duration_ms != null && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Duration: {(run.duration_ms / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
