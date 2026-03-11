/**
 * AutopilotRepairPanel — Displays autopilot narrative repair state
 * with continuous monitoring metadata.
 *
 * Shows health status (stable/triggered/unknown), trigger reason,
 * repair preview counts, strategy selector, action buttons,
 * and monitoring metadata (evaluated_at, derived_live, structural_uncertainty,
 * last_run confidence).
 *
 * All data from get_autopilot_monitor_status or detect_autopilot_repair.
 * Never fabricates state or executes repairs automatically.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Loader2,
  FlaskConical,
  Play,
  Search,
  Radio,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import type { NarrativeMonitorStatus } from '@/hooks/useNarrativeMonitor';
import type { RepairStrategy } from '@/hooks/useSelectiveRegenerationPlan';

interface Props {
  data: NarrativeMonitorStatus | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  onPreviewPlan: () => void;
  onDryRun: () => void;
  onExecuteRepair: () => void;
  isExecuting: boolean;
  repairStrategy: RepairStrategy;
  onStrategyChange: (strategy: RepairStrategy) => void;
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

const CONFIDENCE_LABELS: Record<string, { label: string; className: string }> = {
  high:   { label: 'High',   className: 'text-emerald-600 dark:text-emerald-400' },
  medium: { label: 'Medium', className: 'text-amber-600 dark:text-amber-400' },
  low:    { label: 'Low',    className: 'text-destructive' },
};

const STRATEGY_OPTIONS: { value: RepairStrategy; label: string; description: string }[] = [
  {
    value: 'precision',
    label: 'Precision Repair',
    description: 'Minimal blast radius. Focuses on direct scenes only unless backend expands under strict rules.',
  },
  {
    value: 'balanced',
    label: 'Balanced Repair',
    description: 'Recommended default. Includes direct, propagated, and entity-linked scenes within current safeguards.',
  },
  {
    value: 'stabilization',
    label: 'Stabilization Repair',
    description: 'Broader stabilization pass for systemic narrative drift.',
  },
];

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const now = Date.now();
    const diffMs = now - date.getTime();
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  } catch {
    return isoString;
  }
}

export function AutopilotRepairPanel({
  data,
  isLoading,
  onRefresh,
  onPreviewPlan,
  onDryRun,
  onExecuteRepair,
  isExecuting,
  repairStrategy,
  onStrategyChange,
}: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Narrative Health
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
            Narrative Health
          </h3>
          <button onClick={onRefresh} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Monitoring unavailable
          </span>
        </div>
      </div>
    );
  }

  const state = data.autopilot_state;
  const isTriggered = state === 'triggered';
  const isStable = state === 'stable';
  const hasStructuralUncertainty = data.structural_uncertainty === true;
  const actionsEnabled = isTriggered && data.execution_allowed && !isExecuting;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Narrative Health
        </h3>
        <div className="flex items-center gap-2">
          {isStable && !hasStructuralUncertainty && (
            <Badge variant="secondary" className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              <ShieldCheck className="h-3 w-3" />
              Stable
            </Badge>
          )}
          {isStable && hasStructuralUncertainty && (
            <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-3 w-3" />
              Uncertain
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

      {/* Monitoring metadata bar */}
      <MonitoringMetaBar data={data} />

      {/* Structural uncertainty warning */}
      {hasStructuralUncertainty && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-xs text-muted-foreground">
            Structural uncertainty detected — narrative health cannot be fully confirmed.
          </span>
        </div>
      )}

      {/* Stable state (no uncertainty) */}
      {isStable && !hasStructuralUncertainty && (
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

          {/* Strategy Selector */}
          <StrategySelector value={repairStrategy} onChange={onStrategyChange} disabled={isExecuting} />

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

/* ── Monitoring Metadata Bar ── */

function MonitoringMetaBar({ data }: { data: NarrativeMonitorStatus }) {
  const confBand = data.last_run_confidence_band
    ? CONFIDENCE_LABELS[data.last_run_confidence_band]
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {data.derived_live && (
        <span className="flex items-center gap-1">
          <Radio className="h-2.5 w-2.5 text-emerald-500" />
          Live evaluation
        </span>
      )}
      {data.evaluated_at && (
        <span className="flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          Evaluated {formatRelativeTime(data.evaluated_at)}
        </span>
      )}
      {data.last_run_at && (
        <span className="flex items-center gap-1">
          Last repair: {formatRelativeTime(data.last_run_at)}
        </span>
      )}
      {confBand && (
        <span className="flex items-center gap-1">
          Confidence: <span className={`font-medium ${confBand.className}`}>{confBand.label}</span>
        </span>
      )}
    </div>
  );
}

/* ── Strategy Selector ── */

function StrategySelector({ value, onChange, disabled }: {
  value: RepairStrategy;
  onChange: (v: RepairStrategy) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-2.5 space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Repair Strategy
      </h4>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as RepairStrategy)}
        disabled={disabled}
        className="gap-1.5"
      >
        {STRATEGY_OPTIONS.map((opt) => (
          <div key={opt.value} className="flex items-start gap-2.5">
            <RadioGroupItem value={opt.value} id={`strategy-${opt.value}`} className="mt-0.5" />
            <Label htmlFor={`strategy-${opt.value}`} className="cursor-pointer space-y-0.5 text-xs leading-snug">
              <span className="font-medium text-foreground">{opt.label}</span>
              <p className="text-[11px] text-muted-foreground leading-tight">{opt.description}</p>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

/* ── Preview Count ── */

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
