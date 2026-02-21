import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, TrendingDown, GitMerge } from 'lucide-react';
import { GovernanceBadge } from './GovernanceBadge';
import type { ProjectScenario } from '@/hooks/useStateGraph';

interface Props {
  projectId: string;
  scenarios: ProjectScenario[];
  activeScenarioId: string | null;
}

function getGovernanceScore(scenario: ProjectScenario): number | null {
  const gov = scenario.governance;
  if (!gov || typeof gov !== 'object') return null;
  return typeof gov.governance_confidence_score === 'number' ? gov.governance_confidence_score : null;
}

function getTopRiskyPaths(scenario: ProjectScenario): Array<{ path: string; weight: number }> {
  const gov = scenario.governance;
  if (!gov || typeof gov !== 'object') return [];
  const rm = gov.risk_memory;
  if (!rm || typeof rm !== 'object') return [];
  const pw = rm.path_weights;
  if (!pw || typeof pw !== 'object') return [];
  return Object.entries(pw as Record<string, number>)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([path, weight]) => ({ path, weight }));
}

function getMergeOutcomes(scenario: ProjectScenario): Array<any> {
  const gov = scenario.governance;
  if (!gov || typeof gov !== 'object') return [];
  const rm = gov.risk_memory;
  if (!rm || typeof rm !== 'object') return [];
  return Array.isArray(rm.merge_outcomes) ? rm.merge_outcomes.slice(-10).reverse() : [];
}

export function GovernanceInsightsPanel({ projectId, scenarios, activeScenarioId }: Props) {
  const activeScenario = scenarios.find(s => s.id === activeScenarioId);
  
  if (!activeScenario) {
    return (
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Governance Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">No active scenario selected.</div>
        </CardContent>
      </Card>
    );
  }

  const score = getGovernanceScore(activeScenario);
  const riskyPaths = getTopRiskyPaths(activeScenario);
  const outcomes = getMergeOutcomes(activeScenario);
  const mergePolicy = activeScenario.governance?.merge_policy;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Governance Insights
          <GovernanceBadge
            score={score}
            protectedPathsCount={activeScenario.protected_paths?.length ?? 0}
            requireApproval={mergePolicy?.require_approval}
            riskThreshold={mergePolicy?.risk_threshold}
            topRiskyPaths={riskyPaths.slice(0, 3)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top risky paths */}
        {riskyPaths.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Top Risky Paths (by weight)
            </div>
            <div className="rounded border border-border/30 overflow-auto max-h-48">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-muted/20 border-b border-border/20">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Path</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground w-16">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {riskyPaths.map(p => (
                    <tr key={p.path} className="border-b border-border/10">
                      <td className="px-2 py-1 font-mono">{p.path}</td>
                      <td className="px-2 py-1 text-right">
                        <Badge
                          variant={p.weight >= 15 ? 'destructive' : p.weight >= 8 ? 'secondary' : 'outline'}
                          className="text-[9px]"
                        >
                          {p.weight}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No risk memory recorded yet. Merge scenarios to build history.</div>
        )}

        {/* Recent merge outcomes */}
        {outcomes.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
              <GitMerge className="h-3 w-3" />
              Recent Merge Outcomes
            </div>
            <div className="space-y-1 max-h-48 overflow-auto">
              {outcomes.map((o: any, i: number) => (
                <div key={i} className="rounded border border-border/20 bg-muted/10 px-2.5 py-1.5 text-[10px] flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">
                    {o.at ? new Date(o.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  {o.risk_score != null && (
                    <Badge variant={o.risk_score >= 70 ? 'destructive' : o.risk_score >= 45 ? 'secondary' : 'outline'} className="text-[9px]">
                      risk:{o.risk_score}
                    </Badge>
                  )}
                  {o.forced && <Badge variant="destructive" className="text-[9px]">forced</Badge>}
                  {o.required_approval && <Badge variant="secondary" className="text-[9px]">approval</Badge>}
                  <span className="text-muted-foreground">{o.paths?.length ?? 0} paths</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
