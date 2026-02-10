import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, Award, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import { usePersonResearch, type PersonAssessment } from '@/hooks/usePersonResearch';
import { motion } from 'framer-motion';

const TRAJECTORY_STYLES: Record<string, { label: string; className: string }> = {
  rising: { label: 'Rising', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  breakout: { label: 'Breakout', className: 'bg-primary/15 text-primary border-primary/30' },
  peak: { label: 'At Peak', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  steady: { label: 'Steady', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  declining: { label: 'Declining', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  unknown: { label: 'Unknown', className: 'bg-muted text-muted-foreground border-border' },
};

const IMPACT_STYLES: Record<string, { label: string; className: string }> = {
  transformative: { label: 'Transformative', className: 'bg-primary/15 text-primary border-primary/30' },
  strong: { label: 'Strong', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  moderate: { label: 'Moderate', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  marginal: { label: 'Marginal', className: 'bg-muted text-muted-foreground border-border' },
  neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' },
  risky: { label: 'Risky', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface CastInfoDialogProps {
  personName: string;
  reason: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectContext?: {
    title?: string;
    format?: string;
    budget_range?: string;
    genres?: string[];
  };
}

export function CastInfoDialog({ personName, reason, open, onOpenChange, projectContext }: CastInfoDialogProps) {
  const { research, loading, assessments } = usePersonResearch();
  const [hasRequested, setHasRequested] = useState(false);

  const assessment = assessments[personName];
  const isLoading = loading === personName;

  const handleOpen = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (isOpen && !assessment && !hasRequested) {
      setHasRequested(true);
      research(personName, 'cast', projectContext);
    }
  };

  const trajectory = TRAJECTORY_STYLES[assessment?.market_trajectory || 'unknown'] || TRAJECTORY_STYLES.unknown;
  const impact = IMPACT_STYLES[assessment?.packaging_impact || 'neutral'] || IMPACT_STYLES.neutral;

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(personName + ' actor')}`;
  const imdbUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(personName)}&s=nm`;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            {personName}
          </DialogTitle>
        </DialogHeader>

        {/* Quick reason from trends */}
        <p className="text-xs text-muted-foreground leading-relaxed -mt-1">{reason}</p>

        {/* External links for photos/info */}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild className="text-xs">
            <a href={searchUrl} target="_blank" rel="noopener noreferrer">
              <Search className="h-3.5 w-3.5 mr-1" />
              Photos
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild className="text-xs">
            <a href={imdbUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              IMDb
            </a>
          </Button>
        </div>

        {/* AI Assessment */}
        {isLoading && (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Researching {personName}…
          </div>
        )}

        {assessment && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Summary */}
            <p className="text-sm text-foreground leading-relaxed">{assessment.summary}</p>

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <Badge className={`text-[10px] px-2 py-0.5 border ${trajectory.className}`}>
                  {trajectory.label}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5 text-muted-foreground" />
                <Badge className={`text-[10px] px-2 py-0.5 border ${impact.className}`}>
                  {impact.label} Impact
                </Badge>
              </div>
            </div>

            {/* Notable Credits */}
            {assessment.notable_credits.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">Notable Credits</p>
                <div className="flex flex-wrap gap-1.5">
                  {assessment.notable_credits.map((credit, i) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">
                      {credit}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Flags */}
            {assessment.risk_flags.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Risk Flags</p>
                {assessment.risk_flags.map((flag, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{flag}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {!isLoading && !assessment && hasRequested && (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">Could not load assessment.</p>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => research(personName, 'cast', projectContext)}>
              Retry
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
