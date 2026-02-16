import { useState } from 'react';
import { CheckCircle, Circle, AlertTriangle, FileText, Upload, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useDocumentPackage } from '@/hooks/useDocumentPackage';
import { formatDocType } from '@/lib/document-packages';
import { ConfirmDialog } from '@/components/ConfirmDialog';

interface Props {
  projectId: string | undefined;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  final: <CheckCircle className="h-3.5 w-3.5 text-primary" />,
  draft: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  missing: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
  stale: <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
  superseded: <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />,
};

const STATUS_LABELS: Record<string, string> = {
  final: 'Final',
  draft: 'Draft',
  missing: 'Missing',
  stale: 'Stale',
  superseded: 'Superseded',
};

export function DocumentPackagePanel({ projectId }: Props) {
  const {
    packageStatus, isLoading, packageReadyPct, canProgress,
    hasStale, currentResolverHash, pipelineStage, productionType, publish,
  } = useDocumentPackage(projectId);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground p-4">Loading package status…</div>;
  }

  const requiredDocs = packageStatus.filter(d => d.required);
  const optionalDocs = packageStatus.filter(d => !d.required);
  const finalizedDocTypes = packageStatus.filter(d => d.status === 'final' || d.status === 'draft').map(d => d.docType);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Document Package</h3>
          <p className="text-[10px] text-muted-foreground capitalize">
            {productionType?.replace(/[-_]/g, ' ')} · {pipelineStage?.replace(/[-_]/g, ' ')} stage
          </p>
        </div>
        <Badge variant={canProgress ? 'default' : 'secondary'} className="text-xs">
          {packageReadyPct}% Ready
        </Badge>
      </div>

      {/* Progress bar */}
      <Progress value={packageReadyPct} className="h-2" />

      {/* Stale warning */}
      {hasStale && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">Qualification changes detected</p>
            <p className="text-muted-foreground text-[10px]">
              Some finalized docs were built with outdated qualifications. Regenerate them before progressing.
            </p>
          </div>
        </div>
      )}

      {/* Required docs checklist */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          Required for stage ({requiredDocs.filter(d => d.status === 'final').length}/{requiredDocs.length})
        </p>
        <div className="space-y-0.5">
          {requiredDocs.map(doc => (
            <div key={doc.docType} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/50 group text-xs">
              {STATUS_ICONS[doc.status]}
              <span className={`flex-1 ${doc.status === 'missing' ? 'text-muted-foreground' : 'text-foreground'}`}>
                {formatDocType(doc.docType)}
              </span>
              <Badge variant="outline" className="text-[9px]">{STATUS_LABELS[doc.status]}</Badge>
              {doc.status === 'stale' && (
                <Badge variant="outline" className="text-[9px] bg-destructive/10 text-destructive">Stale</Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Optional docs */}
      {optionalDocs.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Optional / Future stages
          </p>
          <div className="space-y-0.5">
            {optionalDocs.map(doc => (
              <div key={doc.docType} className="flex items-center gap-2 py-1 px-1.5 rounded text-xs text-muted-foreground">
                {STATUS_ICONS[doc.status]}
                <span className="flex-1">{formatDocType(doc.docType)}</span>
                {doc.status !== 'missing' && (
                  <Badge variant="outline" className="text-[9px]">{STATUS_LABELS[doc.status]}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1 flex-1"
          disabled={finalizedDocTypes.length === 0 || publish.isPending}
          onClick={() => publish.mutate({ docTypes: finalizedDocTypes })}
        >
          <Upload className="h-3 w-3" />
          Publish Package
        </Button>
        <ConfirmDialog
          title="Finalize & Progress"
          description={`This will finalize all required documents and advance to the next stage. ${hasStale ? '⚠️ Some docs are stale — they will be published with outdated qualifications.' : ''}`}
          onConfirm={() => publish.mutate({
            docTypes: requiredDocs.filter(d => d.status === 'final' || d.status === 'draft').map(d => d.docType),
            advanceStage: true,
          })}
          variant={hasStale ? 'destructive' : 'default'}
        >
          <Button
            size="sm"
            className="text-xs gap-1"
            disabled={!canProgress || publish.isPending || hasStale}
          >
            <ChevronRight className="h-3 w-3" />
            Finalize & Progress
          </Button>
        </ConfirmDialog>
      </div>
    </div>
  );
}
