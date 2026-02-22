import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

const problemIcons: Record<string, string> = {
  'Version chaos': '📁',
  'Note chaos': '📝',
  'Canon drift': '🔀',
  'Packaging scramble': '📦',
  'A development operating system': '⚡',
};

interface Props {
  overlayText: string;
}

export function DemoColdOpen({ overlayText }: Props) {
  const isPromise = overlayText.includes('operating system');

  return (
    <div className="flex items-center justify-center h-full">
      <motion.div
        key={overlayText}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.6 }}
        className="text-center space-y-6 max-w-2xl px-8"
      >
        {!isPromise && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="mx-auto h-20 w-20 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center"
          >
            <AlertTriangle className="h-10 w-10 text-destructive" />
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="space-y-2"
        >
          <span className="text-4xl">
            {problemIcons[overlayText] || ''}
          </span>
          <h2 className={`text-4xl sm:text-6xl font-display font-bold tracking-tight ${
            isPromise ? 'text-primary' : 'text-white'
          }`}>
            {overlayText}
          </h2>
          {isPromise && (
            <p className="text-lg text-white/40 mt-4">
              From documents → decisions → package
            </p>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
