/**
 * Sticky project summary bar — always visible at top of project page.
 * Shows title, production type, lane, readiness, mode toggle, and primary CTA.
 */

import { Gauge, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LaneBadge } from '@/components/LaneBadge';
import { ModeToggle } from '@/components/ModeToggle';
import type { Project, MonetisationLane } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';
import { getFormatMeta } from '@/lib/mode-engine';

interface Props {
  project: Project;
  readiness: ReadinessResult | null;
  onBestAction?: () => void;
}

export function ProjectSummaryBar({ project, readiness, onBestAction }: Props) {
  const formatMeta = getFormatMeta(project.format);

  return (
    <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border/40 -mx-4 px-4 py-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Title + Format */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {formatMeta && (
            <formatMeta.icon className={`h-4 w-4 shrink-0 ${formatMeta.color}`} />
          )}
          <h2 className="font-display font-bold text-foreground text-lg truncate">
            {project.title}
          </h2>
        </div>

        {/* Lane chip */}
        {project.assigned_lane && (
          <LaneBadge lane={project.assigned_lane as MonetisationLane} size="sm" />
        )}

        {/* Readiness chip */}
        {readiness && (
          <Badge
            variant="outline"
            className={`font-mono text-xs ${
              readiness.score >= 75
                ? 'border-emerald-500/40 text-emerald-400'
                : readiness.score >= 50
                ? 'border-amber-500/40 text-amber-400'
                : 'border-muted text-muted-foreground'
            }`}
          >
            <Gauge className="h-3 w-3 mr-1" />
            {readiness.score}%
          </Badge>
        )}

        {/* Primary CTA */}
        {readiness?.bestNextStep && (
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 text-xs hidden sm:inline-flex"
            onClick={onBestAction}
          >
            <ArrowRight className="h-3 w-3" />
            Improve Readiness
          </Button>
        )}

        {/* Mode toggle */}
        <ModeToggle />
      </div>
    </div>
  );
}
