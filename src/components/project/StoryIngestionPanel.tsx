import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Zap, CheckCircle2, AlertTriangle, BookOpen, Shield, FileText,
  ChevronDown, ChevronRight, Eye, ThumbsUp, ThumbsDown, AlertCircle, Info,
  Users, MapPin, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { InlineProcessBar } from '@/components/system/InlineProcessBar';
import { useProcessBridge } from '@/hooks/useProcessBridge';
import {
  useStoryIngestion,
  IngestionRun,
  ReviewData,
  ParseQuality,
  SourceResolution,
  RunDiff,
  ParticipationSummary,
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
  autoResolved,
  onOpenReview,
}: {
  reviewRequired: { entities: number; aliases: number; transitions: number; participation: number };
  autoResolved?: { participation: number };
  onOpenReview: () => void;
}) {
  // Canon decisions = entities + aliases + transitions (high-value)
  const decisionCount = reviewRequired.entities + reviewRequired.aliases + reviewRequired.transitions;
  const pendingParticipation = reviewRequired.participation;
  const autoResolvedParticipation = autoResolved?.participation || 0;
  const totalReviewable = decisionCount + pendingParticipation;

  if (totalReviewable === 0 && autoResolvedParticipation === 0) return null;

  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <Eye className="h-3.5 w-3.5 text-primary" />
          {decisionCount > 0
            ? `${decisionCount} decision${decisionCount !== 1 ? 's' : ''} need review`
            : 'No canon decisions pending'
          }
        </div>
        {totalReviewable > 0 && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={onOpenReview}>
            Review
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-0.5 text-[10px] text-muted-foreground">
        {reviewRequired.entities > 0 && (
          <span className="text-foreground font-medium">
            🔸 Entities: {reviewRequired.entities}
          </span>
        )}
        {reviewRequired.aliases > 0 && (
          <span className="text-foreground font-medium">
            🔸 Aliases: {reviewRequired.aliases}
          </span>
        )}
        {reviewRequired.transitions > 0 && (
          <span className="text-foreground font-medium">
            🔸 State Transitions: {reviewRequired.transitions}
          </span>
        )}
        {autoResolvedParticipation > 0 && (
          <span className="text-muted-foreground">
            ✓ {autoResolvedParticipation} participation events auto-resolved
          </span>
        )}
        {pendingParticipation > 0 && (
          <span className="text-yellow-600 dark:text-yellow-400">
            ⚠ {pendingParticipation} ambiguous participation need review
          </span>
        )}
      </div>
    </div>
  );
}

