import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useInView } from '../hooks/useInView';

interface Props {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function SectionShell({ children, className = '', id }: Props) {
  const { ref, inView } = useInView();

  return (
    <section
      ref={ref}
      id={id}
      className={`relative min-h-screen flex items-center justify-center overflow-hidden px-6 py-24 ${className}`}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/5 blur-[200px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        style={{ willChange: 'opacity, transform' }}
        className="relative z-10 w-full max-w-7xl mx-auto"
      >
        {children}
      </motion.div>
    </section>
  );
}
