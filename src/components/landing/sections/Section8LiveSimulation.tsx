import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Button } from '@/components/ui/button';
import { Play, RotateCcw, Sparkles, FileText, ScrollText, Calculator, Clapperboard, CheckCircle2 } from 'lucide-react';

const simSteps = [
  { icon: Sparkles, label: 'Idea', description: 'Concept validated and positioned' },
  { icon: FileText, label: 'Concept', description: 'Brief generated with market fit' },
  { icon: ScrollText, label: 'Script', description: 'Screenplay ingested and analysed' },
  { icon: Calculator, label: 'Budget', description: 'Finance structure modelled' },
  { icon: Clapperboard, label: 'Production', description: 'Production plan assembled' },
];

export function Section8LiveSimulation() {
  const [running, setRunning] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [complete, setComplete] = useState(false);

  const runDemo = useCallback(() => {
    setRunning(true);
    setComplete(false);
    setActiveIdx(0);
    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      if (idx >= simSteps.length) {
        clearInterval(interval);
        setComplete(true);
        setRunning(false);
        return;
      }
      setActiveIdx(idx);
    }, 1500);
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setActiveIdx(-1);
    setComplete(false);
  }, []);

  return (
    <SectionShell id="live-simulation" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-12">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Interactive Demo</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          See It In Action
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          Watch a project move through the full IFFY pipeline in seconds.
        </p>
      </div>

      {/* Simulation visualization */}
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-2 mb-12">
          {simSteps.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === activeIdx;
            const isPast = i < activeIdx;
            const isDone = complete;
            return (
              <div key={step.label} className="flex items-center gap-2 flex-1">
                <motion.div
                  animate={{
                    scale: isActive ? 1.1 : 1,
                    borderColor: isPast || isDone ? 'hsl(150,55%,50%)' : isActive ? 'hsl(38,60%,52%)' : 'hsl(225,10%,20%)',
                  }}
                  className="flex flex-col items-center gap-2"
                >
                  <div
                    className={`h-14 w-14 rounded-2xl border-2 flex items-center justify-center transition-all duration-500 ${isPast || isDone ? 'bg-[hsl(150,55%,50%,0.1)]' : isActive ? 'bg-primary/10 shadow-[0_0_30px_hsl(38_60%_52%/0.2)]' : 'bg-transparent'}`}
                  >
                    {isPast || isDone ? (
                      <CheckCircle2 className="h-6 w-6 text-[hsl(150,55%,50%)]" />
                    ) : (
                      <Icon className={`h-6 w-6 ${isActive ? 'text-primary' : 'text-muted-foreground/30'}`} />
                    )}
                  </div>
                  <span className={`text-[10px] font-display text-center ${isActive ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                    {step.label}
                  </span>
                </motion.div>
                {i < simSteps.length - 1 && (
                  <div className="flex-1 h-px bg-muted/20 mx-1">
                    <motion.div
                      className="h-full bg-primary/40"
                      initial={{ width: 0 }}
                      animate={{ width: isPast ? '100%' : '0%' }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Status text */}
        <AnimatePresence mode="wait">
          {activeIdx >= 0 && (
            <motion.p
              key={activeIdx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center text-sm text-muted-foreground mb-8"
            >
              {complete ? '✓ Project is production-ready' : simSteps[activeIdx]?.description}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div className="flex justify-center gap-3">
          {!running && !complete && (
            <Button onClick={runDemo} size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
              <Play className="h-4 w-4" />
              Run Demo Project
            </Button>
          )}
          {complete && (
            <Button onClick={reset} variant="outline" size="lg" className="border-primary/20 text-foreground hover:bg-primary/5 gap-2">
              <RotateCcw className="h-4 w-4" />
              Run Again
            </Button>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
