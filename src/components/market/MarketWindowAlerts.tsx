import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TrendSignal {
  id: string;
  name: string;
  category: string;
  cycle_phase: string;
  genre_tags: string[];
  tone_tags: string[];
  format_tags: string[];
  explanation: string;
  status: string;
}

interface Props {
  genres: string[];
  tone: string;
  format: string;
  signals: TrendSignal[];
}

const PHASE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  rising: { icon: TrendingUp, color: 'text-emerald-400', label: 'Heating Up' },
  peaking: { icon: TrendingUp, color: 'text-amber-400', label: 'Peaking' },
  declining: { icon: TrendingDown, color: 'text-red-400', label: 'Cooling' },
  stable: { icon: Minus, color: 'text-muted-foreground', label: 'Stable' },
  emerging: { icon: TrendingUp, color: 'text-blue-400', label: 'Emerging' },
};

export function MarketWindowAlerts({ genres, tone, format, signals }: Props) {
  const alerts = useMemo(() => {
    if (!signals.length) return [];

    return signals
      .filter(s => s.status === 'active')
      .map(signal => {
        let relevance = 0;
        const genreMatch = signal.genre_tags.some(g => genres.some(pg => pg.toLowerCase() === g.toLowerCase()));
        if (genreMatch) relevance += 3;
        if (signal.tone_tags.some(t => t.toLowerCase() === tone.toLowerCase())) relevance += 2;
        if (signal.format_tags.some(f => f.toLowerCase().includes(format === 'tv-series' ? 'tv' : 'film'))) relevance += 1;

        const isWarning = ['declining', 'peaking'].includes(signal.cycle_phase) && genreMatch;
        const isOpportunity = ['rising', 'emerging'].includes(signal.cycle_phase) && genreMatch;

        return { ...signal, relevance, isWarning, isOpportunity };
      })
      .filter(a => a.relevance >= 3)
      .sort((a, b) => {
        if (a.isWarning && !b.isWarning) return -1;
        if (!a.isWarning && b.isWarning) return 1;
        return b.relevance - a.relevance;
      })
      .slice(0, 5);
  }, [genres, tone, format, signals]);

  if (alerts.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-5 w-5 text-amber-400" />
        <h3 className="font-display font-semibold text-foreground">Market Window Alerts</h3>
      </div>

      <div className="space-y-3">
        {alerts.map((alert, i) => {
          const phase = PHASE_CONFIG[alert.cycle_phase] || PHASE_CONFIG.stable;
          const Icon = phase.icon;

          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                alert.isWarning ? 'border-red-500/20 bg-red-500/5' : alert.isOpportunity ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-border'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${phase.color}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-foreground">{alert.name}</span>
                  <Badge variant="outline" className={`text-[10px] ${phase.color}`}>{phase.label}</Badge>
                  {alert.isWarning && <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">Act Now</Badge>}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{alert.explanation}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
