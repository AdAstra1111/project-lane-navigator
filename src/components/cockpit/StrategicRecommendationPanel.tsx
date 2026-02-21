import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wand2, Star, CheckCircle2 } from 'lucide-react';
import type { ProjectScenario, ScenarioRecommendation } from '@/hooks/useStateGraph';

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
  recommendation: ScenarioRecommendation | null;
  onRecompute: () => void;
  isRecomputing: boolean;
  onSetActive: (scenarioId: string) => void;
  isSettingActive: boolean;
  onTogglePin: (scenarioId: string) => void;
  isTogglingPin: boolean;
}

export function StrategicRecommendationPanel({
  scenarios,
  activeScenarioId,
  recommendation,
  onRecompute,
  isRecomputing,
  onSetActive,
  isSettingActive,
  onTogglePin,
  isTogglingPin,
}: Props) {
  const recScenario = recommendation
    ? scenarios.find((s) => s.id === recommendation.recommended_scenario_id)
    : null;

  const isActive = recScenario?.id && recScenario.id === activeScenarioId;

  return (
    <Card className="border-white/10 bg-black/30">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4" />
            Strategic Recommendation
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            Deterministic scoring across ROI, risk, timeline, appetite.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRecompute} disabled={isRecomputing}>
            <Wand2 className="h-4 w-4 mr-2" />
            {isRecomputing ? 'Recomputing…' : 'Recompute'}
          </Button>

          {recScenario?.id && (
            <>
              <Button
                size="sm"
                onClick={() => onSetActive(recScenario.id)}
                disabled={isSettingActive || !!isActive}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {isActive ? 'Active' : 'Set Active'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onTogglePin(recScenario.id)}
                disabled={isTogglingPin}
              >
                {recScenario.pinned ? 'Unpin' : 'Pin'}
              </Button>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!recommendation && (
          <div className="text-sm text-muted-foreground">
            No recommendation computed yet. Click <b>Recompute</b>.
          </div>
        )}

        {recommendation && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">
                {recScenario?.name || 'Recommended Scenario'}
              </div>
              <Badge variant="secondary">
                Confidence {recommendation.confidence}%
              </Badge>
              {(recommendation.risk_flags || []).map((f) => (
                <Badge
                  key={f}
                  variant={f === 'HIGH_FRAGILITY' || f === 'HIGH_VOLATILITY' ? 'destructive' : 'outline'}
                >
                  {f}
                </Badge>
              ))}
            </div>

            {(recommendation.reasons || []).length > 0 && (
              <div className="rounded-lg border border-border/40 bg-muted/30 p-3">
                <div className="text-xs font-semibold mb-2">Reasons</div>
                <ul className="text-sm list-disc pl-5 space-y-1">
                  {recommendation.reasons.slice(0, 6).map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {recommendation.tradeoffs && (
              <div className="rounded-lg border border-border/40 bg-muted/30 p-3">
                <div className="text-xs font-semibold mb-2">Trade-offs</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {recommendation.tradeoffs.composite_delta != null && (
                    <div>Composite Δ: <span className="font-mono">{recommendation.tradeoffs.composite_delta > 0 ? '+' : ''}{recommendation.tradeoffs.composite_delta}</span></div>
                  )}
                  {recommendation.tradeoffs.budget_delta != null && (
                    <div>Budget Δ: <span className="font-mono">${Math.round(recommendation.tradeoffs.budget_delta).toLocaleString()}</span></div>
                  )}
                  {recommendation.tradeoffs.drift_total != null && (
                    <div>Drift alerts: <span className="font-mono">{recommendation.tradeoffs.drift_total}</span></div>
                  )}
                  {recommendation.tradeoffs.fragility_score != null && (
                    <div>Fragility: <span className="font-mono">{recommendation.tradeoffs.fragility_score}/100</span></div>
                  )}
                  {recommendation.tradeoffs.volatility_index != null && (
                    <div>Volatility: <span className="font-mono">{recommendation.tradeoffs.volatility_index}/100</span></div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
