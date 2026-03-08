import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { useInView } from '../hooks/useInView';
import {
  Sparkles, FileText, Users, Layers, ScrollText,
  LayoutGrid, DollarSign, Clapperboard, CheckCircle2
} from 'lucide-react';

const steps = [
  { icon: Sparkles, label: 'Idea', text: 'Ideas Become Structured Development', color: 'hsl(38,60%,52%)' },
  { icon: FileText, label: 'Concept Brief', text: 'Ideas Become Structured Development', color: 'hsl(38,60%,52%)' },
  { icon: Users, label: 'Character Bible', text: 'Creative Canon Is Built', color: 'hsl(200,65%,55%)' },
  { icon: Layers, label: 'Story Architecture', text: 'Creative Canon Is Built', color: 'hsl(200,65%,55%)' },
  { icon: ScrollText, label: 'Script', text: 'Scripts Become Production Plans', color: 'hsl(150,55%,50%)' },
  { icon: LayoutGrid, label: 'Storyboards', text: 'Scripts Become Production Plans', color: 'hsl(150,55%,50%)' },
  { icon: DollarSign, label: 'Finance', text: 'Finance And Incentives Align', color: 'hsl(280,55%,60%)' },
  { icon: Clapperboard, label: 'Production', text: 'Finance And Incentives Align', color: 'hsl(280,55%,60%)' },
  { icon: CheckCircle2, label: 'Complete', text: 'One System For Modern Film Development', color: 'hsl(38,60%,52%)' },
];

export function Section2AutoplayWalkthrough() {
  const { ref, inView } = useInView();
  const [activeIdx, setActiveIdx] = useState(-1);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!inView) return;
    setActiveIdx(0);
    intervalRef.current = setInterval(() => {
      setActiveIdx(prev => {
        if (prev >= steps.length - 1) {
          clearInterval(intervalRef.current);
          return prev;
        }
        return prev + 1;
      });
    }, 2500);
    return () => clearInterval(intervalRef.current);
  }, [inView]);

  const currentStep = steps[activeIdx] || steps[0];

  return (
    <section ref={ref} className="relative min-h-screen flex items-center justify-center overflow-hidden px-6 py-24 bg-[hsl(225,20%,4%)]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[180px]" />
      </div>

      <div className="relative z-10 w-full max-w-4xl mx-auto">
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 text-center mb-12"
        >
          Autoplay Walkthrough
        </motion.p>

        {/* Node progression */}
        <div className="flex items-center justify-center flex-wrap gap-2 sm:gap-3 mb-16">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === activeIdx;
            const isPast = i < activeIdx;
            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, scale: 0 }}
                animate={i <= activeIdx ? { opacity: 1, scale: 1 } : { opacity: 0.2, scale: 0.8 }}
                transition={{ duration: 0.5, type: 'spring' }}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className={`h-14 w-14 sm:h-16 sm:w-16 rounded-2xl border flex items-center justify-center transition-all duration-500 ${isActive ? 'shadow-[0_0_40px_var(--glow)]' : ''}`}
                  style={{
                    backgroundColor: isPast || isActive ? `color-mix(in srgb, ${step.color} 15%, transparent)` : 'transparent',
                    borderColor: isActive ? step.color : isPast ? `color-mix(in srgb, ${step.color} 40%, transparent)` : 'hsl(225,10%,20%)',
                    '--glow': `color-mix(in srgb, ${step.color} 30%, transparent)`,
                  } as React.CSSProperties}
                >
                  <Icon className="h-6 w-6" style={{ color: isPast || isActive ? step.color : 'hsl(225,6%,30%)' }} />
                </div>
                <span className={`text-[10px] font-display text-center ${isActive ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                  {step.label}
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Overlay text */}
        <AnimatePresence mode="wait">
          <motion.h2
            key={currentStep.text}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="text-2xl sm:text-4xl font-display font-bold text-foreground text-center tracking-tight"
          >
            {currentStep.text}
          </motion.h2>
        </AnimatePresence>
      </div>
    </section>
  );
}
