/**
 * EpisodeHeatmap — Compact 1..N grid showing episode status colors.
 */
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface EpisodeStatus {
  episode_number: number;
  status: string;
  is_locked: boolean;
  is_template: boolean;
  has_conflict: boolean;
  compliance_score?: number;
}

interface Props {
  episodes: EpisodeStatus[];
  selectedEpisode?: number;
  onSelectEpisode: (epNum: number) => void;
}

function getColor(ep: EpisodeStatus): string {
  if (ep.has_conflict) return 'bg-red-500';
  if (ep.is_template) return 'bg-violet-500';
  if (ep.is_locked) return 'bg-primary';
  if (ep.status === 'complete') return 'bg-emerald-500';
  if (ep.status === 'generating') return 'bg-amber-500 animate-pulse';
  if (ep.status === 'needs_revision') return 'bg-orange-500';
  if (ep.status === 'error' || ep.status === 'invalidated') return 'bg-red-500';
  return 'bg-muted/30';
}

function getLabel(ep: EpisodeStatus): string {
  if (ep.has_conflict) return 'Conflict';
  if (ep.is_template) return 'Template';
  if (ep.is_locked) return 'Locked';
  return ep.status.replace(/_/g, ' ');
}

export function EpisodeHeatmap({ episodes, selectedEpisode, onSelectEpisode }: Props) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] text-muted-foreground uppercase font-medium">Episode Roadmap</span>
      <div className="flex flex-wrap gap-1">
        <TooltipProvider>
          {episodes.map(ep => (
            <Tooltip key={ep.episode_number}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectEpisode(ep.episode_number)}
                  className={`w-6 h-6 rounded text-[9px] font-mono font-medium transition-all ${getColor(ep)} ${
                    selectedEpisode === ep.episode_number
                      ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                      : 'hover:ring-1 hover:ring-border'
                  } ${ep.status === 'pending' ? 'text-muted-foreground' : 'text-white'}`}
                >
                  {ep.episode_number}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                EP {ep.episode_number}: {getLabel(ep)}
                {ep.compliance_score !== undefined && ` • ${ep.compliance_score}%`}
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
    </div>
  );
}
