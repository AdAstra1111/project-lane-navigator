import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, AlertTriangle, BarChart3, Landmark, Clock } from 'lucide-react';
import { Project, LANE_LABELS, MonetisationLane } from '@/lib/types';
import { calculateReadiness, type ReadinessResult } from '@/lib/readiness-score';
import type { ProjectCastMember, ProjectPartner, ProjectScript, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';

interface PortfolioData {
  avgReadiness: number;
  stageDistribution: Record<string, number>;
  laneDistribution: Record<string, number>;
  staleProjects: { id: string; title: string; daysSinceUpdate: number }[];
  totalProjects: number;
}

export function usePortfolioAnalytics(projects: Project[]): PortfolioData {
  return useMemo(() => {
    if (projects.length === 0) {
      return {
        avgReadiness: 0,
        stageDistribution: {},
        laneDistribution: {},
        staleProjects: [],
        totalProjects: 0,
      };
    }

    // Stage distribution
    const stageDistribution: Record<string, number> = {};
    const laneDistribution: Record<string, number> = {};
    const now = Date.now();
    const staleProjects: { id: string; title: string; daysSinceUpdate: number }[] = [];

    // Simple readiness approximation using project metadata only (no attachment data)
    let totalReadiness = 0;

    for (const p of projects) {
      // Stage
      const stage = p.pipeline_stage || 'development';
      stageDistribution[stage] = (stageDistribution[stage] || 0) + 1;

      // Lane
      if (p.assigned_lane) {
        const label = LANE_LABELS[p.assigned_lane as MonetisationLane] || p.assigned_lane;
        laneDistribution[label] = (laneDistribution[label] || 0) + 1;
      }

      // Stale check (30+ days since last update)
      const updatedAt = new Date(p.updated_at).getTime();
      const daysSince = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
      if (daysSince >= 30) {
        staleProjects.push({ id: p.id, title: p.title, daysSinceUpdate: daysSince });
      }

      // Approximate readiness from metadata
      let score = 0;
      if (p.analysis_passes) score += 20;
      if (p.assigned_lane) score += 10;
      if (p.genres?.length > 0) score += 5;
      if (p.budget_range) score += 5;
      if (p.target_audience) score += 5;
      if (p.tone) score += 5;
      if (p.comparable_titles) score += 5;
      if (p.confidence && p.confidence > 0.7) score += 10;
      totalReadiness += Math.min(100, score);
    }

    return {
      avgReadiness: Math.round(totalReadiness / projects.length),
      stageDistribution,
      laneDistribution,
      staleProjects: staleProjects.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate),
      totalProjects: projects.length,
    };
  }, [projects]);
}

const STAGE_LABELS: Record<string, string> = {
  development: 'Development',
  packaging: 'Packaging',
  financing: 'Financing',
  'pre-production': 'Pre-Production',
};

const STAGE_COLORS: Record<string, string> = {
  development: 'bg-blue-500',
  packaging: 'bg-amber-500',
  financing: 'bg-emerald-500',
  'pre-production': 'bg-violet-500',
};

export function DashboardAnalytics({ projects }: { projects: Project[] }) {
  const analytics = usePortfolioAnalytics(projects);

  if (projects.length === 0) return null;

  const maxStageCount = Math.max(...Object.values(analytics.stageDistribution), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-8 space-y-4"
    >
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={BarChart3}
          label="Avg Readiness"
          value={`${analytics.avgReadiness}%`}
          detail={`across ${analytics.totalProjects} project${analytics.totalProjects !== 1 ? 's' : ''}`}
        />
        <StatCard
          icon={TrendingUp}
          label="Pipeline Stages"
          value={`${Object.keys(analytics.stageDistribution).length}`}
          detail="active stages"
        />
        <StatCard
          icon={Landmark}
          label="Lanes"
          value={`${Object.keys(analytics.laneDistribution).length}`}
          detail="monetisation lanes"
        />
        <StatCard
          icon={AlertTriangle}
          label="Stale Projects"
          value={`${analytics.staleProjects.length}`}
          detail="not updated in 30+ days"
          warn={analytics.staleProjects.length > 0}
        />
      </div>

      {/* Pipeline Distribution */}
      {Object.keys(analytics.stageDistribution).length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Pipeline Distribution</h3>
          <div className="space-y-2">
            {Object.entries(analytics.stageDistribution).map(([stage, count]) => (
              <div key={stage} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24 shrink-0">
                  {STAGE_LABELS[stage] || stage}
                </span>
                <div className="flex-1 h-5 bg-muted/50 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${STAGE_COLORS[stage] || 'bg-primary'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / maxStageCount) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                  />
                </div>
                <span className="text-xs font-medium text-foreground w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lane Distribution */}
      {Object.keys(analytics.laneDistribution).length > 1 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Lane Distribution</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(analytics.laneDistribution)
              .sort(([, a], [, b]) => b - a)
              .map(([lane, count]) => (
                <span
                  key={lane}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  {lane}
                  <span className="font-bold">{count}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Stale Projects Alert */}
      {analytics.staleProjects.length > 0 && (
        <div className="glass-card rounded-xl p-5 border-l-4 border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-foreground">Needs Attention</h3>
          </div>
          <div className="space-y-1.5">
            {analytics.staleProjects.slice(0, 5).map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{p.title}</span>
                <span className="text-muted-foreground text-xs">{p.daysSinceUpdate}d ago</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  warn,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${warn ? 'text-amber-400' : 'text-primary'}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-display font-bold ${warn ? 'text-amber-400' : 'text-foreground'}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
    </div>
  );
}
