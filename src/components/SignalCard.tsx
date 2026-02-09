import { motion } from 'framer-motion';
import { TrendSignal } from '@/hooks/useTrends';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

const CATEGORY_STYLES: Record<string, string> = {
  Narrative: 'bg-[hsl(260,50%,55%)]/15 text-[hsl(260,50%,70%)] border-[hsl(260,50%,55%)]/30',
  IP: 'bg-[hsl(175,60%,42%)]/15 text-[hsl(175,60%,58%)] border-[hsl(175,60%,42%)]/30',
  'Market Behaviour': 'bg-[hsl(215,70%,55%)]/15 text-[hsl(215,70%,70%)] border-[hsl(215,70%,55%)]/30',
};

const PHASE_STYLES: Record<string, string> = {
  Early: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Building: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Peaking: 'bg-red-500/15 text-red-400 border-red-500/30',
  Declining: 'bg-muted text-muted-foreground border-border',
};

interface SignalCardProps {
  signal: TrendSignal;
  index: number;
  isArchived?: boolean;
}

export function SignalCard({ signal, index, isArchived }: SignalCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="glass-card rounded-lg p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-display font-semibold text-foreground">{signal.name}</h4>
        <div className="flex gap-1.5 shrink-0">
          <Badge className={`text-[10px] px-2 py-0.5 border ${CATEGORY_STYLES[signal.category] ?? ''}`}>
            {signal.category}
          </Badge>
          <Badge className={`text-[10px] px-2 py-0.5 border ${PHASE_STYLES[signal.cycle_phase] ?? ''}`}>
            {signal.cycle_phase}
          </Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{signal.explanation}</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{signal.sources_count} source{signal.sources_count !== 1 ? 's' : ''}</span>
        <span>
          {isArchived && signal.archived_at
            ? `Archived ${formatDistanceToNow(new Date(signal.archived_at), { addSuffix: true })}`
            : `Detected ${formatDistanceToNow(new Date(signal.first_detected_at), { addSuffix: true })}`}
        </span>
      </div>
    </motion.div>
  );
}
