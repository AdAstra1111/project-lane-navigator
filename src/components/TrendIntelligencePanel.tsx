import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, BarChart3, ChevronDown, Gauge, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, Zap, Edit3, Check, X, Bot, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useTrendEngines, useEngineWeights, useProjectEngineScores, useAIEngineScoring, useRecalibrateWeights } from '@/hooks/useTrendEngines';
import { calculateTrendViability, type TrendViabilityResult, type CyclePosition, type DynamicModifierContext } from '@/lib/trend-viability';
import { PredictionOutcomePanel } from '@/components/PredictionOutcomePanel';

const CYCLE_CONFIG: Record<CyclePosition, { color: string; icon: typeof TrendingUp; label: string }> = {
  Boom: { color: 'text-emerald-400', icon: TrendingUp, label: 'Boom' },
  Growth: { color: 'text-green-400', icon: TrendingUp, label: 'Growth' },
  Saturation: { color: 'text-amber-400', icon: Minus, label: 'Saturation' },
  Trough: { color: 'text-red-400', icon: TrendingDown, label: 'Trough' },
  Rebound: { color: 'text-blue-400', icon: Zap, label: 'Rebound' },
};

const ENGINE_TYPE_COLORS: Record<string, string> = {
  financial: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  narrative: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  talent: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  macro: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? 'text-emerald-400' : score >= 45 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={4} className="stroke-muted" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={4}
          strokeLinecap="round" className={`stroke-current ${color}`}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          strokeDasharray={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-bold font-display ${color}`}>{score}</span>
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
  format: string;
  budgetRange: string;
  primaryTerritory: string;
  assignedLane: string | null;
}

export function TrendIntelligencePanel({ projectId, format, budgetRange, primaryTerritory, assignedLane }: Props) {
  const { data: engines = [] } = useTrendEngines();
  const { data: weights = [] } = useEngineWeights(format);
  const { scores, upsertScore } = useProjectEngineScores(projectId);
  const { scoreEngines, isScoring } = useAIEngineScoring(projectId);
  const { recalibrate, isRecalibrating } = useRecalibrateWeights();
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [editingEngine, setEditingEngine] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(5);

  const modifierContext: DynamicModifierContext = useMemo(() => ({
    budget_range: budgetRange,
    primary_territory: primaryTerritory,
    assigned_lane: assignedLane,
  }), [budgetRange, primaryTerritory, assignedLane]);

  const result = useMemo<TrendViabilityResult | null>(() => {
    if (!engines.length) return null;
    return calculateTrendViability(engines, weights, scores, modifierContext);
  }, [engines, weights, scores, modifierContext]);

  if (!result) return null;

  const CycleIcon = CYCLE_CONFIG[result.cyclePosition]?.icon || Minus;

  return (
    <div className="space-y-4">
      {/* Score Header */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-5">
          <ScoreRing score={result.trendScore} />
          <div className="flex-1 min-w-0">
            <h4 className="font-display font-semibold text-foreground text-base mb-1">Trend Viability Score</h4>
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="outline" className={cn('text-xs', ENGINE_TYPE_COLORS[result.confidenceLevel === 'high' ? 'financial' : result.confidenceLevel === 'low' ? 'talent' : 'narrative'])}>
                {result.confidenceLevel} confidence
              </Badge>
              <Badge variant="outline" className={cn('text-xs flex items-center gap-1', CYCLE_CONFIG[result.cyclePosition]?.color)}>
                <CycleIcon className="h-3 w-3" />
                {result.cyclePosition}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {result.totalEnginesScored}/{result.totalEngines} engines scored
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {result.trendScore >= 70 ? 'Strong market alignment — favourable conditions for financing.' :
                result.trendScore >= 45 ? 'Mixed signals — some engines show promise, others need attention.' :
                  'Challenging market conditions — consider repositioning or timing.'}
            </p>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border/30">
          <Button size="sm" variant="outline" onClick={scoreEngines} disabled={isScoring} className="text-xs">
            <Bot className="h-3 w-3 mr-1" />
            {isScoring ? 'Scoring…' : 'AI Score Engines'}
          </Button>
          <Button size="sm" variant="outline" onClick={recalibrate} disabled={isRecalibrating} className="text-xs">
            <Settings2 className="h-3 w-3 mr-1" />
            {isRecalibrating ? 'Recalibrating…' : 'Recalibrate Weights'}
          </Button>
        </div>
      </div>

      {/* Applied Modifiers */}
      {result.appliedModifiers.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Dynamic Modifiers Applied</p>
          <div className="flex flex-wrap gap-1.5">
            {result.appliedModifiers.map((m, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {m.label} ({m.delta > 0 ? '+' : ''}{(m.delta * 100).toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Engine Breakdown */}
      <Collapsible open={enginesOpen} onOpenChange={setEnginesOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full glass-card rounded-xl px-5 py-3 flex items-center gap-3 hover:bg-card/90 transition-colors cursor-pointer">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="font-display font-semibold text-foreground text-sm flex-1 text-left">Active Engines</span>
            <span className="text-xs text-muted-foreground">{result.totalEngines} engines</span>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', enginesOpen && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 pt-2">
            {result.engineBreakdown.map(engine => (
              <div key={engine.engineName} className="glass-card rounded-lg px-4 py-3">
                <div className="flex items-center gap-3 mb-1.5">
                  <Badge variant="outline" className={cn('text-[10px] px-1.5', ENGINE_TYPE_COLORS[engine.engineType])}>
                    {engine.engineType}
                  </Badge>
                  <span className="text-sm font-medium text-foreground flex-1">{engine.engineName}</span>
                  {engine.staleDays !== null && engine.staleDays > 30 && (
                    <span title={`${engine.staleDays}d since refresh`}><AlertTriangle className="h-3 w-3 text-amber-400" /></span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    wt: {(engine.adjustedWeight * 100).toFixed(0)}%
                  </span>
                  {editingEngine === engine.engineName ? (
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[editValue]}
                        onValueChange={v => setEditValue(v[0])}
                        min={0} max={10} step={0.5}
                        className="w-24"
                      />
                      <span className="text-xs font-mono w-6">{editValue}</span>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => {
                        const eng = engines.find(e => e.engine_name === engine.engineName);
                        if (eng) upsertScore.mutate({ engineId: eng.id, score: editValue });
                        setEditingEngine(null);
                      }}>
                        <Check className="h-3 w-3 text-emerald-400" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditingEngine(null)}>
                        <X className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className={cn(
                        'text-sm font-bold font-mono',
                        engine.score >= 7 ? 'text-emerald-400' : engine.score >= 4 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {engine.score.toFixed(1)}
                      </span>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => {
                        setEditingEngine(engine.engineName);
                        setEditValue(engine.score);
                      }}>
                        <Edit3 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </>
                  )}
                </div>
                <Progress value={engine.score * 10} className="h-1" />
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground">
                    {engine.source === 'ai' ? '🤖 AI' : engine.source === 'manual' ? '✏️ Manual' : '⚡ Default'}
                  </span>
                  <span className={cn(
                    'text-[10px]',
                    engine.confidence === 'high' ? 'text-emerald-400' : engine.confidence === 'low' ? 'text-red-400' : 'text-amber-400'
                  )}>
                    {engine.confidence} conf.
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    contrib: {(engine.contribution * 10).toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Prediction Accuracy Tracking */}
      <PredictionOutcomePanel projectId={projectId} currentTrendScore={result.trendScore} />
    </div>
  );
}
