/**
 * SectionFinanceDemo — Animated demos for Tax Incentives, Budgeting, Casting Triage, Contracts
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { useInView } from '../hooks/useInView';
import {
  Receipt, Calculator, Users, FileText,
  CheckCircle2, AlertTriangle, Clock, Globe,
  TrendingUp, DollarSign, ChevronRight, Sparkles,
  MapPin, BarChart3, Shield, Package
} from 'lucide-react';

// ── TAX INCENTIVES DEMO ──
const TAX_TERRITORIES = [
  { name: 'United Kingdom', code: 'UK', rate: 25, base: 5000000, color: 'hsl(38,60%,52%)', eligible: true, notes: 'HETV Credit · Qualifying spend' },
  { name: 'Ireland', code: 'IE', rate: 32, base: 1200000, color: 'hsl(150,55%,50%)', eligible: true, notes: 'Section 481 · Co-production' },
  { name: 'France', code: 'FR', rate: 30, base: 800000, color: 'hsl(200,65%,55%)', eligible: true, notes: 'TRIP · Rebate on French spend' },
];

function TaxIncentivesDemo() {
  const { ref, inView } = useInView({ threshold: 0.3 });
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const totalStack = TAX_TERRITORIES.filter((_, i) => selected.includes(i))
    .reduce((sum, t) => sum + Math.round((t.base * t.rate) / 100), 0);

  useEffect(() => {
    if (!inView) { setStep(0); setSelected([]); return; }
    const t1 = setTimeout(() => setStep(1), 400);
    const t2 = setTimeout(() => { setStep(2); setSelected([0]); }, 1200);
    const t3 = setTimeout(() => setSelected([0, 1]), 2000);
    const t4 = setTimeout(() => { setSelected([0, 1, 2]); setStep(3); }, 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [inView]);

  return (
    <div ref={ref} className="flex flex-col gap-4">
      <AnimatePresence>
        {step >= 1 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-4 py-3">
            <div className="flex justify-between">
              <span className="text-[10px] font-mono text-muted-foreground/50">Project Budget</span>
              <span className="text-[10px] font-mono font-bold text-foreground/80">£5,000,000</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] font-mono text-muted-foreground/50">Production Type</span>
              <span className="text-[10px] font-mono text-primary/80">High-End TV Drama</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        {TAX_TERRITORIES.map((t, i) => (
          <motion.div
            key={t.code}
            initial={{ opacity: 0, x: -12 }}
            animate={step >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ delay: i * 0.15 }}
            className="rounded-lg border p-3 flex items-center gap-3"
            style={{
              borderColor: selected.includes(i) ? `${t.color}40` : 'hsl(225,20%,15%)',
              background: selected.includes(i) ? `${t.color}08` : 'transparent',
            }}
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center border"
              style={{ borderColor: `${t.color}30`, background: `${t.color}10` }}>
              <span className="text-[9px] font-mono font-bold" style={{ color: t.color }}>{t.code}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-semibold text-foreground/80">{t.name}</span>
                {selected.includes(i) && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="text-xs font-mono font-bold" style={{ color: t.color }}>
                    +£{((t.base * t.rate) / 100).toLocaleString()}
                  </motion.span>
                )}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40">{t.notes} · {t.rate}%</span>
            </div>
            {selected.includes(i) && (
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.color }} />
            )}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {step >= 3 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-primary/30 bg-primary/8 p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono text-primary/60 mb-0.5">Total Incentive Stack</p>
              <p className="text-2xl font-display font-bold text-primary">£{totalStack.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-mono text-muted-foreground/40">Effective rate</p>
              <p className="text-sm font-mono font-bold text-foreground/70">{Math.round((totalStack / 5000000) * 100)}% of budget</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── BUDGETING DEMO ──
const BUDGET_LINES = [
  { label: 'Story & Screenplay', amount: 180000, category: 'ATL', color: 'hsl(38,60%,52%)' },
  { label: 'Director Fees', amount: 320000, category: 'ATL', color: 'hsl(38,60%,52%)' },
  { label: 'Principal Cast', amount: 680000, category: 'ATL', color: 'hsl(38,60%,52%)' },
  { label: 'Production Design', amount: 420000, category: 'BTL', color: 'hsl(200,65%,55%)' },
  { label: 'Camera & Lenses', amount: 280000, category: 'BTL', color: 'hsl(200,65%,55%)' },
  { label: 'Visual Effects', amount: 650000, category: 'POST', color: 'hsl(280,55%,60%)' },
  { label: 'Music & Sound', amount: 190000, category: 'POST', color: 'hsl(280,55%,60%)' },
];

function BudgetingDemo() {
  const { ref, inView } = useInView({ threshold: 0.3 });
  const [visibleLines, setVisibleLines] = useState(0);
  const [showTotal, setShowTotal] = useState(false);
  const total = BUDGET_LINES.reduce((s, l) => s + l.amount, 0);
  const maxAmount = Math.max(...BUDGET_LINES.map(l => l.amount));

  useEffect(() => {
    if (!inView) { setVisibleLines(0); setShowTotal(false); return; }
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleLines(i);
      if (i >= BUDGET_LINES.length) {
        clearInterval(interval);
        setTimeout(() => setShowTotal(true), 500);
      }
    }, 300);
    return () => clearInterval(interval);
  }, [inView]);

  const categories = ['ATL', 'BTL', 'POST'];
  const catTotals = categories.map(c => ({
    label: c === 'ATL' ? 'Above the Line' : c === 'BTL' ? 'Below the Line' : 'Post Production',
    color: c === 'ATL' ? 'hsl(38,60%,52%)' : c === 'BTL' ? 'hsl(200,65%,55%)' : 'hsl(280,55%,60%)',
    total: BUDGET_LINES.filter(l => l.category === c).reduce((s, l) => s + l.amount, 0),
  }));

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {BUDGET_LINES.map((line, i) => (
        <AnimatePresence key={line.label}>
          {i < visibleLines && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
              <span className="text-[9px] font-mono text-muted-foreground/40 w-8">{line.category}</span>
              <div className="flex-1">
                <div className="flex justify-between mb-0.5">
                  <span className="text-[10px] font-mono text-foreground/70">{line.label}</span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: line.color }}>
                    £{(line.amount / 1000).toFixed(0)}K
                  </span>
                </div>
                <div className="h-1 rounded-full bg-border/15 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(line.amount / maxAmount) * 100}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      ))}

      <AnimatePresence>
        {showTotal && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="mt-1 rounded-xl border border-border/15 bg-[hsl(225,20%,8%)] p-3">
            <div className="flex justify-between mb-2">
              <span className="text-[10px] font-mono text-muted-foreground/50">Total Production Budget</span>
              <span className="text-sm font-display font-bold text-foreground/90">£{(total / 1000000).toFixed(2)}M</span>
            </div>
            <div className="flex gap-3">
              {catTotals.map(c => (
                <div key={c.label} className="flex-1 text-center">
                  <p className="text-xs font-mono font-bold" style={{ color: c.color }}>£{(c.total / 1000).toFixed(0)}K</p>
                  <p className="text-[8px] font-mono text-muted-foreground/40 leading-tight">{c.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── CASTING TRIAGE DEMO ──
const CAST_ROLES = [
  {
    role: 'Lead — Hana',
    suggestions: [
      { name: 'Ayaka Miyoshi', score: 94, copro: 'JP/UK', availability: 'Available Q3', trending: '+12%' },
      { name: 'Kaya Scodelario', score: 88, copro: 'UK', availability: 'Available Q4', trending: '+5%' },
    ],
    color: 'hsl(38,60%,52%)',
  },
  {
    role: 'Antagonist — Kaito',
    suggestions: [
      { name: 'Hiroyuki Sanada', score: 97, copro: 'JP/UK/US', availability: 'Negotiating', trending: '+28%' },
      { name: 'Takehiro Hira', score: 91, copro: 'JP/UK', availability: 'Available Q3', trending: '+18%' },
    ],
    color: 'hsl(200,65%,55%)',
  },
  {
    role: 'Supporting — Elder Rin',
    suggestions: [
      { name: 'Yuki Amami', score: 89, copro: 'JP', availability: 'Available Q3', trending: '+7%' },
    ],
    color: 'hsl(150,55%,50%)',
  },
];

function CastingTriageDemo() {
  const { ref, inView } = useInView({ threshold: 0.3 });
  const [visibleRoles, setVisibleRoles] = useState(0);
  const [selected, setSelected] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!inView) { setVisibleRoles(0); setSelected({}); return; }
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleRoles(i);
      if (i >= CAST_ROLES.length) {
        clearInterval(interval);
        // Auto-select best
        setTimeout(() => {
          setSelected({ 0: 0, 1: 0, 2: 0 });
        }, 600);
      }
    }, 700);
    return () => clearInterval(interval);
  }, [inView]);

  const castScore = Object.keys(selected).length === CAST_ROLES.length
    ? Math.round(CAST_ROLES.reduce((sum, role, i) => sum + role.suggestions[selected[i] ?? 0].score, 0) / CAST_ROLES.length)
    : null;

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {CAST_ROLES.slice(0, visibleRoles).map((role, ri) => (
        <motion.div key={role.role} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border/15 bg-[hsl(225,20%,8%)] overflow-hidden">
          <div className="px-3 py-2 border-b border-border/10 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: role.color }} />
            <span className="text-[10px] font-mono text-muted-foreground/60">{role.role}</span>
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {role.suggestions.map((s, si) => (
              <motion.button
                key={s.name}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: si * 0.15 }}
                onClick={() => setSelected(prev => ({ ...prev, [ri]: si }))}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all"
                style={{
                  background: selected[ri] === si ? `${role.color}12` : 'transparent',
                  borderWidth: 1, borderStyle: 'solid',
                  borderColor: selected[ri] === si ? `${role.color}40` : 'transparent',
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-display font-semibold text-foreground/85">{s.name}</span>
                    <span className="text-[9px] font-mono px-1 rounded" style={{ background: `${role.color}15`, color: role.color }}>{s.copro}</span>
                    <span className="text-[9px] font-mono text-green-500/70">{s.trending}</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground/40">{s.availability}</span>
                </div>
                <span className="text-sm font-display font-bold flex-shrink-0" style={{ color: role.color }}>{s.score}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      ))}

      <AnimatePresence>
        {castScore && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border border-primary/30 bg-primary/8 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <div>
                <p className="text-[10px] font-mono text-primary/60">Cast Package Score</p>
                <p className="text-xs font-mono text-muted-foreground/50">Co-pro eligible · 3 territories</p>
              </div>
            </div>
            <p className="text-2xl font-display font-bold text-primary">{castScore}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── CONTRACTS DEMO ──
const CONTRACTS = [
  { title: 'Option Agreement — "Last Love Letter of Gion"', type: 'Option', status: 'signed', expires: '2027-03-01', risk: null },
  { title: 'Director Agreement — Yuki Tanaka', type: 'Services', status: 'pending', expires: '2026-04-15', risk: 'Expires in 38 days' },
  { title: 'Co-Production Agreement — Fuji Creative', type: 'Co-Pro', status: 'signed', expires: '2028-01-01', risk: null },
  { title: 'Chain of Title — Source Material', type: 'Rights', status: 'signed', expires: null, risk: null },
  { title: 'Composer Agreement — Sakura Works', type: 'Music', status: 'draft', expires: null, risk: 'Unsigned' },
  { title: 'Distribution Pre-Sale — Channel 4', type: 'Pre-Sale', status: 'negotiating', expires: null, risk: 'In negotiation' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  signed: { label: 'Signed', color: 'hsl(150,55%,50%)' },
  pending: { label: 'Pending', color: 'hsl(38,60%,52%)' },
  draft: { label: 'Draft', color: 'hsl(200,65%,55%)' },
  negotiating: { label: 'Negotiating', color: 'hsl(280,55%,60%)' },
};

function ContractsDemo() {
  const { ref, inView } = useInView({ threshold: 0.3 });
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!inView) { setVisible(0); return; }
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisible(i);
      if (i >= CONTRACTS.length) clearInterval(interval);
    }, 280);
    return () => clearInterval(interval);
  }, [inView]);

  const signed = CONTRACTS.filter(c => c.status === 'signed').length;
  const risks = CONTRACTS.filter(c => c.risk).length;

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div className="flex gap-3 mb-1">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[hsl(150,55%,50%,0.1)] border border-[hsl(150,55%,50%,0.2)]">
          <CheckCircle2 className="h-3 w-3 text-green-500/70" />
          <span className="text-[10px] font-mono text-green-500/70">{signed} signed</span>
        </div>
        {risks > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[hsl(38,60%,52%,0.1)] border border-[hsl(38,60%,52%,0.2)]">
            <AlertTriangle className="h-3 w-3 text-primary/70" />
            <span className="text-[10px] font-mono text-primary/70">{risks} need attention</span>
          </div>
        )}
      </div>

      {CONTRACTS.slice(0, visible).map((contract, i) => {
        const status = STATUS_CONFIG[contract.status];
        return (
          <motion.div key={contract.title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            className="rounded-lg border border-border/10 bg-[hsl(225,20%,8%)] px-3 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-display font-medium text-foreground/80 truncate">{contract.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] font-mono text-muted-foreground/40">{contract.type}</span>
                {contract.expires && (
                  <span className="text-[9px] font-mono text-muted-foreground/30 flex items-center gap-0.5">
                    <Clock className="h-2 w-2" /> {contract.expires}
                  </span>
                )}
                {contract.risk && (
                  <span className="text-[9px] font-mono text-primary/60">{contract.risk}</span>
                )}
              </div>
            </div>
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: `${status.color}15`, color: status.color, border: `1px solid ${status.color}30` }}>
              {status.label}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── MAIN SECTION ──
const TABS = [
  { key: 'tax', label: 'Tax Incentives', icon: Receipt, color: 'hsl(38,60%,52%)', tagline: 'Multi-territory incentive stacking' },
  { key: 'budget', label: 'Budgeting', icon: Calculator, color: 'hsl(200,65%,55%)', tagline: 'Dynamic budget modelling by department' },
  { key: 'casting', label: 'Casting Triage', icon: Users, color: 'hsl(150,55%,50%)', tagline: 'AI-ranked cast with co-pro eligibility' },
  { key: 'contracts', label: 'Contracts', icon: FileText, color: 'hsl(280,55%,60%)', tagline: 'Chain of title, rights & deal status' },
] as const;

type TabKey = typeof TABS[number]['key'];

export function SectionFinanceDemo() {
  const [activeTab, setActiveTab] = useState<TabKey>('tax');
  const active = TABS.find(t => t.key === activeTab)!;

  return (
    <SectionShell id="finance-demo" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-10">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Deep Dive</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Finance & Production Intelligence
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          See how IFFY handles the complex financial and legal layers that make or break independent productions.
        </p>
      </div>

      <div className="max-w-3xl mx-auto">
        {/* Tab selector */}
        <div className="flex gap-2 mb-6 flex-wrap justify-center">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-display font-medium transition-all duration-200"
                style={{
                  borderWidth: 1, borderStyle: 'solid',
                  borderColor: isActive ? tab.color : 'hsl(225,20%,18%)',
                  background: isActive ? `${tab.color}12` : 'transparent',
                  color: isActive ? tab.color : 'hsl(225,10%,55%)',
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Demo panel */}
        <div className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] overflow-hidden">
          {/* Panel chrome */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/10 bg-[hsl(225,20%,5%)]">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/40" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-500/40" />
              <span className="ml-2 text-[10px] font-mono text-muted-foreground/30">IFFY · {active.label}</span>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/30">{active.tagline}</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="p-5"
            >
              {activeTab === 'tax' && <TaxIncentivesDemo />}
              {activeTab === 'budget' && <BudgetingDemo />}
              {activeTab === 'casting' && <CastingTriageDemo />}
              {activeTab === 'contracts' && <ContractsDemo />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </SectionShell>
  );
}
