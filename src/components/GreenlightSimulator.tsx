import { useState } from 'react';
import { Loader2, Zap, Users, Globe, TrendingUp, Target, DollarSign, MessageSquare, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress } from '@/components/OperationProgress';

const GREENLIGHT_STAGES = [
  { at: 10, label: 'Preparing exec brief…' },
  { at: 30, label: 'Running streamer simulation…' },
  { at: 60, label: 'Scoring evaluation axes…' },
  { at: 80, label: 'Generating exec notes…' },
  { at: 95, label: 'Building strategic adjustments…' },
];

interface EvalAxis {
  score: number;
  rationale: string;
}

interface GreenlightResult {
  exec_summary: {
    project_type: string;
    genre: string;
    target_audience: string;
    budget_estimate: string;
    monetisation_lane: string;
    format: string;
  };
  evaluation_axes: {
    hook_immediacy: EvalAxis;
    audience_clarity: EvalAxis;
    retention_potential: EvalAxis;
    castability: EvalAxis;
    global_travelability: EvalAxis;
    budget_vs_subscriber_value: EvalAxis;
  };
  greenlight_verdict: 'GREEN' | 'YELLOW' | 'RED';
  verdict_reasoning: string;
  exec_notes: string[];
  strategic_adjustments: {
    creative: string;
    packaging: string;
    budget: string;
  };
}

const AXIS_META: Record<string, { label: string; icon: typeof Zap }> = {
  hook_immediacy: { label: 'Hook Immediacy', icon: Zap },
  audience_clarity: { label: 'Audience Clarity', icon: Target },
  retention_potential: { label: 'Retention Potential', icon: TrendingUp },
  castability: { label: 'Castability', icon: Users },
  global_travelability: { label: 'Global Travelability', icon: Globe },
  budget_vs_subscriber_value: { label: 'Budget vs Subscriber Value', icon: DollarSign },
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

  const scoreColor = (s: number) =>
    s >= 7 ? 'text-emerald-400' : s >= 5 ? 'text-amber-400' : 'text-red-400';

  const verdictConfig = {
    GREEN: { emoji: '🟢', label: 'GREENLIGHT LIKELY', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    YELLOW: { emoji: '🟡', label: 'CONDITIONAL', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    RED: { emoji: '🔴', label: 'PASS', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Streamer Greenlight Simulator</h4>
        </div>
        <Button size="sm" variant="outline" onClick={simulate} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
          Run Simulation
        </Button>
      </div>

      <OperationProgress isActive={loading} stages={GREENLIGHT_STAGES} />

      {!result && !loading && (
        <p className="text-sm text-muted-foreground">
          Simulates a high-level streamer development meeting to stress-test project viability before external pitch.
        </p>
      )}

      {result && (
        <div className="space-y-5">
          {/* Exec Summary */}
          <div className="glass-card rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Exec Room Summary</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {Object.entries(result.exec_summary).map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                  <p className="text-foreground font-medium">{v || 'N/A'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Verdict */}
          <div className={`rounded-lg p-4 border ${verdictConfig[result.greenlight_verdict]?.color || verdictConfig.YELLOW.color}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{verdictConfig[result.greenlight_verdict]?.emoji || '🟡'}</span>
              <span className="font-display font-bold text-lg">
                {verdictConfig[result.greenlight_verdict]?.label || 'CONDITIONAL'}
              </span>
            </div>
            <p className="text-sm opacity-90">{result.verdict_reasoning}</p>
          </div>

          {/* Evaluation Axes */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Streamer Evaluation Axes</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(result.evaluation_axes).map(([key, axis]) => {
                const meta = AXIS_META[key];
                if (!meta || !axis) return null;
                const Icon = meta.icon;
                return (
                  <div key={key} className="glass-card rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{meta.label}</span>
                      </div>
                      <span className={`text-lg font-display font-bold ${scoreColor(axis.score)}`}>
                        {axis.score}<span className="text-xs text-muted-foreground">/10</span>
                      </span>
                    </div>
                    <Progress value={axis.score * 10} className="h-1 mb-1.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{axis.rationale}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Exec Notes */}
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

          {/* Strategic Adjustments */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Strategic Adjustments</p>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Creative Adjustment', text: result.strategic_adjustments.creative },
                { label: 'Packaging Move', text: result.strategic_adjustments.packaging },
                { label: 'Budget Strategy', text: result.strategic_adjustments.budget },
              ].map((adj) => (
                <div key={adj.label}>
                  <Badge variant="secondary" className="mb-1 text-[10px]">{adj.label}</Badge>
                  <p className="text-sm text-foreground">{adj.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
