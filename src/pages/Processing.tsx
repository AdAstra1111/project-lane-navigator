import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

const STEPS = [
  { label: 'Classifying format', delay: 1.2 },
  { label: 'Analysing structure', delay: 3.5 },
  { label: 'Evaluating market position', delay: 6.0 },
  { label: 'Estimating budget tier', delay: 8.5 },
  { label: 'Assessing commercial potential', delay: 11.5 },
  { label: 'Generating strategic summary', delay: 15.0 },
];

const Processing = () => {
  const [completed, setCompleted] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timers = STEPS.map((step, i) =>
      setTimeout(() => {
        setCompleted(prev => [...prev, i]);
        setActiveIndex(i + 1);
      }, step.delay * 1000)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const allDone = completed.length === STEPS.length;

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center px-6">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute top-1/4 left-1/3 w-[600px] h-[600px] rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)' }}
          animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0], scale: [1, 1.08, 0.95, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/3 w-[500px] h-[500px] rounded-full opacity-[0.025]"
          style={{ background: 'radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)' }}
          animate={{ x: [0, -30, 25, 0], y: [0, 25, -35, 0], scale: [1, 0.94, 1.06, 1] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md flex flex-col items-center text-center"
      >
        {/* Wordmark */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50 mb-12"
        >
          IFFY
        </motion.span>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-foreground leading-[1.15] mb-14"
        >
          Analysing your project…
        </motion.h1>

        {/* Steps checklist */}
        <div className="w-full max-w-xs space-y-5">
          {STEPS.map((step, i) => {
            const isDone = completed.includes(i);
            const isActive = activeIndex === i && !isDone;

            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.4 }}
                className="flex items-center gap-3"
              >
                {/* Circle / check */}
                <div className="relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
                  <AnimatePresence mode="wait">
                    {isDone ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                      >
                        <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                      </motion.div>
                    ) : isActive ? (
                      <motion.div
                        key="pulse"
                        className="w-5 h-5 rounded-full border-2 border-primary/40"
                        animate={{ scale: [1, 1.15, 1], borderColor: ['hsl(var(--primary) / 0.4)', 'hsl(var(--primary) / 0.7)', 'hsl(var(--primary) / 0.4)'] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    ) : (
                      <motion.div
                        key="empty"
                        className="w-5 h-5 rounded-full border border-border/60"
                      />
                    )}
                  </AnimatePresence>
                </div>

                {/* Label */}
                <span
                  className={`text-sm transition-colors duration-500 ${
                    isDone
                      ? 'text-foreground font-medium'
                      : isActive
                        ? 'text-foreground/70'
                        : 'text-muted-foreground/50'
                  }`}
                >
                  {step.label}
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Completion message */}
        <AnimatePresence>
          {allDone && (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="mt-12 text-sm text-muted-foreground/60"
            >
              Preparing your results…
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default Processing;
