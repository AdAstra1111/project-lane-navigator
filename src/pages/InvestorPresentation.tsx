import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  X, ChevronLeft, ChevronRight, Eye, EyeOff,
  AlertTriangle, Layers, Lightbulb, GitBranch,
  TrendingUp, ShieldAlert, Activity, Rocket, Target, Compass,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import iffyLogo from '@/assets/iffy-logo-v3.png';
import paradoxLogo from '@/assets/paradox-house-logo-inverted.png';
import heroBoardroom from '@/assets/hero-boardroom.jpg';
import heroDesk from '@/assets/hero-desk.jpg';

/* ── Slide data ── */
interface Slide {
  id: string;
  icon: typeof AlertTriangle;
  label: string;
  title: string;
  bullets: string[];
  highlight?: string;
  speakerNote: string;
}

const slides: Slide[] = [
  {
    id: 'problem',
    icon: AlertTriangle,
    label: 'THE STRUCTURAL PROBLEM',
    title: 'Independent production\nis structurally broken.',
    bullets: [
      'Development decisions made in isolation',
      'Packaging driven by relationships, not structured intelligence',
      'Budgeting separated from financing strategy',
      'Recoupment rarely modelled at greenlight',
    ],
    highlight: 'There is no unified lifecycle intelligence layer.',
    speakerNote: 'This is not about creativity. It is about structural inefficiency. Independent production lacks integrated decision architecture.',
  },
  {
    id: 'fragmentation',
    icon: Layers,
    label: 'MARKET FRAGMENTATION',
    title: 'Four systems.\nZero integration.',
    bullets: [
      'Budgeting & payroll software',
      'Production coordination tools',
      'Predictive analytics platforms',
      'Audience demand data services',
    ],
    highlight: 'No system integrates development, packaging, financing, and monetisation in one structured environment.',
    speakerNote: 'Emphasise fragmentation. Integration is inevitable — but no one has built it properly.',
  },
  {
    id: 'solution',
    icon: Lightbulb,
    label: 'THE INTERNAL SOLUTION',
    title: 'IFFY.',
    bullets: [
      'Development viability',
      'Packaging configuration',
      'Financing pathways',
      'Capital stack modelling',
      'Recoupment forecasting',
    ],
    highlight: 'Before capital is committed.',
    speakerNote: 'The value is architecture, not automation.',
  },
  {
    id: 'lifecycle',
    icon: GitBranch,
    label: 'HOW IT WORKS',
    title: 'Full lifecycle\ndecision discipline.',
    bullets: [
      'Budget bands & genre alignment',
      'Director & cast tier tracking',
      'Tax credit jurisdiction mapping',
      'Presale territory logic',
      'Equity / debt ratio modelling',
      'Waterfall recoupment structure',
    ],
    highlight: 'Concept → Script → Packaging → Financing → Production → Post → Monetisation',
    speakerNote: 'Walk through the lifecycle slowly. Let each stage land.',
  },
  {
    id: 'advantage',
    icon: TrendingUp,
    label: 'STRATEGIC ADVANTAGE',
    title: 'Every project generates\nproprietary intelligence.',
    bullets: [
      'Time-to-finance benchmarking',
      'Packaging effectiveness scoring',
      'Budget accuracy tracking',
      'Recoupment accuracy measurement',
      'Territory sale performance data',
    ],
    highlight: 'Over time, this becomes proprietary production intelligence.',
    speakerNote: 'Pause here. This is the real long-term value.',
  },
  {
    id: 'why',
    icon: ShieldAlert,
    label: 'WHY THIS MATTERS',
    title: 'Error reduction =\ncapital protection.',
    bullets: [
      'Budget too high for package strength',
      'Weak tax structuring',
      'Poor capital stack layering',
      'Overestimated revenue projections',
    ],
    highlight: 'IFFY reduces structural error.',
    speakerNote: 'Most independent projects fail due to structural misalignment, not creative weakness.',
  },
  {
    id: 'status',
    icon: Activity,
    label: 'CURRENT STATUS',
    title: 'Building intelligence\ndensity first.',
    bullets: [
      'Active internal deployment at Paradox House',
      'Applied across development slate',
      'Structured outcome tracking initiated',
      'Finance simulator in controlled build phase',
    ],
    highlight: 'No external marketing. No premature scale.',
    speakerNote: 'Controlled, deliberate infrastructure build. Not a launch narrative.',
  },
  {
    id: 'optionality',
    icon: Rocket,
    label: 'EXPANSION OPTIONALITY',
    title: 'Multiple strategic\nexit pathways.',
    bullets: [
      'Proprietary studio advantage',
      'Licensed intelligence platform',
      'Financial modelling infrastructure',
      'Acquisition candidate for industry software groups',
    ],
    highlight: 'Optionality remains open.',
    speakerNote: 'Do not commit to a single path. The value is in the optionality itself.',
  },
  {
    id: 'capital',
    icon: Target,
    label: 'CAPITAL PURPOSE',
    title: 'Not growth.\nIntelligence depth.',
    bullets: [
      'Finance structure simulator',
      'Recoupment modelling engine',
      'Structured outcome database',
      'Controlled infrastructure development',
    ],
    highlight: 'Not marketing. Not scale. Intelligence depth.',
    speakerNote: 'This is not a growth-at-all-costs raise. Capital builds defensible infrastructure.',
  },
  {
    id: 'vision',
    icon: Compass,
    label: 'VISION',
    title: 'The operating system\nfor independent producers.',
    bullets: [],
    highlight: 'Or the intelligence engine powering our own studio ecosystem.',
    speakerNote: 'IFFY is not a writing tool. It is the foundation for disciplined independent production.',
  },
];

