import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { ChevronRight, Package } from 'lucide-react';

/** Output docs that should appear as parallel deliverables, not ladder stages */
const OUTPUT_DOCS = new Set(['Market Sheet', 'Deck']);

interface Pipeline {
  key: string;
  label: string;
  badge?: string;
  color: string;
  stages: string[];
}

const PIPELINES: Pipeline[] = [
  {
    key: 'film',
    label: 'Feature Film',
    color: 'hsl(38,60%,52%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Treatment', 'Story Outline', 'Character Bible', 'Beat Sheet', 'Feature Script', 'Production Draft', 'Deck'],
  },
  {
    key: 'vertical-drama',
    label: 'Vertical Drama',
    badge: 'Mobile-First',
    color: 'hsl(200,65%,55%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Format Rules', 'Character Bible', 'Season Arc', 'Episode Grid', 'Episode Beats', 'Season Scripts'],
  },
  {
    key: 'tv-series',
    label: 'TV Series',
    badge: 'Long-Form',
    color: 'hsl(280,55%,60%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Treatment', 'Story Outline', 'Character Bible', 'Beat Sheet', 'Episode Beats', 'Episode Script', 'Season Master Script', 'Production Draft'],
  },
  {
    key: 'limited-series',
    label: 'Limited Series',
    badge: 'Prestige TV',
    color: 'hsl(350,60%,55%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Treatment', 'Story Outline', 'Character Bible', 'Beat Sheet', 'Episode Beats', 'Episode Script', 'Season Master Script', 'Production Draft'],
  },
  {
    key: 'documentary',
    label: 'Documentary',
    badge: 'Non-Fiction',
    color: 'hsl(150,55%,50%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Documentary Outline', 'Deck'],
  },
  {
    key: 'animation',
    label: 'Animation',
    badge: 'Animated',
    color: 'hsl(60,65%,50%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Treatment', 'Character Bible', 'Beat Sheet', 'Feature Script'],
  },
  {
    key: 'reality',
    label: 'Reality / Unscripted',
    badge: 'Unscripted',
    color: 'hsl(25,70%,55%)',
    stages: ['Idea', 'Concept Brief', 'Market Sheet', 'Treatment', 'Beat Sheet', 'Episode Beats', 'Episode Script'],
  },
  {
    key: 'short',
    label: 'Short Film',
    badge: 'Festival',
    color: 'hsl(170,55%,48%)',
    stages: ['Idea', 'Concept Brief', 'Feature Script'],
  },
];

export function Section3DualPipeline() {
  const [active, setActive] = useState(0);
  const pipeline = PIPELINES[active];

  const ladderStages = pipeline.stages.filter(s => !OUTPUT_DOCS.has(s));
  const outputStages = pipeline.stages.filter(s => OUTPUT_DOCS.has(s));

  return (
    <SectionShell id="pipelines" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-12">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Production Formats</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          One System. Every Format.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          IFFY builds the right pipeline for your project type — feature, series, vertical, documentary and more.
        </p>
      </div>

      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        {/* Format selector */}
        <div className="flex flex-wrap gap-2 justify-center">
          {PIPELINES.map((p, i) => (
            <button
              key={p.key}
              onClick={() => setActive(i)}
              className="relative px-3 py-1.5 rounded-full text-xs font-display font-medium transition-all duration-200"
              style={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: active === i ? p.color : 'hsl(225,20%,20%)',
                color: active === i ? p.color : 'hsl(225,10%,55%)',
                background: active === i ? `${p.color}15` : 'transparent',
              }}
            >
              {p.label}
              {active === i && (
                <motion.span
                  layoutId="badge"
                  className="ml-1.5 text-[9px] uppercase tracking-wider opacity-70"
                >
                  {p.badge}
                </motion.span>
              )}
            </button>
          ))}
        </div>

        {/* Pipeline stages display */}
        <AnimatePresence mode="wait">
          <motion.div
            key={pipeline.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-6"
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: pipeline.color, boxShadow: `0 0 8px ${pipeline.color}` }}
              />
              <span className="font-display font-semibold text-foreground">{pipeline.label}</span>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                style={{ borderColor: `${pipeline.color}40`, color: pipeline.color, background: `${pipeline.color}10` }}
              >
                {ladderStages.length} stages
              </span>
            </div>

            {/* Ladder stage flow */}
            <div className="flex flex-wrap items-center gap-y-3 gap-x-1">
              {ladderStages.map((stage, i) => (
                <div key={stage} className="flex items-center gap-1">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06, duration: 0.3 }}
                    className="rounded-lg border px-3 py-1.5 text-xs font-mono"
                    style={{
                      borderColor: i === 0 ? `${pipeline.color}60` : 'hsl(225,20%,18%)',
                      background: i === 0 ? `${pipeline.color}12` : 'hsl(225,20%,8%)',
                      color: i === 0 ? pipeline.color : 'hsl(225,10%,65%)',
                    }}
                  >
                    {stage}
                  </motion.div>
                  {i < ladderStages.length - 1 && (
                    <ChevronRight className="h-3 w-3 flex-shrink-0" style={{ color: `${pipeline.color}30` }} />
                  )}
                </div>
              ))}
            </div>

            {/* Output documents — parallel deliverables */}
            {outputStages.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: ladderStages.length * 0.06 + 0.1, duration: 0.3 }}
                className="mt-4 pt-4 border-t border-border/10"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <Package className="h-3 w-3" style={{ color: `${pipeline.color}60` }} />
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: `${pipeline.color}50` }}>
                    Packaging Outputs
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {outputStages.map((stage, i) => (
                    <motion.div
                      key={stage}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: ladderStages.length * 0.06 + 0.15 + i * 0.06, duration: 0.3 }}
                      className="rounded-lg border border-dashed px-3 py-1.5 text-xs font-mono"
                      style={{
                        borderColor: `${pipeline.color}25`,
                        background: `${pipeline.color}06`,
                        color: `${pipeline.color}90`,
                      }}
                    >
                      {stage}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Format summary grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PIPELINES.map((p, i) => {
            const count = p.stages.filter(s => !OUTPUT_DOCS.has(s)).length;
            return (
              <motion.button
                key={p.key}
                onClick={() => setActive(i)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="rounded-xl border p-3 text-left transition-all duration-200"
                style={{
                  borderColor: active === i ? `${p.color}40` : 'hsl(225,20%,14%)',
                  background: active === i ? `${p.color}08` : 'hsl(225,20%,6%)',
                }}
              >
                <p className="text-[10px] font-mono mb-1" style={{ color: p.color }}>{p.badge}</p>
                <p className="text-xs font-display text-foreground/80 leading-tight">{p.label}</p>
                <p className="text-[10px] text-muted-foreground/40 mt-1">{count} stages</p>
              </motion.button>
            );
          })}
        </div>
      </div>
    </SectionShell>
  );
}
