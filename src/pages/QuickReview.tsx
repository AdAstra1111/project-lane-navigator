import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowRight, TrendingUp, DollarSign, Users, AlertTriangle, Shield, Loader2, Zap, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { DeepReviewModal } from '@/components/review/DeepReviewModal';
import { ReviewEmptyState, ReviewDocPicker } from '@/components/review/ReviewEmptyState';
import { useProjectAnalysis, useRunAnalysis, LANE_LABELS } from '@/hooks/useProjectAnalysis';

const section = (delay: number) => ({
  initial: { opacity: 0, y: 16 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
});

const QuickReview = () => {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deepOpen, setDeepOpen] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const projectId = searchParams.get('projectId');
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const effectiveProjectId = projectId || pickedProjectId;

  const { data: projectAnalysis, isLoading } = useProjectAnalysis(effectiveProjectId);
  const runAnalysis = useRunAnalysis();

  // If no project context, show empty state
  if (!effectiveProjectId) {
    return (
      <div className="space-y-0">
        <ReviewEmptyState
          reviewType="quick-review"
          onSelectProject={(id) => setPickedProjectId(id)}
          onSelectDoc={(pid) => navigate(`/quick-review?projectId=${pid}`)}
        />
        {pickedProjectId && (
          <div className="max-w-md mx-auto px-6 pb-16">
            <ReviewDocPicker projectId={pickedProjectId} reviewType="quick-review" />
          </div>
        )}
      </div>
    );
  }

  const analysis = projectAnalysis?.analysis;
  const hasAnalysis = !!analysis?.verdict;
  const confidence = projectAnalysis?.confidence ?? analysis?.confidence ?? 0;
  const confidencePercent = Math.round(confidence * 100);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // No analysis yet — show CTA to run
  if (!hasAnalysis) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center space-y-8">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">IFFY</span>
          <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Quick Review</h1>
          <p className="text-sm text-muted-foreground">
            {projectAnalysis?.title ? `"${projectAnalysis.title}" hasn't been analysed yet.` : 'No analysis available for this project.'}
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

  // Build priority actions from real do_next
  const priorityActions = (analysis.do_next || []).map((action, i) => ({
    title: action,
    explanation: analysis.avoid?.[i] ? `Avoid: ${analysis.avoid[i]}` : '',
  }));

  // Build market cards from real data
  const marketCards = [
    {
      icon: DollarSign,
      label: 'Budget Implications',
      value: analysis.market_reality?.budget_implications || '—',
      sublabel: projectAnalysis?.budgetRange || '',
    },
    {
      icon: Users,
      label: 'Likely Audience',
      value: analysis.market_reality?.likely_audience || '—',
      sublabel: '',
    },
    {
      icon: TrendingUp,
      label: 'Primary Lane',
      value: LANE_LABELS[analysis.lane || ''] || analysis.lane || '—',
      sublabel: `${confidencePercent}% confidence`,
    },
    {
      icon: AlertTriangle,
      label: 'Commercial Risks',
      value: analysis.market_reality?.commercial_risks?.slice(0, 60) || 'None identified',
      sublabel: analysis.market_reality?.comparable_titles?.slice(0, 50) || '',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24 space-y-20">

        {/* Wordmark */}
        <motion.div {...section(0)} className="text-center">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">IFFY</span>
        </motion.div>

        {/* ── Score Hero ── */}
        <motion.section {...section(0.1)} className="text-center space-y-8">
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
            Quick Review
          </h1>
          {projectAnalysis?.title && (
            <p className="text-xs text-muted-foreground/60 uppercase tracking-wider">{projectAnalysis.title}</p>
          )}

          {/* Score ring */}
          <div className="flex justify-center">
            <div className="relative w-36 h-36 flex items-center justify-center">
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
                  transition={{ delay: 0.4, duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </svg>
              <motion.span
                className="font-display text-4xl font-semibold text-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.5 }}
              >
                {confidencePercent}
              </motion.span>
            </div>
          </div>

          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Lane Confidence
          </p>

          {/* Sub-metrics */}
          <div className="flex justify-center gap-10 text-center">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {analysis.structural_read?.format_detected || projectAnalysis?.format || '—'}
              </p>
              <p className="text-[11px] text-muted-foreground/70">Format Detected</p>
            </div>
            <div className="w-px bg-border" />
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-medium text-foreground">
                  {LANE_LABELS[analysis.lane || ''] || analysis.lane || '—'}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/70">Assigned Lane</p>
            </div>
          </div>

          {/* Verdict */}
          <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto">
            {analysis.verdict}
          </p>
        </motion.section>

        {/* ── Priority Actions ── */}
        {priorityActions.length > 0 && (
          <motion.section {...section(0.25)} className="space-y-6">
            <h2 className="font-display text-lg font-medium text-foreground text-center">
              Priority Actions
            </h2>
            <div className="space-y-3">
              {priorityActions.map((action, i) => {
                const isOpen = expanded === i;
                return (
                  <motion.div
                    key={i}
                    layout
                    className="rounded-xl border border-border/60 bg-card/50 overflow-hidden transition-shadow duration-300 hover:shadow-[0_2px_20px_-4px_hsl(var(--foreground)/0.05)]"
                  >
                    <button
                      onClick={() => setExpanded(isOpen ? null : i)}
                      className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="text-sm font-medium text-foreground">{action.title}</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground/60 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && action.explanation && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-5 pt-0">
                            <p className="text-sm text-muted-foreground leading-relaxed pl-9">{action.explanation}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* ── Market Snapshot ── */}
        <motion.section {...section(0.35)} className="space-y-6">
          <h2 className="font-display text-lg font-medium text-foreground text-center">
            Market Snapshot
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {marketCards.map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 + i * 0.07, duration: 0.5 }}
                className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <card.icon className="h-4 w-4 text-muted-foreground/60" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">{card.label}</span>
                </div>
                <p className="text-sm font-medium text-foreground">{card.value}</p>
                {card.sublabel && <p className="text-[11px] text-muted-foreground/50">{card.sublabel}</p>}
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── Deep Review CTA ── */}
        <motion.section {...section(0.5)} className="text-center space-y-5 pb-4">
          <div className="rounded-2xl border border-border/40 bg-card/30 py-10 px-6 space-y-5">
            <p className="font-display text-lg font-medium text-foreground">
              Ready for a full strategic diagnosis?
            </p>
            <Button
              size="lg"
              className="rounded-xl gap-2 text-sm font-medium px-6"
              onClick={() => setDeepOpen(true)}
            >
              Run Deep Review
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <DeepReviewModal
            open={deepOpen}
            onOpenChange={setDeepOpen}
            onStart={() => navigate(`/deep-review?projectId=${effectiveProjectId}`)}
          />
        </motion.section>

        {/* View in Project link */}
        <motion.div {...section(0.55)} className="text-center pb-8">
          <Link to={`/projects/${effectiveProjectId}`} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors inline-flex items-center gap-1">
            <LinkIcon className="h-3 w-3" /> View in Project Detail
          </Link>
        </motion.div>
      </div>
    </div>
  );
};

export default QuickReview;
