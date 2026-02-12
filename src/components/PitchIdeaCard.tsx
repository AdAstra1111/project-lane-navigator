import { useState } from 'react';
import { Copy, FileText, ChevronDown, ChevronUp, ThumbsUp, Minus, ThumbsDown, ArrowUp, ArrowDown, Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { usePitchFeedback } from '@/hooks/usePitchIdeas';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';

const FEEDBACK_TAGS = ['character', 'world', 'hook', 'tone', 'budget', 'market fit'];

interface Props {
  idea: PitchIdea;
  onDelete: (id: string) => void;
  onLinkProject?: (id: string) => void;
  rank: number;
}

export function PitchIdeaCard({ idea, onDelete, onLinkProject, rank }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { feedback, submitFeedback } = usePitchFeedback(idea.id);
  const userFeedback = feedback[0];

  const copyBlock = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const handleRating = async (rating: 'strong' | 'meh' | 'no') => {
    await submitFeedback({ rating, tags: selectedTags });
  };

  const handleDirection = async (direction: 'more' | 'less') => {
    await submitFeedback({ rating: userFeedback?.rating || 'meh', direction, tags: selectedTags });
  };

  const laneLabel = LANE_LABELS[idea.recommended_lane as MonetisationLane] || idea.recommended_lane;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
              {rank}
            </span>
            <div className="min-w-0">
              <CardTitle className="text-lg leading-tight">{idea.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{idea.logline}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyBlock('Logline', idea.logline)} title="Copy logline">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {onLinkProject && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onLinkProject(idea.id)} title="Link to project">
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(idea.id)} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Badge variant="secondary" className="text-xs">{idea.genre}</Badge>
          <Badge variant="outline" className="text-xs">{idea.budget_band}</Badge>
          <Badge variant="outline" className="text-xs">{laneLabel} ({idea.lane_confidence}%)</Badge>
          <Badge variant={idea.risk_level === 'high' ? 'destructive' : idea.risk_level === 'low' ? 'default' : 'secondary'} className="text-xs">
            Risk: {idea.risk_level}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Feedback buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/30">
          <span className="text-xs text-muted-foreground mr-1">Rate:</span>
          <Button size="sm" variant={userFeedback?.rating === 'strong' ? 'default' : 'outline'} className="h-7 text-xs gap-1" onClick={() => handleRating('strong')}>
            <ThumbsUp className="h-3 w-3" /> Strong
          </Button>
          <Button size="sm" variant={userFeedback?.rating === 'meh' ? 'default' : 'outline'} className="h-7 text-xs gap-1" onClick={() => handleRating('meh')}>
            <Minus className="h-3 w-3" /> Meh
          </Button>
          <Button size="sm" variant={userFeedback?.rating === 'no' ? 'default' : 'outline'} className="h-7 text-xs gap-1" onClick={() => handleRating('no')}>
            <ThumbsDown className="h-3 w-3" /> No
          </Button>
          <div className="h-4 w-px bg-border/50 mx-1" />
          <Button size="sm" variant={userFeedback?.direction === 'more' ? 'default' : 'outline'} className="h-7 text-xs gap-1" onClick={() => handleDirection('more')}>
            <ArrowUp className="h-3 w-3" /> More like this
          </Button>
          <Button size="sm" variant={userFeedback?.direction === 'less' ? 'default' : 'outline'} className="h-7 text-xs gap-1" onClick={() => handleDirection('less')}>
            <ArrowDown className="h-3 w-3" /> Less like this
          </Button>
        </div>

        {/* Tag why */}
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_TAGS.map(tag => (
            <Badge
              key={tag}
              variant={selectedTags.includes(tag) ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              onClick={() => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
            >
              {tag}
            </Badge>
          ))}
        </div>

        {/* Expandable details */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
              {expanded ? 'Hide details' : 'Show full pitch, packaging, sprint & risks'}
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-2">
            {/* One-page pitch */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold">One-Page Pitch</h4>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => copyBlock('Pitch', idea.one_page_pitch)}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{idea.one_page_pitch}</p>
            </div>

            {/* Comps */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold">Comparables</h4>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => copyBlock('Comps', idea.comps.join(', '))}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {idea.comps.map((c, i) => <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>)}
              </div>
            </div>

            {/* Packaging */}
            {idea.packaging_suggestions?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Packaging Suggestions</h4>
                <div className="space-y-2">
                  {idea.packaging_suggestions.map((p: any, i: number) => (
                    <div key={i} className="rounded-md border border-border/30 p-2.5 text-sm">
                      <span className="font-medium">{p.role}</span> — <span className="text-muted-foreground">{p.archetype}</span>
                      {p.names?.length > 0 && <span className="text-muted-foreground"> ({p.names.join(', ')})</span>}
                      <p className="text-xs text-muted-foreground mt-0.5">{p.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dev Sprint */}
            {idea.development_sprint?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Development Sprint</h4>
                <div className="space-y-1.5">
                  {idea.development_sprint.map((s: any, i: number) => (
                    <div key={i} className="flex gap-3 text-sm">
                      <span className="text-primary font-medium shrink-0 w-16">{s.week}</span>
                      <span className="font-medium">{s.milestone}</span>
                      <span className="text-muted-foreground">→ {s.deliverable}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risks */}
            {idea.risks_mitigations?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Risks & Mitigations</h4>
                <div className="space-y-1.5">
                  {idea.risks_mitigations.map((r: any, i: number) => (
                    <div key={i} className="text-sm">
                      <span className={cn('font-medium', r.severity === 'high' ? 'text-destructive' : 'text-muted-foreground')}>
                        [{r.severity}]
                      </span>{' '}
                      {r.risk} — <span className="text-muted-foreground">{r.mitigation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Why us */}
            {idea.why_us && (
              <div>
                <h4 className="text-sm font-semibold mb-1">"Why Us" Rationale</h4>
                <p className="text-sm text-muted-foreground">{idea.why_us}</p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
