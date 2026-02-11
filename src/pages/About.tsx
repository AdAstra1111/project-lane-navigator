import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Target, Layers, TrendingUp, Shield, DollarSign, Users, Sparkles, GitBranch, UserPlus, FileOutput } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import heroBoardroom from '@/assets/hero-boardroom.jpg';
import heroCamera from '@/assets/hero-camera.jpg';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
});

const capabilities = [
  { icon: Layers, title: 'Living dossiers', desc: 'Every project is a living document. As you attach cast, partners, scripts, and HODs, the assessment updates automatically.' },
  { icon: Target, title: 'Decision-support', desc: 'IFFY surfaces the best next step — not a to-do list. One decision at a time, moving you closer to finance-ready.' },
  { icon: DollarSign, title: 'Finance Tracker', desc: 'Build your capital stack deal by deal across six categories with real-time waterfall visualisation.' },
  { icon: TrendingUp, title: 'Market intelligence', desc: 'Trend signals, cast momentum, and genre cycles tracked continuously and matched to your project.' },
  { icon: Shield, title: 'Finance integration', desc: 'Incentives, co-production treaties, and capital stacks evaluated in context — not in isolation.' },
  { icon: Users, title: 'Buyer matching & CRM', desc: 'Scored buyer matches based on genre, budget, territory, and tone — plus a CRM to track relationships.' },
  { icon: Sparkles, title: 'Smart Packaging', desc: 'AI-driven talent recommendations based on budget, genre, lane, and market trends.' },
  { icon: GitBranch, title: 'Pipeline & stage gates', desc: 'Kanban view across Development, Packaging, Financing, and Pre-Production with automated gates.' },
  { icon: UserPlus, title: 'Collaboration', desc: 'Role-based access for Producers, Sales Agents, Lawyers, and Creatives with threaded comments.' },
  { icon: FileOutput, title: 'Export & compare', desc: 'Professional PDF One-Pager. Clone and compare variants side-by-side across readiness scores.' },
];

export default function About() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero — full-bleed cinematic */}
      <section ref={heroRef} className="relative h-[520px] sm:h-[600px] overflow-hidden">
        <motion.div style={{ y: heroY }} className="absolute inset-0">
          <img src={heroBoardroom} alt="" className="w-full h-full object-cover scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        </motion.div>
        <div className="relative z-10 container max-w-3xl h-full flex flex-col justify-end pb-16">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5"
          >
            <p className="text-xs font-display uppercase tracking-[0.25em] text-primary">Intelligent Film Flow & Yield</p>
            <h1 className="text-5xl sm:text-7xl font-display font-bold text-foreground tracking-tight leading-[1.05]">
              From <span className="text-gradient">inception</span><br />to legacy.
            </h1>
            <p className="text-xl text-muted-foreground font-display max-w-md">
              One decision at a time.
            </p>
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.8, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="h-px w-20 bg-primary/60 origin-left"
            />
          </motion.div>
        </div>
      </section>

      <main className="container max-w-3xl py-16 space-y-24">
        {/* What IFFY is */}
        <motion.section {...fadeUp()} className="space-y-6">
          <p className="text-xs font-display uppercase tracking-[0.2em] text-primary">The Platform</p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground tracking-tight">
            Your project deserves better<br />than a spreadsheet.
          </h2>
          <div className="space-y-4 text-lg text-muted-foreground leading-relaxed">
            <p>
              IFFY is a project intelligence system that guides film and TV projects from inception through production to monetisation and beyond — preserving context, ownership, and financial clarity at every stage.
            </p>
            <p>
              It doesn't replace your instincts. <span className="text-foreground font-medium">It gives your instincts better information.</span>
            </p>
          </div>
        </motion.section>

        {/* Capabilities grid */}
        <motion.section {...fadeUp(0.1)} className="space-y-8">
          <div>
            <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-2">Capabilities</p>
            <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">
              Everything a producer needs. Nothing they don't.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {capabilities.map(({ icon: Icon, title, desc }, i) => (
              <motion.div
                key={title}
                {...fadeUp(i * 0.04)}
                className="group glass-card rounded-xl p-5 space-y-3 hover:border-primary/20 transition-colors duration-300"
              >
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display font-bold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Mid-page image break */}
        <motion.div {...fadeUp()} className="relative rounded-2xl overflow-hidden h-[280px]">
          <img src={heroCamera} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/50 to-transparent flex items-center">
            <div className="px-10 space-y-3 max-w-md">
              <h3 className="text-2xl sm:text-3xl font-display font-bold text-foreground">What makes it different</h3>
              <p className="text-muted-foreground leading-relaxed">
                Most tools in film finance are either spreadsheets or pitch decks. IFFY sits between the two — it's a living assessment that evolves with your project.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Who it's for */}
        <motion.section {...fadeUp()} className="space-y-6">
          <p className="text-xs font-display uppercase tracking-[0.2em] text-primary">Built For</p>
          <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">
            The people who make films happen.
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Independent producers, development executives, and financing teams working on international film and television. Whether you're packaging a first feature or structuring a multi-territory co-production — IFFY meets you where you are.
          </p>
        </motion.section>

        {/* CTA */}
        <motion.section {...fadeUp()} className="glass-card rounded-2xl p-10 sm:p-14 text-center space-y-6 border-l-4 border-primary relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
          <div className="relative space-y-4">
            <p className="text-2xl sm:text-3xl font-display font-bold text-foreground">
              From inception to legacy.
            </p>
            <p className="text-lg text-muted-foreground">
              One decision at a time.
            </p>
            <Link to="/dashboard">
              <Button size="lg" className="mt-4 gap-2 text-base px-8">
                Go to Dashboard <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
