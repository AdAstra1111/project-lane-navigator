import { motion } from 'framer-motion';
import { Upload, Cog, FileText, Shield, Package, ArrowRight } from 'lucide-react';

const stages = [
  { icon: Upload, label: 'Ingest', color: 'hsl(38, 65%, 55%)' },
  { icon: Cog, label: 'Dev Engine', color: 'hsl(200, 65%, 55%)' },
  { icon: FileText, label: 'Notes & Canon', color: 'hsl(150, 55%, 50%)' },
  { icon: Package, label: 'Packaging', color: 'hsl(280, 55%, 60%)' },
  { icon: Shield, label: 'Export', color: 'hsl(350, 60%, 55%)' },
];

export function DemoSuiteMap() {
  return (
    <div className="flex items-center justify-center h-full px-8">
      <div className="space-y-12 w-full max-w-4xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl sm:text-4xl font-display font-bold text-white text-center tracking-tight"
        >
          The IFFY Pipeline
        </motion.h2>

        <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
          {stages.map((stage, i) => (
            <motion.div
              key={stage.label}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.3, duration: 0.5 }}
              className="flex items-center gap-2 sm:gap-4"
            >
              <div className="flex flex-col items-center gap-2">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.5 + i * 0.3, type: 'spring', stiffness: 200 }}
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl border border-white/10 flex items-center justify-center backdrop-blur-sm"
                  style={{ backgroundColor: `${stage.color}15`, borderColor: `${stage.color}40` }}
                >
                  <stage.icon className="h-7 w-7 sm:h-8 sm:w-8" style={{ color: stage.color }} />
                </motion.div>
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 + i * 0.3 }}
                  className="text-xs sm:text-sm font-display font-medium text-white/70 text-center"
                >
                  {stage.label}
                </motion.span>
              </div>
              {i < stages.length - 1 && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 0.4, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.3 }}
                >
                  <ArrowRight className="h-4 w-4 text-white/30 shrink-0" />
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
