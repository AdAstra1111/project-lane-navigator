import { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, TrendingDown, Target, RefreshCw, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useModelAccuracy } from '@/hooks/useModelAccuracy';
import { useTrendEngines, useRecalibrateWeights } from '@/hooks/useTrendEngines';
import { format } from 'date-fns';

interface Props {
  productionType: string;
}

export function ModelAccuracyDashboard({ productionType }: Props) {
  const { data: scores = [], isLoading } = useModelAccuracy(productionType);
  const { data: engines = [] } = useTrendEngines();
  const { recalibrate, isRecalibrating } = useRecalibrateWeights();

  const engineMap = new Map(engines.map(e => [e.id, e]));

  // Aggregate stats
  const totalPredictions = scores.reduce((s, a) => s + a.total_predictions, 0);
  const totalCorrect = scores.reduce((s, a) => s + a.correct_predictions, 0);
  const overallAccuracy = totalPredictions > 0 ? Math.round((totalCorrect / totalPredictions) * 100) : null;

  const topPerformers = [...scores].filter(s => s.total_predictions >= 2).sort((a, b) => b.accuracy_pct - a.accuracy_pct).slice(0, 3);
  const weakPerformers = [...scores].filter(s => s.total_predictions >= 2 && s.accuracy_pct < 60).sort((a, b) => a.accuracy_pct - b.accuracy_pct).slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold text-foreground">Model Accuracy Tracker</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => recalibrate()}
          disabled={isRecalibrating}
          className="text-xs"
        >
          {isRecalibrating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          {isRecalibrating ? 'Recalibrating…' : 'Recalibrate Weights'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Tracks how well each engine's scores predict actual financing outcomes. Recalibration adjusts weights based on accuracy.
      </p>

      {/* Overall KPI */}
      <div className="glass-card rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className={cn(
            'text-2xl font-bold font-display',
            overallAccuracy === null ? 'text-muted-foreground' :
            overallAccuracy >= 70 ? 'text-emerald-400' :
            overallAccuracy >= 50 ? 'text-amber-400' : 'text-red-400'
          )}>
            {overallAccuracy !== null ? `${overallAccuracy}%` : '—'}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase mt-1">Overall Accuracy</div>
        </div>
        <div>
          <div className="text-2xl font-bold font-display text-foreground">{totalPredictions}</div>
          <div className="text-[10px] text-muted-foreground uppercase mt-1">Predictions</div>
        </div>
        <div>
          <div className="text-2xl font-bold font-display text-foreground">{scores.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase mt-1">Engines Tracked</div>
        </div>
      </div>

      {/* Per-Engine Breakdown */}
      {scores.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Per-Engine Accuracy</h3>
          {scores.map((score) => {
            const engine = engineMap.get(score.engine_id);
            const name = engine?.engine_name || 'Unknown Engine';
            return (
              <motion.div
                key={score.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground truncate">{name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {score.total_predictions} predictions
                    </Badge>
                    <span className={cn(
                      'text-sm font-bold font-mono',
                      score.accuracy_pct >= 70 ? 'text-emerald-400' :
                      score.accuracy_pct >= 50 ? 'text-amber-400' : 'text-red-400'
                    )}>
                      {score.accuracy_pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <Progress
                  value={score.accuracy_pct}
                  className="h-1.5"
                />
                <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span>Avg Predicted: {score.avg_predicted_score.toFixed(1)}</span>
                  <span>Avg Actual: {score.avg_actual_outcome.toFixed(1)}</span>
                  {score.last_calculated_at && (
                    <span className="ml-auto">
                      Last: {format(new Date(score.last_calculated_at), 'dd MMM yyyy')}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="glass-card rounded-xl p-6 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No accuracy data yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Record financing outcomes on projects to start tracking prediction accuracy.
          </p>
        </div>
      )}

      {/* Top & Weak Performers */}
      {topPerformers.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-foreground">Top Performers</span>
            </div>
            {topPerformers.map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate">{engineMap.get(s.engine_id)?.engine_name || '?'}</span>
                <span className="text-emerald-400 font-mono font-bold">{s.accuracy_pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
          {weakPerformers.length > 0 && (
            <div className="glass-card rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-medium text-foreground">Needs Improvement</span>
              </div>
              {weakPerformers.map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate">{engineMap.get(s.engine_id)?.engine_name || '?'}</span>
                  <span className="text-red-400 font-mono font-bold">{s.accuracy_pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
