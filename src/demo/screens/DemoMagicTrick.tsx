import { motion, AnimatePresence } from 'framer-motion';
import { FileText, CheckCircle2, Circle, AlertCircle, Sparkles, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DemoState } from '../useDemoState';
import type { DemoAction } from '../demoConfig';
import { DEMO_CONFIG } from '../demoConfig';

interface Props {
  state: DemoState;
  currentAction: DemoAction;
  overlayText: string;
}

export function DemoMagicTrick({ state, currentAction, overlayText }: Props) {
  const scriptDoc = state.docs.find(d => d.id === 'doc-script');
  const note = state.notes.find(n => n.id === 'note-1');

  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Note + Action */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-4"
        >
          <h3 className="text-xs font-display uppercase tracking-[0.2em] text-primary/70">Active Note</h3>
          <div
            data-demo="note-highlight"
            className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-white">{note?.title}</p>
                <p className="text-xs text-white/40 mt-1">{note?.body}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                note?.status === 'resolved'
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-destructive/10 text-destructive border border-destructive/20'
              }`}>
                {note?.status === 'resolved' ? '✓ Resolved' : note?.severity}
              </span>
              <span className="text-xs text-white/30">{note?.category}</span>
            </div>
          </div>

          <AnimatePresence>
            {!state.fixApplied && (
              <motion.div
                data-demo="apply-fix-btn"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                  disabled={currentAction !== 'APPLY_FIX'}
                >
                  <Sparkles className="h-4 w-4" />
                  Apply Fix → Create New Version
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {state.fixApplied && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-green-400 flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Fix applied — v3 created
            </motion.div>
          )}
        </motion.div>

        {/* Right: Version Tray + Package indicator */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-4"
        >
          <h3 className="text-xs font-display uppercase tracking-[0.2em] text-primary/70">
            Version Tray — Screenplay
          </h3>
          <div data-demo="version-tray" className="space-y-2">
            {scriptDoc?.versions.map((v, i) => (
              <motion.div
                key={v.version_number}
                initial={v.version_number === 3 ? { opacity: 0, x: 20 } : {}}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: v.version_number === 3 ? 0.3 : 0 }}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  v.status === 'approved'
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                {v.status === 'approved' ? (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                ) : v.status === 'draft' ? (
                  <Circle className="h-4 w-4 text-white/30 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-white/15 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">v{v.version_number}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      v.status === 'approved' ? 'bg-primary/15 text-primary' :
                      v.status === 'draft' ? 'bg-white/10 text-white/50' :
                      'bg-white/5 text-white/25'
                    }`}>
                      {v.status}
                    </span>
                  </div>
                  <p className="text-xs text-white/30 truncate">{v.label}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Package indicator */}
          <motion.div
            data-demo="package-badge"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className={`flex items-center gap-2 p-3 rounded-lg border ${
              state.packageOpen
                ? 'border-primary/30 bg-primary/5'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <Package className="h-4 w-4 text-primary/60" />
            <div className="flex-1">
              <span className="text-xs font-medium text-white/70">Project Package</span>
              <p className="text-[10px] text-white/30">
                {state.versionApproved
                  ? `Updated: Screenplay v3 approved`
                  : `Current: ${scriptDoc?.versions.find(v => v.status === 'approved')?.label || 'v2'}`
                }
              </p>
            </div>
            {state.packageOpen && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded"
              >
                synced
              </motion.span>
            )}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
