import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Sparkles, FileText, Users, DollarSign, Clapperboard, BarChart3, Lock } from 'lucide-react';

const nodes = [
  { label: 'Story Structure', icon: FileText,    delay: 0.9  },
  { label: 'Character Arc',   icon: Users,        delay: 1.1  },
  { label: 'Market Fit',      icon: BarChart3,    delay: 1.3  },
  { label: 'Budget Model',    icon: DollarSign,   delay: 1.5  },
  { label: 'Production Plan', icon: Clapperboard, delay: 1.7  },
  { label: 'Canon Lock',      icon: Lock,         delay: 1.9  },
];

export function Section1CinematicIntro() {
  return (
    <SectionShell id="cinematic-intro" className="bg-[hsl(225,20%,4%)]">
      <div className="flex flex-col items-center text-center gap-8">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-xs font-display uppercase tracking-[0.3em] text-primary/60"
        >
          How It Works
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="font-display font-bold text-foreground tracking-tight leading-[1.05]"
          style={{ fontSize: 'clamp(2rem, 8vw, 4.5rem)' }}
        >
          One Idea.
          <br />
          <span className="text-primary">Every Document.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-lg text-muted-foreground max-w-xl leading-relaxed"
        >
          IFFY builds every document your project needs — from concept brief to season scripts — in a single connected pipeline.
        </motion.p>

        {/* Central idea node */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.6, type: 'spring', stiffness: 120 }}
          className="flex flex-col items-center gap-2"
        >
          <div className="h-20 w-20 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center shadow-[0_0_60px_hsl(38_60%_52%/0.3)]">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <p className="text-xs font-display font-semibold text-primary">Idea</p>
        </motion.div>

        {/* Connector */}
        <motion.div
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 0.25 }}
          transition={{ delay: 0.85 }}
          className="w-px h-6 bg-primary origin-top -mt-4"
        />

        {/* Output nodes — 3-col grid, always */}
        <div className="grid gap-3 w-full max-w-sm -mt-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {nodes.map((node) => {
            const Icon = node.icon;
            return (
              <motion.div
                key={node.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: node.delay, type: 'spring', stiffness: 100 }}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-primary/15 bg-primary/5 px-2 py-3"
              >
                <Icon className="h-4 w-4 text-primary/60" />
                <p className="text-[10px] font-display text-muted-foreground leading-tight text-center">{node.label}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </SectionShell>
  );
}
