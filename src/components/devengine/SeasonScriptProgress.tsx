/**
 * SeasonScriptProgress — Episode-level workspace for season_script background generation.
 * 
 * UPGRADE: From pipeline-only status view to a clickable episode navigator
 * where users can read episode content while generation/rewrite is in progress.
 * 
 * ARCHITECTURE:
 *   - Left: scrollable episode list (number, status badge, char count)
 *   - Right: reading pane for selected episode content
 *   - Preserved vs rewritten vs generating clearly distinguished
 *   - Scene-ready: inner structure designed for future scene nesting
 * 
 * STATE MODEL:
 *   pending  — not yet started
 *   running  — actively generating
 *   done     — completed successfully
 *   failed   — generation failed
 *   stale    — (UI-only) running chunk exceeds STALE_THRESHOLD_MS
 *   preserved— (UI-only, from meta_json.preserved)
 *   needs_regen / failed_validation — retryable by resume
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle, XCircle, Loader2, Clock, AlertTriangle,
  RotateCcw, ChevronRight, BookOpen, ShieldCheck, Pen,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ── Types ─────────────────────────────────────────────── */

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  char_count: number | null;
  content: string | null;
  updated_at: string | null;
  meta_json: Record<string, unknown> | null;
}

interface SeasonScriptProgressProps {
  versionId: string;
  episodeCount?: number;
  projectId?: string;
  documentId?: string;
}

type EpisodeDisplayStatus =
  | 'pending' | 'running' | 'done' | 'failed'
  | 'stale' | 'preserved' | 'needs_regen';

/* ── Constants ─────────────────────────────────────────── */

const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/* ── Status Helpers ────────────────────────────────────── */

function statusIcon(s: EpisodeDisplayStatus): React.ReactElement {
  switch (s) {
    case 'done': return <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case 'preserved': return <ShieldCheck className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
    case 'running': return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />;
    case 'failed': case 'stale': case 'needs_regen':
      return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
  }
}

function statusBadgeClass(s: EpisodeDisplayStatus): string {
  switch (s) {
    case 'done': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'preserved': return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'running': return 'bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse';
    case 'failed': case 'stale': case 'needs_regen':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    default: return 'bg-muted text-muted-foreground border-border/30';
  }
}

function statusLabel(s: EpisodeDisplayStatus): string {
  switch (s) {
    case 'done': return 'Done';
    case 'preserved': return 'Preserved';
    case 'running': return 'Generating';
    case 'failed': return 'Failed';
    case 'stale': return 'Stale';
    case 'needs_regen': return 'Retryable';
    default: return 'Pending';
  }
}

/* ── Row Model ─────────────────────────────────────────── */

interface EpisodeRow {
  index: number;
  status: EpisodeDisplayStatus;
  charCount: number | null;
  content: string | null;
  hasContent: boolean;
  /** Future: scenes within this episode */
  scenes?: unknown[];
}

/* ── Main Component ────────────────────────────────────── */

