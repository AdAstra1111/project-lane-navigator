import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import {
  ScrollText, Layers, Users, LayoutGrid, Clapperboard,
  Film, Sparkles, ArrowRight
} from 'lucide-react';

const aiSteps = [
  { icon: ScrollText, label: 'Script' },
  { icon: Layers, label: 'Narrative Units' },
  { icon: Users, label: 'AI Casting' },
  { icon: LayoutGrid, label: 'AI Storyboards' },
  { icon: Clapperboard, label: 'AI Shot Gen' },
  { icon: Film, label: 'AI Animation' },
  { icon: Sparkles, label: 'Final Film' },
];

export function Section7AIPipeline() {
  return (
    <SectionShell id="ai-pipeline" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 mb-6">
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="text-xs font-display font-medium text-primary">Future Capability</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          AI-Native Production
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          Stories developed in IFFY will soon move directly into AI production — from script to screen.
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap max-w-4xl mx-auto">
        {aiSteps.map((step, i) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="flex items-center gap-2 sm:gap-4"
            >
              <div className="flex flex-col items-center gap-2">
                <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl border border-primary/15 bg-primary/5 flex items-center justify-center backdrop-blur-sm">
                  <Icon className="h-6 w-6 text-primary/60" />
                </div>
                <span className="text-[10px] sm:text-xs font-display font-medium text-muted-foreground text-center">{step.label}</span>
              </div>
              {i < aiSteps.length - 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 0.3 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 + 0.1 }}
                >
                  <ArrowRight className="h-3 w-3 text-primary/30 shrink-0" />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
    </SectionShell>
  );
}
