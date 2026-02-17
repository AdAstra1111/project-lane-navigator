/**
 * ReconcileBanner — Shows when project documents need reconciliation
 * after decisions have been applied.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { clearReconcile } from '@/lib/decisions/client';

interface Props {
  projectId: string;
}

export function ReconcileBanner({ projectId }: Props) {
  const qc = useQueryClient();

  const { data: reconcileDocs = [] } = useQuery({
    queryKey: ['reconcile-docs', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_documents')
        .select('id, title, file_name, doc_type, reconcile_reasons')
        .eq('project_id', projectId)
        .eq('needs_reconcile', true);
      return data || [];
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (docId?: string) => {
      await clearReconcile(projectId, docId);
    },
    onSuccess: () => {
      toast.success('Reconcile flags cleared');
      qc.invalidateQueries({ queryKey: ['reconcile-docs', projectId] });
    },
  });

  if (reconcileDocs.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-4 border-amber-500/20 bg-amber-500/5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground mb-1">
            Documents need reconciliation
          </p>
          <p className="text-[10px] text-muted-foreground mb-2">
            Recent decisions may affect these documents. Re-run analysis or rewrite to reconcile.
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {reconcileDocs.map(doc => (
              <Badge
                key={doc.id}
                variant="outline"
                className="text-[9px] border-amber-500/30 text-amber-400"
              >
                {doc.title || doc.file_name || doc.doc_type}
              </Badge>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1"
            onClick={() => clearMutation.mutate(undefined)}
            disabled={clearMutation.isPending}
          >
            {clearMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
            Dismiss All
          </Button>
        </div>
      </div>
    </div>
  );
}
