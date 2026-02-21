import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScenarioProjectionChart } from './ScenarioProjectionChart';
import { Calendar } from 'lucide-react';
import { useState } from 'react';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface ProjectionData {
  series: any[];
  projection_risk_score: number;
  summary: string[];
}

interface Props {
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  latestProjection: ProjectionData | null;
  onRunProjection: (params: { scenarioId?: string; months?: number }) => void;
  isProjecting: boolean;
}

export function ProjectionPanel({
  scenarios, activeScenarioId, latestProjection, onRunProjection, isProjecting,
}: Props) {
  const [targetId, setTargetId] = useState<string>(activeScenarioId || '');
  const [months, setMonths] = useState<string>('12');

  const nonBaseline = scenarios.filter(s => s.scenario_type !== 'baseline' && !s.is_archived);

  return (
    <div className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Forward Projection
          </CardTitle>
          <Button
            size="sm"
            onClick={() => onRunProjection({ scenarioId: targetId || undefined, months: parseInt(months) })}
            disabled={isProjecting || !targetId}
          >
            {isProjecting ? 'Projecting…' : `Run ${months}-month Projection`}
          </Button>
        </CardHeader>
        <CardContent>
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
