/**
 * Learning Bias Indicator — shows active trailer bias + reset control
 */
import { Brain, RotateCcw, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useProjectBias, useAssemblerMutations } from '@/lib/trailerPipeline/assemblerHooks';

interface LearningBiasIndicatorProps {
  projectId: string;
}

export function LearningBiasIndicator({ projectId }: LearningBiasIndicatorProps) {
  const { data: biasData } = useProjectBias(projectId);
  const { computeProjectBias, resetProjectBias } = useAssemblerMutations(projectId);

  const bias = biasData?.bias;
  if (!bias) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-[10px] gap-1 text-muted-foreground h-7"
              onClick={() => computeProjectBias.mutate()}
              disabled={computeProjectBias.isPending}
            >
              <Brain className="h-3 w-3" />
              {computeProjectBias.isPending ? 'Computing…' : 'Compute Bias'}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs max-w-[200px]">
            Analyze your selections and approved cuts to learn preferences
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-[9px] gap-1 cursor-help">
              <Brain className="h-3 w-3 text-primary" />
              Learning Active
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="text-xs max-w-[260px] space-y-1">
            <p className="font-medium">Derived from {bias.signal_count} signals</p>
            {bias.preferred_profile && <p>Profile: <span className="font-mono">{bias.preferred_profile}</span></p>}
            {bias.preferred_provider && <p>Provider: <span className="font-mono">{bias.preferred_provider}</span></p>}
            <p>Motion: +{bias.motion_bias} | Silence: {bias.silence_bias}</p>
            {bias.pacing_bias && <p>Pacing: {bias.pacing_bias}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {bias.motion_bias > 0 && (
        <Badge variant="outline" className="text-[9px]">
          motion +{bias.motion_bias}
        </Badge>
      )}

      {bias.pacing_bias && (
        <Badge variant="outline" className="text-[9px]">
          {bias.pacing_bias}
        </Badge>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => computeProjectBias.mutate()}
              disabled={computeProjectBias.isPending}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Recompute bias</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-destructive"
              onClick={() => resetProjectBias.mutate()}
              disabled={resetProjectBias.isPending}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Reset learning bias</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}