/**
 * NarrativeSimulationPanel — Read-only predictive simulation UI.
 * Calls simulate_narrative_impact via useNarrativeSimulation hook.
 * Displays impact preview without altering runtime state.
 */

import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FlaskConical,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { useNarrativeSimulation, type SimulationResult } from '@/hooks/useNarrativeSimulation';
import type { RepairStrategy } from '@/hooks/useSelectiveRegenerationPlan';

interface Props {
  projectId: string | undefined;
}

const STRATEGY_OPTIONS: { value: RepairStrategy; label: string }[] = [
  { value: 'precision', label: 'Precision' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'stabilization', label: 'Stabilization' },
];

const KNOWN_AXES = [
  'story_engine',
  'protagonist_arc',
  'pressure_system',
  'central_conflict',
  'resolution_type',
  'stakes_class',
];

export function NarrativeSimulationPanel({ projectId }: Props) {
  const { data, simulate, isLoading, error } = useNarrativeSimulation(projectId);
  const [strategy, setStrategy] = useState<RepairStrategy>('balanced');
  const [selectedAxis, setSelectedAxis] = useState<string>('');

  const canSimulate = !!projectId && !!selectedAxis && !isLoading;

  const handleSimulate = useCallback(() => {
    if (!selectedAxis) return;
    simulate({
      axis_keys: [selectedAxis],
      repair_strategy: strategy,
    });
  }, [simulate, selectedAxis, strategy]);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Narrative Impact Simulation
      </h3>

      <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-3 space-y-3">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Axis selector */}
          <div className="space-y-1 flex-1 min-w-[140px]">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Axis
            </label>
            <Select value={selectedAxis} onValueChange={setSelectedAxis}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select axis…" />
              </SelectTrigger>
              <SelectContent>
                {KNOWN_AXES.map((axis) => (
                  <SelectItem key={axis} value={axis} className="text-xs">
                    {axis}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Strategy selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Strategy
            </label>
            <RadioGroup
              value={strategy}
              onValueChange={(v) => setStrategy(v as RepairStrategy)}
              className="flex gap-3"
              disabled={isLoading}
            >
              {STRATEGY_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-1.5">
                  <RadioGroupItem value={opt.value} id={`sim-strategy-${opt.value}`} />
                  <Label htmlFor={`sim-strategy-${opt.value}`} className="text-xs cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Simulate button */}
          <Button
            variant="outline"
            size="sm"
            disabled={!canSimulate}
            onClick={handleSimulate}
            className="h-8"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5" />
            )}
            Simulate
          </Button>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-xs text-destructive">{error}</span>
          </div>
        )}

        {/* Results */}
        {data && !error && <SimulationResultDisplay result={data} />}
      </div>
    </div>
  );
}

/* ── Result Display ── */

function SimulationResultDisplay({ result }: { result: SimulationResult }) {
  if (result.simulation_state === 'no_impact') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
        <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="text-sm text-muted-foreground">
          No narrative impact detected for this input.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium text-foreground">
          Impact found — {result.impacted_scene_count} scene{result.impacted_scene_count !== 1 ? 's' : ''} affected
        </span>
        {result.recommended_scope && (
          <Badge variant="outline" className="text-[10px]">
            {result.recommended_scope}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <SimCount label="Direct" value={result.direct_scenes} className="text-destructive" />
        <SimCount label="Propagated" value={result.propagated_scenes} className="text-amber-600 dark:text-amber-400" />
        <SimCount label="Entity-linked" value={result.entity_link_scenes} className="text-sky-600 dark:text-sky-400" />
        <SimCount label="Advisory" value={result.entity_propagation_scenes} className="text-violet-600 dark:text-violet-400" advisory />
      </div>
    </div>
  );
}

/* ── Count Cell ── */

function SimCount({ label, value, className = '', advisory = false }: {
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
