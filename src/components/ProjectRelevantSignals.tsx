import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useActiveSignals, TrendSignal } from '@/hooks/useTrends';
import type { Project } from '@/lib/types';
import { SignalCard } from '@/components/SignalCard';

interface Props {
  project: Project;
}

/**
 * Matches active trend signals against a project's genres, tone, format, and lane.
 * Signals are scored by how many dimensions overlap, then sorted by relevance.
 */
function scoreSignal(signal: TrendSignal, project: Project): number {
  let score = 0;
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = project.tone?.toLowerCase() || '';
  const format = project.format?.toLowerCase() || '';
  const lane = project.assigned_lane?.toLowerCase() || '';

  // Genre overlap
  if (signal.genre_tags?.some(gt => genres.some(pg => gt.toLowerCase().includes(pg) || pg.includes(gt.toLowerCase())))) {
    score += 3;
  }

  // Tone overlap
  if (tone && signal.tone_tags?.some(tt => tt.toLowerCase().includes(tone) || tone.includes(tt.toLowerCase()))) {
    score += 2;
  }

  // Format overlap
  if (format && signal.format_tags?.some(ft => ft.toLowerCase().includes(format) || format.includes(ft.toLowerCase()))) {
    score += 2;
  }

  // Lane overlap
  if (lane && signal.lane_relevance?.some(lr => lr.toLowerCase().includes(lane) || lane.includes(lr.toLowerCase()))) {
    score += 1;
  }

  return score;
}

const PHASE_DOT: Record<string, string> = {
  Early: 'bg-emerald-400',
  Building: 'bg-amber-400',
  Peaking: 'bg-red-400',
  Declining: 'bg-muted-foreground',
};

export function ProjectRelevantSignals({ project }: Props) {
  const { data: allSignals = [], isLoading } = useActiveSignals();

  const relevantSignals = useMemo(() => {
    if (!allSignals.length) return [];
    return allSignals
      .map(s => ({ signal: s, score: scoreSignal(s, project) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.signal.last_updated_at).getTime() - new Date(a.signal.last_updated_at).getTime());
  }, [allSignals, project]);

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-5 animate-pulse space-y-3">
        <div className="h-5 w-48 bg-muted rounded" />
        <div className="h-20 bg-muted rounded" />
      </div>
    );
  }

  if (relevantSignals.length === 0) return null;

  // Summary counts by phase
  const phaseCounts = relevantSignals.reduce<Record<string, number>>((acc, { signal }) => {
    acc[signal.cycle_phase] = (acc[signal.cycle_phase] || 0) + 1;
    return acc;
  }, {});

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.3 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-xl">
            Relevant Signals
          </h3>
          <Badge variant="secondary" className="text-xs ml-1">{relevantSignals.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {Object.entries(phaseCounts).map(([phase, count]) => (
            <div key={phase} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${PHASE_DOT[phase] || 'bg-muted-foreground'}`} />
              {count} {phase}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {relevantSignals.map(({ signal }, i) => (
          <SignalCard key={signal.id} signal={signal} index={i} />
        ))}
      </div>
    </motion.div>
  );
}
