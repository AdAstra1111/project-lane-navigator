import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, DollarSign, Users, BarChart3, TrendingUp, Sparkles,
  Brain, Target, Zap, Shield, Globe, ArrowRight, X, Play, Pause,
  FileText, PieChart, Award, Eye, ChevronRight, Layers, Star,
  CheckCircle2, AlertTriangle, Clock, MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import iffyLogo from '@/assets/iffy-logo-v3.png';

/* ── Demo project data (mirrors seeded DB rows) ── */
const DEMO_PROJECTS = [
  {
    id: 'berlin',
    title: 'The Berlin Protocol',
    genre: 'Thriller',
    budget: '€8.2M',
    format: 'Feature Film',
    status: 'Financing',
    heroUrl: 'https://mbwreoglhudppiwaxlsp.supabase.co/storage/v1/object/public/company-logos/demo-heroes/berlin-thriller.jpg',
    readiness: 72,
    financeReadiness: 68,
    lane: 'Independent',
    logline: 'A disgraced MI6 analyst discovers a Cold War cipher hidden in Berlin\'s architecture — but decoding it means becoming the target.',
    scores: { script: 85, cast: 62, finance: 68, market: 78 },
    cast: ['Jannik Schümann', 'Vicky Krieps', 'Tom Hollander'],
    territories: ['Germany', 'UK', 'France', 'Scandinavia'],
    incentives: ['German DFFF (20%)', 'UK Tax Relief (25.5%)', 'Eurimages'],
    buyers: ['StudioCanal', 'IFC Films', 'Koch Films', 'Curzon'],
  },
  {
    id: 'glass',
    title: 'Glass Towers',
    genre: 'Drama',
    budget: '€14.5M',
    format: 'Feature Film',
    status: 'Packaging',
    heroUrl: 'https://mbwreoglhudppiwaxlsp.supabase.co/storage/v1/object/public/company-logos/demo-heroes/prestige-drama.jpg',
    readiness: 58,
    financeReadiness: 45,
    lane: 'Prestige',
    logline: 'Three generations of women confront the legacy of a brutalist housing estate slated for demolition.',
    scores: { script: 92, cast: 45, finance: 45, market: 71 },
    cast: ['Suggested: Olivia Colman', 'Suggested: Saoirse Ronan'],
    territories: ['UK', 'Ireland', 'USA', 'Australia'],
    incentives: ['Section 481 (32%)', 'UK Tax Relief (25.5%)'],
    buyers: ['A24', 'MUBI', 'Pathé', 'Picturehouse'],
  },
  {
    id: 'lastseen',
    title: 'Last Seen Online',
    genre: 'Thriller / Drama',
    budget: '€2.1M',
    format: '6×30 min Series',
    status: 'Development',
    heroUrl: 'https://mbwreoglhudppiwaxlsp.supabase.co/storage/v1/object/public/company-logos/demo-heroes/vertical-drama.jpg',
    readiness: 41,
    financeReadiness: 22,
    lane: 'Vertical Drama',
    logline: 'A teen vanishes from social media — told entirely through the screens of those searching for her.',
    scores: { script: 78, cast: 30, finance: 22, market: 85 },
    cast: ['TBD — Emerging talent'],
    territories: ['Global Digital'],
    incentives: ['Netherlands Production Incentive (30%)'],
    buyers: ['Netflix', 'Channel 4', 'ZDF', 'ARTE'],
  },
];

/* ── Scene definitions ── */
type Scene = {
  id: string;
  phase: string;
  duration: number;
  project?: typeof DEMO_PROJECTS[0];
};

