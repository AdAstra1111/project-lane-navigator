import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain, Target, Layers, TrendingUp, DollarSign, ArrowRight,
  Gauge, GitBranch, BarChart3, Zap, Shield, Clapperboard,
  FileText, Users, Search, Lightbulb, Lock, BookOpen,
  Globe, Award, Calendar, Radio, Scissors, PenTool,
  Database, Eye,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { useUIMode } from '@/hooks/useUIMode';
import { Badge } from '@/components/ui/badge';
import heroBoardroom from '@/assets/hero-boardroom.jpg';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 } as const,
  whileInView: { opacity: 1, y: 0 } as const,
  viewport: { once: true, margin: '-60px' },
  transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
});

/* ── Scoring Architecture ── */

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

/* ── Feature Systems ── */

interface FeatureSystem {
  icon: typeof Brain;
  title: string;
  detail: string;
  advancedOnly?: boolean;
}

const featureSystems: FeatureSystem[] = [
  {
    icon: FileText,
    title: 'Script Coverage Engine',
    detail: 'Three-pass AI coverage chain: Analyst evaluates structure, dialogue, character, and pacing → Producer pass layers commercial viability, packaging potential, and market positioning → QC merge reconciles into a final coverage report with structured notes. Each note is categorised, prioritised, and tagged for writer workflow. Metrics scored 0–100 per dimension.',
  },
  {
    icon: PenTool,
    title: 'Script Engine',
    detail: 'Multi-step generative pipeline: Blueprint (structure outline) → Architecture (act/sequence design) → Batch scene drafting → Assembly into full script → optional Rewrite pass with tracked changes and score deltas. Calibrated by production type and format profile (page targets, runtime constraints). Supports versioning — every edit creates a new version.',
  },
  {
    icon: Database,
    title: 'Corpus Intelligence',
    detail: 'A library of 98+ ingested reference scripts parsed into scenes, character profiles, and structural patterns. Corpus insights power baseline calibration: average scene lengths, dialogue ratios, act structures, and pacing norms by genre and production type. The Script Engine and Coverage system reference corpus baselines to ground their analysis in real-world patterns.',
  },
  {
    icon: Lightbulb,
    title: 'Greenlight Radar & Concept Pipeline',
    detail: 'AI-generated pitch ideas scored across five dimensions: market heat, feasibility, lane fit, saturation risk, and company fit. Ideas flow through a structured pipeline: Generate → Expand (treatment, character bible, tone doc, arc map, world bible) → Stress Test (creative structure, engine sustainability, market alignment) → Concept Lock (immutable snapshot) → Promote to Project.',
  },
  {
    icon: Lock,
    title: 'Concept Lock System',
    detail: 'Immutable versioning for validated concepts. Once locked, all fields are snapshotted and cannot be edited without an explicit unlock with documented reason. Lock versions are numbered and auditable. Locked concepts can be promoted into full project dossiers, carrying all development documents forward.',
  },
  {
    icon: Users,
    title: 'Packaging Pipeline',
    detail: 'Track cast, director, producer, and key crew attachments with status, priority, and archetype classification. The packaging score feeds directly into Stage Readiness and Master Viability — weak packaging is the single most common blocker to finance readiness.',
    advancedOnly: true,
  },
  {
    icon: Search,
    title: 'Buyer Intelligence & CRM',
    detail: 'AI-powered buyer matching based on genre appetite, territory focus, budget tier, and historical deal patterns. Full CRM for tracking contacts, meetings, and deal status. Buyer research uses Perplexity for real-time intelligence on distributor and platform acquisition behaviour.',
    advancedOnly: true,
  },
  {
    icon: Globe,
    title: 'Incentive Finder & Co-Production Planner',
    detail: 'Database of tax credits, rebates, and soft money programs across jurisdictions. The co-production planner evaluates official treaty frameworks, eligible countries, share percentages, and cultural requirements. Both systems are production-type aware — a commercial sees production service rebates, not feature film treaty co-productions.',
  },
  {
    icon: Award,
    title: 'Festival Calendar & Market Windows',
    detail: 'Festival dates, submission deadlines, and premiere strategies mapped to project lifecycle stage. Market window alerts surface timing-critical opportunities — submission deadlines, market dates, and buyer availability windows.',
  },
  {
    icon: Radio,
    title: 'Trend Engines (22 Active)',
    detail: 'Four intelligence layers — Market (box office, streaming, festivals, international sales, awards), Narrative (genre evolution, thematic emergence, structural innovation, audience sentiment), Talent (director momentum, actor value, writer voice, emerging talent), Platform (commissioning, format innovation, regional content, IP adaptation, cross-media). Each engine has independent confidence scoring with staleness decay.',
    advancedOnly: true,
  },
  {
    icon: BarChart3,
    title: 'Cast Trends',
    detail: 'Actor-level trend tracking with cycle phase (rising, peaking, cooling), velocity, market alignment, genre relevance, budget tier fit, and sales leverage scoring. Cast trend data feeds into packaging recommendations and buyer matching.',
    advancedOnly: true,
  },
  {
    icon: Scissors,
    title: 'Post-Production & Delivery Intelligence',
    detail: 'Edit versioning, screening scores, deliverables tracking, and delivery specification management. Post-production readiness feeds into the Sales & Delivery stage gate — projects cannot advance without confirmed deliverables status.',
    advancedOnly: true,
  },
  {
    icon: Eye,
    title: 'Comp Analysis & Smart Packaging',
    detail: 'AI-driven comparable title analysis using box office, streaming performance, and market positioning data. Smart Packaging suggests optimal talent and partner combinations based on comp performance, buyer appetite, and budget band constraints.',
    advancedOnly: true,
  },
  {
    icon: Calendar,
    title: 'Schedule Intelligence & Production Monitoring',
    detail: 'Production calendar with schedule impact analysis, daily report logging, cost actuals tracking, and production stability scoring. Schedule deviations trigger automated alerts with financial impact estimates.',
    advancedOnly: true,
  },
];

