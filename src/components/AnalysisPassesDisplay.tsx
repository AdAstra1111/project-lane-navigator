import { motion } from 'framer-motion';
import { Layers, Sparkles, TrendingUp } from 'lucide-react';
import { AnalysisPasses } from '@/lib/types';

const PASS_CONFIG = {
  structure: {
    icon: Layers,
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
  },
  creative: {
    icon: Sparkles,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
  },
  market: {
    icon: TrendingUp,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
  },
} as const;

interface AnalysisPassesDisplayProps {
  passes: AnalysisPasses;
}

export function AnalysisPassesDisplay({ passes }: AnalysisPassesDisplayProps) {
  const passKeys = ['structure', 'creative', 'market'] as const;

  return (
    <div className="space-y-4">
      <h3 className="font-display font-semibold text-foreground text-xl">
        Material Analysis
      </h3>
      <div className="grid gap-4">
        {passKeys.map((key, index) => {
          const pass = passes[key];
          const config = PASS_CONFIG[key];
          const Icon = config.icon;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.1, duration: 0.3 }}
              className="glass-card rounded-xl p-5"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`h-9 w-9 rounded-md ${config.bgColor} flex items-center justify-center shrink-0`}>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>
                <div>
                  <h4 className="font-display font-semibold text-foreground">
                    {pass.title}
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                    {pass.summary}
                  </p>
                </div>
              </div>
              {pass.signals && pass.signals.length > 0 && (
                <div className="ml-12 flex flex-wrap gap-2">
                  {pass.signals.map((signal, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border/50"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
