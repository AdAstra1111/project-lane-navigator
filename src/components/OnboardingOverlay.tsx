import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Landmark, Target, Footprints, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ONBOARDING_KEY = 'iffy-onboarding-seen';

const steps = [
  {
    icon: FolderOpen,
    title: 'From inception to legacy.',
    body: 'IFFY — Intelligent Film Flow & Yield — guides your project from first idea through production to monetisation.',
  },
  {
    icon: Landmark,
    title: 'Finance is built in.',
    body: 'Incentives, co-productions, and capital stacks are evaluated automatically based on your project details.',
  },
  {
    icon: Target,
    title: 'Every decision matters.',
    body: 'Each change moves your project closer to — or further from — finance-ready. Context and ownership are preserved at every stage.',
  },
  {
    icon: Footprints,
    title: 'One decision at a time.',
    body: 'IFFY always shows you the best next step. Follow it, and the score moves.',
  },
];

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(ONBOARDING_KEY, 'true');
  };

  const next = () => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      dismiss();
    }
  };

  if (!visible) return null;

  const current = steps[step];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      >
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="glass-card rounded-2xl p-8 max-w-md w-full mx-4 space-y-5 border border-border/50 relative"
        >
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>

          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <current.icon className="h-6 w-6 text-primary" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-display font-bold text-foreground">{current.title}</h2>
            <p className="text-muted-foreground leading-relaxed">{current.body}</p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Skip
            </button>
            <Button onClick={next} size="sm">
              {step < steps.length - 1 ? (
                <>Next <ArrowRight className="h-3.5 w-3.5 ml-1" /></>
              ) : (
                'Get started'
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
