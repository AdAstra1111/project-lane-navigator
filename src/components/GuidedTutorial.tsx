import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import iffyLogo from '@/assets/iffy-logo-v3.png';
import {
  FolderOpen, DollarSign, Users, BarChart3, Sparkles, Globe,
  ArrowRight, ArrowLeft, X, ChevronRight, Play, Pause,
  Target, TrendingUp, Shield, Zap, FileText, Layers,
  Radio, Landmark, Calendar, Building2, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const TUTORIAL_KEY = 'iffy-tutorial-seen';

/* ─── Chapter definitions ─── */

interface Chapter {
  id: string;
  label: string;
  icon: typeof FolderOpen;
  slides: Slide[];
}

interface Slide {
  layout: 'hero' | 'split' | 'showcase' | 'grid' | 'finale';
  title: string;
  subtitle?: string;
  body: string;
  features?: { icon: typeof FolderOpen; label: string; desc: string }[];
  mockup?: 'dashboard' | 'project' | 'finance' | 'trends' | 'buyers' | 'packaging';
}

const chapters: Chapter[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    icon: Sparkles,
    slides: [
      {
        layout: 'hero',
        title: 'IFFY',
        subtitle: 'Intelligent Film Flow & Yield',
        body: 'Your complete command centre for independent film — from inception to legacy. Every decision tracked, every signal surfaced, every path to finance illuminated.',
      },
    ],
  },
  {
    id: 'dossier',
    label: 'Living Dossiers',
    icon: FolderOpen,
    slides: [
      {
        layout: 'split',
        title: 'Living dossiers, not documents',
        body: 'Each project is a living entity. Attach scripts, cast, partners, budgets, and contracts — every change automatically recalculates your readiness score and finance picture.',
        mockup: 'project',
      },
      {
        layout: 'grid',
        title: 'Everything connected',
        body: 'Your project dossier links every dimension together.',
        features: [
          { icon: FileText, label: 'Scripts & Coverage', desc: 'AI-powered script analysis with scene breakdowns and character extraction' },
          { icon: Users, label: 'Cast & Crew', desc: 'Track attachments, talent triage board, and smart packaging suggestions' },
          { icon: Layers, label: 'Contracts & Rights', desc: 'Ownership waterfall, participant tracking, and territory management' },
          { icon: MessageSquare, label: 'AI Project Chat', desc: 'Ask your project questions — it knows everything attached to it' },
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance Engine',
    icon: DollarSign,
    slides: [
      {
        layout: 'split',
        title: 'Finance built in from day one',
        body: 'Incentives, co-productions, and capital stacks evaluated in context. Track deals across pre-sales, equity, gap, and soft money — all visualised in a live waterfall.',
        mockup: 'finance',
      },
      {
        layout: 'grid',
        title: 'Complete financial picture',
        body: 'Every financial dimension at your fingertips.',
        features: [
          { icon: DollarSign, label: 'Capital Stack', desc: 'Build and compare finance scenarios with gap analysis' },
          { icon: Landmark, label: 'Incentive Finder', desc: 'Auto-match to tax credits, rebates, and soft money globally' },
          { icon: Shield, label: 'Finance Readiness', desc: '0–100 score grading how closeable your finance plan is' },
          { icon: Target, label: 'Budget Tracking', desc: 'Line-item budgets with cost tracking and variance alerts' },
        ],
      },
    ],
  },
  {
    id: 'intelligence',
    label: 'Market Intelligence',
    icon: TrendingUp,
    slides: [
      {
        layout: 'split',
        title: 'Market intelligence finds you',
        body: 'Trend signals matched to your genre, tone, and format. Cast momentum tracking, comp analysis, and buyer appetite — always current, always relevant.',
        mockup: 'trends',
      },
      {
        layout: 'grid',
        title: 'Intelligence tools',
        body: 'Stay ahead of the market.',
        features: [
          { icon: Radio, label: 'Story & Cast Trends', desc: 'Genre momentum, cast cycle tracking, and timing windows' },
          { icon: Globe, label: 'Territory Heat Map', desc: 'Visual map of sold, pipeline, and open territories' },
          { icon: BarChart3, label: 'Comp Analysis', desc: 'AI-powered comparable title revenue benchmarking' },
          { icon: Zap, label: 'Market Alerts', desc: 'Proactive notifications when windows align with your projects' },
        ],
      },
    ],
  },
  {
    id: 'packaging',
    label: 'Packaging & Buyers',
    icon: Users,
    slides: [
      {
        layout: 'split',
        title: 'Smart packaging & buyer matching',
        body: 'AI-powered talent recommendations scored by commercial fit. Buyer matching based on genre appetite, territory presence, and deal history.',
        mockup: 'buyers',
      },
      {
        layout: 'grid',
        title: 'Close deals faster',
        body: 'From packaging to signed contracts.',
        features: [
          { icon: Users, label: 'Talent Triage', desc: 'Kanban board for managing cast and crew suggestions' },
          { icon: Building2, label: 'Buyer CRM', desc: 'Track contacts, meetings, and relationship history' },
          { icon: Calendar, label: 'Festival Calendar', desc: 'Market dates, submission deadlines, and scheduling' },
          { icon: FileText, label: 'PDF Export', desc: 'One-click polished dossier export for partners and buyers' },
        ],
      },
    ],
  },
  {
    id: 'workflow',
    label: 'Your Workflow',
    icon: Zap,
    slides: [
      {
        layout: 'grid',
        title: 'Power-user tools',
        body: 'Work faster with built-in productivity features.',
        features: [
          { icon: Sparkles, label: '⌘K Command Palette', desc: 'Instant search and navigation to any project or section' },
          { icon: BarChart3, label: 'Pipeline View', desc: 'Kanban board showing all projects by stage' },
          { icon: Users, label: 'Team Collaboration', desc: 'Role-based access for producers, agents, and lawyers' },
          { icon: TrendingUp, label: 'Cross-Project Intel', desc: 'Aggregate insights across your entire slate' },
        ],
      },
      {
        layout: 'finale',
        title: 'You\'re ready.',
        subtitle: 'From inception to legacy.',
        body: 'Start by creating your first project, or explore the dashboard to see what IFFY can do. You can replay this tutorial anytime from the Help menu.',
      },
    ],
  },
];

/* ─── Animated mockup component ─── */

function AnimatedMockup({ type }: { type: string }) {
  const lines = useMemo(() => {
    const configs: Record<string, { label: string; w: string; color: string }[]> = {
      dashboard: [
        { label: 'Readiness', w: '72%', color: 'bg-primary' },
        { label: 'Finance', w: '58%', color: 'bg-accent' },
        { label: 'Pipeline', w: '85%', color: 'bg-primary/70' },
        { label: 'Packaging', w: '45%', color: 'bg-accent/70' },
      ],
      project: [
        { label: 'Script', w: '90%', color: 'bg-primary' },
        { label: 'Cast', w: '65%', color: 'bg-accent' },
        { label: 'Budget', w: '40%', color: 'bg-primary/70' },
        { label: 'Partners', w: '55%', color: 'bg-accent/70' },
      ],
      finance: [
        { label: 'Pre-sales', w: '60%', color: 'bg-primary' },
        { label: 'Equity', w: '25%', color: 'bg-accent' },
        { label: 'Incentives', w: '35%', color: 'bg-primary/70' },
        { label: 'Gap', w: '15%', color: 'bg-destructive/50' },
      ],
      trends: [
        { label: 'Thriller ↑', w: '88%', color: 'bg-primary' },
        { label: 'Drama', w: '70%', color: 'bg-accent' },
        { label: 'Horror ↑↑', w: '95%', color: 'bg-primary/80' },
        { label: 'Comedy', w: '50%', color: 'bg-accent/60' },
      ],
      buyers: [
        { label: 'A24', w: '92%', color: 'bg-primary' },
        { label: 'NEON', w: '78%', color: 'bg-accent' },
        { label: 'Focus', w: '65%', color: 'bg-primary/70' },
        { label: 'Mubi', w: '55%', color: 'bg-accent/70' },
      ],
      packaging: [
        { label: 'Lead — Match', w: '85%', color: 'bg-primary' },
        { label: 'Director', w: '70%', color: 'bg-accent' },
        { label: 'Support', w: '60%', color: 'bg-primary/70' },
        { label: 'DP', w: '50%', color: 'bg-accent/70' },
      ],
    };
    return configs[type] || configs.dashboard;
  }, [type]);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-5 space-y-4 backdrop-blur-sm">
      {/* Fake title bar */}
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
        <div className="h-2.5 w-2.5 rounded-full bg-primary/40" />
        <div className="h-2.5 w-2.5 rounded-full bg-accent/40" />
        <div className="h-2 w-20 rounded bg-muted ml-3" />
      </div>

      {/* Animated bars */}
      <div className="space-y-3">
        {lines.map((line, i) => (
          <div key={line.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-display uppercase tracking-wider text-muted-foreground">
                {line.label}
              </span>
              <span className="text-[10px] text-muted-foreground">{line.w}</span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${line.color}`}
                initial={{ width: 0 }}
                animate={{ width: line.w }}
                transition={{ delay: 0.3 + i * 0.15, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Shimmer row */}
      <motion.div
        className="h-8 rounded-lg bg-gradient-to-r from-muted/30 via-muted/60 to-muted/30"
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        style={{ backgroundSize: '200% 100%' }}
      />
    </div>
  );
}

/* ─── Slide renderers ─── */

function HeroSlide({ slide }: { slide: Slide }) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full space-y-8 px-6">
      {/* Logo */}
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <img src={iffyLogo} alt="IFFY logo" className="h-24 w-24 rounded-2xl mx-auto shadow-[0_0_80px_hsl(38_65%_55%/0.3)]" />
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="text-xs font-display uppercase tracking-[0.3em] text-primary"
      >
        {slide.subtitle}
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-6xl sm:text-8xl font-display font-bold text-foreground tracking-tight"
      >
        {slide.title}
      </motion.h1>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="h-px w-32 bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed"
      >
        {slide.body}
      </motion.p>
    </div>
  );
}

function SplitSlide({ slide }: { slide: Slide }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center h-full px-6">
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-6"
      >
        <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground tracking-tight leading-tight">
          {slide.title}
        </h2>
        <p className="text-muted-foreground text-lg leading-relaxed">{slide.body}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        {slide.mockup && <AnimatedMockup type={slide.mockup} />}
      </motion.div>
    </div>
  );
}

function GridSlide({ slide }: { slide: Slide }) {
  return (
    <div className="flex flex-col h-full px-6 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-3"
      >
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">
          {slide.title}
        </h2>
        <p className="text-muted-foreground max-w-lg mx-auto">{slide.body}</p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 content-center">
        {slide.features?.map((f, i) => (
          <motion.div
            key={f.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-xl border border-border/50 bg-card/60 p-5 space-y-2 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <f.icon className="h-4 w-4 text-primary" />
              </div>
              <span className="font-display font-semibold text-sm text-foreground">{f.label}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pl-12">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function FinaleSlide({ slide }: { slide: Slide }) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full space-y-8 px-6">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="h-16 w-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center"
      >
        <Sparkles className="h-8 w-8 text-primary" />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="text-4xl sm:text-5xl font-display font-bold text-foreground tracking-tight"
      >
        {slide.title}
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="text-sm font-display uppercase tracking-[0.25em] text-primary"
      >
        {slide.subtitle}
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="text-muted-foreground text-lg max-w-md leading-relaxed"
      >
        {slide.body}
      </motion.p>
    </div>
  );
}

function SlideRenderer({ slide }: { slide: Slide }) {
  switch (slide.layout) {
    case 'hero': return <HeroSlide slide={slide} />;
    case 'split': return <SplitSlide slide={slide} />;
    case 'grid': return <GridSlide slide={slide} />;
    case 'finale': return <FinaleSlide slide={slide} />;
    default: return <HeroSlide slide={slide} />;
  }
}

/* ─── Main tutorial component ─── */

export function GuidedTutorial({ onClose, autoShow = false }: { onClose?: () => void; autoShow?: boolean }) {
  const [visible, setVisible] = useState(!autoShow);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);

  useEffect(() => {
    if (autoShow) {
      const seen = localStorage.getItem(TUTORIAL_KEY);
      if (!seen) {
        const t = setTimeout(() => setVisible(true), 800);
        return () => clearTimeout(t);
      }
    }
  }, [autoShow]);

  // Auto-play timer
  useEffect(() => {
    if (!autoPlay || !visible) return;
    const t = setInterval(() => goNext(), 6000);
    return () => clearInterval(t);
  }, [autoPlay, visible, chapterIdx, slideIdx]);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(TUTORIAL_KEY, 'true');
    onClose?.();
  }, [onClose]);

  // Flatten for progress
  const allSlides = useMemo(() =>
    chapters.flatMap((ch, ci) => ch.slides.map((s, si) => ({ ch: ci, sl: si, slide: s, chapter: ch }))),
    []
  );
  const currentFlat = useMemo(() =>
    allSlides.findIndex(s => s.ch === chapterIdx && s.sl === slideIdx),
    [allSlides, chapterIdx, slideIdx]
  );
  const totalSlides = allSlides.length;

  const goNext = useCallback(() => {
    const chapter = chapters[chapterIdx];
    if (slideIdx < chapter.slides.length - 1) {
      setSlideIdx(s => s + 1);
    } else if (chapterIdx < chapters.length - 1) {
      setChapterIdx(c => c + 1);
      setSlideIdx(0);
    } else {
      dismiss();
    }
  }, [chapterIdx, slideIdx, dismiss]);

  const goPrev = useCallback(() => {
    if (slideIdx > 0) {
      setSlideIdx(s => s - 1);
    } else if (chapterIdx > 0) {
      const prevChapter = chapters[chapterIdx - 1];
      setChapterIdx(c => c - 1);
      setSlideIdx(prevChapter.slides.length - 1);
    }
  }, [chapterIdx, slideIdx]);

  const goToChapter = useCallback((idx: number) => {
    setChapterIdx(idx);
    setSlideIdx(0);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, goNext, goPrev, dismiss]);

  if (!visible) return null;

  const currentSlide = chapters[chapterIdx].slides[slideIdx];
  const isFirst = chapterIdx === 0 && slideIdx === 0;
  const isLast = chapterIdx === chapters.length - 1 && slideIdx === chapters[chapterIdx].slides.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        key="tutorial-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[300] flex flex-col overflow-hidden"
      >
        {/* Background */}
        <div className="absolute inset-0 bg-background" />

        {/* Ambient glow */}
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/15 blur-[150px] pointer-events-none"
        />

        {/* Film grain overlay */}
        <div
          className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          }}
        />

        {/* ── Top bar ── */}
        <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/30">
          {/* Chapter nav */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {chapters.map((ch, i) => {
              const ChIcon = ch.icon;
              const isActive = i === chapterIdx;
              const isPast = i < chapterIdx;
              return (
                <button
                  key={ch.id}
                  onClick={() => goToChapter(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-display transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : isPast
                      ? 'text-primary/60 hover:text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ChIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">{ch.label}</span>
                </button>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={() => setAutoPlay(!autoPlay)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={autoPlay ? 'Pause auto-play' : 'Auto-play'}
            >
              {autoPlay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div className="relative z-10 h-0.5 bg-muted/30">
          <motion.div
            className="h-full bg-primary"
            initial={false}
            animate={{ width: `${((currentFlat + 1) / totalSlides) * 100}%` }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        {/* ── Slide content ── */}
        <div className="relative z-10 flex-1 flex items-center justify-center overflow-hidden">
          <div className="w-full max-w-5xl mx-auto py-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${chapterIdx}-${slideIdx}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="min-h-[400px] flex items-center"
              >
                <div className="w-full">
                  <SlideRenderer slide={currentSlide} />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="relative z-10 flex items-center justify-between px-6 py-4 border-t border-border/30">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-display">
              {currentFlat + 1} / {totalSlides}
            </span>
            <span className="text-xs text-muted-foreground">
              Use ← → arrows or click to navigate
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={goPrev}
              disabled={isFirst}
              className="gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>

            <Button
              onClick={isLast ? dismiss : goNext}
              size="sm"
              className="gap-1.5"
            >
              {isLast ? (
                <>Get started <ArrowRight className="h-3.5 w-3.5" /></>
              ) : (
                <>Next <ChevronRight className="h-3.5 w-3.5" /></>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
