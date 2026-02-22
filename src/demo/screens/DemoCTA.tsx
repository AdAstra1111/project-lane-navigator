import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ArrowRight, Handshake } from 'lucide-react';
import { DEMO_CONFIG } from '../demoConfig';
import iffyLogo from '@/assets/iffy-logo-v3.png';

export function DemoCTA() {
  return (
    <div className="flex items-center justify-center h-full px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="text-center space-y-8 max-w-xl"
      >
        <motion.img
          src={iffyLogo}
          alt="IFFY"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 150 }}
          className="h-20 w-20 rounded-2xl mx-auto shadow-[0_0_60px_hsl(38_65%_55%/0.3)]"
        />

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-4xl sm:text-5xl font-display font-bold text-white tracking-tight"
        >
          Development, organised.
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-lg text-white/40 max-w-md mx-auto"
        >
          The standard operating system for story development — so projects move faster,
          decisions get clearer, and packages become effortless.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button
            asChild
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8"
          >
            <a href={DEMO_CONFIG.ctaLinks.joinBeta}>
              Join Beta
              <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="border-white/20 text-white/70 hover:text-white hover:border-white/40 gap-2 px-8"
          >
            <a href={DEMO_CONFIG.ctaLinks.partnerInvest}>
              <Handshake className="h-4 w-4" />
              Partner / Invest
            </a>
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
