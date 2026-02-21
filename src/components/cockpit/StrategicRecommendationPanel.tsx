import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Award, AlertTriangle, Pin, Play, RefreshCw } from 'lucide-react';
import type { ProjectScenario } from '@/hooks/useStateGraph';
import type { ScenarioRecommendation } from '@/hooks/useScenarioRecommendation';

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  recommendation: ScenarioRecommendation | null;
  isLoading: boolean;
  isComputing: boolean;
  onRecompute: () => void;
  onSetActive: (scenarioId: string) => void;
  onTogglePin: (scenarioId: string) => void;
  isSettingActive: boolean;
}

const confidenceColor = (c: number) => {
  if (c >= 70) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  if (c >= 40) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
};

const riskFlagLabels: Record<string, { label: string; color: string }> = {
  HIGH_DRIFT: { label: 'High Drift', color: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
  MISSING_PROJECTION: { label: 'No Projection', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  HIGH_APPETITE_DECAY: { label: 'High Appetite Decay', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
};

export function StrategicRecommendationPanel({
  scenarios, activeScenarioId, recommendation,
  isLoading, isComputing, onRecompute, onSetActive, onTogglePin, isSettingActive,
}: Props) {
  const recScenario = recommendation
    ? scenarios.find(s => s.id === recommendation.recommended_scenario_id)
    : null;

  const reasons = (recommendation?.reasons ?? []) as string[];
  const tradeoffs = (recommendation?.tradeoffs ?? {}) as Record<string, number>;
  const riskFlags = (recommendation?.risk_flags ?? []) as string[];
  const isActive = recScenario?.id === activeScenarioId;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" /> Strategic Recommendation
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onRecompute}
          disabled={isComputing}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isComputing ? 'animate-spin' : ''}`} />
          {isComputing ? 'Computing…' : 'Recompute'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && !recommendation && (
          <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
        )}

        {!isLoading && !recommendation && (
          <div className="text-center py-4 space-y-2">
            <p className="text-xs text-muted-foreground">No recommendation computed yet.</p>
            <Button size="sm" onClick={onRecompute} disabled={isComputing}>
              {isComputing ? 'Computing…' : 'Compute Now'}
            </Button>
          </div>
        )}

        {recommendation && (
          <>
            {/* Winner + confidence */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Award className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {recScenario?.name ?? 'Unknown Scenario'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Recommended • computed {new Date(recommendation.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className={`text-xs font-mono shrink-0 ${confidenceColor(recommendation.confidence)}`}>
                {recommendation.confidence}% confidence
              </Badge>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {recScenario && !isActive && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => onSetActive(recScenario.id)}
                  disabled={isSettingActive}
                >
                  <Play className="h-3 w-3 mr-1" /> Set Active
                </Button>
              )}
              {recScenario && isActive && (
                <Badge variant="secondary" className="text-xs">Already Active</Badge>
              )}
              {recScenario && !recScenario.pinned && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onTogglePin(recScenario.id)}
                >
                  <Pin className="h-3 w-3 mr-1" /> Pin
                </Button>
              )}
            </div>

            {/* Reasons */}
            {reasons.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Rationale</p>
                <ul className="space-y-0.5">
                  {reasons.map((r, i) => (
                    <li key={i} className="text-xs flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tradeoffs */}
            {Object.keys(tradeoffs).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(tradeoffs).map(([key, val]) => {
                  const label = key.replace(/_/g, ' ').replace('delta', 'Δ');
                  const isPositive = val > 0;
                  const formatted = key.includes('budget')
                    ? `${isPositive ? '+' : ''}$${Math.round(val / 1000)}k`
                    : `${isPositive ? '+' : ''}${val}`;
                  return (
                    <span
                      key={key}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                        isPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : val < 0 ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : 'bg-muted text-muted-foreground border-border'
                      }`}
                    >
                      {label}: {formatted}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Risk flags */}
            {riskFlags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {riskFlags.map((flag) => {
                  const info = riskFlagLabels[flag] ?? { label: flag, color: 'bg-muted text-muted-foreground border-border' };
                  return (
                    <Badge key={flag} variant="outline" className={`text-[10px] ${info.color}`}>
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                      {info.label}
                    </Badge>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
