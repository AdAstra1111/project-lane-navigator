/**
 * AutopilotRepairPanel — Displays autopilot narrative repair state.
 *
 * Shows health status (stable/triggered/unknown), trigger reason,
 * repair preview counts, and action buttons for plan/dry-run/execute.
 *
 * All data from detect_autopilot_repair engine action.
 * Never fabricates state or executes repairs automatically.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Loader2,
  FlaskConical,
  Play,
  Search,
} from 'lucide-react';
import type { AutopilotRepairDetection } from '@/hooks/useAutopilotRepairDetection';

interface Props {
  data: AutopilotRepairDetection | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  onPreviewPlan: () => void;
  onDryRun: () => void;
  onExecuteRepair: () => void;
  isExecuting: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  stale_units: 'Stale narrative units detected',
  ndg_risk: 'NDG propagation risk threshold exceeded',
  failed_repair: 'Previous repair had low confidence',
  propagation_drift: 'Entity propagation drift detected',
};

const SCOPE_LABELS: Record<string, string> = {
  no_risk: 'No Risk',
  propagated_only: 'Propagated Only',
  targeted_scenes: 'Targeted Scenes',
  broad_impact: 'Broad Impact',
};

export function AutopilotRepairPanel({
  data,
  isLoading,
  onRefresh,
  onPreviewPlan,
  onDryRun,
  onExecuteRepair,
  isExecuting,
}: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Autopilot Status
          </h3>
        </div>
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }

  // Fail-closed: no data
  if (!data) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Autopilot Status
          </h3>
          <button onClick={onRefresh} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Autopilot state unavailable
          </span>
        </div>
      </div>
    );
  }

  const state = data.autopilot_state;
  const isTriggered = state === 'triggered';
  const isStable = state === 'stable';
  const actionsEnabled = isTriggered && data.execution_allowed && !isExecuting;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Autopilot Status
        </h3>
        <div className="flex items-center gap-2">
          {isStable && (
            <Badge variant="secondary" className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              <ShieldCheck className="h-3 w-3" />
              Healthy
            </Badge>
          )}
          {isTriggered && (
            <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Repair Recommended
            </Badge>
          )}
          {state === 'unknown' && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <HelpCircle className="h-3 w-3" />
              Unknown
            </Badge>
          )}
          <button onClick={onRefresh} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Stable state */}
      {isStable && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          <span className="text-sm text-muted-foreground">
            Narrative health: stable — no repair recommended.
          </span>
        </div>
      )}

      {/* Triggered state */}
      {isTriggered && (
        <div className="space-y-3">
          {/* Trigger reason */}
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-sm font-medium text-foreground">Repair Recommended</span>
            </div>
            {data.trigger_reason && (
              <p className="text-xs text-muted-foreground">
                {TRIGGER_LABELS[data.trigger_reason] ?? data.trigger_reason}
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Scenes affected: <span className="font-medium text-foreground">{data.estimated_scene_count}</span></span>
              {data.recommended_scope && (
                <span>Scope: <span className="font-medium text-foreground">{SCOPE_LABELS[data.recommended_scope] ?? data.recommended_scope}</span></span>
              )}
              {data.stale_unit_count > 0 && (
                <span>Stale units: <span className="font-medium text-foreground">{data.stale_unit_count}</span></span>
              )}
              {data.ndg_at_risk_count > 0 && (
                <span>NDG at risk: <span className="font-medium text-foreground">{data.ndg_at_risk_count}</span></span>
              )}
            </div>
          </div>

          {/* Repair preview */}
          {data.repair_preview && (
            <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-2 space-y-1.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Impact Preview</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <PreviewCount label="Direct" value={data.repair_preview.direct} className="text-destructive" />
                <PreviewCount label="Propagated" value={data.repair_preview.propagated} className="text-amber-600 dark:text-amber-400" />
                <PreviewCount label="Entity-linked" value={data.repair_preview.entity_link} className="text-sky-600 dark:text-sky-400" />
                <PreviewCount label="Advisory" value={data.repair_preview.entity_propagation} className="text-violet-600 dark:text-violet-400" advisory />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" disabled={!actionsEnabled} onClick={onPreviewPlan}>
              <Search className="h-3.5 w-3.5" />
              Preview Plan
            </Button>
            <Button variant="outline" size="sm" disabled={!actionsEnabled} onClick={onDryRun}>
              {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Dry Run
            </Button>
            <Button size="sm" disabled={!actionsEnabled} onClick={onExecuteRepair}>
              {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Execute Repair
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewCount({ label, value, className = '', advisory = false }: {
  label: string;
  value: number;
  className?: string;
  advisory?: boolean;
}) {
  return (
    <div className="text-center">
      <div className={`text-sm font-semibold ${className}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">
        {label}
        {advisory && <span className="block text-[9px] italic">not executed</span>}
      </div>
    </div>
  );
}
