/**
 * SectionStudioMode — Major Studio / Feature Film demo for the landing tour.
 * Condensed from ExecutiveDemo (Shadow Protocol).
 * Shows: Development scores → Packaging score arc → Finance stack
 */
import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { CheckCircle2, AlertTriangle, Users, DollarSign, Package, Lightbulb } from 'lucide-react';

const ATTACHMENTS = [
  { role: 'Director', name: 'Christopher Nolan', before: 61, after: 74 },
  { role: 'Lead Actor', name: 'Leonardo DiCaprio', before: 74, after: 86 },
  { role: 'Ensemble', name: 'Blunt · Boyega · Swinton', before: 86, after: 93 },
];

const FINANCE_STACK = [
  { label: 'Studio Equity', pct: 50, amount: '$82.5M', color: 'hsl(38,60%,52%)' },
  { label: 'Intl Pre-Sales', pct: 20, amount: '$33M', color: 'hsl(200,65%,55%)' },
  { label: 'Gap Financing', pct: 15, amount: '$24.75M', color: 'hsl(38,50%,65%)' },
  { label: 'UK Tax Incentive', pct: 12, amount: '$19.8M', color: 'hsl(150,55%,50%)' },
  { label: 'PE Slate Partner', pct: 3, amount: '$4.95M', color: 'hsl(280,55%,60%)' },
];

export function SectionStudioMode() {
  return (
    <SectionShell id="studio-mode" className="bg-[hsl(225,20%,4%)]">

      <div className="text-center mb-14">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Studio Mode</p>
        <h2 className="font-display font-bold text-foreground tracking-tight" style={{ fontSize: 'clamp(1.8rem, 6vw, 3.5rem)' }}>
          From development to greenlight.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          SHADOW PROTOCOL — Studio / Global Theatrical · $165M · IFFY tracks every variable from first draft to recoupment.
        </p>
      </div>

      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Row 1: Development scores ── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <motion.div
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0 }}
            className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">Development</span>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Script Quality', value: 88, color: 'hsl(150,55%,50%)' },
                { label: 'Concept Clarity', value: 92, color: 'hsl(150,55%,50%)' },
                { label: 'Cast Attachment', value: 0, color: 'hsl(0,65%,55%)' },
                { label: 'Studio Interest', value: 35, color: 'hsl(38,60%,52%)' },
              ].map((s, i) => (
                <div key={s.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground/60">{s.label}</span>
                    <span className="font-mono text-muted-foreground/70">{s.value}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted/20 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: s.color }}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${s.value}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/10 flex items-center justify-between">
              <span className="text-xs text-muted-foreground/40">Greenlight probability</span>
              <span className="font-display font-bold text-amber-400 text-lg">61%</span>
            </div>
            <p className="text-[10px] text-muted-foreground/40 mt-1">Concept strong · bankable cast required</p>
          </motion.div>

          {/* ── Packaging arc ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
            className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Package className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">Packaging</span>
            </div>
            <div className="space-y-4">
              {ATTACHMENTS.map((att, i) => (
                <motion.div
                  key={att.role}
                  initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                  transition={{ delay: 0.4 + i * 0.15 }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-3 w-3 text-muted-foreground/30" />
                    <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">{att.role}</span>
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-display font-medium text-foreground/80">{att.name}</span>
                    <div className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="text-muted-foreground/40">{att.before}%</span>
                      <span className="text-muted-foreground/20">→</span>
                      <span className="text-primary font-semibold">{att.after}%</span>
                    </div>
                  </div>
                  <div className="h-1 rounded-full bg-muted/20 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: `${att.before}%` }}
                      whileInView={{ width: `${att.after}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.6 + i * 0.15, duration: 1.2, ease: 'easeOut' }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/10 flex items-center justify-between">
              <span className="text-xs text-muted-foreground/40">Greenlight probability</span>
              <span className="font-display font-bold text-primary text-lg">93%</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <p className="text-[10px] text-emerald-400/70">Package speaks for itself</p>
            </div>
          </motion.div>

          {/* ── Finance ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
            className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">Finance Stack</span>
            </div>
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-[10px] text-muted-foreground/40">Production Budget</p>
                <p className="font-display font-bold text-foreground text-xl">$165M</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground/40">P&A</p>
                <p className="font-display font-bold text-foreground/60 text-lg">$110M</p>
              </div>
            </div>
            {/* Stack bar */}
            <div className="flex rounded-lg overflow-hidden h-5 mb-4">
              {FINANCE_STACK.map((s, i) => (
                <motion.div
                  key={s.label}
                  className="flex items-center justify-center"
                  style={{ backgroundColor: s.color }}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${s.pct}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 + i * 0.12, duration: 0.8, ease: 'easeOut' }}
                >
                  {s.pct >= 12 && (
                    <span className="text-[9px] font-mono text-black/60 font-semibold">{s.pct}%</span>
                  )}
                </motion.div>
              ))}
            </div>
            <div className="space-y-1.5">
              {FINANCE_STACK.map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
                  transition={{ delay: 0.7 + i * 0.08 }}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-muted-foreground/60">{s.label}</span>
                  </div>
                  <span className="font-mono text-muted-foreground/50">{s.amount}</span>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/10">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                <span className="text-[10px] text-emerald-400/70">Structure complete · Risk absorbed</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Production health bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
          className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-display font-semibold text-foreground/70">Production Monitoring</span>
            <span className="text-[10px] font-mono text-muted-foreground/40">Live during shoot · IFFY tracks every variable</span>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[
              { label: 'Schedule Health', value: '87%', color: 'text-emerald-400' },
              { label: 'Budget Variance', value: '+2.1%', color: 'text-amber-400' },
              { label: 'Insurance Exposure', value: '$12.4M', color: 'text-foreground/70' },
              { label: 'Bond Status', value: 'Clear', color: 'text-emerald-400' },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
                transition={{ delay: 0.4 + i * 0.08 }}
              >
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1">{item.label}</p>
                <p className={`font-display font-bold text-lg ${item.color}`}>{item.value}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
              <span className="text-xs text-muted-foreground/50">VFX overages projected +4% · Mitigation deployed</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-xs text-muted-foreground/50">Contingency schedule active · Iceland exteriors</span>
            </div>
          </div>
        </motion.div>

      </div>
    </SectionShell>
  );
}
