/**
 * PipelineTimeline — Left-rail pipeline progress column for the Creator UI.
 * Shows all stages for the project's format, with live state from usePipelineState.
 */
import { useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle, Pencil, Zap, ZapOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePipelineState } from '@/hooks/usePipelineState';
import { useProjectDocuments } from '@/hooks/useProjects';
import { getLadderForFormat } from '@/lib/stages/registry';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Human-readable labels for each stage
const STAGE_LABELS: Record<string, string> = {
  idea:                   'Idea',
  concept_brief:          'Concept Brief',
  vertical_market_sheet:  'Market Sheet',
  format_rules:           'Format Rules',
  character_bible:        'Character Bible',
  season_arc:             'Season Arc',
  episode_grid:           'Episode Grid',
  vertical_episode_beats: 'Episode Beats',
  season_script:          'Season Script',
  treatment:              'Treatment',
  beat_sheet:             'Beat Sheet',
  market_sheet:           'Market Sheet',
  nec:                    'Narrative Engine',
  project_overview:       'Project Overview',
  market_positioning:     'Market Positioning',
  story_outline:          'Story Outline',
  series_writer:          'Series Writer',
  script:                 'Script',
  feature_script:         'Feature Script',
};

type StageState = 'done' | 'needs-review' | 'generating' | 'waiting' | 'revision';

interface StageInfo {
  key: string;
  label: string;
  state: StageState;
  eta?: string;
}

interface PipelineTimelineProps {
  projectId: string;
  format: string;
  autoRun?: boolean;
  onAutoRunToggle?: (val: boolean) => void;
  onStageClick?: (stage: string) => void;
  activeStage?: string;
}

export function PipelineTimeline({
  projectId,
  format,
  autoRun = false,
  onAutoRunToggle,
  onStageClick,
  activeStage,
}: PipelineTimelineProps) {
  const { pipelineState, isLoading } = usePipelineState(projectId);
  const { documents } = useProjectDocuments(projectId);

  const stages = useMemo<StageInfo[]>(() => {
    const ladder = getLadderForFormat(format) ?? [];
    if (!ladder.length) return [];

    return ladder.map((key) => {
      const completed = pipelineState?.completedStages?.[key];
      const isCurrentlyGenerating = documents?.some(
        (d: any) => d.doc_type === key && d.bg_generating === true
      );

      let state: StageState = 'waiting';
      if (isCurrentlyGenerating) {
        state = 'generating';
      } else if (completed?.exists && completed?.hasApproved) {
        state = 'done';
      } else if (completed?.exists && !completed?.hasApproved) {
        state = 'needs-review';
      }

      return {
        key,
        label: STAGE_LABELS[key] ?? key.replace(/_/g, ' '),
        state,
      };
    });
  }, [pipelineState, documents, format]);

  const completedCount = stages.filter(s => s.state === 'done').length;
  const totalCount = stages.length;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4 animate-pulse">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-6 bg-muted rounded w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full select-none">
      {/* Auto-Run toggle */}
      <div className="px-4 pt-4 pb-3 border-b border-border/20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {autoRun
              ? <Zap className="h-3.5 w-3.5 text-amber-400" />
              : <ZapOff className="h-3.5 w-3.5 text-muted-foreground" />
            }
            <span className={cn(
              "text-xs font-medium",
              autoRun ? "text-amber-400" : "text-muted-foreground"
            )}>
              Auto-Run
            </span>
          </div>
          <Switch
            checked={autoRun}
            onCheckedChange={onAutoRunToggle}
            className="scale-75 origin-right"
          />
        </div>
        {autoRun && (
          <p className="text-[10px] text-amber-400/70 mt-1 leading-tight">
            IFFY is running the pipeline autonomously
          </p>
        )}
      </div>

      {/* Stage list */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {stages.map((stage, idx) => (
          <StageRow
            key={stage.key}
            stage={stage}
            index={idx}
            isActive={activeStage === stage.key}
            isLast={idx === stages.length - 1}
            onClick={() => {
              if (stage.state !== 'waiting') onStageClick?.(stage.key);
            }}
          />
        ))}
      </div>

      {/* Progress footer */}
      <div className="px-4 py-3 border-t border-border/20">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground">Progress</span>
          <span className="text-[10px] text-muted-foreground">{completedCount}/{totalCount}</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-700"
            style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StageRow({
  stage,
  index,
  isActive,
  isLast,
  onClick,
}: {
  stage: StageInfo;
  index: number;
  isActive: boolean;
  isLast: boolean;
  onClick: () => void;
}) {
  const isClickable = stage.state !== 'waiting';

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={!isClickable}
          className={cn(
            "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors group",
            isClickable && "hover:bg-muted/60 cursor-pointer",
            !isClickable && "cursor-default opacity-40",
            isActive && "bg-muted"
          )}
        >
          {/* Connector line + icon */}
          <div className="relative flex flex-col items-center shrink-0 w-4">
            <StageIcon state={stage.state} />
            {!isLast && (
              <div className={cn(
                "absolute top-5 w-px h-3",
                stage.state === 'done' ? "bg-amber-500/50" : "bg-border/40"
              )} />
            )}
          </div>

          {/* Label */}
          <span className={cn(
            "text-xs leading-tight truncate",
            stage.state === 'done' && "text-foreground/70",
            stage.state === 'needs-review' && "text-foreground font-medium",
            stage.state === 'generating' && "text-amber-400",
            stage.state === 'waiting' && "text-muted-foreground",
            isActive && "text-foreground font-medium"
          )}>
            {stage.label}
          </span>

          {/* Status badge */}
          {stage.state === 'needs-review' && (
            <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
          {stage.state === 'generating' && (
            <span className="ml-auto shrink-0 text-[9px] text-amber-400/70">running</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {stage.state === 'done' && 'Approved ✓'}
        {stage.state === 'needs-review' && 'Ready for your review'}
        {stage.state === 'generating' && 'Generating…'}
        {stage.state === 'waiting' && 'Waiting for upstream stages'}
        {stage.state === 'revision' && 'In revision'}
      </TooltipContent>
    </Tooltip>
  );
}

function StageIcon({ state }: { state: StageState }) {
  switch (state) {
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case 'needs-review':
      return <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
    case 'generating':
      return <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />;
    case 'revision':
      return <Pencil className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
    case 'waiting':
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
  }
}
