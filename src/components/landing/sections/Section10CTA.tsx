import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Button } from '@/components/ui/button';
import { ArrowRight, Handshake, Clapperboard } from 'lucide-react';
import { DEMO_CONFIG } from '@/demo/demoConfig';

export function Section10CTA() {
  return (
    <SectionShell id="cta" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center max-w-2xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl sm:text-6xl font-display font-bold text-foreground tracking-tight mb-6"
        >
          Build Your Next Project
          <br />
          <span className="text-primary">With IFFY</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="text-lg text-muted-foreground mb-12"
        >
          The cinematic operating system for modern film and television production.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8">
            <a href="/auth">
              <Clapperboard className="h-4 w-4" />
              Start a Project
            </a>
          </Button>
          <Button asChild variant="outline" size="lg" className="border-border/30 text-foreground hover:bg-primary/5 gap-2 px-8">
            <a href="/demo">
              <ArrowRight className="h-4 w-4" />
              Request Demo
            </a>
          </Button>
          <Button asChild variant="outline" size="lg" className="border-border/30 text-foreground hover:bg-primary/5 gap-2 px-8">
            <a href={DEMO_CONFIG.ctaLinks.partnerInvest}>
              <Handshake className="h-4 w-4" />
              For Investors
            </a>
          </Button>
        </motion.div>
      </div>
    </SectionShell>
  );
}
