import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Target, MapPin, Handshake, Loader2, Search, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBuyerMatches, useResearchBuyers } from '@/hooks/useBuyerMatches';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BuyerMatch } from '@/lib/buyer-matcher';

const TYPE_LABELS: Record<string, string> = {
  distributor: 'Distributor',
  'sales-agent': 'Sales Agent',
  streamer: 'Streamer',
  broadcaster: 'Broadcaster',
  financier: 'Financier',
  studio: 'Studio',
};

const TYPE_COLORS: Record<string, string> = {
  distributor: 'bg-primary/15 text-primary border-primary/30',
  'sales-agent': 'bg-accent/15 text-accent border-accent/30',
  streamer: 'bg-lane-studio/15 text-lane-studio border-lane-studio/30',
  broadcaster: 'bg-lane-copro/15 text-lane-copro border-lane-copro/30',
  financier: 'bg-lane-lowbudget/15 text-lane-lowbudget border-lane-lowbudget/30',
  studio: 'bg-lane-prestige/15 text-lane-prestige border-lane-prestige/30',
};

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700"
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-medium text-foreground w-8 text-right">{score}%</span>
    </div>
  );
}

function BuyerCard({ match, index }: { match: BuyerMatch; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="glass-card rounded-lg p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <h4 className="font-display font-semibold text-foreground text-sm truncate">
              {match.buyerName}
            </h4>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[match.companyType] || ''}`}>
              {TYPE_LABELS[match.companyType] || match.companyType}
            </Badge>
          </div>
          <ScoreBar score={match.score} />
        </div>
      </div>

      {/* Match reasons */}
      <div className="flex flex-wrap gap-1 mt-2.5">
        {match.matchReasons.map((reason, i) => (
          <span key={i} className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
            {reason}
          </span>
        ))}
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Less' : 'More'}
      </button>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-3 pt-3 border-t border-border/30 space-y-2.5 text-xs"
        >
          {match.appetiteNotes && (
            <div>
              <p className="text-muted-foreground mb-0.5 flex items-center gap-1">
                <Target className="h-3 w-3" /> Current appetite
              </p>
              <p className="text-foreground leading-relaxed">{match.appetiteNotes}</p>
            </div>
          )}
          {match.recentAcquisitions && (
            <div>
              <p className="text-muted-foreground mb-0.5">Recent acquisitions</p>
              <p className="text-foreground leading-relaxed">{match.recentAcquisitions}</p>
            </div>
          )}
          {match.territories.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-0.5 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Territories
              </p>
              <p className="text-foreground">{match.territories.join(', ')}</p>
            </div>
          )}
          {match.dealTypes.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-0.5 flex items-center gap-1">
                <Handshake className="h-3 w-3" /> Deal types
              </p>
              <div className="flex flex-wrap gap-1">
                {match.dealTypes.map((dt) => (
                  <Badge key={dt} variant="outline" className="text-[10px] px-1.5 py-0">
                    {dt}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {match.marketPresence && (
            <div>
              <p className="text-muted-foreground mb-0.5">Market presence</p>
              <p className="text-foreground">{match.marketPresence}</p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

interface ProjectBuyerMatchesProps {
  project: {
    id: string;
    format: string;
    genres: string[];
    budget_range: string;
    tone: string;
    target_audience: string;
    assigned_lane: string | null;
  };
}

export function ProjectBuyerMatches({ project }: ProjectBuyerMatchesProps) {
  const { matches, buyersLoading, hasBuyers } = useBuyerMatches(project);
  const { research, isResearching } = useResearchBuyers();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(true);

  const handleResearch = async () => {
    try {
      await research(project);
      queryClient.invalidateQueries({ queryKey: ['market-buyers'] });
      toast.success('Buyer research complete');
    } catch (e: any) {
      toast.error(e.message || 'Research failed');
    }
  };

  const displayedMatches = collapsed ? matches.slice(0, 3) : matches;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-lg">Buyer Matches</h3>
          {matches.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {matches.length}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResearch}
          disabled={isResearching}
          className="text-xs"
        >
          {isResearching ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Researching…
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3 mr-1" />
              {hasBuyers ? 'Refresh' : 'Research Buyers'}
            </>
          )}
        </Button>
      </div>

      {buyersLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : !hasBuyers ? (
        <div className="text-center py-8">
          <Building2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No buyer data yet</p>
          <p className="text-xs text-muted-foreground/60">
            Click "Research Buyers" to discover distributors, sales agents, and financiers that match your project.
          </p>
        </div>
      ) : matches.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground">No strong matches found. Try refining project details or refreshing buyer data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedMatches.map((match, i) => (
            <BuyerCard key={match.buyerId} match={match} index={i} />
          ))}
          {matches.length > 3 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <>
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />
                  Show all {matches.length} matches
                </>
              ) : (
                <>
                  <ChevronUp className="h-3.5 w-3.5 mr-1" />
                  Show fewer
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
