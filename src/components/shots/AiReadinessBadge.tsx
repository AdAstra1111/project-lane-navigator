/**
 * AiReadinessBadge — Shows AI readiness tier with confidence and hover details.
 */
import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Sparkles, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface AiReadinessBadgeProps {
  tier: string | null;
  confidence: number | null;
  maxQuality: string | null;
  blockingConstraints?: string[];
  requiredAssets?: string[];
  legalRiskFlags?: string[];
  costBand?: string | null;
  compact?: boolean;
}

const tierColors: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  B: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  C: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  D: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const tierIcons: Record<string, React.ReactNode> = {
  A: <CheckCircle2 className="h-3 w-3" />,
  B: <Sparkles className="h-3 w-3" />,
  C: <AlertTriangle className="h-3 w-3" />,
  D: <XCircle className="h-3 w-3" />,
};

export function AiReadinessBadge({
  tier,
  confidence,
  maxQuality,
  blockingConstraints = [],
  requiredAssets = [],
  legalRiskFlags = [],
  costBand,
  compact = false,
}: AiReadinessBadgeProps) {
  if (!tier) return null;

  const colorClass = tierColors[tier] || tierColors.D;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className={`${colorClass} text-[10px] gap-1 cursor-help ${compact ? 'px-1.5 py-0' : ''}`}
        >
          {tierIcons[tier]}
          {tier}
          {!compact && confidence != null && (
            <span className="opacity-70">{confidence}%</span>
          )}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 text-xs" side="top">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">AI Tier {tier}</span>
            <span className="text-muted-foreground">{confidence}% confidence</span>
          </div>

          {maxQuality && (
            <div>
              <span className="text-muted-foreground">Max quality: </span>
              <span className="font-medium">{maxQuality}</span>
            </div>
          )}

          {costBand && (
            <div>
              <span className="text-muted-foreground">Cost band: </span>
              <span className="font-medium capitalize">{costBand}</span>
            </div>
          )}

          {blockingConstraints.length > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-1">Constraints:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {blockingConstraints.slice(0, 3).map((c, i) => (
                  <li key={i} className="text-muted-foreground">{c}</li>
                ))}
              </ul>
            </div>
          )}

          {requiredAssets.length > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-1">Missing assets:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {requiredAssets.slice(0, 3).map((a, i) => (
                  <li key={i} className="text-amber-400">{a}</li>
                ))}
              </ul>
            </div>
          )}

          {legalRiskFlags.length > 0 && (
            <div>
              <p className="text-red-400 font-medium mb-1">Legal risks:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {legalRiskFlags.map((f, i) => (
                  <li key={i} className="text-red-400">{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
