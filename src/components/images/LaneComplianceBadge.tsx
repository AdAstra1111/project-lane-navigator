/**
 * LaneComplianceBadge — Shows lane compliance status for an image.
 * Uses weighted scoring: aspect ratio (40), orientation (20), forbidden framing (25), preferred framing (15).
 */
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { validateLaneCompliance } from '@/lib/images/prestigeStyleRegistry';

interface LaneComplianceBadgeProps {
  image: { width?: number | null; height?: number | null; shot_type?: string | null };
  laneKey: string;
  className?: string;
}

export function LaneComplianceBadge({ image, laneKey, className }: LaneComplianceBadgeProps) {
  const { score, violations, label } = validateLaneCompliance(image, laneKey);

  if (score >= 90) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('text-[10px] gap-1 text-primary/80 border-primary/30', className)}>
            <ShieldCheck className="h-3 w-3" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Lane grammar fully compliant ({score}/100)</TooltipContent>
      </Tooltip>
    );
  }

  if (score >= 60) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('text-[10px] gap-1 text-accent-foreground border-accent/50', className)}>
            <ShieldAlert className="h-3 w-3" />
            {label} ({score})
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[250px]">
          <p className="font-medium text-xs mb-1">Partial compliance:</p>
          <ul className="text-[10px] space-y-0.5">
            {violations.map((v, i) => <li key={i}>• {v}</li>)}
          </ul>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('text-[10px] gap-1 text-destructive border-destructive/30', className)}>
          <ShieldX className="h-3 w-3" />
          {label} ({score})
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[250px]">
        <p className="font-medium text-xs mb-1">Non-compliant:</p>
        <ul className="text-[10px] space-y-0.5">
          {violations.map((v, i) => <li key={i}>• {v}</li>)}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
