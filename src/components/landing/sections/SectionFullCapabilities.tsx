import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import {
  Sparkles, FileText, Users, Clapperboard, DollarSign, BarChart3,
  Building2, Receipt, Globe, Calculator, Package, Shield, Layers,
  LayoutGrid, MapPin, ScrollText, Film, Mic2, TrendingUp, Target,
  Calendar, BookOpen, Zap, ChevronDown, ChevronUp, GitBranch,
  Activity, Compass, AlertTriangle, Rocket, Eye, ClipboardList,
  Music, Camera, Wand2, FlaskConical, CheckCircle2, Bell,
  ListChecks, MessageSquare, Lock, Shuffle, SlidersHorizontal
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
    tagline: 'From first idea to production-ready script — fully automated',
    features: [
      { icon: Sparkles, label: 'Auto-Run Pipeline', description: 'AI builds every document autonomously, stage by stage, with convergence scoring and self-correction.' },
      { icon: FileText, label: 'Script Analysis', description: 'Deep structural, tonal and market analysis of existing screenplays — coverage in seconds.' },
      { icon: ScrollText, label: 'Quick & Deep Review', description: 'Fast coverage or in-depth development notes with actionable rewrites and score tracking.' },
      { icon: BookOpen, label: 'Character Bible', description: 'Full character canon — arcs, relationships, psychological profiles, voice and backstory.' },
      { icon: Layers, label: 'Season Architecture', description: 'Season Arc, Episode Grid and Episode Beats built to CI/GP convergence targets.' },
      { icon: FileText, label: 'Script Delivery', description: 'Feature scripts, episode scripts and complete season script packages with production notes.' },
      { icon: Zap, label: 'Coverage Lab', description: 'Industrial-speed coverage and script notes for development slates and festival submissions.' },
      { icon: BookOpen, label: 'Series Writer', description: 'Multi-episode writers room simulation with canon-locked episode development.' },
      { icon: FlaskConical, label: 'Calibration Lab', description: 'Classification matrix and outcome accuracy tracking — keeps the AI scoring system honest.' },
      { icon: SlidersHorizontal, label: 'Convergence Engine', description: 'Creative Integrity and Green Potential scoring with live gap analysis and rewrite targeting.' },
      { icon: CheckCircle2, label: 'Canon Lock', description: 'Approved documents are locked and versioned — all downstream work is canon-consistent.' },
      { icon: MessageSquare, label: 'Notes Inbox', description: 'Blocking issues, high priority and polish notes with resolution tracking across every document.' },
    ],
  },
  {
    key: 'casting',
    label: 'Casting & Talent',
    color: 'hsl(200,65%,55%)',
    icon: Users,
    tagline: 'Market-aligned cast strategy embedded in every project',
    features: [
      { icon: Users, label: 'AI Cast Intelligence', description: 'AI-recommended casting aligned to market positioning, tone, genre and co-pro eligibility.' },
      { icon: TrendingUp, label: 'Cast Market Trends', description: 'Live data on which actors are gaining momentum in your target territories and platforms.' },
      { icon: Target, label: 'Strategic Attachments', description: 'Cast strategy mapped to greenlight requirements, co-production eligibility and sales estimates.' },
      { icon: Mic2, label: 'Director & Producer', description: 'Creative and producing attachment suggestions with market impact and packaging tier modelling.' },
      { icon: BarChart3, label: 'Cast Comparables', description: 'Comparable title analysis by cast profile, genre and budget range for attachment decisions.' },
    ],
  },
  {
    key: 'production',
    label: 'Production',
    color: 'hsl(150,55%,50%)',
    icon: Clapperboard,
    tagline: 'Production-ready output from script to screen',
    features: [
      { icon: LayoutGrid, label: 'AI Storyboards', description: 'AI-generated visual direction from approved scripts, maintaining canon across all episodes.' },
      { icon: ScrollText, label: 'Shot Lists', description: 'Scene-by-scene shot breakdowns with camera direction, framing, coverage and lens notes.' },
      { icon: FileText, label: 'Production Instructions', description: 'Structured scene notes with VFX callouts, practical requirements and key dependencies.' },
      { icon: Film, label: 'Trailer Pipeline', description: 'Trailer script studio, rhythm grid, shot design, auto-assembly, studio finish and clip management.' },
      { icon: Music, label: 'Rhythm & Timing', description: 'Music-locked rhythm grid for trailer assembly with beat-accurate timing and coverage planning.' },
      { icon: Camera, label: 'AI Clip Generation', description: 'AI-generated clips, teasers and animatics from approved creative documents.' },
      { icon: Wand2, label: 'Visual Development', description: 'Visual style references, mood boards, scene composition direction and canon pack management.' },
      { icon: MapPin, label: 'Location Strategy', description: 'Tax-optimised location selection mapped to incentive strategy and shooting schedule.' },
      { icon: Calendar, label: 'Production Schedule', description: 'Shooting schedule with resource planning, phased milestones and delivery timelines.' },
      { icon: Shield, label: 'Canon Protection', description: 'All production teams locked to the same approved canon — no creative drift across teams.' },
      { icon: Eye, label: 'Presentation Mode', description: 'Full-screen presentation view for client, investor and broadcaster meetings.' },
      { icon: ClipboardList, label: 'Daily Reports', description: 'Production diary and daily report logging with milestone tracking and progress notes.' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance & Legal',
    color: 'hsl(280,55%,60%)',
    icon: DollarSign,
    tagline: 'The complete financial and legal stack — from budget to recoupment',
    features: [
      { icon: Calculator, label: 'Production Budgets', description: 'Dynamic budget modelling by tier (Micro to Studio) with scenario analysis and cost breakdowns.' },
      { icon: Receipt, label: 'Tax Credit Maximisation', description: 'Territory-specific incentive modelling — UK, Ireland, France, Italy, Canada, Australia, New Zealand and more.' },
      { icon: Globe, label: 'Co-Production Planning', description: 'Treaty compliance checking, cultural points allocation, co-producer structuring and eligibility scoring.' },
      { icon: DollarSign, label: 'Recoupment Waterfalls', description: 'Complex waterfall structures with corridor analysis, profit participation and investor return projections.' },
      { icon: BarChart3, label: 'Cashflow & Stack', description: 'Production cashflow with drawdown schedules, gap finance, soft money stacking and bridge modelling.' },
      { icon: Shield, label: 'Finance Structuring', description: 'Multi-source stacks — pre-sales, equity, mezzanine debt, tax credits, grants and co-production.' },
      { icon: Package, label: 'Investor Packages', description: 'Auto-assembled investor decks built from approved creative, financial and market documents.' },
      { icon: GitBranch, label: 'Scenario Modelling', description: 'Multiple finance scenarios modelled side by side with cascade impact and comparison tools.' },
      { icon: Activity, label: 'Stress Testing', description: 'Scenario stress tests against budget overruns, cast changes, delivery slippage and market shifts.' },
      { icon: AlertTriangle, label: 'Drift Alerts', description: 'Automated alerts when financial assumptions drift from approved scenarios.' },
      { icon: Compass, label: 'Strategic Recommendations', description: 'AI-generated strategic guidance on packaging, timing, market positioning and risk mitigation.' },
      { icon: Lock, label: 'Governance & Approvals', description: 'Decision log, merge approval inbox, scenario lock controls and governance insights.' },
    ],
  },
  {
    key: 'market',
    label: 'Market Intelligence',
    color: 'hsl(350,60%,55%)',
    icon: TrendingUp,
    tagline: 'Real market data embedded in every creative and financial decision',
    features: [
      { icon: TrendingUp, label: 'Story Trends', description: 'Live analysis of which genres, tones, themes and story structures are gaining traction with buyers.' },
      { icon: BarChart3, label: 'Cast Trends', description: 'Talent momentum tracking — which actors are rising, plateauing or declining in buyer demand.' },
      { icon: Eye, label: 'Coverage Trends', description: 'Script coverage pattern analysis across territories, formats and budget ranges.' },
      { icon: Shuffle, label: 'Trend Explorer', description: 'Multi-axis trend analysis and cross-filtering across story, cast, market and format data.' },
      { icon: ListChecks, label: 'Governance Trends', description: 'Policy and quota tracking across broadcasters, streamers and territorial funding bodies.' },
      { icon: Target, label: 'Market Positioning', description: 'Comparative positioning against recent titles in your genre, format and budget range.' },
      { icon: Sparkles, label: 'Pitch Intelligence', description: 'Data-ranked pitch ideas by market fit, platform appetite, timing and competitive landscape.' },
      { icon: Globe, label: 'Buyer Intelligence', description: 'Policy tracking for streamers, broadcasters and distributors — mandates, preferences, quotas.' },
      { icon: Building2, label: 'Buyer CRM', description: 'Track buyer relationships, submissions, responses and deal status across your distribution network.' },
      { icon: Film, label: 'Festival Strategy', description: 'Festival calendar with submission timing strategy mapped to release plan and award objectives.' },
      { icon: Rocket, label: 'Greenlight Simulator', description: 'Model greenlight probability against budget, cast, platform and market timing combinations.' },
      { icon: BarChart3, label: 'Intel Dashboard', description: 'Alignment scoring, industry events, policy changes and market intelligence in one feed.' },
    ],
  },
  {
    key: 'studio',
    label: 'Studio Operations',
    color: 'hsl(60,60%,48%)',
    icon: Building2,
    tagline: 'Scale development and production across your entire slate',
    features: [
      { icon: Building2, label: 'Multi-Project Slate', description: 'Manage your entire development slate with cross-project analytics and status tracking.' },
      { icon: LayoutGrid, label: 'Pipeline Dashboard', description: 'See every project\'s stage, CI/GP score, blockers and next actions at a glance.' },
      { icon: Users, label: 'Team Coordination', description: 'Multiple production teams working in parallel with automatic canon alignment and conflict resolution.' },
      { icon: Shuffle, label: 'Project Comparison', description: 'Compare projects by score, stage, market fit and financial structure side by side.' },
      { icon: BarChart3, label: 'Performance Reports', description: 'Development velocity, score trajectories, stage completion rates and pipeline analytics.' },
      { icon: Calendar, label: 'Production Calendar', description: 'Unified scheduling across all projects with milestone tracking and delivery date management.' },
      { icon: Building2, label: 'Company Management', description: 'Production company structure with project-level access, team roles and permission controls.' },
      { icon: Bell, label: 'Notification System', description: 'Real-time alerts for stage promotions, approval requests, blocking issues and deadline risks.' },
      { icon: Package, label: 'Package Sharing', description: 'Secure share links for packages, pitch decks and investor materials with access controls.' },
      { icon: Eye, label: 'Investor Presentation', description: 'Built-in investor presentation mode with structured slides, speaker notes and live delivery.' },
    ],
  },
];

export function SectionFullCapabilities() {
  const [activeKey, setActiveKey] = useState('development');
  const [expandedMobile, setExpandedMobile] = useState<string | null>('development');

  const active = CATEGORIES.find(c => c.key === activeKey) ?? CATEGORIES[0];
  const totalFeatures = CATEGORIES.reduce((sum, c) => sum + c.features.length, 0);

  return (
    <SectionShell id="capabilities" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-12">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Full Platform</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Everything Your Project Needs
        </h2>
        <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
          IFFY covers the complete production lifecycle — {totalFeatures}+ capabilities across development, casting, production, finance, market intelligence and studio operations.
        </p>
      </div>

      <div className="max-w-5xl mx-auto">
        {/* Desktop: side tabs */}
        <div className="hidden md:flex gap-6">
          <div className="flex flex-col gap-1 w-52 flex-shrink-0 pt-1">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const isActive = cat.key === activeKey;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveKey(cat.key)}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all duration-200 group"
                  style={{
                    background: isActive ? `${cat.color}12` : 'transparent',
                    borderLeft: isActive ? `2px solid ${cat.color}` : '2px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: isActive ? cat.color : 'hsl(225,10%,45%)' }} />
                    <span className="text-xs font-display font-medium leading-tight" style={{ color: isActive ? cat.color : 'hsl(225,10%,55%)' }}>
                      {cat.label}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono" style={{ color: isActive ? `${cat.color}80` : 'hsl(225,10%,35%)' }}>
                    {cat.features.length}
                  </span>
                </button>
              );
            })}

            <div className="mt-4 px-3 py-2 rounded-xl border border-border/10 bg-[hsl(225,20%,6%)]">
              <p className="text-[10px] font-mono text-muted-foreground/40 mb-0.5">Total capabilities</p>
              <p className="text-lg font-display font-bold text-primary">{totalFeatures}+</p>
            </div>
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
                        transition={{ delay: i * 0.035 }}
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
              <div key={cat.key} className="rounded-xl border border-border/15 bg-[hsl(225,20%,6%)] overflow-hidden"
                style={{ borderColor: isOpen ? `${cat.color}30` : undefined }}>
                <button className="w-full flex items-center justify-between px-4 py-3"
                  onClick={() => setExpandedMobile(isOpen ? null : cat.key)}>
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-3.5 w-3.5" style={{ color: cat.color }} />
                    <span className="text-sm font-display font-medium text-foreground/90">{cat.label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/40">{cat.features.length}</span>
                  </div>
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />}
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
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

        {/* Category stat bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-8 grid grid-cols-3 sm:grid-cols-6 gap-3"
        >
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveKey(cat.key)}
              className="rounded-xl border border-border/10 bg-[hsl(225,20%,6%)] p-3 text-center hover:border-border/25 transition-colors"
              style={{ borderColor: activeKey === cat.key ? `${cat.color}30` : undefined }}
            >
              <p className="text-lg font-display font-bold" style={{ color: cat.color }}>{cat.features.length}</p>
              <p className="text-[9px] font-mono text-muted-foreground/50 mt-0.5 leading-tight">{cat.label}</p>
            </button>
          ))}
        </motion.div>
      </div>
    </SectionShell>
  );
}
