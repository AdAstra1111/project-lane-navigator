import { motion } from 'framer-motion';
import { Globe, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { WesternEntryAdvantage } from '@/lib/trend-viability';

interface Props {
  advantage: WesternEntryAdvantage;
}

export function WesternEntryAdvantagePanel({ advantage }: Props) {
  const scoreColor = advantage.score >= 70
    ? 'text-emerald-400'
    : advantage.score >= 45
      ? 'text-amber-400'
      : 'text-red-400';

  const scoreLabel = advantage.score >= 70
    ? 'Strong Western Market Fit'
    : advantage.score >= 45
      ? 'Moderate Western Adaptability'
      : 'Limited Western Appeal';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Globe className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground text-sm">
            Western Entry Advantage Index
          </h4>
          <p className="text-xs text-muted-foreground">
            Cross-market adaptability for Western audiences
          </p>
        </div>
        <div className="text-right">
          <span className={cn('text-2xl font-bold font-display', scoreColor)}>
            {advantage.score}
          </span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
      </div>

      <Badge variant="outline" className={cn('text-xs', scoreColor)}>
        <TrendingUp className="h-3 w-3 mr-1" />
        {scoreLabel}
      </Badge>

      <div className="space-y-3">
        {advantage.factors.map((factor) => {
          const factorColor = factor.score >= 70
            ? 'text-emerald-400'
            : factor.score >= 45
              ? 'text-amber-400'
              : 'text-red-400';

          return (
            <div key={factor.label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{factor.label}</span>
                <span className={cn('text-xs font-mono font-semibold', factorColor)}>
                  {factor.score}
                </span>
              </div>
              <Progress value={factor.score} className="h-1" />
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground border-t border-border/30 pt-3">
        Derived from Micro-Genre Heat, Localization Scaling, Episodic Hook Patterns, and App Store Momentum engines. Higher scores indicate stronger cross-cultural adaptation potential.
      </p>
    </motion.div>
  );
}
