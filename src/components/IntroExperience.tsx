import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, DollarSign, Users, BarChart3, Sparkles,
  ArrowRight, Play, X, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const INTRO_KEY = 'iffy-intro-seen';

/* ── Cinematic slides ── */
const brandSlides = [
  {
    phase: 'brand',
    subtitle: 'Intelligent Film Flow & Yield',
    title: 'IFFY',
    body: 'From inception to recoup.',
  },
  {
    phase: 'value',
    icon: FolderOpen,
    title: 'Living dossiers, not documents',
    body: 'Every attachment — script, cast, partners — updates your project assessment automatically.',
  },
  {
    phase: 'value',
    icon: DollarSign,
    title: 'Finance built in from day one',
    body: 'Incentives, co-productions, and capital stacks evaluated in context of your project.',
  },
  {
    phase: 'value',
    icon: Users,
    title: 'Smart packaging & buyer matching',
    body: 'AI-powered talent recommendations and buyer scoring based on your project metadata.',
  },
  {
    phase: 'value',
    icon: BarChart3,
    title: 'Market intelligence finds you',
    body: 'Trend signals matched to your genre, tone, and format. Always current, always relevant.',
  },
];

/* ── Interactive tour steps ── */
const tourSteps = [
  {
    icon: Sparkles,
    title: 'Create your first project',
    body: 'Click "New Project" to build a living dossier. Add a title, genre, budget range, and territory to get started.',
    highlight: 'top-right',
  },
  {
    icon: FolderOpen,
    title: 'Attach and enrich',
    body: 'Upload scripts, add cast, attach partners. Every change updates your readiness score and finance picture automatically.',
    highlight: 'center',
  },
  {
    icon: DollarSign,
    title: 'Track your capital stack',
    body: 'Navigate to the Finance tab to log deals across pre-sales, equity, incentives, gap, and more. Visualise secured vs pipeline funding.',
    highlight: 'center',
  },
  {
    icon: BarChart3,
    title: 'Explore trends & buyers',
    body: 'Use the nav bar to access market trends, buyer matching, incentive finders, and production calendars.',
    highlight: 'top-nav',
  },
  {
    icon: Users,
    title: 'Collaborate with your team',
    body: "Invite collaborators with role-based access. Producers, sales agents, lawyers, and creatives see only what\u2019s relevant.",
    highlight: 'center',
  },
];

