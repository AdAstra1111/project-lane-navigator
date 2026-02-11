import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sunrise, TrendingUp, TrendingDown, Clock, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Project, LANE_LABELS, MonetisationLane } from '@/lib/types';
import { formatDistanceToNow, differenceInDays, isAfter, subDays } from 'date-fns';

interface DailyBriefingProps {
  projects: Project[];
  projectScores: Record<string, { readiness: number | null; financeReadiness: number | null }>;
}

interface BriefingInsight {
  icon: React.ElementType;
  text: string;
  link?: string;
  tone: 'neutral' | 'positive' | 'warning';
}

export function DailyBriefing({ projects, projectScores }: DailyBriefingProps) {
  const insights = useMemo(() => {
    if (projects.length === 0) return [];

    const now = new Date();
    const weekAgo = subDays(now, 7);
    const results: BriefingInsight[] = [];

    // Count recently updated projects
    const recentlyUpdated = projects.filter(p =>
      isAfter(new Date(p.updated_at), weekAgo)
    );

    if (recentlyUpdated.length > 0) {
      results.push({
        icon: TrendingUp,
        text: `${recentlyUpdated.length} project${recentlyUpdated.length !== 1 ? 's' : ''} updated this week`,
        tone: 'positive',
      });
    }

    // Find stale projects (14+ days)
    const staleProjects = projects.filter(p => {
      const days = differenceInDays(now, new Date(p.updated_at));
      return days >= 14;
    });

    if (staleProjects.length > 0) {
      const stalest = staleProjects.sort((a, b) =>
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      )[0];
      const days = differenceInDays(now, new Date(stalest.updated_at));
      results.push({
        icon: Clock,
        text: `${stalest.title} hasn't been touched in ${days} days — still in ${stalest.pipeline_stage}?`,
        link: `/projects/${stalest.id}`,
        tone: 'warning',
      });
    }

    // Highest-readiness project
    const scored = projects
      .map(p => ({ project: p, score: projectScores[p.id]?.readiness ?? 0 }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score >= 60) {
      results.push({
        icon: Sparkles,
        text: `${scored[0].project.title} leads your slate at ${scored[0].score}% readiness`,
        link: `/projects/${scored[0].project.id}`,
        tone: 'positive',
      });
    }

    // Low finance readiness warning
    const lowFinance = projects
      .map(p => ({ project: p, score: projectScores[p.id]?.financeReadiness ?? 0 }))
      .filter(s => s.score > 0 && s.score < 40)
      .sort((a, b) => a.score - b.score);

    if (lowFinance.length > 0) {
      results.push({
        icon: AlertCircle,
        text: `${lowFinance[0].project.title} has low finance readiness (${lowFinance[0].score}%) — consider strengthening the package`,
        link: `/projects/${lowFinance[0].project.id}`,
        tone: 'warning',
      });
    }

    // Projects in financing stage
    const inFinancing = projects.filter(p => p.pipeline_stage === 'financing');
    if (inFinancing.length > 0) {
      results.push({
        icon: TrendingUp,
        text: `${inFinancing.length} project${inFinancing.length !== 1 ? 's' : ''} in financing — actively seeking capital`,
        tone: 'neutral',
      });
    }

    return results.slice(0, 4);
  }, [projects, projectScores]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  if (projects.length === 0 || insights.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mb-8"
    >
      <div className="glass-card rounded-xl p-6 border-l-4 border-primary/40">
        <div className="flex items-center gap-2.5 mb-4">
          <Sunrise className="h-5 w-5 text-primary" />
          <h2 className="font-display font-semibold text-foreground text-base">
            {greeting}. Here's your slate.
          </h2>
        </div>

        <div className="space-y-3">
          {insights.map((insight, i) => {
            const Icon = insight.icon;
            const content = (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                className={`flex items-start gap-3 group ${
                  insight.link ? 'cursor-pointer' : ''
                }`}
              >
                <div className={`mt-0.5 p-1 rounded ${
                  insight.tone === 'positive' ? 'bg-emerald-500/10' :
                  insight.tone === 'warning' ? 'bg-amber-500/10' :
                  'bg-muted/50'
                }`}>
                  <Icon className={`h-3.5 w-3.5 ${
                    insight.tone === 'positive' ? 'text-emerald-400' :
                    insight.tone === 'warning' ? 'text-amber-400' :
                    'text-muted-foreground'
                  }`} />
                </div>
                <p className="text-sm text-foreground/80 flex-1 leading-relaxed">
                  {insight.text}
                </p>
                {insight.link && (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
                )}
              </motion.div>
            );

            return insight.link ? (
              <Link key={i} to={insight.link} className="block hover:bg-muted/20 -mx-2 px-2 py-1 rounded-lg transition-colors">
                {content}
              </Link>
            ) : (
              <div key={i} className="-mx-2 px-2 py-1">
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
