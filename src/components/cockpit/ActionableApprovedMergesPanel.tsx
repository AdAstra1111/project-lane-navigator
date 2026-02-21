import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface ActionableItem {
  sourceScenarioId: string | null;
  targetScenarioId: string;
  approved_at: string;
  domain: string;
  strategy: string;
  request_event_id: string;
  paths_count: number;
}

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
}

function scenarioName(id: string | null, scenarios: ProjectScenario[]): string {
  if (!id) return '—';
  const s = scenarios.find(sc => sc.id === id);
  return s?.name ?? id.slice(0, 8);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function ActionableApprovedMergesPanel({ projectId, scenarios }: Props) {
  const queryClient = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['actionable-approved-merges', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'list_actionable_approved_merges', projectId },
      });
      if (error) return [];
      return (data?.actionable ?? []) as ActionableItem[];
    },
    enabled: !!projectId,
  });

  if (items.length === 0) return null;

  const handleApply = async (item: ActionableItem) => {
    setApplyingId(item.request_event_id);
    try {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: {
          action: 'apply_approved_merge',
          projectId,
          sourceScenarioId: item.sourceScenarioId,
          targetScenarioId: item.targetScenarioId,
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
      } else {
        queryClient.invalidateQueries({ queryKey: ['actionable-approved-merges', projectId] });
        queryClient.invalidateQueries({ queryKey: ['merge-approvals', projectId] });
        queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] });
        queryClient.invalidateQueries({ queryKey: ['state-graph', projectId] });
        queryClient.invalidateQueries({ queryKey: ['decision-events', projectId] });
        toast.success('Approved merge applied');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Apply failed');
    }
    setApplyingId(null);
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          Approved Merges Ready to Apply
          <Badge variant="default" className="text-[10px] ml-1">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map(item => (
          <div key={item.request_event_id} className="rounded-md border border-border/30 bg-muted/10 px-3 py-2 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[9px] capitalize">{item.domain}</Badge>
            <Badge variant="outline" className="text-[9px]">{item.strategy}</Badge>
            <span className="text-xs font-medium truncate">
              → {scenarioName(item.targetScenarioId, scenarios)}
            </span>
            {item.sourceScenarioId && (
              <span className="text-[10px] text-muted-foreground truncate">
                from {scenarioName(item.sourceScenarioId, scenarios)}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{item.paths_count} paths · {timeAgo(item.approved_at)}</span>
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[10px] ml-auto"
              disabled={applyingId === item.request_event_id}
              onClick={() => handleApply(item)}
            >
              {applyingId === item.request_event_id ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
