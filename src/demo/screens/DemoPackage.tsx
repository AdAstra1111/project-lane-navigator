import { motion } from 'framer-motion';
import { Package, FileText, CheckCircle2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export function DemoPackage({ state }: Props) {
  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-3xl space-y-5">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-display font-semibold text-white">Project Package</h3>
              <p className="text-xs text-white/40">{DEMO_CONFIG.projectName} — Auto-populated from approved documents</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="text-xs border-white/10 text-white/50 hover:text-white gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export ZIP
          </Button>
        </motion.div>

        {/* Package contents */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
            <span className="text-xs font-display font-medium text-white/50">
              Package Contents — {state.docs.length} documents
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {state.docs.map((doc, i) => {
              const approvedV = doc.versions.find(v => v.version_number === doc.approved_version);
              return (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.08 }}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <FileText className="h-4 w-4 text-primary/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80 truncate">{doc.name}</p>
                    <p className="text-[10px] text-white/25">{typeLabels[doc.type]}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-medium text-primary">v{doc.approved_version}</span>
                  </div>
                  <span className="text-[10px] text-white/20">
                    {approvedV?.created_at}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-center text-xs text-white/25"
        >
          Package always reflects the latest approved version of each document.
        </motion.p>
      </div>
    </div>
  );
}
