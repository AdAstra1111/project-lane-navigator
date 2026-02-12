import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ToggleLeft, Plus, ArrowRight, X, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIMode } from '@/hooks/useUIMode';
import { MODES } from '@/lib/mode';
import iffyLogo from '@/assets/iffy-logo-v3.png';

const ONBOARDING_KEY = 'iffy-onboarding-v2-seen';

interface Step {
  icon: typeof Sparkles;
  title: string;
  body: string;
}

const steps: Step[] = [
  {
    icon: Sparkles,
    title: 'Welcome to IFFY',
    body: 'Your project intelligence system — from inception to legacy. IFFY guides film and TV projects through six lifecycle stages with per-stage readiness scoring, finance tracking, and market intelligence.',
  },
  {
    icon: ToggleLeft,
    title: 'Choose your mode',
    body: 'Simple shows core metrics: viability, lane, readiness, and next actions. Advanced unlocks deep finance modelling, trend engines, stage gates, and technical language. You can switch anytime.',
  },
  {
    icon: Plus,
    title: 'Create your first project',
    body: 'Click "New Project" to build a living dossier. Add a title, format, genre, and budget — IFFY immediately classifies it, scores it, and shows your best next step.',
  },
];

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const { mode, setMode } = useUIMode();
  const navigate = useNavigate();

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(ONBOARDING_KEY, 'true');
  }, []);

  const next = () => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      dismiss();
      navigate('/projects/new');
    }
  };

  if (!visible) return null;

  const current = steps[step];
  const isModePicker = step === 1;
  const isFinal = step === steps.length - 1;

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
          className="glass-card rounded-2xl p-8 max-w-md w-full mx-4 space-y-6 border border-border/50 relative"
        >
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Progress */}
          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>

          {/* Icon */}
          {step === 0 ? (
            <img src={iffyLogo} alt="IFFY" className="h-14 w-14 rounded-xl" />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <current.icon className="h-6 w-6 text-primary" />
            </div>
          )}

          {/* Content */}
          <div className="space-y-2">
            <h2 className="text-xl font-display font-bold text-foreground">{current.title}</h2>
            <p className="text-muted-foreground leading-relaxed text-sm">{current.body}</p>
          </div>

          {/* Mode Picker (step 2) */}
          {isModePicker && (
            <div className="flex gap-3 pt-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium border transition-all ${
                    mode === m.value
                      ? 'bg-primary text-primary-foreground border-primary shadow-md'
                      : 'bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2">
            <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Skip
            </button>
            <Button onClick={next} size="sm">
              {isFinal ? (
                <>Create project <ArrowRight className="h-3.5 w-3.5 ml-1" /></>
              ) : (
                <>Next <ChevronRight className="h-3.5 w-3.5 ml-1" /></>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
