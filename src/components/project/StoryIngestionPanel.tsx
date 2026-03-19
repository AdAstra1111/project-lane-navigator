import { useState, useEffect } from 'react';
import {
  Loader2, Zap, CheckCircle2, AlertTriangle, BookOpen, Shield, FileText,
  ChevronDown, ChevronRight, Eye, ThumbsUp, ThumbsDown, AlertCircle, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  useStoryIngestion,
  IngestionRun,
  ReviewData,
  ParseQuality,
  SourceResolution,
  RunDiff,
} from '@/hooks/useStoryIngestion';

interface StoryIngestionPanelProps {
  projectId: string;
}

function QualityBadge({ quality }: { quality: string }) {
  const colors: Record<string, string> = {
    high: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    low: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px] h-5', colors[quality] || '')}>
      {quality}
    </Badge>
  );
}

function SourceResolutionBlock({ source }: { source: SourceResolution }) {
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <FileText className="h-3 w-3" />
        <span className="font-medium text-foreground">Source:</span>
        <span>{source.selected_doc_type || 'inline text'}</span>
        {source.fallback_used && (
          <Badge variant="outline" className="text-[9px] h-4 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
            fallback
          </Badge>
        )}
      </div>
      <div className="pl-4.5">
        {source.documents_considered.length > 0 && (
          <span>{source.documents_considered.length} doc{source.documents_considered.length !== 1 ? 's' : ''} considered · </span>
        )}
        <span>{(source.text_length / 1000).toFixed(1)}k chars</span>
        {source.selection_reason && <span> · {source.selection_reason.split('|')[0]}</span>}
      </div>
    </div>
  );
}