/* ── Design Principles ── */

const principles = [
  { icon: Shield, title: 'Deterministic scores', body: 'Scores are calculated from measurable project data, never from AI sentiment. AI generates recommendations; arithmetic generates scores.' },
  { icon: Clapperboard, title: 'Production-type aware', body: 'Every weight, module, and recommendation is conditioned by production type. A commercial never sees festival strategy. A documentary never gets "attach a movie star" advice.' },
  { icon: BarChart3, title: 'Confidence decay', body: 'Data source reliability degrades over time. If a trend engine\'s data is 30+ days old, confidence drops from High to Medium to Low. Stale intelligence is flagged, never hidden.' },
  { icon: Zap, title: 'Explainable breakdowns', body: 'Every composite score shows its component parts. You can always trace a number back to the specific inputs that produced it — strengths, weaknesses, and blockers.' },
  { icon: BookOpen, title: 'Corpus-grounded calibration', body: 'Script analysis and coverage are calibrated against real-world screenplay baselines — genre-specific scene lengths, dialogue ratios, and structural norms derived from the ingested corpus.' },
  { icon: Layers, title: 'Stage-aware intelligence', body: 'IFFY surfaces different intelligence depending on where your project sits in its lifecycle. Development sees narrative trends; Packaging sees talent heat; Sales sees buyer appetite and territory pricing.' },
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
  const { mode } = useUIMode();
  const isAdvanced = mode === 'advanced';

  const visibleFeatures = featureSystems.filter(f => !f.advancedOnly || isAdvanced);

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
              No black boxes. Every score is traceable, every system is documented, every AI boundary is defined.
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

        {/* Feature Systems */}
        <motion.section {...fadeUp(0.12)} className="space-y-8">
          <div>
            <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-2">Feature Systems</p>
            <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">
              What powers each capability
            </h2>
            <p className="text-muted-foreground mt-2">
              Every feature below is production-type aware — modules only appear when relevant to your project format.
              {!isAdvanced && (
                <span className="text-primary/80 ml-1">Switch to Advanced mode to see all systems.</span>
              )}
            </p>
          </div>
          <div className="space-y-4">
            {visibleFeatures.map((feature, i) => (
              <motion.div
                key={feature.title}
                {...fadeUp(0.15 + i * 0.03)}
                className="group glass-card rounded-xl p-5 sm:p-6 space-y-2"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-display font-bold text-foreground">{feature.title}</h3>
                  {feature.advancedOnly && (
                    <Badge variant="outline" className="text-[9px] ml-auto">Advanced</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed pl-[52px]">{feature.detail}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Design Principles */}
        <motion.section {...fadeUp(0.18)} className="space-y-8">
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
