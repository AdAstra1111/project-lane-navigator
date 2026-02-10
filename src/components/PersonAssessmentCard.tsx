import { PersonAssessment } from '@/hooks/usePersonResearch';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TRAJECTORY_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  rising: { icon: TrendingUp, label: 'Rising', color: 'text-emerald-400' },
  peak: { icon: Star, label: 'Peak', color: 'text-amber-400' },
  steady: { icon: Minus, label: 'Steady', color: 'text-primary' },
  declining: { icon: TrendingDown, label: 'Declining', color: 'text-red-400' },
  breakout: { icon: TrendingUp, label: 'Breakout', color: 'text-emerald-400' },
  unknown: { icon: Minus, label: 'Unknown', color: 'text-muted-foreground' },
};

const IMPACT_STYLES: Record<string, string> = {
  transformative: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  strong: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  moderate: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  marginal: 'bg-muted text-muted-foreground border-border',
  neutral: 'bg-muted text-muted-foreground border-border',
  risky: 'bg-red-500/15 text-red-400 border-red-500/30',
};

interface Props {
  assessment: PersonAssessment;
  onDismiss?: () => void;
}

export function PersonAssessmentCard({ assessment, onDismiss }: Props) {
  const traj = TRAJECTORY_CONFIG[assessment.market_trajectory] || TRAJECTORY_CONFIG.unknown;
  const TrajIcon = traj.icon;

  return (
    <div className="bg-muted/40 border border-border/50 rounded-lg px-3 py-2.5 space-y-2 mt-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1 text-xs font-medium ${traj.color}`}>
            <TrajIcon className="h-3 w-3" />
            {traj.label}
          </div>
          <Badge className={`text-[10px] px-1.5 py-0 border ${IMPACT_STYLES[assessment.packaging_impact] || ''}`}>
            {assessment.packaging_impact} impact
          </Badge>
        </div>
        {onDismiss && (
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onDismiss}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <p className="text-xs text-foreground/80 leading-relaxed">{assessment.summary}</p>

      {assessment.notable_credits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {assessment.notable_credits.map((c, i) => (
            <span key={i} className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">{c}</span>
          ))}
        </div>
      )}

      {assessment.risk_flags.length > 0 && (
        <div className="space-y-1">
          {assessment.risk_flags.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
