import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface DriftAlert {
  id: string;
  alert_type: string;
  severity: string;
  layer: string;
  metric_key: string;
  current_value: number | null;
  threshold: number | null;
  message: string;
  acknowledged: boolean;
  scenario_id: string | null;
  created_at: string;
}

const severityColors: Record<string, string> = {
  info: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
}

export function DriftAlertsPanel({ projectId, scenarios, activeScenarioId }: Props) {
  const queryClient = useQueryClient();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(activeScenarioId || '');

  const scenarioOptions = scenarios.filter(s => !s.is_archived);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['drift-alerts-panel', projectId, selectedScenarioId],
    queryFn: async () => {
      if (!projectId || !selectedScenarioId) return [];
      const { data, error } = await supabase
        .from('drift_alerts')
        .select('*')
        .eq('project_id', projectId)
        .eq('scenario_id', selectedScenarioId)
        .eq('acknowledged', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as DriftAlert[];
    },
    enabled: !!projectId && !!selectedScenarioId,
  });

  const clearAlerts = useMutation({
    mutationFn: async () => {
      if (!projectId || !selectedScenarioId) return;
      const { error } = await supabase
        .from('drift_alerts')
        .delete()
        .eq('project_id', projectId)
        .eq('scenario_id', selectedScenarioId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drift-alerts-panel', projectId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['drift-alerts', projectId] });
      toast.success('Alerts cleared');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
          <AlertTriangle className="h-4 w-4" /> Drift Alerts
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
            <SelectTrigger className="h-7 w-48 text-xs">
              <SelectValue placeholder="Select scenario…" />
            </SelectTrigger>
            <SelectContent>
              {scenarioOptions.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}{s.is_active ? ' (Active)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {alerts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => clearAlerts.mutate()}
              disabled={clearAlerts.isPending}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {clearAlerts.isPending ? 'Clearing…' : 'Clear All'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!selectedScenarioId && (
          <p className="text-xs text-muted-foreground text-center py-4">Select a scenario to view alerts.</p>
        )}
        {selectedScenarioId && isLoading && (
          <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
        )}
        {selectedScenarioId && !isLoading && alerts.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No active drift alerts for this scenario.</p>
        )}
        {alerts.map(a => (
          <div key={a.id} className="flex items-start gap-2 text-xs">
            <Badge variant="outline" className={`shrink-0 text-[10px] ${severityColors[a.severity] || ''}`}>
              {a.severity}
            </Badge>
            <div className="min-w-0">
              <p className="font-medium">{a.message}</p>
              <p className="text-muted-foreground">{a.layer} · {a.metric_key} = {a.current_value}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
