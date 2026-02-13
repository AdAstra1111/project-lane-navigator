import { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Shield, AlertTriangle, MapPin, ChevronDown, Gauge, Activity, Layers, Info, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FinanceReadinessBreakdown } from '@/components/finance/FinanceReadinessBreakdown';
import type {
  FinanceReadinessResult,
  BudgetModule,
  RiskFlag,
  VolatilityLevel,
  ConfidenceLevel,
  GeographySensitivity,
} from '@/lib/finance-readiness';

// ---- Style maps ----

const VOLATILITY_STYLES: Record<VolatilityLevel, string> = {
  Low: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  High: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const CONFIDENCE_STYLES: Record<ConfidenceLevel, string> = {
  Low: 'bg-red-500/15 text-red-400 border-red-500/30',
  Medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  High: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const GEO_STYLES: Record<GeographySensitivity, string> = {
  Neutral: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'Incentive-Dependent': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Highly Dependent': 'bg-red-500/15 text-red-400 border-red-500/30',
};

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Finance-Ready';
  if (score >= 60) return 'Approaching Readiness';
  if (score >= 35) return 'Building';
  return 'Early Stage';
}

// ---- Sub-components ----

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="relative flex items-center justify-center">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <motion.circle
          cx="50" cy="50" r="42" fill="none"
          stroke={score >= 70 ? 'hsl(142 71% 45%)' : score >= 40 ? 'hsl(38 92% 50%)' : 'hsl(0 84% 60%)'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 42}`}
          initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
          animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - score / 100) }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-2xl font-bold font-display', scoreColor(score))}>{score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

const MODULE_CTAS: Record<string, { label: string; hint: string }> = {
  'Above the Line': { label: 'Add cast or director', hint: 'Attach key creative talent to improve ATL confidence' },
  'Below the Line': { label: 'Add HODs', hint: 'Attach heads of department to firm up BTL scope' },
  'Locations & Logistics': { label: 'Set production territory', hint: 'Define territories in Project Details to unlock location-aware assessments' },
  'Schedule': { label: 'Attach script', hint: 'A current script enables schedule estimation' },
  'Post-Production': { label: 'Review VFX scope', hint: 'Ensure post requirements are reflected in your analysis' },
  'VFX / Scale': { label: 'Review analysis', hint: 'Confirm VFX/period signals in the script analysis' },
  'Contingency': { label: 'Add scenarios', hint: 'Multiple finance scenarios provide contingency flexibility' },
  'Soft Money & Incentives': { label: 'Run incentive analysis', hint: 'Analyse incentive eligibility to improve soft money confidence' },
};

function ModuleRow({ module }: { module: BudgetModule }) {
  const [open, setOpen] = useState(false);
  const cta = MODULE_CTAS[module.name];
  const showCta = cta && module.scopeConfidence === 'Low';
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer">
        <span className="text-sm font-medium text-foreground flex-1 text-left">{module.name}</span>
        <Badge className={cn('text-[10px] border', CONFIDENCE_STYLES[module.scopeConfidence])}>{module.scopeConfidence}</Badge>
        <Badge className={cn('text-[10px] border', VOLATILITY_STYLES[module.volatilityRisk])}>{module.volatilityRisk}</Badge>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <span className="text-primary font-medium shrink-0">Narrative:</span>
            <span>{module.narrativePressure}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary font-medium shrink-0">Market:</span>
            <span>{module.marketPressure}</span>
          </div>
          {showCta && (
            <div className="flex items-center gap-1.5 mt-1.5 bg-primary/5 rounded px-2 py-1.5">
              <ArrowRight className="h-3 w-3 text-primary shrink-0" />
              <span className="text-primary font-medium">{cta.label}</span>
              <span className="text-muted-foreground">— {cta.hint}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RiskFlagCard({ flag }: { flag: RiskFlag }) {
  return (
    <div className="flex gap-3 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2.5">
      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{flag.tag}</p>
        <p className="text-xs text-muted-foreground">{flag.explanation}</p>
        <p className="text-xs text-emerald-400">→ {flag.mitigation}</p>
      </div>
    </div>
  );
}

// ---- Main Component ----

interface FinanceReadinessPanelProps {
  result: FinanceReadinessResult;
}

export function FinanceReadinessPanel({ result }: FinanceReadinessPanelProps) {
  const [modulesOpen, setModulesOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Score + Summary */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Finance Readiness</h4>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Evaluates whether this project is structurally viable for financing — independent of specific budgets. Based on script, packaging, finance structure, market position, and geography.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-6">
          <ScoreRing score={result.score} />
          <div className="flex-1 space-y-3">
            <div>
              <p className={cn('text-lg font-display font-bold', scoreColor(result.score))}>
                {scoreLabel(result.score)}
              </p>
              {result.strengths.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-emerald-400 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Key indicators */}
            <div className="flex flex-wrap gap-2">
              <Badge className={cn('text-[10px] border', VOLATILITY_STYLES[result.volatilityIndex])}>
                <Activity className="h-3 w-3 mr-1" />
                Volatility: {result.volatilityIndex}
              </Badge>
              <Badge className={cn('text-[10px] border', GEO_STYLES[result.geographySensitivity])}>
                <MapPin className="h-3 w-3 mr-1" />
                {result.geographySensitivity}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      {result.subscores && <FinanceReadinessBreakdown subscores={result.subscores} />}

      {/* Budget Bands */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Implied Budget Bands</h4>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(['low', 'target', 'stretch'] as const).map(key => {
            const band = result.budgetBands[key];
            const labels = { low: 'Low', target: 'Target', stretch: 'Stretch' };
            return (
              <div key={key} className={cn(
                'rounded-lg border p-3 text-center',
                key === 'target' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'
              )}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{labels[key]}</p>
                <p className="text-sm font-semibold text-foreground">{band.rangeHint}</p>
                <Badge className={cn('text-[10px] border mt-1.5', CONFIDENCE_STYLES[band.confidence])}>
                  {band.confidence}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget Modules */}
      <Collapsible open={modulesOpen} onOpenChange={setModulesOpen}>
        <div className="glass-card rounded-xl overflow-hidden">
          <CollapsibleTrigger className="w-full px-5 py-4 flex items-center gap-2 hover:bg-card/90 transition-colors cursor-pointer">
            <Layers className="h-4 w-4 text-primary" />
            <span className="font-display font-semibold text-foreground flex-1 text-left">Budget Modules</span>
            <div className="flex gap-1.5 mr-2">
              <span className="text-[10px] text-muted-foreground">Confidence</span>
              <span className="text-[10px] text-muted-foreground">|</span>
              <span className="text-[10px] text-muted-foreground">Volatility</span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', modulesOpen && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-2 pb-3 divide-y divide-border/50">
              {result.modules.map(m => (
                <ModuleRow key={m.name} module={m} />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Risk Flags */}
      {result.riskFlags.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-4 w-4 text-red-400" />
            <h4 className="font-display font-semibold text-foreground">Structural Risk Flags</h4>
            <span className="text-xs text-muted-foreground bg-red-500/10 rounded-full px-2 py-0.5">
              {result.riskFlags.length}
            </span>
          </div>
          <div className="space-y-2">
            {result.riskFlags.map((flag, i) => (
              <RiskFlagCard key={i} flag={flag} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
