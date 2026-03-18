/**
 * EpisodeRewriteWorkspace — Episode-first workspace UI for episodic rewrite operations.
 *
 * Replaces the old ProcessProgressBar + ActivityTimeline pipeline view
 * with a navigable episode browser where users can click and read episodes
 * during an active rewrite.
 *
 * ARCHITECTURE:
 *   - Top: scope summary (total / affected / preserved) + compact progress
 *   - Left: scrollable episode navigator with strong visual status distinction
 *   - Right: reading pane for selected episode content
 *   - Bottom: collapsible activity log (demoted from primary)
 *   - Scene-ready: inner structure designed for future scene nesting
 *
 * SCOPE MATH RULE:
 *   - Progress denominator = affectedEpisodes, never totalEpisodes
 *   - Preserved episodes are visually inert (not part of progress)
 *   - Full rewrite (affected = total) is displayed differently from selective rewrite
 */
import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  CheckCircle, XCircle, Loader2, Clock, ShieldCheck,
  Pen, BookOpen, ChevronDown, Square, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActivityTimeline } from './ActivityTimeline';
import type { EpisodeUnit, EpisodeUnitStatus } from '@/hooks/useRewritePipeline';
import type { ActivityItem } from '@/components/devengine/ActivityTimeline';

/* ── Status Helpers ────────────────────────────────────── */

function statusIcon(s: EpisodeUnitStatus): React.ReactElement {
  switch (s) {
    case 'done': return <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case 'preserved': return <ShieldCheck className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
    case 'rewriting': return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />;
    case 'failed': return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
    case 'queued': return <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
  }
}

function statusBadgeVariant(s: EpisodeUnitStatus): string {
  switch (s) {
    case 'done': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'preserved': return 'bg-sky-500/10 text-sky-400/70 border-sky-500/20';
    case 'rewriting': return 'bg-primary/15 text-primary border-primary/30 animate-pulse';
    case 'failed': return 'bg-destructive/15 text-destructive border-destructive/30';
    case 'queued': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    default: return 'bg-muted text-muted-foreground border-border/30';
  }
}

function statusLabel(s: EpisodeUnitStatus): string {
  switch (s) {
    case 'done': return 'Rewritten';
    case 'preserved': return 'Preserved';
    case 'rewriting': return 'Rewriting…';
    case 'failed': return 'Failed';
    case 'queued': return 'Queued';
    default: return 'Pending';
  }
}

/* ── Props ─────────────────────────────────────────────── */

interface EpisodeRewriteWorkspaceProps {
  episodeUnits: EpisodeUnit[];
  progress: {
    percent: number;
    label: string;
    phase: string;
    isEpisodic: boolean;
    totalEpisodes: number;
    affectedEpisodes: number;
    preservedEpisodes: number;
  };
  smoothedPercent: number;
  etaMs: number | null;
  pipelineStatus: string;
  activityItems: ActivityItem[];
  onClearActivity: () => void;
  onStop: () => void;
  onRestart: () => void;
  error: string | null;
}

/* ── Main Component ────────────────────────────────────── */