export function IntroExperience() {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'cinematic' | 'tour'>('cinematic');
  const [slideIndex, setSlideIndex] = useState(0);
  const [tourIndex, setTourIndex] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem(INTRO_KEY);
    if (!seen) {
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(INTRO_KEY, 'true');
  }, []);

  const nextSlide = () => {
    if (slideIndex < brandSlides.length - 1) {
      setSlideIndex(s => s + 1);
    } else {
      setPhase('tour');
      setTourIndex(0);
    }
  };

  const nextTour = () => {
    if (tourIndex < tourSteps.length - 1) {
      setTourIndex(t => t + 1);
    } else {
      dismiss();
    }
  };

  if (!visible) return null;

  const totalCinematic = brandSlides.length;
  const totalTour = tourSteps.length;

  return (
    <AnimatePresence>
      {phase === 'cinematic' && (
        <motion.div
          key="cinematic"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
        >
          {/* Dramatic background */}
          <div className="absolute inset-0 bg-[hsl(225,18%,4%)]" />
          
          {/* Ambient glow */}
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.15, 0.25, 0.15] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/20 blur-[120px]"
          />
          
          {/* Film grain overlay */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
            }}
          />

          {/* Skip button */}
          <button
            onClick={dismiss}
            className="absolute top-6 right-6 z-10 text-white/40 hover:text-white/80 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Content */}
          <div className="relative z-10 max-w-lg w-full mx-6">
            <AnimatePresence mode="wait">
              {brandSlides[slideIndex].phase === 'brand' ? (
                <motion.div
                  key="brand-reveal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.6 }}
                  className="text-center space-y-8"
                >
                  {/* Logo */}
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="mx-auto"
                  >
                    <div className="h-20 w-20 rounded-2xl bg-primary flex items-center justify-center mx-auto shadow-[0_0_60px_hsl(38_65%_55%/0.3)]">
                      <span className="font-display font-bold text-2xl text-primary-foreground">IF</span>
                    </div>
                  </motion.div>

                  {/* Subtitle */}
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6, duration: 0.5 }}
                    className="text-xs font-display uppercase tracking-[0.25em] text-primary"
                  >
                    {brandSlides[slideIndex].subtitle}
                  </motion.p>

                  {/* Title */}
                  <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="text-6xl sm:text-7xl font-display font-bold text-white tracking-tight"
                  >
                    {brandSlides[slideIndex].title}
                  </motion.h1>

                  {/* Tagline */}
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.2, duration: 0.6 }}
                    className="text-lg text-white/60 font-display"
                  >
                    {brandSlides[slideIndex].body}
                  </motion.p>

                  {/* Divider line */}
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 1.5, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="h-px w-24 mx-auto bg-gradient-to-r from-transparent via-primary/60 to-transparent"
                  />

                  {/* CTA */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.8, duration: 0.5 }}
                  >
                    <Button onClick={nextSlide} className="gap-2">
                      <Play className="h-4 w-4" /> Discover IFFY
                    </Button>
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div
                  key={`value-${slideIndex}`}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-6"
                >
                  {/* Progress dots */}
                  <div className="flex items-center gap-1.5">
                    {brandSlides.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 rounded-full transition-all duration-300 ${
                          i <= slideIndex ? 'bg-primary w-6' : 'bg-white/20 w-3'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Icon */}
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                  >
                    {brandSlides[slideIndex].icon && (
                      <div className="h-14 w-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                        {(() => {
                          const Icon = brandSlides[slideIndex].icon!;
                          return <Icon className="h-7 w-7 text-primary" />;
                        })()}
                      </div>
                    )}
                  </motion.div>

                  {/* Step label */}
                  <p className="text-xs font-display uppercase tracking-[0.2em] text-primary">
                    {slideIndex} of {totalCinematic - 1}
                  </p>

                  {/* Title */}
                  <h2 className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">
                    {brandSlides[slideIndex].title}
                  </h2>

                  {/* Body */}
                  <p className="text-white/60 text-lg leading-relaxed">
                    {brandSlides[slideIndex].body}
                  </p>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-4">
                    <button onClick={dismiss} className="text-xs text-white/30 hover:text-white/60 transition-colors">
                      Skip intro
                    </button>
                    <Button onClick={nextSlide} size="sm" className="gap-1.5">
                      {slideIndex < totalCinematic - 1 ? (
                        <>Continue <ChevronRight className="h-3.5 w-3.5" /></>
                      ) : (
                        <>Start tour <ArrowRight className="h-3.5 w-3.5" /></>
                      )}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {phase === 'tour' && (
        <motion.div
          key="tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
        >
          {/* Dimmed backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={dismiss}
          />

          {/* Spotlight ring animation */}
          {tourSteps[tourIndex].highlight === 'top-right' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute top-2 right-4 sm:right-8 w-40 h-14 rounded-xl border-2 border-primary/50 pointer-events-none"
              style={{ boxShadow: '0 0 30px hsl(38 65% 55% / 0.2)' }}
            />
          )}
          {tourSteps[tourIndex].highlight === 'top-nav' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute top-0 left-0 right-0 h-16 border-b-2 border-primary/40 pointer-events-none"
              style={{ boxShadow: '0 4px 30px hsl(38 65% 55% / 0.15)' }}
            />
          )}

          {/* Tour card */}
          <motion.div
            key={tourIndex}
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 glass-card rounded-2xl p-6 sm:p-8 max-w-md w-full mx-4 mb-4 sm:mb-0 space-y-4 border border-border/50"
          >
            {/* Close */}
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Tour progress */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-display uppercase tracking-[0.15em] text-primary">
                Quick tour
              </span>
              <span className="text-xs text-muted-foreground">
                {tourIndex + 1} / {totalTour}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {tourSteps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                    i <= tourIndex ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            {/* Icon */}
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
              {(() => {
                const Icon = tourSteps[tourIndex].icon;
                return <Icon className="h-5 w-5 text-primary" />;
              })()}
            </div>

            {/* Content */}
            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-foreground">
                {tourSteps[tourIndex].title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {tourSteps[tourIndex].body}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip tour
              </button>
              <Button onClick={nextTour} size="sm" className="gap-1.5">
                {tourIndex < totalTour - 1 ? (
                  <>Next <ChevronRight className="h-3.5 w-3.5" /></>
                ) : (
                  <>Get started <ArrowRight className="h-3.5 w-3.5" /></>
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
