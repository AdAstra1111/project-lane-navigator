import { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Lightbulb, Clock, AlertTriangle, TrendingUp, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CastInfoDialog } from '@/components/CastInfoDialog';
import type { ProjectInsights } from '@/lib/project-insights';

const SATURATION_STYLES: Record<string, { label: string; className: string }> = {
  emerging: { label: 'Emerging', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  'well-timed': { label: 'Well-Timed', className: 'bg-primary/15 text-primary border-primary/30' },
  saturated: { label: 'Saturated', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  cooling: { label: 'Cooling', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface ProjectInsightPanelProps {
  insights: ProjectInsights;
  projectContext?: {
    title?: string;
    format?: string;
    budget_range?: string;
    genres?: string[];
  };
}

export function ProjectInsightPanel({ insights, projectContext }: ProjectInsightPanelProps) {
  const { cast, idea, timing } = insights;
  const saturation = SATURATION_STYLES[idea.saturation] || SATURATION_STYLES['well-timed'];
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; reason: string } | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground text-xl">Intelligence Panel</h3>
      </div>

      {/* Cast Intelligence */}
      <div className="glass-card rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Cast Intelligence</h4>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{cast.archetype_guidance}</p>
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{cast.territory_note}</span>
        </div>
        {cast.warning && (
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{cast.warning}</span>
          </div>
        )}
        {cast.suggested_cast.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Suggested Cast Pool</p>
             <div className="space-y-1.5">
              {cast.suggested_cast.map(c => (
                <button
                  key={c.name}
                  onClick={() => setSelectedPerson(c)}
                  className="w-full flex items-start gap-3 text-sm bg-muted/30 hover:bg-muted/50 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer group"
                >
                  <span className="font-medium text-foreground whitespace-nowrap group-hover:text-primary transition-colors">{c.name}</span>
                  <span className="text-muted-foreground text-xs leading-relaxed">{c.reason}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Idea Positioning */}
      <div className="glass-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <h4 className="font-display font-semibold text-foreground">Idea Positioning</h4>
          </div>
          <Badge className={`text-[10px] px-2 py-0.5 border ${saturation.className}`}>
            {saturation.label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{idea.genre_alignment}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{idea.buyer_context}</p>
      </div>

      {/* Timing & Market Window */}
      <div className="glass-card rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Timing & Market Window</h4>
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Optimal Market</p>
            <p className="text-foreground leading-relaxed">{timing.optimal_market}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Financing Window</p>
            <p className="text-foreground leading-relaxed">{timing.financing_window}</p>
          </div>
        </div>
        {timing.risk_signal && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{timing.risk_signal}</span>
          </div>
        )}
      </div>
      {/* Cast Info Dialog */}
      {selectedPerson && (
        <CastInfoDialog
          personName={selectedPerson.name}
          reason={selectedPerson.reason}
          open={!!selectedPerson}
          onOpenChange={(open) => { if (!open) setSelectedPerson(null); }}
          projectContext={projectContext}
        />
      )}
    </motion.div>
  );
}
