import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { useActiveSignals, TrendSignal } from '@/hooks/useTrends';
import { TrendScoreBadges } from '@/components/market/TrendScoreBadges';
import type { Project } from '@/lib/types';
import { SignalCard } from '@/components/market/SignalCard';
import { getBenchmarkToneTags, type StyleBenchmark } from '@/lib/rulesets/styleBenchmarks';
import { cn } from '@/lib/utils';

interface Props {
  project: Project;
  styleBenchmark?: string | null;
}

interface ScoredSignal {
  signal: TrendSignal;
  score: number;
  reasons: string[];
}

function scoreSignal(
  signal: TrendSignal,
  project: Project,
  benchmarkTones: string[],
): ScoredSignal {
  let score = 0;
  const reasons: string[] = [];
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = project.tone?.toLowerCase() || '';
  const format = project.format?.toLowerCase() || '';
  const lane = project.assigned_lane?.toLowerCase() || '';

  // Genre match (strong)
  if (signal.genre_tags?.some(gt => genres.some(pg => gt.toLowerCase().includes(pg) || pg.includes(gt.toLowerCase())))) {
    score += 3;
    reasons.push('genre');
  }
  // Tone match from project
  if (tone && signal.tone_tags?.some(tt => tt.toLowerCase().includes(tone) || tone.includes(tt.toLowerCase()))) {
    score += 2;
    reasons.push('tone');
  }
  // Format match
  if (format && signal.format_tags?.some(ft => ft.toLowerCase().includes(format) || format.includes(ft.toLowerCase()))) {
    score += 2;
    reasons.push('format');
  }
  // Lane relevance (boosted — most important for project specificity)
  if (lane && signal.lane_relevance?.some(lr => lr.toLowerCase().includes(lane) || lane.includes(lr.toLowerCase()))) {
    score += 3;
    reasons.push('lane');
  }
  // Benchmark tone tag overlap
  if (benchmarkTones.length > 0 && signal.tone_tags?.some(tt =>
    benchmarkTones.some(bt => tt.toLowerCase().includes(bt) || bt.includes(tt.toLowerCase()))
  )) {
    score += 2;
    reasons.push('benchmark');
  }

  return { signal, score, reasons };
}

const PHASE_DOT: Record<string, string> = {
  Early: 'bg-emerald-400',
  Building: 'bg-amber-400',
  Peaking: 'bg-red-400',
  Declining: 'bg-muted-foreground',
};

const CATEGORY_STYLES: Record<string, string> = {
  Narrative: 'bg-[hsl(260,50%,55%)]/15 text-[hsl(260,50%,70%)] border-[hsl(260,50%,55%)]/30',
  IP: 'bg-[hsl(175,60%,42%)]/15 text-[hsl(175,60%,58%)] border-[hsl(175,60%,42%)]/30',
  'Market Behaviour': 'bg-[hsl(215,70%,55%)]/15 text-[hsl(215,70%,70%)] border-[hsl(215,70%,55%)]/30',
};

const PHASE_STYLES: Record<string, string> = {
  Early: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Building: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Peaking: 'bg-red-500/15 text-red-400 border-red-500/30',
  Declining: 'bg-muted text-muted-foreground border-border',
};

const REASON_LABELS: Record<string, string> = {
  genre: 'Genre',
  tone: 'Tone',
  format: 'Format',
  lane: 'Lane',
  benchmark: 'Benchmark',
};

export function ProjectRelevantSignals({ project, styleBenchmark }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { data: allSignals = [], isLoading } = useActiveSignals();

  const benchmarkTones = useMemo(
    () => styleBenchmark ? getBenchmarkToneTags(styleBenchmark) : [],
    [styleBenchmark]
  );

  const relevantSignals = useMemo(() => {
    if (!allSignals.length) return [];
    return allSignals
      .map(s => scoreSignal(s, project, benchmarkTones))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.signal.last_updated_at).getTime() - new Date(a.signal.last_updated_at).getTime());
  }, [allSignals, project, benchmarkTones]);

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-5 animate-pulse space-y-3">
        <div className="h-5 w-48 bg-muted rounded" />
        <div className="h-20 bg-muted rounded" />
      </div>
    );
  }

  if (relevantSignals.length === 0) return null;

  const phaseCounts = relevantSignals.reduce<Record<string, number>>((acc, { signal }) => {
    acc[signal.cycle_phase] = (acc[signal.cycle_phase] || 0) + 1;
    return acc;
  }, {});

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.3 }}
      className="glass-card rounded-xl overflow-hidden"
    >
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-lg">Relevant Signals</h3>
          <Badge variant="secondary" className="text-xs ml-1">{relevantSignals.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {Object.entries(phaseCounts).map(([phase, count]) => (
            <div key={phase} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${PHASE_DOT[phase] || 'bg-muted-foreground'}`} />
              {count} {phase}
            </div>
          ))}
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} />
        </div>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-1.5">
              <Accordion type="multiple" className="space-y-1.5">
                {relevantSignals.map(({ signal, reasons }) => (
                  <AccordionItem key={signal.id} value={signal.id} className="glass-card rounded-lg border-none">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline gap-3">
                      <div className="flex items-center gap-2 text-left min-w-0 flex-1">
                        <span className="font-display font-semibold text-foreground text-sm truncate">{signal.name}</span>
                        <Badge className={`text-[10px] px-1.5 py-0 border shrink-0 ${CATEGORY_STYLES[signal.category] ?? ''}`}>
                          {signal.category}
                        </Badge>
                        <Badge className={`text-[10px] px-1.5 py-0 border shrink-0 ${PHASE_STYLES[signal.cycle_phase] ?? ''}`}>
                          {signal.cycle_phase}
                        </Badge>
                        {/* Match reason chips */}
                        {reasons.map(r => (
                          <Badge key={r} variant="outline" className="text-[9px] px-1 py-0 border-border text-muted-foreground shrink-0">
                            {REASON_LABELS[r] || r}
                          </Badge>
                        ))}
                      </div>
                      <TrendScoreBadges strength={signal.strength} velocity={signal.velocity} saturationRisk={signal.saturation_risk} compact />
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 pt-0">
                      <SignalCard signal={signal} index={0} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
