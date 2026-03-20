/**
 * ProcessingCenter — Global drawer showing all active/recent processes.
 * Accessible from the ProjectShell top bar.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Activity, X, CheckCircle2, XCircle, Loader2, Clock, ExternalLink } from 'lucide-react';
import { useActiveProcesses } from '@/lib/processing/ProcessingContext';
import { InlineProcessBar } from './InlineProcessBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProcessStatus } from '@/lib/processing/types';

function elapsed(startedAt: number): string {
  const s = Math.round((Date.now() - startedAt) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATUS_BADGE: Record<ProcessStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Queued', variant: 'outline' },
  running: { label: 'Running', variant: 'default' },
  waiting: { label: 'Waiting', variant: 'secondary' },
  completed: { label: 'Done', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
};

export function ProcessingCenterButton() {
  const [open, setOpen] = useState(false);
  const processes = useActiveProcesses();
  const activeCount = processes.filter(p => p.status === 'running' || p.status === 'queued' || p.status === 'waiting').length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'relative h-8 w-8 rounded-md flex items-center justify-center transition-colors',
          'text-muted-foreground/60 hover:text-foreground hover:bg-muted/40',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          activeCount > 0 && 'text-primary',
        )}
      >
        <Activity className={cn('h-3.5 w-3.5', activeCount > 0 && 'animate-pulse')} />
        {activeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] rounded-full bg-primary text-[8px] text-primary-foreground font-bold flex items-center justify-center px-0.5">
            {activeCount}
          </span>
        )}
      </button>

      {open && <ProcessingDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function ProcessingDrawer({ onClose }: { onClose: () => void }) {
  const processes = useActiveProcesses();
  const navigate = useNavigate();

  const active = processes.filter(p => p.status === 'running' || p.status === 'queued' || p.status === 'waiting');
  const recent = processes.filter(p => p.status === 'completed' || p.status === 'failed');

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-[61] w-[360px] max-w-[90vw] bg-background border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Processing Center</h2>
            {active.length > 0 && (
              <Badge variant="default" className="text-[9px] h-4 px-1.5">
                {active.length} active
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            {processes.length === 0 && (
              <div className="text-center py-12">
                <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">No active processes</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Processes will appear here when workflows are running
                </p>
              </div>
            )}

            {/* Active processes */}
            {active.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                  Active
                </p>
                {active.map(p => (
                  <ProcessCard key={p.id} process={p} onNavigate={(href) => { navigate(href); onClose(); }} />
                ))}
              </div>
            )}

            {/* Recent completed/failed */}
            {recent.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                  Recent
                </p>
                {recent.map(p => (
                  <ProcessCard key={p.id} process={p} onNavigate={(href) => { navigate(href); onClose(); }} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

function ProcessCard({ process: p, onNavigate }: { process: import('@/lib/processing/types').ActiveProcess; onNavigate: (href: string) => void }) {
  const badge = STATUS_BADGE[p.status];

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2 transition-colors',
      p.status === 'running' ? 'border-primary/30 bg-primary/5' :
      p.status === 'failed' ? 'border-destructive/30 bg-destructive/5' :
      'border-border/50 bg-card/50',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground truncate">{p.type}</span>
            <Badge variant={badge.variant} className="text-[8px] h-3.5 px-1 shrink-0">
              {badge.label}
            </Badge>
          </div>
          {p.projectTitle && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{p.projectTitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] text-muted-foreground tabular-nums">{elapsed(p.startedAt)}</span>
          {p.href && (
            <button
              onClick={() => onNavigate(p.href!)}
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <InlineProcessBar
        status={p.status}
        stage={p.stages?.[p.currentStageIndex ?? 0]}
        description={p.stageDescription}
        percent={p.percent}
        processed={p.processed}
        total={p.total}
        error={p.error}
      />
    </div>
  );
}
