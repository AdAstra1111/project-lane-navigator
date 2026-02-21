import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wand2, AlertTriangle, Check } from 'lucide-react';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface OptimizationCandidate {
  overrides: any;
  rank_score: number;
  projection_risk_score: number;
  projection_summary: string[];
  objective_score: number;
  breakdown: Record<string, number>;
}

interface Props {
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  onOptimize: (params: {
    scenarioId?: string;
    objective?: string;
    maxIterations?: number;
    horizonMonths?: number;
  }) => void;
  onApply: (scenarioId: string, overrides: any) => void;
  optimizeResult: { candidates: OptimizationCandidate[] } | null;
  isOptimizing: boolean;
  isApplying: boolean;
}

export function OptimizationPanel({
  scenarios, activeScenarioId, onOptimize, onApply,
  optimizeResult, isOptimizing, isApplying,
}: Props) {
  const [targetScenarioId, setTargetScenarioId] = useState<string>(activeScenarioId || '');
  const [objective, setObjective] = useState<string>('rank_score_with_projection');
  const [iterations, setIterations] = useState<string>('60');
  const [horizon, setHorizon] = useState<string>('12');

  const nonBaseline = scenarios.filter(s => s.scenario_type !== 'baseline' && !s.is_archived);
  const isActiveTarget = targetScenarioId === activeScenarioId;

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wand2 className="h-4 w-4" /> Auto-Optimizer
        </CardTitle>
        <Button
          size="sm"
          onClick={() => onOptimize({
            scenarioId: targetScenarioId || undefined,
            objective,
            maxIterations: parseInt(iterations),
            horizonMonths: parseInt(horizon) as 6 | 12,
          })}
          disabled={isOptimizing || !targetScenarioId}
        >
          {isOptimizing ? 'Optimizing…' : 'Run Optimizer'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Target Scenario</label>
            <Select value={targetScenarioId} onValueChange={setTargetScenarioId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {nonBaseline.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}{s.is_active ? ' (Active)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Objective</label>
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rank_score">Rank Score Only</SelectItem>
                <SelectItem value="rank_score_with_projection">Rank + Projection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Iterations</label>
            <Select value={iterations} onValueChange={setIterations}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="60">60</SelectItem>
                <SelectItem value="120">120</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Horizon</label>
            <Select value={horizon} onValueChange={setHorizon}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 months</SelectItem>
                <SelectItem value="12">12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isActiveTarget && (
          <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Applying will update the canonical state graph (active scenario).
          </div>
        )}

        {optimizeResult && optimizeResult.candidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Top Candidates</p>
            {optimizeResult.candidates.map((c, idx) => (
              <div key={idx} className="border border-border/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">#{idx + 1}</Badge>
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      Obj: {c.objective_score.toFixed(1)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      Rank: {c.rank_score.toFixed(1)}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] font-mono ${c.projection_risk_score > 50 ? 'border-destructive/40 text-destructive' : ''}`}>
                      Risk: {c.projection_risk_score.toFixed(1)}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => onApply(targetScenarioId, c.overrides)}
                    disabled={isApplying}
                  >
                    <Check className="h-3 w-3 mr-0.5" /> Apply
                  </Button>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono space-y-0.5">
                  {c.projection_summary.map((s, i) => <p key={i}>• {s}</p>)}
                </div>
                {c.overrides && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(c.overrides).map(([layer, fields]) =>
                      Object.entries(fields as Record<string, any>).map(([k, v]) => (
                        <span key={`${layer}-${k}`} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                          {k}: {typeof v === 'number' ? v.toFixed(1) : String(v)}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {optimizeResult && optimizeResult.candidates.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No improvement candidates found.</p>
        )}
      </CardContent>
    </Card>
  );
}
