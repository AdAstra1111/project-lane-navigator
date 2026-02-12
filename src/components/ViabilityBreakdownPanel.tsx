import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ViabilityComponents } from '@/lib/master-viability';

const COMPONENT_META: { key: keyof ViabilityComponents; label: string }[] = [
  { key: 'lane_fit', label: 'Lane Fit' },
  { key: 'structural_strength', label: 'Structural Strength' },
  { key: 'market_heat', label: 'Market Heat' },
  { key: 'trend_alignment', label: 'Trend Alignment' },
  { key: 'budget_feasibility', label: 'Budget Feasibility' },
  { key: 'packaging_leverage', label: 'Packaging Leverage' },
];

function getBarColor(score: number) {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  if (score >= 25) return 'bg-amber-600';
  return 'bg-red-500';
}

interface Props {
  components: ViabilityComponents;
}

export function ViabilityBreakdownPanel({ components }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Layers className="h-3 w-3" />
        <span>View Viability Breakdown</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid gap-2.5 pt-3">
              {COMPONENT_META.map(({ key, label }) => {
                const value = components[key];
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-mono font-medium text-foreground">{value}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className={cn('h-full rounded-full', getBarColor(value))}
                        initial={{ width: 0 }}
                        animate={{ width: `${value}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.05 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
