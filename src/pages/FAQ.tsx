import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  HelpCircle, Layers, Target, DollarSign, TrendingUp, Brain, Clapperboard,
  ToggleLeft, ChevronRight, BookOpen, Sparkles, Shield, Users, BarChart3,
  ArrowRight, Landmark, Radio, GitBranch, FileText, Zap,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { useUIMode } from '@/hooks/useUIMode';
import heroBoardroom from '@/assets/hero-boardroom.jpg';

/* ── Section definitions ── */

interface HelpSection {
  id: string;
  label: string;
  icon: typeof HelpCircle;
  description: string;
  advancedOnly?: boolean;
  items: { q: string; a: string; advancedOnly?: boolean }[];
}

const sections: HelpSection[] = [
  {
    id: 'what-is-iffy',
    label: 'What is IFFY',
    icon: Sparkles,
    description: 'The fundamentals of IFFY and how it helps producers.',
    items: [
      { q: 'What does IFFY stand for?', a: 'Intelligent Film Flow & Yield — a project intelligence system that guides film and TV projects through six lifecycle stages, from Development through Sales & Delivery.' },
      { q: 'Is IFFY judging my script?', a: 'No. IFFY evaluates the financeability of your project — not the quality of your writing. Script analysis looks at structural clarity, market positioning, and how the material supports packaging decisions.' },
      { q: 'Does IFFY replace sales agents or lawyers?', a: 'Absolutely not. IFFY is a decision-support tool. It helps you prepare your project so conversations with sales agents, lawyers, and financiers are more productive.' },
      { q: 'Is my project data private?', a: 'Yes. Your projects, documents, and analysis are visible only to you and any collaborators you explicitly invite. IFFY does not share project data between users.' },
    ],
  },
  {
    id: 'production-types',
    label: 'Production Types',
    icon: Clapperboard,
    description: 'How IFFY adapts to different production formats.',
    items: [
      { q: 'What production types does IFFY support?', a: 'Feature Film, TV Series, Short Film, Documentary (Feature & Series), Digital Series, Commercial/Advert, Branded Content, Music Video, Vertical Drama, Proof of Concept, and Hybrid. Each type triggers a dedicated rule engine that customises scoring, financing templates, and relevant modules.' },
      { q: 'How does production type affect what I see?', a: 'Every panel, recommendation, and scoring weight adjusts based on your production type. A documentary will never see "sales agent" advice designed for narrative features. A commercial won\'t be shown festival strategy panels.' },
      { q: 'Can I change production type after creation?', a: 'Yes — changing your project\'s format will immediately re-calibrate all scoring weights, relevant modules, and lane classifications to match the new type.' },
    ],
  },
  {
    id: 'modes',
    label: 'Simple vs Advanced',
    icon: ToggleLeft,
    description: 'Two lenses on the same intelligence. Choose your depth.',
    items: [
      { q: 'What\'s the difference between Simple and Advanced?', a: 'Simple mode shows core metrics: Viability Score, Lane, Readiness, Top Actions, and Red Flags. Advanced mode unlocks stage gates, budget assumptions, packaging pipeline, decision journal, deep finance modelling, trend engines, and technical language throughout.' },
      { q: 'Does switching modes change my data?', a: 'No. Same brain, same scoring, same data. Modes only change what you see and how detailed the language is. Nothing is calculated differently.' },
      { q: 'Can I set a different mode per project?', a: 'Yes. Each project can override your global mode preference. This is useful when you want Simple for early-stage ideas but Advanced for projects in active financing.' },
      { q: 'Where do I change my mode?', a: 'Use the Simple/Advanced toggle in the header bar, or go to Settings → Interface Mode for a persistent preference.' },
    ],
  },
  {
    id: 'lanes',
    label: 'Lane System',
    icon: GitBranch,
    description: 'How IFFY classifies projects into monetisation pathways.',
    items: [
      { q: 'What are monetisation lanes?', a: 'IFFY classifies projects into seven lanes: Studio/Streamer, Independent Film, Low-Budget/Microbudget, International Co-Production, Genre/Market-Driven, Prestige/Awards, and Fast-Turnaround. The lane determines which financing strategies, buyer types, and market windows are most relevant.' },
      { q: 'How is my lane determined?', a: 'Lane classification uses a weighted analysis of budget range, genre, target audience, tone, comparable titles, and attached elements. Confidence scores indicate how strongly the project fits its assigned lane.' },
      { q: 'Can I override my lane?', a: 'The lane is a recommendation based on your project metadata. As you change budget, cast, or strategy, the lane classification will naturally shift to reflect the new reality.' },
    ],
  },
  {
    id: 'readiness',
    label: 'Readiness Scoring',
    icon: Target,
    description: 'How IFFY measures project progress across lifecycle stages.',
    items: [
      { q: 'What is a readiness score?', a: 'Each of the six lifecycle stages has a 0–100 readiness score measuring stage-specific criteria. Development scores script quality and audience clarity. Packaging scores cast strength and partner attachments. These six scores roll up into a Master Viability Score.' },
      { q: 'What is the Master Viability Score?', a: 'A weighted composite of all six stage readiness scores. Weights adjust dynamically by production type — a studio feature weights Packaging higher, while a documentary weights Development and Sales more heavily.' },
      { q: 'How does IFFY decide my best next step?', a: 'It identifies the weakest dimension of your current stage\'s readiness score and recommends the single action most likely to improve it. IFFY prioritises impact over volume.' },
      { q: 'What are stage gates?', a: 'Automated rules that determine when a project is ready to advance to the next lifecycle stage. Producers can override gates when needed.', advancedOnly: true },
    ],
  },
  {
    id: 'finance',
    label: 'Finance Modelling',
    icon: DollarSign,
    description: 'Capital stacks, deal tracking, and greenlight probability.',
    advancedOnly: true,
    items: [
      { q: 'What is the Finance Tracker?', a: 'Log and manage all financing across six categories: Sales & Distribution, Equity & Investment, Tax Incentives, Soft Money, Gap & Debt, and Other. Each category tracks individual deals with status, amounts, and counterparties.' },
      { q: 'How are deal totals calculated?', a: 'IFFY aggregates the minimum guarantee amounts of all closed deals across each financing category. The waterfall chart visualises these totals against your budget to identify the remaining gap.' },
      { q: 'What is Greenlight Probability?', a: 'A 0–100 score grading how closeable your finance plan is, based on budget completeness, capital stack coverage, deal pipeline strength, and structural risk factors.' },
      { q: 'What is the Co-Production Planner?', a: 'Evaluates official treaty frameworks, eligible countries, share percentages, and cultural requirements relevant to your project. Model co-production structures before engaging legal counsel.' },
    ],
  },
  {
    id: 'trends',
    label: 'Trend Intelligence',
    icon: TrendingUp,
    description: 'Stage-aware market signals and trend viability scoring.',
    advancedOnly: true,
    items: [
      { q: 'What are trend signals?', a: 'Patterns detected across multiple independent sources — buyer appetite shifts, genre cycles, cast momentum, and market behaviours. IFFY requires signals to appear across three or more sources before surfacing them.' },
      { q: 'How are trends stage-aware?', a: 'IFFY prioritises different intelligence layers by lifecycle stage. In Development, narrative and genre trends dominate. In Packaging, talent heat and buyer appetite take priority. In Sales, platform demand and territory pricing are emphasised.' },
      { q: 'What is the Trend Viability Score?', a: 'A normalised 0–100 score calculated from a weighted sum across four layers: Market, Narrative, Talent, and Platform. Weights are mapped per production type. This score contributes 30% to overall Readiness.' },
      { q: 'What is Confidence Decay?', a: 'Engine reliability scores automatically degrade from High to Low based on data staleness relative to refresh frequency. This ensures IFFY never presents stale data as current intelligence.' },
    ],
  },
  {
    id: 'how-iffy-thinks',
    label: 'How IFFY Thinks',
    icon: Brain,
    description: 'Transparency into IFFY\'s scoring architecture.',
    items: [
      { q: 'How does IFFY calculate scores?', a: 'Every score in IFFY is a weighted composite of measurable inputs — never a black box. Stage readiness scores weight specific metrics (script clarity, cast strength, budget coverage). The Master Viability Score weights stage scores by production type. All weights are documented and adjustable.' },
      { q: 'Does IFFY use AI?', a: 'Yes — for script analysis, trend detection, casting suggestions, buyer matching, and comp analysis. But AI generates recommendations and signals, never final scores. Scores are deterministic calculations based on your project data.' },
      { q: 'Can I see exactly what drives a score?', a: 'Yes. Every readiness score shows its component breakdown — what\'s contributing, what\'s missing, and exactly how much each dimension matters. Nothing is hidden.' },
      { q: 'How does production type affect scoring?', a: 'Each production type has a unique weight profile. Feature Films weight Packaging at ~25% of Master Viability, while Documentaries weight Development at ~30%. These weights reflect industry-specific financing realities.' },
    ],
  },
];

