import { useState } from 'react';
import { Rocket, ChevronDown, ChevronUp, Bookmark, BookmarkCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';

interface Props {
  idea: PitchIdea;
  rank: number;
  onPromote: (idea: PitchIdea) => void;
  onShortlist: (id: string, shortlisted: boolean) => void;
  onDelete: (id: string) => void;
}

export function SlateCard({ idea, rank, onPromote, onShortlist, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isShortlisted = idea.status === 'shortlisted';
  const laneLabel = LANE_LABELS[idea.recommended_lane as MonetisationLane] || idea.recommended_lane;

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-sm hover:border-primary/30 transition-colors group">
      <CardContent className="p-4">
        {/* Header row: rank + title + actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm mt-0.5">
              {rank}
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight">{idea.title}</h3>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{idea.logline}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant={isShortlisted ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => onShortlist(idea.id, !isShortlisted)}
              title={isShortlisted ? 'Remove from shortlist' : 'Shortlist'}
            >
              {isShortlisted ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onDelete(idea.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {Number(idea.score_total) > 0 && (
            <Badge variant="default" className="text-xs font-bold">
              {Number(idea.score_total).toFixed(0)}
            </Badge>
          )}
          {laneLabel && <Badge variant="outline" className="text-xs">{laneLabel}</Badge>}
          {idea.genre && <Badge variant="secondary" className="text-xs">{idea.genre}</Badge>}
          {idea.budget_band && <Badge variant="outline" className="text-xs">{idea.budget_band}</Badge>}
          <Badge variant={idea.risk_level === 'high' ? 'destructive' : 'secondary'} className="text-xs">
            {idea.risk_level}
          </Badge>
        </div>

        {/* Expandable details */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground mt-2 h-7">
              {expanded ? 'Less' : 'More details'}
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">One-Page Pitch</p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{idea.one_page_pitch}</p>
            </div>
            {idea.comps?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Comps</p>
                <div className="flex flex-wrap gap-1">{idea.comps.map((c, i) => <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>)}</div>
              </div>
            )}
            {idea.why_us && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Why Us</p>
                <p className="text-sm text-muted-foreground">{idea.why_us}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Market: <span className="font-medium text-foreground">{Number(idea.score_market_heat).toFixed(0)}</span></span>
              <span>Feasibility: <span className="font-medium text-foreground">{Number(idea.score_feasibility).toFixed(0)}</span></span>
              <span>Lane Fit: <span className="font-medium text-foreground">{Number(idea.score_lane_fit).toFixed(0)}</span></span>
              <span>Saturation: <span className="font-medium text-foreground">{Number(idea.score_saturation_risk).toFixed(0)}</span></span>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Promote button */}
        <div className="flex justify-end mt-3 pt-2 border-t border-border/20">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => onPromote(idea)}>
            <Rocket className="h-3.5 w-3.5" />
            Promote to DevSeed
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
