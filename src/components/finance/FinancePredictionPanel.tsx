import { useState } from 'react';
import { Loader2, DollarSign, TrendingUp, AlertTriangle, Shield, BarChart3, Target, Globe, Users, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress } from '@/components/OperationProgress';

const STAGES = [
  { at: 10, label: 'Analysing finance profile…' },
  { at: 25, label: 'Scoring pre-sales viability…' },
  { at: 45, label: 'Simulating finance stack…' },
  { at: 65, label: 'Running risk assessment…' },
  { at: 80, label: 'Modelling recoupment waterfall…' },
  { at: 95, label: 'Generating finance verdict…' },
];

interface ScoreAxis { score: number; rationale: string; }

interface FinanceResult {
  finance_profile: {
    format: string;
    genre: string;
    budget_estimate: string;
    target_market: string;
    primary_territories: string[];
  };
  presales_analysis: {
    genre_marketability: ScoreAxis;
    cast_value_leverage: ScoreAxis;
    director_bankability: ScoreAxis;
    comparable_titles: ScoreAxis;
    presales_risk: boolean;
  };
  finance_stack: {
    presales_pct: number;
    tax_incentives_pct: number;
    equity_pct: number;
    gap_pct: number;
    streamer_pct: number;
    negative_pickup_pct: number;
    high_equity_exposure: boolean;
    stack_rationale: string;
  };
  risk_assessment: {
    budget_risk: ScoreAxis;
    cast_dependency: ScoreAxis;
    market_timing: ScoreAxis;
    recoupment_clarity: ScoreAxis;
    overall_risk: string;
  };
  recoupment_simulation: {
    waterfall: { position: number; tranche: string; estimated_pct: string }[];
    roi_band: string;
    roi_rationale: string;
  };
  finance_verdict: 'GREEN' | 'YELLOW' | 'RED';
  verdict_label: string;
  verdict_reasoning: string;
  improvement_strategies: {
    budget_adjustment: string;
    attachment_upgrade: string;
    market_repositioning: string;
  };
}

interface Props {
  projectTitle: string;
  format: string;
  genres: string[];
  lane: string;
  budget?: string;
  scoringGrid?: Record<string, number | null>;
  riskFlags?: string[];
  developmentTier?: string | null;
  greenlightVerdict?: string;
  packagingProfile?: any;
  coverageSummary?: string;
  castSummary?: string;
}

