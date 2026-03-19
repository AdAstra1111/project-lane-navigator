/**
 * DecisionBadge — Shows recommended vs selected state for a visual decision.
 * Reusable across poster style, poster selection, lookbook slots, etc.
 */
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Lock, RotateCcw, Check } from 'lucide-react';

interface DecisionBadgeProps {
  recommended: string | null;
  recommendedReason?: string | null;
  selected: string | null;
  effective: string | null;
  isUserSelected: boolean;
  /** Label for the recommended value */
  recommendedLabel?: string;
  /** Label for the selected value */
  selectedLabel?: string;
  onAcceptRecommendation?: () => void;
  onClearSelection?: () => void;
  compact?: boolean;
  className?: string;
}

export function DecisionBadge({
  recommended,
  recommendedReason,
  selected,
  effective,
  isUserSelected,
  recommendedLabel,
  selectedLabel,
  onAcceptRecommendation,
  onClearSelection,
  compact = false,
  className,
}: DecisionBadgeProps) {
  if (!recommended && !selected) return null;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        {isUserSelected ? (
          <Badge variant="default" className="text-[9px] gap-1 bg-primary/20 text-primary border-primary/30">
            <Lock className="w-2.5 h-2.5" />
            {selectedLabel || selected}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] gap-1 border-amber-500/30 text-amber-400">
            <Sparkles className="w-2.5 h-2.5" />
            {recommendedLabel || recommended}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {/* Recommendation indicator */}
      {recommended && (
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] text-muted-foreground">
            Recommended: <span className="text-foreground font-medium">{recommendedLabel || recommended}</span>
          </span>
          {recommendedReason && (
            <span className="text-[9px] text-muted-foreground/60 max-w-[200px] truncate" title={recommendedReason}>
              — {recommendedReason}
            </span>
          )}
        </div>
      )}

      {/* Selected state */}
      {isUserSelected && (
        <div className="flex items-center gap-1.5">
          <Badge variant="default" className="text-[9px] gap-1">
            <Check className="w-2.5 h-2.5" />
            Selected: {selectedLabel || selected}
          </Badge>
          {onClearSelection && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={onClearSelection}
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset
            </Button>
          )}
        </div>
      )}

      {/* Accept recommendation CTA */}
      {!isUserSelected && recommended && onAcceptRecommendation && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[9px] gap-1 text-amber-400 hover:text-amber-300"
          onClick={onAcceptRecommendation}
        >
          <Check className="w-2.5 h-2.5" />
          Accept
        </Button>
      )}
    </div>
  );
}
