import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { useToggleExemplar } from '@/hooks/useExemplarIdeas';
import { GitCompare, Search, Star, StarOff, Award } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  idea: PitchIdea | null;
  onCompare?: (idea: PitchIdea) => void;
  onFindSimilar?: (idea: PitchIdea) => void;
}

export function ExemplarDetailDrawer({ open, onOpenChange, idea, onCompare, onFindSimilar }: Props) {
  const toggleMutation = useToggleExemplar();
  if (!idea) return null;

  const laneLabel = LANE_LABELS[idea.recommended_lane as MonetisationLane] || idea.recommended_lane;
  const ci = Number(idea.score_total) || 0;
  const isApproved = (idea as any).is_exemplar === true;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader>
          <div className="flex items-center gap-2">
            {isApproved && <Award className="h-5 w-5 text-primary" />}
            <SheetTitle className="text-lg">{idea.title}</SheetTitle>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-8">
            {/* CI + scores */}
            <div className="flex items-center gap-4">
              <div className="text-center">
                <span className={cn('text-3xl font-bold tabular-nums', ci >= 98 ? 'text-green-400' : 'text-primary')}>{ci.toFixed(0)}</span>
                <p className="text-[10px] text-muted-foreground uppercase">CI Score</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Market: <span className="font-medium text-foreground">{Number(idea.score_market_heat || 0).toFixed(0)}</span></span>
                <span>Feasibility: <span className="font-medium text-foreground">{Number(idea.score_feasibility || 0).toFixed(0)}</span></span>
                <span>Lane Fit: <span className="font-medium text-foreground">{Number(idea.score_lane_fit || 0).toFixed(0)}</span></span>
                <span>Saturation: <span className="font-medium text-foreground">{Number(idea.score_saturation_risk || 0).toFixed(0)}</span></span>
                <span>Company: <span className="font-medium text-foreground">{Number(idea.score_company_fit || 0).toFixed(0)}</span></span>
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-xs">{idea.production_type}</Badge>
              <Badge variant="outline" className="text-xs">{laneLabel}</Badge>
              <Badge variant="outline" className="text-xs">{idea.genre}</Badge>
              <Badge variant="outline" className="text-xs">{idea.budget_band}</Badge>
              {idea.source_engine_key && (
                <Badge variant="outline" className="text-xs border-primary/30 text-primary">{idea.source_engine_key}</Badge>
              )}
              <Badge variant="outline" className="text-xs">{idea.platform_target}</Badge>
              <Badge variant="outline" className="text-xs">{idea.region}</Badge>
              <Badge variant={idea.risk_level === 'high' ? 'destructive' : 'secondary'} className="text-xs">Risk: {idea.risk_level}</Badge>
            </div>

            {/* Logline */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Logline</h4>
              <p className="text-sm text-foreground leading-relaxed">{idea.logline}</p>
            </div>

            {/* One-page pitch */}
            {idea.one_page_pitch && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Pitch</h4>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{idea.one_page_pitch}</p>
              </div>
            )}

            {/* Comps */}
            {idea.comps?.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Comparables</h4>
                <div className="flex flex-wrap gap-1.5">
                  {idea.comps.map(c => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                </div>
              </div>
            )}

            {/* Why strong */}
            {idea.why_us && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Why Strong</h4>
                <p className="text-sm text-muted-foreground italic">{idea.why_us}</p>
              </div>
            )}

            {/* Strength tags */}
            {((idea as any).strength_tags || []).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Strengths</h4>
                <div className="flex flex-wrap gap-1">
                  {((idea as any).strength_tags as string[]).map(t => (
                    <Badge key={t} variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
              {onCompare && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onCompare(idea)}>
                  <GitCompare className="h-3.5 w-3.5" /> Compare
                </Button>
              )}
              {onFindSimilar && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onFindSimilar(idea)}>
                  <Search className="h-3.5 w-3.5" /> Find Similar
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => toggleMutation.mutate({ id: idea.id, is_exemplar: !isApproved })}
                disabled={toggleMutation.isPending}
              >
                {isApproved ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
                {isApproved ? 'Remove Exemplar' : 'Mark Exemplar'}
              </Button>
            </div>

            {/* Provenance */}
            <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/20">
              <p>ID: {idea.id}</p>
              <p>Created: {new Date(idea.created_at).toLocaleDateString()}</p>
              {idea.source_dna_profile_id && <p>DNA Profile: {idea.source_dna_profile_id}</p>}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
