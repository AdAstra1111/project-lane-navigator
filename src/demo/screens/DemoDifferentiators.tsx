import { motion } from 'framer-motion';
import { Shield, FileCheck, GitBranch } from 'lucide-react';

const points = [
  {
    icon: Shield,
    title: 'Not a chatbot. An OS.',
    body: 'IFFY doesn\'t just generate text. It manages development as a living, versioned project.',
  },
  {
    icon: FileCheck,
    title: 'Approvals that stick.',
    body: 'Versions are immutable. Approvals are meaningful. History is never overwritten.',
  },
  {
    icon: GitBranch,
    title: 'Canon that holds.',
    body: 'Episodic and longform stay coherent as you iterate. Canon-risk changes are flagged before they break continuity.',
  },
];

export function DemoDifferentiators() {
  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-3xl space-y-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl sm:text-4xl font-display font-bold text-white text-center tracking-tight"
        >
          Why it's different
        </motion.h2>

        <div className="space-y-4">
          {points.map((point, i) => (
            <motion.div
              key={point.title}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.2 }}
              className="flex items-start gap-4 p-5 rounded-xl border border-white/10 bg-white/[0.03]"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <point.icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-display font-semibold text-white">{point.title}</h3>
                <p className="text-sm text-white/40 mt-1">{point.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
