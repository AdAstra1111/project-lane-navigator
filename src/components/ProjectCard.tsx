import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Film, Tv, ArrowRight } from 'lucide-react';
import { Project, MonetisationLane } from '@/lib/types';
import { LaneBadge } from './LaneBadge';

interface ProjectCardProps {
  project: Project;
  index: number;
}

export function ProjectCard({ project, index }: ProjectCardProps) {
  const FormatIcon = project.format === 'tv-series' ? Tv : Film;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
    >
      <Link
        to={`/projects/${project.id}`}
        className="group block glass-card rounded-lg p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_30px_hsl(var(--glow-primary))]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <FormatIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                {project.format === 'tv-series' ? 'TV Series' : 'Film'}
              </span>
            </div>
            <h3 className="text-lg font-display font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {project.title}
            </h3>
            {project.genres && project.genres.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {project.genres.join(' · ')}
              </p>
            )}
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
        </div>
        {project.assigned_lane && (
          <div className="mt-4">
            <LaneBadge lane={project.assigned_lane as MonetisationLane} size="sm" />
          </div>
        )}
      </Link>
    </motion.div>
  );
}
