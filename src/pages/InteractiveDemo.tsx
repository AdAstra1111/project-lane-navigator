import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, DollarSign, Users, TrendingUp,
  Brain, Target, Zap, Shield, Globe, ArrowRight, X, Pause, Play,
  FileText, Star, CheckCircle2, Upload, Sparkles, BarChart3,
  Eye, Layers, PieChart, AlertTriangle, ChevronRight, Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import iffyLogo from '@/assets/iffy-logo-v3.png';

/* ═══════════════════════════════════════════════════
   DEMO PROJECT DATA
   ═══════════════════════════════════════════════════ */
const BERLIN = {
  title: 'The Berlin Protocol',
  genre: 'Thriller', format: 'Feature Film', budget: '€8.2M', lane: 'Independent',
  heroUrl: 'https://mbwreoglhudppiwaxlsp.supabase.co/storage/v1/object/public/company-logos/demo-heroes/berlin-thriller.jpg',
  logline: 'A disgraced MI6 analyst discovers a Cold War cipher hidden in Berlin\'s architecture.',
  readiness: 72, financeReadiness: 68,
  scores: { Script: 85, Cast: 62, Finance: 68, Market: 78 },
  cast: ['Jannik Schümann', 'Vicky Krieps', 'Tom Hollander'],
  territories: ['Germany', 'UK', 'France', 'Scandinavia', 'Benelux'],
  incentives: [
    { name: 'German DFFF', pct: '20%', amount: '€1.64M' },
    { name: 'UK Tax Relief', pct: '25.5%', amount: '€1.15M' },
    { name: 'Eurimages', pct: '~8%', amount: '€650K' },
  ],
  buyers: [
    { name: 'StudioCanal', territory: 'France/Germany', fit: 94 },
    { name: 'IFC Films', territory: 'North America', fit: 87 },
    { name: 'Koch Films', territory: 'DACH', fit: 82 },
    { name: 'Curzon', territory: 'UK/Ireland', fit: 79 },
  ],
};

const GLASS = {
  title: 'Glass Towers',
  genre: 'Drama', format: 'Feature Film', budget: '€14.5M', lane: 'Prestige',
  heroUrl: 'https://mbwreoglhudppiwaxlsp.supabase.co/storage/v1/object/public/company-logos/demo-heroes/prestige-drama.jpg',
  logline: 'Three generations of women confront the legacy of a brutalist housing estate.',
  readiness: 58, financeReadiness: 45,
  scores: { Script: 92, Cast: 45, Finance: 45, Market: 71 },
  cast: ['Olivia Colman (suggested)', 'Saoirse Ronan (suggested)'],
  nextActions: [
    { icon: Users, action: 'Attach lead cast', impact: '+18 readiness', priority: 'Critical' },
    { icon: DollarSign, action: 'Structure capital stack', impact: '+12 finance', priority: 'High' },
    { icon: Globe, action: 'Apply Section 481', impact: '+8 finance', priority: 'Medium' },
  ],
};

const LASTSEEN = {
  title: 'Last Seen Online',
  genre: 'Thriller / Drama', format: '6×30 min Series', budget: '€2.1M', lane: 'Vertical Drama',
  heroUrl: 'https://mbwreoglhudppiwaxlsp.supabase.co/storage/v1/object/public/company-logos/demo-heroes/vertical-drama.jpg',
  logline: 'A teen vanishes from social media — told entirely through screens.',
  readiness: 41, financeReadiness: 22,
  scores: { Script: 78, Cast: 30, Finance: 22, Market: 85 },
};

/* ═══════════════════════════════════════════════════
   SCENE DEFINITIONS
   ═══════════════════════════════════════════════════ */
type Scene = { id: string; phase: string; duration: number };

const scenes: Scene[] = [
  { id: 'opening',       phase: 'opening',       duration: 4500 },
  { id: 'workflow',      phase: 'workflow',       duration: 6000 },
  { id: 'upload',        phase: 'upload',         duration: 7000 },
  { id: 'dossier-build', phase: 'dossier-build',  duration: 7500 },
  { id: 'score-calc',    phase: 'score-calc',     duration: 8000 },
  { id: 'next-move',     phase: 'next-move',      duration: 7500 },
  { id: 'finance',       phase: 'finance',        duration: 7500 },
  { id: 'buyers',        phase: 'buyers',         duration: 7500 },
  { id: 'market-intel',  phase: 'market-intel',   duration: 7000 },
  { id: 'present',       phase: 'present',        duration: 6000 },
  { id: 'cta',           phase: 'cta',            duration: 10000 },
];

