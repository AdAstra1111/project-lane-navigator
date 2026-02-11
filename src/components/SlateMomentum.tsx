import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

interface SlateMomentumProps {
  projects: Project[];
  projectScores: Record<string, { readiness: number; financeReadiness: number }>;
}

export function SlateMomentum({ projects, projectScores }: SlateMomentumProps) {
  const stats = useMemo(() => {
    const total = projects.length;
    const byStage: Record<string, number> = {};
    let avgReadiness = 0;
    let avgFinance = 0;
    let scoredCount = 0;
    const highReady: string[] = [];
    const needsAttention: string[] = [];

    for (const p of projects) {
      byStage[p.pipeline_stage] = (byStage[p.pipeline_stage] || 0) + 1;
      const score = projectScores[p.id];
      if (score) {
        avgReadiness += score.readiness;
        avgFinance += score.financeReadiness;
        scoredCount++;
        if (score.readiness >= 70) highReady.push(p.title);
        if (score.readiness < 40 && score.readiness > 0) needsAttention.push(p.title);
      }
    }

    if (scoredCount > 0) {
      avgReadiness = Math.round(avgReadiness / scoredCount);
      avgFinance = Math.round(avgFinance / scoredCount);
    }

    const laneDistribution: Record<string, number> = {};
    for (const p of projects) {
      if (p.assigned_lane) {
        laneDistribution[p.assigned_lane] = (laneDistribution[p.assigned_lane] || 0) + 1;
      }
    }

    return { total, byStage, avgReadiness, avgFinance, highReady, needsAttention, laneDistribution };
  }, [projects, projectScores]);

  if (projects.length < 2) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 mb-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Slate Momentum</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total Projects" value={stats.total} />
        <StatCard
          label="Avg Readiness"
          value={`${stats.avgReadiness}%`}
          trend={stats.avgReadiness >= 50 ? 'up' : stats.avgReadiness >= 30 ? 'neutral' : 'down'}
        />
        <StatCard
          label="Avg Finance Ready"
          value={`${stats.avgFinance}%`}
          trend={stats.avgFinance >= 50 ? 'up' : stats.avgFinance >= 30 ? 'neutral' : 'down'}
        />
        <StatCard
          label="Market-Ready"
          value={stats.highReady.length}
          subtitle="projects ≥70%"
        />
      </div>

      {/* Pipeline distribution */}
      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Pipeline Distribution</p>
        <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-muted">
          {['development', 'packaging', 'financing', 'pre-production'].map(stage => {
            const count = stats.byStage[stage] || 0;
            const pct = (count / stats.total) * 100;
            if (pct === 0) return null;
            return (
              <motion.div
                key={stage}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className={cn(
                  "h-full",
                  stage === 'development' && "bg-blue-500",
                  stage === 'packaging' && "bg-amber-500",
                  stage === 'financing' && "bg-emerald-500",
                  stage === 'pre-production' && "bg-purple-500",
                )}
                title={`${stage}: ${count}`}
              />
            );
          })}
        </div>
        <div className="flex gap-4 mt-2">
          {['development', 'packaging', 'financing', 'pre-production'].map(stage => {
            const count = stats.byStage[stage] || 0;
            if (count === 0) return null;
            return (
              <div key={stage} className="flex items-center gap-1.5">
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  stage === 'development' && "bg-blue-500",
                  stage === 'packaging' && "bg-amber-500",
                  stage === 'financing' && "bg-emerald-500",
                  stage === 'pre-production' && "bg-purple-500",
                )} />
                <span className="text-xs text-muted-foreground capitalize">{stage} ({count})</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Attention items */}
      {stats.needsAttention.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Needs Attention</p>
          <div className="flex flex-wrap gap-1.5">
            {stats.needsAttention.map(title => (
              <Badge key={title} variant="outline" className="text-amber-400 border-amber-400/30 text-xs">
                {title}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StatCard({
  label,
  value,
  trend,
  subtitle,
}: {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-2xl font-display font-bold text-foreground">{value}</span>
        {trend === 'up' && <TrendingUp className="h-4 w-4 text-emerald-400" />}
        {trend === 'down' && <TrendingDown className="h-4 w-4 text-red-400" />}
        {trend === 'neutral' && <Minus className="h-4 w-4 text-amber-400" />}
      </div>
      {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
