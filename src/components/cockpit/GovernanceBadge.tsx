import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield } from 'lucide-react';

interface Props {
  score: number | null;
  protectedPathsCount?: number;
  requireApproval?: boolean;
  riskThreshold?: number;
  topRiskyPaths?: Array<{ path: string; weight: number }>;
}

function scoreVariant(score: number | null): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (score === null) return 'outline';
  if (score >= 80) return 'default';
  if (score >= 60) return 'secondary';
  if (score >= 40) return 'outline';
  return 'destructive';
}

export function GovernanceBadge({ score, protectedPathsCount, requireApproval, riskThreshold, topRiskyPaths }: Props) {
  const variant = scoreVariant(score);
  const label = score !== null ? `Gov: ${score}` : 'Gov: —';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={variant} className="text-[10px] cursor-default gap-1">
            <Shield className="h-3 w-3" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1.5 text-xs" side="bottom">
          <div className="font-medium">Governance Confidence: {score ?? '—'}/100</div>
          {protectedPathsCount !== undefined && (
            <div className="text-muted-foreground">Protected paths: {protectedPathsCount}</div>
          )}
          {requireApproval !== undefined && (
            <div className="text-muted-foreground">
              Require approval: {requireApproval ? 'Yes' : 'No'}
            </div>
          )}
          {riskThreshold !== undefined && (
            <div className="text-muted-foreground">Risk threshold: {riskThreshold}</div>
          )}
          {topRiskyPaths && topRiskyPaths.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Top risky paths:</div>
              {topRiskyPaths.slice(0, 3).map(p => (
                <div key={p.path} className="text-muted-foreground font-mono text-[10px]">
                  {p.path} (w:{p.weight})
                </div>
              ))}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
