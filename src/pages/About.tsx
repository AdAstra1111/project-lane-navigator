import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Target, Layers, TrendingUp, Shield, DollarSign, Users, Sparkles, GitBranch, UserPlus, FileOutput } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.4 },
});

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl py-16 space-y-16">
        {/* Hero */}
        <motion.section {...fadeUp()} className="text-center space-y-4">
          <p className="text-xs font-display uppercase tracking-[0.2em] text-primary">Intelligent Film Flow & Yield</p>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-foreground tracking-tight leading-tight">
            From <span className="text-gradient">inception</span> to recoup.
          </h1>
          <p className="text-xl text-muted-foreground font-display">
            One decision at a time.
          </p>
        </motion.section>

        {/* What IFFY is */}
        <motion.section {...fadeUp(0.1)} className="space-y-4">
          <h2 className="text-2xl font-display font-semibold text-foreground">What IFFY is</h2>
          <p className="text-muted-foreground leading-relaxed">
            IFFY is a project intelligence system that guides film and TV projects from inception through production to monetisation and recoup — preserving context, ownership, and financial clarity at every stage.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            It doesn't replace your instincts. It gives your instincts better information.
          </p>
        </motion.section>

        {/* How it works */}
        <motion.section {...fadeUp(0.15)} className="space-y-6">
          <h2 className="text-2xl font-display font-semibold text-foreground">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: Layers, title: 'Living dossiers', desc: 'Every project is a living document. As you attach cast, partners, scripts, and HODs, the assessment updates automatically.' },
              { icon: Target, title: 'Decision-support', desc: 'IFFY surfaces the best next step — not a to-do list. One decision at a time, moving you closer to finance-ready.' },
              { icon: TrendingUp, title: 'Market intelligence', desc: 'Trend signals, cast momentum, and genre cycles are tracked continuously and matched to your specific project.' },
              { icon: Shield, title: 'Finance integration', desc: 'Incentives, co-production treaties, and capital stacks are evaluated in context — not in isolation.' },
              { icon: DollarSign, title: 'Finance Tracker', desc: 'Build your capital stack deal by deal across six categories — Sales, Equity, Incentives, Soft Money, Gap & Debt — with real-time waterfall visualisation.' },
              { icon: Users, title: 'Buyer matching & CRM', desc: 'Scored buyer matches based on genre, budget, territory, and tone — plus a CRM to track meetings, appetite, and follow-ups.' },
              { icon: Sparkles, title: 'Smart Packaging', desc: 'AI-driven talent recommendations based on budget, genre, lane, and market trends. Click any name for trajectory analysis and IMDb links.' },
              { icon: GitBranch, title: 'Pipeline & stage gates', desc: 'A Kanban view across Development, Packaging, Financing, and Pre-Production — with automated gates ensuring readiness before advancement.' },
              { icon: UserPlus, title: 'Collaboration', desc: 'Role-based access for Producers, Sales Agents, Lawyers, and Creatives. Threaded, section-filtered comments keep discussions in context.' },
              { icon: FileOutput, title: 'Export & compare', desc: 'Generate a professional PDF One-Pager or clone projects to compare variants side-by-side across readiness scores and market positioning.' },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className="glass-card rounded-xl p-5 space-y-2">
                <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* What makes it different */}
        <motion.section {...fadeUp(0.2)} className="space-y-4">
          <h2 className="text-2xl font-display font-semibold text-foreground">What makes it different</h2>
          <p className="text-muted-foreground leading-relaxed">
            Most tools in film finance are either spreadsheets or pitch decks. IFFY sits between the two — it's a living assessment that evolves with your project.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            It doesn't judge your creative. It evaluates your execution path: Is the packaging moving? Are the finance elements aligned? What's the fastest way to close the gap?
          </p>
        </motion.section>

        {/* Who it's for */}
        <motion.section {...fadeUp(0.25)} className="space-y-4">
          <h2 className="text-2xl font-display font-semibold text-foreground">Who it's for</h2>
          <p className="text-muted-foreground leading-relaxed">
            Independent producers, development executives, and financing teams working on international film and television. Whether you're packaging a first feature or structuring a multi-territory co-production.
          </p>
        </motion.section>

        {/* The promise */}
        <motion.section {...fadeUp(0.3)} className="glass-card rounded-xl p-8 text-center space-y-4 border-l-4 border-primary">
          <p className="text-lg font-display font-semibold text-foreground">
            From inception to recoup.
          </p>
          <p className="text-muted-foreground">
            One decision at a time.
          </p>
          <Link to="/dashboard">
            <Button className="mt-2">
              Go to Dashboard <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </Link>
        </motion.section>
      </main>
    </div>
  );
}