/* ── Tutorials ── */

interface Tutorial {
  id: string;
  label: string;
  icon: typeof HelpCircle;
  description: string;
  advancedOnly?: boolean;
  steps: string[];
}

const tutorials: Tutorial[] = [
  {
    id: 'project-creation',
    label: 'Project Creation',
    icon: FileText,
    description: 'Create your first project and understand the living dossier.',
    steps: [
      'Click "New Project" from the header or dashboard.',
      'Enter your project title, format, genres, budget range, and target audience.',
      'IFFY will classify your project into a monetisation lane with a confidence score.',
      'Upload scripts or documents to unlock deeper analysis and readiness scoring.',
      'Your project is now a living dossier — every change updates the assessment automatically.',
    ],
  },
  {
    id: 'lane-logic',
    label: 'Lane Logic',
    icon: GitBranch,
    description: 'Understand how lanes shape your financing pathway.',
    steps: [
      'Your lane is assigned automatically based on budget, genre, audience, and tone.',
      'Each lane maps to different buyer types, market windows, and financing strategies.',
      'As you attach cast, adjust budget, or refine your strategy, the lane may shift.',
      'Use the lane badge on your project overview to see your current classification and confidence.',
      'Lane classification directly influences which modules and recommendations IFFY surfaces.',
    ],
  },
  {
    id: 'readiness-score',
    label: 'Readiness Score',
    icon: Target,
    description: 'How to read and improve your readiness scores.',
    steps: [
      'Each of six lifecycle stages has its own 0–100 readiness score.',
      'Click into any stage to see the breakdown — strengths, weaknesses, and blockers.',
      'The "best next step" recommendation targets the single action with highest impact.',
      'All six stage scores roll up into the Master Viability Score on your Overview.',
      'Track progress over time with sparkline charts that show score history.',
    ],
  },
  {
    id: 'advanced-finance',
    label: 'Advanced Finance Tools',
    icon: DollarSign,
    description: 'Deep-dive into capital stacks, scenarios, and waterfall modelling.',
    advancedOnly: true,
    steps: [
      'Navigate to the Financing layer to see your full capital stack.',
      'Add deals across six categories: Sales, Equity, Incentives, Soft Money, Gap, and Other.',
      'Each deal tracks status (pipeline, term-sheet, closed), amounts, and counterparties.',
      'The waterfall chart visualises closed vs. pipeline financing against your budget.',
      'Use Finance Scenarios to model what-if capital structures and compare gap positions.',
      'The Greenlight Probability score (0–100) grades how closeable your plan is.',
    ],
  },
  {
    id: 'trend-intelligence',
    label: 'Trend Intelligence',
    icon: TrendingUp,
    description: 'Leverage stage-aware market signals to time your moves.',
    advancedOnly: true,
    steps: [
      'Navigate to Trends from the header to see active story, cast, and market signals.',
      'Each signal includes source count, velocity, confidence, and timing window.',
      'Trends are matched to your projects automatically based on genre, format, and stage.',
      'The Trend Viability Score (0–100) contributes 30% to your project\'s overall Readiness.',
      'Confidence Decay ensures stale data is flagged — never presented as current intelligence.',
      'Override AI-generated scores manually when you have superior market knowledge.',
    ],
  },
];

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { delay, duration: 0.4 },
});

