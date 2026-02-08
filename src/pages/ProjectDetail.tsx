import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Film, Tv, Target, Palette, DollarSign, Users, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/Header';
import { LaneBadge } from '@/components/LaneBadge';
import { useProject } from '@/hooks/useProjects';
import { MonetisationLane, Recommendation } from '@/lib/types';
import { BUDGET_RANGES, TARGET_AUDIENCES, TONES } from '@/lib/constants';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  Packaging: Users,
  Finance: DollarSign,
  Strategy: Target,
  Market: Palette,
};

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Confidence</span>
        <span className="font-medium text-foreground">{percent}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
        />
      </div>
    </div>
  );
}

function RecommendationCard({ rec, index }: { rec: Recommendation; index: number }) {
  const Icon = CATEGORY_ICONS[rec.category] || Target;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 + index * 0.1, duration: 0.3 }}
      className="glass-card rounded-lg p-5"
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider mb-1">
            {rec.category}
          </p>
          <h4 className="font-display font-semibold text-foreground mb-1">
            {rec.title}
          </h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {rec.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { project, isLoading } = useProject(id);

  const getLabel = (value: string, list: readonly { value: string; label: string }[]) =>
    list.find(item => item.value === value)?.label || value;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-3xl py-10">
          <div className="animate-pulse space-y-6">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-32 bg-muted rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-3xl py-10 text-center">
          <p className="text-muted-foreground">Project not found.</p>
          <Link to="/dashboard">
            <Button variant="link" className="text-primary mt-4">Back to Dashboard</Button>
          </Link>
        </main>
      </div>
    );
  }

  const recommendations = (project.recommendations || []) as Recommendation[];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Back */}
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            All Projects
          </Link>

          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {project.format === 'tv-series' ? (
                  <Tv className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Film className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  {project.format === 'tv-series' ? 'TV Series' : 'Film'}
                </span>
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                {project.title}
              </h1>
              {project.genres && project.genres.length > 0 && (
                <p className="text-muted-foreground mt-1">
                  {project.genres.join(' · ')}
                </p>
              )}
            </div>
          </div>

          {/* Lane Classification */}
          {project.assigned_lane && (
            <div className="glass-card rounded-xl p-6 mb-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                    Assigned Lane
                  </p>
                  <LaneBadge
                    lane={project.assigned_lane as MonetisationLane}
                    size="lg"
                  />
                </div>
              </div>
              {project.confidence != null && (
                <ConfidenceMeter confidence={project.confidence} />
              )}
            </div>
          )}

          {/* Reasoning */}
          {project.reasoning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="glass-card rounded-xl p-6 mb-6"
            >
              <div className="flex items-start gap-3">
                <Quote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-display font-semibold text-foreground mb-2">
                    Why this lane
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {project.reasoning}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Project Details */}
          <div className="glass-card rounded-xl p-6 mb-8">
            <h3 className="font-display font-semibold text-foreground mb-4">
              Project Details
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-0.5">Budget Range</p>
                <p className="text-foreground font-medium">
                  {getLabel(project.budget_range, BUDGET_RANGES)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Target Audience</p>
                <p className="text-foreground font-medium">
                  {getLabel(project.target_audience, TARGET_AUDIENCES)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Tone</p>
                <p className="text-foreground font-medium">
                  {getLabel(project.tone, TONES)}
                </p>
              </div>
              {project.comparable_titles && (
                <div>
                  <p className="text-muted-foreground mb-0.5">Comparables</p>
                  <p className="text-foreground font-medium">
                    {project.comparable_titles}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div>
              <h3 className="font-display font-semibold text-foreground text-xl mb-4">
                Recommendations
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {recommendations.map((rec, i) => (
                  <RecommendationCard key={rec.title} rec={rec} index={i} />
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