function ParseQualityBlock({ quality }: { quality: ParseQuality }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <Shield className="h-3 w-3 text-primary" />
        <span className="font-medium text-foreground">Parse Quality:</span>
        <QualityBadge quality={quality.parse_quality} />
        <span className="text-muted-foreground">{quality.parse_method}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pl-4.5">
        <span>Sluglines: <span className="text-foreground font-medium">{quality.slugline_count}</span></span>
        <span>Cues: <span className="text-foreground font-medium">{quality.dialogue_cue_count}</span></span>
        <span>Scenes: <span className="text-foreground font-medium">{quality.scenes_detected}</span></span>
      </div>
      {quality.warnings.length > 0 && (
        <div className="space-y-0.5 pl-4.5">
          {quality.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-[10px] text-yellow-600 dark:text-yellow-400">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffSummaryBlock({ diff }: { diff: RunDiff }) {
  const changes = [
    { label: 'Scenes', added: diff.scenes_added.length, removed: diff.scenes_removed.length },
    { label: 'Characters', added: diff.characters_added.length, removed: diff.characters_removed.length },
    { label: 'Locations', added: diff.locations_added.length, removed: diff.locations_removed.length },
    { label: 'Props', added: diff.props_added.length, removed: diff.props_removed.length },
    { label: 'Costumes', added: diff.costume_looks_added.length, removed: diff.costume_looks_removed.length },
  ].filter(c => c.added > 0 || c.removed > 0);

  if (changes.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Info className="h-3 w-3" />
        No changes from prior run
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
        <Info className="h-3 w-3 text-primary" />
        Changes from Prior Run
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] pl-4.5">
        {changes.map(c => (
          <div key={c.label} className="text-muted-foreground">
            {c.label}:
            {c.added > 0 && <span className="text-emerald-600 dark:text-emerald-400 ml-1">+{c.added}</span>}
            {c.removed > 0 && <span className="text-red-500 ml-1">-{c.removed}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewRequiredBlock({
  reviewRequired,
  onOpenReview,
}: {
  reviewRequired: { entities: number; aliases: number; transitions: number; participation: number };
  onOpenReview: () => void;
}) {
  const total = Object.values(reviewRequired).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="rounded-md border border-yellow-200 dark:border-yellow-800/40 bg-yellow-50/50 dark:bg-yellow-900/10 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-yellow-800 dark:text-yellow-300">
          <Eye className="h-3.5 w-3.5" />
          {total} items need review
        </div>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={onOpenReview}>
          Review
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[10px] text-yellow-700 dark:text-yellow-400">
        {reviewRequired.entities > 0 && <span>Entities: {reviewRequired.entities}</span>}
        {reviewRequired.aliases > 0 && <span>Aliases: {reviewRequired.aliases}</span>}
        {reviewRequired.transitions > 0 && <span>Transitions: {reviewRequired.transitions}</span>}
        {reviewRequired.participation > 0 && <span>Participation: {reviewRequired.participation}</span>}
      </div>
    </div>
  );
}

function ReviewDetailPanel({
  reviewData,
  onAction,
  isLoading,
}: {
  reviewData: ReviewData | null;
  onAction: (target: string, id: string, action: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading review items…
      </div>
    );
  }

  if (!reviewData) return null;

  const { entities, state_transitions, aliases, participation_pending, review_summary } = reviewData;

  const reviewEntities = entities.filter((e: any) => e.meta_json?.review_tier !== 'auto_accepted');
  const reviewAliases = aliases.filter((a: any) => a.review_status === 'review_required');
  const reviewTransitions = state_transitions.filter((t: any) => t.review_status === 'pending');

  const sections = [
    {
      title: 'Entities',
      target: 'entity',
      items: reviewEntities,
      renderItem: (e: any) => (
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-foreground font-medium">{e.canonical_name}</span>
            <span className="text-muted-foreground ml-1.5">{e.entity_type}</span>
            <Badge variant="outline" className="ml-1.5 text-[9px] h-4">
              {e.meta_json?.confidence || 'medium'}
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('entity', e.id, 'approve')}>
              <ThumbsUp className="h-3 w-3 text-emerald-600" />
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('entity', e.id, 'reject')}>
              <ThumbsDown className="h-3 w-3 text-red-500" />
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: 'Aliases',
      target: 'alias',
      items: reviewAliases,
      renderItem: (a: any) => (
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-foreground font-medium">{a.alias_name}</span>
            <span className="text-muted-foreground ml-1.5">→ entity</span>
            <Badge variant="outline" className="ml-1.5 text-[9px] h-4">
              conf: {(a.confidence * 100).toFixed(0)}%
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('alias', a.id, 'approve')}>
              <ThumbsUp className="h-3 w-3 text-emerald-600" />
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('alias', a.id, 'reject')}>
              <ThumbsDown className="h-3 w-3 text-red-500" />
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: 'State Transitions',
      target: 'transition',
      items: reviewTransitions,
      renderItem: (t: any) => (
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-foreground font-medium">{t.to_state_key}</span>
            <span className="text-muted-foreground ml-1.5">{t.entity_type} · {t.state_category}</span>
            <Badge variant="outline" className="ml-1.5 text-[9px] h-4">
              conf: {(t.confidence * 100).toFixed(0)}%
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('transition', t.id, 'approve')}>
              <ThumbsUp className="h-3 w-3 text-emerald-600" />
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('transition', t.id, 'reject')}>
              <ThumbsDown className="h-3 w-3 text-red-500" />
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: 'Participation',
      target: 'participation',
      items: participation_pending,
      renderItem: (p: any) => (
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-foreground font-medium">{p.entity_type}</span>
            <span className="text-muted-foreground ml-1.5">{p.role_in_scene} · {p.source_reason}</span>
            <Badge variant="outline" className="ml-1.5 text-[9px] h-4">
              conf: {(p.confidence * 100).toFixed(0)}%
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('participation', p.id, 'approve')}>
              <ThumbsUp className="h-3 w-3 text-emerald-600" />
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('participation', p.id, 'reject')}>
              <ThumbsDown className="h-3 w-3 text-red-500" />
            </Button>
          </div>
        </div>
      ),
    },
  ].filter(s => s.items.length > 0);

  if (sections.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground p-3 flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        All items reviewed
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sections.map(section => (
        <Collapsible key={section.title}>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50 text-[11px]">
              <div className="flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{section.title}</span>
                <Badge variant="secondary" className="text-[9px] h-4">{section.items.length}</Badge>
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pl-4 pr-1 divide-y divide-border/30 text-[11px]">
              {section.items.slice(0, 20).map((item: any) => (
                <div key={item.id}>{section.renderItem(item)}</div>
              ))}
              {section.items.length > 20 && (
                <div className="py-1 text-muted-foreground">+{section.items.length - 20} more</div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

export function StoryIngestionPanel({ projectId }: StoryIngestionPanelProps) {
  const { isRunning, latestRun, runIngestion, fetchStatus, fetchReview, reviewAction } = useStoryIngestion(projectId);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    fetchStatus().then(r => setRuns(r));
  }, [fetchStatus]);

  const manifest = latestRun?.manifest_json;
  const parseQuality = latestRun?.parse_quality_json;
  const sourceResolution = latestRun?.source_resolution_json;
  const diff = latestRun?.diff_json;
  const reviewRequired = manifest?.review_required;

  const handleOpenReview = async () => {
    if (!latestRun?.id) return;
    setShowReview(true);
    setReviewLoading(true);
    const data = await fetchReview(latestRun.id);
    setReviewData(data);
    setReviewLoading(false);
  };

  const handleReviewAction = async (target: string, id: string, action: string) => {
    await reviewAction(target as any, id, action as any);
    // Refresh review data
    if (latestRun?.id) {
      const data = await fetchReview(latestRun.id);
      setReviewData(data);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Story Ingestion Engine</CardTitle>
          {latestRun?.status === 'completed' && parseQuality && (
            <QualityBadge quality={parseQuality.parse_quality} />
          )}
        </div>
        <CardDescription className="text-xs">
          Parse your script into scenes, characters, locations, props, and state variants — feeding the entire visual pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ── Completed run summary ── */}
        {latestRun?.status === 'completed' && manifest && (
          <div className="rounded-md border border-border/40 bg-muted/30 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Last Ingestion Complete
            </div>

            {/* Entity counts */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>Scenes: <span className="text-foreground font-medium">{manifest.scenes_parsed}</span></span>
              <span>Characters: <span className="text-foreground font-medium">{manifest.characters}</span></span>
              <span>Locations: <span className="text-foreground font-medium">{manifest.locations}</span></span>
              <span>Props: <span className="text-foreground font-medium">{manifest.props}</span></span>
              <span>Costumes: <span className="text-foreground font-medium">{manifest.costume_looks}</span></span>
              <span>State Changes: <span className="text-foreground font-medium">{manifest.state_transitions}</span></span>
              <span>Participation: <span className="text-foreground font-medium">{manifest.participation_records}</span></span>
              <span>Entities: <span className="text-foreground font-medium">{manifest.entities_total}</span></span>
            </div>

            {/* Source resolution */}
            {sourceResolution && <SourceResolutionBlock source={sourceResolution} />}

            {/* Parse quality */}
            {parseQuality && <ParseQualityBlock quality={parseQuality} />}

            {/* Diff summary */}
            {diff && <DiffSummaryBlock diff={diff} />}

            {/* Review required */}
            {reviewRequired && (
              <ReviewRequiredBlock
                reviewRequired={reviewRequired}
                onOpenReview={handleOpenReview}
              />
            )}
          </div>
        )}

        {/* ── Failed run ── */}
        {latestRun?.status === 'failed' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Last ingestion failed: {latestRun.failure_reason?.slice(0, 100)}
            </div>
          </div>
        )}

        {/* ── Running state ── */}
        {isRunning && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-[11px] text-primary">Ingesting story… scenes → entities → states → distribution</span>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={isRunning}
            onClick={() => runIngestion({ force: true })}
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {latestRun?.status === 'completed' ? 'Re-Ingest Story' : 'Ingest Story Package'}
          </Button>

          {latestRun?.status === 'completed' && (
            <>
              <Badge variant="outline" className="text-[10px] h-6">
                {runs.filter(r => r.status === 'completed').length} run{runs.filter(r => r.status === 'completed').length !== 1 ? 's' : ''}
              </Badge>
              {!showReview && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleOpenReview}>
                  <Eye className="h-3 w-3" />
                  Review
                </Button>
              )}
            </>
          )}
        </div>

        {/* ── Review detail panel ── */}
        {showReview && (
          <div className="rounded-md border border-border/40 bg-card p-2 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-primary" />
                Ingestion Review
              </span>
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => setShowReview(false)}>
                Close
              </Button>
            </div>
            <ReviewDetailPanel
              reviewData={reviewData}
              onAction={handleReviewAction}
              isLoading={reviewLoading}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
