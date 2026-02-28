/**
 * ChunkProgressPanel — Shows chunk generation progress for large-risk documents.
 * Displays done/total, per-chunk status, and validation failures.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  attempts: number;
  char_count: number | null;
  error: string | null;
  meta_json: any;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  done: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  running: <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />,
  pending: <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  skipped: <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/40" />,
};

export function ChunkProgressPanel({ documentId, versionId }: { documentId: string; versionId?: string | null }) {
  const { data: chunks, isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['doc-chunks', documentId, versionId],
    enabled: !!documentId,
    refetchInterval: 5000,
    queryFn: async () => {
      let query = (supabase as any)
        .from('project_document_chunks')
        .select('*')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true });
      if (versionId) query = query.eq('version_id', versionId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading || !chunks || chunks.length === 0) return null;

  const total = chunks.length;
  const done = chunks.filter(c => c.status === 'done').length;
  const failed = chunks.filter(c => c.status === 'failed').length;
  const running = chunks.filter(c => c.status === 'running').length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">Chunk Progress</span>
        <span className="text-muted-foreground font-mono">
          {done}/{total} done
          {failed > 0 && <span className="text-red-400 ml-1">({failed} failed)</span>}
          {running > 0 && <span className="text-amber-400 ml-1">({running} running)</span>}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {chunks.map(chunk => (
          <div
            key={chunk.id}
            className="flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded bg-muted/30"
            title={chunk.error || chunk.meta_json?.label || chunk.chunk_key}
          >
            {STATUS_ICON[chunk.status] || STATUS_ICON.pending}
            <span className="truncate text-muted-foreground">
              {chunk.meta_json?.label || chunk.chunk_key || `Chunk ${chunk.chunk_index + 1}`}
            </span>
            {chunk.char_count != null && (
              <span className="ml-auto text-muted-foreground/60 font-mono">{Math.round(chunk.char_count / 1000)}k</span>
            )}
          </div>
        ))}
      </div>
      {failed > 0 && (
        <div className="text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          <span>Incomplete: {chunks.filter(c => c.status === 'failed').map(c => c.meta_json?.label || c.chunk_key).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
