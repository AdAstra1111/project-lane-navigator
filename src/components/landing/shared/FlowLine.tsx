import { motion } from 'framer-motion';

interface Props {
  delay?: number;
  vertical?: boolean;
}

export function FlowLine({ delay = 0, vertical = false }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: vertical ? 1 : 0, scaleY: vertical ? 0 : 1 }}
      animate={{ opacity: 0.4, scaleX: 1, scaleY: 1 }}
      transition={{ delay, duration: 0.6, ease: 'easeOut' }}
      className={`${vertical ? 'w-px h-8' : 'h-px w-8'} bg-gradient-to-r from-transparent via-primary/50 to-transparent shrink-0`}
      style={{ transformOrigin: vertical ? 'top' : 'left' }}
    />
  );
}