/* ── Component ── */
export default function InvestorPresentation() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const total = slides.length;
  const slide = slides[current];

  const goTo = useCallback((i: number) => {
    setCurrent(Math.max(0, Math.min(total - 1, i)));
  }, [total]);

  const next = () => goTo(current + 1);
  const prev = () => goTo(current - 1);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'Escape') navigate(-1);
      if (e.key === 'n' || e.key === 'N') setShowNotes(v => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current]);

  const bgImage = current === 0 ? heroBoardroom : current === total - 1 ? heroDesk : null;

  return (
    <div className="fixed inset-0 z-[300] bg-[hsl(225,18%,4%)] overflow-hidden select-none">
      {/* Letterbox bars */}
      <div className="absolute top-0 left-0 right-0 h-[5%] bg-black z-30" />
      <div className="absolute bottom-0 left-0 right-0 h-[5%] bg-black z-30" />

      {/* Film grain */}
      <div className="absolute inset-0 z-20 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Top bar — logos + controls */}
      <div className="absolute top-[5%] left-0 right-0 z-40 flex items-center justify-between px-6 sm:px-10 py-3">
        <div className="flex items-center gap-3">
          <img src={paradoxLogo} alt="Paradox House" className="h-5 opacity-40" />
          <span className="text-[10px] text-white/20 font-display uppercase tracking-[0.2em]">×</span>
          <img src={iffyLogo} alt="IFFY" className="h-5 rounded opacity-40" />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNotes(v => !v)}
            className="text-white/20 hover:text-white/50 transition-colors"
            title="Toggle speaker notes (N)"
          >
            {showNotes ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            onClick={() => navigate(-1)}
            className="text-white/20 hover:text-white/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute top-[5%] left-0 right-0 z-50 h-[2px] pointer-events-none">
        <motion.div
          className="h-full bg-primary/60"
          animate={{ width: `${((current + 1) / total) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* Ambient glow */}
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.06, 0.14, 0.06] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/15 blur-[200px] pointer-events-none"
      />

      {/* Background image for first/last */}
      <AnimatePresence>
        {bgImage && (
          <motion.div
            key={bgImage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 z-0"
          >
            <img src={bgImage} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-[hsl(225,18%,4%)]/90" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Slide content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={slide.id}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 z-10 flex items-center justify-center px-6 sm:px-16"
        >
          <div className="max-w-4xl w-full space-y-8">
            {/* Label */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <slide.icon className="h-5 w-5 text-primary" />
              </div>
              <span className="text-[11px] font-display uppercase tracking-[0.3em] text-primary/60">
                {slide.label}
              </span>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="text-4xl sm:text-6xl lg:text-7xl font-display font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line"
            >
              {slide.title}
            </motion.h1>

            {/* Bullets */}
            {slide.bullets.length > 0 && (
              <motion.ul
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.5 }}
                className="space-y-2.5 max-w-2xl"
              >
                {slide.bullets.map((b, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.08, duration: 0.35 }}
                    className="flex items-start gap-3 text-white/40 text-base sm:text-lg leading-relaxed"
                  >
                    <span className="mt-2.5 h-1 w-1 rounded-full bg-primary/50 shrink-0" />
                    {b}
                  </motion.li>
                ))}
              </motion.ul>
            )}

            {/* Highlight */}
            {slide.highlight && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + slide.bullets.length * 0.08, duration: 0.5 }}
                className="border-l-2 border-primary/40 pl-5 py-1"
              >
                <p className="text-lg sm:text-xl text-white/70 font-display font-medium leading-relaxed">
                  {slide.highlight}
                </p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* ── Speaker notes panel ── */}
      <AnimatePresence>
        {showNotes && (
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="absolute bottom-[5%] left-0 right-0 z-50 px-6 sm:px-16 pb-14"
          >
            <div className="max-w-3xl mx-auto bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-6 py-4">
              <p className="text-xs text-white/25 font-display uppercase tracking-widest mb-2">Speaker Note</p>
              <p className="text-sm text-white/50 leading-relaxed">{slide.speakerNote}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom nav ── */}
      <div className="absolute bottom-[5.5%] left-1/2 -translate-x-1/2 z-40 flex items-center gap-5">
        <button
          onClick={prev}
          disabled={current === 0}
          className="text-white/20 hover:text-white/50 disabled:opacity-10 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current
                  ? 'w-6 bg-primary/70'
                  : i < current
                  ? 'w-1.5 bg-white/25'
                  : 'w-1.5 bg-white/10'
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={current === total - 1}
          className="text-white/20 hover:text-white/50 disabled:opacity-10 transition-colors"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Keyboard hint */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-[6%] right-6 sm:right-10 z-40 text-[10px] text-white/15 font-display uppercase tracking-wider hidden sm:block"
      >
        ← → navigate · N notes · Esc exit
      </motion.p>

      {/* Slide label + confidential */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-[6%] left-6 sm:left-10 z-40 text-[10px] text-white/15 font-display uppercase tracking-wider"
      >
        {current + 1} / {total} · Confidential
      </motion.div>

      {/* Click zones */}
      <div className="absolute inset-y-0 left-0 w-1/5 z-20 cursor-w-resize" onClick={prev} />
      <div className="absolute inset-y-0 right-0 w-1/5 z-20 cursor-e-resize" onClick={next} />
    </div>
  );
}