export function EpisodeRewriteWorkspace({
  episodeUnits,
  progress,
  smoothedPercent,
  etaMs,
  pipelineStatus,
  activityItems,
  onClearActivity,
  onStop,
  onRestart,
  error,
}: EpisodeRewriteWorkspaceProps) {
  const [selectedEp, setSelectedEp] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [logOpen, setLogOpen] = useState(false);

  // Auto-follow: track the currently rewriting episode
  const rewritingEp = episodeUnits.find(u => u.status === 'rewriting');
  useEffect(() => {
    if (autoFollow && rewritingEp) {
      setSelectedEp(rewritingEp.episodeNumber);
    }
  }, [autoFollow, rewritingEp?.episodeNumber]);

  const handleSelectEp = (epNum: number) => {
    setSelectedEp(epNum);
    setAutoFollow(false);
  };

  const selectedUnit = episodeUnits.find(u => u.episodeNumber === selectedEp) ?? null;

  // ── Scope counts (truth) ──
  const doneCount = episodeUnits.filter(u => u.status === 'done').length;
  const failedCount = episodeUnits.filter(u => u.status === 'failed').length;
  const preservedCount = episodeUnits.filter(u => u.isPreserved).length;
  const affectedCount = episodeUnits.filter(u => !u.isPreserved).length;
  const totalCount = episodeUnits.length;
  const isSelectiveRewrite = preservedCount > 0;

  // Progress is always against AFFECTED episodes, not total
  const affectedProgressPct = affectedCount > 0
    ? Math.round(((doneCount + failedCount) / affectedCount) * 100)
    : 0;

  const etaStr = etaMs && etaMs > 0
    ? etaMs < 60000 ? `~${Math.round(etaMs / 1000)}s` : `~${Math.floor(etaMs / 60000)}m`
    : null;

  // Currently rewriting episode label for header
  const rewritingLabel = rewritingEp
    ? `Rewriting Episode ${String(rewritingEp.episodeNumber).padStart(2, '0')} — ${doneCount} of ${affectedCount} affected done`
    : null;

  return (
    <div className="rounded-lg border border-border/40 bg-card overflow-hidden">
      {/* ── Header: scope summary + progress ── */}
      <div className="px-3 py-2.5 border-b border-border/20 space-y-2">
        {/* Top line: status + controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {pipelineStatus !== 'error' && pipelineStatus !== 'complete' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
            )}
            {pipelineStatus === 'complete' && (
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            )}
            {pipelineStatus === 'error' && (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            )}
            <span className="text-sm font-medium text-foreground">
              {pipelineStatus === 'planning' ? 'Planning Rewrite…'
                : pipelineStatus === 'assembling' ? 'Assembling Final…'
                : pipelineStatus === 'complete'
                  ? (isSelectiveRewrite
                    ? `Selective Rewrite Complete — ${doneCount} of ${affectedCount} episodes`
                    : 'Full Rewrite Complete')
                : pipelineStatus === 'error' ? 'Rewrite Failed'
                : isSelectiveRewrite ? 'Selective Rewrite' : 'Full Rewrite'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {etaStr && (
              <span className="text-[10px] text-muted-foreground">ETA {etaStr}</span>
            )}
            {pipelineStatus !== 'error' && pipelineStatus !== 'complete' && (
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onStop} title="Stop">
                <Square className="h-3 w-3" />
              </Button>
            )}
            {pipelineStatus === 'error' && (
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onRestart} title="Restart">
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Scope summary — always show full breakdown */}
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-muted-foreground">{totalCount} total</span>
          <span className="text-muted-foreground">·</span>
          <span className="flex items-center gap-1 text-emerald-400">
            <Pen className="h-3 w-3" />
            {doneCount}/{affectedCount} rewritten
          </span>
          {isSelectiveRewrite && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="flex items-center gap-1 text-sky-400/70">
                <ShieldCheck className="h-3 w-3" />
                {preservedCount} preserved
              </span>
            </>
          )}
          {failedCount > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="h-3 w-3" />
                {failedCount} failed
              </span>
            </>
          )}
        </div>

        {/* Active episode label */}
        {rewritingLabel && pipelineStatus === 'writing' && (
          <p className="text-[10px] text-primary/80 font-medium">{rewritingLabel}</p>
        )}

        {/* Compact progress bar — denominator = affected only */}
        <Progress value={affectedProgressPct} className="h-1.5" />
      </div>

      {/* ── Main workspace: episode list + reading pane ── */}
      <div className="flex" style={{ minHeight: 320, maxHeight: 480 }}>
        {/* ── Episode Navigator (left) ── */}
        <ScrollArea className="w-[180px] shrink-0 border-r border-border/20">
          <div className="divide-y divide-border/10">
            {episodeUnits.map((unit) => {
              const isSelected = selectedEp === unit.episodeNumber;
              const isActive = unit.status === 'rewriting';
              return (
                <button
                  key={unit.episodeNumber}
                  onClick={() => handleSelectEp(unit.episodeNumber)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left transition-colors',
                    'hover:bg-accent/40',
                    // Selected state
                    isSelected && 'bg-accent/60 border-l-2 border-l-primary',
                    !isSelected && 'border-l-2 border-l-transparent',
                    // Active rewriting glow
                    isActive && !isSelected && 'bg-primary/5',
                    // Preserved episodes: visually subdued
                    unit.isPreserved && !isSelected && 'opacity-50',
                  )}
                >
                  {statusIcon(unit.status)}
                  <span className={cn(
                    'flex-1 font-medium truncate',
                    unit.isPreserved ? 'text-muted-foreground' : 'text-foreground',
                  )}>
                    EP {String(unit.episodeNumber).padStart(2, '0')}
                  </span>
                  {unit.status === 'done' && unit.charCount > 0 && (
                    <span className="text-muted-foreground/40 font-mono text-[9px]">
                      {(unit.charCount / 1000).toFixed(1)}k
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={cn('text-[7px] px-1 py-0 shrink-0 leading-tight', statusBadgeVariant(unit.status))}
                  >
                    {statusLabel(unit.status)}
                  </Badge>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {/* ── Reading Pane (right) ── */}
        <div className="flex-1 min-w-0">
          {selectedUnit ? (
            <EpisodePane unit={selectedUnit} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 px-4">
              <BookOpen className="h-5 w-5 text-muted-foreground/30" />
              <p className="text-xs text-center">
                {autoFollow ? 'Waiting for first episode…' : 'Click an episode to read its content'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Demoted activity log (collapsible) ── */}
      {activityItems.length > 0 && (
        <Collapsible open={logOpen} onOpenChange={setLogOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-border/20 text-[10px] text-muted-foreground hover:bg-accent/20 transition-colors">
              <ChevronDown className={cn('h-3 w-3 transition-transform', logOpen && 'rotate-180')} />
              Activity Log ({activityItems.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border/10 px-2 py-1">
              <ActivityTimeline items={activityItems} onClear={onClearActivity} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Error banner */}
      {pipelineStatus === 'error' && error && (
        <div className="px-3 py-2 border-t border-destructive/30 bg-destructive/10 text-[11px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

/* ── Episode Reading Pane ──────────────────────────────── */

function EpisodePane({ unit }: { unit: EpisodeUnit }) {
  const epLabel = `Episode ${String(unit.episodeNumber).padStart(2, '0')}`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/15 bg-muted/15">
        {statusIcon(unit.status)}
        <span className="font-medium text-sm text-foreground">{epLabel}</span>
        <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 ml-auto', statusBadgeVariant(unit.status))}>
          {statusLabel(unit.status)}
        </Badge>
        {unit.charCount > 0 && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {unit.charCount.toLocaleString()} chars
          </span>
        )}
        {unit.durationMs != null && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {(unit.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Content — state-dependent display */}
      <ScrollArea className="flex-1">
        <div className="px-3 py-2.5">
          {unit.status === 'rewriting' ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs text-primary font-medium">{epLabel} — Rewriting…</p>
              <p className="text-[10px] text-muted-foreground/60">Content will appear when this episode completes.</p>
            </div>
          ) : unit.status === 'queued' ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Clock className="h-5 w-5 text-amber-400/60" />
              <p className="text-xs text-amber-400 font-medium">{epLabel} — Queued for rewrite</p>
              <p className="text-[10px] text-muted-foreground/60">
                This episode is in the affected set and will be rewritten.
              </p>
            </div>
          ) : unit.status === 'preserved' ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <ShieldCheck className="h-5 w-5 text-sky-400/60" />
              <p className="text-xs text-sky-400 font-medium">{epLabel} — Preserved unchanged</p>
              <p className="text-[10px] text-muted-foreground/60">
                This episode was not in the affected set and retains its original content.
              </p>
              {unit.content && (
                <div className="mt-3 w-full text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed border border-sky-500/10 rounded p-3 bg-sky-500/5 max-h-[300px] overflow-auto">
                  {unit.content}
                </div>
              )}
            </div>
          ) : unit.status === 'failed' ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-xs text-destructive font-medium">{epLabel} — Failed</p>
              {unit.content && (
                <div className="mt-2 w-full text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed border border-destructive/20 rounded p-3 bg-destructive/5 max-h-[300px] overflow-auto font-mono">
                  {unit.content}
                </div>
              )}
            </div>
          ) : unit.content ? (
            /* Done / rewritten — show content */
            <div className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {unit.content}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <BookOpen className="h-5 w-5 text-muted-foreground/30" />
              <p className="text-xs text-center">No content available</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Future: scene list within episode */}
      {/* <EpisodeSceneList scenes={unit.scenes} /> */}
    </div>
  );
}
