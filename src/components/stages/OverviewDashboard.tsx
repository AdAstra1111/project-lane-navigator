/**
 * Overview Dashboard: Top-level project summary across all stages.
 */

import { motion } from 'framer-motion';
import { Gauge, ArrowRight, Activity, UsersRound } from 'lucide-react';
import { useUIMode } from '@/hooks/useUIMode';
import { getEffectiveMode } from '@/lib/visibility';
import { ViabilityBreakdownPanel } from '@/components/ViabilityBreakdownPanel';
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
import { BudgetAssumptionsPanel } from '@/components/BudgetAssumptionsPanel';
import { PackagingPipelinePanel } from '@/components/PackagingPipelinePanel';
import { StageGatesPanel } from '@/components/StageGatesPanel';
import { LIFECYCLE_STAGES, type LifecycleStage, getStageOrder, getStageMeta } from '@/lib/lifecycle-stages';
import { Badge } from '@/components/ui/badge';
import type { Project, MonetisationLane, PipelineStage } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';
import type { StageGates } from '@/lib/pipeline-gates';
import type { MasterViabilityResult } from '@/lib/master-viability';

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
  masterViability: MasterViabilityResult | null;
}

export function OverviewDashboard({
  project, projectId, readiness, tvReadiness, modeReadiness,
  isTV, isAlternateMode, scoreHistory, nextStageGates,
  currentUserId, lifecycleStage, onNavigateToStage, masterViability,
}: Props) {
  const currentOrder = getStageOrder(lifecycleStage);
  const { mode: userMode } = useUIMode();
  const effectiveMode = getEffectiveMode(userMode, (project as any).ui_mode_override);
  const isAdvanced = effectiveMode === 'advanced';

  return (
    <div className="space-y-4">
      {/* Master Viability Score */}
      {masterViability && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold text-foreground text-lg">Project Viability</h3>
            <Badge className={`ml-auto text-xs ${
              masterViability.score >= 80 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
              masterViability.score >= 60 ? 'bg-primary/15 text-primary border-primary/30' :
              masterViability.score >= 40 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
              'bg-red-500/15 text-red-400 border-red-500/30'
            }`}>{masterViability.label}</Badge>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-display font-bold text-foreground">{masterViability.score}</div>
            <div className="flex-1 grid grid-cols-3 gap-2">
              {LIFECYCLE_STAGES.map((stage) => {
                const score = masterViability.stageScores[stage.value];
                const meta = getStageMeta(stage.value);
                return (
                  <button
                    key={stage.value}
                    onClick={() => onNavigateToStage(stage.value)}
                    className="text-left group"
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <meta.icon className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="text-[10px] text-muted-foreground truncate">{stage.shortLabel}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : score >= 25 ? 'bg-amber-600' : 'bg-red-500'
                        }`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{score}%</span>
                  </button>
                );
              })}
            </div>
          </div>
          {masterViability.components && (
            <ViabilityBreakdownPanel components={masterViability.components} />
          )}
        </div>
      )}

      {/* Legacy Readiness Score */}
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
                  <span className="font-medium text-foreground">{Math.round(project.confidence > 1 ? project.confidence : project.confidence * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.round(project.confidence > 1 ? project.confidence : project.confidence * 100))}%` }}
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

      {/* Stage Gates (Advanced) */}
      {isAdvanced && <StageGatesPanel projectId={projectId} />}

      {/* Budget Assumptions (Advanced) */}
      {isAdvanced && <BudgetAssumptionsPanel projectId={projectId} />}

      {/* Packaging Pipeline (Advanced) */}
      {isAdvanced && <PackagingPipelinePanel projectId={projectId} />}

      {/* AI Chat */}
      <ProjectChat projectId={projectId} />

      {/* Decision Journal (Advanced) */}
      {isAdvanced && <DecisionJournal projectId={projectId} />}

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
