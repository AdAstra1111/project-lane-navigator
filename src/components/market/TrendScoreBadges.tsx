import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Gauge } from 'lucide-react';
import type { TrendVelocity, TrendSaturationRisk } from '@/hooks/useTrends';

const VELOCITY_CONFIG: Record<string, { icon: React.ElementType; style: string }> = {
  Rising: { icon: TrendingUp, style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  Stable: { icon: Minus, style: 'bg-muted text-muted-foreground border-border' },
  Declining: { icon: TrendingDown, style: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const SATURATION_CONFIG: Record<string, string> = {
  Low: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  High: 'bg-red-500/15 text-red-400 border-red-500/30',
};

interface TrendScoreBadgesProps {
  strength: number;
  velocity: TrendVelocity;
  saturationRisk: TrendSaturationRisk;
  compact?: boolean;
}

export function TrendScoreBadges({ strength, velocity, saturationRisk, compact }: TrendScoreBadgesProps) {
  const velocityConfig = VELOCITY_CONFIG[velocity] || VELOCITY_CONFIG.Stable;
  const VelocityIcon = velocityConfig.icon;

  return (
    <div className="flex gap-1 flex-wrap">
      {/* Strength */}
      <Badge className={`text-[10px] px-1.5 py-0 border gap-0.5 ${
        strength >= 7 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
        strength >= 4 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
        'bg-muted text-muted-foreground border-border'
      }`}>
        <Gauge className="h-2.5 w-2.5" />
        {strength}/10
      </Badge>

      {/* Velocity */}
      <Badge className={`text-[10px] px-1.5 py-0 border gap-0.5 ${velocityConfig.style}`}>
        <VelocityIcon className="h-2.5 w-2.5" />
        {!compact && velocity}
      </Badge>

      {/* Saturation Risk */}
      <Badge className={`text-[10px] px-1.5 py-0 border gap-0.5 ${SATURATION_CONFIG[saturationRisk] || ''}`}>
        <AlertTriangle className="h-2.5 w-2.5" />
        {compact ? saturationRisk[0] : `Sat: ${saturationRisk}`}
      </Badge>
    </div>
  );
}
