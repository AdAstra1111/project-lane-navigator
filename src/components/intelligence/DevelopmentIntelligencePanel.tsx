/**
 * Development Intelligence Panel: Risk Index, Audience Clarity, Commercial Tension.
 * Displays three scored cards with driver lists.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Users, Zap, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { InfoTooltip } from '@/components/InfoTooltip';
import { calculateDevelopmentIntelligence, type DevScoreCard, type DevelopmentIntelligence } from '@/lib/development-intelligence';
import type { Project, FullAnalysis } from '@/lib/types';
import type { ProjectScript } from '@/hooks/useProjectAttachments';

const LEVEL_STYLES = {
  low: 'border-emerald-500/30 bg-emerald-500/5',
  medium: 'border-amber-500/30 bg-amber-500/5',
  high: 'border-orange-500/30 bg-orange-500/5',
  critical: 'border-red-500/30 bg-red-500/5',
};

const LEVEL_BADGE = {
  low: 'bg-emerald-500/15 text-emerald-400',
  medium: 'bg-amber-500/15 text-amber-400',
  high: 'bg-orange-500/15 text-orange-400',
  critical: 'bg-red-500/15 text-red-400',
};

function ScoreGauge({ score, invert }: { score: number; invert?: boolean }) {
  // For risk: high score = bad (red). For clarity/tension: high = good (green)
  const displayScore = score;
  const hue = invert
    ? Math.round((score / 100) * 120) // 0=red, 120=green
    : Math.round(((100 - score) / 100) * 120); // inverted for risk
  const color = `hsl(${hue}, 60%, 45%)`;

  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" stroke="hsl(var(--muted))" strokeWidth="3" fill="none" />
        <motion.circle
          cx="24" cy="24" r="18"
          stroke={color}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 18}
          initial={{ strokeDashoffset: 2 * Math.PI * 18 }}
          animate={{ strokeDashoffset: (2 * Math.PI * 18) * (1 - displayScore / 100) }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold font-mono text-foreground">{displayScore}</span>
      </div>
    </div>
  );
}

function IntelCard({ card, icon: Icon, invert, tooltip }: {
  card: DevScoreCard;
  icon: React.ElementType;
  invert?: boolean;
  tooltip: string;
}) {
  return (
    <div className={`glass-card rounded-xl p-4 border ${LEVEL_STYLES[card.level]}`}>
      <div className="flex items-start gap-3">
        <ScoreGauge score={card.score} invert={invert} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-sm font-display font-semibold text-foreground truncate">{card.label}</h4>
            <InfoTooltip text={tooltip} />
            <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded ${LEVEL_BADGE[card.level]}`}>
              {card.level.toUpperCase()}
            </span>
          </div>
          <ul className="space-y-0.5">
            {card.drivers.map((d, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1">
                <span className="text-muted-foreground/50 mt-0.5">•</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface Props {
  project: Project;
  scripts: ProjectScript[];
  analysis: FullAnalysis | null;
  coverageVerdict?: string;
}

export function DevelopmentIntelligencePanel({ project, scripts, analysis, coverageVerdict }: Props) {
  const intel = useMemo(() =>
    calculateDevelopmentIntelligence(project, scripts, analysis, coverageVerdict),
    [project, scripts, analysis, coverageVerdict]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
    >
      <h3 className="font-display font-semibold text-foreground text-lg px-1">Development Intelligence</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <IntelCard
          card={intel.riskIndex}
          icon={ShieldAlert}
          tooltip="Composite risk based on script status, IP clarity, genre saturation, and analysis flags. Lower is better."
        />
        <IntelCard
          card={intel.audienceClarity}
          icon={Users}
          invert
          tooltip="How clearly your target audience is defined through genre, tone, and audience settings. Higher is better."
        />
        <IntelCard
          card={intel.commercialTension}
          icon={Zap}
          invert
          tooltip="How well the project's creative elements align with commercial viability — lane confidence, budget fit, comparable performance. Higher is better."
        />
      </div>
    </motion.div>
  );
}
