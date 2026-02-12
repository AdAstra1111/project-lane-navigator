/**
 * Reusable per-stage readiness display with animated ring + breakdown bars.
 */

import { motion } from 'framer-motion';
import { Gauge, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { InfoTooltip } from '@/components/InfoTooltip';
import { getStageMeta, type LifecycleStage } from '@/lib/lifecycle-stages';
import type { StageReadinessResult, StageBreakdownItem } from '@/lib/stage-readiness';

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? 'hsl(145, 55%, 42%)'
    : score >= 55 ? 'hsl(38, 65%, 55%)'
    : score >= 30 ? 'hsl(38, 80%, 55%)'
    : 'hsl(0, 62%, 50%)';

  return (
    <div className="relative w-20 h-20">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
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
        <span className="text-xl font-display font-bold text-foreground">{score}</span>
      </div>
    </div>
  );
}

function BreakdownBar({ item }: { item: StageBreakdownItem }) {
  const pct = Math.round((item.score / item.max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{item.label}</span>
        <span className="text-foreground font-medium">{item.score}/{item.max}</span>
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
  readiness: StageReadinessResult;
  compact?: boolean;
}

export function StageReadinessScore({ readiness, compact }: Props) {
  const stageMeta = getStageMeta(readiness.stage);

  if (compact) {
    return (
      <div className="glass-card rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <ScoreRing score={readiness.score} />
          <div className="flex-1 space-y-2">
            {readiness.breakdown.map((item, i) => (
              <BreakdownBar key={i} item={item} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center gap-2">
        <stageMeta.icon className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-lg">
          {stageMeta.label} Readiness
        </h3>
        <InfoTooltip text={`How prepared this project is for ${stageMeta.label.toLowerCase()} — based on completeness of key inputs.`} />
      </div>

      <div className="flex items-center gap-5">
        <ScoreRing score={readiness.score} />
        <div className="flex-1 space-y-2">
          {readiness.breakdown.map((item, i) => (
            <BreakdownBar key={i} item={item} />
          ))}
        </div>
      </div>

      {/* Strengths & Blockers */}
      {(readiness.strengths.length > 0 || readiness.blockers.length > 0) && (
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
      )}

      {/* Best Next Step */}
      <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
        <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-xs text-foreground font-medium">{readiness.bestNextStep}</p>
      </div>
    </motion.div>
  );
}
