import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowLeft, ArrowRight, Activity, BarChart3, ShieldAlert, Sparkles, Loader2, Zap, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ReviewEmptyState, ReviewDocPicker } from '@/components/review/ReviewEmptyState';
import { useProjectAnalysis, useRunAnalysis, LANE_LABELS } from '@/hooks/useProjectAnalysis';

const sectionAnim = (delay: number) => ({
  initial: { opacity: 0, y: 14 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
});

const DeepReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const projectId = searchParams.get('projectId');
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const effectiveProjectId = projectId || pickedProjectId;

  const { data: projectAnalysis, isLoading } = useProjectAnalysis(effectiveProjectId);
  const runAnalysis = useRunAnalysis();

  const toggle = (i: number) => setOpen((prev) => ({ ...prev, [i]: !prev[i] }));

  // No project context → empty state
  if (!effectiveProjectId) {
    return (
      <div className="space-y-0">
        <ReviewEmptyState
          reviewType="deep-review"
          onSelectProject={(id) => setPickedProjectId(id)}
          onSelectDoc={(pid) => navigate(`/deep-review?projectId=${pid}`)}
        />
        {pickedProjectId && (
          <div className="max-w-md mx-auto px-6 pb-16">
            <ReviewDocPicker projectId={pickedProjectId} reviewType="deep-review" />
          </div>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const analysis = projectAnalysis?.analysis;
  const hasAnalysis = !!analysis?.verdict;

  // No analysis → CTA
  if (!hasAnalysis) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center space-y-8">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">IFFY</span>
          <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Deep Review</h1>
          <p className="text-sm text-muted-foreground">
            {projectAnalysis?.title ? `"${projectAnalysis.title}" hasn't been analysed yet.` : 'No analysis available.'}
          </p>
          <Button
            size="lg"
            className="rounded-xl gap-2"
            onClick={() => runAnalysis.mutate(effectiveProjectId)}
            disabled={runAnalysis.isPending}
          >
            {runAnalysis.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</>
            ) : (
              <><Zap className="h-4 w-4" /> Run Analysis</>
            )}
          </Button>
          <div>
            <Link to={`/projects/${effectiveProjectId}`} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors inline-flex items-center gap-1">
              <LinkIcon className="h-3 w-3" /> View in Project
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Build sections from real data — only show sections that have data
  const sections: {
    title: string;
    icon: React.ElementType;
    highlighted?: boolean;
    items: { label: string; value: string; sentiment?: 'positive' | 'neutral' | 'caution' }[];
  }[] = [];

  if (analysis.structural_read) {
    const sr = analysis.structural_read;
    sections.push({
      title: 'Structural Read',
      icon: Activity,
      items: [
        ...(sr.format_detected ? [{ label: 'Format Detected', value: sr.format_detected }] : []),
        ...(sr.genre_as_written ? [{ label: 'Genre (as written)', value: sr.genre_as_written }] : []),
        ...(sr.protagonist_goal_clarity ? [{ label: 'Protagonist / Goal Clarity', value: sr.protagonist_goal_clarity }] : []),
        ...(sr.structure_clarity ? [{ label: 'Structure Clarity', value: sr.structure_clarity }] : []),
      ],
    });
  }

  if (analysis.creative_signal) {
    const cs = analysis.creative_signal;
    sections.push({
      title: 'Creative Signal',
      icon: Sparkles,
      items: [
        ...(cs.originality ? [{ label: 'Originality', value: cs.originality }] : []),
        ...(cs.tone_consistency ? [{ label: 'Tone Consistency', value: cs.tone_consistency }] : []),
        ...(cs.emotional_engine ? [{ label: 'Emotional Engine', value: cs.emotional_engine }] : []),
        ...(cs.standout_elements ? [{ label: 'Standout Elements', value: cs.standout_elements }] : []),
      ],
    });
  }

  if (analysis.market_reality) {
    const mr = analysis.market_reality;
    sections.push({
      title: 'Market Reality',
      icon: BarChart3,
      items: [
        ...(mr.likely_audience ? [{ label: 'Likely Audience', value: mr.likely_audience }] : []),
        ...(mr.comparable_titles ? [{ label: 'Comparable Titles', value: mr.comparable_titles }] : []),
        ...(mr.budget_implications ? [{ label: 'Budget Implications', value: mr.budget_implications }] : []),
        ...(mr.commercial_risks ? [{ label: 'Commercial Risks', value: mr.commercial_risks, sentiment: 'caution' as const }] : []),
      ],
    });
  }

  // Strategy section from do_next
  if (analysis.do_next?.length) {
    sections.push({
      title: 'Strategic Actions',
      icon: ShieldAlert,
      highlighted: true,
      items: analysis.do_next.map((action, i) => ({
        label: `Action ${i + 1}`,
        value: action,
        sentiment: 'positive' as const,
      })),
    });
  }

  const sentimentColor = (s?: 'positive' | 'neutral' | 'caution') => {
    if (s === 'positive') return 'text-emerald-500';
    if (s === 'caution') return 'text-amber-500';
    return 'text-foreground';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24 space-y-16">
        {/* Wordmark */}
        <motion.div {...sectionAnim(0)} className="text-center">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">IFFY</span>
        </motion.div>

        {/* Header */}
        <motion.section {...sectionAnim(0.05)} className="text-center space-y-3">
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
            Deep Review
          </h1>
          {projectAnalysis?.title && (
            <p className="text-xs text-muted-foreground/60 uppercase tracking-wider">{projectAnalysis.title}</p>
          )}
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {analysis.verdict}
          </p>
        </motion.section>

        {/* Lane assignment */}
        <motion.section {...sectionAnim(0.08)} className="text-center">
          <div className="inline-flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.03] px-6 py-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Lane</span>
            <span className="text-sm font-medium text-foreground">{LANE_LABELS[analysis.lane || ''] || analysis.lane}</span>
            <span className="text-[11px] text-primary font-medium">{Math.round((analysis.confidence || 0) * 100)}%</span>
          </div>
        </motion.section>

        {/* Rationale */}
        {analysis.rationale && (
          <motion.section {...sectionAnim(0.1)}>
            <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Lane Rationale</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{analysis.rationale}</p>
            </div>
          </motion.section>
        )}

        {/* Dynamic sections */}
        <div className="space-y-3">
          {sections.map((sec, i) => {
            const isOpen = open[i] ?? (sec.highlighted || false);
            const Icon = sec.icon;
            return (
              <motion.div
                key={sec.title}
                {...sectionAnim(0.15 + i * 0.06)}
                className={`rounded-xl border overflow-hidden transition-shadow duration-300 ${
                  sec.highlighted
                    ? 'border-primary/20 bg-primary/[0.02] shadow-[0_0_24px_-6px_hsl(var(--primary)/0.08)]'
                    : 'border-border/50 bg-card/40'
                }`}
              >
                <button onClick={() => toggle(i)} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${sec.highlighted ? 'bg-primary/10' : 'bg-muted/60'}`}>
                      <Icon className={`h-4 w-4 ${sec.highlighted ? 'text-primary' : 'text-muted-foreground/70'}`} />
                    </div>
                    <span className="text-sm font-medium text-foreground">{sec.title}</span>
                    {sec.highlighted && (
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">Key</span>
                    )}
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground/50 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 pt-1 space-y-3">
                        {sec.items.map((item) => (
                          <div key={item.label} className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-1">
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">{item.label}</p>
                            <p className={`text-sm leading-relaxed ${sentimentColor(item.sentiment)}`}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* Lane not suitable */}
        {analysis.lane_not_suitable && (
          <motion.section {...sectionAnim(0.5)}>
            <div className="rounded-xl border border-destructive/20 bg-destructive/[0.03] p-5 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-destructive/70 font-medium">Lane Not Suitable</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{analysis.lane_not_suitable}</p>
            </div>
          </motion.section>
        )}

        {/* Avoid section */}
        {analysis.avoid && analysis.avoid.length > 0 && (
          <motion.section {...sectionAnim(0.55)} className="space-y-3">
            <h2 className="font-display text-lg font-medium text-foreground text-center">Avoid</h2>
            <div className="space-y-2">
              {analysis.avoid.map((item, i) => (
                <div key={i} className="rounded-lg border border-border/40 bg-card/40 p-4 flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold flex items-center justify-center mt-0.5">✕</span>
                  <p className="text-sm text-muted-foreground">{item}</p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* ── Studio Mode Reveal ── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-center space-y-5"
        >
          <div className="rounded-2xl border border-primary/10 bg-primary/[0.02] py-10 px-6 space-y-5 relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 rounded-full bg-primary/[0.04] blur-3xl" />
            </div>
            <div className="relative space-y-5">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">Studio Mode Unlocked</p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Access advanced development tools and full project control.
                </p>
              </div>
              <Button
                type="button"
                size="lg"
                className="rounded-xl gap-2 text-sm font-medium px-6 shadow-[0_0_20px_-4px_hsl(var(--primary)/0.25)]"
                onClick={() => navigate(`/projects/${effectiveProjectId}`)}
              >
                Enter Studio Mode
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.section>

        {/* Back + View links */}
        <motion.div {...sectionAnim(0.7)} className="text-center pb-8 space-y-3">
          <button
            type="button"
            onClick={() => navigate(`/quick-review?projectId=${effectiveProjectId}`)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Quick Review
          </button>
          <div>
            <Link to={`/projects/${effectiveProjectId}`} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors inline-flex items-center gap-1">
              <LinkIcon className="h-3 w-3" /> View in Project Detail
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default DeepReview;
