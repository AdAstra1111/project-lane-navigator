/**
 * ReconcileBanner — Shows when project documents need reconciliation
 * after decisions have been applied or spine amendments made.
 *
 * Phase 4 Stage 3: adds per-doc "Re-run analysis" for spine_amendment reasons.
 * IFFY Stage: adds per-doc "View Rewrite Plan" CTA opening RewritePlanPanel.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, RefreshCw, Loader2, ShieldCheck, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { clearReconcile } from '@/lib/decisions/client';
import { RewritePlanPanel } from '@/components/project/RewritePlanPanel';

interface Props {
  projectId: string;
}

/** Check if a doc has at least one spine_amendment reconcile reason */
function hasSpineAmendmentReason(reasons: any): boolean {
  if (!Array.isArray(reasons)) return false;
  return reasons.some(
    (r: any) => typeof r === 'object' && r !== null && r.type === 'spine_amendment'
  );
}

export function ReconcileBanner({ projectId }: Props) {
  const qc = useQueryClient();
  const [revalidatingDocId, setRevalidatingDocId] = useState<string | null>(null);
  const [planTarget, setPlanTarget] = useState<{
    docId: string; versionId: string | null; docType: string;
  } | null>(null);

  const { data: reconcileDocs = [] } = useQuery({
    queryKey: ['reconcile-docs', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_documents')
        .select('id, title, file_name, doc_type, reconcile_reasons, latest_version_id')
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

  const spineRevalidateMutation = useMutation({
    mutationFn: async (doc: { id: string; doc_type: string; latest_version_id: string | null }) => {
      if (!doc.latest_version_id) throw new Error('No version available for this document');
      setRevalidatingDocId(doc.id);
      const { data, error } = await supabase.functions.invoke('dev-engine-v2', {
        body: {
          action: 'spine_revalidate',
          projectId,
          documentId: doc.id,
          versionId: doc.latest_version_id,
          deliverableType: doc.doc_type,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setRevalidatingDocId(null);
      if (data?.spine_reasons_cleared) {
        toast.success('Spine revalidation complete — reconcile reasons cleared');
      } else {
        toast.info('Revalidation complete');
      }
      qc.invalidateQueries({ queryKey: ['reconcile-docs', projectId] });
    },
    onError: (err: any) => {
      setRevalidatingDocId(null);
      toast.error(`Revalidation failed: ${err.message || 'Unknown error'}`);
    },
  });

  if (reconcileDocs.length === 0) return null;

  return (
    <>
      <div className="glass-card rounded-xl p-4 border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground mb-1">
              Documents need reconciliation
            </p>
            <p className="text-[10px] text-muted-foreground mb-2">
              Recent decisions or spine amendments may affect these documents. Re-run analysis or rewrite to reconcile.
            </p>
            <div className="flex flex-col gap-1.5 mb-2">
              {reconcileDocs.map(doc => {
                const isSpine = hasSpineAmendmentReason(doc.reconcile_reasons);
                const isRevalidating = revalidatingDocId === doc.id;
                return (
                  <div key={doc.id} className="flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant="outline"
                      className="text-[9px] border-amber-500/30 text-amber-400"
                    >
                      {doc.title || doc.file_name || doc.doc_type}
                    </Badge>
                    {isSpine && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[9px] gap-0.5 px-1.5 text-violet-400 hover:text-violet-300"
                          onClick={() =>
                            spineRevalidateMutation.mutate({
                              id: doc.id,
                              doc_type: doc.doc_type,
                              latest_version_id: doc.latest_version_id,
                            })
                          }
                          disabled={isRevalidating || spineRevalidateMutation.isPending}
                        >
                          {isRevalidating ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-2.5 w-2.5" />
                          )}
                          Re-run analysis
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[9px] gap-0.5 px-1.5 text-blue-400 hover:text-blue-300"
                          onClick={() => setPlanTarget({
                            docId: doc.id,
                            versionId: doc.latest_version_id,
                            docType: doc.doc_type,
                          })}
                        >
                          <FileText className="h-2.5 w-2.5" />
                          View Rewrite Plan
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
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

      {/* Rewrite Plan Sheet */}
      <RewritePlanPanel
        open={!!planTarget}
        onOpenChange={(open) => { if (!open) setPlanTarget(null); }}
        projectId={projectId}
        documentId={planTarget?.docId || ''}
        versionId={planTarget?.versionId || null}
        docType={planTarget?.docType || ''}
      />
    </>
  );
}
