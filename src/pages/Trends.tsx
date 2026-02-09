import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Radio, BookOpen, Users } from 'lucide-react';
import { Header } from '@/components/Header';
import { useSignalCount } from '@/hooks/useTrends';

export default function Trends() {
  const { data: signalCount = 0 } = useSignalCount();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          {/* Page Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Intelligence Layer</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Trends</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Emerging narrative, IP, market behaviour, and talent signals across the entertainment industry.
            </p>
          </div>

          {/* Navigation Cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Link to="/trends/story">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.25 }}
                className="glass-card rounded-xl p-6 hover:border-primary/40 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display font-semibold text-foreground text-lg group-hover:text-primary transition-colors">
                    Story Trends
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Narrative, genre, tone, and market signals detected across independent industry sources.
                </p>
                {signalCount > 0 && (
                  <p className="text-xs text-primary mt-3 font-medium">
                    {signalCount} active signal{signalCount !== 1 ? 's' : ''}
                  </p>
                )}
              </motion.div>
            </Link>

            <Link to="/trends/cast">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.25 }}
                className="glass-card rounded-xl p-6 hover:border-primary/40 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display font-semibold text-foreground text-lg group-hover:text-primary transition-colors">
                    Cast Trends
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Emerging and rising talent identified through casting momentum, breakout performances, and audience traction.
                </p>
              </motion.div>
            </Link>
          </div>

          {/* Methodology note */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Signals require confirmation across ≥3 independent sources. Project analysis references trends data without embedding it directly.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
