/**
 * Sales Intelligence Panel
 * Revenue probability, platform suitability, and marketing alignment.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, Monitor, Megaphone, AlertTriangle, DollarSign, Check, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  calculateRevenueProbability,
  calculatePlatformSuitability,
  calculateMarketingAlignment,
} from '@/lib/sales-intelligence';
import type { Project } from '@/lib/types';
import type { ProjectDeal } from '@/hooks/useDeals';

interface Props {
  project: Project;
  deals: ProjectDeal[];
  deliverables?: { territory: string; status: string; item_name: string }[];
}

export function SalesIntelligencePanel({ project, deals, deliverables }: Props) {
  const revenue = useMemo(() => calculateRevenueProbability(deals), [deals]);
  const platforms = useMemo(() => calculatePlatformSuitability(project), [project]);
  const marketing = useMemo(() => calculateMarketingAlignment(deals, deliverables), [deals, deliverables]);

  const topPlatforms = platforms.slice(0, 4);
  const confColor = revenue.confidence === 'high' ? 'text-emerald-400' : revenue.confidence === 'medium' ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      {/* Revenue Probability */}
      {deals.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <h4 className="font-display font-semibold text-foreground text-sm">Revenue Probability Index</h4>
            </div>
            <div className="text-right">
              <span className="text-lg font-bold font-display text-foreground">
                ${revenue.totalWeightedRevenue.toLocaleString()}
              </span>
              <Badge className={cn('ml-2 text-[9px] px-1.5 py-0 border', confColor, 'border-current/30 bg-current/10')}>
                {revenue.confidence}
              </Badge>
            </div>
          </div>

          {revenue.dealBreakdown.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {revenue.dealBreakdown.slice(0, 6).map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-foreground w-24 truncate">{d.territory}</span>
                  <span className="text-muted-foreground w-20 truncate">{d.buyerName}</span>
                  <Progress value={d.probability * 100} className="h-1 flex-1" />
                  <span className="text-muted-foreground w-8 text-right">{Math.round(d.probability * 100)}%</span>
                  <span className="text-foreground w-16 text-right font-medium">${d.weightedAmount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {revenue.riskFlags.length > 0 && (
            <div className="space-y-1 mt-2">
              {revenue.riskFlags.map((flag, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>{flag}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Platform Suitability */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Monitor className="h-4 w-4 text-sky-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">Platform Suitability</h4>
        </div>

        <div className="space-y-2">
          {topPlatforms.map((p, i) => (
            <div key={p.platform} className="flex items-center gap-2">
              <span className={cn('text-xs font-medium w-32 truncate',
                i === 0 ? 'text-foreground' : 'text-muted-foreground'
              )}>{p.platform}</span>
              <Progress value={p.score} className="h-1.5 flex-1" />
              <span className={cn('text-xs font-bold w-8 text-right font-display',
                p.score >= 70 ? 'text-emerald-400' : p.score >= 40 ? 'text-amber-400' : 'text-muted-foreground'
              )}>{p.score}</span>
            </div>
          ))}
        </div>

        {topPlatforms[0] && topPlatforms[0].reasons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {topPlatforms[0].reasons.map((r, i) => (
              <Badge key={i} className="text-[9px] px-1.5 py-0 border bg-muted text-muted-foreground border-border">
                {r}
              </Badge>
            ))}
          </div>
        )}
      </motion.div>

      {/* Marketing Alignment */}
      {marketing.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-4 w-4 text-rose-400" />
            <h4 className="font-display font-semibold text-foreground text-sm">Marketing Alignment</h4>
          </div>

          <div className="space-y-2.5">
            {marketing.map(m => (
              <div key={m.territory}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{m.territory}</span>
                  <span className={cn('text-[10px] font-bold font-display',
                    m.readinessPct >= 80 ? 'text-emerald-400' : m.readinessPct >= 40 ? 'text-amber-400' : 'text-red-400'
                  )}>{m.readinessPct}%</span>
                </div>
                <div className="flex gap-1.5">
                  {m.materials.map(mat => (
                    <div key={mat.name} className="flex items-center gap-0.5 text-[9px]" title={mat.name}>
                      {mat.ready
                        ? <Check className="h-3 w-3 text-emerald-400" />
                        : <X className="h-3 w-3 text-muted-foreground/40" />
                      }
                      <span className={cn(mat.ready ? 'text-muted-foreground' : 'text-muted-foreground/40')}>
                        {mat.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
