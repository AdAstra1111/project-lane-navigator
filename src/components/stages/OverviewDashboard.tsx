/**
 * Overview Dashboard: Top-level project summary across all stages.
 */

import { motion } from 'framer-motion';
import { Gauge, ArrowRight, Activity, Bot, UsersRound } from 'lucide-react';
import { ProjectReadinessScore } from '@/components/ProjectReadinessScore';
import { TVReadinessScore } from '@/components/tv/TVReadinessScore';
import { ModeReadinessScore } from '@/components/ModeReadinessScore';
import { ScoreSparkline } from '@/components/ScoreSparkline';
import { LaneBadge } from '@/components/LaneBadge';
import { PipelineStageSuggestion } from '@/components/PipelineStageSuggestion';
import { ProjectActivityFeed } from '@/components/ProjectActivityFeed';
import { ProjectCollaboratorsPanel } from '@/components/ProjectCollaboratorsPanel';
import { ProjectCommentsThread } from '@/components/ProjectCommentsThread';
import { ProjectTimeline } from '@/components/ProjectTimeline';
import { ProjectChat } from '@/components/ProjectChat';
import { DecisionJournal } from '@/components/DecisionJournal';
import { LIFECYCLE_STAGES, type LifecycleStage, getStageOrder } from '@/lib/lifecycle-stages';
import { Badge } from '@/components/ui/badge';
import type { Project, MonetisationLane, PipelineStage } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';
import type { StageGates } from '@/lib/pipeline-gates';

interface Props {
  project: Project;
  projectId: string;
  readiness: ReadinessResult | null;
  tvReadiness: any;
  modeReadiness: any;
  isTV: boolean;
  isAlternateMode: boolean;
  scoreHistory: any[];
  nextStageGates: StageGates | null;
  currentUserId: string | null;
  lifecycleStage: LifecycleStage;
  onNavigateToStage: (stage: string) => void;
}

export function OverviewDashboard({
  project, projectId, readiness, tvReadiness, modeReadiness,
  isTV, isAlternateMode, scoreHistory, nextStageGates,
  currentUserId, lifecycleStage, onNavigateToStage,
}: Props) {
  const currentOrder = getStageOrder(lifecycleStage);

  return (
    <div className="space-y-4">
      {/* Readiness Score */}
      {isTV && tvReadiness ? (
        <TVReadinessScore readiness={tvReadiness} />
      ) : isAlternateMode && modeReadiness ? (
        <ModeReadinessScore readiness={modeReadiness} format={project.format} />
      ) : (
        readiness && <ProjectReadinessScore readiness={readiness} />
      )}

      {/* Score Trend Sparklines */}
      {scoreHistory.length >= 2 && (
        <div className="glass-card rounded-xl px-5 py-3 flex flex-wrap gap-6">
          <ScoreSparkline history={scoreHistory} field="readiness_score" label="Readiness Trend" />
          <ScoreSparkline history={scoreHistory} field="finance_readiness_score" label="Finance Trend" />
        </div>
      )}

      {/* Lane + Confidence */}
      {project.assigned_lane && (
        <div className="glass-card rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Primary Lane</p>
            <LaneBadge lane={project.assigned_lane as MonetisationLane} size="lg" />
          </div>
          {project.confidence != null && (
            <div className="flex-1 max-w-xs">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Confidence</span>
                  <span className="font-medium text-foreground">{Math.round(project.confidence * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round(project.confidence * 100)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lifecycle Progress */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Lifecycle Progress</h3>
        </div>
        <div className="flex items-center gap-1">
          {LIFECYCLE_STAGES.map((stage, i) => {
            const isComplete = stage.order < currentOrder;
            const isCurrent = stage.value === lifecycleStage;
            return (
              <button
                key={stage.value}
                onClick={() => onNavigateToStage(stage.value)}
                className="flex-1 group"
              >
                <div className={`h-2 rounded-full transition-colors ${
                  isComplete ? 'bg-emerald-500' : isCurrent ? 'bg-primary' : 'bg-muted'
                }`} />
                <p className={`text-[10px] mt-1 text-center truncate ${
                  isCurrent ? 'text-primary font-medium' : 'text-muted-foreground'
                } group-hover:text-foreground transition-colors`}>
                  {stage.shortLabel}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pipeline Stage Suggestion */}
      {nextStageGates && (
        <PipelineStageSuggestion
          projectId={projectId}
          currentStage={project.pipeline_stage as PipelineStage}
          nextStageGates={nextStageGates}
        />
      )}

      {/* AI Chat */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground">AI Project Chat</h3>
        </div>
        <ProjectChat projectId={projectId} />
      </div>

      {/* Decision Journal */}
      <DecisionJournal projectId={projectId} />

      {/* Team & Activity */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Team & Activity</h3>
        </div>
        <ProjectCollaboratorsPanel projectId={projectId} isOwner={project.user_id === currentUserId} />
        <ProjectCommentsThread projectId={projectId} currentUserId={currentUserId} />
        <ProjectActivityFeed projectId={projectId} />
        <ProjectTimeline projectId={projectId} />
      </div>
    </div>
  );
}
