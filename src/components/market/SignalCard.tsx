import { motion } from 'framer-motion';
import { TrendSignal } from '@/hooks/useTrends';
import { Badge } from '@/components/ui/badge';
import { TrendScoreBadges } from '@/components/market/TrendScoreBadges';
import { ShareSignalDialog } from '@/components/market/ShareSignalDialog';
import { formatDistanceToNow } from 'date-fns';

const CATEGORY_STYLES: Record<string, string> = {
  Narrative: 'bg-[hsl(260,50%,55%)]/15 text-[hsl(260,50%,70%)] border-[hsl(260,50%,55%)]/30',
  IP: 'bg-[hsl(175,60%,42%)]/15 text-[hsl(175,60%,58%)] border-[hsl(175,60%,42%)]/30',
  'Market Behaviour': 'bg-[hsl(215,70%,55%)]/15 text-[hsl(215,70%,70%)] border-[hsl(215,70%,55%)]/30',
  'Buyer Appetite': 'bg-[hsl(30,70%,50%)]/15 text-[hsl(30,70%,65%)] border-[hsl(30,70%,50%)]/30',
  'Genre Cycle': 'bg-[hsl(340,60%,55%)]/15 text-[hsl(340,60%,70%)] border-[hsl(340,60%,55%)]/30',
  'Platform Demand': 'bg-[hsl(200,70%,50%)]/15 text-[hsl(200,70%,65%)] border-[hsl(200,70%,50%)]/30',
  'Format Innovation': 'bg-[hsl(150,60%,42%)]/15 text-[hsl(150,60%,58%)] border-[hsl(150,60%,42%)]/30',
  'Brand Strategy': 'bg-[hsl(45,80%,50%)]/15 text-[hsl(45,80%,65%)] border-[hsl(45,80%,50%)]/30',
  'Creative Direction': 'bg-[hsl(280,50%,55%)]/15 text-[hsl(280,50%,70%)] border-[hsl(280,50%,55%)]/30',
  'Client Behaviour': 'bg-[hsl(190,60%,45%)]/15 text-[hsl(190,60%,60%)] border-[hsl(190,60%,45%)]/30',
  'Visual Innovation': 'bg-[hsl(320,60%,55%)]/15 text-[hsl(320,60%,70%)] border-[hsl(320,60%,55%)]/30',
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
        <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
          <Badge className={`text-[10px] px-2 py-0.5 border ${CATEGORY_STYLES[signal.category] ?? 'bg-muted text-muted-foreground border-border'}`}>
            {signal.category}
          </Badge>
          <Badge className={`text-[10px] px-2 py-0.5 border ${PHASE_STYLES[signal.cycle_phase] ?? ''}`}>
            {signal.cycle_phase}
          </Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{signal.explanation}</p>

      {/* Scoring Badges */}
      <TrendScoreBadges
        strength={signal.strength}
        velocity={signal.velocity}
        saturationRisk={signal.saturation_risk}
      />

      {/* Forecast */}
      {signal.forecast && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
          12-month forecast: {signal.forecast}
        </p>
      )}

      {/* Metadata */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-2 flex-wrap">
          <span>{signal.sources_count} source{signal.sources_count !== 1 ? 's' : ''}</span>
          {signal.target_buyer && (
            <span className="bg-muted/50 rounded px-1.5 py-0.5">{signal.target_buyer}</span>
          )}
          {signal.budget_tier && (
            <span className="bg-muted/50 rounded px-1.5 py-0.5">{signal.budget_tier}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ShareSignalDialog signalId={signal.id} signalName={signal.name} signalType="story" />
          <span>
            {isArchived && signal.archived_at
              ? `Archived ${formatDistanceToNow(new Date(signal.archived_at), { addSuffix: true })}`
              : `Detected ${formatDistanceToNow(new Date(signal.first_detected_at), { addSuffix: true })}`}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
