/**
 * ImageEvaluationBadge — Compact overlay showing evaluation status on image cards.
 * Shows canon match, drift risk, and continuity indicators.
 */
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, XCircle, Shield, HelpCircle } from 'lucide-react';
import type { MatchLevel, DriftRisk } from '@/lib/images/imageEvaluation';

interface Props {
  canonMatch: MatchLevel;
  driftRisk: DriftRisk;
  continuityMatch: MatchLevel;
  contradictionCount: number;
  compact?: boolean;
}

const MATCH_CONFIG: Record<MatchLevel, { icon: typeof CheckCircle; color: string; label: string }> = {
  high: { icon: CheckCircle, color: 'text-emerald-500', label: 'HIGH' },
  medium: { icon: HelpCircle, color: 'text-amber-500', label: 'MED' },
  low: { icon: XCircle, color: 'text-destructive', label: 'LOW' },
  unknown: { icon: HelpCircle, color: 'text-muted-foreground', label: '—' },
};

const DRIFT_CONFIG: Record<DriftRisk, { color: string; label: string }> = {
  none: { color: 'text-emerald-500', label: '' },
  low: { color: 'text-blue-500', label: 'Low drift' },
  medium: { color: 'text-amber-500', label: '⚠ Drift risk' },
  high: { color: 'text-destructive', label: '🚫 High drift' },
  unknown: { color: 'text-muted-foreground', label: '' },
};

export function ImageEvaluationBadge({ canonMatch, driftRisk, continuityMatch, contradictionCount, compact = false }: Props) {
  const canon = MATCH_CONFIG[canonMatch];
  const drift = DRIFT_CONFIG[driftRisk];
  const continuity = MATCH_CONFIG[continuityMatch];
  
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <canon.icon className={cn('h-3 w-3', canon.color)} />
        {driftRisk !== 'none' && driftRisk !== 'unknown' && (
          <AlertTriangle className={cn('h-3 w-3', drift.color)} />
        )}
        {contradictionCount > 0 && (
          <span className="text-[8px] font-bold text-destructive bg-destructive/20 rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {contradictionCount}
          </span>
        )}
      </div>
    );
  }
  
  return (
    <div className="space-y-0.5 text-[9px]">
      <div className="flex items-center gap-1">
        <canon.icon className={cn('h-2.5 w-2.5', canon.color)} />
        <span className="text-muted-foreground">Canon:</span>
        <span className={cn('font-semibold', canon.color)}>{canon.label}</span>
      </div>
      
      {driftRisk !== 'none' && driftRisk !== 'unknown' && (
        <div className="flex items-center gap-1">
          <AlertTriangle className={cn('h-2.5 w-2.5', drift.color)} />
          <span className={cn('font-medium', drift.color)}>{drift.label}</span>
        </div>
      )}
      
      <div className="flex items-center gap-1">
        <Shield className={cn('h-2.5 w-2.5', continuity.color)} />
        <span className="text-muted-foreground">Continuity:</span>
        <span className={cn('font-semibold', continuity.color)}>{continuity.label}</span>
      </div>
      
      {contradictionCount > 0 && (
        <div className="flex items-center gap-1 text-destructive">
          <XCircle className="h-2.5 w-2.5" />
          <span className="font-medium">{contradictionCount} contradiction{contradictionCount > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}

/**
 * ImageEvaluationOverlay — Positioned overlay for image cards.
 */
export function ImageEvaluationOverlay({ evaluation }: { evaluation: any | null }) {
  if (!evaluation) return null;
  
  return (
    <div className="absolute top-1 right-1 z-10 bg-black/70 backdrop-blur-sm rounded px-1.5 py-1">
      <ImageEvaluationBadge
        canonMatch={evaluation.canon_match || 'unknown'}
        driftRisk={evaluation.drift_risk || 'unknown'}
        continuityMatch={evaluation.continuity_match || 'unknown'}
        contradictionCount={(evaluation.contradiction_flags || []).length}
        compact={true}
      />
    </div>
  );
}
