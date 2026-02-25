/**
 * ChangesetTimeline — Shows history of applied Writers' Room change plans with rollback support.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Undo2, CheckCircle2, AlertTriangle, History, FileEdit, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WritersRoomChangeset, ChangesetDiffSummary } from '@/lib/types/writers-room';

interface ChangesetTimelineProps {
  projectId: string;
  documentId: string;
}

export function ChangesetTimeline({ projectId, documentId }: ChangesetTimelineProps) {
  const qc = useQueryClient();

  const { data: changesets, isLoading } = useQuery({
    queryKey: ['wr-changesets', documentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('writers_room_changesets')
        .select('*')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as WritersRoomChangeset[];
    },
    enabled: !!documentId,
  });

  const rollbackMutation = useMutation({
    mutationFn: async (changeset: WritersRoomChangeset) => {
      // Restore before_version_id as current
      const { error: rpcErr } = await supabase.rpc('set_current_version', {
        p_document_id: changeset.document_id,
        p_new_version_id: changeset.before_version_id,
      });
      if (rpcErr) throw rpcErr;

      // Mark changeset as rolled back
      const { error: updateErr } = await (supabase as any)
        .from('writers_room_changesets')
        .update({ rolled_back: true, rolled_back_at: new Date().toISOString() })
        .eq('id', changeset.id);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wr-changesets', documentId] });
      toast.success('Rolled back to previous version');
    },
    onError: (e: any) => toast.error('Rollback failed: ' + e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading history…</span>
      </div>
    );
  }

  if (!changesets || changesets.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <History className="h-6 w-6 mx-auto mb-2 opacity-30" />
        <p className="text-xs">No changes applied yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 px-1">
        {changesets.map((cs) => {
          const diff = cs.diff_summary as ChangesetDiffSummary;
          const isRolledBack = cs.rolled_back;
          const deltaSign = diff.length_delta >= 0 ? '+' : '';
          const deltaPctStr = `${deltaSign}${Math.round(diff.length_delta_pct * 100)}%`;

          return (
            <div
              key={cs.id}
              className={`rounded-lg border p-3 space-y-1.5 transition-opacity ${
                isRolledBack ? 'opacity-50 border-border/20' : 'border-border/40'
              }`}
            >
              <div className="flex items-start gap-2">
                <FileEdit className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-foreground truncate">
                      {(cs.plan_json as any)?.direction_summary?.slice(0, 80) || 'Change applied'}
                    </span>
                    {isRolledBack && (
                      <Badge variant="outline" className="text-[7px] px-1 py-0 border-amber-500/30 text-amber-400">
                        Rolled Back
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                    <span>{new Date(cs.created_at).toLocaleString()}</span>
                    <span>•</span>
                    <span>{diff.changes_applied} changes</span>
                    <span>•</span>
                    <span className={diff.length_delta < 0 ? 'text-amber-400' : 'text-emerald-400'}>
                      {deltaPctStr} length
                    </span>
                    {diff.affected_scene_count > 0 && (
                      <>
                        <span>•</span>
                        <span>Sc. {diff.affected_scenes.join(', ')}</span>
                      </>
                    )}
                  </div>

                  {cs.quality_run_id && (
                    <div className="flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
                      <span className="text-[8px] text-emerald-400">Quality gate linked</span>
                    </div>
                  )}
                </div>

                {!isRolledBack && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[9px] px-1.5 gap-1 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={rollbackMutation.isPending}
                    onClick={() => {
                      if (confirm('Roll back to the version before this change?')) {
                        rollbackMutation.mutate(cs);
                      }
                    }}
                  >
                    {rollbackMutation.isPending ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Undo2 className="h-2.5 w-2.5" />
                    )}
                    Rollback
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
