import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, Award, AlertTriangle, ExternalLink, Search, Users, User, ImageIcon } from 'lucide-react';
import { usePersonResearch, type PersonAssessment, type DisambiguationCandidate } from '@/hooks/usePersonResearch';
import { usePersonImages } from '@/hooks/usePersonImages';
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
  const { research, loading, assessments, candidates, confirmCandidate, clearDisambiguation } = usePersonResearch();
  const [hasRequested, setHasRequested] = useState(false);
  const { images, loading: imagesLoading } = usePersonImages(open ? personName : undefined);
  const [selectedImage, setSelectedImage] = useState<number>(0);

  const assessment = assessments[personName];
  const isLoading = loading === personName;

  const handleOpen = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      clearDisambiguation();
      setSelectedImage(0);
    }
    if (isOpen && !assessment && !hasRequested) {
      setHasRequested(true);
      research(personName, 'cast', projectContext);
    }
  };

  const trajectory = TRAJECTORY_STYLES[assessment?.market_trajectory || 'unknown'] || TRAJECTORY_STYLES.unknown;
  const impact = IMPACT_STYLES[assessment?.packaging_impact || 'neutral'] || IMPACT_STYLES.neutral;

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(personName + ' actor')}&tbm=isch`;
  const imdbUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(personName)}&s=nm`;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            {personName}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4">
          {/* Left: Photos */}
          <div className="space-y-2">
            {/* Main image */}
            <div className="aspect-[3/4] rounded-lg bg-muted overflow-hidden flex items-center justify-center">
              {imagesLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : images.length > 0 ? (
                <img
                  src={images[selectedImage] || images[0]}
                  alt={personName}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <User className="h-12 w-12" />
                  <span className="text-xs">No photo found</span>
                </div>
              )}
            </div>

            {/* Thumbnail strip */}
            {images.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {images.slice(0, 6).map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={`h-12 w-12 rounded-md overflow-hidden shrink-0 border-2 transition-colors ${
                      i === selectedImage ? 'border-primary' : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* External links */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs flex-1" onClick={() => (window.top || window).open(searchUrl, '_blank', 'noopener,noreferrer')}>
                <ImageIcon className="h-3.5 w-3.5 mr-1" />
                More Photos
              </Button>
              <Button size="sm" variant="outline" className="text-xs flex-1" onClick={() => (window.top || window).open(imdbUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                IMDb
              </Button>
            </div>
          </div>

          {/* Right: Info */}
          <div className="space-y-4 min-w-0">
            {/* Quick context from suggestion */}
            <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>

            {/* Project relevance badge */}
            {projectContext?.title && (
              <div className="bg-muted/30 rounded-lg px-3 py-2 text-xs">
                <span className="text-muted-foreground">Assessing fit for </span>
                <span className="text-primary font-semibold">{projectContext.title}</span>
                {projectContext.genres && projectContext.genres.length > 0 && (
                  <span className="text-muted-foreground"> · {projectContext.genres.join(', ')}</span>
                )}
                {projectContext.budget_range && (
                  <span className="text-muted-foreground"> · {projectContext.budget_range}</span>
                )}
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Researching {personName}…
              </div>
            )}

            {/* Disambiguation step */}
            {candidates && candidates.length > 1 && !isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  Multiple people found — which one?
                </div>
                <div className="space-y-2">
                  {candidates.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => confirmCandidate(c)}
                      className="w-full text-left border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    >
                      <p className="text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.descriptor}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Known for: <span className="text-foreground">{c.known_for}</span>
                      </p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* AI Assessment */}
            {assessment && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
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

                {/* Summary */}
                <p className="text-sm text-foreground leading-relaxed">{assessment.summary}</p>

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

            {!isLoading && !assessment && !candidates && hasRequested && (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">Could not load assessment.</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => research(personName, 'cast', projectContext)}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
