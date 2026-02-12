import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import iffyLogo from '@/assets/iffy-logo-v3.png';
import heroBoardroom from '@/assets/hero-boardroom.jpg';
import {
  FolderOpen, DollarSign, Users, BarChart3, Sparkles,
  ArrowRight, Play, X, ChevronRight, TrendingUp,
  Layers, Footprints,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const INTRO_KEY = 'iffy-intro-seen';

/* ── Cinematic slides ── */
const brandSlides = [
  {
    phase: 'brand' as const,
    subtitle: 'Intelligent Film Flow & Yield',
    title: 'IFFY',
    body: 'From inception to legacy.',
  },
  {
    phase: 'value' as const,
    icon: Layers,
    title: 'Six stages. One living dossier.',
    body: 'Development → Packaging → Pre-Production → Production → Post-Production → Sales & Delivery. IFFY guides your project through every stage with per-stage readiness scoring.',
  },
  {
    phase: 'value' as const,
    icon: DollarSign,
    title: 'Finance built in from day one',
    body: 'Incentives, co-productions, and capital stacks evaluated in context. Build your deal structure deal by deal with a live waterfall visualisation.',
  },
  {
    phase: 'value' as const,
    icon: Users,
    title: 'Smart packaging & buyer matching',
    body: 'AI-powered talent recommendations and scored buyer matches based on your project\'s specific metadata.',
  },
  {
    phase: 'value' as const,
    icon: TrendingUp,
    title: 'Stage-aware market intelligence',
    body: 'Trend signals adapt to your project\'s current stage — narrative trends in Development, talent heat in Packaging, platform demand in Sales.',
  },
  {
    phase: 'value' as const,
    icon: Footprints,
    title: 'Every decision moves the needle',
    body: 'Six stage readiness scores roll up into a Master Viability Score. IFFY always shows the single best next step to close the gap.',
  },
];

/* ── Interactive tour steps ── */
const tourSteps = [
  {
    icon: Sparkles,
    title: 'Create your first project',
    body: 'Click "New Project" to build a living dossier. Add a title, genre, budget range, and territory to get started.',
    highlight: 'top-right' as const,
  },
  {
    icon: Layers,
    title: 'Navigate the lifecycle',
    body: 'Use the lifecycle sidebar to move through Development, Packaging, Pre-Production, Production, Post-Production, and Sales & Delivery. Each stage has its own readiness score.',
    highlight: 'center' as const,
  },
  {
    icon: DollarSign,
    title: 'Track your capital stack',
    body: 'Navigate to Finance to log deals across pre-sales, equity, incentives, gap, and more. The waterfall updates in real time.',
    highlight: 'center' as const,
  },
  {
    icon: BarChart3,
    title: 'Explore trends & buyers',
    body: 'Use the nav bar to access market trends, buyer matching, incentive finders, and production calendars — all stage-aware.',
    highlight: 'top-nav' as const,
  },
  {
    icon: Users,
    title: 'Collaborate with your team',
    body: "Invite collaborators with role-based access. Everyone works from the same living dossier.",
    highlight: 'center' as const,
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
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
        >
          {/* Background image with overlay */}
          <div className="absolute inset-0">
            <img src={heroBoardroom} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-[hsl(225,18%,4%)]/90" />
          </div>
          
          {/* Ambient glow */}
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/15 blur-[160px]"
          />
          
          {/* Film grain */}
          <div className="absolute inset-0 opacity-[0.02] pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
            }}
          />

          {/* Cinematic letterbox bars */}
          <div className="absolute top-0 left-0 right-0 h-[8%] bg-black/60" />
          <div className="absolute bottom-0 left-0 right-0 h-[8%] bg-black/60" />

          {/* Skip button */}
          <button
            onClick={dismiss}
            className="absolute top-[10%] right-6 z-10 text-white/30 hover:text-white/70 transition-colors text-xs font-display uppercase tracking-wider flex items-center gap-1"
          >
            Skip <X className="h-3.5 w-3.5" />
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
                  transition={{ duration: 0.7 }}
                  className="text-center space-y-10"
                >
                  <motion.div
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                    className="mx-auto"
                  >
                    <img src={iffyLogo} alt="IFFY logo" className="h-24 w-24 rounded-2xl mx-auto shadow-[0_0_80px_hsl(38_65%_55%/0.35)]" />
                  </motion.div>

                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8, duration: 0.5 }}
                    className="text-xs font-display uppercase tracking-[0.3em] text-primary/80"
                  >
                    {brandSlides[slideIndex].subtitle}
                  </motion.p>

                  <motion.h1
                    initial={{ opacity: 0, y: 30, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="text-7xl sm:text-8xl font-display font-bold text-white tracking-tight"
                  >
                    {brandSlides[slideIndex].title}
                  </motion.h1>

                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.5, duration: 0.6 }}
                    className="text-xl text-white/50 font-display"
                  >
                    {brandSlides[slideIndex].body}
                  </motion.p>

                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 1.8, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="h-px w-32 mx-auto bg-gradient-to-r from-transparent via-primary/50 to-transparent"
                  />

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 2.2, duration: 0.5 }}
                  >
                    <Button onClick={nextSlide} className="gap-2 px-6">
                      <Play className="h-4 w-4" /> Discover IFFY
                    </Button>
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div
                  key={`value-${slideIndex}`}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-1">
                    {brandSlides.map((_, i) => (
                      <div
                        key={i}
                        className={`h-0.5 rounded-full transition-all duration-500 ${
                          i <= slideIndex ? 'bg-primary w-8' : 'bg-white/15 w-4'
                        }`}
                      />
                    ))}
                  </div>

                  <motion.div
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                  >
                    {brandSlides[slideIndex].icon && (
                      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center backdrop-blur-sm">
                        {(() => {
                          const Icon = brandSlides[slideIndex].icon!;
                          return <Icon className="h-8 w-8 text-primary" />;
                        })()}
                      </div>
                    )}
                  </motion.div>

                  <p className="text-xs font-display uppercase tracking-[0.2em] text-primary/70">
                    {slideIndex} of {totalCinematic - 1}
                  </p>

                  <h2 className="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight leading-tight">
                    {brandSlides[slideIndex].title}
                  </h2>

                  <p className="text-white/50 text-lg leading-relaxed">
                    {brandSlides[slideIndex].body}
                  </p>

                  <div className="flex items-center justify-between pt-6">
                    <button onClick={dismiss} className="text-xs text-white/25 hover:text-white/50 transition-colors font-display uppercase tracking-wider">
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-background/80 backdrop-blur-md"
            onClick={dismiss}
          />

          {tourSteps[tourIndex].highlight === 'top-right' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-2 right-4 sm:right-8 w-40 h-14 rounded-xl border-2 border-primary/50 pointer-events-none"
              style={{ boxShadow: '0 0 40px hsl(38 65% 55% / 0.25)' }}
            />
          )}
          {tourSteps[tourIndex].highlight === 'top-nav' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute top-0 left-0 right-0 h-16 border-b-2 border-primary/40 pointer-events-none"
              style={{ boxShadow: '0 4px 40px hsl(38 65% 55% / 0.2)' }}
            />
          )}

          <motion.div
            key={tourIndex}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 glass-card rounded-2xl p-7 sm:p-9 max-w-md w-full mx-4 mb-4 sm:mb-0 space-y-5 border border-border/50"
          >
            <button
              onClick={dismiss}
              className="absolute top-5 right-5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

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
                  className={`h-1 flex-1 rounded-full transition-all duration-400 ${
                    i <= tourIndex ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              {(() => {
                const Icon = tourSteps[tourIndex].icon;
                return <Icon className="h-6 w-6 text-primary" />;
              })()}
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-foreground">
                {tourSteps[tourIndex].title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {tourSteps[tourIndex].body}
              </p>
            </div>

            <div className="flex items-center justify-between pt-3">
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
