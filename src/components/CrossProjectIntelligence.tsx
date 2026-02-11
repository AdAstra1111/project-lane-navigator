import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Layers, AlertTriangle, Lightbulb, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';

interface CrossProjectIntelligenceProps {
  projects: Project[];
  projectScores: Record<string, { readiness: number; financeReadiness: number }>;
}

interface Insight {
  type: 'risk' | 'opportunity' | 'gap';
  title: string;
  detail: string;
}

export function CrossProjectIntelligence({ projects, projectScores }: CrossProjectIntelligenceProps) {
  const insights = useMemo(() => {
    if (projects.length < 2) return [];

    const result: Insight[] = [];

    // 1. Genre concentration risk
    const genreCounts: Record<string, number> = {};
    for (const p of projects) {
      for (const g of p.genres || []) {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      }
    }
    const dominantGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
    if (dominantGenre && dominantGenre[1] >= Math.ceil(projects.length * 0.6)) {
      result.push({
        type: 'risk',
        title: `Genre Concentration: ${dominantGenre[0]}`,
        detail: `${dominantGenre[1]} of ${projects.length} projects share the ${dominantGenre[0]} genre. Consider diversifying to reduce market risk.`,
      });
    }

    // 2. Lane concentration
    const laneCounts: Record<string, number> = {};
    for (const p of projects) {
      if (p.assigned_lane) laneCounts[p.assigned_lane] = (laneCounts[p.assigned_lane] || 0) + 1;
    }
    const dominantLane = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0];
    if (dominantLane && dominantLane[1] >= Math.ceil(projects.length * 0.6)) {
      result.push({
        type: 'risk',
        title: `Lane Concentration`,
        detail: `${dominantLane[1]} projects in ${LANE_LABELS[dominantLane[0] as MonetisationLane] || dominantLane[0]}. Diversifying across lanes reduces portfolio risk.`,
      });
    }

    // 3. Budget range gaps
    const budgetCounts: Record<string, number> = {};
    for (const p of projects) {
      if (p.budget_range) budgetCounts[p.budget_range] = (budgetCounts[p.budget_range] || 0) + 1;
    }
    const missingBudgets = ['micro', 'low', 'mid', 'high'].filter(b => !budgetCounts[b]);
    if (missingBudgets.length > 0 && projects.length >= 3) {
      result.push({
        type: 'gap',
        title: 'Budget Range Gaps',
        detail: `Your slate has no ${missingBudgets.join(', ')} budget projects. A diversified budget spread can balance risk.`,
      });
    }

    // 4. Pipeline bottleneck
    const stageCounts: Record<string, number> = {};
    for (const p of projects) {
      stageCounts[p.pipeline_stage] = (stageCounts[p.pipeline_stage] || 0) + 1;
    }
    const stuckInDev = stageCounts['development'] || 0;
    if (stuckInDev > projects.length * 0.7 && projects.length >= 3) {
      result.push({
        type: 'risk',
        title: 'Pipeline Bottleneck',
        detail: `${stuckInDev} of ${projects.length} projects are still in Development. Focus on advancing top-scoring projects.`,
      });
    }

    // 5. Packaging opportunity
    const lowFinanceHighReadiness = projects.filter(p => {
      const s = projectScores[p.id];
      return s && s.readiness >= 60 && s.financeReadiness < 40;
    });
    if (lowFinanceHighReadiness.length > 0) {
      result.push({
        type: 'opportunity',
        title: 'Finance Gap Opportunity',
        detail: `${lowFinanceHighReadiness.map(p => p.title).join(', ')} ${lowFinanceHighReadiness.length === 1 ? 'has' : 'have'} strong readiness but weak finance structure. Prioritize finance plans.`,
      });
    }

    // 6. Format diversity
    const formats = new Set(projects.map(p => p.format));
    if (formats.size === 1 && projects.length >= 3) {
      result.push({
        type: 'gap',
        title: 'Single Format Slate',
        detail: `All projects are ${formats.has('tv-series') ? 'TV series' : 'films'}. Consider adding ${formats.has('tv-series') ? 'film' : 'TV'} projects for buyer diversification.`,
      });
    }

    return result;
  }, [projects, projectScores]);

  if (insights.length === 0) return null;

  const iconMap = { risk: AlertTriangle, opportunity: Lightbulb, gap: BarChart3 };
  const colorMap = {
    risk: 'text-red-400',
    opportunity: 'text-emerald-400',
    gap: 'text-amber-400',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 mb-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Cross-Project Intelligence</h3>
        <Badge variant="secondary" className="text-xs">{insights.length} insight{insights.length !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="space-y-3">
        {insights.map((insight, i) => {
          const Icon = iconMap[insight.type];
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex gap-3"
            >
              <div className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                insight.type === 'risk' && "bg-red-500/10",
                insight.type === 'opportunity' && "bg-emerald-500/10",
                insight.type === 'gap' && "bg-amber-500/10",
              )}>
                <Icon className={cn("h-4 w-4", colorMap[insight.type])} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{insight.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{insight.detail}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
