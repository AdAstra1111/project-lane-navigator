/**
 * Production Stability Panel
 *
 * Displays production stability score, spend variance, schedule adherence,
 * overage alerts, and slippage probability.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, TrendingDown, AlertTriangle, DollarSign, Clock, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { DailyReport, CostActual } from '@/hooks/useProductionMonitoring';
import { calculateProductionStability, type ProductionStabilityResult } from '@/lib/production-stability';

interface Props {
  reports: DailyReport[];
  actuals: CostActual[];
  totalPlannedScenes: number;
  totalShootDays: number;
}

export function ProductionStabilityPanel({ reports, actuals, totalPlannedScenes, totalShootDays }: Props) {
  const stability = useMemo(
    () => calculateProductionStability(reports, actuals, totalPlannedScenes, totalShootDays),
    [reports, actuals, totalPlannedScenes, totalShootDays],
  );

  const scoreColor = stability.score >= 70 ? 'text-emerald-400' : stability.score >= 45 ? 'text-amber-400' : 'text-red-400';
  const slipColor = stability.slippageProbability <= 25 ? 'text-emerald-400' : stability.slippageProbability <= 50 ? 'text-amber-400' : 'text-red-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-sm">Production Stability</h3>
      </div>

      {/* Score Grid */}
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Overall" value={`${stability.score}`} sub="/100" color={scoreColor} />
        <MetricCard
          label="Spend"
          value={`${stability.spendVariance.score}`}
          sub={stability.spendVariance.overagePct > 0 ? `+${Math.round(stability.spendVariance.overagePct)}%` : 'on track'}
          color={stability.spendVariance.score >= 70 ? 'text-emerald-400' : stability.spendVariance.score >= 45 ? 'text-amber-400' : 'text-red-400'}
        />
        <MetricCard
          label="Schedule"
          value={`${stability.scheduleAdherence.score}`}
          sub={`${stability.scheduleAdherence.avgScenesPerDay} sc/day`}
          color={stability.scheduleAdherence.score >= 70 ? 'text-emerald-400' : stability.scheduleAdherence.score >= 45 ? 'text-amber-400' : 'text-red-400'}
        />
        <MetricCard
          label="Risk"
          value={`${stability.riskIncidents.score}`}
          sub={`${stability.riskIncidents.totalIncidents} incidents`}
          color={stability.riskIncidents.score >= 70 ? 'text-emerald-400' : stability.riskIncidents.score >= 45 ? 'text-amber-400' : 'text-red-400'}
        />
      </div>

      {/* Slippage Probability */}
      <div className="bg-muted/30 rounded-lg px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Schedule Slippage Probability</span>
          </div>
          <span className={`text-sm font-bold ${slipColor}`}>{stability.slippageProbability}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${stability.slippageProbability <= 25 ? 'bg-emerald-500/60' : stability.slippageProbability <= 50 ? 'bg-amber-500/60' : 'bg-red-500/60'}`}
            style={{ width: `${stability.slippageProbability}%` }}
          />
        </div>
        {stability.slippageFactors.length > 0 && (
          <div className="mt-2 space-y-1">
            {stability.slippageFactors.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                <AlertTriangle className="h-2.5 w-2.5 text-amber-400 mt-0.5 shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Overage Alerts */}
      {stability.overageAlerts.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Overage Alerts</span>
          </div>
          <div className="space-y-1">
            {stability.overageAlerts.map((a, i) => (
              <div key={i} className={`flex items-center justify-between bg-muted/20 rounded-lg px-3 py-1.5 border-l-2 ${a.severity === 'critical' ? 'border-red-500' : 'border-amber-500'}`}>
                <span className="text-xs text-foreground">{a.department}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {formatCurrency(a.budgeted)} → {formatCurrency(a.actual)}
                  </span>
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 ${a.severity === 'critical' ? 'text-red-400 border-red-400/30' : 'text-amber-400 border-amber-500/30'}`}>
                    +{Math.round(a.variancePct)}%
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {reports.length === 0 && actuals.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Log daily reports and cost actuals to activate stability tracking.
        </p>
      )}
    </motion.div>
  );
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-muted/30 rounded-lg px-2 py-2 text-center">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
