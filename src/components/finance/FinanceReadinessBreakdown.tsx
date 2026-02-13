import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SubscoreBarProps {
  label: string;
  score: number;
  max: number;
  delay?: number;
}

function SubscoreBar({ label, score, max, delay = 0 }: SubscoreBarProps) {
  const pct = Math.round((score / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(
          'font-medium',
          pct >= 60 ? 'text-emerald-400' : pct >= 30 ? 'text-amber-400' : 'text-red-400'
        )}>{score}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={cn(
            'h-full rounded-full',
            pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500'
          )}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay: 0.2 + delay }}
        />
      </div>
    </div>
  );
}

interface FinanceReadinessBreakdownProps {
  subscores: {
    scriptClarity: number;
    packagingStrength: number;
    financeStructure: number;
    marketPosition: number;
    geography: number;
    narrativeCoherence: number;
  };
}

export function FinanceReadinessBreakdown({ subscores }: FinanceReadinessBreakdownProps) {
  const items = [
    { label: 'Script Clarity', score: subscores.scriptClarity, max: 15 },
    { label: 'Packaging Strength', score: subscores.packagingStrength, max: 25 },
    { label: 'Finance Structure', score: subscores.financeStructure, max: 25 },
    { label: 'Market Position', score: subscores.marketPosition, max: 15 },
    { label: 'Geography', score: subscores.geography, max: 10 },
    { label: 'Narrative Coherence', score: subscores.narrativeCoherence, max: 10 },
  ];

  return (
    <div className="glass-card rounded-xl p-5 space-y-3">
      <h4 className="text-sm font-medium text-foreground">Score Breakdown</h4>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <SubscoreBar key={item.label} {...item} delay={i * 0.05} />
        ))}
      </div>
    </div>
  );
}
