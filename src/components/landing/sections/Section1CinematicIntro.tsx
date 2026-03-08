import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Sparkles } from 'lucide-react';

const networkNodes = [
  { label: 'Story Structure', x: -180, y: -80, delay: 1.2 },
  { label: 'Character Arc', x: 140, y: -100, delay: 1.5 },
  { label: 'Market Fit', x: -120, y: 80, delay: 1.8 },
  { label: 'Budget Model', x: 200, y: 60, delay: 2.1 },
  { label: 'Production Plan', x: -40, y: 140, delay: 2.4 },
  { label: 'Canon Lock', x: 100, y: 120, delay: 2.7 },
];

export function Section1CinematicIntro() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setExpanded(true), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <SectionShell id="cinematic-intro" className="bg-[hsl(225,20%,4%)]">
      <div className="flex flex-col items-center text-center gap-8">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-xs font-display uppercase tracking-[0.3em] text-primary/60"
        >
          Introducing
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="font-display text-4xl sm:text-6xl lg:text-7xl font-bold text-foreground tracking-tight leading-[1.05]"
        >
          The Future of
          <br />
          <span className="text-primary">Film Development</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-lg text-muted-foreground max-w-xl leading-relaxed"
        >
          IFFY transforms ideas into production-ready projects through a deterministic cinematic pipeline.
        </motion.p>

        {/* Animated network visualization */}
        <div className="relative w-full max-w-lg h-[320px] mt-8">
          {/* Central "Idea" node */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.6, type: 'spring', stiffness: 120 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
          >
            <div className="h-20 w-20 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center shadow-[0_0_60px_hsl(38_60%_52%/0.3)]">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <p className="text-xs font-display font-semibold text-primary text-center mt-2">Idea</p>
          </motion.div>

          {/* Expanding network nodes */}
          {expanded && networkNodes.map((node) => (
            <motion.div
              key={node.label}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: node.delay, type: 'spring', stiffness: 100 }}
              className="absolute top-1/2 left-1/2 z-10"
              style={{ transform: `translate(calc(-50% + ${node.x}px), calc(-50% + ${node.y}px))` }}
            >
              <div className="h-12 w-12 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center backdrop-blur-sm">
                <div className="h-2 w-2 rounded-full bg-primary/60" />
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-1 whitespace-nowrap">{node.label}</p>
            </motion.div>
          ))}

          {/* Connection lines */}
          {expanded && networkNodes.map((node) => (
            <motion.svg
              key={`line-${node.label}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.15 }}
              transition={{ delay: node.delay + 0.2 }}
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              <line
                x1="50%" y1="50%"
                x2={`calc(50% + ${node.x}px)`} y2={`calc(50% + ${node.y}px)`}
                stroke="hsl(38, 60%, 52%)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            </motion.svg>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
