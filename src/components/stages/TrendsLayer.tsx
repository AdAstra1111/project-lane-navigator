/**
 * Trends Engine: Stage-aware persistent layer.
 * Shows trend intelligence contextualised to the project's current lifecycle stage.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Info, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TrendIntelligencePanel } from '@/components/TrendIntelligencePanel';
import { ProjectRelevantSignals } from '@/components/ProjectRelevantSignals';
import { getStageTrendContext, isTrendStale } from '@/lib/stage-trend-mapping';
import { getStageMeta, type LifecycleStage } from '@/lib/lifecycle-stages';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

interface Props {
  project: Project;
  projectId: string;
  lifecycleStage?: LifecycleStage;
}

const LAYER_COLORS: Record<string, string> = {
  market: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  narrative: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  talent: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  platform: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
};

export function TrendsLayer({ project, projectId, lifecycleStage = 'development' }: Props) {
  const ctx = useMemo(() => getStageTrendContext(lifecycleStage), [lifecycleStage]);
  const stageMeta = getStageMeta(lifecycleStage);

  return (
    <div className="space-y-4">
      {/* Stage-Aware Context Banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl p-4"
      >
        <div className="flex items-center gap-2 mb-2">
          <Info className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">{ctx.label}</h4>
          <Badge className={cn('text-[9px] px-1.5 py-0 border', stageMeta.color)}>
            {stageMeta.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{ctx.description}</p>

        {/* Layer Priority Indicators */}
        <div className="flex flex-wrap gap-1.5">
          {ctx.primaryLayers.map(layer => (
            <Badge key={layer} className={cn('text-[9px] px-2 py-0.5 border font-medium', LAYER_COLORS[layer] || 'bg-muted text-muted-foreground border-border')}>
              ★ {layer.charAt(0).toUpperCase() + layer.slice(1)}
            </Badge>
          ))}
          {ctx.secondaryLayers.map(layer => (
            <Badge key={layer} className="text-[9px] px-2 py-0.5 border bg-muted/50 text-muted-foreground border-border">
              {layer.charAt(0).toUpperCase() + layer.slice(1)}
            </Badge>
          ))}
        </div>

        {/* Staleness threshold note */}
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Data older than {ctx.stalenessThresholdDays} days is flagged as stale for this stage</span>
        </div>
      </motion.div>

      <TrendIntelligencePanel
        projectId={projectId}
        format={project.format}
        budgetRange={project.budget_range}
        primaryTerritory={(project as any).primary_territory || ''}
        assignedLane={project.assigned_lane}
      />
      <ProjectRelevantSignals project={project} />
    </div>
  );
}
