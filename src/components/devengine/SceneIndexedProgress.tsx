/**
 * SceneIndexedProgress — Scene-batch progress view for scene_indexed generation.
 * Shows per-scene-batch status from project_document_chunks, polls every 6s while generating.
 * Used for production_draft and feature_script when generated via scene_indexed strategy.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, XCircle, Loader2, Clock, AlertTriangle, RefreshCw } from 'lucide-react';

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  char_count: number | null;
  meta_json: Record<string, any> | null;
}

interface SceneIndexedProgressProps {
  versionId: string;
  docType?: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  feature_script: 'Feature Script',
  production_draft: 'Production Draft',
  screenplay_draft: 'Screenplay Draft',
};

function getStatusIcon(status: string): React.ReactElement {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
  if (['failed', 'failed_validation', 'error'].includes(status)) return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (status === 'skipped') return <XCircle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50" />;
}

function getStatusBadgeClass(status: string): string {
  if (status === 'done') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (status === 'running') return 'bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse';
  if (['failed', 'failed_validation', 'error'].includes(status)) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  if (status === 'skipped') return 'bg-destructive/15 text-destructive border-destructive/30';
  return 'bg-muted text-muted-foreground border-border/30';
}

function getStatusLabel(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'running') return 'Writing';
  if (status === 'failed' || status === 'error') return 'Failed';
  if (status === 'failed_validation') return 'Validation';
  if (status === 'needs_regen') return 'Queued';
  if (status === 'skipped') return 'Skipped';
  return 'Pending';
}

/** Parse scene range from chunk_key like "SC01-SC05" → "Scenes 1–5" */
function formatSceneLabel(chunkKey: string, metaLabel?: string): string {
  if (metaLabel) return metaLabel;
  const match = chunkKey.match(/^SC(\d+)-SC(\d+)$/);
  if (match) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    return `Scenes ${start}–${end}`;
  }
  // Fallback for act-based keys that ended up here
  return chunkKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function SceneIndexedProgress({ versionId, docType }: SceneIndexedProgressProps) {
  const { data: chunks = [], isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['scene-indexed-chunks', versionId],
    queryFn: async () => {
      if (!versionId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('id, chunk_index, chunk_key, status, char_count, meta_json')
        .eq('version_id', versionId)
        .order('chunk_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChunkRow[];
    },
    enabled: !!versionId,
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows || rows.length === 0) return 6000;
      const TERMINAL = new Set(['done', 'failed', 'failed_validation', 'error', 'needs_regen', 'skipped']);
      const allTerminal = rows.every((c: ChunkRow) => TERMINAL.has(c.status));
      return allTerminal ? false : 6000;
    },
  });

  const safeChunks = Array.isArray(chunks) ? chunks : [];
  const total = safeChunks.length;
  const doneCount = safeChunks.filter(c => c.status === 'done').length;
  const failedCount = safeChunks.filter(c => ['failed', 'failed_validation', 'error', 'skipped'].includes(c.status)).length;
  const runningChunks = safeChunks.filter(c => c.status === 'running');
  const pendingChunks = safeChunks.filter(c => c.status === 'pending');
  const isStillActive = runningChunks.length > 0 || pendingChunks.length > 0;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const label = (docType && DOC_TYPE_LABELS[docType]) || 'Screenplay';

  const runningLabel = runningChunks.length > 0
    ? `Writing ${formatSceneLabel(runningChunks[0].chunk_key, runningChunks[0].meta_json?.label)} (${doneCount + 1} of ${total})…`
    : doneCount < total
      ? `Preparing scene batch ${doneCount + 1} of ${total}…`
      : 'Assembling final screenplay…';

  return (
    <div className="flex flex-col w-full space-y-4">
      {/* Header + progress */}
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">Generating {label}</span>
            {isStillActive && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1">
                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                Live
              </Badge>
            )}
            {!isStillActive && failedCount > 0 && doneCount > 0 && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-500/10 text-amber-400 border-amber-500/20">
                Partially complete
              </Badge>
            )}
            {!isStillActive && doneCount === total && total > 0 && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                Complete
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground font-mono text-xs">
            {doneCount} / {total || '?'} scene batches
          </span>
        </div>
        <Progress value={pct} className="h-2" />
        <p className="text-xs text-muted-foreground">{runningLabel}</p>
      </div>

      {/* Scene batch list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading scene status…
        </div>
      ) : safeChunks.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting scene generation…
        </div>
      ) : (
        <ScrollArea className="w-full max-h-[280px] rounded-lg border border-border/30 bg-muted/20">
          <div className="divide-y divide-border/10">
            {safeChunks.map((chunk) => (
              <div
                key={chunk.id}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(chunk.status)}
                  <span className="text-foreground font-medium">
                    {formatSceneLabel(chunk.chunk_key, chunk.meta_json?.label)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {chunk.status === 'done' && chunk.char_count != null && (
                    <span className="text-muted-foreground/60 font-mono text-[10px]">
                      {chunk.char_count.toLocaleString()} chars
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 ${getStatusBadgeClass(chunk.status)}`}
                  >
                    {getStatusLabel(chunk.status)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      <p className="text-[11px] text-muted-foreground/60 text-center">
        {isStillActive
          ? 'Scene-by-scene generation in progress — updates every few seconds.'
          : failedCount > 0
            ? 'Some scene batches need attention.'
            : 'This may take a few minutes. The page will update automatically when ready.'}
      </p>
    </div>
  );
}
