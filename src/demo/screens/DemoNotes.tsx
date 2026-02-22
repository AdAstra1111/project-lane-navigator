import { motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, Shield } from 'lucide-react';
import type { DemoState } from '../useDemoState';

const severityConfig = {
  critical: { icon: AlertCircle, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20' },
  major: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20' },
  minor: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20' },
};

interface Props {
  state: DemoState;
}

export function DemoNotes({ state }: Props) {
  const openNotes = state.notes.filter(n => n.status === 'open');
  const resolvedNotes = state.notes.filter(n => n.status === 'resolved');
  const canonRiskCount = state.notes.filter(n => n.canon_risk).length;

  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-3xl space-y-5">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <h3 className="text-lg font-display font-semibold text-white">Development Notes</h3>
            <p className="text-xs text-white/40">
              {openNotes.length} open · {resolvedNotes.length} resolved
            </p>
          </div>
          {canonRiskCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/20">
              <Shield className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[10px] text-amber-400 font-medium">Canon Risk: {canonRiskCount}</span>
            </div>
          )}
        </motion.div>

        {/* Notes list */}
        <div className="space-y-2">
          {state.notes.map((note, i) => {
            const cfg = severityConfig[note.severity];
            const Icon = note.status === 'resolved' ? CheckCircle2 : cfg.icon;
            return (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.1 }}
                className={`p-4 rounded-lg border ${
                  note.status === 'resolved'
                    ? 'border-green-500/20 bg-green-500/5 opacity-60'
                    : cfg.bg
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`h-4.5 w-4.5 shrink-0 mt-0.5 ${
                    note.status === 'resolved' ? 'text-green-400' : cfg.color
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${
                        note.status === 'resolved' ? 'text-white/50 line-through' : 'text-white'
                      }`}>
                        {note.title}
                      </p>
                      {note.canon_risk && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
                          canon risk
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/35 mt-1 line-clamp-2">{note.body}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-white/25">{note.category}</span>
                      {note.status === 'resolved' && (
                        <span className="text-[10px] text-green-400">→ v3 created</span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