const buildScenes = (): Scene[] => [
  { id: 'opening', phase: 'opening', duration: 4000 },
  { id: 'slate', phase: 'slate', duration: 6000 },
  { id: 'dossier-berlin', phase: 'dossier', duration: 7000, project: DEMO_PROJECTS[0] },
  { id: 'readiness-berlin', phase: 'readiness', duration: 7000, project: DEMO_PROJECTS[0] },
  { id: 'finance-berlin', phase: 'finance', duration: 7000, project: DEMO_PROJECTS[0] },
  { id: 'dossier-glass', phase: 'dossier', duration: 6000, project: DEMO_PROJECTS[1] },
  { id: 'packaging-glass', phase: 'packaging', duration: 7000, project: DEMO_PROJECTS[1] },
  { id: 'dossier-lastseen', phase: 'dossier', duration: 6000, project: DEMO_PROJECTS[2] },
  { id: 'market-lastseen', phase: 'market', duration: 7000, project: DEMO_PROJECTS[2] },
  { id: 'ecosystem', phase: 'ecosystem', duration: 6000 },
  { id: 'cta', phase: 'cta', duration: 10000 },
];

/* ── Animated counter ── */
function Counter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / 1200, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{display}{suffix}</>;
}

/* ── Score ring ── */
function ScoreRing({ score, label, delay = 0 }: { score: number; label: string; delay?: number }) {
  const circ = 2 * Math.PI * 40;
  const color = score >= 70 ? 'hsl(145, 55%, 45%)' : score >= 50 ? 'hsl(38, 65%, 50%)' : 'hsl(0, 55%, 50%)';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5 }}
      className="flex flex-col items-center gap-2"
    >
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="40" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="6" />
          <motion.circle
            cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round"
            initial={{ strokeDasharray: circ, strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ * (1 - score / 100) }}
            transition={{ delay: delay + 0.3, duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-display font-bold text-white"><Counter value={score} /></span>
        </div>
      </div>
      <span className="text-xs text-white/40 uppercase tracking-wider font-display">{label}</span>
    </motion.div>
  );
}

/* ── Stat pill ── */
function StatPill({ icon: Icon, value, label, delay = 0 }: { icon: any; value: string; label: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="bg-white/5 border border-white/10 rounded-xl px-5 py-4 flex items-center gap-4"
    >
      <Icon className="h-5 w-5 text-primary shrink-0" />
      <div>
        <p className="text-xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
      </div>
    </motion.div>
  );
}

/* ── Tag chip ── */
function Tag({ children, delay = 0 }: { children: string; delay?: number }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.3 }}
      className="px-3 py-1 rounded-full text-xs font-display bg-primary/15 text-primary border border-primary/20"
    >
      {children}
    </motion.span>
  );
}

/* ════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                  */
/* ════════════════════════════════════════════════ */

