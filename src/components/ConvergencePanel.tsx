import { useState } from 'react';
import { Loader2, Zap, Brain, Target, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CheckCircle2, TrendingUp, RotateCcw, Shield, Lightbulb, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress } from '@/components/OperationProgress';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

const CONVERGENCE_STAGES = [
  { at: 10, label: 'Initializing convergence engine…' },
  { at: 25, label: 'Running creative integrity analysis…' },
  { at: 50, label: 'Running greenlight simulation…' },
  { at: 70, label: 'Calculating convergence metrics…' },
  { at: 85, label: 'Evaluating format advisory…' },
  { at: 95, label: 'Finalizing executive guidance…' },
];

interface ConvergenceResult {
  executive_snapshot: string;
  creative_integrity_score: number;
  greenlight_probability: number;
  gap: number;
  allowed_gap: number;
  convergence_status: string;
  trajectory: string | null;
  primary_creative_risk: string;
  primary_commercial_risk: string;
  leverage_moves: string[];
  format_advisory: {
    triggered: boolean;
    alternative_formats?: string[];
    predicted_ci_impact?: string;
    predicted_gp_impact?: string;
    repositioning_risk?: string;
    advisory_verdict?: string;
    rationale?: string;
  } | null;
  executive_guidance: string;
  creative_detail?: any;
  greenlight_detail?: any;
}

interface Props {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  lane: string;
  budget?: string;
  scoringGrid?: Record<string, number | null>;
  riskFlags?: string[];
  coverageSummary?: string;
}

