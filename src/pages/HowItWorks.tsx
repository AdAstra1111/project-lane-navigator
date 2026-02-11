import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, FolderOpen, RefreshCw, Landmark, Footprints,
  DollarSign, Users, BarChart3, Sparkles, FileOutput,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import heroCamera from '@/assets/hero-camera.jpg';
import heroDesk from '@/assets/hero-desk.jpg';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
});

const steps = [
  {
    icon: FolderOpen,
    title: 'Living dossiers, not documents',
    body: 'When you create a project in IFFY, it becomes a living dossier — not a static document. Every piece of information you add — script, cast, partners — updates the overall assessment automatically. You don\'t need to re-run anything.',
    accent: 'from-primary/20 to-primary/5',
  },
  {
    icon: RefreshCw,
    title: 'Every decision moves the needle',
    body: 'Attach a marquee director? Your readiness score changes. Confirm a co-production partner? The finance picture shifts. IFFY watches what matters — packaging, finance fit, and market timing — and reflects it in real time.',
    accent: 'from-emerald-500/20 to-emerald-500/5',
  },
  {
    icon: DollarSign,
    title: 'Build your capital stack deal by deal',
    body: 'The Finance Tracker organises your funding across six categories — Sales & Distribution, Equity, Tax Incentives, Soft Money, Gap & Debt, and Other. Log individual deals with status, amounts, and counterparties. The waterfall chart shows the gap at a glance.',
    accent: 'from-amber-500/20 to-amber-500/5',
  },
  {
    icon: Landmark,
    title: 'Finance, incentives, co-productions — integrated',
    body: 'Incentive programmes, co-production treaties, and capital stack scenarios aren\'t separate tools. They\'re part of the same assessment. IFFY evaluates them in the context of your specific project — its budget, its genre, its territory mix.',
    accent: 'from-blue-500/20 to-blue-500/5',
  },
  {
    icon: Sparkles,
    title: 'Smart Packaging suggests who fits',
    body: 'Smart Packaging uses AI to recommend talent combinations — cast and directors — based on your budget, genre, lane, and current market trends. Click any suggested name for a full market assessment, trajectory analysis, and links to IMDb.',
    accent: 'from-purple-500/20 to-purple-500/5',
  },
  {
    icon: Users,
    title: 'Collaborate without losing control',
    body: 'Invite collaborators via a secure link and assign roles — Producer, Sales Agent, Lawyer, or Creative. Each role sees only the sections relevant to their function. Threaded, section-filtered comments keep discussions in context.',
    accent: 'from-rose-500/20 to-rose-500/5',
  },
  {
    icon: BarChart3,
    title: 'Market intelligence finds you',
    body: 'Trend signals are automatically matched to your project based on genre, tone, format, and lane. Buyer matching scores active industry buyers against your project metadata. The pipeline gives you a Kanban view with stage gates.',
    accent: 'from-cyan-500/20 to-cyan-500/5',
  },
  {
    icon: FileOutput,
    title: 'Export. Compare. Decide.',
    body: 'Generate a professional PDF One-Pager for any project. Clone projects to create variants, then compare them side-by-side to see how changes in budget, cast, or territory impact positioning.',
    accent: 'from-orange-500/20 to-orange-500/5',
  },
  {
    icon: Footprints,
    title: 'Readiness is built step by step',
    body: 'There\'s no "submit and wait" in IFFY. Readiness is built one decision at a time. The system always shows you the best next step — the single action most likely to move your project closer to finance-ready.',
    accent: 'from-primary/20 to-primary/5',
  },
];

export default function HowItWorks() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 100]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero with parallax */}
      <section ref={heroRef} className="relative h-[480px] sm:h-[560px] overflow-hidden">
        <motion.div style={{ y: heroY }} className="absolute inset-0">
          <img src={heroCamera} alt="" className="w-full h-full object-cover scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
        </motion.div>
        <motion.div style={{ opacity: heroOpacity }} className="relative z-10 container max-w-3xl h-full flex flex-col justify-end pb-16">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <p className="text-xs font-display uppercase tracking-[0.25em] text-primary">The Producer's Workflow</p>
            <h1 className="text-4xl sm:text-6xl font-display font-bold text-foreground tracking-tight leading-[1.1]">
              From script to<br />
              <span className="text-gradient">closing finance.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg">
              Nine steps that turn a project into a financed production. Every decision updates the picture. No waiting.
            </p>
          </motion.div>
        </motion.div>
      </section>

      <main className="container max-w-3xl py-16 space-y-6">
        {steps.map((step, i) => (
          <motion.div
            key={step.title}
            {...fadeUp(i * 0.05)}
            className="group relative"
          >
            {/* Connecting line */}
            {i < steps.length - 1 && (
              <div className="absolute left-[27px] top-[72px] bottom-0 w-px bg-gradient-to-b from-border to-transparent" />
            )}

            <div className="relative glass-card rounded-2xl p-6 sm:p-8 space-y-4 overflow-hidden">
              {/* Subtle gradient accent */}
              <div className={`absolute inset-0 bg-gradient-to-br ${step.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

              <div className="relative flex items-start gap-4">
                {/* Step number + icon */}
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <div className="h-[54px] w-[54px] rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <step.icon className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                </div>

                <div className="space-y-2 flex-1">
                  <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground tracking-tight">
                    {step.title}
                  </h2>
                  <p className="text-muted-foreground leading-relaxed">{step.body}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Mid-page image break */}
        <motion.div {...fadeUp(0.1)} className="relative rounded-2xl overflow-hidden h-[240px] my-8">
          <img src={heroDesk} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 to-background/30 flex items-center">
            <div className="px-8 space-y-2">
              <p className="text-xs font-display uppercase tracking-[0.2em] text-primary">The result</p>
              <p className="text-2xl font-display font-bold text-foreground">Finance-ready.<br/>Not finance-hopeful.</p>
            </div>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div {...fadeUp(0.15)} className="text-center pt-8">
          <Link to="/dashboard">
            <Button size="lg" className="gap-2 text-base px-8">
              Start building <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-3">No credit card required. Your first project is free.</p>
        </motion.div>
      </main>
    </div>
  );
}
