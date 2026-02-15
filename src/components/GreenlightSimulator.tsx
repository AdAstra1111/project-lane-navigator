import { useState } from 'react';
import { Loader2, Zap, Users, Globe, TrendingUp, Target, DollarSign, MessageSquare, Lightbulb, Shield, Flame, Film, BarChart3, Gauge, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress } from '@/components/OperationProgress';

const GREENLIGHT_STAGES = [
  { at: 10, label: 'Routing engine selection…' },
  { at: 20, label: 'Loading specialist engine…' },
  { at: 40, label: 'Running specialist analysis…' },
  { at: 65, label: 'Running calibrator pass…' },
  { at: 85, label: 'Validating output schema…' },
  { at: 95, label: 'Finalizing greenlight probability verdict…' },
];

// IFFY_ANALYSIS_V1 schema
interface ScoreAxis {
  name: string;
  score: number;
  max: number;
  rationale: string;
}

interface AnalysisV1 {
  meta: {
    production_type: string;
    model_tier: string;
    scoring_schema_id: string;
    version: string;
  };
  strategic_snapshot: string;
  scores: {
    axes: ScoreAxis[];
    total: number;
    caps_applied: string[];
  };
  greenlight_probability: number;
  lane_or_platform_target: string;
  primary_obstacle: string;
  fastest_path_to_close: string;
  tactical_moves: string[];
  verdict: 'INVEST' | 'PASS' | 'ONLY_IF';
  confidence: number;
  assumptions: string[];
  _router?: {
    production_type: string;
    model_tier: string;
    routing_warnings: string[];
  };
  // Legacy compat
  greenlight_probability_pct?: number;
  greenlight_verdict?: string;
  evaluation_axes?: Record<string, { score: number; rationale: string }>;
  total_score?: number;
  correct_lane?: string;
  axes_config?: { key: string; label: string; max: number }[];
  financier_verdict?: string;
  verdict_reasoning?: string;
}

const AXIS_ICONS: Record<string, typeof Zap> = {
  'Conviction & Cultural Force': Flame,
  'Script Power': Film,
  'Commercial Positioning': Target,
  'Packaging Leverage': Users,
  'Finance Structure Viability': DollarSign,
  'Global Travelability': Globe,
  'Market Heat & Timing': TrendingUp,
  'Execution Risk': Shield,
  'Series Engine Strength': Gauge,
  'Pilot Impact': Zap,
  'Hook in First 30 Seconds': Zap,
  'Cliffhanger Density': BarChart3,
  'Access & Exclusivity': Shield,
  'Subject Urgency': Flame,
  'Brand Alignment': Target,
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
  const [result, setResult] = useState<AnalysisV1 | null>(null);
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

  // Normalize: support both V1 and legacy formats
  const probability = result?.greenlight_probability ?? result?.greenlight_probability_pct ?? 0;
  const total = result?.scores?.total ?? result?.total_score ?? 0;
  const laneTarget = result?.lane_or_platform_target ?? result?.correct_lane ?? '';
  const verdict = result?.verdict ?? (result?.greenlight_verdict === 'GREEN' ? 'INVEST' : result?.greenlight_verdict === 'RED' ? 'PASS' : 'ONLY_IF');

  const verdictConfig = {
    INVEST: { emoji: '🟢', label: 'INVEST', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', Icon: CheckCircle2 },
    ONLY_IF: { emoji: '🟡', label: 'ONLY IF…', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', Icon: AlertTriangle },
    PASS: { emoji: '🔴', label: 'PASS', color: 'bg-red-500/20 text-red-400 border-red-500/30', Icon: XCircle },
  };

  const axes: ScoreAxis[] = result?.scores?.axes || [];
  const capsApplied = result?.scores?.caps_applied || [];
  const vc = verdictConfig[verdict as keyof typeof verdictConfig] || verdictConfig.ONLY_IF;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Greenlight Probability Simulator</h4>
        </div>
        <Button size="sm" variant="outline" onClick={simulate} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
          Run Simulation
        </Button>
      </div>

      <OperationProgress isActive={loading} stages={GREENLIGHT_STAGES} />

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Runs a multi-pass greenlight probability simulation — Specialist → Calibrator — calibrated to your project's production type.
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
          <div className={`rounded-lg p-4 border ${vc.color}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{vc.emoji}</span>
                <span className="font-display font-bold text-lg">{vc.label}</span>
              </div>
              <div className="text-right">
                <p className="text-2xl font-display font-bold">{probability}%</p>
                <p className="text-xs text-muted-foreground">{total}/100 pts</p>
                {result.confidence != null && (
                  <p className="text-xs text-muted-foreground">Confidence: {result.confidence}%</p>
                )}
              </div>
            </div>
            {laneTarget && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px]">Lane</Badge>
                <span className="text-xs text-foreground">{laneTarget}</span>
              </div>
            )}
            {result._router?.production_type && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">Engine</Badge>
                <span className="text-xs text-muted-foreground">{result._router.production_type} ({result._router.model_tier})</span>
              </div>
            )}
          </div>

          {/* Caps Applied */}
          {capsApplied.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {capsApplied.map((cap, i) => (
                <Badge key={i} variant="destructive" className="text-[10px]">⚠ {cap}</Badge>
              ))}
            </div>
          )}

          {/* Evaluation Axes */}
          {axes.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Evaluation Axes (100 pts)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {axes.map((axis, i) => {
                  const Icon = AXIS_ICONS[axis.name] || BarChart3;
                  const pct = Math.round((axis.score / axis.max) * 100);
                  return (
                    <div key={i} className="glass-card rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{axis.name}</span>
                        </div>
                        <span className={`text-lg font-display font-bold ${scoreColor(axis.score, axis.max)}`}>
                          {axis.score}<span className="text-xs text-muted-foreground">/{axis.max}</span>
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

          {/* Assumptions */}
          {result.assumptions?.length > 0 && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Assumptions</p>
              </div>
              <div className="space-y-1.5">
                {result.assumptions.map((a, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {a}</p>
                ))}
              </div>
            </div>
          )}

          {/* Routing Warnings */}
          {result._router?.routing_warnings && result._router.routing_warnings.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {result._router.routing_warnings.map((w, i) => (
                <p key={i} className="italic">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Legacy: Financier Verdict */}
          {result.financier_verdict && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Financier / Commissioner Verdict</p>
              </div>
              <p className="text-sm text-foreground italic">"{result.financier_verdict}"</p>
            </div>
          )}

          {/* Meta version */}
          {result.meta?.version && (
            <p className="text-[10px] text-muted-foreground text-right">
              Schema: IFFY_ANALYSIS_V1 · Version: {result.meta.version} · Engine: {result.meta.scoring_schema_id}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
