/**
 * ModeReadinessScore — universal readiness display for non-film/TV modes.
 * Shows mode-specific scoring dimensions with visual bars and stage indicator.
 */
import { motion } from 'framer-motion';
import { getFormatMeta } from '@/lib/mode-engine';
import type { ModeReadinessResult } from '@/lib/mode-readiness';

interface Props {
  readiness: ModeReadinessResult;
  format: string;
}

export function ModeReadinessScore({ readiness, format }: Props) {
  const meta = getFormatMeta(format);
  const Icon = meta.icon;

  const stageColor =
    readiness.score >= 70 ? 'text-emerald-400' :
    readiness.score >= 40 ? 'text-amber-400' :
    'text-red-400';

  const ringColor =
    readiness.score >= 70 ? 'hsl(142 71% 45%)' :
    readiness.score >= 40 ? 'hsl(38 92% 50%)' :
    'hsl(0 84% 60%)';

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${meta.color}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{meta.label} Readiness</p>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${stageColor}`}>{readiness.stage}</span>
            </div>
          </div>
        </div>
        {/* Score ring */}
        <div className="relative" style={{ width: 52, height: 52 }}>
          <svg className="-rotate-90" width={52} height={52} viewBox="0 0 52 52">
            <circle cx={26} cy={26} r={22} fill="none" stroke="hsl(var(--muted))" strokeWidth="3.5" />
            <motion.circle
              cx={26} cy={26} r={22} fill="none" stroke={ringColor} strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 22}
              initial={{ strokeDashoffset: 2 * Math.PI * 22 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 22 * (1 - readiness.score / 100) }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">
            {readiness.score}
          </span>
        </div>
      </div>

      {/* Dimension breakdown */}
      <div className="space-y-2">
        {readiness.dimensions.map(dim => {
          const pct = Math.round((dim.score / dim.max) * 100);
          return (
            <div key={dim.key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{dim.label}</span>
                <span className="text-foreground font-medium">{dim.score}/{dim.max}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: ringColor }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Strengths & Blockers */}
      <div className="flex gap-4 text-xs">
        {readiness.strengths.length > 0 && (
          <div className="flex-1">
            <p className="text-emerald-400 font-medium mb-1">Strengths</p>
            {readiness.strengths.map((s, i) => (
              <p key={i} className="text-muted-foreground">• {s}</p>
            ))}
          </div>
        )}
        {readiness.blockers.length > 0 && (
          <div className="flex-1">
            <p className="text-red-400 font-medium mb-1">Blockers</p>
            {readiness.blockers.map((b, i) => (
              <p key={i} className="text-muted-foreground">• {b}</p>
            ))}
          </div>
        )}
      </div>

      {/* Next step */}
      <div className="text-xs text-muted-foreground border-t border-border/30 pt-3">
        <span className="text-foreground font-medium">Next step:</span> {readiness.bestNextStep}
      </div>
    </div>
  );
}
