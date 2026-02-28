/**
 * ChunkProgressPanel — Shows chunk generation progress for large-risk documents.
 * Displays done/total, per-chunk status (including failed_validation/needs_regen),
 * and a "Regenerate missing chunks" button.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Loader2, Clock, AlertTriangle, RotateCcw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from 'sonner';

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
  failed_validation: <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />,
  needs_regen: <RotateCcw className="h-3.5 w-3.5 text-amber-500" />,
  skipped: <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/40" />,
};

const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  running: "Running",
  pending: "Pending",
  failed: "Failed",
  failed_validation: "Failed validation",
  needs_regen: "Needs regen",
  skipped: "Skipped",
};

export function ChunkProgressPanel({ 
  documentId, 
  versionId,
  projectId,
}: { 
  documentId: string; 
  versionId?: string | null;
  projectId?: string;
}) {
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);

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
  const failedValidation = chunks.filter(c => c.status === 'failed_validation').length;
  const needsRegen = chunks.filter(c => c.status === 'needs_regen').length;
  const running = chunks.filter(c => c.status === 'running').length;
  const actionable = failed + failedValidation + needsRegen;
  const pct = Math.round((done / total) * 100);

  const handleRegenerate = async () => {
    if (!projectId) {
      toast.error("Missing project context for regeneration");
      return;
    }
    setRegenerating(true);
    try {
      const { error } = await supabase.functions.invoke('generate-document', {
        body: {
          projectId,
          documentId,
          versionId,
          resumeChunks: true,
        },
      });
      if (error) throw error;
      toast.success("Regeneration started for missing chunks");
      queryClient.invalidateQueries({ queryKey: ['doc-chunks', documentId, versionId] });
    } catch (err: any) {
      toast.error(`Regeneration failed: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">Chunk Progress</span>
        <span className="text-muted-foreground font-mono">
          {done}/{total} done
          {failed > 0 && <span className="text-red-400 ml-1">({failed} failed)</span>}
          {failedValidation > 0 && <span className="text-orange-400 ml-1">({failedValidation} invalid)</span>}
          {needsRegen > 0 && <span className="text-amber-400 ml-1">({needsRegen} needs regen)</span>}
          {running > 0 && <span className="text-amber-400 ml-1">({running} running)</span>}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {chunks.map(chunk => (
          <div
            key={chunk.id}
            className="flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded bg-muted/30"
            title={`${STATUS_LABEL[chunk.status] || chunk.status}${chunk.error ? `: ${chunk.error}` : ''}`}
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
      {actionable > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-orange-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            <span>
              Incomplete: {chunks
                .filter(c => ['failed', 'failed_validation', 'needs_regen'].includes(c.status))
                .map(c => c.meta_json?.label || c.chunk_key)
                .join(', ')}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Regenerate missing
          </Button>
        </div>
      )}
    </div>
  );
}
