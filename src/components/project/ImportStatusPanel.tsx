/**
 * ImportStatusPanel — Shows pipeline readiness for screenplay-imported projects.
 * Queries real database state; renders nothing for non-imported projects.
 * Fail-closed: absent data = hidden panel.
 */

import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useImportPipelineStatus, type PipelineStageStatus } from '@/hooks/useImportPipelineStatus';

interface ImportStatusPanelProps {
  projectId: string | undefined;
}

function StageIcon({ status }: { status: PipelineStageStatus }) {
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  if (status === 'missing') return <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />;
}

export function ImportStatusPanel({ projectId }: ImportStatusPanelProps) {
  const pipeline = useImportPipelineStatus(projectId);

  // Fail closed: don't render for non-imported projects or while loading
  if (pipeline.isLoading || !pipeline.isImported) return null;

  const pct = Math.round((pipeline.completedCount / pipeline.totalStages) * 100);

  const readinessLabel =
    pipeline.isFullyReady ? 'Ready' :
    pipeline.completedCount >= Math.ceil(pipeline.totalStages / 2) ? 'Partial' :
    'Incomplete';

  const readinessStyle =
    readinessLabel === 'Ready' ? 'border-emerald-500/40 text-emerald-400' :
    readinessLabel === 'Partial' ? 'border-amber-500/40 text-amber-400' :
    'border-destructive/40 text-destructive';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-border/50 bg-card p-4 space-y-3 mt-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Import Pipeline</span>
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0 h-4', readinessStyle)}
          >
            {readinessLabel}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {pipeline.completedCount} / {pipeline.totalStages} stages
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full overflow-hidden bg-muted">
        <motion.div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            pipeline.isFullyReady ? 'bg-emerald-500' : 'bg-primary'
          )}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>

      {/* Stage list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {pipeline.stages.map(stage => (
          <div key={stage.key} className="flex items-center gap-2 text-xs py-0.5">
            <StageIcon status={stage.status} />
            <span className={cn(
              stage.status === 'done' && 'text-muted-foreground',
              stage.status === 'missing' && 'text-foreground font-medium',
              stage.status === 'unknown' && 'text-muted-foreground/50',
            )}>
              {stage.label}
            </span>
            {stage.count != null && stage.count > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">({stage.count})</span>
            )}
          </div>
        ))}
      </div>

      {/* Warning for incomplete stages */}
      {!pipeline.isFullyReady && (
        <p className="text-[10px] text-amber-400/80 border-t border-border/40 pt-2">
          Some enrichment stages are incomplete — downstream analysis may be limited.
        </p>
      )}
    </motion.div>
  );
}
