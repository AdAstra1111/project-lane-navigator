import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Briefcase, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectScenario, ScenarioRecommendation, ScenarioStressTest } from '@/hooks/useStateGraph';

interface Props {
  activeScenario: ProjectScenario | undefined;
  baseline: ProjectScenario | undefined;
  recommendation: ScenarioRecommendation | null;
  latestStressTest: ScenarioStressTest | null;
}

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null) return 'N/A';
  return `${n}${suffix}`;
}

function pct(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  return `${(n * 100).toFixed(1)}%`;
}

function buildBrief(
  activeScenario: ProjectScenario | undefined,
  baseline: ProjectScenario | undefined,
  recommendation: ScenarioRecommendation | null,
  stress: ScenarioStressTest | null,
): string[] {
  const recName = activeScenario?.name ?? 'No active scenario';
  const baselineName = baseline?.name ?? 'No baseline';

  // 1. Strategy
  const strategy = `Strategy: Active scenario "${recName}" vs baseline "${baselineName}".`;

  // 2. ROI delta
  let roiLine = 'ROI Delta: No recommendation data available.';
  if (recommendation?.tradeoffs) {
    const cd = recommendation.tradeoffs.composite_delta;
    if (cd != null) {
      roiLine = `ROI Delta: Composite score ${cd > 0 ? '+' : ''}${cd} vs baseline.`;
    }
  }

  // 3. Schedule delta
  let scheduleLine = 'Schedule Delta: No projection data available.';
  if (recommendation?.reasons) {
    const schedReason = recommendation.reasons.find(r => /schedule/i.test(r));
    if (schedReason) scheduleLine = `Schedule: ${schedReason}`;
  }

  // 4. Key risks
  const flags = recommendation?.risk_flags ?? [];
  const riskLine = flags.length > 0
    ? `Key Risks: ${flags.join(', ')}.`
    : 'Key Risks: No critical risk flags.';

  // 5. Robustness
  let robustnessLine = 'Robustness: No stress test data available.';
  if (stress) {
    robustnessLine = `Robustness: Fragility ${fmt(stress.fragility_score, '/100')}, Volatility ${fmt(stress.volatility_index, '/100')}.`;
    const bp = stress.breakpoints;
    if (bp && typeof bp === 'object') {
      const keys = Object.keys(bp);
      if (keys.length > 0) {
        robustnessLine += ` Breakpoints detected in ${keys.length} dimension(s).`;
      }
    }
  }

  // 6. Next action
  let nextAction = 'Next Action: Run recommendation + stress test to generate actionable data.';
  if (recommendation && stress) {
    if (flags.includes('HIGH_FRAGILITY') || flags.includes('HIGH_VOLATILITY')) {
      nextAction = 'Next Action: Mitigate fragility — consider tighter assumptions or alternative scenario.';
    } else if ((recommendation.confidence ?? 0) >= 70) {
      nextAction = 'Next Action: Scenario is investment-ready. Proceed to packaging.';
    } else {
      nextAction = 'Next Action: Improve confidence — run additional projections or refine overrides.';
    }
  }

  return [strategy, roiLine, scheduleLine, riskLine, robustnessLine, nextAction];
}

export function InvestorModePanel({ activeScenario, baseline, recommendation, latestStressTest }: Props) {
  const brief = buildBrief(activeScenario, baseline, recommendation, latestStressTest);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(brief.join('\n')).then(
      () => toast.success('Investor brief copied to clipboard'),
      () => toast.error('Failed to copy'),
    );
  };

  const confidence = recommendation?.confidence ?? null;

  return (
    <Card className="border-white/10 bg-black/30">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Investor Mode
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            Executive brief from current scenario + stress data.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {confidence != null && (
            <Badge variant={confidence >= 70 ? 'default' : 'secondary'}>
              Confidence {confidence}%
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            <Copy className="h-4 w-4 mr-2" />
            Copy Brief
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {brief.map((line, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-muted-foreground select-none">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
