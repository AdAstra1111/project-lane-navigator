import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, DollarSign, Users, BarChart3, TrendingUp, Sparkles,
  Brain, Target, Zap, Shield, Globe, ArrowRight, ChevronDown, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import heroBoardroom from '@/assets/hero-boardroom.jpg';
import heroCamera from '@/assets/hero-camera.jpg';
import heroDesk from '@/assets/hero-desk.jpg';
import iffyLogo from '@/assets/iffy-logo-v3.png';

/* ── Scene data ── */
const scenes = [
  {
    id: 'opening',
    phase: 'intro',
    bg: heroBoardroom,
    preTitle: 'THE FUTURE OF PRODUCTION INTELLIGENCE',
    title: "You've been doing it\nthe hard way.",
    body: 'Spreadsheets. Guesswork. Gut feel. A hundred tabs open, none of them talking to each other.',
    stat: null,
  },
  {
    id: 'problem',
    phase: 'problem',
    bg: heroCamera,
    preTitle: 'THE PROBLEM',
    title: 'Production is flying blind.',
    body: 'Producers spend 60% of development time on admin — not storytelling. Deal structures live in email. Market intelligence arrives too late. And after closing finance, the chaos only deepens.',
    stat: { value: '60%', label: 'of dev time lost to admin' },
  },
  {
    id: 'enter',
    phase: 'reveal',
    bg: null,
    preTitle: null,
    title: 'IFFY',
    body: 'Intelligent Film Flow & Yield',
    stat: null,
  },
  {
    id: 'living',
    phase: 'feature',
    bg: null,
    icon: FolderOpen,
    preTitle: 'LIVING DOSSIERS',
    title: 'Not documents.\nLiving intelligence.',
    body: 'Every attachment — script, cast list, LOI — updates your project assessment in real time. No manual recalculation, ever.',
    stat: { value: '0', label: 'manual updates needed' },
  },
  {
    id: 'finance',
    phase: 'feature',
    bg: heroDesk,
    icon: DollarSign,
    preTitle: 'FINANCE ENGINE',
    title: 'Capital stacks\nthat build themselves.',
    body: 'Incentives, co-productions, pre-sales, equity, gap — all evaluated in context. Recoupment waterfalls, IRR modeling, and cashflow forecasting built in from day one.',
    stat: { value: '7', label: 'finance layers tracked' },
  },
  {
    id: 'intelligence',
    phase: 'feature',
    bg: null,
    icon: Brain,
    preTitle: 'MARKET INTELLIGENCE',
    title: 'The market comes\nto you.',
    body: 'Trend signals, cast momentum, genre cycles, buyer appetite — matched to your specific project. Six engines. 24/7 monitoring. Always current.',
    stat: { value: '24/7', label: 'signal monitoring' },
  },
  {
    id: 'packaging',
    phase: 'feature',
    bg: null,
    icon: Users,
    preTitle: 'SMART PACKAGING',
    title: 'AI-powered talent\n& buyer matching.',
    body: 'Cast recommendations scored by territory value. Buyer matches ranked by appetite, format, and deal history. Every suggestion backed by data.',
    stat: { value: '100+', label: 'buyer profiles scored' },
  },
  {
    id: 'production',
    phase: 'feature',
    bg: heroCamera,
    icon: Zap,
    preTitle: 'PRODUCTION INTELLIGENCE',
    title: 'From greenlight\nthrough delivery.',
    body: 'Schedule impact analysis, territory cost modelling, deliverables tracking, and dynamic cashflow — all tied to your living dossier. IFFY goes the distance.',
    stat: { value: '11', label: 'production modes supported' },
  },
  {
    id: 'readiness',
    phase: 'feature',
    bg: null,
    icon: Target,
    preTitle: 'READINESS SCORES',
    title: 'Always know your\nnext best move.',
    body: 'Two scoring engines — Project Readiness and Finance Readiness — updated in real time. One action, always the right one.',
    stat: { value: '2', label: 'scoring engines, always live' },
  },
  {
    id: 'ecosystem',
    phase: 'stats',
    bg: null,
    preTitle: 'THE ECOSYSTEM',
    title: 'Everything connected.\nNothing siloed.',
    body: null,
    stats: [
      { icon: Globe, value: '50+', label: 'Incentive jurisdictions' },
      { icon: TrendingUp, value: '6', label: 'Trend engines' },
      { icon: Shield, value: '11', label: 'Production modes' },
      { icon: Zap, value: '<1s', label: 'Score updates' },
    ],
  },
  {
    id: 'cta',
    phase: 'cta',
    bg: heroBoardroom,
    preTitle: null,
    title: "Inception to recoup.\nNothing missing.",
    body: 'Stop guessing. Start knowing.',
    stat: null,
  },
];

