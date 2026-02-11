import { motion } from 'framer-motion';
import { Tv, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import type { TVReadinessResult } from '@/lib/tv-readiness-score';
import { Progress } from '@/components/ui/progress';

const STAGE_COLORS: Record<string, string> = {
  'Concept': 'text-muted-foreground',
  'Bible-Ready': 'text-amber-400',
  'Packaged': 'text-primary',
  'Commission-Ready': 'text-emerald-400',
};

const BREAKDOWN_LABELS: Record<string, { label: string; max: number }> = {
  engine: { label: 'Engine Sustainability', max: 25 },
  format: { label: 'Format Clarity', max: 20 },
  platform: { label: 'Platform Alignment', max: 20 },
  showrunner: { label: 'Showrunner Attachment', max: 20 },
  market: { label: 'Market & Finance', max: 15 },
};

export function TVReadinessScore({ readiness }: { readiness: TVReadinessResult }) {
  const scoreColor = readiness.score >= 75 ? 'text-emerald-400' : readiness.score >= 50 ? 'text-primary' : readiness.score >= 25 ? 'text-amber-400' : 'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-4 border-l-4 border-purple-500/50"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tv className="h-5 w-5 text-purple-400" />
          <div>
            <h3 className="font-display font-bold text-foreground">TV Series Readiness</h3>
            <p className={`text-sm font-medium ${STAGE_COLORS[readiness.stage]}`}>{readiness.stage}</p>
          </div>
        </div>
        <p className={`text-4xl font-display font-bold ${scoreColor}`}>
          {readiness.score}<span className="text-lg text-muted-foreground">/100</span>
        </p>
      </div>

      {/* Breakdown bars */}
      <div className="space-y-2">
        {Object.entries(readiness.breakdown).map(([key, value]) => {
          const { label, max } = BREAKDOWN_LABELS[key];
          const pct = Math.round((value / max) * 100);
          return (
            <div key={key} className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-foreground font-medium">{value}/{max}</span>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>
          );
        })}
      </div>

      {/* Strengths + Blockers */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          {readiness.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-foreground">{s}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {readiness.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-foreground">{b}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Next step */}
      <div className="flex items-center gap-2 text-sm border-t border-border/50 pt-3">
        <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-muted-foreground">{readiness.bestNextStep}</span>
      </div>
    </motion.div>
  );
}