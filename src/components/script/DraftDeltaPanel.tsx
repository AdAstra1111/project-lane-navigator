/**
 * Draft Delta Panel: Shows coverage score changes across script versions.
 * Uses coverage_runs table to compare metrics across drafts.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Minus, GitCompareArrows } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { InfoTooltip } from '@/components/InfoTooltip';

interface CoverageRun {
  id: string;
  draft_label: string;
  created_at: string;
  metrics: Record<string, number> | null;
  lane: string | null;
}

interface DeltaItem {
  metric: string;
  prev: number;
  current: number;
  delta: number;
}

function DeltaRow({ item }: { item: DeltaItem }) {
  const isPositive = item.delta > 0;
  const isNeutral = item.delta === 0;

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground capitalize">{item.metric.replace(/_/g, ' ')}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-mono">{item.prev}</span>
        <span className="text-muted-foreground/40">→</span>
        <span className="text-xs text-foreground font-mono font-medium">{item.current}</span>
        <span className={`flex items-center gap-0.5 text-xs font-medium ${
          isNeutral ? 'text-muted-foreground' : isPositive ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {isNeutral ? <Minus className="h-3 w-3" /> : isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {isNeutral ? '—' : `${isPositive ? '+' : ''}${item.delta}`}
        </span>
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
}

export function DraftDeltaPanel({ projectId }: Props) {
  const { data: runs = [] } = useQuery({
    queryKey: ['coverage-runs-delta', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage_runs')
        .select('id, draft_label, created_at, metrics, lane')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as CoverageRun[];
    },
    enabled: !!projectId,
  });

  const deltas = useMemo(() => {
    if (runs.length < 2) return null;
    const prev = runs[runs.length - 2];
    const current = runs[runs.length - 1];
    if (!prev.metrics || !current.metrics) return null;

    const items: DeltaItem[] = [];
    const allKeys = new Set([...Object.keys(prev.metrics), ...Object.keys(current.metrics)]);
    for (const key of allKeys) {
      const p = (prev.metrics as any)[key];
      const c = (current.metrics as any)[key];
      if (typeof p === 'number' && typeof c === 'number') {
        items.push({ metric: key, prev: p, current: c, delta: c - p });
      }
    }
    return {
      prevLabel: prev.draft_label || `Draft ${runs.length - 1}`,
      currentLabel: current.draft_label || `Draft ${runs.length}`,
      prevDate: new Date(prev.created_at).toLocaleDateString(),
      currentDate: new Date(current.created_at).toLocaleDateString(),
      items,
      totalRuns: runs.length,
    };
  }, [runs]);

  if (!deltas || deltas.items.length === 0) return null;

  const netDelta = deltas.items.reduce((sum, i) => sum + i.delta, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card rounded-xl p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <GitCompareArrows className="h-4 w-4 text-primary" />
        <h4 className="font-display font-semibold text-foreground">Draft-to-Draft Delta</h4>
        <InfoTooltip text="Compares coverage metrics between your two most recent script drafts to show improvement or regression." />
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded ${
          netDelta > 0 ? 'bg-emerald-500/15 text-emerald-400' :
          netDelta < 0 ? 'bg-red-500/15 text-red-400' :
          'bg-muted text-muted-foreground'
        }`}>
          Net: {netDelta > 0 ? '+' : ''}{netDelta}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{deltas.prevLabel}</span>
        <span>({deltas.prevDate})</span>
        <span className="text-muted-foreground/40">→</span>
        <span className="font-medium text-foreground">{deltas.currentLabel}</span>
        <span>({deltas.currentDate})</span>
        <span className="ml-auto">{deltas.totalRuns} run{deltas.totalRuns > 1 ? 's' : ''} total</span>
      </div>

      <div>
        {deltas.items.map((item, i) => (
          <DeltaRow key={i} item={item} />
        ))}
      </div>
    </motion.div>
  );
}
