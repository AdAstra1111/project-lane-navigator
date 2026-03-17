/**
 * StageIdentityBadge — Surfaces stage identity violations from meta_json.stage_identity.
 * Mirrors CanonDriftBadge pattern.
 */

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface StageIdentityBadgeProps {
  metaJson?: Record<string, any> | null;
}

export function StageIdentityBadge({ metaJson }: StageIdentityBadgeProps) {
  if (!metaJson?.stage_identity) return null;
  const si = metaJson.stage_identity;
  if (typeof si.passed !== 'boolean') return null;
  if (si.passed) return null;

  const label = si.violation === 'IDEA_STAGE_SHAPE_VIOLATION'
    ? 'Screenplay in Idea'
    : si.violation === 'IDEA_TOO_EXPANDED'
    ? 'Idea Over-Expanded'
    : si.violation === 'CONCEPT_BRIEF_STAGE_SHAPE_VIOLATION'
    ? 'Screenplay in Brief'
    : 'Stage Identity Issue';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="gap-1 text-[10px] px-1.5 py-0.5 cursor-help">
            <AlertTriangle className="h-3 w-3" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
          <p className="font-semibold">{si.violation}</p>
          {si.violations?.length > 0 && (
            <ul className="list-disc pl-3">
              {si.violations.map((v: string, i: number) => <li key={i}>{v}</li>)}
            </ul>
          )}
          {si.repair_hint && <p className="text-muted-foreground italic">{si.repair_hint}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
