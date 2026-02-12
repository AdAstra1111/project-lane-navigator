/**
 * Post-Production Stage: Creative lock and delivery readiness.
 * Currently a structured placeholder — full implementation in Phase 7.
 */

import { Film, Clock, CheckCircle2, Palette } from 'lucide-react';
import { DeliveryIntelligencePanel } from '@/components/DeliveryIntelligencePanel';
import { StageReadinessScore } from '@/components/StageReadinessScore';
import type { StageReadinessResult } from '@/lib/stage-readiness';

interface Props {
  projectId: string;
  stageReadiness: StageReadinessResult | null;
}

export function PostProductionStage({ projectId, stageReadiness }: Props) {
  return (
    <div className="space-y-4">
      {stageReadiness && <StageReadinessScore readiness={stageReadiness} />}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <Film className="h-5 w-5 text-violet-400" />
          <h3 className="font-display font-semibold text-foreground text-lg">Post-Production</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Track edit versions, VFX milestones, music licensing, and delivery readiness.
        </p>
      </div>

      <DeliveryIntelligencePanel projectId={projectId} />

      {/* Placeholder panels */}
      <div className="glass-card rounded-xl p-5 border border-dashed border-muted-foreground/20">
        <div className="flex items-center gap-2 mb-2">
          <Palette className="h-4 w-4 text-violet-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">Edit Version Tracker</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Track cut versions, screening feedback scores, and version-to-version impact deltas. Coming soon.
        </p>
      </div>

      <div className="glass-card rounded-xl p-5 border border-dashed border-muted-foreground/20">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-4 w-4 text-amber-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">VFX & Music Milestones</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          VFX shot tracking, vendor management, and music licensing status. Coming soon.
        </p>
      </div>

      <div className="glass-card rounded-xl p-5 border border-dashed border-muted-foreground/20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">Post Readiness Score</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Composite score measuring milestone completion, budget adherence, and delivery materials readiness. Coming soon.
        </p>
      </div>
    </div>
  );
}
