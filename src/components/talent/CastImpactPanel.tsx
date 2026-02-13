import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Globe, AlertTriangle, Star, Crown, Sparkles, User, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PersonNameLink } from '@/components/talent/PersonNameLink';
import type { ProjectCastMember, ProjectHOD } from '@/hooks/useProjectAttachments';
import {
  calculateCastImpact,
  MARKET_TIER_COLORS,
  MARKET_TIER_OPTIONS,
  type MarketTier,
  type CastImpactResult,
} from '@/lib/cast-value-engine';

interface Props {
  cast: ProjectCastMember[];
  hods: ProjectHOD[];
}

const TIER_ICONS: Record<MarketTier, React.ElementType> = {
  marquee: Crown,
  'a-list': Star,
  'b-list': Sparkles,
  emerging: TrendingUp,
  unknown: User,
};

const STRENGTH_COLORS: Record<string, string> = {
  strong: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  moderate: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  weak: 'bg-muted text-muted-foreground border-border',
};

const BAND_SHIFT_LABELS: Record<string, string> = {
  'none': 'No shift',
  'up-one': '↑ +1 band',
  'up-two': '↑↑ +2 bands',
  'down-one': '↓ -1 band',
};

export function CastImpactPanel({ cast, hods }: Props) {
  const impact = useMemo(() => calculateCastImpact(cast, hods), [cast, hods]);

  if (cast.length === 0) {
    return (
      <div className="bg-muted/20 rounded-xl p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Add cast members and assign market tiers to see how talent attachments shift financeability.
        </p>
      </div>
    );
  }

  const assessedCount = cast.filter(c => (c as any).market_value_tier !== 'unknown').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.3 }}
      className="space-y-4"
    >
      {/* Score + ATL Multiplier + Band Shift */}
      <div className="grid grid-cols-3 gap-3">
        <ScoreCard
          label="Package Strength"
          value={`${impact.packageScore}`}
          sub="/100"
          color={impact.packageScore >= 50 ? 'text-emerald-400' : impact.packageScore >= 25 ? 'text-amber-400' : 'text-muted-foreground'}
        />
        <ScoreCard
          label="ATL Multiplier"
          value={`×${impact.atlMultiplier}`}
          sub={impact.atlMultiplier > 1 ? `+${Math.round((impact.atlMultiplier - 1) * 100)}%` : 'baseline'}
          color={impact.atlMultiplier >= 1.3 ? 'text-amber-400' : 'text-foreground'}
        />
        <ScoreCard
          label="Budget Band"
          value={BAND_SHIFT_LABELS[impact.budgetBandShift]}
          sub={`+${impact.financeabilityDelta}pts readiness`}
          color={impact.budgetBandShift !== 'none' ? 'text-violet-400' : 'text-muted-foreground'}
        />
      </div>

      {/* Assessment progress */}
      {assessedCount < cast.length && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-400">
            {assessedCount}/{cast.length} cast tiered — assign market tiers in Cast tab for accurate modeling
          </span>
        </div>
      )}

      {/* Member impacts */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Individual Impact</span>
        {impact.memberImpacts
          .sort((a, b) => b.valueScore - a.valueScore)
          .map(m => {
            const Icon = TIER_ICONS[m.tier];
            return (
              <div key={m.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <PersonNameLink
                      personName={m.name || 'Unnamed'}
                      reason={m.role || 'Cast'}
                      size="sm"
                    />
                    {m.isAnchor && (
                      <Badge className="text-[9px] px-1 py-0 bg-amber-500/15 text-amber-400 border-amber-500/30">
                        Anchor
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 ml-8">
                    <span className="text-[10px] text-muted-foreground">{m.role || 'Role TBD'}</span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground capitalize">{m.status}</span>
                  </div>
                </div>
                <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ${MARKET_TIER_COLORS[m.tier]}`}>
                  {MARKET_TIER_OPTIONS.find(t => t.value === m.tier)?.label || m.tier}
                </Badge>
                <div className="w-8 text-right">
                  <span className="text-xs font-semibold text-foreground">{m.valueScore}</span>
                </div>
              </div>
            );
          })}
      </div>

      {/* Territory coverage */}
      {impact.territoryCoverage.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Territory Pre-Sales Leverage</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {impact.territoryCoverage.map(t => (
              <TooltipProvider key={t.territory}>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge className={`text-[10px] px-2 py-0.5 border cursor-default ${STRENGTH_COLORS[t.strength]}`}>
                      {t.territory}
                      {t.coverage > 1 && <span className="ml-1 opacity-60">×{t.coverage}</span>}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {t.strength === 'strong' ? 'Strong pre-sales leverage' : t.strength === 'moderate' ? 'Moderate leverage' : 'Limited leverage'}
                    {' — '}{t.coverage} cast member{t.coverage > 1 ? 's' : ''} with value here
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      )}

      {/* Strengths & Risks */}
      {(impact.strengths.length > 0 || impact.risks.length > 0) && (
        <div className="space-y-1.5">
          {impact.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <ChevronRight className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-foreground">{s}</span>
            </div>
          ))}
          {impact.risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{r}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ScoreCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2.5 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
