import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Sparkles } from 'lucide-react';

const networkNodes = [
  { label: 'Story Structure', x: -180, y: -80,  delay: 1.2 },
  { label: 'Character Arc',   x:  140, y: -100, delay: 1.5 },
  { label: 'Market Fit',      x: -120, y:  80,  delay: 1.8 },
  { label: 'Budget Model',    x:  200, y:  60,  delay: 2.1 },
  { label: 'Production Plan', x:  -40, y:  140, delay: 2.4 },
  { label: 'Canon Lock',      x:  100, y:  120, delay: 2.7 },
];

export function Section1CinematicIntro() {
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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
          How It Works
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="font-display text-4xl font-bold text-foreground tracking-tight leading-[1.05]"
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

        {/* ── Mobile: center node + 2-col grid ── */}
        {isMobile ? (
          <div className="flex flex-col items-center gap-5 mt-2 w-full">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.6, type: 'spring', stiffness: 120 }}
              className="flex flex-col items-center"
            >
              <div className="h-16 w-16 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center shadow-[0_0_40px_hsl(38_60%_52%/0.3)]">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <p className="text-xs font-display font-semibold text-primary mt-2">Idea</p>
            </motion.div>

            <motion.div
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 0.3 }}
              transition={{ delay: 1.0 }}
              className="w-px h-5 bg-primary origin-top"
            />

            <div className="grid grid-cols-2 gap-2.5 w-full max-w-xs">
              {networkNodes.map((node) => (
                <motion.div
                  key={node.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: node.delay, type: 'spring', stiffness: 100 }}
                  className="flex items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 flex-shrink-0" />
                  <p className="text-[11px] font-display text-muted-foreground leading-tight">{node.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          /* ── Desktop: radial diagram ── */
          <div ref={containerRef} className="relative w-full max-w-lg h-[320px] mt-8">
            {/* Central node */}
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
        )}
      </div>
    </SectionShell>
  );
}
