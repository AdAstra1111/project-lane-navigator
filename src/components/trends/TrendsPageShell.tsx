import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/Header';

interface TrendsPageShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  rightSlot?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}

export function TrendsPageShell({ title, subtitle, badge, rightSlot, controls, children }: TrendsPageShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-6xl pt-6 pb-10 px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 min-h-0">
            <div className="min-w-0">
              {badge && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{badge}</span>
              )}
              <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground tracking-tight leading-tight">{title}</h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>
              )}
            </div>
            {rightSlot && (
              <div className="shrink-0 flex items-center gap-2">{rightSlot}</div>
            )}
          </div>

          {/* Controls */}
          {controls}

          {/* Content */}
          {children}
        </motion.div>
      </main>
    </div>
  );
}
