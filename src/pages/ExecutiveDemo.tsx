/**
 * Executive Mode – Major Studio Packaging Demo
 * A pre-authored walkthrough of SHADOW PROTOCOL from idea to recoupment.
 * All data is hardcoded — no live AI or database calls.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  X, ArrowRight, Lightbulb, Package, DollarSign, Clapperboard,
  Film, Globe, Gauge,
  AlertTriangle, CheckCircle2, Star, Zap, Target,
  FileText, Eye, Award, PieChart, ChevronRight, Users,
  Volume2, VolumeX, Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import iffyLogo from '@/assets/iffy-logo-v3.png';
import heroImage from '@/assets/demo-hero-shadow-protocol.jpg';

/* ═══════════════════════════════════════════════════════════
   ANIMATED COUNTER – slower dramatic pacing
   ═══════════════════════════════════════════════════════════ */
function AnimatedCounter({ value, duration = 2.0, prefix = '', suffix = '' }: {
  value: number; duration?: number; prefix?: string; suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - start) / (duration * 1000);
      if (elapsed >= 1) { setDisplay(value); return; }
      // Slow ease-out for dramatic reveal
      const eased = 1 - Math.pow(1 - elapsed, 4);
      setDisplay(Math.round(value * eased));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED SCORE BAR
   ═══════════════════════════════════════════════════════════ */
function ScoreBar({ label, value, delay = 0, color = 'bg-primary' }: {
  label: string; value: number; delay?: number; color?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="space-y-1"
    >
      <div className="flex justify-between text-xs">
        <span className="text-white/50">{label}</span>
        <span className="font-mono text-white/70">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ delay: delay + 0.2, duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DATA CARD
   ═══════════════════════════════════════════════════════════ */
function DataCard({ children, delay = 0, className = '' }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className={`bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 backdrop-blur-sm ${className}`}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NARRATIVE HEADER – emotional framing above dashboards
   ═══════════════════════════════════════════════════════════ */
function NarrativeHeader({ icon: Icon, stage, headline, narration }: {
  icon: React.ElementType; stage: string; headline: string; narration: string;
}) {
  return (
    <div className="mb-8">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-2 mb-3"
      >
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <span className="text-[10px] font-display uppercase tracking-[0.3em] text-primary/60">{stage}</span>
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="text-2xl sm:text-4xl font-display font-bold text-white leading-tight"
      >
        {headline}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        className="text-sm sm:text-base text-white/40 mt-3 max-w-2xl leading-relaxed italic"
      >
        "{narration}"
      </motion.p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MICRO-AFFIRMATION – subtle confirmation text
   ═══════════════════════════════════════════════════════════ */
function Affirmation({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="flex items-center gap-2 mt-2"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: delay + 0.2, type: 'spring', stiffness: 300, damping: 20 }}
      >
        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
      </motion.div>
      <span className="text-xs text-emerald-400/80 font-display tracking-wide">{text}</span>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   STAGE DEFINITIONS
   ═══════════════════════════════════════════════════════════ */
const STAGES = [
  { id: 'title', label: 'Shadow Protocol', shortLabel: 'Title', icon: Film },
  { id: 'development', label: 'Development', shortLabel: 'Dev', icon: Lightbulb },
  { id: 'packaging', label: 'Packaging', shortLabel: 'Pkg', icon: Package },
  { id: 'financing', label: 'Financing', shortLabel: 'Fin', icon: DollarSign },
  { id: 'production', label: 'Production', shortLabel: 'Prod', icon: Clapperboard },
  { id: 'post', label: 'Post & Positioning', shortLabel: 'Post', icon: Film },
  { id: 'release', label: 'Global Release', shortLabel: 'Release', icon: Globe },
  { id: 'recoupment', label: 'Recoupment', shortLabel: 'Recoup', icon: PieChart },
  { id: 'final', label: 'Conclusion', shortLabel: 'Final', icon: Star },
] as const;

type StageId = (typeof STAGES)[number]['id'];

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ExecutiveDemo() {
  const navigate = useNavigate();
  const [currentStage, setCurrentStage] = useState<StageId>('title');
  const currentIndex = STAGES.findIndex(s => s.id === currentStage);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const goTo = useCallback((id: StageId) => setCurrentStage(id), []);
  const next = () => {
    const i = STAGES.findIndex(s => s.id === currentStage);
    if (i < STAGES.length - 1) setCurrentStage(STAGES[i + 1].id);
  };
  const prev = () => {
    const i = STAGES.findIndex(s => s.id === currentStage);
    if (i > 0) setCurrentStage(STAGES[i - 1].id);
  };

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStage]);

  return (
    <div className="fixed inset-0 z-[300] bg-[hsl(220,20%,3%)] overflow-hidden flex flex-col">
      {/* ── TOP BAR ── */}
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-b border-white/[0.06] bg-black/40 backdrop-blur-lg z-50">
        <div className="flex items-center gap-3">
          <img src={iffyLogo} alt="IFFY" className="h-7 w-7 rounded-md" />
          <span className="text-xs font-display uppercase tracking-[0.2em] text-primary/70 hidden sm:inline">
            Executive Mode
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="text-white/20 hover:text-white/50 transition-colors"
            title={soundEnabled ? 'Mute ambient' : 'Enable ambient sound'}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <span className="text-[10px] text-white/25 font-mono">
            {currentIndex + 1}/{STAGES.length}
          </span>
          <button onClick={() => navigate(-1)} className="text-white/20 hover:text-white/60 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── STAGE NAV ── */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 sm:px-4 py-2 overflow-x-auto border-b border-white/[0.04] bg-black/20 scrollbar-hide">
        {STAGES.map((stage, i) => {
          const isActive = stage.id === currentStage;
          const isPast = i < currentIndex;
          return (
            <button
              key={stage.id}
              onClick={() => goTo(stage.id)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-primary/15 text-primary border border-primary/25'
                  : isPast
                  ? 'text-white/40 hover:text-white/60'
                  : 'text-white/20 hover:text-white/40'
              }`}
            >
              <stage.icon className="h-3 w-3 shrink-0" />
              <span className="hidden sm:inline">{stage.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* ── CONTENT ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStage}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-full"
          >
            {currentStage === 'title' && <TitleStage onNext={next} />}
            {currentStage === 'development' && <DevelopmentStage />}
            {currentStage === 'packaging' && <PackagingStage />}
            {currentStage === 'financing' && <FinancingStage />}
            {currentStage === 'production' && <ProductionStage />}
            {currentStage === 'post' && <PostStage />}
            {currentStage === 'release' && <ReleaseStage />}
            {currentStage === 'recoupment' && <RecoupmentStage />}
            {currentStage === 'final' && <FinalStage onStart={() => navigate('/auth')} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── BOTTOM NAV ── */}
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-t border-white/[0.06] bg-black/40 backdrop-blur-lg z-50">
        <button
          onClick={prev}
          disabled={currentIndex === 0}
          className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          ← Previous
        </button>
        <span className="text-[10px] text-white/15 hidden sm:inline">
          ← → arrows or click to navigate
        </span>
        <button
          onClick={next}
          disabled={currentIndex === STAGES.length - 1}
          className="text-xs text-primary/70 hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          Next <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TITLE STAGE
   ═══════════════════════════════════════════════════════════ */
function TitleStage({ onNext }: { onNext: () => void }) {
  return (
    <div className="relative min-h-full flex items-center justify-center">
      <div className="absolute inset-0">
        <img src={heroImage} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(220,20%,3%)] via-[hsl(220,20%,3%)]/80 to-[hsl(220,20%,3%)]/40" />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(220,20%,3%)]/60 to-transparent" />
      </div>

      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/10 blur-[200px]" />

      <div className="relative z-10 text-center space-y-8 px-6 max-w-3xl">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-xs font-display uppercase tracking-[0.4em] text-primary/60"
        >
          Executive Mode — Major Studio Packaging
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="text-6xl sm:text-8xl font-display font-bold text-white tracking-tight leading-[1.05]"
        >
          SHADOW<br />PROTOCOL
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5 }}
          className="flex flex-wrap justify-center gap-3"
        >
          {['Prestige Action Thriller', '$165M', '2h 18m', 'Global Theatrical'].map((tag) => (
            <Badge key={tag} variant="outline" className="border-white/15 text-white/50 text-xs px-3 py-1">
              {tag}
            </Badge>
          ))}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="text-sm text-white/30 max-w-lg mx-auto leading-relaxed"
        >
          From first draft to global dominance. Follow one project through every phase of major studio filmmaking — powered by IFFY intelligence.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8, duration: 0.5 }}
        >
          <Button
            size="lg"
            onClick={onNext}
            className="gap-2 px-8 text-base bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Begin Executive Walkthrough <ArrowRight className="h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DEVELOPMENT STAGE
   ═══════════════════════════════════════════════════════════ */
function DevelopmentStage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={Lightbulb}
        stage="Stage 1 — Development"
        headline="An Idea Worth Betting $200M On."
        narration="This is not just a script. It's a global play. The concept travels. The genre endures. The question isn't whether it works — it's whether we can elevate it into an event."
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <DataCard delay={0.8}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Uploaded Materials</h4>
          <div className="space-y-2">
            {[
              { icon: FileText, label: 'Spec Script — A-list screenwriter', status: 'Verified' },
              { icon: Eye, label: 'Director Letter of Intent', status: 'Attached' },
              { icon: Film, label: 'Visual Lookbook (48 frames)', status: 'Processed' },
              { icon: Target, label: 'Franchise Potential Outline', status: 'Analysed' },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.0 + i * 0.1 }}
                className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0"
              >
                <item.icon className="h-3.5 w-3.5 text-primary/50 shrink-0" />
                <span className="text-sm text-white/70 flex-1">{item.label}</span>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">{item.status}</Badge>
              </motion.div>
            ))}
          </div>
        </DataCard>

        <DataCard delay={0.9}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Lane Classification</h4>
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-white/40">Primary</span>
                <Badge className="bg-primary/15 text-primary border border-primary/30 text-xs">Studio / Global Theatrical</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">Secondary</span>
                <Badge variant="outline" className="border-white/15 text-white/50 text-xs">Franchise / Event Cinema</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40">Confidence</span>
              <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                <motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: '92%' }} transition={{ delay: 1.2, duration: 1 }} />
              </div>
              <span className="text-sm font-mono text-emerald-400">92%</span>
            </div>
          </div>
        </DataCard>
      </div>

      <DataCard delay={1.0}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Creative Signal</h4>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: 'Concept Clarity', value: 'High', desc: 'Global espionage narrative with sequel elasticity' },
            { label: 'Franchise Viability', value: 'Strong', desc: 'World-building supports multi-film arc' },
            { label: 'Market Sensitivity', value: '1 Flag', desc: 'China sensitivity in third act location — mitigation suggested' },
          ].map((item, i) => (
            <motion.div key={item.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 + i * 0.1 }} className="space-y-1">
              <p className="text-xs text-white/40">{item.label}</p>
              <p className="text-sm font-medium text-white/80">{item.value}</p>
              <p className="text-xs text-white/30">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </DataCard>

      <DataCard delay={1.1}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60">Finance Readiness</h4>
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xl font-display font-bold text-amber-400"><AnimatedCounter value={61} suffix="%" duration={2.5} /></span>
          </div>
        </div>
        <p className="text-xs text-white/40">Concept strong but requires bankable cast and studio commitment to advance.</p>
        <div className="mt-3 space-y-2">
          <ScoreBar label="Script Quality" value={88} delay={1.3} color="bg-emerald-500" />
          <ScoreBar label="Concept Clarity" value={92} delay={1.4} color="bg-emerald-500" />
          <ScoreBar label="Cast Attachment" value={0} delay={1.5} color="bg-red-500" />
          <ScoreBar label="Studio Interest" value={35} delay={1.6} color="bg-amber-500" />
        </div>
      </DataCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PACKAGING STAGE
   ═══════════════════════════════════════════════════════════ */
function PackagingStage() {
  const attachments = [
    {
      role: 'Director',
      name: 'Christopher Nolan',
      impact: ['+Global pre-sales viability', '+Premium positioning', '+Studio leverage multiplier'],
      scoreBefore: 61,
      scoreAfter: 74,
      affirmations: ['Market confidence strengthened.', 'Studio leverage multiplier active.'],
    },
    {
      role: 'Lead Actor',
      name: 'Leonardo DiCaprio',
      impact: ['+Worldwide distribution guarantees', '+Awards crossover potential', '+Financing confidence spike'],
      scoreBefore: 74,
      scoreAfter: 86,
      affirmations: ['Global exposure reduced.', 'Financing confidence spike confirmed.'],
    },
    {
      role: 'Supporting Cast',
      name: 'Emily Blunt · John Boyega · Tilda Swinton',
      impact: ['+International appeal diversified', '+Awards & commercial balance', '+Ensemble depth for franchise'],
      scoreBefore: 86,
      scoreAfter: 93,
      affirmations: ['Leverage increased.', 'Package speaks for itself.'],
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={Package}
        stage="Stage 2 — Packaging"
        headline="Leverage Changes Everything."
        narration="Talent doesn't just add value — it reshapes risk. With every attachment, the conversation shifts. Studios lean forward. Financiers soften. The package begins to speak for itself."
      />

      {attachments.map((att, i) => (
        <DataCard key={att.role} delay={0.8 + i * 0.3}>
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-xs text-white/40 uppercase tracking-wider">{att.role}</span>
              </div>
              <h3 className="text-xl font-display font-bold text-white">{att.name}</h3>
              <div className="space-y-1">
                {att.impact.map(imp => (
                  <div key={imp} className="flex items-center gap-2 text-xs text-emerald-400/80">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span>{imp}</span>
                  </div>
                ))}
              </div>
              {/* Micro-affirmations */}
              <div className="space-y-0.5 pt-1">
                {att.affirmations.map((aff, j) => (
                  <Affirmation key={aff} text={aff} delay={1.2 + i * 0.3 + j * 0.3} />
                ))}
              </div>
            </div>
            <div className="sm:w-48 space-y-2">
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>Score Impact</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-mono text-white/40">{att.scoreBefore}%</span>
                <ArrowRight className="h-3 w-3 text-primary/50" />
                <span className="text-2xl font-display font-bold text-primary">
                  <AnimatedCounter value={att.scoreAfter} suffix="%" duration={2.5} />
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: `${att.scoreBefore}%` }}
                  animate={{ width: `${att.scoreAfter}%` }}
                  transition={{ delay: 1.0 + i * 0.3, duration: 1.5, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>
        </DataCard>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FINANCING STAGE
   ═══════════════════════════════════════════════════════════ */
function FinancingStage() {
  const stack = [
    { label: 'Studio Equity', pct: 50, amount: 82.5, color: 'bg-primary' },
    { label: 'International Pre-Sales', pct: 20, amount: 33, color: 'bg-sky-500' },
    { label: 'Gap Financing', pct: 15, amount: 24.75, color: 'bg-amber-500' },
    { label: 'Tax Incentives (UK)', pct: 12, amount: 19.8, color: 'bg-emerald-500' },
    { label: 'Private Equity Slate Partner', pct: 3, amount: 4.95, color: 'bg-violet-500' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={DollarSign}
        stage="Stage 3 — Financing"
        headline="The Structure Behind the Spectacle."
        narration="Scale without structure is chaos. This is where ambition becomes architecture. Equity, incentives, pre-sales — every layer absorbs risk and sharpens upside."
      />

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Production Budget', value: '$165M' },
          { label: 'P&A', value: '$110M' },
          { label: 'Total Exposure', value: '$275M' },
        ].map((item, i) => (
          <DataCard key={item.label} delay={0.8 + i * 0.1}>
            <p className="text-xs text-white/40 mb-1">{item.label}</p>
            <p className="text-2xl font-display font-bold text-white">{item.value}</p>
          </DataCard>
        ))}
      </div>

      <DataCard delay={1.0}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-4">Finance Stack</h4>
        <div className="flex rounded-lg overflow-hidden h-8 mb-4">
          {stack.map((s, i) => (
            <motion.div
              key={s.label}
              className={`${s.color} relative group`}
              initial={{ width: 0 }}
              animate={{ width: `${s.pct}%` }}
              transition={{ delay: 1.2 + i * 0.15, duration: 0.8, ease: 'easeOut' }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white/80 truncate px-1">
                {s.pct >= 10 ? `${s.pct}%` : ''}
              </span>
            </motion.div>
          ))}
        </div>
        <div className="space-y-2">
          {stack.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.4 + i * 0.1 }}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-sm ${s.color}`} />
                <span className="text-white/60">{s.label}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-white/40 text-xs">{s.pct}%</span>
                <span className="font-mono text-white/70">${s.amount}M</span>
              </div>
            </motion.div>
          ))}
        </div>
      </DataCard>

      <div className="grid sm:grid-cols-2 gap-4">
        <DataCard delay={1.3}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Risk Assessment</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-white/60">Low risk due to talent package strength</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
              <span className="text-white/60">Insurance costs elevated due to schedule scale</span>
            </div>
          </div>
        </DataCard>
        <DataCard delay={1.4}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Greenlight Probability</h4>
          <div className="flex items-center gap-3">
            <span className="text-4xl font-display font-bold text-emerald-400">HIGH</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-sm text-white/50">Finance Readiness</span>
            <span className="text-lg font-display font-bold text-emerald-400 ml-auto"><AnimatedCounter value={97} suffix="%" duration={2.5} /></span>
          </div>
          <Affirmation text="Structure complete. Risk absorbed." delay={2.0} />
        </DataCard>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRODUCTION STAGE
   ═══════════════════════════════════════════════════════════ */
function ProductionStage() {
  const risks = [
    { label: 'VFX Overages', status: 'warning', detail: 'Projected +4% above estimate', severity: 'Medium', mitigation: 'Mitigation deployed.' },
    { label: 'Weather Delay', status: 'caution', detail: 'Probability moderate for Iceland exteriors', severity: 'Low', mitigation: 'Contingency schedule active.' },
    { label: 'Third Unit Overspend', status: 'alert', detail: 'Second unit aerial work exceeding allocation', severity: 'Medium', mitigation: 'Exposure contained.' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={Clapperboard}
        stage="Stage 4 — Production"
        headline="Control the Variables."
        narration="Large productions don't fail because of vision. They fail because of drift. This dashboard protects margin, schedule, and reputation."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Schedule Health', value: '87%', color: 'text-emerald-400' },
          { label: 'Budget Variance', value: '+2.1%', color: 'text-amber-400' },
          { label: 'Insurance Exposure', value: '$12.4M', color: 'text-white/70' },
          { label: 'Bond Status', value: 'Clear', color: 'text-emerald-400' },
        ].map((item, i) => (
          <DataCard key={item.label} delay={0.8 + i * 0.1}>
            <p className="text-[10px] text-white/40 uppercase tracking-wider">{item.label}</p>
            <p className={`text-lg sm:text-xl font-display font-bold mt-1 ${item.color}`}>{item.value}</p>
          </DataCard>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <DataCard delay={1.0}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-4">Production Metrics</h4>
          <div className="space-y-3">
            <ScoreBar label="Schedule Completion" value={87} delay={1.1} color="bg-emerald-500" />
            <ScoreBar label="VFX Pipeline" value={62} delay={1.2} color="bg-amber-500" />
            <ScoreBar label="Post-Production Prep" value={34} delay={1.3} color="bg-sky-500" />
            <ScoreBar label="Deliverables Readiness" value={18} delay={1.4} color="bg-violet-500" />
          </div>
        </DataCard>

        <DataCard delay={1.1}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-4">Active Risk Flags</h4>
          <div className="space-y-3">
            {risks.map((risk, i) => (
              <motion.div
                key={risk.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.3 + i * 0.2 }}
                className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]"
              >
                <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${risk.status === 'alert' ? 'text-red-400' : 'text-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/80">{risk.label}</span>
                    <Badge variant="outline" className={`text-[10px] ${risk.status === 'alert' ? 'border-red-500/30 text-red-400' : 'border-amber-500/30 text-amber-400'}`}>
                      {risk.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">{risk.detail}</p>
                  <Affirmation text={risk.mitigation} delay={1.6 + i * 0.25} />
                </div>
              </motion.div>
            ))}
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.2 }}
            className="mt-3 p-2 rounded-lg bg-primary/5 border border-primary/15"
          >
            <p className="text-xs text-primary/70">
              <Zap className="h-3 w-3 inline mr-1" />
              IFFY recommends: Reallocate aerial budget to primary unit. Request VFX vendor lock on remaining sequences.
            </p>
          </motion.div>
        </DataCard>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   POST & POSITIONING STAGE
   ═══════════════════════════════════════════════════════════ */
function PostStage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={Film}
        stage="Stage 5 — Release Strategy"
        headline="Turn Attention Into Dominance."
        narration="Release is strategy, not celebration. Timing, positioning, competitive landscape — this is where narrative becomes revenue."
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <DataCard delay={0.8}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Festival Strategy</h4>
          <div className="space-y-3">
            {[
              { festival: 'Venice Film Festival', slot: 'Out of Competition', confidence: 'High' },
              { festival: 'Toronto International Film Festival', slot: 'Gala Premiere', confidence: 'Very High' },
            ].map((f, i) => (
              <motion.div key={f.festival} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.0 + i * 0.15 }} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <div>
                  <p className="text-sm text-white/80">{f.festival}</p>
                  <p className="text-xs text-white/40">{f.slot}</p>
                </div>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">{f.confidence}</Badge>
              </motion.div>
            ))}
          </div>
        </DataCard>

        <DataCard delay={0.9}>
          <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Awards Strategy</h4>
          <div className="space-y-3">
            {[
              { category: 'Best Director', candidate: 'Christopher Nolan', strength: 'Strong' },
              { category: 'Best Actor', candidate: 'Leonardo DiCaprio', strength: 'High Potential' },
              { category: 'Best Picture', candidate: '—', strength: 'Competitive' },
            ].map((a, i) => (
              <motion.div key={a.category} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 + i * 0.1 }} className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/80">{a.category}</p>
                  <p className="text-xs text-white/40">{a.candidate}</p>
                </div>
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">{a.strength}</Badge>
              </motion.div>
            ))}
          </div>
        </DataCard>
      </div>

      <DataCard delay={1.0}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Trailer Strategy</h4>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-white/80">Teaser</p>
            <p className="text-xs text-white/40">Super Bowl placement — 60-second cut</p>
            <p className="text-xs text-white/25">Estimated impressions: 120M+</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-white/80">Full Trailer</p>
            <p className="text-xs text-white/40">Attached to major summer tentpole</p>
            <p className="text-xs text-white/25">Online release 48h later — viral strategy</p>
          </div>
        </div>
      </DataCard>

      <DataCard delay={1.1}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Audience Quadrant Analysis</h4>
        <div className="grid grid-cols-2 gap-4">
          {[
            { quad: 'Males 18–34', strength: 92 },
            { quad: 'Males 35–49', strength: 85 },
            { quad: 'Females 18–34', strength: 68 },
            { quad: 'Females 35–49', strength: 61 },
          ].map((q, i) => (
            <motion.div key={q.quad} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 + i * 0.1 }}>
              <ScoreBar label={q.quad} value={q.strength} delay={1.4 + i * 0.1} color={q.strength >= 80 ? 'bg-emerald-500' : q.strength >= 60 ? 'bg-primary' : 'bg-amber-500'} />
            </motion.div>
          ))}
        </div>
        <p className="text-xs text-white/30 mt-3">Strong 18–45 global male skew. Supporting cast expands female demographic reach.</p>
      </DataCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   RELEASE STAGE
   ═══════════════════════════════════════════════════════════ */
function ReleaseStage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={Globe}
        stage="Stage 6 — Global Results"
        headline="The Moment the Bet Pays Off."
        narration="Scale rewards conviction. Theatrical performance cascades into downstream value. This is compounding leverage in motion."
      />

      <DataCard delay={0.8}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-4">Box Office Projections</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { territory: 'Domestic', value: 410, delay: 1.0 },
            { territory: 'International', value: 680, delay: 1.3 },
            { territory: 'China', value: 120, delay: 1.6 },
            { territory: 'Total B.O.', value: 1210, highlight: true, delay: 2.0 },
          ].map((t) => (
            <motion.div
              key={t.territory}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: t.delay, duration: 0.6 }}
              className={`text-center p-4 rounded-xl ${t.highlight ? 'bg-primary/10 border border-primary/25' : 'bg-white/[0.02] border border-white/[0.06]'}`}
            >
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{t.territory}</p>
              <p className={`text-2xl sm:text-3xl font-display font-bold ${t.highlight ? 'text-primary' : 'text-white/80'}`}>
                $<AnimatedCounter value={t.value} duration={3.0} />M
              </p>
            </motion.div>
          ))}
        </div>
      </DataCard>

      <DataCard delay={1.5}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-4">Ancillary Revenue</h4>
        <div className="space-y-3">
          {[
            { label: 'Streaming Licensing', value: 180, pct: 44 },
            { label: 'TV Syndication', value: 95, pct: 23 },
            { label: 'Home Entertainment', value: 75, pct: 18 },
            { label: 'Merchandising', value: 60, pct: 15 },
          ].map((r, i) => (
            <motion.div key={r.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.8 + i * 0.15 }}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-white/60">{r.label}</span>
                <span className="font-mono text-white/70">${r.value}M</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div className="h-full rounded-full bg-sky-500" initial={{ width: 0 }} animate={{ width: `${r.pct}%` }} transition={{ delay: 2.0 + i * 0.15, duration: 0.8 }} />
              </div>
            </motion.div>
          ))}
        </div>
      </DataCard>

      <DataCard delay={2.0} className="text-center">
        <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Total Gross Revenue</p>
        <p className="text-5xl sm:text-6xl font-display font-bold text-primary">
          $<AnimatedCounter value={1620} duration={3.5} />M
        </p>
        <p className="text-sm text-white/30 mt-1">$1.62 Billion</p>
        <Affirmation text="Compounding leverage confirmed." delay={4.0} />
      </DataCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   RECOUPMENT STAGE
   ═══════════════════════════════════════════════════════════ */
