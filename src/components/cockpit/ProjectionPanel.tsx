import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScenarioProjectionChart } from './ScenarioProjectionChart';
import { Calendar } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectScenario, ScenarioProjection } from '@/hooks/useStateGraph';

interface Props {
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  projectId: string;
  onRunProjection: (params: { scenarioId?: string; months?: number }) => void;
  isProjecting: boolean;
}

export function ProjectionPanel({
  scenarios, activeScenarioId, projectId, onRunProjection, isProjecting,
}: Props) {
  const [targetId, setTargetId] = useState<string>(activeScenarioId || '');
  const [months, setMonths] = useState<string>('12');

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
