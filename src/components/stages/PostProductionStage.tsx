/**
 * Post-Production Stage: Creative lock and delivery readiness.
 * Contains: Milestones, edit versions, VFX shots, delivery intelligence, readiness score.
 */

import { Film } from 'lucide-react';
import { DeliveryIntelligencePanel } from '@/components/DeliveryIntelligencePanel';
import { PostProductionIntelligencePanel } from '@/components/PostProductionIntelligencePanel';
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

      <PostProductionIntelligencePanel projectId={projectId} />
      <DeliveryIntelligencePanel projectId={projectId} />
    </div>
  );
}
