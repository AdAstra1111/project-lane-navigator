/**
 * ImageEvaluationBadge — Compact overlay with governance verdict and explainability.
 * Shows canon match, drift risk, continuity, and governance verdict with tooltip.
 */
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, XCircle, Shield, HelpCircle, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { MatchLevel, DriftRisk, GovernanceVerdict, ExplanationItem } from '@/lib/images/imageEvaluation';

interface Props {
  canonMatch: MatchLevel;
  driftRisk: DriftRisk;
  continuityMatch: MatchLevel;
  contradictionCount: number;
  governanceVerdict?: GovernanceVerdict;
  explanation?: ExplanationItem[];
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

const VERDICT_CONFIG: Record<GovernanceVerdict, { color: string; bg: string; label: string }> = {
  approved: { color: 'text-emerald-500', bg: 'bg-emerald-500/20', label: '✓ Approved' },
  review_required: { color: 'text-amber-500', bg: 'bg-amber-500/20', label: '⚠ Review' },
  flagged: { color: 'text-destructive', bg: 'bg-destructive/20', label: '⚑ Flagged' },
  rejected: { color: 'text-destructive', bg: 'bg-destructive/20', label: '✕ Rejected' },
  pending: { color: 'text-muted-foreground', bg: 'bg-muted/20', label: '○ Pending' },
};

export function ImageEvaluationBadge({
  canonMatch, driftRisk, continuityMatch, contradictionCount,
  governanceVerdict = 'pending', explanation = [], compact = false,
}: Props) {
  const canon = MATCH_CONFIG[canonMatch];
  const drift = DRIFT_CONFIG[driftRisk];
  const continuity = MATCH_CONFIG[continuityMatch];
  const verdict = VERDICT_CONFIG[governanceVerdict];
  
  const badgeContent = compact ? (
    <div className="flex items-center gap-1">
      <span className={cn('text-[8px] font-bold rounded px-1 py-0.5', verdict.bg, verdict.color)}>
        {verdict.label}
      </span>
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
  ) : (
    <div className="space-y-0.5 text-[9px]">
      {/* Governance verdict */}
      <div className={cn('flex items-center gap-1 rounded px-1 py-0.5', verdict.bg)}>
        <span className={cn('font-bold', verdict.color)}>{verdict.label}</span>
      </div>
      
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
  
  if (explanation.length === 0) return badgeContent;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{badgeContent}</div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[280px] p-2">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-foreground flex items-center gap-1">
              <Info className="h-3 w-3" /> Evaluation Explanation
            </p>
            {explanation.map((item, i) => (
              <p key={i} className={cn('text-[9px]',
                item.type === 'safe' ? 'text-emerald-600' :
                item.type === 'conflict' ? 'text-destructive' :
                item.type === 'drift' ? 'text-amber-600' :
                item.type === 'regen_needed' ? 'text-blue-600' :
                'text-muted-foreground',
              )}>
                {item.type === 'safe' ? '✓' : item.type === 'conflict' ? '✕' : item.type === 'drift' ? '⚠' : item.type === 'regen_needed' ? '🔄' : 'ℹ'} {item.message}
              </p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
        governanceVerdict={evaluation.governance_verdict || 'pending'}
        explanation={evaluation.explanation || []}
        compact={true}
      />
    </div>
  );
}
