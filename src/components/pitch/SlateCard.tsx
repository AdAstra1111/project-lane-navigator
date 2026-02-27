import { useState } from 'react';
import { Rocket, ChevronDown, ChevronUp, Bookmark, BookmarkCheck, Trash2, TrendingUp, Zap, Lock, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  idea: PitchIdea;
  rank: number;
  onPromote: (idea: PitchIdea) => void;
  onShortlist: (id: string, shortlisted: boolean) => void;
  onDelete: (id: string) => void;
}

/** Extract episode count from format_summary like "38 x 2min vertical episodes" */
function parseEpisodeCountFromFormat(idea: PitchIdea): number | null {
  const raw = idea.raw_response as any || {};
  const fmt = raw.format_summary || raw.format || '';
  const match = fmt.match(/(\d+)\s*x\s*/i);
  if (match) return parseInt(match[1]);
  const match2 = fmt.match(/(\d+)\s*episodes/i);
  if (match2) return parseInt(match2[1]);
  return null;
}

function EpisodeCountSetter({ idea }: { idea: PitchIdea }) {
  const devseedCanon = idea.devseed_canon_json || {};
  const inferredCount = parseEpisodeCountFromFormat(idea);
  const [epCount, setEpCount] = useState(String(devseedCanon.season_episode_count || inferredCount || ''));
  const [saving, setSaving] = useState(false);
  const isLocked = devseedCanon.locked === true;

  const save = async () => {
    const num = parseInt(epCount);
    if (!num || num < 1 || num > 200) { toast.error('Episode count must be 1-200'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('dev-engine-v2', {
        body: {
          action: 'pitch-idea-set-devseed-canon',
          pitchIdeaId: idea.id,
          seasonEpisodeCount: num,
          format: idea.production_type,
          assignedLane: idea.recommended_lane,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Canon locked: ${num} episodes`);
      // Reload page to reflect changes
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 pt-2 border-t border-border/20">
      <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
        <Hash className="h-3 w-3" /> DevSeed Canon — Episode Count
      </p>
      {isLocked ? (
        <div className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 text-primary" />
          <span className="text-xs font-medium text-primary">{devseedCanon.season_episode_count} episodes (locked)</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number" min={1} max={200}
            value={epCount} onChange={e => setEpCount(e.target.value)}
            placeholder="e.g. 30" className="h-7 w-20 text-xs"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={save} disabled={saving}>
            <Lock className="h-3 w-3" /> Set & Lock
          </Button>
        </div>
      )}
    </div>
  );
}

export function SlateCard({ idea, rank, onPromote, onShortlist, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isShortlisted = idea.status === 'shortlisted';
  const laneLabel = LANE_LABELS[idea.recommended_lane as MonetisationLane] || idea.recommended_lane;
  const devseedCanon = idea.devseed_canon_json || {};

  // Extract extended fields from raw_response
  const raw = idea.raw_response as any || {};
  const premise = raw.premise || '';
  const trendFitBullets: string[] = raw.trend_fit_bullets || [];
  const differentiationMove: string = raw.differentiation_move || '';
  const toneTag: string = raw.tone_tag || '';
  const formatSummary: string = raw.format_summary || '';

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-sm hover:border-primary/30 transition-colors group">
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm mt-0.5">
              {rank}
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight">{idea.title}</h3>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{idea.logline}</p>
              {premise && <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-3">{premise}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant={isShortlisted ? 'default' : 'ghost'} size="icon" className="h-7 w-7"
              onClick={() => onShortlist(idea.id, !isShortlisted)} title={isShortlisted ? 'Remove from shortlist' : 'Shortlist'}>
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
            <Badge variant="default" className="text-xs font-bold">{Number(idea.score_total).toFixed(0)}</Badge>
          )}
          {laneLabel && <Badge variant="outline" className="text-xs">{laneLabel}</Badge>}
          {idea.genre && <Badge variant="secondary" className="text-xs">{idea.genre}</Badge>}
          {toneTag && <Badge variant="outline" className="text-xs border-primary/30">{toneTag}</Badge>}
          {idea.budget_band && <Badge variant="outline" className="text-xs">{idea.budget_band}</Badge>}
          <Badge variant={idea.risk_level === 'high' ? 'destructive' : 'secondary'} className="text-xs">{idea.risk_level}</Badge>
          {formatSummary && <Badge variant="outline" className="text-[10px]">{formatSummary}</Badge>}
        </div>

        {/* Trend fit bullets */}
        {trendFitBullets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {trendFitBullets.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
                <TrendingUp className="h-2.5 w-2.5" /> {b}
              </span>
            ))}
          </div>
        )}

        {/* Differentiation move */}
        {differentiationMove && (
          <div className="mt-2 flex items-start gap-1.5">
            <Zap className="h-3 w-3 text-primary mt-0.5 shrink-0" />
            <span className="text-xs text-muted-foreground italic">{differentiationMove}</span>
          </div>
        )}

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

            {/* DesSeed Canon — Episode Count Setter */}
            <EpisodeCountSetter idea={idea} />
          </CollapsibleContent>
        </Collapsible>

        {/* Canon badge row */}
        {devseedCanon.season_episode_count && (
          <div className="flex items-center gap-1.5 mt-2">
            <Lock className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-medium text-primary">Canon: {devseedCanon.season_episode_count} episodes</span>
            {devseedCanon.format && <Badge variant="outline" className="text-[10px] h-4">{devseedCanon.format}</Badge>}
          </div>
        )}

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