export function FinancePredictionPanel({
  projectTitle, format, genres, lane, budget,
  scoringGrid, riskFlags, developmentTier,
  greenlightVerdict, packagingProfile, coverageSummary, castSummary,
}: Props) {
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('finance-predict', {
        body: {
          projectTitle, format, genres, lane, budget,
          scoringGrid, riskFlags, developmentTier,
          greenlightVerdict, packagingProfile,
          coverageSummary: coverageSummary?.slice(0, 2000),
          castSummary,
        },
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      toast.error(e?.message || 'Finance prediction failed');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) =>
    s >= 7 ? 'text-emerald-400' : s >= 5 ? 'text-amber-400' : 'text-red-400';

  const riskColor = (level: string) => {
    const l = level?.toLowerCase();
    if (l === 'low') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (l === 'high') return 'bg-red-500/20 text-red-400 border-red-500/30';
    return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  };

  const verdictConfig: Record<string, { emoji: string; color: string }> = {
    GREEN: { emoji: '🟢', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    YELLOW: { emoji: '🟡', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    RED: { emoji: '🔴', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };

  const roiBandColor = (band: string) => {
    if (band.includes('Strong')) return 'text-emerald-400';
    if (band.includes('Moderate')) return 'text-emerald-400/80';
    if (band.includes('Break')) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Finance & Pre-Sales Prediction</h4>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <DollarSign className="h-3.5 w-3.5 mr-1.5" />}
          Run Prediction
        </Button>
      </div>

      <OperationProgress isActive={loading} stages={STAGES} />

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Simulates independent film/TV financing logic including pre-sales, equity risk, tax incentives, and recoupment positioning.
        </p>
      )}

      {result && (
        <div className="space-y-5">
          {/* Finance Profile */}
          <div className="glass-card rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Finance Profile</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {Object.entries(result.finance_profile).map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                  <p className="text-foreground font-medium">{Array.isArray(v) ? v.join(', ') : v || 'N/A'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Finance Verdict */}
          <div className={`rounded-lg p-4 border ${verdictConfig[result.finance_verdict]?.color || verdictConfig.YELLOW.color}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{verdictConfig[result.finance_verdict]?.emoji || '🟡'}</span>
              <span className="font-display font-bold text-lg">{result.verdict_label}</span>
            </div>
            <p className="text-sm opacity-90">{result.verdict_reasoning}</p>
          </div>

          {/* Pre-Sales Viability */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Pre-Sales Viability</p>
              {result.presales_analysis.presales_risk && (
                <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30 bg-red-500/10 ml-auto">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Pre-Sales Risk
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                { key: 'genre_marketability', label: 'Genre Marketability', icon: Target },
                { key: 'cast_value_leverage', label: 'Cast Value Leverage', icon: Users },
                { key: 'director_bankability', label: 'Director Bankability', icon: Crosshair },
                { key: 'comparable_titles', label: 'Comparable Titles', icon: BarChart3 },
              ] as const).map(({ key, label, icon: Icon }) => {
                const axis = result.presales_analysis[key];
                if (!axis || typeof axis === 'boolean') return null;
                return (
                  <div key={key} className="bg-muted/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{label}</span>
                      </div>
                      <span className={`text-lg font-display font-bold ${scoreColor(axis.score)}`}>
                        {axis.score}<span className="text-xs text-muted-foreground">/10</span>
                      </span>
                    </div>
                    <Progress value={axis.score * 10} className="h-1 mb-1.5" />
                    <p className="text-xs text-muted-foreground">{axis.rationale}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Finance Stack */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Finance Stack Simulation</p>
              {result.finance_stack.high_equity_exposure && (
                <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30 bg-red-500/10 ml-auto">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" /> High Equity Exposure
                </Badge>
              )}
            </div>
            <div className="space-y-2 mb-3">
              {([
                { label: 'Pre-Sales', value: result.finance_stack.presales_pct },
                { label: 'Tax Incentives', value: result.finance_stack.tax_incentives_pct },
                { label: 'Equity', value: result.finance_stack.equity_pct },
                { label: 'Gap Finance', value: result.finance_stack.gap_pct },
                { label: 'Streamer', value: result.finance_stack.streamer_pct },
                { label: 'Negative Pickup', value: result.finance_stack.negative_pickup_pct },
              ] as const).filter(s => s.value > 0).map(s => (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className="text-xs font-medium text-foreground">{s.value}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${s.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{result.finance_stack.stack_rationale}</p>
          </div>

          {/* Risk Assessment */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Risk Assessment</p>
              <Badge variant="outline" className={`text-[10px] ml-auto ${riskColor(result.risk_assessment.overall_risk)}`}>
                {result.risk_assessment.overall_risk} Risk
              </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                { key: 'budget_risk', label: 'Budget Risk' },
                { key: 'cast_dependency', label: 'Cast Dependency' },
                { key: 'market_timing', label: 'Market Timing' },
                { key: 'recoupment_clarity', label: 'Recoupment Clarity' },
              ] as const).map(({ key, label }) => {
                const axis = result.risk_assessment[key];
                if (!axis || typeof axis === 'string') return null;
                return (
                  <div key={key} className="bg-muted/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className={`text-lg font-display font-bold ${scoreColor(10 - axis.score)}`}>
                        {axis.score}<span className="text-xs text-muted-foreground">/10</span>
                      </span>
                    </div>
                    <Progress value={axis.score * 10} className="h-1 mb-1.5" />
                    <p className="text-xs text-muted-foreground">{axis.rationale}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recoupment Simulation */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Recoupment Simulation</p>
              </div>
              <span className={`text-sm font-display font-bold ${roiBandColor(result.recoupment_simulation.roi_band)}`}>
                {result.recoupment_simulation.roi_band}
              </span>
            </div>
            <div className="space-y-1.5 mb-3">
              {result.recoupment_simulation.waterfall?.map((t, i) => (
                <div key={i} className="flex items-center gap-3 bg-muted/20 rounded-lg px-3 py-2">
                  <span className="text-xs font-mono text-muted-foreground w-5">{t.position}.</span>
                  <span className="text-sm text-foreground flex-1">{t.tranche}</span>
                  <span className="text-xs font-medium text-muted-foreground">{t.estimated_pct}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{result.recoupment_simulation.roi_rationale}</p>
          </div>

          {/* Improvement Strategies */}
          <div className="glass-card rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Finance Improvement Strategies</p>
            <div className="space-y-3">
              {[
                { label: 'Budget Adjustment', text: result.improvement_strategies.budget_adjustment },
                { label: 'Attachment Upgrade', text: result.improvement_strategies.attachment_upgrade },
                { label: 'Market Repositioning', text: result.improvement_strategies.market_repositioning },
              ].map(s => (
                <div key={s.label}>
                  <Badge variant="secondary" className="mb-1 text-[10px]">{s.label}</Badge>
                  <p className="text-sm text-foreground">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
