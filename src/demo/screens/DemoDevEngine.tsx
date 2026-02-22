import { motion } from 'framer-motion';
import { CheckCircle2, Circle, ArrowRight, Sparkles } from 'lucide-react';
import { DEV_ENGINE_STEPS, DEMO_CONFIG } from '../demoConfig';

const statusColors = {
  converged: { icon: CheckCircle2, color: 'text-primary', bg: 'bg-primary/10 border-primary/20' },
  active: { icon: Sparkles, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20' },
  pending: { icon: Circle, color: 'text-white/20', bg: 'bg-white/5 border-white/10' },
};

export function DemoDevEngine() {
  const activeStep = DEV_ENGINE_STEPS.find(s => s.status === 'active');

  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Pipeline steps */}
        <div className="lg:col-span-2 space-y-4">
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs font-display uppercase tracking-[0.2em] text-primary/70"
          >
            Development Pipeline
          </motion.h3>
          <div className="space-y-1.5">
            {DEV_ENGINE_STEPS.map((step, i) => {
              const cfg = statusColors[step.status];
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.08 }}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border ${cfg.bg} ${
                    step.status === 'active' ? 'ring-1 ring-amber-400/20' : ''
                  }`}
                >
                  <Icon className={`h-4 w-4 ${cfg.color} shrink-0`} />
                  <span className={`text-sm ${
                    step.status === 'pending' ? 'text-white/30' :
                    step.status === 'active' ? 'text-white font-medium' :
                    'text-white/70'
                  }`}>
                    {step.label}
                  </span>
                  {step.status === 'converged' && (
                    <span className="text-[9px] text-primary/60 ml-auto">converged</span>
                  )}
                  {step.status === 'active' && (
                    <span className="text-[9px] text-amber-400/70 ml-auto animate-pulse">in progress</span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Right: Active step detail */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-3 space-y-4"
        >
          <h3 className="text-xs font-display uppercase tracking-[0.2em] text-primary/70">
            Next Step
          </h3>
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-400" />
              <h4 className="text-lg font-display font-semibold text-white">{activeStep?.label}</h4>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">
              The screenplay is the current focus. IFFY has analysed the brief, market positioning,
              format rules, and character bible to provide context-aware guidance for the next draft.
            </p>
            <div className="flex items-center gap-2 text-xs text-white/30">
              <ArrowRight className="h-3.5 w-3.5" />
              <span>After screenplay converges → Notes & Review</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
            <h4 className="text-sm font-display font-medium text-white/70">Project Context</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-0.5">
                <span className="text-white/30">Project</span>
                <p className="text-white/70 font-medium">{DEMO_CONFIG.projectName}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-white/30">Format</span>
                <p className="text-white/70 font-medium">Narrative Feature</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-white/30">Lane</span>
                <p className="text-white/70 font-medium">Prestige</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-white/30">Converged</span>
                <p className="text-primary font-medium">5 / 8 stages</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
