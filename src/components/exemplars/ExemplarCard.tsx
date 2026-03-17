import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { Star, GitCompare, Search, Eye, Award, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

function scoreColor(score: number) {
  if (score >= 98) return 'text-green-400';
  if (score >= 95) return 'text-emerald-400';
  return 'text-primary';
}

interface Props {
  idea: PitchIdea & { _similarityScore?: number };
  onCompare?: (idea: PitchIdea) => void;
  onFindSimilar?: (idea: PitchIdea) => void;
  onOpen?: (idea: PitchIdea) => void;
  showSimilarity?: boolean;
}

export function ExemplarCard({ idea, onCompare, onFindSimilar, onOpen, showSimilarity }: Props) {
  const laneLabel = LANE_LABELS[idea.recommended_lane as MonetisationLane] || idea.recommended_lane;
  const ci = Number(idea.score_total) || 0;
  const feasibility = Number(idea.score_feasibility) || 0;
  const isApproved = (idea as any).is_exemplar === true;
  const isLearningPool = (idea as any).learning_pool_eligible === true;
  const strengthTags: string[] = (idea as any).strength_tags || [];

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 transition-colors group">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isApproved && (
                <Award className="h-4 w-4 text-primary shrink-0" title="Manual Exemplar" />
              )}
              {isLearningPool && (
                <GraduationCap className="h-4 w-4 text-emerald-400 shrink-0" title="Learning Pool" />
              )}
              <h3 className="font-semibold text-foreground truncate text-sm leading-tight">
                {idea.title}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{idea.logline}</p>
          </div>
          {/* CI prominence */}
          <div className="text-right shrink-0">
            <span className={cn('text-2xl font-bold tabular-nums', scoreColor(ci))}>
              {ci.toFixed(0)}
            </span>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CI</p>
          </div>
        </div>

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-[10px]">{idea.production_type}</Badge>
          <Badge variant="outline" className="text-[10px]">{laneLabel}</Badge>
          <Badge variant="outline" className="text-[10px]">{idea.genre}</Badge>
          <Badge variant="outline" className="text-[10px]">{idea.budget_band}</Badge>
          {idea.source_engine_key && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
              {idea.source_engine_key}
            </Badge>
          )}
          {showSimilarity && (idea as any)._similarityScore != null && (
            <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">
              {(idea as any)._similarityScore}% match
            </Badge>
          )}
          {isApproved && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Manual Exemplar</Badge>
          )}
          {isLearningPool && (
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">Learning Pool</Badge>
          )}
        </div>

        {/* Score breakdown */}
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>Market: <span className="font-medium text-foreground">{Number(idea.score_market_heat || 0).toFixed(0)}</span></span>
          <span>Feasibility: <span className="font-medium text-foreground">{feasibility.toFixed(0)}</span></span>
          <span>Lane Fit: <span className="font-medium text-foreground">{Number(idea.score_lane_fit || 0).toFixed(0)}</span></span>
        </div>

        {/* Strength tags */}
        {strengthTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {strengthTags.map(tag => (
              <Badge key={tag} variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Why strong summary */}
        {idea.why_us && (
          <p className="text-[11px] text-muted-foreground italic line-clamp-2 border-l-2 border-primary/20 pl-2">
            {idea.why_us}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
          {onOpen && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onOpen(idea)}>
              <Eye className="h-3 w-3" /> Open
            </Button>
          )}
          {onCompare && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onCompare(idea)}>
              <GitCompare className="h-3 w-3" /> Compare
            </Button>
          )}
          {onFindSimilar && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onFindSimilar(idea)}>
              <Search className="h-3 w-3" /> Similar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
