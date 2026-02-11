import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Film, Tv, ArrowRight, Star } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { Project, MonetisationLane } from '@/lib/types';
import { LaneBadge } from './LaneBadge';

interface ProjectCardProps {
  project: Project;
  index: number;
  readinessScore?: number | null;
  financeReadinessScore?: number | null;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
}

function MiniScoreRing({ score, size = 28 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 70 ? 'hsl(142 71% 45%)' : score >= 40 ? 'hsl(38 92% 50%)' : 'hsl(0 84% 60%)';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="2.5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-foreground">{score}</span>
    </div>
  );
}

function RecencyPulse({ updatedAt }: { updatedAt: string }) {
  const days = differenceInDays(new Date(), new Date(updatedAt));
  if (days <= 3) {
    return (
      <span className="relative flex h-2 w-2" title="Updated recently">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
    );
  }
  if (days <= 14) {
    return <span className="h-2 w-2 rounded-full bg-amber-500/60" title={`Updated ${days}d ago`} />;
  }
  if (days > 30) {
    return <span className="h-2 w-2 rounded-full bg-muted-foreground/30" title={`Dormant — ${days}d ago`} />;
  }
  return null;
}

export function ProjectCard({ project, index, readinessScore, financeReadinessScore, selected, onSelect, onTogglePin }: ProjectCardProps) {
  const FormatIcon = project.format === 'tv-series' ? Tv : Film;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="relative"
    >
      {/* Select checkbox */}
      {onSelect && (
        <button
          onClick={(e) => { e.preventDefault(); onSelect(project.id); }}
          className={`absolute -left-1 -top-1 z-10 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-primary border-primary' : 'border-border bg-background hover:border-primary/50'
          }`}
        >
          {selected && <span className="text-primary-foreground text-xs font-bold">✓</span>}
        </button>
      )}

      {/* Pin button */}
      {onTogglePin && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(project.id, !project.pinned); }}
          className={`absolute top-2 right-2 z-10 p-1 rounded transition-colors ${
            project.pinned ? 'text-primary' : 'text-muted-foreground/30 hover:text-primary/60'
          }`}
          title={project.pinned ? 'Unpin project' : 'Pin to top'}
        >
          <Star className={`h-3.5 w-3.5 ${project.pinned ? 'fill-primary' : ''}`} />
        </button>
      )}

      <Link
        to={`/projects/${project.id}`}
        className={`group block glass-card rounded-lg p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_30px_hsl(var(--glow-primary))] ${
          selected ? 'ring-2 ring-primary/50' : ''
        } ${project.pinned ? 'border-primary/20' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <FormatIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                {project.format === 'tv-series' ? 'TV Series' : 'Film'}
              </span>
              <RecencyPulse updatedAt={project.updated_at} />
              {project.pinned && (
                <span className="text-[10px] text-primary font-medium">Pinned</span>
              )}
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
          <div className="flex items-center gap-2 shrink-0">
            {readinessScore != null && (
              <div className="flex flex-col items-center gap-0.5" title="Readiness Score">
                <MiniScoreRing score={readinessScore} />
                <span className="text-[8px] text-muted-foreground">Ready</span>
              </div>
            )}
            {financeReadinessScore != null && (
              <div className="flex flex-col items-center gap-0.5" title="Finance Readiness">
                <MiniScoreRing score={financeReadinessScore} />
                <span className="text-[8px] text-muted-foreground">Finance</span>
              </div>
            )}
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
          </div>
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
