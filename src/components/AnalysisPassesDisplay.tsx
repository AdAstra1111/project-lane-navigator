import { motion } from 'framer-motion';
import { Layers, Sparkles, TrendingUp, Eye } from 'lucide-react';
import { FullAnalysis, StructuralRead, CreativeSignal, MarketReality } from '@/lib/types';

interface PassField {
  label: string;
  value: string;
}

function PassSection({
  title,
  icon: Icon,
  iconColorClass,
  iconBgClass,
  fields,
  index,
}: {
  title: string;
  icon: React.ElementType;
  iconColorClass: string;
  iconBgClass: string;
  fields: PassField[];
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + index * 0.12, duration: 0.3 }}
      className="glass-card rounded-xl p-5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className={`h-9 w-9 rounded-md ${iconBgClass} flex items-center justify-center shrink-0`}>
          <Icon className={`h-4 w-4 ${iconColorClass}`} />
        </div>
        <h4 className="font-display font-semibold text-foreground text-lg">{title}</h4>
      </div>
      <div className="space-y-4 ml-12">
        {fields.map((field) => (
          <div key={field.label}>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">
              {field.label}
            </p>
            <p className="text-sm text-foreground leading-relaxed">{field.value}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function structuralFields(s: StructuralRead): PassField[] {
  return [
    { label: 'Format Detected', value: s.format_detected },
    { label: 'Genre as Written', value: s.genre_as_written },
    { label: 'Protagonist & Goal Clarity', value: s.protagonist_goal_clarity },
    { label: 'Structure Clarity', value: s.structure_clarity },
  ];
}

function creativeFields(c: CreativeSignal): PassField[] {
  return [
    { label: 'Originality / Freshness', value: c.originality },
    { label: 'Tone Consistency', value: c.tone_consistency },
    { label: 'Emotional Engine', value: c.emotional_engine },
    { label: 'Standout Elements', value: c.standout_elements },
  ];
}

function marketFields(m: MarketReality): PassField[] {
  return [
    { label: 'Likely Audience', value: m.likely_audience },
    { label: 'Comparable Titles', value: m.comparable_titles },
    { label: 'Budget Implications', value: m.budget_implications },
    { label: 'Key Commercial Risks', value: m.commercial_risks },
  ];
}

interface AnalysisPassesDisplayProps {
  passes: FullAnalysis;
}

export function AnalysisPassesDisplay({ passes }: AnalysisPassesDisplayProps) {
  return (
    <div className="space-y-4">
      {passes.partial_read && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/20"
        >
          <Eye className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm text-primary font-medium">
            Partial read: first {passes.partial_read.pages_analyzed} of ~{passes.partial_read.total_pages} pages analysed.
          </p>
        </motion.div>
      )}

      <PassSection
        title="Structural Read"
        icon={Layers}
        iconColorClass="text-blue-400"
        iconBgClass="bg-blue-400/10"
        fields={structuralFields(passes.structural_read)}
        index={0}
      />

      <PassSection
        title="Creative Signal"
        icon={Sparkles}
        iconColorClass="text-amber-400"
        iconBgClass="bg-amber-400/10"
        fields={creativeFields(passes.creative_signal)}
        index={1}
      />

      <PassSection
        title="Market Reality"
        icon={TrendingUp}
        iconColorClass="text-emerald-400"
        iconBgClass="bg-emerald-400/10"
        fields={marketFields(passes.market_reality)}
        index={2}
      />
    </div>
  );
}