export default function InteractiveDemo() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const scenes = buildScenes();
  const scene = scenes[current];
  const total = scenes.length;

  // Auto-advance
  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => {
      if (current < total - 1) setCurrent(c => c + 1);
      else setIsPlaying(false);
    }, scene.duration);
    return () => clearTimeout(timerRef.current);
  }, [current, isPlaying, scene.duration, total]);

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

  const p = scene.project;

  return (
    <div className="fixed inset-0 z-[300] bg-[hsl(225,18%,4%)] overflow-hidden select-none">
      {/* Letterbox */}
      <div className="absolute top-0 left-0 right-0 h-[5%] bg-black z-30" />
      <div className="absolute bottom-0 left-0 right-0 h-[5%] bg-black z-30" />

      {/* Film grain */}
      <div className="absolute inset-0 z-20 opacity-[0.025] pointer-events-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")` }}
      />

      {/* Close */}
      <button onClick={() => navigate(-1)} className="absolute top-[6%] right-6 z-40 text-white/25 hover:text-white/70 transition-colors">
        <X className="h-5 w-5" />
      </button>

      {/* Progress bar */}
      <div className="absolute top-[5%] left-0 right-0 z-40 flex">
        {scenes.map((s, i) => (
          <button key={i} onClick={() => goTo(i)} className="flex-1 h-[3px] group relative">
            <div className="absolute inset-0 bg-white/10" />
            <motion.div
              className="absolute inset-y-0 left-0 bg-primary"
              initial={false}
              animate={{ width: i < current ? '100%' : i === current ? '100%' : '0%' }}
              transition={{ duration: i === current ? scene.duration / 1000 : 0.3, ease: 'linear' }}
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
          transition={{ duration: 0.6 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {/* Ambient glow */}
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [0.06, 0.15, 0.06] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/20 blur-[180px]"
          />

          {/* ──────── OPENING ──────── */}
          {scene.phase === 'opening' && (
            <div className="relative z-10 text-center space-y-8 max-w-3xl px-8">
              <motion.img
                src={iffyLogo} alt="IFFY"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="h-20 w-20 rounded-2xl mx-auto shadow-[0_0_80px_hsl(38_65%_55%/0.3)]"
              />
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="text-5xl sm:text-7xl font-display font-bold text-white tracking-tight"
              >
                See IFFY in action
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 0.6 }}
                className="text-xl text-white/40 font-display"
              >
                Three real projects. Every intelligence layer. One system.
              </motion.p>
            </div>
          )}

          {/* ──────── SLATE (3 projects) ──────── */}
          {scene.phase === 'slate' && (
            <div className="relative z-10 max-w-6xl w-full px-8 space-y-8">
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs font-display uppercase tracking-[0.3em] text-primary/70 text-center"
              >
                The Demo Slate
              </motion.p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {DEMO_PROJECTS.map((proj, i) => (
                  <motion.div
                    key={proj.id}
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.2, duration: 0.6 }}
                    className="relative rounded-2xl overflow-hidden border border-white/10 group cursor-pointer"
                    onClick={() => goTo(2 + i * 2)}
                  >
                    <img src={proj.heroUrl} alt={proj.title} className="w-full h-48 object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[hsl(225,18%,4%)] via-[hsl(225,18%,4%)]/60 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-5 space-y-2">
                      <p className="text-xs text-primary/80 uppercase tracking-wider font-display">{proj.genre} · {proj.format}</p>
                      <h3 className="text-xl font-display font-bold text-white">{proj.title}</h3>
                      <p className="text-xs text-white/35 line-clamp-2">{proj.logline}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <span className="text-xs text-white/30 font-display">{proj.budget}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">{proj.status}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ──────── DOSSIER (project intro) ──────── */}
          {scene.phase === 'dossier' && p && (
            <div className="relative z-10 max-w-5xl w-full px-8">
              {/* BG image */}
              <motion.div
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                transition={{ duration: 8 }}
                className="absolute -inset-40 -z-10"
              >
                <img src={p.heroUrl} alt="" className="w-full h-full object-cover opacity-15" />
                <div className="absolute inset-0 bg-[hsl(225,18%,4%)]/80" />
              </motion.div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                {/* Left — info */}
                <div className="space-y-6">
                  <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-3">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Living Dossier</span>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.7 }}
                    className="text-4xl sm:text-5xl font-display font-bold text-white leading-tight"
                  >
                    {p.title}
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="text-lg text-white/40 leading-relaxed"
                  >
                    {p.logline}
                  </motion.p>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="flex flex-wrap gap-2">
                    <Tag delay={0.9}>{p.genre}</Tag>
                    <Tag delay={1}>{p.format}</Tag>
                    <Tag delay={1.1}>{p.lane}</Tag>
                    <Tag delay={1.2}>{p.budget}</Tag>
                  </motion.div>
                </div>

                {/* Right — score preview */}
                <motion.div
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5, duration: 0.7 }}
                  className="bg-white/[0.03] border border-white/10 rounded-2xl p-8 space-y-6"
                >
                  <div className="flex items-center gap-2 text-white/50 text-sm font-display">
                    <Target className="h-4 w-4 text-primary" />
                    Project Readiness
                  </div>
                  <div className="flex justify-center gap-8">
                    <ScoreRing score={p.readiness} label="Overall" delay={0.7} />
                    <ScoreRing score={p.financeReadiness} label="Finance" delay={0.9} />
                  </div>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.4 }}
                    className="text-xs text-white/30 text-center"
                  >
                    Updated in real time as documents, cast & deals change
                  </motion.p>
                </motion.div>
              </div>
            </div>
          )}

          {/* ──────── READINESS deep-dive ──────── */}
          {scene.phase === 'readiness' && p && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-8">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
                <BarChart3 className="h-5 w-5 text-primary" />
                <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Readiness Breakdown — {p.title}</span>
              </motion.div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                {Object.entries(p.scores).map(([key, val], i) => (
                  <ScoreRing key={key} score={val} label={key} delay={0.3 + i * 0.15} />
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 }}
                className="bg-white/[0.03] border border-white/10 rounded-xl p-6 space-y-4"
              >
                <p className="text-sm font-display text-white/60 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> IFFY Recommendation
                </p>
                <p className="text-white/80 text-sm leading-relaxed">
                  {p.readiness >= 70
                    ? `${p.title} is approaching market-readiness. Focus on closing the finance gap — the script and market alignment are strong.`
                    : p.readiness >= 50
                    ? `${p.title} shows strong creative foundations but needs cast attachment and finance structuring before market. Prioritise packaging.`
                    : `${p.title} is in early development. Strong market signal — invest in script development and initial packaging before approaching finance.`
                  }
                </p>
              </motion.div>
            </div>
          )}

          {/* ──────── FINANCE ──────── */}
          {scene.phase === 'finance' && p && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-8">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-primary" />
                <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Finance Engine — {p.title}</span>
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl sm:text-4xl font-display font-bold text-white"
              >
                Capital stack, built intelligently
              </motion.h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {p.incentives.map((inc, i) => (
                  <StatPill key={i} icon={Shield} value={inc.split('(')[0].trim()} label={inc.match(/\((.+)\)/)?.[1] || 'Eligible'} delay={0.4 + i * 0.15} />
                ))}
                <StatPill icon={Globe} value={p.territories.length + ' territories'} label="Pre-sale targets" delay={0.7} />
                <StatPill icon={PieChart} value={p.budget} label="Total budget" delay={0.85} />
              </div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 }}
                className="flex flex-wrap gap-2"
              >
                {p.territories.map((t, i) => <Tag key={t} delay={1.3 + i * 0.08}>{t}</Tag>)}
              </motion.div>
            </div>
          )}

          {/* ──────── PACKAGING ──────── */}
          {scene.phase === 'packaging' && p && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-8">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
                <Users className="h-5 w-5 text-primary" />
                <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Smart Packaging — {p.title}</span>
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl sm:text-4xl font-display font-bold text-white"
              >
                AI-matched cast & buyers
              </motion.h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <motion.div
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-white/[0.03] border border-white/10 rounded-xl p-6 space-y-4"
                >
                  <p className="text-sm font-display text-white/50 flex items-center gap-2">
                    <Star className="h-4 w-4 text-primary" /> Cast Suggestions
                  </p>
                  {p.cast.map((c, i) => (
                    <motion.div
                      key={c}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + i * 0.15 }}
                      className="flex items-center gap-3"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-white/70 text-sm">{c}</span>
                    </motion.div>
                  ))}
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-white/[0.03] border border-white/10 rounded-xl p-6 space-y-4"
                >
                  <p className="text-sm font-display text-white/50 flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" /> Top Buyer Matches
                  </p>
                  {p.buyers.map((b, i) => (
                    <motion.div
                      key={b}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.7 + i * 0.12 }}
                      className="flex items-center gap-3"
                    >
                      <CheckCircle2 className="h-4 w-4 text-primary/60" />
                      <span className="text-white/70 text-sm">{b}</span>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </div>
          )}

          {/* ──────── MARKET INTELLIGENCE ──────── */}
          {scene.phase === 'market' && p && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-8">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-primary" />
                <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Market Intelligence — {p.title}</span>
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl sm:text-4xl font-display font-bold text-white"
              >
                Six engines. Always watching.
              </motion.h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { icon: TrendingUp, name: 'Genre Cycle', signal: 'Rising', color: 'text-green-400' },
                  { icon: Users, name: 'Cast Momentum', signal: p.scores.cast >= 50 ? 'Strong' : 'Building', color: p.scores.cast >= 50 ? 'text-green-400' : 'text-yellow-400' },
                  { icon: Globe, name: 'Territory Demand', signal: 'Active', color: 'text-green-400' },
                  { icon: Zap, name: 'Format Velocity', signal: p.format.includes('Series') ? 'Surging' : 'Stable', color: p.format.includes('Series') ? 'text-green-400' : 'text-white/50' },
                  { icon: Eye, name: 'Buyer Appetite', signal: 'Matched', color: 'text-primary' },
                  { icon: Layers, name: 'Comp Analysis', signal: `${p.scores.market}% aligned`, color: 'text-primary' },
                ].map((engine, i) => (
                  <motion.div
                    key={engine.name}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.12 }}
                    className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-2"
                  >
                    <engine.icon className="h-5 w-5 text-primary" />
                    <p className="text-sm font-display text-white/70">{engine.name}</p>
                    <p className={`text-xs font-display font-medium ${engine.color}`}>{engine.signal}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ──────── ECOSYSTEM ──────── */}
          {scene.phase === 'ecosystem' && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-10 text-center">
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">
                The Full Picture
              </motion.p>
              <motion.h2
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-4xl sm:text-6xl font-display font-bold text-white leading-tight"
              >
                Three projects.<br />One intelligent system.
              </motion.h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { icon: Globe, value: '50+', label: 'Incentive jurisdictions' },
                  { icon: TrendingUp, value: '6', label: 'Trend engines' },
                  { icon: Shield, value: '11', label: 'Production modes' },
                  { icon: Zap, value: '<1s', label: 'Score updates' },
                ].map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.15 }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3"
                  >
                    <s.icon className="h-6 w-6 text-primary mx-auto" />
                    <p className="text-3xl font-display font-bold text-white">{s.value}</p>
                    <p className="text-xs text-white/40 uppercase tracking-wider font-display">{s.label}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ──────── CTA ──────── */}
          {scene.phase === 'cta' && (
            <div className="relative z-10 text-center space-y-10 max-w-3xl px-8">
              <motion.h2
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.9 }}
                className="text-5xl sm:text-7xl font-display font-bold text-white leading-tight"
              >
                From concept to legacy.<br />Nothing missing.
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                className="text-2xl text-white/45 font-display"
              >
                Stop guessing. Start knowing.
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5 }}
                className="flex items-center justify-center gap-4"
              >
                <Button size="lg" onClick={() => navigate('/dashboard')} className="gap-2 px-8 text-base">
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
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Bottom nav */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-[6%] left-1/2 -translate-x-1/2 z-40 flex items-center gap-6 text-white/20 text-xs font-display uppercase tracking-wider"
      >
        <span className="hidden sm:inline">← → navigate</span>
        <span>{current + 1} / {total}</span>
        <button onClick={() => setIsPlaying(!isPlaying)} className="hover:text-white/50 transition-colors">
          {isPlaying ? <Pause className="h-3 w-3 inline" /> : <Play className="h-3 w-3 inline" />}
        </button>
      </motion.div>

      {/* Click zones */}
      <div className="absolute inset-y-0 left-0 w-1/4 z-30 cursor-w-resize" onClick={prev} />
      <div className="absolute inset-y-0 right-0 w-1/4 z-30 cursor-e-resize" onClick={next} />
    </div>
  );
}
