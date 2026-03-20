/**
 * IdentityAlignmentPanel — Shows deterministic ranked recommendations
 * per identity slot with score breakdowns and explanations.
 */
import { useState } from 'react';
import { ChevronDown, BarChart3, Check, AlertTriangle, HelpCircle, Info, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import type {
  CharacterAlignmentResult,
  SlotRecommendation,
  ScoredCandidate,
  IdentitySlot,
} from '@/lib/images/identityAlignmentScoring';
import { SLOT_LABELS } from '@/lib/images/identityAlignmentScoring';

interface Props {
  alignment: CharacterAlignmentResult;
}

const ACTION_COLORS: Record<string, string> = {
  promote: 'text-emerald-600 dark:text-emerald-400',
  retain_candidate: 'text-amber-600 dark:text-amber-400',
  reject_for_slot: 'text-destructive',
  insufficient_data: 'text-muted-foreground',
};

const ACTION_LABELS: Record<string, string> = {
  promote: 'Promote',
  retain_candidate: 'Retain',
  reject_for_slot: 'Reject',
  insufficient_data: 'Insufficient Data',
};

const CONFIDENCE_BADGE: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
  high: { variant: 'default', label: '● High' },
  medium: { variant: 'secondary', label: '◐ Medium' },
  low: { variant: 'outline', label: '○ Low' },
};

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-1.5 text-[9px]">
      <span className="w-20 text-muted-foreground truncate">{label}</span>
      <Progress value={pct} className="flex-1 h-1.5" />
      <span className="w-6 text-right font-mono text-muted-foreground">{value}</span>
    </div>
  );
}

function CandidateRow({ candidate, rank }: { candidate: ScoredCandidate; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const conf = CONFIDENCE_BADGE[candidate.confidence];
  const cs = candidate.componentScores;

  return (
    <div className={cn(
      'rounded-md border px-2 py-1.5 text-[10px]',
      rank === 0 && candidate.canonPromotable ? 'border-emerald-500/40 bg-emerald-500/5' :
      rank === 0 && candidate.eligible ? 'border-amber-500/40 bg-amber-500/5' :
      'border-border/50 bg-muted/10',
    )}>
      <div className="flex items-center justify-between gap-1.5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] font-mono text-muted-foreground w-3">#{rank + 1}</span>
          <span className="font-semibold text-foreground">{candidate.totalScore}</span>
          <Badge variant={conf.variant} className="text-[7px] h-3.5 px-1">{conf.label}</Badge>
          <span className={cn('text-[9px]', ACTION_COLORS[candidate.recommendedAction])}>
            {ACTION_LABELS[candidate.recommendedAction]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {candidate.warnings.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {candidate.warnings.map((w, i) => (
                    <p key={i} className="text-[9px]">• {w}</p>
                  ))}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <ChevronDown className={cn('h-2.5 w-2.5 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </div>

      {expanded && (
        <div className="mt-1.5 space-y-1 border-t border-border/30 pt-1.5">
          <ScoreBar label="Slot Match" value={cs.slotMatch} />
          <ScoreBar label="Identity Sig" value={cs.identitySig} />
          <ScoreBar label="Markers" value={cs.markerScore} />
          <ScoreBar label="Continuity" value={cs.continuity} />
          <ScoreBar label="Shot Quality" value={cs.shotCorrectness} />
          <ScoreBar label="Style" value={cs.styleCompliance} />
          <ScoreBar label="Evaluation" value={cs.evaluationScore} />
          {cs.penalty > 0 && (
            <div className="text-[9px] text-destructive">Penalty: -{cs.penalty}</div>
          )}
          <div className="mt-1 space-y-0.5">
            {candidate.reasons.slice(0, 6).map((r, i) => (
              <p key={i} className="text-[8px] text-muted-foreground">• {r}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SlotPanel({ rec }: { rec: SlotRecommendation }) {
  const [open, setOpen] = useState(false);
  const best = rec.bestCandidate;
  const total = rec.rankedCandidates.length;
  const eligible = rec.rankedCandidates.filter(c => c.eligible).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between w-full py-1">
          <div className="flex items-center gap-1.5">
            <Target className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-semibold text-foreground">{SLOT_LABELS[rec.slot]}</span>
            {best ? (
              <Badge variant="default" className="text-[7px] h-3.5 px-1 bg-emerald-600">{best.totalScore} pts</Badge>
            ) : (
              <Badge variant="outline" className="text-[7px] h-3.5 px-1">No match</Badge>
            )}
            <span className="text-[8px] text-muted-foreground">{eligible}/{total} eligible</span>
          </div>
          <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {rec.noRecommendationReason && (
          <div className="flex items-center gap-1 mb-1.5 text-[9px] text-amber-600">
            <HelpCircle className="h-2.5 w-2.5" />
            {rec.noRecommendationReason}
          </div>
        )}
        <div className="space-y-1 mb-1.5">
          {rec.rankedCandidates.filter(c => c.eligible).slice(0, 5).map((c, i) => (
            <CandidateRow key={c.candidateId} candidate={c} rank={i} />
          ))}
          {eligible === 0 && (
            <p className="text-[9px] text-muted-foreground italic">No eligible candidates for this slot</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function IdentityAlignmentPanel({ alignment }: Props) {
  const conf = CONFIDENCE_BADGE[alignment.overallConfidence];

  return (
    <div className="border border-primary/20 rounded-md p-2 bg-primary/5 space-y-1">
      <div className="flex items-center gap-1.5 mb-1">
        <BarChart3 className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
          Identity Alignment Scoring
        </span>
        <Badge variant={conf.variant} className="text-[8px] h-3.5 px-1">{conf.label}</Badge>
        {alignment.summaryWarnings.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {alignment.summaryWarnings.map((w, i) => (
                  <p key={i} className="text-[9px]">• {w}</p>
                ))}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <p className="text-[8px] text-muted-foreground mb-1.5">
        Deterministic ranking using DNA truth, markers, continuity, and style compliance. Recommendations are advisory — canonical state changes only via explicit selection.
      </p>
      {alignment.slots.map(rec => (
        <SlotPanel key={rec.slot} rec={rec} />
      ))}
    </div>
  );
}
