import { motion } from 'framer-motion';
import { CastTrend } from '@/hooks/useTrends';
import { Badge } from '@/components/ui/badge';
import { TrendScoreBadges } from '@/components/TrendScoreBadges';
import { ShareSignalDialog } from '@/components/ShareSignalDialog';
import { formatDistanceToNow } from 'date-fns';

const TREND_TYPE_STYLES: Record<string, string> = {
  Emerging: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Accelerating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Resurgent: 'bg-[hsl(260,50%,55%)]/15 text-[hsl(260,50%,70%)] border-[hsl(260,50%,55%)]/30',
};

const PHASE_STYLES: Record<string, string> = {
  Early: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Building: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Peaking: 'bg-red-500/15 text-red-400 border-red-500/30',
};

interface CastTrendCardProps {
  trend: CastTrend;
  index: number;
  isArchived?: boolean;
}

export function CastTrendCard({ trend, index, isArchived }: CastTrendCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="glass-card rounded-lg p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display font-semibold text-foreground">{trend.actor_name}</h4>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            {trend.region && <span>{trend.region}</span>}
            {trend.region && trend.age_band && <span>·</span>}
            {trend.age_band && <span>{trend.age_band}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Badge className={`text-[10px] px-2 py-0.5 border ${TREND_TYPE_STYLES[trend.trend_type] ?? ''}`}>
            {trend.trend_type}
          </Badge>
          <Badge className={`text-[10px] px-2 py-0.5 border ${PHASE_STYLES[trend.cycle_phase] ?? ''}`}>
            {trend.cycle_phase}
          </Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{trend.explanation}</p>

      {/* Scoring Badges */}
      <TrendScoreBadges
        strength={trend.strength}
        velocity={trend.velocity}
        saturationRisk={trend.saturation_risk}
      />

      {/* Forecast */}
      {trend.forecast && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
          12-month forecast: {trend.forecast}
        </p>
      )}

      {(trend.sales_leverage || trend.timing_window) && (
        <div className="flex gap-2 flex-wrap text-xs">
          {trend.sales_leverage && (
            <span className="bg-primary/10 text-primary rounded px-2 py-0.5 font-medium">{trend.sales_leverage}</span>
          )}
          {trend.timing_window && (
            <span className="bg-muted/60 text-foreground rounded px-2 py-0.5">{trend.timing_window}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-1.5 flex-wrap">
          {trend.genre_relevance?.slice(0, 3).map(g => (
            <span key={g} className="bg-muted/50 rounded px-1.5 py-0.5">{g}</span>
          ))}
          {trend.market_alignment && (
            <span className="bg-muted/50 rounded px-1.5 py-0.5">{trend.market_alignment}</span>
          )}
          {trend.target_buyer && (
            <span className="bg-muted/50 rounded px-1.5 py-0.5">{trend.target_buyer}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ShareSignalDialog signalId={trend.id} signalName={trend.actor_name} signalType="cast" />
          <span>
            {isArchived && trend.archived_at
              ? `Archived ${formatDistanceToNow(new Date(trend.archived_at), { addSuffix: true })}`
              : `Detected ${formatDistanceToNow(new Date(trend.first_detected_at), { addSuffix: true })}`}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
