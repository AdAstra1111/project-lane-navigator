/**
 * Packaging Delta Panel
 *
 * Shows before/after impact when attachments change, attachment grades,
 * and production-type-specific packaging intelligence.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Shield, Target, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ProjectCastMember, ProjectHOD } from '@/hooks/useProjectAttachments';
import {
  gradeAllAttachments,
  getProductionTypePackagingContext,
  GRADE_CONFIG,
  type AttachmentGrading,
  type ProductionTypePackagingContext,
} from '@/lib/packaging-delta';
import { calculateCastImpact } from '@/lib/cast-value-engine';

interface Props {
  cast: ProjectCastMember[];
  hods: ProjectHOD[];
  format: string;
}

export function PackagingDeltaPanel({ cast, hods, format }: Props) {
  const gradings = useMemo(() => gradeAllAttachments(cast, hods), [cast, hods]);
  const impact = useMemo(() => calculateCastImpact(cast, hods), [cast, hods]);
  const typeContext = useMemo(() => getProductionTypePackagingContext(format, cast, hods), [format, cast, hods]);

  const gradeDistribution = useMemo(() => {
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    gradings.forEach(g => dist[g.grade]++);
    return dist;
  }, [gradings]);

  if (cast.length === 0 && hods.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Packaging Intelligence Header */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">Packaging Intelligence</h3>
        </div>

        {/* Grade Distribution */}
        <div className="mb-4">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Attachment Grade Distribution</span>
          <div className="flex gap-2 mt-2">
            {(['A', 'B', 'C', 'D'] as const).map(grade => (
              <div key={grade} className="flex-1 text-center">
                <div className={`rounded-lg px-2 py-1.5 border ${GRADE_CONFIG[grade].color}`}>
                  <span className="text-lg font-bold">{gradeDistribution[grade]}</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 block">Grade {grade}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Finance Probability Estimate */}
        <div className="bg-muted/30 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Est. Finance Probability Shift</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {impact.financeabilityDelta > 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className={`text-sm font-semibold ${impact.financeabilityDelta > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                +{Math.round(impact.financeabilityDelta * 0.6 * 10) / 10}%
              </span>
              <span className="text-xs text-muted-foreground">from current package</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground">Package Score</span>
            <div className="text-lg font-bold text-foreground">{impact.packageScore}</div>
          </div>
        </div>
      </div>

      {/* Attachment Grades Detail */}
      {gradings.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold text-foreground text-sm">Attachment Grades</h3>
          </div>
          <div className="space-y-1.5">
            {gradings.map(g => (
              <GradingRow key={g.id} grading={g} />
            ))}
          </div>
        </div>
      )}

      {/* Production-Type Context */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">
            {formatLabel(format)} Packaging Priorities
          </h3>
        </div>

        {/* Primary Drivers */}
        <div className="mb-3">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">What Matters Most</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {typeContext.primaryDrivers.map((d, i) => (
              <Badge key={i} variant="outline" className="text-[10px] px-2 py-0.5">
                {d}
              </Badge>
            ))}
          </div>
        </div>

        {/* Weight Distribution */}
        <div className="mb-3">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Weight Distribution</span>
          <div className="flex gap-2 mt-1.5">
            <WeightBar label="Cast" value={typeContext.castWeight} />
            <WeightBar label="Director" value={typeContext.directorWeight} />
            <WeightBar label="Producer" value={typeContext.producerWeight} />
          </div>
        </div>

        {/* Insights */}
        {typeContext.insights.length > 0 && (
          <div className="space-y-1 mb-3">
            {typeContext.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-foreground">{insight.replace(/^✓\s*/, '')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Missing Elements */}
        {typeContext.missingElements.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Would Strengthen Package</span>
            {typeContext.missingElements.map((el, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{el}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function GradingRow({ grading }: { grading: AttachmentGrading }) {
  const config = GRADE_CONFIG[grading.grade];
  return (
    <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge className={`text-xs px-1.5 py-0 border font-bold shrink-0 ${config.color}`}>
              {config.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs max-w-[200px]">
            {config.desc}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground truncate block">{grading.name || 'Unnamed'}</span>
        <span className="text-[10px] text-muted-foreground">{grading.role} · {grading.type === 'cast' ? 'Cast' : 'HOD'}</span>
      </div>
      <div className="flex gap-1">
        <MiniBar label="Commit" value={grading.factors.commitment} />
        <MiniBar label="Value" value={grading.factors.marketValue} />
        <MiniBar label="Territory" value={grading.factors.territoryRelevance} />
      </div>
      <span className="text-xs font-semibold text-foreground w-6 text-right">{grading.composite}</span>
    </div>
  );
}

function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="w-8 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60 transition-all"
              style={{ width: `${value}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[10px]">
          {label}: {value}%
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function WeightBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-medium text-foreground">{Math.round(value * 100)}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/50 transition-all"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    film: 'Feature Film', 'tv-series': 'TV Series', documentary: 'Documentary',
    'documentary-series': 'Doc Series', commercial: 'Commercial',
    'branded-content': 'Branded Content', 'short-film': 'Short Film',
    'music-video': 'Music Video', 'proof-of-concept': 'Proof of Concept',
    'digital-series': 'Digital Series', 'vertical-drama': 'Vertical Drama',
    hybrid: 'Hybrid',
  };
  return labels[format] || 'Film';
}