// ── Participation Summary Cards ──
function ParticipationSummarySection({
  summaries,
  onAction,
}: {
  summaries: ParticipationSummary[];
  onAction: (target: string, id: string, action: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const totalAuto = summaries.reduce((a, s) => a + s.auto_resolved, 0);
  const totalPending = summaries.reduce((a, s) => a + s.pending, 0);
  const totalAll = summaries.reduce((a, s) => a + s.total, 0);

  const pendingSummaries = summaries.filter(s => s.pending > 0);
  const resolvedSummaries = summaries.filter(s => s.pending === 0 && s.total > 0);

  return (
    <div className="space-y-1.5">
      {/* Top-level summary */}
      <div className="flex items-center justify-between px-2 py-1.5 rounded bg-muted/30 text-[11px]">
        <div className="flex items-center gap-1.5">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium text-foreground">Participation</span>
          <Badge variant="secondary" className="text-[9px] h-4">{totalAll} total</Badge>
          {totalAuto > 0 && (
            <Badge variant="outline" className="text-[9px] h-4 text-emerald-600 border-emerald-200 dark:border-emerald-800">
              {totalAuto} auto-resolved
            </Badge>
          )}
          {totalPending > 0 && (
            <Badge variant="outline" className="text-[9px] h-4 text-yellow-600 border-yellow-200 dark:border-yellow-800">
              {totalPending} pending
            </Badge>
          )}
        </div>
      </div>

      {/* Pending participation — always visible if exists */}
      {pendingSummaries.map(s => (
        <div key={s.entity_id} className="pl-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
            <span className="font-medium text-foreground">{s.entity_name}</span>
            <span className="text-muted-foreground">
              — {s.pending} scene{s.pending !== 1 ? 's' : ''} need review
            </span>
          </div>
          {/* Show individual pending items for this entity */}
          {s.pending_items.slice(0, 10).map((p: any) => (
            <div key={p.id} className="flex items-center justify-between pl-4 py-0.5 text-[10px]">
              <div className="text-muted-foreground">
                {p.role_in_scene} · {p.source_reason} · conf: {(p.confidence * 100).toFixed(0)}%
              </div>
              <div className="flex gap-0.5">
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('participation', p.id, 'approve')}>
                  <ThumbsUp className="h-2.5 w-2.5 text-emerald-600" />
                </Button>
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onAction('participation', p.id, 'reject')}>
                  <ThumbsDown className="h-2.5 w-2.5 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          {s.pending_items.length > 10 && (
            <div className="pl-4 text-[10px] text-muted-foreground">+{s.pending_items.length - 10} more</div>
          )}
        </div>
      ))}

      {/* Auto-resolved — collapsed by default */}
      {resolvedSummaries.length > 0 && (
        <Collapsible open={showDetails} onOpenChange={setShowDetails}>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted/50 text-[10px] text-muted-foreground cursor-pointer">
              <ChevronRight className={cn('h-2.5 w-2.5 transition-transform', showDetails && 'rotate-90')} />
              Show {resolvedSummaries.length} auto-resolved entit{resolvedSummaries.length !== 1 ? 'ies' : 'y'}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pl-4 space-y-0.5">
              {resolvedSummaries.map(s => (
                <div key={s.entity_id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                  <span className="text-foreground">{s.entity_name}</span>
                  <span>appears in {s.total} scene{s.total !== 1 ? 's' : ''} (auto-resolved)</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
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

  const { entities, state_transitions, aliases, participation_summaries, review_summary } = reviewData;

  const reviewEntities = entities.filter((e: any) => e.meta_json?.review_tier !== 'auto_accepted');
  const reviewAliases = aliases.filter((a: any) => a.review_status === 'review_required');
  const reviewTransitions = state_transitions.filter((t: any) => t.review_status === 'pending');

  const decisionCount = reviewEntities.length + reviewAliases.length + reviewTransitions.length;

  // Section 1: Canon Decisions (high priority)
  const canonSections = [
    {
      title: 'Entity Candidates',
      icon: <Sparkles className="h-3 w-3 text-primary" />,
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
      title: 'Alias Resolution',
      icon: <Users className="h-3 w-3 text-primary" />,
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
      icon: <AlertTriangle className="h-3 w-3 text-primary" />,
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
  ].filter(s => s.items.length > 0);

  const hasAnything = canonSections.length > 0 ||
    (participation_summaries && participation_summaries.length > 0);

  if (!hasAnything) {
    return (
      <div className="text-[11px] text-muted-foreground p-3 flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        All items reviewed
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top-level review summary */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/20 text-[11px]">
        <span className="font-medium text-foreground">
          {decisionCount > 0
            ? `${decisionCount} canon decision${decisionCount !== 1 ? 's' : ''} need review`
            : 'No canon decisions pending'
          }
        </span>
        {review_summary.participation_auto_resolved > 0 && (
          <span className="text-muted-foreground">
            · {review_summary.participation_auto_resolved} participation auto-resolved
          </span>
        )}
      </div>

      {/* Section 1: Canon Decisions */}
      {canonSections.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
            Canon Decisions
          </div>
          {canonSections.map(section => (
            <Collapsible key={section.title} defaultOpen>
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    {section.icon}
                    <span className="font-medium">{section.title}</span>
                    <Badge variant="secondary" className="text-[9px] h-4">{section.items.length}</Badge>
                  </div>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
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
      )}

      {/* Section 2: Participation Summaries (infrastructure) */}
      {participation_summaries && participation_summaries.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
            Infrastructure
          </div>
          <ParticipationSummarySection
            summaries={participation_summaries}
            onAction={onAction}
          />
        </div>
      )}
    </div>
  );
}

export function StoryIngestionPanel({ projectId }: StoryIngestionPanelProps) {
  const { isRunning, latestRun, runIngestion, fetchStatus, fetchReview, reviewAction } = useStoryIngestion(projectId);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const INGESTION_STAGES = [
    'Resolving source document',
    'Parsing scenes and structure',
    'Extracting characters, locations, props',
    'Building state transitions',
    'Resolving participation',
    'Finalizing ingestion',
  ];

  const bridge = useProcessBridge({
    keyPrefix: 'ingestion',
    type: 'Story Ingestion',
    projectId,
    href: `/projects/${projectId}/visual-dev`,
    stages: INGESTION_STAGES,
  });

  useEffect(() => {
    fetchStatus().then(r => setRuns(r));
  }, [fetchStatus]);

  const handleRunIngestion = useCallback(async () => {
    const processId = bridge.register({
      stageDescription: 'Resolving source document and preparing parse…',
    });
    try {
      const result = await runIngestion({ force: true });
      if (result) {
        bridge.complete();
      } else {
        bridge.fail('Ingestion returned no result');
      }
    } catch (err: any) {
      bridge.fail(err?.message || 'Ingestion failed');
    }
  }, [runIngestion, bridge]);

  const manifest = latestRun?.manifest_json;
  const parseQuality = latestRun?.parse_quality_json;
  const sourceResolution = latestRun?.source_resolution_json;
  const diff = latestRun?.diff_json;
  const reviewRequired = manifest?.review_required;
  const autoResolved = manifest?.auto_resolved;

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
              <span>Entities: <span className="text-foreground font-medium">{manifest.entities_total}</span></span>
              <span>Participation: <span className="text-foreground font-medium">{manifest.participation_records}</span></span>
            </div>

            {/* Source resolution */}
            {sourceResolution && <SourceResolutionBlock source={sourceResolution} />}

            {/* Parse quality */}
            {parseQuality && <ParseQualityBlock quality={parseQuality} />}

            {/* Diff summary */}
            {diff && <DiffSummaryBlock diff={diff} />}

            {/* Review required — priority-aware */}
            {reviewRequired && (
              <ReviewRequiredBlock
                reviewRequired={reviewRequired}
                autoResolved={autoResolved}
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

        {/* ── Running state with inline progress ── */}
        {isRunning && (
          <InlineProcessBar
            status="running"
            stage="Story Ingestion"
            description="Parsing scenes, extracting characters, locations, props, and state variants…"
            className="rounded-md border border-primary/30 bg-primary/5 p-3"
          />
        )}

        {/* ── Actions ── */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={isRunning}
            onClick={handleRunIngestion}
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