export function SeasonScriptProgress({
  versionId, episodeCount, projectId, documentId,
}: SeasonScriptProgressProps) {
  const qc = useQueryClient();
  const [selectedEpIndex, setSelectedEpIndex] = useState<number | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeSuccess, setResumeSuccess] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  /* ── Data: poll chunks every 4s (includes content) ──── */

  const { data: chunks = [], isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['season-script-chunks', versionId],
    queryFn: async () => {
      if (!versionId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('id, chunk_index, chunk_key, status, char_count, content, updated_at, meta_json')
        .eq('version_id', versionId)
        .order('chunk_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChunkRow[];
    },
    enabled: !!versionId,
    refetchInterval: 4000,
  });

  /* ── Derived state ──────────────────────────────────── */

  const safeChunks = Array.isArray(chunks) ? chunks : [];
  const total = (typeof episodeCount === 'number' && episodeCount > 0)
    ? episodeCount
    : safeChunks.length;
  const doneCount = safeChunks.filter(c => c.status === 'done').length;
  const preservedCount = safeChunks.filter(c =>
    c.status === 'done' && (c.meta_json as any)?.preserved === true
  ).length;
  const rewrittenCount = doneCount - preservedCount;
  const failedCount = safeChunks.filter(c =>
    ['failed', 'failed_validation', 'needs_regen'].includes(c.status)
  ).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const allDone = doneCount === total && total > 0;

  /* ── Stale detection ────────────────────────────────── */

  const staleInfo = useMemo(() => {
    const now = Date.now();
    const running = safeChunks.filter(c => c.status === 'running');
    if (running.length === 0) return null;
    const oldest = running.reduce((o, c) => {
      const t = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      return t < o.time ? { chunk: c, time: t } : o;
    }, { chunk: running[0], time: running[0].updated_at ? new Date(running[0].updated_at).getTime() : 0 });
    const age = now - oldest.time;
    if (age > STALE_THRESHOLD_MS) {
      return { staleChunk: oldest.chunk, ageMinutes: Math.round(age / 60000), episodeNumber: oldest.chunk.chunk_index + 1 };
    }
    return null;
  }, [safeChunks]);

  const isStale = !!staleInfo;
  const hasRetryable = failedCount > 0 && safeChunks.filter(c => c.status === 'running').length === 0;
  const showResume = !resumeSuccess && (isStale || hasRetryable);

  const firstIncompleteEp = useMemo(() => {
    const inc = safeChunks.find(c => c.status !== 'done');
    return inc ? inc.chunk_index + 1 : null;
  }, [safeChunks]);

  /* ── Episode rows ───────────────────────────────────── */

  const rows: EpisodeRow[] = useMemo(() =>
    Array.from({ length: Math.max(total, 0) }, (_, i) => {
      const chunk = safeChunks.find(c => c.chunk_index === i);
      let rawStatus = chunk?.status ?? 'pending';

      // Stale override
      if (rawStatus === 'running' && isStale && chunk?.id === staleInfo?.staleChunk.id) {
        rawStatus = 'stale';
      }
      // Optimistic resume
      if (resumeSuccess && ['failed', 'failed_validation', 'needs_regen'].includes(rawStatus) && i === (firstIncompleteEp ? firstIncompleteEp - 1 : -1)) {
        rawStatus = 'running';
      }

      // Preserved detection
      const isPreserved = rawStatus === 'done' && (chunk?.meta_json as any)?.preserved === true;
      const displayStatus: EpisodeDisplayStatus = isPreserved ? 'preserved'
        : rawStatus === 'needs_regen' || rawStatus === 'failed_validation' ? 'needs_regen'
        : (rawStatus as EpisodeDisplayStatus);

      return {
        index: i,
        status: displayStatus,
        charCount: chunk?.char_count ?? null,
        content: chunk?.content ?? null,
        hasContent: !!(chunk?.content && chunk.content.length > 0),
      };
    }),
  [total, safeChunks, isStale, staleInfo, resumeSuccess, firstIncompleteEp]);

  /* ── Selected episode ───────────────────────────────── */

  const selectedRow = selectedEpIndex != null ? rows[selectedEpIndex] ?? null : null;

  /* ── Auto-select running episode if nothing selected ── */
  const runningIndex = rows.findIndex(r => r.status === 'running');
  const effectiveSelected = selectedEpIndex ?? (runningIndex >= 0 ? runningIndex : null);
  const effectiveRow = effectiveSelected != null ? rows[effectiveSelected] ?? null : null;

  /* ── Resume handler ─────────────────────────────────── */

  const handleResume = useCallback(async () => {
    if (!projectId || !documentId) {
      toast.error('Missing project context for resume');
      return;
    }
    setResuming(true);
    try {
      const { data: currentVersion } = await (supabase as any)
        .from('project_document_versions')
        .select('meta_json')
        .eq('id', versionId)
        .maybeSingle();

      const existingMeta = (currentVersion?.meta_json as Record<string, unknown>) || {};
      await (supabase as any).from('project_document_versions')
        .update({
          meta_json: {
            ...existingMeta,
            bg_generating: false,
            bg_stale: true,
            bg_stale_cleared_at: new Date().toISOString(),
            bg_stale_reason: 'user_resume',
          },
        })
        .eq('id', versionId);

      // Convert stuck running → failed
      const { data: stuck } = await (supabase as any)
        .from('project_document_chunks')
        .select('id, meta_json')
        .eq('version_id', versionId)
        .eq('status', 'running');

      if (stuck?.length) {
        for (const sc of stuck) {
          await (supabase as any).from('project_document_chunks')
            .update({
              status: 'failed',
              meta_json: { ...((sc.meta_json as any) || {}), stale_reason: 'user_resume_conversion', converted_at: new Date().toISOString() },
            })
            .eq('id', sc.id);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId, docType: 'season_script', resumeVersionId: versionId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Resume failed (${resp.status})`);
      }

      setResumeSuccess(true);
      setResumeError(null);
      toast.success(`Generation resumed from Episode ${firstIncompleteEp ?? '?'}`);
      qc.invalidateQueries({ queryKey: ['season-script-chunks', versionId] });
    } catch (e: any) {
      setResumeError(e.message || 'Resume failed');
      toast.error(e.message || 'Resume failed');
    } finally {
      setResuming(false);
    }
  }, [projectId, documentId, versionId, firstIncompleteEp, qc]);

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="flex flex-col w-full gap-3">
      {/* ── Header: progress bar + summary ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">
            {resuming ? 'Resuming Generation…'
              : resumeSuccess ? 'Generation Resumed'
              : isStale ? 'Generation Stalled'
              : allDone ? 'Season Script Complete'
              : hasRetryable ? 'Generation Incomplete'
              : 'Generating Season Script'}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {doneCount} / {total || '?'} episodes
            {total > 0 && doneCount < total && ` (${pct}%)`}
          </span>
        </div>
        <Progress value={pct} className="h-2" />
        {/* Preserved/rewritten breakdown */}
        {doneCount > 0 && (preservedCount > 0 || rewrittenCount > 0) && (
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {rewrittenCount > 0 && (
              <span className="flex items-center gap-1">
                <Pen className="h-3 w-3 text-emerald-400" />
                {rewrittenCount} rewritten
              </span>
            )}
            {preservedCount > 0 && (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-sky-400" />
                {preservedCount} preserved
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Alert banners ── */}
      {!allDone && !resuming && !resumeSuccess && safeChunks.length > 0 && !safeChunks.some(c => c.status === 'running') && (
        <AlertBanner variant="warning">
          This version has {doneCount}/{total} episodes and is <strong>not a deliverable</strong>.
          Use Resume to continue, or it will remain non-authoritative.
        </AlertBanner>
      )}
      {isStale && !resumeSuccess && !resuming && (
        <AlertBanner variant="error">
          <p>Episode {staleInfo!.episodeNumber} stuck for {staleInfo!.ageMinutes} min. Process likely crashed.</p>
          <ResumeButton onClick={handleResume} loading={resuming} label={`Resume from Episode ${firstIncompleteEp ?? staleInfo!.episodeNumber}`} />
        </AlertBanner>
      )}
      {hasRetryable && !isStale && !resumeSuccess && !resuming && (
        <AlertBanner variant="warning">
          <p>{failedCount} episode{failedCount > 1 ? 's' : ''} failed. Episodes 1–{doneCount} preserved.</p>
          <ResumeButton onClick={handleResume} loading={resuming} label={`Resume from Episode ${firstIncompleteEp ?? '?'}`} />
        </AlertBanner>
      )}
      {resuming && (
        <AlertBanner variant="info">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Resuming from Episode {firstIncompleteEp ?? '?'}…
        </AlertBanner>
      )}
      {resumeSuccess && !resuming && (
        <AlertBanner variant="info">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Resumed — generating now. Updates automatically.
        </AlertBanner>
      )}
      {resumeError && !resuming && (
        <AlertBanner variant="error">
          <p>Resume failed: {resumeError}</p>
          <ResumeButton onClick={() => { setResumeError(null); handleResume(); }} loading={false} label="Retry" />
        </AlertBanner>
      )}

      {/* ── Main workspace: episode list + reading pane ── */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading episode status…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting generation…
        </div>
      ) : (
        <div className="flex gap-0 border border-border/30 rounded-lg overflow-hidden bg-muted/10" style={{ minHeight: 340 }}>
          {/* ── Episode List (left) ── */}
          <ScrollArea className="w-[200px] shrink-0 border-r border-border/20">
            <div className="divide-y divide-border/10">
              {rows.map((row) => {
                const isSelected = effectiveSelected === row.index;
                return (
                  <button
                    key={row.index}
                    onClick={() => setSelectedEpIndex(row.index)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                      'hover:bg-accent/40',
                      isSelected && 'bg-accent/60 border-l-2 border-l-primary',
                      !isSelected && 'border-l-2 border-l-transparent',
                    )}
                  >
                    {statusIcon(row.status)}
                    <span className="flex-1 font-medium text-foreground truncate">
                      EP {String(row.index + 1).padStart(2, '0')}
                    </span>
                    {row.status === 'done' && row.charCount != null && (
                      <span className="text-muted-foreground/50 font-mono text-[9px]">
                        {(row.charCount / 1000).toFixed(1)}k
                      </span>
                    )}
                    <Badge variant="outline" className={cn('text-[8px] px-1 py-0 shrink-0', statusBadgeClass(row.status))}>
                      {statusLabel(row.status)}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {/* ── Reading Pane (right) ── */}
          <div className="flex-1 min-w-0">
            {effectiveRow ? (
              <EpisodeReadingPane row={effectiveRow} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 px-4">
                <BookOpen className="h-5 w-5 text-muted-foreground/40" />
                <p className="text-center text-xs">
                  Click an episode to read its content
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50 text-center">
        {allDone
          ? 'All episodes generated. Switch to Raw view to see the full assembled document.'
          : isStale
            ? 'Generation stalled — use Resume to restart from the stuck episode.'
            : 'Episodes update live as generation progresses. Click any to read.'}
      </p>
    </div>
  );
}

/* ── Episode Reading Pane ──────────────────────────────── */

function EpisodeReadingPane({ row }: { row: EpisodeRow }) {
  const epNum = row.index + 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/20 bg-muted/20">
        {statusIcon(row.status)}
        <span className="font-medium text-sm text-foreground">
          Episode {String(epNum).padStart(2, '0')}
        </span>
        <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 ml-auto', statusBadgeClass(row.status))}>
          {statusLabel(row.status)}
        </Badge>
        {row.status === 'preserved' && (
          <span className="text-[10px] text-sky-400 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Unchanged
          </span>
        )}
        {row.charCount != null && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {row.charCount.toLocaleString()} chars
          </span>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-3">
          {row.status === 'running' ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
              <p className="text-xs text-center">Writing Episode {epNum}…</p>
              <p className="text-[10px] text-muted-foreground/60">Content will appear when this episode completes.</p>
            </div>
          ) : row.status === 'pending' ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Clock className="h-5 w-5 text-muted-foreground/40" />
              <p className="text-xs text-center">Episode {epNum} — Queued</p>
              <p className="text-[10px] text-muted-foreground/60">This episode will be generated when its turn arrives.</p>
            </div>
          ) : row.status === 'failed' || row.status === 'stale' || row.status === 'needs_regen' ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-xs text-center text-destructive">
                Episode {epNum} — {row.status === 'stale' ? 'Stalled' : 'Failed'}
              </p>
              {row.hasContent && (
                <div className="mt-3 w-full">
                  <p className="text-[10px] text-muted-foreground/60 mb-2">Last known content:</p>
                  <div className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed border border-border/20 rounded p-3 bg-muted/20 max-h-[400px] overflow-auto">
                    {row.content}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground/60">Use Resume to retry this episode.</p>
            </div>
          ) : row.hasContent ? (
            /* Done or Preserved — show content */
            <div className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {row.content}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <BookOpen className="h-5 w-5 text-muted-foreground/40" />
              <p className="text-xs text-center">No content available yet</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Future: scene list within episode would go here */}
      {/* <EpisodeSceneList scenes={row.scenes} /> */}
    </div>
  );
}

/* ── Shared sub-components ─────────────────────────────── */

function AlertBanner({
  variant, children,
}: {
  variant: 'warning' | 'error' | 'info';
  children: React.ReactNode;
}) {
  const cls = variant === 'error'
    ? 'bg-destructive/10 border-destructive/30 text-destructive'
    : variant === 'warning'
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
      : 'bg-blue-500/10 border-blue-500/30 text-blue-400';
  const Icon = variant === 'error' ? XCircle : variant === 'warning' ? AlertTriangle : Loader2;

  return (
    <div className={cn('flex items-start gap-2 p-2 rounded-md border text-[11px] font-medium', cls)}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div className="space-y-1 flex-1">{children}</div>
    </div>
  );
}

function ResumeButton({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs gap-1 mt-1 border-current/30 hover:bg-current/10"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
      {label}
    </Button>
  );
}
