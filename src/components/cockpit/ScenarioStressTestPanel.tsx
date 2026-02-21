import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FlaskConical } from 'lucide-react';
import type { ProjectScenario, ScenarioStressTest } from '@/hooks/useStateGraph';

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  onRunStressTest: (params: { scenarioId: string; months?: number; sweeps?: any }) => void;
  isRunning: boolean;
  latestStressTest: ScenarioStressTest | null;
}

export function ScenarioStressTestPanel({
  scenarios, activeScenarioId, onRunStressTest, isRunning, latestStressTest,
}: Props) {
  const nonArchived = scenarios.filter(s => !s.is_archived && s.scenario_type !== 'baseline');
  const [targetId, setTargetId] = useState(activeScenarioId || '');
  const [months, setMonths] = useState('12');

  useEffect(() => {
    if (activeScenarioId) setTargetId(activeScenarioId);
  }, [activeScenarioId]);

  const handleRun = () => {
    if (!targetId) return;
    onRunStressTest({ scenarioId: targetId, months: parseInt(months) });
  };

  const st = latestStressTest;
  const results = (st?.results || []) as Array<{
    inflation_rate: number;
    schedule_slip_risk: number;
    platform_appetite_decay: number;
    composite: number;
    projection_risk_score: number;
    end_confidence: number;
    end_budget: number;
  }>;

  const breakpoints = st?.breakpoints as Record<string, any> | undefined;

  return (
    <div className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Sensitivity / Stress Test
          </CardTitle>
          <Button size="sm" onClick={handleRun} disabled={isRunning || !targetId}>
            {isRunning ? 'Running…' : 'Run Stress Test'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="space-y-1 flex-1">
              <label className="text-xs text-muted-foreground">Scenario</label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {nonArchived.map(s => (
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

          {st && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  Fragility {st.fragility_score}/100
                </Badge>
                <Badge variant="secondary">
                  Volatility {st.volatility_index}/100
                </Badge>
              </div>

              {breakpoints && Object.keys(breakpoints).length > 0 && (
                <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-1">
                  <div className="text-xs font-semibold">Breakpoints</div>
                  {breakpoints.below_45 && (
                    <div className="text-xs text-muted-foreground">
                      Composite drops below 45 at inflation={breakpoints.below_45.inflation_rate}, slip={breakpoints.below_45.schedule_slip_risk}, decay={breakpoints.below_45.platform_appetite_decay}
                    </div>
                  )}
                  {breakpoints.below_baseline && (
                    <div className="text-xs text-muted-foreground">
                      Falls below baseline ({breakpoints.below_baseline.baseline_composite}) at inflation={breakpoints.below_baseline.inflation_rate}, slip={breakpoints.below_baseline.schedule_slip_risk}
                    </div>
                  )}
                  {!breakpoints.below_45 && !breakpoints.below_baseline && (
                    <div className="text-xs text-muted-foreground">No breakpoints detected — scenario is resilient across all tested assumptions.</div>
                  )}
                </div>
              )}

              {results.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/40">
                        <th className="text-left py-1 pr-2">Inflation</th>
                        <th className="text-left py-1 pr-2">Slip Risk</th>
                        <th className="text-left py-1 pr-2">Decay</th>
                        <th className="text-right py-1 pr-2">Composite</th>
                        <th className="text-right py-1">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b border-border/20">
                          <td className="py-1 pr-2 font-mono">{r.inflation_rate}</td>
                          <td className="py-1 pr-2 font-mono">{r.schedule_slip_risk}</td>
                          <td className="py-1 pr-2 font-mono">{r.platform_appetite_decay}</td>
                          <td className="py-1 pr-2 text-right font-mono">{r.composite}</td>
                          <td className="py-1 text-right font-mono">{r.projection_risk_score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {results.length > 20 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Showing 20 of {results.length} sweep results
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!st && (
            <div className="text-sm text-muted-foreground">
              No stress test results yet. Select a scenario and run.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
