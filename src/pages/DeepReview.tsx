import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowLeft, ArrowRight, Activity, BarChart3, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';

const DEBUG_NAV = true;

/* ── Metric helper ── */
interface Metric {
  label: string;
  value: string;
  sentiment?: 'positive' | 'neutral' | 'caution';
}

/* ── Section data ── */
const SECTIONS: {
  title: string;
  icon: React.ElementType;
  highlighted?: boolean;
  metrics?: Metric[];
  strategies?: { title: string; uplift: string }[];
}[] = [
  {
    title: 'Structural Health',
    icon: Activity,
    metrics: [
      { label: 'Act Integrity Score', value: '82 / 100', sentiment: 'positive' },
      { label: 'Pacing Density', value: 'Balanced', sentiment: 'positive' },
      { label: 'Character Arc Strength', value: 'Strong', sentiment: 'positive' },
      { label: 'Narrative Clarity Flags', value: '1 minor flag', sentiment: 'caution' },
    ],
  },
  {
    title: 'Commercial Position',
    icon: BarChart3,
    metrics: [
      { label: 'Budget Realism Score', value: '71 / 100', sentiment: 'neutral' },
      { label: 'Genre Alignment Confidence', value: 'High', sentiment: 'positive' },
      { label: 'Comparable Performance', value: 'Above Median', sentiment: 'positive' },
      { label: 'Market Appetite Signal', value: 'Moderate', sentiment: 'neutral' },
    ],
  },
  {
    title: 'Strategic Risk',
    icon: ShieldAlert,
    metrics: [
      { label: 'Financing Difficulty Score', value: 'Low–Medium', sentiment: 'neutral' },
      { label: 'Casting Dependency Risk', value: 'Low', sentiment: 'positive' },
      { label: 'Sales Territory Sensitivity', value: 'Moderate', sentiment: 'caution' },
      { label: 'Execution Risk Flags', value: '0 critical', sentiment: 'positive' },
    ],
  },
  {
    title: 'Optimisation Path',
    icon: Sparkles,
    highlighted: true,
    strategies: [
      { title: 'Budget Tier Adjustment', uplift: '+23% finance probability' },
      { title: 'Genre Repositioning', uplift: '+18% buyer alignment' },
      { title: 'Midpoint Structural Rewrite', uplift: '+14% retention projection' },
    ],
  },
];

const sentimentColor = (s?: 'positive' | 'neutral' | 'caution') => {
  if (s === 'positive') return 'text-emerald-500';
  if (s === 'caution') return 'text-amber-500';
  return 'text-foreground';
};

