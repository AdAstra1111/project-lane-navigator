/**
 * Sticky project summary bar — always visible at top of project page.
 * Shows title, production type, lane, readiness, mode toggle, behavior badge, and primary CTA.
 */

import { Gauge, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LaneBadge } from '@/components/LaneBadge';
import { ModeToggle } from '@/components/ModeToggle';
import { PackagingModeSelector } from '@/components/PackagingModeSelector';
import type { Project, MonetisationLane } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';
import { getFormatMeta } from '@/lib/mode-engine';
import type { PackagingMode, PackagingStage } from '@/lib/role-gravity-engine';
import { BEHAVIOR_LABELS, BEHAVIOR_COLORS, type DevelopmentBehavior } from '@/lib/dev-os-config';

interface Props {
  project: Project;
  readiness: ReadinessResult | null;
  onBestAction?: () => void;
}

export function ProjectSummaryBar({ project, readiness, onBestAction }: Props) {
  const formatMeta = getFormatMeta(project.format);
  const behavior = (project.development_behavior as DevelopmentBehavior) || 'market';

  return (
    <div className="sticky top-0 z-30 bg-background/70 backdrop-blur-2xl border-b border-border/20 -mx-4 px-4 py-2.5 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Title + Format */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          {formatMeta && (
            <formatMeta.icon className={`h-4 w-4 shrink-0 ${formatMeta.color}`} />
          )}
          <h2 className="font-display font-bold text-foreground text-lg leading-tight line-clamp-2">
            {project.title}
          </h2>
        </div>

        {/* Lane chip */}
        {project.assigned_lane && (
          <LaneBadge lane={project.assigned_lane as MonetisationLane} size="sm" />
        )}

        {/* Behavior badge */}
        <Badge variant="outline" className={`text-[10px] ${BEHAVIOR_COLORS[behavior]}`}>
          {BEHAVIOR_LABELS[behavior]}
        </Badge>

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

        {/* Packaging Target + Stage */}
        <PackagingModeSelector
          projectId={project.id}
          currentMode={((project as any).packaging_mode as PackagingMode) || 'streamer_prestige'}
          currentStage={((project as any).packaging_stage as PackagingStage) || 'early_dev'}
          compact
        />

        {/* Mode toggle */}
        <ModeToggle />
      </div>
    </div>
  );
}
