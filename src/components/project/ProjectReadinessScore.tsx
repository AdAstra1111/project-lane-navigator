import { motion } from 'framer-motion';
import { Gauge, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/InfoTooltip';
import type { ReadinessResult } from '@/lib/readiness-score';

const STAGE_STYLES: Record<string, string> = {
  'Early': 'bg-red-500/15 text-red-400 border-red-500/30',
  'Building': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Packaged': 'bg-primary/15 text-primary border-primary/30',
  'Finance-Ready': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? 'hsl(145, 55%, 42%)' : score >= 55 ? 'hsl(38, 65%, 55%)' : score >= 30 ? 'hsl(38, 80%, 55%)' : 'hsl(0, 62%, 50%)';

  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" stroke="hsl(var(--muted))" strokeWidth="6" fill="none" />
        <motion.circle
          cx="50" cy="50" r="40"
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-display font-bold text-foreground">{score}</span>
      </div>
    </div>
  );
}

function BreakdownBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium">{score}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay: 0.4 }}
        />
      </div>
    </div>
  );
}

interface Props {
  readiness: ReadinessResult;
}

export function ProjectReadinessScore({ readiness }: Props) {
  const stageStyle = STAGE_STYLES[readiness.stage] || STAGE_STYLES['Early'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card rounded-xl p-6 space-y-5"
    >
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-xl">Readiness Score</h3>
        <InfoTooltip text="This reflects packaging, finance fit, and market timing — not taste. It measures how prepared your project is for financing conversations." />
      </div>

      <div className="flex items-center gap-6">
        <ScoreRing score={readiness.score} />
        <div className="flex-1 space-y-3">
          <Badge className={`text-xs px-2 py-0.5 border ${stageStyle}`}>{readiness.stage}</Badge>
          <div className="space-y-2">
            <BreakdownBar label="Script" score={readiness.breakdown.script} max={25} />
            <BreakdownBar label="Packaging" score={readiness.breakdown.packaging} max={30} />
            <BreakdownBar label="Finance" score={readiness.breakdown.finance} max={25} />
            <BreakdownBar label="Market" score={readiness.breakdown.market} max={20} />
          </div>
        </div>
      </div>

      {/* Strengths & Blockers */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          {readiness.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{s}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {readiness.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Best Next Step */}
      <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2.5">
        <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-xs text-foreground font-medium">{readiness.bestNextStep}</p>
        <InfoTooltip text="This is the fastest way to improve your finance readiness right now." className="ml-auto" />
      </div>
    </motion.div>
  );
}