/* ── Counter animation ── */
function AnimatedCounter({ value, duration = 1.5 }: { value: string; duration?: number }) {
  const [display, setDisplay] = useState('0');
  const num = parseInt(value);
  const isNumeric = !isNaN(num) && value === String(num);

  useEffect(() => {
    if (!isNumeric) {
      setDisplay(value);
      return;
    }
    let start = 0;
    const end = num;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - startTime) / (duration * 1000);
      if (elapsed >= 1) { setDisplay(String(end)); return; }
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setDisplay(String(Math.round(start + (end - start) * eased)));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, isNumeric, num, duration]);

  return <span>{display}</span>;
}

/* ── Main component ── */
export default function CinematicDemo() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const scene = scenes[current];
  const total = scenes.length;

  // Auto-advance
  useEffect(() => {
    if (!isPlaying) return;
    const delay = scene.phase === 'reveal' ? 3000 : scene.phase === 'cta' ? 8000 : 5500;
    timerRef.current = setTimeout(() => {
      if (current < total - 1) setCurrent(c => c + 1);
      else setIsPlaying(false);
    }, delay);
    return () => clearTimeout(timerRef.current);
  }, [current, isPlaying, scene.phase, total]);

  const goTo = useCallback((i: number) => {
    clearTimeout(timerRef.current);
    setCurrent(i);
    setIsPlaying(true);
  }, []);

  const next = () => { if (current < total - 1) goTo(current + 1); };
  const prev = () => { if (current > 0) goTo(current - 1); };

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-[300] bg-[hsl(225,18%,4%)] overflow-hidden select-none">
      {/* Letterbox bars */}
      <div className="absolute top-0 left-0 right-0 h-[6%] bg-black z-30" />
      <div className="absolute bottom-0 left-0 right-0 h-[6%] bg-black z-30" />

      {/* Film grain overlay */}
      <div className="absolute inset-0 z-20 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Close button */}
      <button
        onClick={() => navigate(-1)}
        className="absolute top-[7%] right-6 z-40 text-white/25 hover:text-white/70 transition-colors"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Progress bar */}
      <div className="absolute top-[6%] left-0 right-0 z-40 flex">
        {scenes.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className="flex-1 h-[3px] group relative"
          >
            <div className="absolute inset-0 bg-white/10" />
            <motion.div
              className="absolute inset-y-0 left-0 bg-primary"
              initial={false}
              animate={{
                width: i < current ? '100%' : i === current ? '100%' : '0%',
              }}
              transition={{
                duration: i === current ? (scene.phase === 'reveal' ? 3 : scene.phase === 'cta' ? 8 : 5.5) : 0.3,
                ease: 'linear',
              }}
            />
          </button>
        ))}
      </div>

      {/* Scene content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={scene.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {/* Background image */}
          {scene.bg && (
            <motion.div
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 8, ease: 'easeOut' }}
              className="absolute inset-0"
            >
              <img src={scene.bg} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-[hsl(225,18%,4%)]/85" />
            </motion.div>
          )}

          {/* Ambient glow */}
          <motion.div
            animate={{ scale: [1, 1.4, 1], opacity: [0.08, 0.18, 0.08] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/20 blur-[180px]"
          />

          {/* Content area */}
          <div className="relative z-10 max-w-4xl w-full mx-auto px-8">

            {/* ── REVEAL SCENE (logo) ── */}
            {scene.phase === 'reveal' && (
              <motion.div className="text-center space-y-8">
                <motion.img
                  src={iffyLogo}
                  alt="IFFY"
                  initial={{ scale: 0.2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  className="h-28 w-28 rounded-2xl mx-auto shadow-[0_0_100px_hsl(38_65%_55%/0.4)]"
                />
                <motion.h1
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6, duration: 0.8 }}
                  className="text-8xl sm:text-9xl font-display font-bold text-white tracking-tight"
                >
                  {scene.title}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.2, duration: 0.6 }}
                  className="text-xl text-primary/80 font-display tracking-[0.2em] uppercase"
                >
                  {scene.body}
                </motion.p>
              </motion.div>
            )}

            {/* ── INTRO / PROBLEM SCENES ── */}
            {(scene.phase === 'intro' || scene.phase === 'problem') && (
              <div className="space-y-8">
                <motion.p
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  className="text-xs font-display uppercase tracking-[0.3em] text-primary/70"
                >
                  {scene.preTitle}
                </motion.p>
                <motion.h1
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="text-5xl sm:text-7xl font-display font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line"
                >
                  {scene.title}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8, duration: 0.6 }}
                  className="text-xl text-white/45 leading-relaxed max-w-2xl"
                >
                  {scene.body}
                </motion.p>
                {scene.stat && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1.2, duration: 0.5 }}
                    className="inline-flex items-baseline gap-3 bg-white/5 border border-white/10 rounded-xl px-6 py-4"
                  >
                    <span className="text-5xl font-display font-bold text-primary">
                      <AnimatedCounter value={scene.stat.value} />
                    </span>
                    <span className="text-white/40 text-sm uppercase tracking-wider font-display">{scene.stat.label}</span>
                  </motion.div>
                )}
              </div>
            )}

            {/* ── FEATURE SCENES ── */}
            {scene.phase === 'feature' && (
              <div className="space-y-8">
                {scene.icon && (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                    className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center backdrop-blur-sm"
                  >
                    <scene.icon className="h-8 w-8 text-primary" />
                  </motion.div>
                )}
                <motion.p
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  className="text-xs font-display uppercase tracking-[0.3em] text-primary/70"
                >
                  {scene.preTitle}
                </motion.p>
                <motion.h2
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="text-4xl sm:text-6xl font-display font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line"
                >
                  {scene.title}
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7, duration: 0.6 }}
                  className="text-lg text-white/45 leading-relaxed max-w-2xl"
                >
                  {scene.body}
                </motion.p>
                {scene.stat && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1, duration: 0.5 }}
                    className="inline-flex items-baseline gap-3 bg-white/5 border border-white/10 rounded-xl px-6 py-4"
                  >
                    <span className="text-5xl font-display font-bold text-primary">
                      <AnimatedCounter value={scene.stat.value} />
                    </span>
                    <span className="text-white/40 text-sm uppercase tracking-wider font-display">{scene.stat.label}</span>
                  </motion.div>
                )}
              </div>
            )}

            {/* ── STATS SCENE ── */}
            {scene.phase === 'stats' && (
              <div className="space-y-10 text-center">
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-xs font-display uppercase tracking-[0.3em] text-primary/70"
                >
                  {scene.preTitle}
                </motion.p>
                <motion.h2
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.7 }}
                  className="text-4xl sm:text-6xl font-display font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line"
                >
                  {scene.title}
                </motion.h2>
                {'stats' in scene && scene.stats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-4">
                    {scene.stats.map((s, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 + i * 0.15, duration: 0.5 }}
                        className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3"
                      >
                        <s.icon className="h-6 w-6 text-primary mx-auto" />
                        <p className="text-3xl font-display font-bold text-white">
                          <AnimatedCounter value={s.value} />
                        </p>
                        <p className="text-xs text-white/40 uppercase tracking-wider font-display">{s.label}</p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── CTA SCENE ── */}
            {scene.phase === 'cta' && (
              <motion.div className="text-center space-y-10">
                <motion.h2
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  className="text-5xl sm:text-7xl font-display font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line"
                >
                  {scene.title}
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1, duration: 0.6 }}
                  className="text-2xl text-white/50 font-display"
                >
                  {scene.body}
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.5, duration: 0.5 }}
                  className="flex items-center justify-center gap-4"
                >
                  <Button
                    size="lg"
                    onClick={() => navigate('/dashboard')}
                    className="gap-2 px-8 text-base"
                  >
                    Enter IFFY <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate('/how-it-works')}
                    className="gap-2 px-8 text-base border-white/15 text-white/60 hover:text-white hover:bg-white/5"
                  >
                    How it works
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Bottom nav hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-[7%] left-1/2 -translate-x-1/2 z-40 flex items-center gap-6 text-white/20 text-xs font-display uppercase tracking-wider"
      >
        <span className="hidden sm:inline">← → to navigate</span>
        <span>{current + 1} / {total}</span>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="hover:text-white/50 transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </motion.div>

      {/* Click zones for nav */}
      <div className="absolute inset-y-0 left-0 w-1/4 z-30 cursor-w-resize" onClick={prev} />
      <div className="absolute inset-y-0 right-0 w-1/4 z-30 cursor-e-resize" onClick={next} />
    </div>
  );
}
