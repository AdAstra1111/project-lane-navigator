/**
 * ActivityLogPanel — Minimal activity log for the AI tab in ProjectShell drawer.
 * Shows recent project activity from project_activity or in-memory events.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface ActivityEntry {
  id: string;
  timestamp: string;
  label: string;
  status: 'running' | 'success' | 'fail';
}

const STATUS_CONFIG = {
  running: { icon: Loader2, color: 'text-primary', animate: 'animate-spin' },
  success: { icon: CheckCircle2, color: 'text-emerald-500', animate: '' },
  fail: { icon: XCircle, color: 'text-destructive', animate: '' },
} as const;

export function ActivityLogPanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1) Fetch recent jobs for this project
      const { data: jobs } = await supabase
        .from('auto_run_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (cancelled) return;

      const jobIds = (jobs ?? []).map((j) => j.id);
      if (jobIds.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // 2) Fetch steps belonging to those jobs
      const { data: steps } = await supabase
        .from('auto_run_steps')
        .select('id, created_at, action, summary, job_id')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false })
        .limit(20);

      if (cancelled) return;

      // Build a job status lookup for deriving step status
      const jobStatusMap = new Map((jobs ?? []).map((j) => [j.id, j.status]));

      setEntries(
        (steps ?? []).map((s) => {
          const jobStatus = jobStatusMap.get(s.job_id) ?? 'done';
          let status: 'running' | 'success' | 'fail' = 'success';
          if (jobStatus === 'running') status = 'running';
          else if (jobStatus === 'error' || jobStatus === 'failed') status = 'fail';
          return {
            id: s.id,
            timestamp: s.created_at ?? new Date().toISOString(),
            label: s.summary || s.action,
            status,
          };
        })
      );
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 gap-2">
        <Clock className="h-5 w-5 text-muted-foreground/30" />
        <p className="text-[11px] text-muted-foreground/50 text-center">
          No AI activity yet for this project.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {entries.map((entry) => {
        const cfg = STATUS_CONFIG[entry.status];
        const Icon = cfg.icon;
        return (
          <div
            key={entry.id}
            className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/10 last:border-b-0 hover:bg-muted/20 transition-colors"
          >
            <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', cfg.color, cfg.animate)} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-foreground/80 leading-snug truncate">
                {entry.label}
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
