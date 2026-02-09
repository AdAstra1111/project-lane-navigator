import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, FolderOpen, RefreshCw, Landmark, Footprints } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.4 },
});

const steps = [
  {
    icon: FolderOpen,
    title: 'Projects are living dossiers',
    body: 'When you create a project in IFFY, it becomes a living dossier — not a static document. Every piece of information you add — script, cast, partners, HODs — updates the overall assessment automatically. You don\'t need to re-run anything. The project evolves as you work on it.',
  },
  {
    icon: RefreshCw,
    title: 'Decisions update assessments automatically',
    body: 'Attach a marquee director? Your readiness score changes. Confirm a co-production partner? The finance picture shifts. IFFY watches what matters — packaging, finance fit, and market timing — and reflects it in real time. No manual recalculation.',
  },
  {
    icon: Landmark,
    title: 'Finance, incentives, and co-productions are integrated',
    body: 'Incentive programmes, co-production treaties, and capital stack scenarios aren\'t separate tools. They\'re part of the same assessment. IFFY evaluates them in the context of your specific project — its budget, its genre, its territory mix — so you see what\'s actually relevant.',
  },
  {
    icon: Footprints,
    title: 'Readiness is built step by step',
    body: 'There\'s no "submit and wait" in IFFY. Readiness is built one decision at a time. The system always shows you the best next step — the single action most likely to move your project closer to finance-ready. Follow it, and the score moves. It\'s that simple.',
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl py-16 space-y-12">
        <motion.div {...fadeUp()} className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground tracking-tight">
            How IFFY Works
          </h1>
          <p className="text-muted-foreground text-lg">
            The mental model is simple: your project is a living dossier. Every decision you make updates its finance readiness.
          </p>
        </motion.div>

        <div className="space-y-6">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              {...fadeUp(0.1 + i * 0.08)}
              className="glass-card rounded-xl p-6 space-y-3"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-primary font-medium font-display uppercase tracking-wider">Step {i + 1}</span>
                </div>
              </div>
              <h2 className="text-xl font-display font-semibold text-foreground">{step.title}</h2>
              <p className="text-muted-foreground leading-relaxed">{step.body}</p>
            </motion.div>
          ))}
        </div>

        <motion.div {...fadeUp(0.5)} className="text-center pt-4">
          <Link to="/dashboard">
            <Button>
              Start building <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
