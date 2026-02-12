import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain, Target, Layers, TrendingUp, DollarSign, ArrowRight,
  Gauge, GitBranch, BarChart3, Zap, Shield, Clapperboard,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import heroBoardroom from '@/assets/hero-boardroom.jpg';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 } as const,
  whileInView: { opacity: 1, y: 0 } as const,
  viewport: { once: true, margin: '-60px' },
  transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
});

const scoringLayers = [
  {
    icon: Layers,
    title: 'Stage Readiness (per-stage)',
    detail: 'Each of six lifecycle stages calculates a 0–100 score from stage-specific metrics. Development measures script clarity and audience definition. Packaging measures cast strength and partner attachments. Pre-Production measures budget completeness and schedule readiness.',
    color: 'from-primary/20 to-primary/5',
  },
  {
    icon: Gauge,
    title: 'Master Viability Score',
    detail: 'A weighted average of all six stage readiness scores. Weights are dynamically adjusted by production type. Feature Films: Packaging ~25%, Development ~20%, Finance ~20%. Documentaries: Development ~30%, Sales ~25%. The system ensures industry-appropriate priorities.',
    color: 'from-emerald-500/20 to-emerald-500/5',
  },
  {
    icon: TrendingUp,
    title: 'Trend Viability Score',
    detail: 'Normalised 0–100 from four intelligence layers: Market (buyer appetite, territory pricing), Narrative (genre cycles, theme momentum), Talent (cast heat, director trajectory), Platform (streaming demand, format fit). Contributes 30% to overall Readiness. Weights per production type.',
    color: 'from-cyan-500/20 to-cyan-500/5',
  },
  {
    icon: DollarSign,
    title: 'Finance Readiness',
    detail: 'Grades how closeable your finance plan is (0–100). Components: budget lock status, capital stack coverage ratio, deal pipeline depth, incentive qualification, co-production eligibility, and structural risk flags (gap size, single-source dependency).',
    color: 'from-amber-500/20 to-amber-500/5',
  },
  {
    icon: GitBranch,
    title: 'Lane Classification',
    detail: 'Projects are classified into one of seven monetisation lanes using weighted analysis of budget, genre, audience, tone, and comparable titles. Each lane maps to distinct financing strategies, buyer profiles, and market windows. Confidence scores indicate classification strength.',
    color: 'from-purple-500/20 to-purple-500/5',
  },
];

const principles = [
  { icon: Shield, title: 'Deterministic scores', body: 'Scores are calculated from measurable project data, never from AI sentiment. AI generates recommendations; arithmetic generates scores.' },
  { icon: Clapperboard, title: 'Production-type aware', body: 'Every weight, module, and recommendation is conditioned by production type. A commercial never sees festival strategy. A documentary never gets "attach a movie star" advice.' },
  { icon: BarChart3, title: 'Confidence decay', body: 'Data source reliability degrades over time. If a trend engine\'s data is 30+ days old, confidence drops from High to Medium to Low. Stale intelligence is flagged, never hidden.' },
  { icon: Zap, title: 'Explainable breakdowns', body: 'Every composite score shows its component parts. You can always trace a number back to the specific inputs that produced it — strengths, weaknesses, and blockers.' },
];

const readinessFormula = [
  { label: 'Package Strength', weight: '50%', desc: 'Cast, director, partner attachments and their market value' },
  { label: 'Trend Alignment', weight: '30%', desc: 'Trend Viability Score across 4 intelligence layers' },
  { label: 'Lane Fit', weight: '20%', desc: 'How well the project matches its classified monetisation lane' },
];

export default function HowIFFYThinks() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section ref={heroRef} className="relative h-[420px] sm:h-[480px] overflow-hidden">
        <motion.div style={{ y: heroY }} className="absolute inset-0">
          <img src={heroBoardroom} alt="" className="w-full h-full object-cover scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-background/20" />
        </motion.div>
        <div className="relative z-10 container max-w-3xl h-full flex flex-col justify-end pb-14">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <p className="text-xs font-display uppercase tracking-[0.25em] text-primary">Transparency</p>
            </div>
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
              How IFFY Thinks
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg">
              No black boxes. Every score is traceable, every weight is documented, every AI boundary is defined.
            </p>
          </motion.div>
        </div>
      </section>

      <main className="container max-w-3xl py-16 space-y-20">
        {/* Core Principle */}
        <motion.section {...fadeUp()} className="space-y-4">
          <p className="text-xs font-display uppercase tracking-[0.2em] text-primary">Core Principle</p>
          <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">
            AI recommends. Arithmetic scores.
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            IFFY uses AI for analysis, pattern detection, and recommendations — but <span className="text-foreground font-medium">every numerical score is a deterministic calculation</span> from measurable project inputs. You can always ask "why this number?" and get a concrete answer.
          </p>
        </motion.section>

        {/* Scoring Architecture */}
        <motion.section {...fadeUp(0.05)} className="space-y-8">
          <div>
            <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-2">Scoring Architecture</p>
            <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">
              Five interlocking systems
            </h2>
          </div>
          {scoringLayers.map((layer, i) => (
            <motion.div
              key={layer.title}
              {...fadeUp(0.1 + i * 0.04)}
              className="group relative glass-card rounded-2xl p-6 sm:p-8 space-y-3 overflow-hidden"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${layer.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              <div className="relative flex items-start gap-4">
                <div className="shrink-0 h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <layer.icon className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-xl font-display font-bold text-foreground">{layer.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{layer.detail}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.section>

        {/* Readiness Formula */}
        <motion.section {...fadeUp(0.1)} className="space-y-6">
          <div>
            <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-2">Readiness Formula</p>
            <h2 className="text-2xl font-display font-bold text-foreground tracking-tight">
              How overall Readiness is composed
            </h2>
          </div>
          <div className="glass-card rounded-xl p-6 space-y-4">
            {readinessFormula.map((item) => (
              <div key={item.label} className="flex items-center gap-4">
                <div className="shrink-0 w-16 text-right">
                  <span className="text-xl font-display font-bold text-primary">{item.weight}</span>
                </div>
                <div className="flex-1">
                  <p className="font-display font-semibold text-foreground text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Design Principles */}
        <motion.section {...fadeUp(0.15)} className="space-y-8">
          <div>
            <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-2">Design Principles</p>
            <h2 className="text-2xl font-display font-bold text-foreground tracking-tight">
              How we keep it honest
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {principles.map(({ icon: Icon, title, body }, i) => (
              <motion.div
                key={title}
                {...fadeUp(0.2 + i * 0.04)}
                className="glass-card rounded-xl p-5 space-y-3"
              >
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display font-bold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* CTA */}
        <motion.div {...fadeUp(0.2)} className="text-center pt-4 space-y-3">
          <Link to="/faq">
            <Button size="lg" className="gap-2 px-8">
              Explore Help Centre <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">
            Questions? Check the full knowledge base.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
