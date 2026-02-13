import { useState } from 'react';
import { Loader2, Zap, Users, Globe, TrendingUp, Target, DollarSign, MessageSquare, Lightbulb, Shield, Flame, Film, BarChart3, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress } from '@/components/OperationProgress';

const GREENLIGHT_STAGES = [
  { at: 10, label: 'Loading production type engine…' },
  { at: 25, label: 'Running greenlight simulation…' },
  { at: 50, label: 'Scoring evaluation axes…' },
  { at: 70, label: 'Computing greenlight probability…' },
  { at: 85, label: 'Generating tactical moves…' },
  { at: 95, label: 'Building financier verdict…' },
];

interface AxisConfig {
  key: string;
  label: string;
  max: number;
}

interface EvalAxis {
  score: number;
  rationale: string;
}

interface GreenlightResult {
  strategic_snapshot: string;
  evaluation_axes: Record<string, EvalAxis>;
  total_score: number;
  greenlight_probability_pct: number;
  greenlight_verdict: 'GREEN' | 'YELLOW' | 'RED';
  correct_lane: string;
  primary_obstacle: string;
  fastest_path_to_close: string;
  tactical_moves: string[];
  financier_verdict: string;
  verdict_reasoning: string;
  mandatory_outputs?: Record<string, string>;
  axes_config?: AxisConfig[];
  // Legacy support
  exec_summary?: Record<string, string>;
  exec_notes?: string[];
  strategic_adjustments?: { creative: string; packaging: string; budget: string };
}

// Icon mapping for common axis keys
const AXIS_ICONS: Record<string, typeof Zap> = {
  conviction_cultural_force: Flame,
  script_power: Film,
  commercial_positioning: Target,
  packaging_leverage: Users,
  finance_structure_viability: DollarSign,
  global_travelability: Globe,
  market_heat_timing: TrendingUp,
  execution_risk: Shield,
  series_engine_strength: Gauge,
  pilot_impact: Zap,
  hook_first_30_seconds: Zap,
  cliffhanger_density: BarChart3,
  access_exclusivity: Shield,
  subject_urgency: Flame,
  brand_alignment: Target,
};

interface Props {
  projectTitle: string;
  format: string;
  genres: string[];
  lane: string;
  budget?: string;
  scoringGrid?: Record<string, number | null>;
  riskFlags?: string[];
  developmentTier?: string | null;
  financeReadiness?: string | null;
  coverageSummary?: string;
}

export function GreenlightSimulator({
  projectTitle, format, genres, lane, budget,
  scoringGrid, riskFlags, developmentTier, financeReadiness, coverageSummary,
}: Props) {
  const [result, setResult] = useState<GreenlightResult | null>(null);
  const [loading, setLoading] = useState(false);

  const simulate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('greenlight-simulate', {
        body: {
          projectTitle, format, genres, lane, budget,
          scoringGrid, riskFlags, developmentTier, financeReadiness,
          coverageSummary: coverageSummary?.slice(0, 3000),
        },
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      toast.error(e?.message || 'Greenlight simulation failed');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100;
    return pct >= 70 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
  };

  const verdictConfig = {
    GREEN: { emoji: '🟢', label: 'GREENLIGHT LIKELY', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    YELLOW: { emoji: '🟡', label: 'CONDITIONAL', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    RED: { emoji: '🔴', label: 'PASS', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };

  // Get axes config from result or fallback
  const axesConfig: AxisConfig[] = result?.axes_config || [];

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Greenlight Simulator</h4>
        </div>
        <Button size="sm" variant="outline" onClick={simulate} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
          Run Simulation
        </Button>
      </div>

      <OperationProgress isActive={loading} stages={GREENLIGHT_STAGES} />

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Runs a full greenlight simulation calibrated to your project's production type — evaluating capital efficiency, packaging leverage, and market viability.
        </p>
      )}

      {result && (
        <div className="space-y-5">
          {/* Strategic Snapshot */}
          {result.strategic_snapshot && (
            <div className="glass-card rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Strategic Snapshot</p>
              <p className="text-sm text-foreground leading-relaxed">{result.strategic_snapshot}</p>
            </div>
          )}

          {/* Verdict + Score */}
          <div className={`rounded-lg p-4 border ${verdictConfig[result.greenlight_verdict]?.color || verdictConfig.YELLOW.color}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{verdictConfig[result.greenlight_verdict]?.emoji || '🟡'}</span>
                <span className="font-display font-bold text-lg">
                  {verdictConfig[result.greenlight_verdict]?.label || 'CONDITIONAL'}
                </span>
              </div>
              <div className="text-right">
                {result.greenlight_probability_pct != null && (
                  <p className="text-2xl font-display font-bold">{result.greenlight_probability_pct}%</p>
                )}
                {result.total_score != null && (
                  <p className="text-xs text-muted-foreground">{result.total_score}/100 pts</p>
                )}
              </div>
            </div>
            <p className="text-sm opacity-90">{result.verdict_reasoning}</p>
            {result.correct_lane && (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">Lane</Badge>
                <span className="text-xs text-foreground">{result.correct_lane}</span>
              </div>
            )}
          </div>

          {/* Evaluation Axes — dynamic from axes_config */}
          {axesConfig.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Evaluation Axes (100 pts)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {axesConfig.map((axCfg) => {
                  const axis = result.evaluation_axes?.[axCfg.key];
                  if (!axis) return null;
                  const Icon = AXIS_ICONS[axCfg.key] || BarChart3;
                  const pct = Math.round((axis.score / axCfg.max) * 100);
                  return (
                    <div key={axCfg.key} className="glass-card rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{axCfg.label}</span>
                        </div>
                        <span className={`text-lg font-display font-bold ${scoreColor(axis.score, axCfg.max)}`}>
                          {axis.score}<span className="text-xs text-muted-foreground">/{axCfg.max}</span>
                        </span>
                      </div>
                      <Progress value={pct} className="h-1 mb-1.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed">{axis.rationale}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Primary Obstacle + Fastest Path */}
          {(result.primary_obstacle || result.fastest_path_to_close) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {result.primary_obstacle && (
                <div className="glass-card rounded-lg p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Primary Obstacle</p>
                  <p className="text-sm text-foreground">{result.primary_obstacle}</p>
                </div>
              )}
              {result.fastest_path_to_close && (
                <div className="glass-card rounded-lg p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Fastest Path to Close</p>
                  <p className="text-sm text-foreground">{result.fastest_path_to_close}</p>
                </div>
              )}
            </div>
          )}

          {/* Tactical Moves */}
          {result.tactical_moves?.length > 0 && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Tactical Moves</p>
              </div>
              <div className="space-y-2">
                {result.tactical_moves.map((move, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-primary font-bold shrink-0">{i + 1}.</span>
                    <p className="text-foreground">{move}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Financier Verdict */}
          {result.financier_verdict && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Financier / Commissioner Verdict</p>
              </div>
              <p className="text-sm text-foreground italic">"{result.financier_verdict}"</p>
            </div>
          )}

          {/* Mandatory Outputs (type-specific) */}
          {result.mandatory_outputs && Object.keys(result.mandatory_outputs).length > 0 && (
            <div className="glass-card rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Type-Specific Intelligence</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {Object.entries(result.mandatory_outputs).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                    <p className="text-foreground font-medium">{v || 'N/A'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legacy: Exec Notes (if old result shape) */}
          {result.exec_notes?.length && result.exec_notes.length > 0 && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Exec Room Comments</p>
              </div>
              <div className="space-y-2">
                {result.exec_notes.map((note, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0">💬</span>
                    <p className="text-foreground italic">"{note}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
