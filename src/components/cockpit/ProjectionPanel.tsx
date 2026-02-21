import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScenarioProjectionChart } from './ScenarioProjectionChart';
import { Calendar } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectScenario, ScenarioProjection } from '@/hooks/useStateGraph';

interface Assumptions {
  inflation_rate: number;
  schedule_slip_risk: number;
  platform_appetite_decay: number;
}

const DEFAULT_ASSUMPTIONS: Assumptions = {
  inflation_rate: 0.03,
  schedule_slip_risk: 0.15,
  platform_appetite_decay: 0.05,
};

function loadAssumptions(projectId: string): Assumptions {
  try {
    const raw = localStorage.getItem(`iffy:lastProjectionAssumptions:${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_ASSUMPTIONS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_ASSUMPTIONS };
}

function saveAssumptions(projectId: string, a: Assumptions) {
  try {
    localStorage.setItem(`iffy:lastProjectionAssumptions:${projectId}`, JSON.stringify(a));
  } catch { /* ignore */ }
}

interface Props {
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  projectId: string;
  onRunProjection: (params: { scenarioId?: string; months?: number; assumptions?: Assumptions }) => void;
  isProjecting: boolean;
}

export function ProjectionPanel({
  scenarios, activeScenarioId, projectId, onRunProjection, isProjecting,
}: Props) {
  const [targetId, setTargetId] = useState<string>(activeScenarioId || '');
  const [months, setMonths] = useState<string>('12');

  // Use string state for inputs so partial typing like "0." works
  const [inflStr, setInflStr] = useState<string>('');
  const [slipStr, setSlipStr] = useState<string>('');
  const [decayStr, setDecayStr] = useState<string>('');

  useEffect(() => {
    const loaded = loadAssumptions(projectId);
    setInflStr(String(loaded.inflation_rate));
    setSlipStr(String(loaded.schedule_slip_risk));
    setDecayStr(String(loaded.platform_appetite_decay));
  }, [projectId]);

  const getCurrentAssumptions = useCallback((): Assumptions => {
    const parse = (s: string, fallback: number) => {
      const n = parseFloat(s);
      return isNaN(n) ? fallback : n;
    };
    return {
      inflation_rate: parse(inflStr, DEFAULT_ASSUMPTIONS.inflation_rate),
      schedule_slip_risk: parse(slipStr, DEFAULT_ASSUMPTIONS.schedule_slip_risk),
      platform_appetite_decay: parse(decayStr, DEFAULT_ASSUMPTIONS.platform_appetite_decay),
    };
  }, [inflStr, slipStr, decayStr]);

  const persistAssumptions = useCallback(() => {
    saveAssumptions(projectId, getCurrentAssumptions());
  }, [projectId, getCurrentAssumptions]);

  const nonBaseline = scenarios.filter(s => s.scenario_type !== 'baseline' && !s.is_archived);

  const { data: latestProjection = null } = useQuery({
    queryKey: ['projection', projectId, targetId],
    queryFn: async () => {
      if (!projectId || !targetId) return null;
      const { data, error } = await supabase
        .from('scenario_projections')
        .select('*')
        .eq('project_id', projectId)
        .eq('scenario_id', targetId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ScenarioProjection | null;
    },
    enabled: !!projectId && !!targetId,
  });

  const handleRun = () => {
    const assumptions = getCurrentAssumptions();
    persistAssumptions();
    onRunProjection({ scenarioId: targetId || undefined, months: parseInt(months), assumptions });
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Forward Projection
          </CardTitle>
          <Button size="sm" onClick={handleRun} disabled={isProjecting || !targetId}>
            {isProjecting ? 'Projecting…' : `Run ${months}-month Projection`}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="space-y-1 flex-1">
              <label className="text-xs text-muted-foreground">Scenario</label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {nonBaseline.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.is_active ? ' (Active)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-32">
              <label className="text-xs text-muted-foreground">Horizon</label>
              <Select value={months} onValueChange={setMonths}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 months</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Inflation Rate</label>
              <Input
                type="text"
                inputMode="decimal"
                value={inflStr}
                onChange={e => setInflStr(e.target.value)}
                onBlur={persistAssumptions}
                placeholder="0.03"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Schedule Slip Risk</label>
              <Input
                type="text"
                inputMode="decimal"
                value={slipStr}
                onChange={e => setSlipStr(e.target.value)}
                onBlur={persistAssumptions}
                placeholder="0.15"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Appetite Decay</label>
              <Input
                type="text"
                inputMode="decimal"
                value={decayStr}
                onChange={e => setDecayStr(e.target.value)}
                onBlur={persistAssumptions}
                placeholder="0.05"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {latestProjection && (
        <ScenarioProjectionChart
          series={latestProjection.series}
          summary={latestProjection.summary}
          riskScore={latestProjection.projection_risk_score}
        />
      )}
    </div>
  );
}
