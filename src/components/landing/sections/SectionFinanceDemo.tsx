/**
 * SectionFinanceDemo — Animated demos for Tax Incentives, Budgeting, Casting Triage, Contracts
 * Reference project: "How to Date Billy Walsh" (Amazon Prime, 2024) — produced by Paradox House
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { useInView } from '../hooks/useInView';
import {
  Receipt, Calculator, Users, FileText,
  CheckCircle2, AlertTriangle, Clock,
  TrendingUp, Sparkles
} from 'lucide-react';

const TMDB = 'https://image.tmdb.org/t/p/w185';

// ── TAX INCENTIVES DEMO ──
const TAX_TERRITORIES = [
  {
    name: 'United Kingdom',
    code: 'UK',
    rate: 25,
    base: 3200000,
    color: 'hsl(38,60%,52%)',
    notes: 'UK Film Tax Relief · BFI qualifying',
    delay: 0,
  },
  {
    name: 'BFI Film Fund',
    code: 'BFI',
    rate: 0,
    base: 0,
    flat: 250000,
    color: 'hsl(150,55%,50%)',
    notes: 'Production grant · British content',
    delay: 1,
  },
  {
    name: 'Creative England',
    code: 'CE',
    rate: 0,
    base: 0,
    flat: 85000,
    color: 'hsl(200,65%,55%)',
    notes: 'Production Growth Fund · location grant',
    delay: 2,
  },
];

function TaxIncentivesDemo() {
  const { ref, inView } = useInView({ threshold: 0.3 });
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);

  const calcCredit = (t: typeof TAX_TERRITORIES[0]) =>
    t.flat ?? Math.round((t.base * t.rate) / 100);
  const totalStack = TAX_TERRITORIES.filter((_, i) => selected.includes(i))
    .reduce((sum, t) => sum + calcCredit(t), 0);

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
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-4 py-3 flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-[10px] font-mono text-muted-foreground/50">Project</span>
              <span className="text-[10px] font-mono font-bold text-foreground/80">How to Date Billy Walsh</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] font-mono text-muted-foreground/50">Production Budget</span>
              <span className="text-[10px] font-mono font-bold text-foreground/80">£4,200,000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] font-mono text-muted-foreground/50">Distributor</span>
              <span className="text-[10px] font-mono text-primary/70">Amazon Prime Video</span>
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
            <div className="flex-shrink-0 w-9 h-7 rounded-md flex items-center justify-center border"
              style={{ borderColor: `${t.color}30`, background: `${t.color}10` }}>
              <span className="text-[9px] font-mono font-bold" style={{ color: t.color }}>{t.code}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-display font-semibold text-foreground/80">{t.name}</span>
                {selected.includes(i) && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="text-xs font-mono font-bold" style={{ color: t.color }}>
                    +£{calcCredit(t).toLocaleString()}
                  </motion.span>
                )}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40">
                {t.notes}{t.rate > 0 ? ` · ${t.rate}%` : ''}
              </span>
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
              <p className="text-sm font-mono font-bold text-foreground/70">
                {Math.round((totalStack / 4200000) * 100)}% of budget
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── BUDGETING DEMO ──
const BUDGET_LINES = [
  { label: 'Story & Screenplay',  amount: 95000,  category: 'ATL',  color: 'hsl(38,60%,52%)' },
  { label: 'Director Fees',       amount: 180000, category: 'ATL',  color: 'hsl(38,60%,52%)' },
  { label: 'Principal Cast',      amount: 620000, category: 'ATL',  color: 'hsl(38,60%,52%)' },
  { label: 'Production Design',   amount: 310000, category: 'BTL',  color: 'hsl(200,65%,55%)' },
  { label: 'Camera & Lenses',     amount: 195000, category: 'BTL',  color: 'hsl(200,65%,55%)' },
  { label: 'Locations (UK)',      amount: 240000, category: 'BTL',  color: 'hsl(200,65%,55%)' },
  { label: 'Visual Effects',      amount: 420000, category: 'POST', color: 'hsl(280,55%,60%)' },
  { label: 'Music & Score',       amount: 140000, category: 'POST', color: 'hsl(280,55%,60%)' },
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

  const catTotals = [
    { label: 'Above the Line', key: 'ATL', color: 'hsl(38,60%,52%)' },
    { label: 'Below the Line', key: 'BTL', color: 'hsl(200,65%,55%)' },
    { label: 'Post Production', key: 'POST', color: 'hsl(280,55%,60%)' },
  ].map(c => ({
    ...c,
    total: BUDGET_LINES.filter(l => l.category === c.key).reduce((s, l) => s + l.amount, 0),
  }));

  return (
    <div ref={ref} className="flex flex-col gap-3">
      <div className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-4 py-2 mb-1">
        <span className="text-[10px] font-mono text-muted-foreground/50">How to Date Billy Walsh · Feature Film · Low Budget</span>
      </div>
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
                <div key={c.key} className="flex-1 text-center">
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
    role: 'Lead — Billy Walsh',
    color: 'hsl(38,60%,52%)',
    suggestions: [
      {
        name: 'Tanner Buchanan',
        img: `${TMDB}/r4BhpeAIorW6Po2zOIRyhwKGA2y.jpg`,
        score: 94,
        credits: 'Cobra Kai · He\'s All That',
        territory: 'US',
        trending: '+22%',
        note: 'Confirmed',
      },
      {
        name: 'Jacob Elordi',
        img: `${TMDB}/qZNRPWCP2c5d0YaYLTzHXU9Rdoe.jpg`,
        score: 91,
        credits: 'Saltburn · Priscilla',
        territory: 'AU/US',
        trending: '+41%',
        note: 'Alt. option',
      },
    ],
  },
  {
    role: 'Lead — Archie',
    color: 'hsl(200,65%,55%)',
    suggestions: [
      {
        name: 'Sebastian Croft',
        img: `${TMDB}/uv2foDEA3rgrzQsoyyV77Nb65ga.jpg`,
        score: 92,
        credits: 'Heartstopper · Game of Thrones',
        territory: 'UK',
        trending: '+18%',
        note: 'Confirmed',
      },
      {
        name: 'Kit Connor',
        img: `${TMDB}/ut64CyBwiRudb3DxOgUa2j9Wxep.jpg`,
        score: 90,
        credits: 'Heartstopper · Rocketman',
        territory: 'UK',
        trending: '+35%',
        note: 'Alt. option',
      },
    ],
  },
  {
    role: 'Lead — Amelia',
    color: 'hsl(150,55%,50%)',
    suggestions: [
      {
        name: 'Charithra Chandran',
        img: `${TMDB}/xLFgJmfXjd2Nnbjx3ZtavReGwjK.jpg`,
        score: 95,
        credits: 'Bridgerton · Alex Rider',
        territory: 'UK',
        trending: '+29%',
        note: 'Confirmed',
      },
      {
        name: 'Mia McKenna-Bruce',
        img: `${TMDB}/3CbwQW082wmd8C0IpmgDvxJUjog.jpg`,
        score: 88,
        credits: 'How to Have Sex · The Witcher',
        territory: 'UK',
        trending: '+44%',
        note: 'Alt. option',
      },
    ],
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
        setTimeout(() => setSelected({ 0: 0, 1: 0, 2: 0 }), 500);
      }
    }, 700);
    return () => clearInterval(interval);
  }, [inView]);

  const castScore =
    Object.keys(selected).length === CAST_ROLES.length
      ? Math.round(
          CAST_ROLES.reduce((sum, role, i) => sum + role.suggestions[selected[i] ?? 0].score, 0) /
            CAST_ROLES.length,
        )
      : null;

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {CAST_ROLES.slice(0, visibleRoles).map((role, ri) => (
        <motion.div
          key={role.role}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border/15 bg-[hsl(225,20%,8%)] overflow-hidden"
        >
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
                className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all"
                style={{
                  background: selected[ri] === si ? `${role.color}12` : 'transparent',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: selected[ri] === si ? `${role.color}40` : 'transparent',
                }}
              >
                {/* Actor photo */}
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-[hsl(225,20%,12%)] border"
                  style={{ borderColor: selected[ri] === si ? `${role.color}40` : 'hsl(225,20%,18%)' }}
                >
                  <img
                    src={s.img}
                    alt={s.name}
                    className="w-full h-full object-cover object-top"
                    onError={e => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-display font-semibold text-foreground/85">{s.name}</span>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ background: `${role.color}15`, color: role.color }}
                    >
                      {s.territory}
                    </span>
                    <span className="text-[9px] font-mono text-green-500/70">{s.trending}</span>
                    {s.note === 'Confirmed' && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400/80 border border-green-500/20">
                        ✓ Cast
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground/40">{s.credits}</span>
                </div>

                <span
                  className="text-base font-display font-bold flex-shrink-0"
                  style={{ color: role.color }}
                >
                  {s.score}
                </span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      ))}

      <AnimatePresence>
        {castScore && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border border-primary/30 bg-primary/8 p-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <div>
                <p className="text-[10px] font-mono text-primary/60">Cast Package Score</p>
                <p className="text-[10px] font-mono text-muted-foreground/50">
                  All leads UK-eligible · Amazon pre-sold
                </p>
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
  { title: 'Option Agreement — Original Screenplay', type: 'Option', status: 'signed', expires: '2026-08-01', risk: null },
  { title: 'Amazon Prime Video Distribution Deal', type: 'Distribution', status: 'signed', expires: null, risk: null },
  { title: 'Director Services — Alex Pillai', type: 'Services', status: 'signed', expires: null, risk: null },
  { title: 'Chain of Title Documentation', type: 'Rights', status: 'signed', expires: null, risk: null },
  { title: 'Composer Agreement — Original Score', type: 'Music', status: 'signed', expires: null, risk: null },
  { title: 'UK Film Tax Relief Application', type: 'Tax Credit', status: 'pending', expires: '2026-06-30', risk: 'Filing due June' },
  { title: 'E&O Insurance Policy', type: 'Insurance', status: 'signed', expires: '2027-04-01', risk: null },
  { title: 'Co-Production Agreement — Paradox House', type: 'Co-Pro', status: 'signed', expires: null, risk: null },
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
      <div className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-4 py-2 mb-1">
        <span className="text-[10px] font-mono text-muted-foreground/50">How to Date Billy Walsh · Amazon Prime Video · 2024</span>
      </div>
      <div className="flex gap-3 mb-1">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20">
          <CheckCircle2 className="h-3 w-3 text-green-500/70" />
          <span className="text-[10px] font-mono text-green-500/70">{signed} signed</span>
        </div>
        {risks > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <AlertTriangle className="h-3 w-3 text-primary/70" />
            <span className="text-[10px] font-mono text-primary/70">{risks} need attention</span>
          </div>
        )}
      </div>

      {CONTRACTS.slice(0, visible).map(contract => {
        const status = STATUS_CONFIG[contract.status];
        return (
          <motion.div
            key={contract.title}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-lg border border-border/10 bg-[hsl(225,20%,8%)] px-3 py-2.5 flex items-center gap-3"
          >
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
            <span
              className="text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: `${status.color}15`,
                color: status.color,
                border: `1px solid ${status.color}30`,
              }}
            >
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
  { key: 'tax',      label: 'Tax Incentives', icon: Receipt,    color: 'hsl(38,60%,52%)',   tagline: 'UK Film Tax Relief · incentive stacking' },
  { key: 'budget',   label: 'Budgeting',      icon: Calculator, color: 'hsl(200,65%,55%)',  tagline: 'Department budget breakdown' },
  { key: 'casting',  label: 'Casting Triage', icon: Users,      color: 'hsl(150,55%,50%)',  tagline: 'AI-ranked cast with co-pro eligibility' },
  { key: 'contracts',label: 'Contracts',      icon: FileText,   color: 'hsl(280,55%,60%)',  tagline: 'Chain of title, rights & deal status' },
] as const;
type TabKey = typeof TABS[number]['key'];

export function SectionFinanceDemo() {
  const [activeTab, setActiveTab] = useState<TabKey>('tax');
  const active = TABS.find(t => t.key === activeTab)!;

  return (
    <SectionShell id="finance-demo" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-10">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Real Production Demo</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Finance & Production Intelligence
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          How IFFY handled the production of{' '}
          <span className="text-foreground/80 font-medium italic">How to Date Billy Walsh</span>
          {' '}— from tax credit stacking to cast selection to contract management.
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
                  borderWidth: 1,
                  borderStyle: 'solid',
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
          {/* Chrome */}
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
