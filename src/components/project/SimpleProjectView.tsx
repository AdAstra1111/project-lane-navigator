/**
 * Simple mode project view — max 6 compact blocks.
 * Zero scroll-bloat. Summaries first, details on demand.
 */

import { motion } from 'framer-motion';
import {
  Gauge, Target, AlertTriangle, ArrowRight,
  CheckCircle2, FileText, Users, DollarSign, Clapperboard,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LaneBadge } from '@/components/LaneBadge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { Project, MonetisationLane, FullAnalysis } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';

interface Props {
  project: Project;
  readiness: ReadinessResult | null;
  analysis: FullAnalysis | null;
  scriptCount: number;
  castCount: number;
  partnerCount: number;
  hodCount: number;
  financeScenarioCount: number;
  onSwitchToAdvanced: () => void;
}

const card = 'glass-card rounded-xl p-4';
const anim = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

export function SimpleProjectView({
  project, readiness, analysis, scriptCount, castCount,
  partnerCount, hodCount, financeScenarioCount, onSwitchToAdvanced,
}: Props) {
  const blockers = readiness?.blockers ?? [];
  const strengths = readiness?.strengths ?? [];
  const doNext = analysis?.do_next ?? [];

  // Build "next actions" from readiness blockers + analysis do_next
  const nextActions = [
    ...blockers.slice(0, 3),
    ...doNext.filter(d => !blockers.some(b => b.includes(d.slice(0, 15)))).slice(0, 2),
  ].slice(0, 5);

  // Red flags from analysis avoid + blockers
  const redFlags = [
    ...(analysis?.avoid ?? []),
    ...blockers.filter(b => b.toLowerCase().includes('missing') || b.toLowerCase().includes('no ')),
  ].slice(0, 3);

  return (
    <div className="space-y-3">
      {/* BLOCK 1: Lane Snapshot */}
      <motion.div {...anim} transition={{ delay: 0 }} className={card}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Lane</span>
          </div>
          {project.assigned_lane && (
            <LaneBadge lane={project.assigned_lane as MonetisationLane} size="sm" />
          )}
        </div>
        {project.reasoning && (
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{project.reasoning}</p>
        )}
      </motion.div>

      {/* BLOCK 2: Readiness Score + top 3 drivers */}
      {readiness && (
        <motion.div {...anim} transition={{ delay: 0.05 }} className={card}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-12 w-12 rounded-full border-2 border-primary/30 bg-primary/5">
              <span className="text-lg font-display font-bold text-foreground">{readiness.score}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Gauge className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-medium text-foreground">Readiness</span>
                <Badge variant="outline" className="text-[10px]">{readiness.stage}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>Script {readiness.breakdown.script}/25</span>
                <span>Package {readiness.breakdown.packaging}/30</span>
                <span>Finance {readiness.breakdown.finance}/25</span>
              </div>
            </div>
          </div>
          {readiness.bestNextStep && (
            <div className="mt-2 flex items-center gap-1.5 bg-primary/10 rounded-md px-2.5 py-1.5 text-xs text-foreground">
              <ArrowRight className="h-3 w-3 text-primary shrink-0" />
              <span className="line-clamp-1">{readiness.bestNextStep}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* BLOCK 3: Top 5 Next Actions */}
      {nextActions.length > 0 && (
        <motion.div {...anim} transition={{ delay: 0.1 }} className={card}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Next Actions</span>
          </div>
          <ul className="space-y-1">
            {nextActions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="text-primary font-mono text-[10px] mt-0.5">{i + 1}</span>
                <span className="line-clamp-1">{a}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* BLOCK 4: Red Flags (conditional) */}
      {redFlags.length > 0 && (
        <motion.div {...anim} transition={{ delay: 0.15 }} className={`${card} border-destructive/20`}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">Red Flags</span>
          </div>
          <ul className="space-y-1">
            {redFlags.map((f, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-destructive mt-0.5">•</span>
                <span className="line-clamp-1">{f}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* BLOCK 5: Monetisation Summary */}
      {(project.assigned_lane || analysis?.market_reality) && (
        <motion.div {...anim} transition={{ delay: 0.2 }} className={card}>
          <div className="flex items-center gap-2 mb-1.5">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Market Snapshot</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {analysis?.market_reality?.likely_audience && (
              <p>Audience: {analysis.market_reality.likely_audience}</p>
            )}
            {analysis?.market_reality?.comparable_titles && (
              <p>Comps: {analysis.market_reality.comparable_titles}</p>
            )}
            {analysis?.market_reality?.budget_implications && (
              <p>Budget: {analysis.market_reality.budget_implications}</p>
            )}
          </div>
        </motion.div>
      )}

      {/* BLOCK 6: Attachments Status */}
      <motion.div {...anim} transition={{ delay: 0.25 }} className={card}>
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Attachments</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Scripts', count: scriptCount, icon: Clapperboard },
            { label: 'Cast', count: castCount, icon: Users },
            { label: 'Partners', count: partnerCount, icon: Users },
            { label: 'Finance', count: financeScenarioCount, icon: DollarSign },
          ].map(({ label, count, icon: Icon }) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <Icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{label}</span>
              <Badge
                variant="outline"
                className={`text-[10px] ml-auto ${
                  count > 0 ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'
                }`}
              >
                {count}
              </Badge>
            </div>
          ))}
        </div>
      </motion.div>

      {/* View Advanced prompt */}
      <motion.div {...anim} transition={{ delay: 0.3 }} className="text-center pt-2 pb-4">
        <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={onSwitchToAdvanced}>
          View Advanced Details
        </Button>
      </motion.div>
    </div>
  );
}
