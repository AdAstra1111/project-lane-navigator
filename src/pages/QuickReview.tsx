import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowRight, TrendingUp, DollarSign, Users, AlertTriangle, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { DeepReviewModal } from '@/components/review/DeepReviewModal';

const PRIORITY_ACTIONS = [
  {
    title: 'Sharpen the logline for buyer clarity',
    explanation: 'The current logline is descriptive but lacks a clear commercial hook. A punchier version would improve first-read traction with acquisitions teams.',
  },
  {
    title: 'Clarify the protagonist\u2019s internal conflict by Act II',
    explanation: 'Structural analysis shows the emotional stakes plateau mid-script. Deepening the inner journey will strengthen audience engagement and festival positioning.',
  },
  {
    title: 'Address budget-to-ambition gap in Act III',
    explanation: 'The final act implies production scale beyond the estimated budget tier. Consider practical alternatives that preserve spectacle without inflating costs.',
  },
];

const MARKET_CARDS = [
  { icon: DollarSign, label: 'Estimated Budget Tier', value: 'Mid-Range Indie', sublabel: '$2M – $6M' },
  { icon: Users, label: 'Likely Buyers', value: 'Specialty Distributors', sublabel: 'A24 · Neon · MUBI' },
  { icon: TrendingUp, label: 'Primary Monetisation Lane', value: 'Festival → Streaming', sublabel: 'Theatrical window optional' },
  { icon: AlertTriangle, label: 'Risk Flag Level', value: 'Low', sublabel: '1 flag identified' },
];

const section = (delay: number) => ({
  initial: { opacity: 0, y: 16 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
});

const QuickReview = () => {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deepOpen, setDeepOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24 space-y-20">

        {/* Wordmark */}
        <motion.div {...section(0)} className="text-center">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">
            IFFY
          </span>
        </motion.div>

        {/* ── Score Hero ── */}
        <motion.section {...section(0.1)} className="text-center space-y-8">
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
            Quick Review
          </h1>

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
                  animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - 0.74) }}
                  transition={{ delay: 0.4, duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </svg>
              <motion.span
                className="font-display text-4xl font-semibold text-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.5 }}
              >
                74
              </motion.span>
            </div>
          </div>

          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Overall Viability
          </p>

          {/* Sub-metrics */}
          <div className="flex justify-center gap-10 text-center">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Moderate</p>
              <p className="text-[11px] text-muted-foreground/70">Commercial Readiness</p>
            </div>
            <div className="w-px bg-border" />
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-medium text-foreground">High</p>
              </div>
              <p className="text-[11px] text-muted-foreground/70">Confidence Level</p>
            </div>
          </div>

          {/* Summary paragraph */}
          <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto">
            A structurally sound character drama with strong festival positioning and credible indie-market appeal. The script demonstrates clear directorial voice but would benefit from tighter commercial framing to unlock broader distribution interest.
          </p>
        </motion.section>

        {/* ── Priority Actions ── */}
        <motion.section {...section(0.25)} className="space-y-6">
          <h2 className="font-display text-lg font-medium text-foreground text-center">
            Top 3 Priority Actions
          </h2>

          <div className="space-y-3">
            {PRIORITY_ACTIONS.map((action, i) => {
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
                      <span className="text-sm font-medium text-foreground truncate">
                        {action.title}
                      </span>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground/60 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                    />
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
                        <div className="px-5 pb-5 pt-0 space-y-4">
                          <p className="text-sm text-muted-foreground leading-relaxed pl-9">
                            {action.explanation}
                          </p>
                          <div className="pl-9">
                            <Button variant="outline" size="sm" className="text-xs h-8 rounded-lg">
                              Review Recommendation
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* ── Market Snapshot ── */}
        <motion.section {...section(0.35)} className="space-y-6">
          <h2 className="font-display text-lg font-medium text-foreground text-center">
            Market Snapshot
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MARKET_CARDS.map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 + i * 0.07, duration: 0.5 }}
                className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <card.icon className="h-4 w-4 text-muted-foreground/60" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                    {card.label}
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground">{card.value}</p>
                <p className="text-[11px] text-muted-foreground/50">{card.sublabel}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── Deep Review CTA ── */}
        <motion.section {...section(0.5)} className="text-center space-y-5 pb-8">
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
            onStart={() => navigate('/dashboard')}
          />
        </motion.section>
      </div>
    </div>
  );
};

export default QuickReview;
