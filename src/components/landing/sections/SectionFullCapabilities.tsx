import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import {
  Sparkles, FileText, Users, Clapperboard, DollarSign, BarChart3,
  Building2, Receipt, Globe, Calculator, Package, Shield, Layers,
  LayoutGrid, MapPin, ScrollText, Film, Mic2, TrendingUp, Target,
  Calendar, BookOpen, Zap, ChevronDown, ChevronUp
} from 'lucide-react';

interface Feature {
  icon: any;
  label: string;
  description: string;
}

interface Category {
  key: string;
  label: string;
  color: string;
  icon: any;
  tagline: string;
  features: Feature[];
}

const CATEGORIES: Category[] = [
  {
    key: 'development',
    label: 'Story Development',
    color: 'hsl(38,60%,52%)',
    icon: Sparkles,
    tagline: 'From first idea to production-ready script',
    features: [
      { icon: Sparkles, label: 'Auto-Run Pipeline', description: 'AI builds every document autonomously, stage by stage, with convergence scoring.' },
      { icon: FileText, label: 'Script Analysis', description: 'Deep structural, tonal and market analysis of existing screenplays in seconds.' },
      { icon: ScrollText, label: 'Quick & Deep Review', description: 'Fast coverage or in-depth development notes with actionable rewrites.' },
      { icon: BookOpen, label: 'Character Bible', description: 'Full character canon with arcs, relationships, voice and psychological profiles.' },
      { icon: Layers, label: 'Season Architecture', description: 'Season Arc, Episode Grid and Episode Beats built to a convergence target.' },
      { icon: FileText, label: 'Script Delivery', description: 'Feature scripts, episode scripts and complete season script packages.' },
      { icon: Zap, label: 'Coverage Lab', description: 'Industrial-speed coverage for development slates and festival submissions.' },
      { icon: BookOpen, label: 'Series Writer', description: 'Multi-episode writers room simulation with canon-locked episode development.' },
    ],
  },
  {
    key: 'casting',
    label: 'Casting & Talent',
    color: 'hsl(200,65%,55%)',
    icon: Users,
    tagline: 'Market-aligned cast strategy built into every project',
    features: [
      { icon: Users, label: 'AI Cast Intelligence', description: 'AI-recommended casting aligned to the project\'s market positioning and tone.' },
      { icon: TrendingUp, label: 'Cast Market Trends', description: 'Live data on which actors are gaining momentum in your target territories.' },
      { icon: Target, label: 'Strategic Attachments', description: 'Cast attachment strategy mapped to greenlight requirements and co-pro eligibility.' },
      { icon: Mic2, label: 'Director & Producer', description: 'Creative and producing attachment suggestions with market impact modelling.' },
    ],
  },
  {
    key: 'production',
    label: 'Production',
    color: 'hsl(150,55%,50%)',
    icon: Clapperboard,
    tagline: 'Production-ready output, not just development documents',
    features: [
      { icon: LayoutGrid, label: 'Storyboards', description: 'AI-generated visual direction from approved scripts, maintaining canon across episodes.' },
      { icon: ScrollText, label: 'Shot Lists', description: 'Scene-by-scene shot breakdowns with camera direction, framing and coverage.' },
      { icon: FileText, label: 'Production Instructions', description: 'Structured scene notes with VFX callouts, practical requirements and locations.' },
      { icon: Film, label: 'AI Trailer Pipeline', description: 'Trailer script, clip selection, assembly and AI-generated preview content.' },
      { icon: Clapperboard, label: 'Visual Development', description: 'Visual style references, mood boards and scene composition direction.' },
      { icon: MapPin, label: 'Location Strategy', description: 'Tax-optimised location selection mapped to your incentive strategy.' },
      { icon: Calendar, label: 'Production Schedule', description: 'Shooting schedule with resource planning and phased delivery timelines.' },
      { icon: Shield, label: 'Canon Protection', description: 'All production teams locked to the same canon — no continuity drift.' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance & Legal',
    color: 'hsl(280,55%,60%)',
    icon: DollarSign,
    tagline: 'The full financial stack — from budget to recoupment',
    features: [
      { icon: Calculator, label: 'Production Budgets', description: 'Dynamic budget modelling with scenario analysis, cost breakdowns and cashflow.' },
      { icon: Receipt, label: 'Tax Credit Maximisation', description: 'Territory-specific incentive modelling — UK, Ireland, France, Italy, Canada, Australia and more.' },
      { icon: Globe, label: 'Co-Production Treaties', description: 'Treaty compliance checking, cultural points allocation and co-producer structuring.' },
      { icon: DollarSign, label: 'Recoupment Waterfalls', description: 'Complex recoupment structures with corridor analysis and investor return projections.' },
      { icon: BarChart3, label: 'Cashflow Modelling', description: 'Production cashflow with drawdown schedules, gap finance and bridge loan planning.' },
      { icon: Shield, label: 'Finance Structuring', description: 'Multi-source finance stacks — pre-sales, equity, debt, tax credits and grants.' },
      { icon: Package, label: 'Investor Packages', description: 'Auto-assembled investor decks built from approved creative and financial documents.' },
      { icon: Calculator, label: 'Greenlight Simulator', description: 'Model different greenlight scenarios against budget, cast and market conditions.' },
    ],
  },
  {
    key: 'market',
    label: 'Market Intelligence',
    color: 'hsl(350,60%,55%)',
    icon: TrendingUp,
    tagline: 'Real market data embedded in every creative decision',
    features: [
      { icon: TrendingUp, label: 'Story Trends', description: 'Live analysis of which genres, tones and themes are gaining traction with buyers.' },
      { icon: BarChart3, label: 'Market Positioning', description: 'Comparative positioning against recent titles in your genre and budget range.' },
      { icon: Target, label: 'Pitch Intelligence', description: 'Data-backed pitch ideas ranked by market fit, timing and platform appetite.' },
      { icon: Globe, label: 'Buyer Intelligence', description: 'Policy tracking for streamers, broadcasters and distributors across territories.' },
      { icon: Building2, label: 'Buyer CRM', description: 'Track relationships, submissions and responses across your distribution network.' },
      { icon: Film, label: 'Festival Strategy', description: 'Festival calendar with submission timing strategy mapped to your release plan.' },
    ],
  },
  {
    key: 'studio',
    label: 'Studio Operations',
    color: 'hsl(60,60%,48%)',
    icon: Building2,
    tagline: 'Scale development and production across your entire slate',
    features: [
      { icon: Building2, label: 'Multi-Project Slate', description: 'Manage your entire development slate in one place with cross-project analytics.' },
      { icon: LayoutGrid, label: 'Pipeline Dashboard', description: 'See every project\'s stage, score, blockers and next actions at a glance.' },
      { icon: Users, label: 'Team Coordination', description: 'Multiple production teams working in parallel with automatic canon alignment.' },
      { icon: BarChart3, label: 'Performance Reports', description: 'Development velocity, score trajectories and stage completion analytics.' },
      { icon: Calendar, label: 'Production Calendar', description: 'Unified scheduling across projects with milestone tracking and delivery dates.' },
      { icon: Package, label: 'Company Management', description: 'Production company structure with project-level access, roles and permissions.' },
    ],
  },
];

export function SectionFullCapabilities() {
  const [activeKey, setActiveKey] = useState('development');
  const [expandedMobile, setExpandedMobile] = useState<string | null>('development');

  const active = CATEGORIES.find(c => c.key === activeKey) ?? CATEGORIES[0];

  return (
    <SectionShell id="capabilities" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-12">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Full Platform</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Everything Your Project Needs
        </h2>
        <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
          IFFY covers the complete lifecycle — development, casting, production, finance, legal and distribution — in one connected system.
        </p>
      </div>

      <div className="max-w-5xl mx-auto">
        {/* Desktop: side tabs */}
        <div className="hidden md:flex gap-6">
          {/* Tab list */}
          <div className="flex flex-col gap-1 w-48 flex-shrink-0 pt-1">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const isActive = cat.key === activeKey;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveKey(cat.key)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all duration-200"
                  style={{
                    background: isActive ? `${cat.color}12` : 'transparent',
                    borderLeft: isActive ? `2px solid ${cat.color}` : '2px solid transparent',
                  }}
                >
                  <Icon
                    className="h-3.5 w-3.5 flex-shrink-0"
                    style={{ color: isActive ? cat.color : 'hsl(225,10%,45%)' }}
                  />
                  <span
                    className="text-xs font-display font-medium leading-tight"
                    style={{ color: isActive ? cat.color : 'hsl(225,10%,55%)' }}
                  >
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Feature panel */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={active.key}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-6"
              >
                <div className="mb-5">
                  <p className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: active.color }}>{active.label}</p>
                  <p className="text-sm text-muted-foreground">{active.tagline}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {active.features.map((f, i) => {
                    const Icon = f.icon;
                    return (
                      <motion.div
                        key={f.label}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="rounded-xl border border-border/10 bg-[hsl(225,20%,8%)] p-3 flex gap-3"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <Icon className="h-3.5 w-3.5" style={{ color: active.color }} />
                        </div>
                        <div>
                          <p className="text-xs font-display font-semibold text-foreground/90 mb-0.5">{f.label}</p>
                          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{f.description}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Mobile: accordion */}
        <div className="md:hidden flex flex-col gap-2">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const isOpen = expandedMobile === cat.key;
            return (
              <div
                key={cat.key}
                className="rounded-xl border border-border/15 bg-[hsl(225,20%,6%)] overflow-hidden"
                style={{ borderColor: isOpen ? `${cat.color}30` : undefined }}
              >
                <button
                  className="w-full flex items-center justify-between px-4 py-3"
                  onClick={() => setExpandedMobile(isOpen ? null : cat.key)}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-3.5 w-3.5" style={{ color: cat.color }} />
                    <span className="text-sm font-display font-medium text-foreground/90">{cat.label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/40">{cat.features.length} features</span>
                  </div>
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />}
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 flex flex-col gap-2">
                        {cat.features.map(f => {
                          const FIcon = f.icon;
                          return (
                            <div key={f.label} className="flex gap-3 rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 p-3">
                              <FIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: cat.color }} />
                              <div>
                                <p className="text-xs font-display font-semibold text-foreground/90 mb-0.5">{f.label}</p>
                                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{f.description}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Summary stat bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-8 grid grid-cols-3 sm:grid-cols-6 gap-3"
        >
          {CATEGORIES.map(cat => (
            <div
              key={cat.key}
              className="rounded-xl border border-border/10 bg-[hsl(225,20%,6%)] p-3 text-center cursor-pointer"
              onClick={() => setActiveKey(cat.key)}
            >
              <p className="text-lg font-display font-bold" style={{ color: cat.color }}>{cat.features.length}</p>
              <p className="text-[9px] font-mono text-muted-foreground/50 mt-0.5 leading-tight">{cat.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </SectionShell>
  );
}