/* ═══════════════════════════════════════════════════
   UTILITY COMPONENTS
   ═══════════════════════════════════════════════════ */

function Counter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / 1200, 1);
      setDisplay(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{display}{suffix}</>;
}

function ScoreRing({ score, label, delay = 0, size = 'md' }: { score: number; label: string; delay?: number; size?: 'sm' | 'md' }) {
  const r = size === 'sm' ? 30 : 40;
  const circ = 2 * Math.PI * r;
  const color = score >= 70 ? 'hsl(145,55%,45%)' : score >= 50 ? 'hsl(38,65%,50%)' : 'hsl(0,55%,50%)';
  const dim = size === 'sm' ? 'w-16 h-16' : 'w-24 h-24';
  const textSize = size === 'sm' ? 'text-lg' : 'text-2xl';
  return (
    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay, duration: 0.5 }} className="flex flex-col items-center gap-1.5">
      <div className={`relative ${dim}`}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="5" />
          <motion.circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            initial={{ strokeDasharray: circ, strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ * (1 - score / 100) }}
            transition={{ delay: delay + 0.3, duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${textSize} font-display font-bold text-white`}><Counter value={score} /></span>
        </div>
      </div>
      <span className="text-[10px] text-white/40 uppercase tracking-wider font-display">{label}</span>
    </motion.div>
  );
}

function MockUI({ children, title, delay = 0 }: { children: React.ReactNode; title: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="bg-[hsl(225,18%,8%)] border border-white/10 rounded-2xl overflow-hidden shadow-2xl shadow-black/40"
    >
      {/* Fake title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
        </div>
        <span className="text-[10px] text-white/25 font-display ml-2">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </motion.div>
  );
}

function TypewriterText({ text, delay = 0 }: { text: string; delay?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        setShown(s => { if (s >= text.length) { clearInterval(interval); return s; } return s + 1; });
      }, 25);
      return () => clearInterval(interval);
    }, delay * 1000);
    return () => clearTimeout(timeout);
  }, [text, delay]);
  return <>{text.slice(0, shown)}<span className="animate-pulse">|</span></>;
}

function StepIndicator({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`h-7 px-3 rounded-full flex items-center gap-1.5 text-[10px] font-display uppercase tracking-wider transition-all duration-500 ${
            i < active ? 'bg-primary/20 text-primary' : i === active ? 'bg-primary text-white' : 'bg-white/5 text-white/20'
          }`}>
            {i < active && <CheckCircle2 className="h-3 w-3" />}
            {step}
          </div>
          {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-white/15" />}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════ */

export default function InteractiveDemo() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const scene = scenes[current];
  const total = scenes.length;

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => {
      if (current < total - 1) setCurrent(c => c + 1);
      else setIsPlaying(false);
    }, scene.duration);
    return () => clearTimeout(timerRef.current);
  }, [current, isPlaying, scene.duration, total]);

  const goTo = useCallback((i: number) => { clearTimeout(timerRef.current); setCurrent(i); setIsPlaying(true); }, []);
  const next = () => { if (current < total - 1) goTo(current + 1); };
  const prev = () => { if (current > 0) goTo(current - 1); };

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
    <div className="fixed inset-0 z-[300] bg-[hsl(225,18%,4%)] overflow-hidden select-none">
      {/* Letterbox */}
      <div className="absolute top-0 left-0 right-0 h-[5%] bg-black z-30" />
      <div className="absolute bottom-0 left-0 right-0 h-[5%] bg-black z-30" />

      {/* Film grain */}
      <div className="absolute inset-0 z-20 opacity-[0.02] pointer-events-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")` }}
      />

      {/* Close */}
      <button onClick={() => navigate(-1)} className="absolute top-[6%] right-6 z-40 text-white/25 hover:text-white/70 transition-colors"><X className="h-5 w-5" /></button>

      {/* Progress bar */}
      <div className="absolute top-[5%] left-0 right-0 z-40 flex">
        {scenes.map((s, i) => (
          <button key={i} onClick={() => goTo(i)} className="flex-1 h-[3px] relative">
            <div className="absolute inset-0 bg-white/10" />
            <motion.div className="absolute inset-y-0 left-0 bg-primary" initial={false}
              animate={{ width: i < current ? '100%' : i === current ? '100%' : '0%' }}
              transition={{ duration: i === current ? scene.duration / 1000 : 0.3, ease: 'linear' }}
            />
          </button>
        ))}
      </div>

      {/* Scene content */}
      <AnimatePresence mode="wait">
        <motion.div key={scene.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {/* Ambient glow */}
          <motion.div animate={{ scale: [1, 1.3, 1], opacity: [0.05, 0.12, 0.05] }}
            transition={{ duration: 8, repeat: Infinity }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/20 blur-[160px]"
          />

          {/* ──── OPENING ──── */}
          {scene.phase === 'opening' && (
            <div className="relative z-10 text-center space-y-8 max-w-3xl px-8">
              <motion.img src={iffyLogo} alt="IFFY" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="h-20 w-20 rounded-2xl mx-auto shadow-[0_0_80px_hsl(38_65%_55%/0.3)]"
              />
              <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                className="text-5xl sm:text-7xl font-display font-bold text-white tracking-tight">
                Watch a producer use IFFY
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
                className="text-xl text-white/40 font-display">
                From script upload to investor-ready — in minutes, not months.
              </motion.p>
            </div>
          )}

          {/* ──── WORKFLOW OVERVIEW ──── */}
          {scene.phase === 'workflow' && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-10">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-3">
                <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">The IFFY Workflow</p>
                <h2 className="text-3xl sm:text-5xl font-display font-bold text-white">Upload → Analyse → Score → Act</h2>
              </motion.div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { icon: Upload, label: 'Upload', desc: 'Drop a script, budget, or deal memo' },
                  { icon: Brain, label: 'Analyse', desc: 'AI extracts structure, comps & signals' },
                  { icon: Target, label: 'Score', desc: 'Readiness calculates from real data' },
                  { icon: Zap, label: 'Act', desc: 'One clear action, always the right one' },
                ].map((step, i) => (
                  <motion.div key={step.label}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.2, duration: 0.5 }}
                    className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 text-center space-y-3"
                  >
                    <div className="h-12 w-12 mx-auto rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <step.icon className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-sm font-display font-bold text-white">{step.label}</p>
                    <p className="text-xs text-white/35">{step.desc}</p>
                  </motion.div>
                ))}
              </div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
                className="text-center text-sm text-white/25 font-display">
                Let's see it with <span className="text-primary">{BERLIN.title}</span>…
              </motion.p>
            </div>
          )}

          {/* ──── UPLOAD SIMULATION ──── */}
          {scene.phase === 'upload' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <Upload className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Step 1 — Upload</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Drop your script.<br />IFFY does the rest.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  Upload a screenplay, budget top-sheet, cast list, LOI, or deal memo. IFFY extracts structure, identifies characters, estimates budget bands, and begins building your living dossier.
                </motion.p>
              </div>
              <MockUI title="IFFY — The Berlin Protocol" delay={0.4}>
                <div className="space-y-4">
                  {/* Simulated upload zone */}
                  <motion.div
                    initial={{ borderColor: 'rgba(255,255,255,0.1)' }}
                    animate={{ borderColor: ['rgba(255,255,255,0.1)', 'hsl(38,65%,50%)', 'rgba(255,255,255,0.1)'] }}
                    transition={{ delay: 1, duration: 1.5 }}
                    className="border-2 border-dashed rounded-xl p-6 text-center space-y-2"
                  >
                    <FileText className="h-8 w-8 text-primary/40 mx-auto" />
                    <p className="text-xs text-white/30 font-display">berlin_protocol_v3.fdx</p>
                  </motion.div>
                  {/* Analysis progress */}
                  {[
                    { label: 'Extracting scenes…', delay: 1.5 },
                    { label: 'Identifying 23 characters…', delay: 2.5 },
                    { label: 'Estimating budget band: €6–10M', delay: 3.5 },
                    { label: 'Matching genre: Thriller', delay: 4.2 },
                  ].map((step, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: step.delay, duration: 0.4 }}
                      className="flex items-center gap-2 text-xs"
                    >
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: step.delay + 0.3 }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                      </motion.div>
                      <span className="text-white/50">{step.label}</span>
                    </motion.div>
                  ))}
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── DOSSIER BUILDING ──── */}
          {scene.phase === 'dossier-build' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <FolderOpen className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Step 2 — Living Dossier</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Your project assembles itself.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  Every attachment updates assessments in real time. Upload a new cast list → packaging score recalculates. Attach a deal memo → greenlight probability adjusts. Nothing manual. Nothing stale.
                </motion.p>
              </div>
              <MockUI title={`Dossier — ${BERLIN.title}`} delay={0.3}>
                <div className="space-y-4">
                  {/* Simulated dossier fields populating */}
                  {[
                    { label: 'Title', value: BERLIN.title, delay: 0.6 },
                    { label: 'Genre / Lane', value: `${BERLIN.genre} · ${BERLIN.lane}`, delay: 1 },
                    { label: 'Budget', value: BERLIN.budget, delay: 1.4 },
                    { label: 'Cast attached', value: BERLIN.cast.join(', '), delay: 1.8 },
                    { label: 'Territories', value: BERLIN.territories.join(', '), delay: 2.2 },
                  ].map((field) => (
                    <motion.div key={field.label}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: field.delay, duration: 0.4 }}
                      className="flex items-start gap-3 border-b border-white/5 pb-2"
                    >
                      <span className="text-[10px] text-white/25 uppercase tracking-wider w-20 shrink-0 pt-0.5 font-display">{field.label}</span>
                      <span className="text-xs text-white/70">{field.value}</span>
                    </motion.div>
                  ))}
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.8 }}
                    className="flex items-center gap-2 pt-2"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] text-primary/70 font-display">Readiness recalculating…</span>
                  </motion.div>
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── SCORE CALCULATION ──── */}
          {scene.phase === 'score-calc' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <Target className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Step 3 — Readiness Scores</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Every score is traceable.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  AI recommends. <span className="text-white/70">Arithmetic scores.</span> Readiness is calculated from measurable inputs — script coverage, cast attachment, finance structure, and market alignment. You can always ask "why this number?"
                </motion.p>
              </div>
              <MockUI title={`Readiness — ${BERLIN.title}`} delay={0.3}>
                <div className="space-y-5">
                  <div className="flex justify-center gap-5">
                    <ScoreRing score={BERLIN.readiness} label="Project" delay={0.6} />
                    <ScoreRing score={BERLIN.financeReadiness} label="Finance" delay={0.8} />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(BERLIN.scores).map(([key, val], i) => (
                      <ScoreRing key={key} score={val} label={key} delay={1 + i * 0.15} size="sm" />
                    ))}
                  </div>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }}
                    className="bg-white/[0.03] rounded-lg p-3 border border-white/5"
                  >
                    <p className="text-[10px] text-white/30 font-display flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-primary" /> IFFY Insight
                    </p>
                    <p className="text-xs text-white/60 mt-1">
                      Script and market alignment are strong. Cast attachment is the biggest lever — closing one A-list name would push readiness above 80.
                    </p>
                  </motion.div>
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── NEXT BEST MOVE ──── */}
          {scene.phase === 'next-move' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              {/* BG image for Glass Towers */}
              <motion.div initial={{ scale: 1.1 }} animate={{ scale: 1 }} transition={{ duration: 8 }} className="absolute -inset-40 -z-10">
                <img src={GLASS.heroUrl} alt="" className="w-full h-full object-cover opacity-10" />
                <div className="absolute inset-0 bg-[hsl(225,18%,4%)]/85" />
              </motion.div>
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Step 4 — Next Best Move</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Always know what<br />to do next.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  IFFY analyses your project's weakest dimension and tells you the single highest-impact action. For <span className="text-primary">{GLASS.title}</span>, the script is ready — but cast is the blocker.
                </motion.p>
              </div>
              <MockUI title={`Actions — ${GLASS.title}`} delay={0.3}>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-white/30 font-display mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    Readiness: <span className="text-white/60">{GLASS.readiness}/100</span> — Cast is the blocker
                  </div>
                  {GLASS.nextActions.map((action, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.8 + i * 0.3, duration: 0.4 }}
                      className={`flex items-center gap-3 p-3 rounded-xl border ${i === 0 ? 'border-primary/30 bg-primary/5' : 'border-white/5 bg-white/[0.02]'}`}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${i === 0 ? 'bg-primary/20' : 'bg-white/5'}`}>
                        <action.icon className={`h-4 w-4 ${i === 0 ? 'text-primary' : 'text-white/30'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/80 font-display">{action.action}</p>
                        <p className="text-[10px] text-white/30">{action.impact}</p>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-display ${
                        action.priority === 'Critical' ? 'bg-red-500/15 text-red-400' :
                        action.priority === 'High' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-white/5 text-white/30'
                      }`}>{action.priority}</span>
                    </motion.div>
                  ))}
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── FINANCE ENGINE ──── */}
          {scene.phase === 'finance' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Finance Engine</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Capital stacks that<br />build themselves.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  IFFY evaluates incentives, co-productions, pre-sales, equity, and gap — all in context. For <span className="text-primary">{BERLIN.title}</span>, the system identifies three incentive layers covering ~54% of the budget.
                </motion.p>
              </div>
              <MockUI title={`Finance Plan — ${BERLIN.title}`} delay={0.3}>
                <div className="space-y-4">
                  {/* Capital stack bars */}
                  <p className="text-[10px] text-white/25 font-display uppercase tracking-wider">Capital Stack</p>
                  {BERLIN.incentives.map((inc, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.6 + i * 0.3 }}
                      className="space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/60 font-display">{inc.name}</span>
                        <span className="text-primary font-display font-medium">{inc.amount}</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary/60 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: inc.pct }}
                          transition={{ delay: 0.8 + i * 0.3, duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                      <p className="text-[10px] text-white/20">{inc.pct} of budget</p>
                    </motion.div>
                  ))}
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2 }}
                    className="flex items-center gap-2 pt-2 border-t border-white/5"
                  >
                    <PieChart className="h-3.5 w-3.5 text-primary/50" />
                    <span className="text-[10px] text-white/30 font-display">Remaining gap: €4.76M — Pre-sales + equity recommended</span>
                  </motion.div>
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── BUYER MATCHING ──── */}
          {scene.phase === 'buyers' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Smart Packaging</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Buyers matched by<br />appetite, not guesswork.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  IFFY scores buyers by genre appetite, territory focus, budget tier, and deal history. Each match shows a fit percentage — so you pitch with confidence, not hope.
                </motion.p>
              </div>
              <MockUI title={`Buyer Matches — ${BERLIN.title}`} delay={0.3}>
                <div className="space-y-3">
                  {BERLIN.buyers.map((buyer, i) => (
                    <motion.div key={buyer.name}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + i * 0.2, duration: 0.4 }}
                      className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]"
                    >
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-display font-bold text-primary">{buyer.fit}%</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/80 font-display font-medium">{buyer.name}</p>
                        <p className="text-[10px] text-white/30">{buyer.territory}</p>
                      </div>
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 1 + i * 0.2 }}
                      >
                        <CheckCircle2 className="h-4 w-4 text-green-400/60" />
                      </motion.div>
                    </motion.div>
                  ))}
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── MARKET INTELLIGENCE ──── */}
          {scene.phase === 'market-intel' && (
            <div className="relative z-10 max-w-5xl w-full px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <motion.div initial={{ scale: 1.1 }} animate={{ scale: 1 }} transition={{ duration: 8 }} className="absolute -inset-40 -z-10">
                <img src={LASTSEEN.heroUrl} alt="" className="w-full h-full object-cover opacity-10" />
                <div className="absolute inset-0 bg-[hsl(225,18%,4%)]/85" />
              </motion.div>
              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <Brain className="h-5 w-5 text-primary" />
                  <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">Market Intelligence</span>
                </motion.div>
                <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                  Six engines scanning<br />24/7 for your project.
                </motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-white/40 leading-relaxed">
                  For <span className="text-primary">{LASTSEEN.title}</span> — a vertical drama — IFFY's engines detect surging platform demand and format velocity, despite the project being in early development.
                </motion.p>
              </div>
              <MockUI title={`Signals — ${LASTSEEN.title}`} delay={0.3}>
                <div className="space-y-3">
                  {[
                    { icon: TrendingUp, engine: 'Genre Cycle', signal: 'Screenlife thriller — rising', strength: 'Strong', color: 'text-green-400' },
                    { icon: Zap, engine: 'Format Velocity', signal: 'Vertical drama — surging', strength: 'Very Strong', color: 'text-green-400' },
                    { icon: Globe, engine: 'Territory Demand', signal: 'Global digital — high demand', strength: 'Strong', color: 'text-green-400' },
                    { icon: Users, engine: 'Cast Momentum', signal: 'Emerging talent pool — untapped', strength: 'Building', color: 'text-amber-400' },
                    { icon: Eye, engine: 'Buyer Appetite', signal: 'Netflix, Channel 4, ZDF matched', strength: 'Active', color: 'text-primary' },
                    { icon: BarChart3, engine: 'Comp Analysis', signal: '85% market alignment', strength: 'Strong', color: 'text-green-400' },
                  ].map((engine, i) => (
                    <motion.div key={engine.engine}
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-white/5 bg-white/[0.02]"
                    >
                      <engine.icon className="h-4 w-4 text-primary/60 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-white/60 font-display">{engine.engine}</p>
                        <p className="text-[10px] text-white/30 truncate">{engine.signal}</p>
                      </div>
                      <span className={`text-[9px] font-display font-medium ${engine.color}`}>{engine.strength}</span>
                    </motion.div>
                  ))}
                </div>
              </MockUI>
            </div>
          )}

          {/* ──── PRESENTATION MODE ──── */}
          {scene.phase === 'present' && (
            <div className="relative z-10 max-w-4xl w-full px-8 space-y-8 text-center">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-3">
                <Monitor className="h-5 w-5 text-primary" />
                <span className="text-xs font-display uppercase tracking-[0.3em] text-primary/70">One-Click Presentation</span>
              </motion.div>
              <motion.h2 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="text-3xl sm:text-5xl font-display font-bold text-white">
                Investor-ready in one click.
              </motion.h2>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                className="text-lg text-white/40 max-w-2xl mx-auto">
                Hit "Present" and IFFY generates a cinematic pitch deck from your living dossier — readiness scores, finance plan, cast package, buyer matches, and AI verdict. Export as PDF or present fullscreen.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
                <MockUI title="Presentation — The Berlin Protocol" delay={1}>
                  <div className="flex items-center gap-4">
                    {['Title', 'Readiness', 'Cast', 'Finance', 'AI Verdict', 'Buyers'].map((slide, i) => (
                      <motion.div key={slide}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 1.4 + i * 0.12 }}
                        className={`flex-1 h-16 rounded-lg flex items-center justify-center text-[9px] font-display uppercase tracking-wider ${
                          i === 0 ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-white/5 text-white/25 border border-white/5'
                        }`}
                      >
                        {slide}
                      </motion.div>
                    ))}
                  </div>
                </MockUI>
              </motion.div>
            </div>
          )}

          {/* ──── CTA ──── */}
          {scene.phase === 'cta' && (
            <div className="relative z-10 text-center space-y-10 max-w-3xl px-8">
              <motion.h2 initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.9 }}
                className="text-5xl sm:text-7xl font-display font-bold text-white leading-tight">
                From inception to legacy.<br />Nothing missing.
              </motion.h2>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
                className="text-2xl text-white/45 font-display">Stop guessing. Start knowing.</motion.p>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }} className="flex items-center justify-center gap-4">
                <Button size="lg" onClick={() => navigate('/dashboard')} className="gap-2 px-8 text-base">
                  Enter IFFY <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => navigate('/how-it-works')}
                  className="gap-2 px-8 text-base border-white/15 text-white/60 hover:text-white hover:bg-white/5">
                  How it works
                </Button>
              </motion.div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Bottom nav */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
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
