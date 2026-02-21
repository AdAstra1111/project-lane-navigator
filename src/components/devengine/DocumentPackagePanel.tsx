/**
 * DocumentPackagePanel — Project Package UI.
 * Single source of truth: useProjectPackage resolver.
 */
import { useState } from 'react';
import { CheckCircle, Clock, AlertCircle, AlertTriangle, ChevronRight, Share2, Package, Download, FileX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useProjectPackage } from '@/hooks/useProjectPackage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PackageBar } from '@/components/devengine/PackageBar';
import { DownloadPackageButton } from '@/components/devengine/DownloadPackageButton';
import { ShareWithModal } from '@/components/devengine/ShareWithModal';
import { ALL_DOC_TYPE_LABELS, getCanonicalFilename } from '@/lib/can-promote-to-script';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { approveAndActivateMany } from '@/lib/active-folder/approveAndActivate';

interface Props {
  projectId: string | undefined;
}

function getLabel(docType: string): string {
  return (
    ALL_DOC_TYPE_LABELS[docType] ??
    docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Individual package item row with download + approved date */
function PackageItemRow({ label, isApproved, createdAt, versionId, projectTitle, docType }: {
  label: string; isApproved: boolean; createdAt: string; versionId: string;
  projectTitle?: string; docType?: string;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { data: ver } = await (supabase as any)
        .from('project_document_versions')
        .select('plaintext')
        .eq('id', versionId)
        .single();
      const text = ver?.plaintext;
      if (!text) {
        toast.error('File content not available for download');
        return;
      }
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getCanonicalFilename({
        projectTitle,
        docType,
        versionTag: `v${versionId.slice(0, 8)}`,
        date: new Date().toISOString().slice(0, 10),
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/50 text-xs group">
      {isApproved ? (
        <CheckCircle className="h-3.5 w-3.5 text-[hsl(var(--chart-2))] shrink-0" />
      ) : (
        <Clock className="h-3.5 w-3.5 text-[hsl(var(--chart-4))] shrink-0" />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex-1 text-foreground truncate">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>{label}</p>
          {createdAt && <p className="text-muted-foreground text-[10px]">{new Date(createdAt).toLocaleDateString()}</p>}
        </TooltipContent>
      </Tooltip>
      <Badge
        variant="outline"
        className={
          isApproved
            ? 'text-[9px] border-[hsl(var(--chart-2)/0.4)] text-[hsl(var(--chart-2))] bg-[hsl(var(--chart-2)/0.08)]'
            : 'text-[9px] border-[hsl(var(--chart-4)/0.4)] text-[hsl(var(--chart-4))] bg-[hsl(var(--chart-4)/0.08)]'
        }
      >
        {isApproved ? 'Approved' : 'Latest'}
      </Badge>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:text-foreground"
        aria-label={`Download ${label}`}
      >
        <Download className="h-3 w-3" />
      </button>
    </div>
  );
}

export function DocumentPackagePanel({ projectId }: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const qc = useQueryClient();

  const { pkg, isLoading } = useProjectPackage(projectId);

  // Publish mutation (finalize & progress)
  const publish = useMutation({
    mutationFn: async ({ docTypes, advanceStage }: { docTypes: string[]; advanceStage?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('publish-package', {
        body: { projectId, docTypes, advanceStage },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      const publishedCount = data?.published?.length || 0;
      const errorCount = data?.errors?.length || 0;
      if (errorCount > 0) {
        toast.warning(`Published ${publishedCount} docs, ${errorCount} errors`);
      } else {
        toast.success(
          `Published ${publishedCount} documents${data?.advancedStage ? ' — stage advanced' : ''}`
        );
      }
      if (projectId && publishedCount > 0) {
        try {
          const versionIds = [
            ...(pkg?.deliverables || []),
          ]
            .filter(d => (data?.published || []).includes(d.deliverable_type))
            .map(d => d.version_id)
            .filter(Boolean);
          if (versionIds.length > 0) {
            await approveAndActivateMany({
              projectId,
              documentVersionIds: versionIds,
              sourceFlow: 'package_publish',
            });
          }
        } catch (err) {
          console.error('Approve+activate after publish failed:', err);
        }
      }
      qc.invalidateQueries({ queryKey: ['project-package', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
      qc.invalidateQueries({ queryKey: ['active-folder', projectId] });
    },
    onError: (err: any) => {
      toast.error('Publish failed: ' + (err.message || 'Unknown error'));
    },
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground p-4">Loading project package…</div>;
  }

  if (!pkg) {
    return <div className="text-xs text-muted-foreground p-4">No package data available.</div>;
  }

  const {
    deliverables,
    season_scripts,
    format,
    pipelineStage,
    projectTitle,
    approvedCount,
    totalRequired,
    packageReadyPct,
  } = pkg;

  // All doc types that have content (for publish)
  const publishableDocTypes = deliverables.map(d => d.deliverable_type);

  // Can progress = everything is approved
  const canProgress = totalRequired > 0 && deliverables.every(d => d.is_approved);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-primary" />
            Project Package
          </h3>
          <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
            {format?.replace(/[-_]/g, ' ')} · {pipelineStage?.replace(/[-_]/g, ' ')} stage
          </p>
        </div>
        <Badge
          variant={packageReadyPct === 100 ? 'default' : 'secondary'}
          className="text-xs"
        >
          {approvedCount}/{totalRequired} Approved
        </Badge>
      </div>

      {/* Progress bar */}
      <Progress value={packageReadyPct} className="h-2" />

      {/* Deliverable chain */}
      {projectId && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Deliverable Chain
          </p>
          <PackageBar projectId={projectId} format={format} />
        </div>
      )}

      {/* Deliverables list */}
      {deliverables.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Deliverables ({approvedCount}/{deliverables.length + season_scripts.length})
          </p>
          <div className="space-y-0.5">
            {deliverables.map(doc => (
              <PackageItemRow
                key={doc.deliverable_type}
                label={doc.label}
                isApproved={doc.is_approved}
                createdAt={doc.created_at}
                versionId={doc.version_id}
                projectTitle={projectTitle}
                docType={doc.deliverable_type}
              />
            ))}

            {/* Season scripts */}
            {season_scripts.map(ss => (
              <div key={ss.document_id}>
                <PackageItemRow
                  label={ss.season_number ? `Master Script — Season ${ss.season_number}` : 'Master Season Script'}
                  isApproved={ss.is_approved}
                  createdAt={ss.created_at}
                  versionId={ss.version_id}
                  projectTitle={projectTitle}
                  docType="season_master_script"
                />
                {ss.is_out_of_date && (
                  <div className="flex items-center gap-1.5 ml-6 text-[9px] text-[hsl(var(--chart-4))]">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Out of date — episode scripts have changed since last compile
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {totalRequired === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          No documents generated yet. Start generating documents to build your project package.
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        {/* Download Package (Server ZIP + Quick ZIP) */}
        {projectId && pkg && (
          <DownloadPackageButton
            projectId={projectId}
            format={format}
            pkg={pkg}
          />
        )}

        {/* Share Package */}
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1"
          onClick={() => setShareOpen(true)}
        >
          <Share2 className="h-3 w-3" />
          Share Package
        </Button>

        {/* Finalize & Progress */}
        <ConfirmDialog
          title="Finalize & Progress"
          description="This will finalize all documents and advance to the next stage."
          onConfirm={() =>
            publish.mutate({
              docTypes: publishableDocTypes,
              advanceStage: true,
            })
          }
          variant="default"
        >
          <Button
            size="sm"
            className="text-xs gap-1"
            disabled={!canProgress || publish.isPending || publishableDocTypes.length === 0}
          >
            <ChevronRight className="h-3 w-3" />
            Finalize & Progress
          </Button>
        </ConfirmDialog>
      </div>

      {/* Share Modal */}
      {projectId && (
        <ShareWithModal
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={projectId}
          projectTitle={projectTitle}
          pkg={pkg}
        />
      )}
    </div>
    </TooltipProvider>
  );
}