export function ConvergencePanel({
  projectId, projectTitle, format, genres, lane, budget,
  scoringGrid, riskFlags, coverageSummary,
}: Props) {
  const { user } = useAuth();
  const [result, setResult] = useState<ConvergenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [strategicPriority, setStrategicPriority] = useState('BALANCED');
  const [developmentStage, setDevelopmentStage] = useState('IDEA');
  const [analysisMode, setAnalysisMode] = useState('DUAL');

  // Fetch previous scores for trajectory
  const { data: history } = useQuery({
    queryKey: ['convergence-history', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('convergence_scores')
        .select('creative_integrity_score, greenlight_probability, gap, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!projectId && !!user,
  });

  const lastScore = history?.[0];

  const simulate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('convergence-engine', {
        body: {
          projectId, projectTitle, format, genres, lane, budget,
          scoringGrid, riskFlags,
          coverageSummary: coverageSummary?.slice(0, 3000),
          strategicPriority, developmentStage, analysisMode,
          previousCreativeScore: lastScore?.creative_integrity_score,
          previousGreenlightScore: lastScore?.greenlight_probability,
          previousGap: lastScore?.gap,
        },
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      toast.error(e?.message || 'Convergence analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const statusConfig: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
    'Healthy Divergence': { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
    'Strategic Tension': { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: AlertTriangle },
    'Dangerous Misalignment': { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: AlertTriangle },
  };

  const trajectoryConfig: Record<string, { color: string; icon: typeof TrendingUp }> = {
    Converging: { color: 'text-emerald-400', icon: ArrowDownRight },
    Diverging: { color: 'text-red-400', icon: ArrowUpRight },
    Stalled: { color: 'text-muted-foreground', icon: Minus },
    Eroding: { color: 'text-red-400', icon: ArrowDownRight },
    Improving: { color: 'text-emerald-400', icon: TrendingUp },
  };

  const guidanceConfig: Record<string, string> = {
    Accelerate: 'bg-emerald-500/20 text-emerald-400',
    Refine: 'bg-blue-500/20 text-blue-400',
    'Protect & Rebuild': 'bg-amber-500/20 text-amber-400',
    'Reposition (Advisory Only)': 'bg-purple-500/20 text-purple-400',
    Hold: 'bg-muted text-muted-foreground',
  };

  const sc = result ? (statusConfig[result.convergence_status] || statusConfig['Strategic Tension']) : null;
  const tc = result?.trajectory ? (trajectoryConfig[result.trajectory] || trajectoryConfig['Stalled']) : null;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Creative–Commercial Convergence</h4>
        </div>
        <Button size="sm" variant="outline" onClick={simulate} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Compass className="h-3.5 w-3.5 mr-1.5" />}
          Run Analysis
        </Button>
      </div>

      {/* Config selectors */}
      <div className="grid grid-cols-3 gap-2">
        <Select value={strategicPriority} onValueChange={setStrategicPriority}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="PRESTIGE">Prestige</SelectItem>
            <SelectItem value="BALANCED">Balanced</SelectItem>
            <SelectItem value="COMMERCIAL_EXPANSION">Commercial</SelectItem>
            <SelectItem value="CASHFLOW_STABILISATION">Cashflow</SelectItem>
          </SelectContent>
        </Select>
        <Select value={developmentStage} onValueChange={setDevelopmentStage}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="IDEA">Idea</SelectItem>
            <SelectItem value="EARLY_DRAFT">Early Draft</SelectItem>
            <SelectItem value="REDRAFT">Redraft</SelectItem>
            <SelectItem value="PRE_PACKAGING">Pre-Packaging</SelectItem>
            <SelectItem value="FINANCE">Finance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={analysisMode} onValueChange={setAnalysisMode}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="DUAL">Dual Analysis</SelectItem>
            <SelectItem value="CREATIVE_INTEGRITY">Creative Focus</SelectItem>
            <SelectItem value="GREENLIGHT_ARCHITECT">Greenlight Focus</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <OperationProgress isActive={loading} stages={CONVERGENCE_STAGES} />

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Dual-engine analysis tracking the convergence between creative integrity and greenlight probability.
        </p>
      )}

      {result && (
        <div className="space-y-4">
          {/* Executive Snapshot */}
          {result.executive_snapshot && (
            <div className="glass-card rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Executive Snapshot</p>
              <p className="text-sm text-foreground leading-relaxed">{result.executive_snapshot}</p>
            </div>
          )}

          {/* Dual Score Display */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-lg p-4 text-center">
              <Brain className="h-5 w-5 text-purple-400 mx-auto mb-2" />
              <p className="text-3xl font-display font-bold text-purple-400">{result.creative_integrity_score}</p>
              <p className="text-xs text-muted-foreground mt-1">Creative Integrity</p>
              <Progress value={result.creative_integrity_score} className="h-1.5 mt-2" />
            </div>
            <div className="glass-card rounded-lg p-4 text-center">
              <Target className="h-5 w-5 text-emerald-400 mx-auto mb-2" />
              <p className="text-3xl font-display font-bold text-emerald-400">{result.greenlight_probability}</p>
              <p className="text-xs text-muted-foreground mt-1">Greenlight Probability</p>
              <Progress value={result.greenlight_probability} className="h-1.5 mt-2" />
            </div>
          </div>

          {/* Convergence Status */}
          {sc && (
            <div className={`rounded-lg p-4 border ${sc.color}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <sc.icon className="h-4 w-4" />
                  <span className="font-display font-bold">{result.convergence_status}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">Gap: {result.gap} pts</p>
                  <p className="text-xs text-muted-foreground">Allowed: {result.allowed_gap} pts</p>
                </div>
              </div>
              {tc && result.trajectory && (
                <div className={`flex items-center gap-1.5 mt-2 ${tc.color}`}>
                  <tc.icon className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Trajectory: {result.trajectory}</span>
                </div>
              )}
            </div>
          )}

          {/* Executive Guidance */}
          <Badge className={`text-xs ${guidanceConfig[result.executive_guidance] || 'bg-muted text-muted-foreground'}`}>
            {result.executive_guidance}
          </Badge>

          {/* Risks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {result.primary_creative_risk && (
              <div className="glass-card rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Brain className="h-3.5 w-3.5 text-purple-400" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Creative Risk</p>
                </div>
                <p className="text-sm text-foreground">{result.primary_creative_risk}</p>
              </div>
            )}
            {result.primary_commercial_risk && (
              <div className="glass-card rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Target className="h-3.5 w-3.5 text-emerald-400" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Commercial Risk</p>
                </div>
                <p className="text-sm text-foreground">{result.primary_commercial_risk}</p>
              </div>
            )}
          </div>

          {/* Leverage Moves */}
          {result.leverage_moves?.length > 0 && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Highest Leverage Moves</p>
              </div>
              <div className="space-y-2">
                {result.leverage_moves.map((move, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-primary font-bold shrink-0">{i + 1}.</span>
                    <p className="text-foreground">{move}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Format Advisory */}
          {result.format_advisory?.triggered && (
            <div className="glass-card rounded-lg p-4 border border-purple-500/30">
              <div className="flex items-center gap-1.5 mb-3">
                <RotateCcw className="h-3.5 w-3.5 text-purple-400" />
                <p className="text-xs text-purple-400 uppercase tracking-wider font-medium">Format Repositioning Advisory</p>
              </div>
              {result.format_advisory.alternative_formats && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {result.format_advisory.alternative_formats.map((f, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{f}</Badge>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                {result.format_advisory.predicted_ci_impact && (
                  <div><span className="text-muted-foreground">CI Impact:</span> <span className="font-medium">{result.format_advisory.predicted_ci_impact}</span></div>
                )}
                {result.format_advisory.predicted_gp_impact && (
                  <div><span className="text-muted-foreground">GP Impact:</span> <span className="font-medium">{result.format_advisory.predicted_gp_impact}</span></div>
                )}
                {result.format_advisory.repositioning_risk && (
                  <div><span className="text-muted-foreground">Risk:</span> <span className="font-medium">{result.format_advisory.repositioning_risk}</span></div>
                )}
              </div>
              {result.format_advisory.advisory_verdict && (
                <Badge className="bg-purple-500/20 text-purple-400 text-xs mb-2">{result.format_advisory.advisory_verdict}</Badge>
              )}
              {result.format_advisory.rationale && (
                <p className="text-xs text-muted-foreground mt-1">{result.format_advisory.rationale}</p>
              )}
            </div>
          )}

          {/* History sparkline */}
          {history && history.length > 1 && (
            <div className="glass-card rounded-lg p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Score History ({history.length} runs)</p>
              <div className="flex items-end gap-1 h-8">
                {[...history].reverse().map((h, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                    <div className="flex gap-0.5 items-end w-full">
                      <div className="flex-1 bg-purple-400/40 rounded-t" style={{ height: `${(h.creative_integrity_score / 100) * 32}px` }} />
                      <div className="flex-1 bg-emerald-400/40 rounded-t" style={{ height: `${(h.greenlight_probability / 100) * 32}px` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-400/40 rounded-sm" /> CI</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400/40 rounded-sm" /> GP</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
