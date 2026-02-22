import { motion } from 'framer-motion';
import { FileText, CheckCircle2, Upload, Search, Filter } from 'lucide-react';
import type { DemoState } from '../useDemoState';
import { DEMO_CONFIG } from '../demoConfig';

const typeLabels: Record<string, string> = {
  screenplay: 'Screenplay',
  market_sheet: 'Market Sheet',
  format_rules: 'Format Rules',
  character_bible: 'Character Bible',
  brief: 'Development Brief',
};

interface Props {
  state: DemoState;
}

export function DemoLibrary({ state }: Props) {
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
            <h3 className="text-lg font-display font-semibold text-white">{DEMO_CONFIG.projectName}</h3>
            <p className="text-xs text-white/40">Project Library — {state.docs.length} documents</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5">
              <Search className="h-3.5 w-3.5 text-white/30" />
              <span className="text-xs text-white/30">Search…</span>
            </div>
            <div className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
              <Filter className="h-3.5 w-3.5 text-white/30" />
            </div>
            <div className="h-8 w-8 rounded-lg border border-primary/30 bg-primary/10 flex items-center justify-center">
              <Upload className="h-3.5 w-3.5 text-primary" />
            </div>
          </div>
        </motion.div>

        {/* Document list */}
        <div className="space-y-2">
          {state.docs.map((doc, i) => {
            const approvedV = doc.versions.find(v => v.version_number === doc.approved_version);
            return (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.1 }}
                className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{doc.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-white/30">{typeLabels[doc.type] || doc.type}</span>
                    <span className="text-[10px] text-white/20">•</span>
                    <span className="text-[10px] text-white/30">{doc.versions.length} version{doc.versions.length > 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] text-primary font-medium">v{doc.approved_version}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
