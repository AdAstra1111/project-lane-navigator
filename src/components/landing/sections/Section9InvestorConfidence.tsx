import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Layers, Target, Building2, Zap, Sparkles } from 'lucide-react';

const points = [
  { icon: Layers, text: 'IFFY structures story development into a deterministic, auditable pipeline.' },
  { icon: Target, text: 'IFFY aligns creative and financial planning so every decision has commercial context.' },
  { icon: Building2, text: 'IFFY enables scalable studio operations across multiple simultaneous productions.' },
  { icon: Zap, text: 'IFFY prepares projects for production faster through guided, systematic development.' },
  { icon: Sparkles, text: 'IFFY supports the future of AI-native filmmaking with structured narrative data.' },
];

export function Section9InvestorConfidence() {
  return (
    <SectionShell id="investor-confidence" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-16">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Why It Matters</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          The IFFY Advantage
        </h2>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {points.map((point, i) => {
          const Icon = point.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="flex items-start gap-4 p-4 rounded-xl"
            >
              <div className="h-10 w-10 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <p className="text-base text-foreground/80 leading-relaxed">{point.text}</p>
            </motion.div>
          );
        })}
      </div>
    </SectionShell>
  );
}
