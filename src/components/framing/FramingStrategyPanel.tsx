/**
 * FramingStrategyPanel — UI for viewing, comparing, and selecting framing strategies.
 * Embeddable in Poster Engine, Look Book, or standalone.
 */
import { useState } from 'react';
import {
  Sparkles, CheckCircle2, Loader2, ChevronDown, ChevronUp,
  Shield, Zap, Target, Flame, FlaskConical, Drama,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  useFramingStrategies,
  useGenerateFraming,
  useSelectFraming,
} from '@/hooks/useFramingStrategies';
import {
  STRATEGY_TYPE_META,
  RISK_LEVEL_META,
  AUDIENCE_META,
  type ContentType,
  type FramingStrategy,
  type StrategyType,
} from '@/lib/framing/types';

const STRATEGY_ICONS: Record<StrategyType, typeof Shield> = {
  market_aligned: Shield,
  prestige: Target,
  commercial: Zap,
  subversive: Flame,
  experimental: FlaskConical,
  parody: Drama,
};

interface FramingStrategyPanelProps {
  projectId: string;
  contentType?: ContentType;
  onStrategySelect?: (strategy: FramingStrategy) => void;
  compact?: boolean;
  className?: string;
}

export function FramingStrategyPanel({
  projectId,
  contentType = 'poster',
  onStrategySelect,
  compact = false,
  className,
}: FramingStrategyPanelProps) {
  const { data: strategies = [], isLoading } = useFramingStrategies(projectId, contentType);
  const generateMut = useGenerateFraming(projectId);
  const selectMut = useSelectFraming(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleGenerate = () => generateMut.mutate(contentType);

  const handleSelect = (strategy: FramingStrategy) => {
    selectMut.mutate({ strategyId: strategy.id, contentType });
    onStrategySelect?.(strategy);
  };

  // Empty state
  if (!isLoading && strategies.length === 0) {
    return (
      <div className={cn('flex flex-col items-center gap-4 py-8', className)}>
        <div className="text-center max-w-sm">
          <h3 className="text-sm font-medium text-foreground mb-1">Creative Framing</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Generate distinct creative strategies for how this project should be presented.
            Each strategy offers a different angle while staying faithful to the project.
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={generateMut.isPending}
          size="sm"
          className="gap-1.5"
        >
          {generateMut.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" /> Generate Strategies</>
          )}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">Creative Framing</h3>
          <p className="text-xs text-muted-foreground">{strategies.length} strategies · {contentType}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-xs"
          onClick={handleGenerate}
          disabled={generateMut.isPending}
        >
          {generateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>

      {/* Strategy cards */}
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1')}>
        {strategies.map((s) => {
          const meta = STRATEGY_TYPE_META[s.strategyType] || STRATEGY_TYPE_META.market_aligned;
          const risk = RISK_LEVEL_META[s.riskLevel] || RISK_LEVEL_META.safe;
          const Icon = STRATEGY_ICONS[s.strategyType] || Shield;
          const isExpanded = expandedId === s.id;

          return (
            <Collapsible key={s.id} open={isExpanded} onOpenChange={() => setExpandedId(isExpanded ? null : s.id)}>
              <Card
                className={cn(
                  'transition-all duration-200 cursor-pointer',
                  s.isSelected
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border/50 hover:border-border',
                )}
              >
                <CollapsibleTrigger asChild>
                  <CardContent className="p-3 flex items-start gap-3">
                    {/* Icon */}
                    <div className={cn('mt-0.5 shrink-0', meta.color)}>
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground">{meta.label}</span>
                        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', risk.color)}>
                          {risk.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                          {AUDIENCE_META[s.audienceTarget]}
                        </Badge>
                        {s.isSelected && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{s.intent}</p>
                    </div>

                    {/* Expand indicator */}
                    <div className="shrink-0 text-muted-foreground/50 mt-0.5">
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </div>
                  </CardContent>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/30">
                    {/* Creative angle */}
                    <div className="pt-3">
                      <span className="text-[10px] tracking-wider uppercase text-muted-foreground/60">Creative Angle</span>
                      <p className="text-xs text-foreground/90 mt-0.5">{s.creativeAngle}</p>
                    </div>

                    {/* Visual language */}
                    <div>
                      <span className="text-[10px] tracking-wider uppercase text-muted-foreground/60">Visual Language</span>
                      <p className="text-xs text-foreground/90 mt-0.5">{s.visualLanguage}</p>
                    </div>

                    {/* Trope handling */}
                    <div>
                      <span className="text-[10px] tracking-wider uppercase text-muted-foreground/60">Trope Handling</span>
                      <Badge variant="outline" className="text-[10px] ml-2 capitalize">{s.tropeHandling}</Badge>
                    </div>

                    {/* Full brief */}
                    <div>
                      <span className="text-[10px] tracking-wider uppercase text-muted-foreground/60">Full Brief</span>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.fullBrief}</p>
                    </div>

                    {/* Canon lock */}
                    <div>
                      <span className="text-[10px] tracking-wider uppercase text-muted-foreground/60">Canon Lock</span>
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5">{s.canonLockSummary}</p>
                    </div>

                    {/* Select button */}
                    {!s.isSelected && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5 text-xs mt-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(s);
                        }}
                        disabled={selectMut.isPending}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Use This Strategy
                      </Button>
                    )}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
