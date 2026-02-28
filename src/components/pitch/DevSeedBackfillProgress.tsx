/**
 * DevSeedBackfillProgress — Visible progress panel for DevSeed backfill pipeline.
 * Shows per-doc status, gate scores, failures, and evolution tracking.
 */
import { CheckCircle, XCircle, Loader2, Clock, Pause, Play, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { DevSeedJob, DevSeedJobItem } from '@/hooks/useDevSeedBackfill';

interface Props {
  job: DevSeedJob;
  items: DevSeedJobItem[];
  isRunning: boolean;
  onPause: () => void;
  onResume: () => void;
  projectId?: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  queued: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  claimed: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  complete: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  claimed: 'Processing…',
  running: 'Processing…',
  complete: 'Done',
  failed: 'Failed',
};

function formatItemKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/:E(\d+)/, ' — Ep $1');
}

export function DevSeedBackfillProgress({ job, items, isRunning, onPause, onResume, projectId }: Props) {
  const total = items.length;
  const done = items.filter(i => i.status === 'complete' || i.status === 'failed').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const jobStatusLabel = job.status === 'complete'
    ? '✅ Complete'
    : job.status === 'paused'
      ? '⏸ Paused'
      : job.status === 'failed'
        ? '❌ Failed'
        : `Running (${done}/${total})`;

  return (
    <div className="space-y-3 mt-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">
          Backfill Progress: {jobStatusLabel}
        </div>
        <div className="flex gap-1.5">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={onPause} className="h-7 text-xs gap-1">
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {job.status === 'paused' && (
            <Button variant="outline" size="sm" onClick={onResume} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={pct} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {done}/{total} items processed{failed > 0 ? ` · ${failed} failed` : ''}
        {job.progress_json?.current_step && ` · Current: ${formatItemKey(job.progress_json.current_step)}`}
      </p>

      {/* Items table */}
      <div className="rounded-md border border-border/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border/30">
              <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Item</th>
              <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Doc Type</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Ep</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Status</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Gate</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Attempts</th>
              <th className="text-right px-2 py-1.5 font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-border/20 last:border-0">
                <td className="px-2 py-1.5 font-medium text-foreground">{formatItemKey(item.item_key)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{item.doc_type}</td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">
                  {item.episode_index ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className="inline-flex items-center gap-1">
                    {STATUS_ICONS[item.status] || null}
                    <span>{STATUS_LABELS[item.status] || item.status}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  {item.gate_score != null ? (
                    <Badge variant={item.gate_score >= 75 ? 'default' : 'secondary'} className="text-[10px] px-1.5">
                      CI:{item.gate_score}
                    </Badge>
                  ) : item.gate_failures?.length ? (
                    <Badge variant="destructive" className="text-[10px] px-1.5">
                      {item.gate_failures[0]}
                    </Badge>
                  ) : '—'}
                </td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">{item.attempts}</td>
                <td className="px-2 py-1.5 text-right">
                  {item.output_doc_id && projectId && (
                    <a
                      href={`/projects/${projectId}/development`}
                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Error display */}
      {job.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
          {job.error}
        </div>
      )}
    </div>
  );
}
