/**
 * LookbookTriggerDiagnosticsStrip — Displays current rebuild trigger evaluation
 * from evaluateRebuildTrigger(). Shows whether a rebuild is recommended,
 * which mode, and slot health summary.
 *
 * Consumes diagnostics from useLookbookAutoRebuild. No metric recomputation.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Activity, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Zap, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { getTriggerConditionLabel, type RebuildTriggerDiagnostics } from '@/lib/images/lookbookRebuildTrigger';

interface LookbookTriggerDiagnosticsStripProps {
  diagnostics: RebuildTriggerDiagnostics | null;
  evaluating: boolean;
  rebuilding: boolean;
  onLaunchRebuild: () => void;
}

const MODE_LABELS: Record<string, string> = {
  RESET_FULL_CANON_REBUILD: 'Reset',
  PRESERVE_PRIMARIES_FULL_CANON_REBUILD: 'Preserve',
};

export function LookbookTriggerDiagnosticsStrip({
  diagnostics,
  evaluating,
  rebuilding,
  onLaunchRebuild,
}: LookbookTriggerDiagnosticsStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (evaluating && !diagnostics) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Evaluating rebuild conditions…
      </div>
    );
  }

  if (!diagnostics) return null;

  const { shouldRebuild, conditions, recommendedMode, modeReason, slotSummary } = diagnostics;

  if (!shouldRebuild) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span className="text-muted-foreground">
          All {slotSummary.totalSlots} slots healthy — no rebuild needed
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">
          {slotSummary.filledSlots}/{slotSummary.totalSlots} filled
        </Badge>
      </div>
    );
  }

  const severity = conditions.includes('unresolved_required_slots') || conditions.includes('missing_primaries')
    ? 'warning'
    : conditions.includes('non_compliant_primaries')
      ? 'error'
      : 'info';

  const borderColor = {
    warning: 'border-amber-500/30 bg-amber-500/5',
    error: 'border-destructive/30 bg-destructive/5',
    info: 'border-primary/20 bg-primary/5',
  }[severity];

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={cn('rounded-lg border px-3 py-2', borderColor)}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center gap-2 text-left text-xs">
            <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium">Rebuild recommended</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {MODE_LABELS[recommendedMode] || recommendedMode}
            </Badge>
            <span className="text-muted-foreground">
              {slotSummary.emptySlots > 0
                ? `${slotSummary.emptySlots} empty`
                : `${slotSummary.weakSlots} weak`}
              {slotSummary.nonCompliantSlots > 0 ? `, ${slotSummary.nonCompliantSlots} non-compliant` : ''}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onLaunchRebuild();
                }}
                disabled={rebuilding}
              >
                {rebuilding
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Zap className="h-3 w-3" />}
                {rebuilding ? 'Rebuilding…' : 'Auto-Rebuild'}
              </Button>
              {expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 space-y-1.5 text-[11px]">
            {/* Conditions */}
            <div className="space-y-0.5">
              <span className="font-medium text-muted-foreground">Trigger conditions:</span>
              {conditions.map(c => (
                <div key={c} className="flex items-center gap-1.5 pl-2">
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                  <span>{getTriggerConditionLabel(c)}</span>
                </div>
              ))}
            </div>

            {/* Mode reason */}
            <div className="text-muted-foreground">
              <span className="font-medium">Mode: </span>
              {modeReason}
            </div>

            {/* Slot summary */}
            <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
              <div>
                <span className="font-medium text-foreground">{slotSummary.totalSlots}</span> total
              </div>
              <div>
                <span className="font-medium text-foreground">{slotSummary.filledSlots}</span> filled
              </div>
              <div>
                <span className="font-medium text-foreground">{slotSummary.emptySlots}</span> empty
              </div>
              <div>
                <span className="font-medium text-foreground">{slotSummary.weakSlots}</span> weak
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