function RecoupmentStage() {
  const waterfall = [
    { label: 'Distribution Fees', amount: 405, color: 'bg-white/20' },
    { label: 'P&A Recoup', amount: 110, color: 'bg-white/15' },
    { label: 'Negative Cost Recoup', amount: 165, color: 'bg-amber-500' },
    { label: 'Profit Participation Pools', amount: 530, color: 'bg-emerald-500' },
  ];

  const backend = [
    { participant: 'Director (Christopher Nolan)', pct: '10% net', est: '$41M' },
    { participant: 'Lead Actor (Leonardo DiCaprio)', pct: '8% net', est: '$33M' },
    { participant: 'Producer Pool', pct: '5% net', est: '$20.5M' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <NarrativeHeader
        icon={PieChart}
        stage="Stage 7 — Recoupment"
        headline="Where Conviction Becomes Return."
        narration="The waterfall reveals the truth of the deal. Every dollar placed, every risk absorbed — this is where it resolves."
      />

      <DataCard delay={0.8}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-4">Waterfall Order</h4>
        <div className="space-y-2">
          {waterfall.map((w, i) => (
            <motion.div
              key={w.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.0 + i * 0.2 }}
            >
              <div className="flex items-center justify-between text-sm mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white/30 w-4">{i + 1}.</span>
                  <span className="text-white/70">{w.label}</span>
                </div>
                <span className="font-mono text-white/60">${w.amount}M</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden ml-6">
                <motion.div
                  className={`h-full rounded-full ${w.color}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${(w.amount / 530) * 100}%` }}
                  transition={{ delay: 1.2 + i * 0.2, duration: 1.0 }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </DataCard>

      <div className="grid sm:grid-cols-2 gap-4">
        <DataCard delay={1.2} className="text-center">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Projected Net Profit</p>
          <p className="text-4xl font-display font-bold text-emerald-400">
            $<AnimatedCounter value={410} duration={2.5} />M
          </p>
        </DataCard>
        <DataCard delay={1.3} className="text-center">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Studio ROI</p>
          <p className="text-4xl font-display font-bold text-primary">Strong Positive</p>
          <Affirmation text="Return validated across all windows." delay={2.0} />
        </DataCard>
      </div>

      <DataCard delay={1.4}>
        <h4 className="text-xs font-display uppercase tracking-wider text-primary/60 mb-3">Backend Participation</h4>
        <div className="space-y-3">
          {backend.map((b, i) => (
            <motion.div
              key={b.participant}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.6 + i * 0.15 }}
              className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0"
            >
              <div>
                <p className="text-sm text-white/80">{b.participant}</p>
                <p className="text-xs text-white/40">{b.pct}</p>
              </div>
              <span className="font-mono text-emerald-400">{b.est}</span>
            </motion.div>
          ))}
        </div>
      </DataCard>

      <DataCard delay={1.8} className="text-center border-emerald-500/20">
        <div className="flex items-center justify-center gap-2 mb-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <span className="text-xs font-display uppercase tracking-[0.2em] text-emerald-400">Final Status</span>
        </div>
        <p className="text-2xl font-display font-bold text-white">PRODUCTION SUCCESS — HIGH CONFIDENCE</p>
      </DataCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FINAL STAGE
   ═══════════════════════════════════════════════════════════ */
function FinalStage({ onStart }: { onStart: () => void }) {
  const journey = [
    'Spec Script',
    'Packaged with A-List',
    'Studio Structured Finance',
    'Controlled Production',
    'Strategic Release',
    'Global Profit',
  ];

  return (
    <div className="relative min-h-full flex items-center justify-center">
      <div className="absolute inset-0">
        <img src={heroImage} alt="" className="w-full h-full object-cover opacity-15" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(220,20%,3%)] via-[hsl(220,20%,3%)]/90 to-[hsl(220,20%,3%)]/60" />
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/8 blur-[200px]" />

      <div className="relative z-10 text-center space-y-12 px-6 max-w-3xl py-16">
        {/* Journey steps */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {journey.map((step, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.25 }}
              className="flex items-center gap-2 sm:gap-3"
            >
              <span className="text-xs sm:text-sm font-display text-white/60">{step}</span>
              {i < journey.length - 1 && (
                <ArrowRight className="h-3 w-3 text-primary/40 shrink-0" />
              )}
            </motion.div>
          ))}
        </div>

        {/* Emotional closing statement */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 1.2 }}
          className="space-y-6"
        >
          <div className="space-y-3">
            <p className="text-lg sm:text-xl text-white/60 leading-relaxed max-w-xl mx-auto font-display">
              You don't hope for success at this level.
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 3.0, duration: 0.8 }}
              className="text-xl sm:text-2xl text-white/80 leading-relaxed max-w-xl mx-auto font-display font-semibold"
            >
              You engineer it.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 4.0, duration: 1 }}
            className="space-y-2 pt-4"
          >
            <p className="text-sm text-white/35 leading-relaxed max-w-md mx-auto">
              IFFY doesn't replace instinct.<br />
              It sharpens it.
            </p>
            <p className="text-sm text-white/25 leading-relaxed max-w-md mx-auto">
              This is what intelligent producing looks like.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 5.0, duration: 0.8 }}
            className="h-px w-32 mx-auto bg-gradient-to-r from-transparent via-primary/40 to-transparent"
          />

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 5.5, duration: 0.6 }}
            className="text-xs font-display uppercase tracking-[0.3em] text-primary/50"
          >
            Intelligent Film Flow & Yield
          </motion.p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 6.0, duration: 0.6 }}
        >
          <Button
            size="lg"
            onClick={onStart}
            className="gap-2 px-10 text-base bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Start Your Own Project <ArrowRight className="h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
