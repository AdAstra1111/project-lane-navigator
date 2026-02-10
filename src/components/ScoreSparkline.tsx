import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScoreSnapshot } from '@/hooks/useScoreHistory';

interface ScoreSparklineProps {
  history: ScoreSnapshot[];
  field: 'readiness_score' | 'finance_readiness_score';
  label: string;
  className?: string;
}

export function ScoreSparkline({ history, field, label, className }: ScoreSparklineProps) {
  const points = useMemo(() => history.map(h => h[field]), [history, field]);

  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const padding = 2;

  const pathD = points
    .map((val, i) => {
      const x = padding + (i / (points.length - 1)) * (w - padding * 2);
      const y = h - padding - ((val - min) / range) * (h - padding * 2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');

  const latest = points[points.length - 1];
  const prev = points[points.length - 2];
  const delta = latest - prev;
  const TrendIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground';
  const strokeColor = delta > 0 ? 'hsl(142 71% 45%)' : delta < 0 ? 'hsl(0 84% 60%)' : 'hsl(var(--muted-foreground))';

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-1">
          <TrendIcon className={cn('h-3 w-3', trendColor)} />
          <span className={cn('text-xs font-medium', trendColor)}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        </div>
      </div>
      <motion.svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <motion.path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </motion.svg>
    </div>
  );
}
