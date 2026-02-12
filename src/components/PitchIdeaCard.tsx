import { useState } from 'react';
import { Copy, ChevronDown, ChevronUp, ThumbsUp, Minus, ThumbsDown, ArrowUp, ArrowDown, Trash2, Link2, Share2, Bookmark, BookmarkCheck, Lock, Shield, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { usePitchFeedback } from '@/hooks/usePitchIdeas';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import { ConceptLockPanel } from '@/components/ConceptLockPanel';

const FEEDBACK_TAGS = ['character', 'world', 'hook', 'tone', 'budget', 'market fit'];

interface Props {
  idea: PitchIdea;
  onDelete: (id: string) => void;
  onUpdate?: (params: { id: string } & Partial<PitchIdea>) => void;
  onLinkProject?: (id: string) => void;
  rank: number;
}

export function PitchIdeaCard({ idea, onDelete, onUpdate, onLinkProject, rank }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [conceptLockOpen, setConceptLockOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { feedback, submitFeedback } = usePitchFeedback(idea.id);
  const userFeedback = feedback[0];
  const isLocked = (idea as any).concept_lock_status === 'locked';
  const lockVersion = (idea as any).concept_lock_version || 0;
  const isPromoted = !!(idea as any).promoted_to_project_id;

  const copyBlock = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const buildFullPitchText = () => {
    const sections = [
      `# ${idea.title}`,
      `**Logline:** ${idea.logline}`,
      `**Genre:** ${idea.genre} | **Budget:** ${idea.budget_band} | **Lane:** ${laneLabel} (${idea.lane_confidence}%) | **Risk:** ${idea.risk_level}`,
      '',
      `## One-Page Pitch`,
      idea.one_page_pitch,
      '',
      `## Comparables`,
      idea.comps.join(', '),
    ];
    if (idea.packaging_suggestions?.length > 0) {
      sections.push('', '## Packaging Suggestions');
      idea.packaging_suggestions.forEach((p: any) => sections.push(`- ${p.role} — ${p.archetype}${p.names?.length ? ` (${p.names.join(', ')})` : ''}: ${p.rationale}`));
    }
    if (idea.development_sprint?.length > 0) {
      sections.push('', '## Development Sprint');
      idea.development_sprint.forEach((s: any) => sections.push(`- ${s.week}: ${s.milestone} → ${s.deliverable}`));
    }
    if (idea.risks_mitigations?.length > 0) {
      sections.push('', '## Risks & Mitigations');
      idea.risks_mitigations.forEach((r: any) => sections.push(`- [${r.severity}] ${r.risk} — ${r.mitigation}`));
    }
    if (idea.why_us) {
      sections.push('', `## Why Us`, idea.why_us);
    }
    return sections.join('\n');
  };

  const handleRating = async (rating: 'strong' | 'meh' | 'no') => {
    await submitFeedback({ rating, tags: selectedTags });
    // Update idea status based on rating
    if (onUpdate) {
      if (rating === 'strong' && idea.status !== 'shortlisted') {
        onUpdate({ id: idea.id, status: 'shortlisted' });
      } else if (rating === 'no' && idea.status !== 'archived') {
        onUpdate({ id: idea.id, status: 'archived' });
      }
    }
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
            {/* Save / Shortlist button */}
            <Button
              variant={idea.status === 'shortlisted' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => {
                if (onUpdate) {
                  const newStatus = idea.status === 'shortlisted' ? 'draft' : 'shortlisted';
                  onUpdate({ id: idea.id, status: newStatus });
                  toast.success(newStatus === 'shortlisted' ? 'Idea saved to shortlist' : 'Removed from shortlist');
                }
              }}
              title={idea.status === 'shortlisted' ? 'Remove from shortlist' : 'Save to shortlist'}
            >
              {idea.status === 'shortlisted' ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
              {idea.status === 'shortlisted' ? 'Saved' : 'Save'}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { copyBlock('Full pitch', buildFullPitchText()); }} title="Share full pitch">
              <Share2 className="h-3.5 w-3.5" />
            </Button>
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
          {isLocked && (
            <Badge className="bg-green-500/15 text-green-400 border-green-500/30 gap-1 text-xs">
              <Lock className="h-3 w-3" /> Locked v{lockVersion}
            </Badge>
          )}
          {isPromoted && (
            <Badge className="bg-primary/15 text-primary border-primary/30 gap-1 text-xs">
              <Rocket className="h-3 w-3" /> Promoted
            </Badge>
          )}
          {Number(idea.score_total) > 0 && (
            <Badge variant="default" className="text-xs font-bold">
              Score: {Number(idea.score_total).toFixed(0)}
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">{idea.genre}</Badge>
          <Badge variant="outline" className="text-xs">{idea.budget_band}</Badge>
          <Badge variant="outline" className="text-xs">{laneLabel} ({idea.lane_confidence}%)</Badge>
          <Badge variant={idea.risk_level === 'high' ? 'destructive' : idea.risk_level === 'low' ? 'default' : 'secondary'} className="text-xs">
            Risk: {idea.risk_level}
          </Badge>
        </div>
        {/* Score breakdown */}
        {Number(idea.score_total) > 0 && (
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
            <span>Market Heat: <span className="font-medium text-foreground">{Number(idea.score_market_heat).toFixed(0)}</span></span>
            <span>Feasibility: <span className="font-medium text-foreground">{Number(idea.score_feasibility).toFixed(0)}</span></span>
            <span>Lane Fit: <span className="font-medium text-foreground">{Number(idea.score_lane_fit).toFixed(0)}</span></span>
            <span>Saturation: <span className="font-medium text-foreground">{Number(idea.score_saturation_risk).toFixed(0)}</span></span>
            <span>Company Fit: <span className="font-medium text-foreground">{Number(idea.score_company_fit).toFixed(0)}</span></span>
          </div>
        )}
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

        {/* Concept Lock trigger */}
        <Collapsible open={conceptLockOpen} onOpenChange={setConceptLockOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between text-xs gap-1">
              <span className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                {isLocked ? `Concept Locked v${lockVersion}` : 'Concept Lock Engine'}
              </span>
              {conceptLockOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ConceptLockPanel idea={idea} onUpdate={onUpdate} />
          </CollapsibleContent>
        </Collapsible>

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