export default function FAQ() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const { mode } = useUIMode();
  const isAdvanced = mode === 'advanced';

  const visibleSections = sections.filter(s => !s.advancedOnly || isAdvanced);
  const visibleTutorials = tutorials.filter(t => !t.advancedOnly || isAdvanced);
  const currentSection = visibleSections.find(s => s.id === activeSection);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="relative h-[300px] sm:h-[360px] overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroBoardroom} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/30" />
        </div>
        <div className="relative z-10 container max-w-4xl h-full flex flex-col justify-end pb-10">
          <motion.div {...fadeUp()} className="space-y-3">
            <p className="text-xs font-display uppercase tracking-[0.25em] text-primary">Help Centre</p>
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
              Learn IFFY
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl">
              Structured guides, tutorials, and transparency into how IFFY works.
            </p>
          </motion.div>
        </div>
      </section>

      <main className="container max-w-4xl py-10 space-y-12">
        {/* Section Nav Grid */}
        {!currentSection && (
          <>
            {/* Knowledge Base */}
            <motion.div {...fadeUp(0.1)} className="space-y-6">
              <div>
                <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-1">Knowledge Base</p>
                <h2 className="text-2xl font-display font-bold text-foreground tracking-tight">
                  Explore by topic
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {visibleSections.map((section, i) => (
                  <motion.button
                    key={section.id}
                    {...fadeUp(0.15 + i * 0.03)}
                    onClick={() => setActiveSection(section.id)}
                    className="group text-left glass-card rounded-xl p-5 space-y-2 hover:border-primary/30 transition-all duration-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                          <section.icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-display font-semibold text-foreground text-sm">{section.label}</h3>
                          {section.advancedOnly && (
                            <Badge variant="outline" className="text-[9px] mt-0.5">Advanced</Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{section.description}</p>
                  </motion.button>
                ))}
              </div>
            </motion.div>

            {/* Tutorials */}
            <motion.div {...fadeUp(0.2)} className="space-y-6">
              <div>
                <p className="text-xs font-display uppercase tracking-[0.2em] text-primary mb-1">Tutorials</p>
                <h2 className="text-2xl font-display font-bold text-foreground tracking-tight">
                  Step-by-step guides
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleTutorials.map((tutorial, i) => (
                  <motion.div
                    key={tutorial.id}
                    {...fadeUp(0.25 + i * 0.03)}
                    className="glass-card rounded-xl p-5 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <tutorial.icon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-display font-semibold text-foreground text-sm">{tutorial.label}</h3>
                        {tutorial.advancedOnly && (
                          <Badge variant="outline" className="text-[9px]">Advanced</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{tutorial.description}</p>
                    <ol className="space-y-2 pt-1">
                      {tutorial.steps.map((step, si) => (
                        <li key={si} className="flex gap-2.5 text-xs text-muted-foreground leading-relaxed">
                          <span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                            {si + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* How IFFY Thinks CTA */}
            <motion.div {...fadeUp(0.3)}>
              <Link to="/how-iffy-thinks">
                <div className="glass-card rounded-xl p-6 sm:p-8 flex items-center gap-5 group hover:border-primary/30 transition-all cursor-pointer">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <Brain className="h-7 w-7 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display font-bold text-foreground text-lg">How IFFY Thinks</h3>
                    <p className="text-sm text-muted-foreground">
                      Full transparency into scoring architecture, weight profiles, and AI boundaries.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            </motion.div>
          </>
        )}

        {/* Section Detail View */}
        {currentSection && (
          <motion.div {...fadeUp()} className="space-y-6">
            <button
              onClick={() => setActiveSection(null)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
              Back to Help Centre
            </button>

            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <currentSection.icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground tracking-tight">
                  {currentSection.label}
                </h2>
                <p className="text-sm text-muted-foreground">{currentSection.description}</p>
              </div>
            </div>

            <Accordion type="multiple" className="space-y-2">
              {currentSection.items
                .filter(item => !item.advancedOnly || isAdvanced)
                .map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
                  className="glass-card rounded-xl border-none"
                >
                  <AccordionTrigger className="px-6 py-5 hover:no-underline text-left gap-3">
                    <span className="font-display font-semibold text-foreground text-[15px] leading-snug">
                      {item.q}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-5 pt-0">
                    <div className="border-l-2 border-primary/30 pl-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        )}
      </main>
    </div>
  );
}
