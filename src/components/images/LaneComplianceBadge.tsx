/**
 * LaneComplianceBadge — Shows lane compliance status for an image.
 */
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { validateLaneCompliance } from '@/lib/images/prestigeStyleRegistry';

interface LaneComplianceBadgeProps {
  image: { width?: number | null; height?: number | null; shot_type?: string | null };
  laneKey: string;
  className?: string;
}

export function LaneComplianceBadge({ image, laneKey, className }: LaneComplianceBadgeProps) {
  const { score, violations } = validateLaneCompliance(image, laneKey);

  if (score >= 100) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('text-[10px] gap-1 text-emerald-600 border-emerald-600/30', className)}>
            <ShieldCheck className="h-3 w-3" />
            Compliant
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Lane grammar fully compliant</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('text-[10px] gap-1 text-amber-600 border-amber-600/30', className)}>
          <ShieldAlert className="h-3 w-3" />
          {score}%
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[250px]">
        <p className="font-medium text-xs mb-1">Lane violations:</p>
        <ul className="text-[10px] space-y-0.5">
          {violations.map((v, i) => (
            <li key={i}>• {v}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