const sectionAnim = (delay: number) => ({
  initial: { opacity: 0, y: 14 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
});

const DeepReview = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<Record<number, boolean>>({ 3: true });

  const toggle = (i: number) => setOpen((prev) => ({ ...prev, [i]: !prev[i] }));

  // Debug: log route changes
  useEffect(() => {
    if (DEBUG_NAV) console.log('[DeepReview] location changed', location.pathname);
  }, [location.pathname]);

  // Debug: document-level capture click listener
  useEffect(() => {
    if (!DEBUG_NAV) return;
    const handler = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      console.log('[DeepReview][capture] click', {
        target: e.target,
        currentTarget: e.currentTarget,
        defaultPrevented: e.defaultPrevented,
        elementFromPoint: el,
        elementClass: el?.className,
      });
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24 space-y-16">
        {/* Wordmark */}
        <motion.div {...sectionAnim(0)} className="text-center">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">
            IFFY
          </span>
        </motion.div>

        {/* Header */}
        <motion.section {...sectionAnim(0.05)} className="text-center space-y-3">
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
            Deep Review
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Full structural, commercial and strategic analysis of your project.
          </p>
        </motion.section>

        {/* Sections */}
        <div className="space-y-3">
          {SECTIONS.map((section, i) => {
            const isOpen = !!open[i];
            const Icon = section.icon;
            return (
              <motion.div
                key={section.title}
                {...sectionAnim(0.12 + i * 0.06)}
                className={`rounded-xl border overflow-hidden transition-shadow duration-300 ${
                  section.highlighted
                    ? 'border-primary/20 bg-primary/[0.02] shadow-[0_0_24px_-6px_hsl(var(--primary)/0.08)]'
                    : 'border-border/50 bg-card/40'
                }`}
              >
                {/* Trigger */}
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-lg ${
                        section.highlighted ? 'bg-primary/10' : 'bg-muted/60'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${section.highlighted ? 'text-primary' : 'text-muted-foreground/70'}`}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground">{section.title}</span>
                    {section.highlighted && (
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Key
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground/50 flex-shrink-0 transition-transform duration-300 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Content */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 pt-1">
                        {/* Metric cards */}
                        {section.metrics && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {section.metrics.map((m) => (
                              <div
                                key={m.label}
                                className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-1"
                              >
                                <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                                  {m.label}
                                </p>
                                <p className={`text-sm font-medium ${sentimentColor(m.sentiment)}`}>
                                  {m.value}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Strategy pathways */}
                        {section.strategies && (
                          <div className="space-y-3">
                            {section.strategies.map((s, si) => (
                              <div
                                key={s.title}
                                className="rounded-lg border border-border/40 bg-background/60 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                              >
                                <div className="space-y-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">
                                    <span className="text-muted-foreground/50 mr-1.5">
                                      Option {String.fromCharCode(65 + si)}:
                                    </span>
                                    {s.title}
                                  </p>
                                  <p className="text-xs text-primary font-medium">{s.uplift}</p>
                                </div>
                                <Button variant="outline" size="sm" className="text-xs h-8 rounded-lg shrink-0">
                                  Explore Strategy
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* ── Studio Mode Reveal ── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-center space-y-5"
        >
          <div className="rounded-2xl border border-primary/10 bg-primary/[0.02] py-10 px-6 space-y-5 relative overflow-hidden">
            {/* Subtle ambient glow behind button area */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 rounded-full bg-primary/[0.04] blur-3xl" />
            </div>

            <div className="relative space-y-5">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">
                  Studio Mode Unlocked
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Access advanced development tools and full project control.
                </p>
              </div>

              <Button
                type="button"
                size="lg"
                className={`rounded-xl gap-2 text-sm font-medium px-6 shadow-[0_0_20px_-4px_hsl(var(--primary)/0.25)] ${DEBUG_NAV ? 'ring-2 ring-blue-500/50' : ''}`}
                onClick={(e) => {
                  if (DEBUG_NAV) {
                    const el = document.elementFromPoint(e.clientX, e.clientY);
                    console.log('[DeepReview] CTA click: studio mode', {
                      target: e.target,
                      currentTarget: e.currentTarget,
                      elementFromPoint: el,
                      elementClass: el?.className,
                      from: location.pathname,
                    });
                  }
                  navigate('/dashboard');
                }}
              >
                Enter Studio Mode
                <ArrowRight className="h-4 w-4" />
              </Button>

              <p className="text-[11px] text-muted-foreground/40 tracking-wide">
                Canon OS · Rewrite Engine · Scenario Simulator · Development Controls
              </p>
            </div>
          </div>
        </motion.section>

        {/* Back link */}
        <motion.div {...sectionAnim(0.7)} className="text-center pb-8">
          <button
            type="button"
            onClick={(e) => {
              if (DEBUG_NAV) {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                console.log('[DeepReview] CTA click: quick review', {
                  target: e.target,
                  currentTarget: e.currentTarget,
                  elementFromPoint: el,
                  elementClass: el?.className,
                  from: location.pathname,
                });
              }
              navigate('/quick-review');
            }}
            className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors ${DEBUG_NAV ? 'ring-2 ring-blue-500/50' : ''}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Quick Review
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default DeepReview;
