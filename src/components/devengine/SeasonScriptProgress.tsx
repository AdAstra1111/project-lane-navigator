/**
 * SeasonScriptProgress — Episode-level progress view for season_script background generation.
 * Shows per-episode status from project_document_chunks, polls every 8s while bg_generating.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';

interface ChunkRow {
  id: string;
  chunk_index: number;
  chunk_key: string;
  status: string;
  char_count: number | null;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; badge: string }> = {
  done: {
    icon: <CheckCircle className="h-4 w-4 text-emerald-500" />,
    label: 'Done',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  running: {
    icon: <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />,
    label: 'Generating',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse',
  },
  pending: {
    icon: <Clock className="h-4 w-4 text-muted-foreground/50" />,
    label: 'Pending',
    badge: 'bg-muted text-muted-foreground border-border/30',
  },
  failed: {
    icon: <XCircle className="h-4 w-4 text-destructive" />,
    label: 'Failed',
    badge: 'bg-destructive/15 text-destructive border-destructive/30',
  },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending;
}

interface SeasonScriptProgressProps {
  versionId: string;
  episodeCount?: number;
}

export function SeasonScriptProgress({ versionId, episodeCount }: SeasonScriptProgressProps) {
  const queryClient = useQueryClient();

  const { data: chunks = [], isLoading } = useQuery<ChunkRow[]>({
    queryKey: ['season-script-chunks', versionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_document_chunks')
        .select('id, chunk_index, chunk_key, status, char_count')
        .eq('version_id', versionId)
        .order('chunk_index', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!versionId,
    refetchInterval: 8000,
  });

  const total = episodeCount || chunks.length || 0;
  const doneCount = chunks.filter(c => c.status === 'done').length;
  const failedCount = chunks.filter(c => c.status === 'failed').length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // Build episode rows — use chunks if available, pad to episodeCount
  const rows = Array.from({ length: total }, (_, i) => {
    const chunk = chunks.find(c => c.chunk_index === i);
    return {
      index: i,
      status: chunk?.status || 'pending',
      charCount: chunk?.char_count ?? null,
      key: chunk?.chunk_key || null,
    };
  });

  return (
    <div className="flex flex-col items-center justify-center h-[300px] w-full space-y-4">
      {/* Header */}
      <div className="w-full max-w-md space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Generating Season Script</span>
          <span className="text-muted-foreground font-mono text-xs">
            {doneCount} / {total} episodes complete
          </span>
        </div>
        <Progress value={pct} className="h-2" />
        {failedCount > 0 && (
          <p className="text-[11px] text-destructive">
            {failedCount} episode{failedCount > 1 ? 's' : ''} failed
          </p>
        )}
      </div>

      {/* Episode list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading episode status…
        </div>
      ) : (
        <ScrollArea className="w-full max-w-md h-[180px] rounded-lg border border-border/30 bg-muted/20">
          <div className="divide-y divide-border/10">
            {rows.map((row) => {
              const cfg = getStatusConfig(row.status);
              return (
                <div
                  key={row.index}
                  className="flex items-center justify-between px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    {cfg.icon}
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
                      className={`text-[9px] px-1.5 py-0 ${cfg.badge}`}
                    >
                      {cfg.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <p className="text-[11px] text-muted-foreground/60 text-center max-w-sm">
        This may take a few minutes for large seasons. The page will update automatically when ready.
      </p>
    </div>
  );
}
