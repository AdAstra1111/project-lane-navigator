/**
 * SeasonScriptProgress — Episode-level progress view for season_script background generation.
 * Shows per-episode status from project_document_chunks, polls every 4s while bg_generating.
 * Detects stale/stuck generations and provides Resume/Retry controls.
 */
import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, XCircle, Loader2, Clock, AlertTriangle, RotateCcw, Play } from 'lucide-react';
import { toast } from 'sonner';

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  char_count: number | null;
  updated_at: string | null;
}

interface SeasonScriptProgressProps {
  versionId: string;
  episodeCount?: number;
  projectId?: string;
  documentId?: string;
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function getStatusIcon(status: string): React.ReactElement {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
  if (status === 'failed' || status === 'stale') return <XCircle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50" />;
}

function getStatusBadgeClass(status: string): string {
  if (status === 'done') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (status === 'running') return 'bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse';
  if (status === 'failed' || status === 'stale') return 'bg-destructive/15 text-destructive border-destructive/30';
  return 'bg-muted text-muted-foreground border-border/30';
}

function getStatusLabel(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'running') return 'Generating';
  if (status === 'failed') return 'Failed';
  if (status === 'stale') return 'Stale';
  return 'Pending';
}

export function SeasonScriptProgress({ versionId, episodeCount, projectId, documentId }: SeasonScriptProgressProps) {
  const qc = useQueryClient();
  const [resuming, setResuming] = useState(false);

  const { data: chunks = [], isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['season-script-chunks', versionId],
    queryFn: async () => {
      if (!versionId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('id, chunk_index, chunk_key, status, char_count, updated_at')
        .eq('version_id', versionId)
        .order('chunk_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChunkRow[];
    },
    enabled: !!versionId,
    refetchInterval: 4000,
  });

  const safeChunks = Array.isArray(chunks) ? chunks : [];
  const total = (typeof episodeCount === 'number' && episodeCount > 0)
    ? episodeCount
    : safeChunks.length;
  const doneCount = safeChunks.filter(c => c.status === 'done').length;
  const failedCount = safeChunks.filter(c => c.status === 'failed').length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // Detect stale generation: a chunk has been 'running' for > threshold
  const staleInfo = useMemo(() => {
    const now = Date.now();
    const runningChunks = safeChunks.filter(c => c.status === 'running');
    if (runningChunks.length === 0) return null;

    const oldestRunning = runningChunks.reduce((oldest, c) => {
      const updatedAt = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      return updatedAt < oldest.time ? { chunk: c, time: updatedAt } : oldest;
    }, { chunk: runningChunks[0], time: runningChunks[0].updated_at ? new Date(runningChunks[0].updated_at).getTime() : 0 });

    const ageMs = now - oldestRunning.time;
    if (ageMs > STALE_THRESHOLD_MS) {
      return {
        staleChunk: oldestRunning.chunk,
        ageMinutes: Math.round(ageMs / 60000),
        episodeNumber: oldestRunning.chunk.chunk_index + 1,
      };
    }
    return null;
  }, [safeChunks]);

  const isStale = !!staleInfo;
  const allDone = doneCount === total && total > 0;
  const hasFailures = failedCount > 0 || isStale;

  const rows = Array.from({ length: Math.max(total, 0) }, (_, i) => {
    const chunk = safeChunks.find(c => c.chunk_index === i);
    let status = chunk?.status ?? 'pending';
    // Mark stale running chunks visually
    if (status === 'running' && isStale && chunk?.id === staleInfo?.staleChunk.id) {
      status = 'stale';
    }
    return {
      index: i,
      status,
      charCount: chunk?.char_count ?? null,
    };
  });

  const handleResume = async () => {
    if (!projectId || !documentId) {
      toast.error('Missing project context for resume');
      return;
    }
    setResuming(true);
    try {
      // 1. Clear bg_generating on the version
      await (supabase as any).from('project_document_versions')
        .update({
          meta_json: {
            bg_generating: false,
            bg_stale: true,
            bg_stale_cleared_at: new Date().toISOString(),
            bg_stale_reason: 'user_resume',
          },
        })
        .eq('id', versionId);

      // 2. Mark stuck 'running' chunks as 'failed' so they can be retried
      await (supabase as any).from('project_document_chunks')
        .update({ status: 'failed' })
        .eq('version_id', versionId)
        .eq('status', 'running');

      // 3. Trigger re-generation by calling generate-document
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId,
          docType: 'season_script',
          force: true,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Resume failed (${resp.status})`);
      }

      toast.success('Generation resumed — new background task started');
      qc.invalidateQueries({ queryKey: ['season-script-chunks', versionId] });
    } catch (e: any) {
      toast.error(e.message || 'Resume failed');
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-[300px] w-full space-y-4">
      <div className="w-full max-w-md space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">
            {isStale ? 'Generation Stalled' : allDone ? 'Season Script Complete' : 'Generating Season Script'}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {doneCount} / {total || '?'} episodes
          </span>
        </div>
        <Progress value={pct} className="h-2" />
        {isStale && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-[11px] text-destructive font-medium">
                Episode {staleInfo!.episodeNumber} has been stuck for {staleInfo!.ageMinutes} minutes.
                The background process likely crashed.
              </p>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs gap-1"
                onClick={handleResume}
                disabled={resuming}
              >
                {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Resume from Episode {staleInfo!.episodeNumber}
              </Button>
            </div>
          </div>
        )}
        {failedCount > 0 && !isStale && (
          <p className="text-[11px] text-destructive">
            {failedCount} episode{failedCount > 1 ? 's' : ''} failed
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading episode status…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting generation…
        </div>
      ) : (
        <ScrollArea className="w-full max-w-md h-[180px] rounded-lg border border-border/30 bg-muted/20">
          <div className="divide-y divide-border/10">
            {rows.map((row) => (
              <div
                key={row.index}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(row.status)}
                  <span className="text-foreground font-medium">
                    Episode {String(row.index + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {row.status === 'done' && row.charCount != null && (
                    <span className="text-muted-foreground/60 font-mono text-[10px]">
                      {row.charCount.toLocaleString()} chars
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 ${getStatusBadgeClass(row.status)}`}
                  >
                    {getStatusLabel(row.status)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      <p className="text-[11px] text-muted-foreground/60 text-center max-w-sm">
        {isStale
          ? 'The generation process has stalled. Use the Resume button to restart from the stuck episode.'
          : 'This may take a few minutes. The page will update automatically when ready.'}
      </p>
    </div>
  );
}
