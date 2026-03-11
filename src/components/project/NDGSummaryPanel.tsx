/**
 * NDGSummaryPanel — Compact read-only NDG graph summary card.
 * Uses summaryOnly: true for lightweight fetch.
 * Fail-closed: renders nothing if data unavailable.
 */

import { useNDGProjectGraphSummary } from '@/hooks/useNDGProjectGraphSummary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Network, AlertTriangle, ShieldCheck } from 'lucide-react';

interface Props {
  projectId: string | undefined;
}

export function NDGSummaryPanel({ projectId }: Props) {
  const { data, isLoading } = useNDGProjectGraphSummary(projectId);

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const byType = (data.node_counts_by_type || {}) as Record<string, number>;
  const scenes = byType['scene'] ?? 0;
  const axes = byType['spine_axis'] ?? 0;
  const entities = byType['narrative_entity'] ?? 0;
  const units = byType['narrative_unit'] ?? 0;
  const atRiskCount = data.at_risk_scene_count ?? 0;
  const atRiskAxes = data.at_risk_axes ?? [];

  const metrics: { label: string; value: number }[] = [
    { label: 'Nodes', value: data.node_count },
    { label: 'Edges', value: data.edge_count },
    { label: 'Scenes', value: scenes },
    { label: 'Axes', value: axes },
    { label: 'Entities', value: entities },
    { label: 'Units', value: units },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Network className="h-4 w-4 text-muted-foreground" />
            Narrative Graph Overview
          </CardTitle>
          {atRiskCount > 0 ? (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />
              {atRiskCount} at-risk scene{atRiskCount !== 1 ? 's' : ''}
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-xs">
              <ShieldCheck className="h-3 w-3" />
              No active risk
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Metric tiles */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="flex flex-col items-center rounded-md border border-border/40 bg-muted/30 px-2 py-2"
            >
              <span className="text-lg font-bold text-foreground">{m.value}</span>
              <span className="text-[11px] text-muted-foreground">{m.label}</span>
            </div>
          ))}
        </div>

        {/* At-risk axes chips */}
        {atRiskAxes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-destructive">At-risk axes:</span>
            {atRiskAxes.map((axis) => (
              <Badge key={axis} variant="outline" className="text-[11px] border-destructive/40 text-destructive">
                {axis}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
