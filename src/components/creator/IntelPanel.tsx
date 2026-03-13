/**
 * IntelPanel — Contextual intelligence right panel for the Creator UI.
 * Shows market signals, CI/GP scores, and narrative flags relevant to current stage.
 */
import { TrendingUp, AlertTriangle, BarChart2, Target, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IntelPanelProps {
  projectId: string;
  activeStage?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Placeholder data structure — will be wired to live CI/GP + trends data
interface IntelData {
  ciScore?: number;
  gpScore?: number;
  ciDelta?: number;
  marketSignals?: { text: string; type: 'warning' | 'positive' | 'neutral' }[];
  narrativeFlags?: { episode?: number; text: string; severity: 'warning' | 'info' }[];
  compTitles?: { title: string; year: number; note: string }[];
}

function getPlaceholderIntel(stage?: string): IntelData {
  if (!stage || stage === 'idea' || stage === 'concept_brief') {
    return {
      ciScore: 74,
      gpScore: 68,
      ciDelta: 6,
      marketSignals: [
        { text: '3 kidnap thrillers greenlit this quarter — saturation risk', type: 'warning' },
        { text: 'Vertical drama performing +40% vs last year on TikTok/Reels', type: 'positive' },
      ],
      compTitles: [
        { title: 'Stolen', year: 2024, note: 'Netflix · similar premise · $40M' },
        { title: 'The Arrangement', year: 2023, note: 'Webtoon · 62 eps · 8.1 IMDB' },
      ],
    };
  }
  if (stage === 'season_script' || stage === 'vertical_episode_beats') {
    return {
      ciScore: 87,
      gpScore: 91,
      ciDelta: 13,
      narrativeFlags: [
        { episode: 3, text: 'Weak cold open — stakes not established fast enough', severity: 'warning' },
        { episode: 14, text: 'CI dip — pacing slows across 3 consecutive episodes', severity: 'warning' },
        { episode: 27, text: 'Strongest episode in the season', severity: 'info' },
        { episode: 20, text: 'Character arc stalls — no meaningful decision point', severity: 'warning' },
      ],
    };
  }
  return {
    ciScore: 81,
    gpScore: 79,
    ciDelta: 8,
    marketSignals: [
      { text: 'Format rules approved — strong commercial positioning', type: 'positive' },
    ],
  };
}

export function IntelPanel({ projectId, activeStage, collapsed, onToggle }: IntelPanelProps) {
  const intel = getPlaceholderIntel(activeStage);

  return (
    <div className={cn(
      "relative h-full border-l border-border/20 bg-background/50 transition-all duration-300 flex flex-col",
      collapsed ? "w-8" : "w-60"
    )}>
      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -left-3 top-6 z-10 h-6 w-6 rounded-full border border-border/40 bg-background flex items-center justify-center hover:bg-muted transition-colors"
      >
        <ChevronLeft className={cn(
          "h-3 w-3 text-muted-foreground transition-transform duration-300",
          collapsed && "rotate-180"
        )} />
      </button>

      {collapsed ? null : (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* CI / GP scores */}
          {(intel.ciScore !== undefined || intel.gpScore !== undefined) && (
            <section>
              <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2.5 font-medium">
                Scores
              </h4>
              <div className="space-y-2">
                {intel.ciScore !== undefined && (
                  <ScoreBar
                    label="CI (Creative Integrity)"
                    value={intel.ciScore}
                    delta={intel.ciDelta}
                    color="amber"
                  />
                )}
                {intel.gpScore !== undefined && (
                  <ScoreBar
                    label="GP (Greenlight Probability)"
                    value={intel.gpScore}
                    color="emerald"
                  />
                )}
              </div>
            </section>
          )}

          {/* Narrative flags */}
          {intel.narrativeFlags && intel.narrativeFlags.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2.5 font-medium flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Episode Health
              </h4>
              <div className="space-y-1.5">
                {intel.narrativeFlags.map((flag, i) => (
                  <div key={i} className={cn(
                    "rounded p-2 text-[11px] leading-snug",
                    flag.severity === 'warning' ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-400"
                  )}>
                    {flag.episode && (
                      <span className="font-medium">Ep {flag.episode} — </span>
                    )}
                    {flag.text}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Market signals */}
          {intel.marketSignals && intel.marketSignals.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2.5 font-medium flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Market Signal
              </h4>
              <div className="space-y-1.5">
                {intel.marketSignals.map((s, i) => (
                  <div key={i} className={cn(
                    "rounded p-2 text-[11px] leading-snug",
                    s.type === 'warning' && "bg-red-500/10 text-red-300",
                    s.type === 'positive' && "bg-emerald-500/10 text-emerald-400",
                    s.type === 'neutral' && "bg-muted text-muted-foreground"
                  )}>
                    {s.text}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Comp titles */}
          {intel.compTitles && intel.compTitles.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2.5 font-medium flex items-center gap-1">
                <Target className="h-3 w-3" /> Comp Titles
              </h4>
              <div className="space-y-1.5">
                {intel.compTitles.map((c, i) => (
                  <div key={i} className="text-[11px] leading-snug">
                    <span className="text-foreground font-medium">{c.title}</span>
                    <span className="text-muted-foreground"> ({c.year})</span>
                    <div className="text-muted-foreground/70 mt-0.5">{c.note}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBar({
  label,
  value,
  delta,
  color,
}: {
  label: string;
  value: number;
  delta?: number;
  color: 'amber' | 'emerald';
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <span className={cn(
            "text-xs font-semibold tabular-nums",
            color === 'amber' ? "text-amber-400" : "text-emerald-400"
          )}>
            {value}
          </span>
          {delta !== undefined && (
            <span className="text-[9px] text-emerald-400">↑{delta}</span>
          )}
        </div>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            color === 'amber' ? "bg-amber-400" : "bg-emerald-400"
          )}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
