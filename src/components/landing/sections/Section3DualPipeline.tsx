import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import {
  ScrollText, Users, Clapperboard, DollarSign, MapPin,
  Calculator, BarChart3, Shield, Package, Layers,
  Sparkles, FileText, Target, BookOpen, LayoutGrid,
  Zap, UsersRound, ArrowRight
} from 'lucide-react';

interface PipelineNode {
  icon: any;
  label: string;
  description: string;
  color: string;
}

const prestigeNodes: PipelineNode[] = [
  { icon: ScrollText, label: 'Script Intake', description: 'Ingest existing screenplay with full structural analysis', color: 'hsl(38,60%,52%)' },
  { icon: Sparkles, label: 'Creative Development', description: 'Guided story architecture and narrative refinement', color: 'hsl(38,60%,52%)' },
  { icon: Users, label: 'Cast Attachments', description: 'Strategic casting aligned with market positioning', color: 'hsl(200,65%,55%)' },
  { icon: Clapperboard, label: 'Director / Producer', description: 'Attach key creative and producing elements', color: 'hsl(200,65%,55%)' },
  { icon: Calculator, label: 'Budget Creation', description: 'Production budget modelling with scenario analysis', color: 'hsl(150,55%,50%)' },
  { icon: BarChart3, label: 'Production Schedule', description: 'Detailed shooting schedule and resource planning', color: 'hsl(150,55%,50%)' },
  { icon: LayoutGrid, label: 'Shot Lists', description: 'Scene-by-scene shot breakdown with visual references', color: 'hsl(280,55%,60%)' },
  { icon: MapPin, label: 'Location Strategy', description: 'Tax-optimised location selection and scouting', color: 'hsl(280,55%,60%)' },
  { icon: DollarSign, label: 'Tax Credits', description: 'Maximise incentive returns across territories', color: 'hsl(350,60%,55%)' },
  { icon: Shield, label: 'Co-Production', description: 'Treaty-compliant co-production structuring', color: 'hsl(350,60%,55%)' },
  { icon: Package, label: 'Finance Structure', description: 'Multi-source financing with waterfall modelling', color: 'hsl(38,60%,52%)' },
  { icon: Layers, label: 'Investor Package', description: 'Auto-assembled investor-ready project package', color: 'hsl(38,60%,52%)' },
];

const verticalNodes: PipelineNode[] = [
  { icon: Sparkles, label: 'Idea Generation', description: 'AI-assisted concept development and validation', color: 'hsl(38,60%,52%)' },
  { icon: FileText, label: 'Concept Brief', description: 'Structured concept with market positioning', color: 'hsl(38,60%,52%)' },
  { icon: Target, label: 'Market Fit Analysis', description: 'Audience and platform alignment scoring', color: 'hsl(200,65%,55%)' },
  { icon: BookOpen, label: 'Character Bible', description: 'Standardised character development system', color: 'hsl(200,65%,55%)' },
  { icon: LayoutGrid, label: 'Episode Grid', description: 'Multi-episode narrative architecture', color: 'hsl(150,55%,50%)' },
  { icon: Zap, label: 'Rapid Script Gen', description: 'Fast-turnaround episodic script production', color: 'hsl(150,55%,50%)' },
  { icon: LayoutGrid, label: 'Storyboards', description: 'Visual production direction at scale', color: 'hsl(280,55%,60%)' },
  { icon: BarChart3, label: 'Production Planning', description: 'Standardised production scheduling', color: 'hsl(280,55%,60%)' },
  { icon: UsersRound, label: 'Multi-Team Coord', description: 'Parallel production team management', color: 'hsl(350,60%,55%)' },
  { icon: Clapperboard, label: 'Fast Production', description: 'Rapid turnaround production execution', color: 'hsl(350,60%,55%)' },
];

function PipelineColumn({ title, subtitle, nodes }: { title: string; subtitle: string; nodes: PipelineNode[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="flex-1 min-w-[300px]">
      <h3 className="text-xl sm:text-2xl font-display font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-8">{subtitle}</p>
      <div className="space-y-1">
        {nodes.map((node, i) => {
          const Icon = node.icon;
          const isHovered = hoveredIdx === i;
          return (
            <motion.div
              key={node.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300 cursor-default ${isHovered ? 'border-primary/30 bg-primary/5' : 'border-transparent bg-transparent'}`}
            >
              <div
                className="h-10 w-10 rounded-xl border flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `color-mix(in srgb, ${node.color} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${node.color} 25%, transparent)`,
                }}
              >
                <Icon className="h-4 w-4" style={{ color: node.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-display font-medium text-foreground">{node.label}</p>
                <AnimatePresence>
                  {isHovered && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-xs text-muted-foreground overflow-hidden"
                    >
                      {node.description}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              {i < nodes.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground/20 shrink-0" />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function Section3DualPipeline() {
  return (
    <SectionShell id="dual-pipeline" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-16">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Production Models</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Two Pipelines. One System.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
          From prestige features to rapid vertical drama — IFFY adapts to your production model.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-12 lg:gap-16">
        <PipelineColumn
          title="Prestige Film"
          subtitle="Existing script → Production ready"
          nodes={prestigeNodes}
        />
        <div className="hidden lg:flex items-center">
          <div className="w-px h-full bg-gradient-to-b from-transparent via-primary/20 to-transparent" />
        </div>
        <PipelineColumn
          title="Vertical Drama"
          subtitle="Idea generation → Fast production"
          nodes={verticalNodes}
        />
      </div>
    </SectionShell>
  );
}
