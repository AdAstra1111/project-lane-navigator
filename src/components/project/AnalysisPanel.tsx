/**
 * AnalysisPanel — Single source of truth for project analysis display.
 * Used inside ProjectShell's InspectorDrawer and as standalone on review pages.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Shield, Zap, Loader2, TrendingUp,
  DollarSign, Users, AlertTriangle, Layers, Sparkles, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useProjectAnalysis, useRunAnalysis, LANE_LABELS } from '@/hooks/useProjectAnalysis';

interface AnalysisPanelProps {
  projectId: string;
  /** compact = drawer mode (no hero ring); expanded = full page mode */
  mode?: 'compact' | 'expanded';
}

export function AnalysisPanel({ projectId, mode = 'compact' }: AnalysisPanelProps) {
  const { data: projectAnalysis, isLoading } = useProjectAnalysis(projectId);
  const runAnalysis = useRunAnalysis();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showSections, setShowSections] = useState(mode === 'expanded');

  const analysis = projectAnalysis?.analysis;
  const hasAnalysis = !!analysis?.verdict;
  const confidence = projectAnalysis?.confidence ?? analysis?.confidence ?? 0;
  const confidencePercent = Math.round(confidence * 100);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAnalysis) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-4">
        <p className="text-sm text-muted-foreground">
          {projectAnalysis?.title ? `"${projectAnalysis.title}" hasn't been analysed yet.` : 'No analysis available.'}
        </p>
        <Button
          size="sm"
          className="gap-2"
          onClick={() => runAnalysis.mutate(projectId)}
          disabled={runAnalysis.isPending}
        >
          {runAnalysis.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing…</>
          ) : (
            <><Zap className="h-3.5 w-3.5" /> Run Analysis</>
          )}
        </Button>
      </div>
    );
  }

  // Build sections
  const sections: {
    title: string;
    icon: React.ElementType;
    items: { label: string; value: string }[];
  }[] = [];

  if (analysis.structural_read) {
    const sr = analysis.structural_read;
    sections.push({
      title: 'Structural Read', icon: Activity,
      items: [
        ...(sr.format_detected ? [{ label: 'Format', value: sr.format_detected }] : []),
        ...(sr.genre_as_written ? [{ label: 'Genre', value: sr.genre_as_written }] : []),
        ...(sr.protagonist_goal_clarity ? [{ label: 'Protagonist', value: sr.protagonist_goal_clarity }] : []),
        ...(sr.structure_clarity ? [{ label: 'Structure', value: sr.structure_clarity }] : []),
      ],
    });
  }

  if (analysis.creative_signal) {
    const cs = analysis.creative_signal;
    sections.push({
      title: 'Creative Signal', icon: Sparkles,
      items: [
        ...(cs.originality ? [{ label: 'Originality', value: cs.originality }] : []),
        ...(cs.tone_consistency ? [{ label: 'Tone', value: cs.tone_consistency }] : []),
        ...(cs.emotional_engine ? [{ label: 'Emotional Engine', value: cs.emotional_engine }] : []),
        ...(cs.standout_elements ? [{ label: 'Standout', value: cs.standout_elements }] : []),
      ],
    });
  }

  if (analysis.market_reality) {
    const mr = analysis.market_reality;
    sections.push({
      title: 'Market Reality', icon: TrendingUp,
      items: [
        ...(mr.likely_audience ? [{ label: 'Audience', value: mr.likely_audience }] : []),
        ...(mr.comparable_titles ? [{ label: 'Comps', value: mr.comparable_titles }] : []),
        ...(mr.budget_implications ? [{ label: 'Budget', value: mr.budget_implications }] : []),
        ...(mr.commercial_risks ? [{ label: 'Risks', value: mr.commercial_risks }] : []),
      ],
    });
  }

  if (analysis.do_next?.length) {
    sections.push({
      title: 'Strategic Actions', icon: Shield,
      items: analysis.do_next.map((a, i) => ({ label: `Action ${i + 1}`, value: a })),
    });
  }

  const isCompact = mode === 'compact';

  return (
    <div className={cn('space-y-4', isCompact ? 'p-3' : 'max-w-2xl mx-auto px-6 py-8')}>
      {/* Score summary */}
      <div className={cn('text-center space-y-2', isCompact && 'space-y-1')}>
        {!isCompact && (
          <h2 className="font-display text-xl font-medium text-foreground">Analysis</h2>
        )}

        {/* Confidence + Lane */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {LANE_LABELS[analysis.lane || ''] || analysis.lane || '—'}
            </span>
          </div>
          <span className="text-xs font-mono text-muted-foreground">{confidencePercent}%</span>
        </div>

        {/* Score ring — expanded only */}
        {!isCompact && (
          <div className="flex justify-center py-4">
            <div className="relative w-28 h-28 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(var(--border))" strokeWidth="5" />
                <motion.circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 52}
                  initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - confidence) }}
                  transition={{ delay: 0.2, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                />
              </svg>
              <span className="font-display text-3xl font-semibold text-foreground">{confidencePercent}</span>
            </div>
          </div>
        )}

        {/* Verdict */}
        <p className={cn('text-muted-foreground leading-relaxed', isCompact ? 'text-xs' : 'text-sm')}>
          {analysis.verdict}
        </p>
      </div>

      {/* Rationale */}
      {analysis.rationale && (
        <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Rationale</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{analysis.rationale}</p>
        </div>
      )}

      {/* Toggle for compact mode */}
      {isCompact && sections.length > 0 && (
        <button
          onClick={() => setShowSections(!showSections)}
          className="w-full text-center text-[11px] text-primary font-medium hover:underline"
        >
          {showSections ? 'Hide detail' : `Show ${sections.length} sections`}
        </button>
      )}

      {/* Sections */}
      {(showSections || !isCompact) && sections.map((sec, i) => {
        const isOpen = expandedIdx === i;
        const Icon = sec.icon;
        return (
          <div key={sec.title} className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
            <button
              onClick={() => setExpandedIdx(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="text-xs font-medium text-foreground">{sec.title}</span>
              </div>
              <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground/50 transition-transform', isOpen && 'rotate-180')} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 space-y-2">
                    {sec.items.map((item) => (
                      <div key={item.label}>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">{item.label}</p>
                        <p className="text-xs text-foreground leading-relaxed">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Avoid */}
      {analysis.avoid && analysis.avoid.length > 0 && (showSections || !isCompact) && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-1">Avoid</p>
          {analysis.avoid.map((item, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-card/30 px-3 py-2 flex items-start gap-2">
              <span className="text-destructive text-[10px] mt-0.5">✕</span>
              <p className="text-xs text-muted-foreground">{item}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
