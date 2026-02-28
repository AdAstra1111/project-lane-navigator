/**
 * DevSeedBackfillProgress — Visible progress panel for DevSeed backfill pipeline.
 * Shows per-doc status, gate scores, failures, blockers, and evolution tracking.
 */
import { CheckCircle, XCircle, Loader2, Clock, Pause, Play, ExternalLink, AlertTriangle, ShieldAlert } from 'lucide-react';
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

interface Blocker {
  type: string;
  doc_type: string;
  item_key: string;
  gate_failures?: string[];
  output_doc_id?: string;
  output_version_id?: string;
  status?: string;
}

export function DevSeedBackfillProgress({ job, items, isRunning, onPause, onResume, projectId }: Props) {
  const total = items.length;
  const done = items.filter(i => i.status === 'complete' || i.status === 'failed').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const isBlocked = job.status === 'paused_blocked';
  const blockers: Blocker[] = ((job.progress_json?.blockers || []) as unknown as Blocker[]);

  const jobStatusLabel = job.status === 'complete'
    ? '✅ Complete'
    : isBlocked
      ? '🚫 Blocked'
      : job.status === 'paused'
        ? '⏸ Paused'
        : job.status === 'failed'
          ? '❌ Failed'
          : `Running (${done}/${total})`;

  // Separate foundation and devpack items
  const foundationItems = items.filter(i => (i as any).phase === 'foundation');
  const devpackItems = items.filter(i => (i as any).phase === 'devpack');

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
          {(job.status === 'paused' || isBlocked) && (
            <Button variant="outline" size="sm" onClick={onResume} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> {isBlocked ? 'Retry' : 'Resume'}
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

      {/* ── BLOCKER PANEL ── */}
      {isBlocked && blockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <ShieldAlert className="h-4 w-4" />
            Foundation docs must be approved before dev pack can proceed
          </div>
          <div className="space-y-1.5">
            {blockers.map((b, i) => (
              <div key={i} className="flex items-center justify-between text-xs rounded bg-destructive/10 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                  <span className="font-medium text-foreground">{formatItemKey(b.doc_type)}</span>
                  {b.gate_failures?.map((f, fi) => (
                    <Badge key={fi} variant="destructive" className="text-[10px] px-1.5">{f}</Badge>
                  ))}
                </div>
                {b.output_doc_id && projectId && (
                  <a
                    href={`/projects/${projectId}/development`}
                    className="inline-flex items-center gap-0.5 text-primary hover:underline text-[11px]"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Fix the failing documents, then click <strong>Retry</strong> to re-run the foundation gate.
          </p>
        </div>
      )}

      {/* Foundation items section */}
      {foundationItems.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Foundation (DevSeed 5)</p>
          <ItemTable items={foundationItems} projectId={projectId} />
        </div>
      )}

      {/* Dev pack items section */}
      {devpackItems.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Development Pack</p>
          {isBlocked ? (
            <div className="rounded-md border border-border/30 bg-muted/30 p-2 text-xs text-muted-foreground italic">
              Waiting for foundation approval…
            </div>
          ) : (
            <ItemTable items={devpackItems} projectId={projectId} />
          )}
        </div>
      )}

      {/* Fallback: show all items as single table if no phase info */}
      {foundationItems.length === 0 && devpackItems.length === 0 && items.length > 0 && (
        <ItemTable items={items} projectId={projectId} />
      )}

      {/* Error display */}
      {job.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
          {job.error}
        </div>
      )}
    </div>
  );
}

function ItemTable({ items, projectId }: { items: DevSeedJobItem[]; projectId?: string }) {
  return (
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
  );
}
