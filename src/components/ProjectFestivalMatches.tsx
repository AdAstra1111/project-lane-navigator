import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, MapPin, Clock, ExternalLink, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Festival {
  name: string;
  location: string;
  type: 'premiere' | 'market' | 'hybrid';
  dates: string;
  submissionDeadline: string;
  deadlineDate: Date;
  marketDates?: string;
  notes: string;
  url: string;
  // Matching metadata
  laneAffinity: string[];
  formatAffinity: string[];
  genreAffinity: string[];
  budgetAffinity: string[];
  stageAffinity: string[];
}

const FESTIVALS: Festival[] = [
  {
    name: 'Sundance Film Festival',
    location: 'Park City, USA',
    type: 'premiere',
    dates: 'Jan 16–26, 2026',
    submissionDeadline: 'Sep 12, 2025',
    deadlineDate: new Date('2025-09-12'),
    notes: 'Key launchpad for independent films. Early submissions preferred.',
    url: 'https://www.sundance.org',
    laneAffinity: ['independent-film', 'low-budget', 'prestige-awards'],
    formatAffinity: ['film'],
    genreAffinity: ['drama', 'documentary', 'thriller', 'comedy', 'horror'],
    budgetAffinity: ['micro', 'low', 'medium'],
    stageAffinity: ['packaging', 'financing', 'pre-production'],
  },
  {
    name: 'Berlin International Film Festival',
    location: 'Berlin, Germany',
    type: 'hybrid',
    dates: 'Feb 12–22, 2026',
    submissionDeadline: 'Oct 6, 2025',
    deadlineDate: new Date('2025-10-06'),
    marketDates: 'Feb 12–16, 2026 (EFM)',
    notes: 'European Film Market runs parallel. Strong for arthouse and co-productions.',
    url: 'https://www.berlinale.de',
    laneAffinity: ['international-copro', 'prestige-awards', 'independent-film'],
    formatAffinity: ['film', 'tv-series'],
    genreAffinity: ['drama', 'documentary', 'political', 'social realism', 'arthouse'],
    budgetAffinity: ['low', 'medium', 'high'],
    stageAffinity: ['development', 'packaging', 'financing'],
  },
  {
    name: 'SXSW Film & TV Festival',
    location: 'Austin, USA',
    type: 'premiere',
    dates: 'Mar 7–15, 2026',
    submissionDeadline: 'Oct 20, 2025',
    deadlineDate: new Date('2025-10-20'),
    notes: 'Genre-friendly. Great for buzz and audience discovery. Episodic pilot track.',
    url: 'https://www.sxsw.com',
    laneAffinity: ['genre-market', 'fast-turnaround', 'independent-film'],
    formatAffinity: ['film', 'tv-series'],
    genreAffinity: ['horror', 'sci-fi', 'comedy', 'thriller', 'animation', 'action'],
    budgetAffinity: ['micro', 'low', 'medium'],
    stageAffinity: ['packaging', 'financing', 'pre-production'],
  },
  {
    name: 'Cannes Film Festival',
    location: 'Cannes, France',
    type: 'hybrid',
    dates: 'May 12–23, 2026',
    submissionDeadline: 'Mar 15, 2026',
    deadlineDate: new Date('2026-03-15'),
    marketDates: 'May 13–17, 2026 (Marché du Film)',
    notes: 'Premier global market. Pre-sales, packaging, and prestige premieres.',
    url: 'https://www.festival-cannes.com',
    laneAffinity: ['studio-streamer', 'prestige-awards', 'international-copro', 'independent-film'],
    formatAffinity: ['film'],
    genreAffinity: ['drama', 'thriller', 'arthouse', 'romance', 'war', 'social realism'],
    budgetAffinity: ['medium', 'high', 'mega'],
    stageAffinity: ['development', 'packaging', 'financing'],
  },
  {
    name: 'Tribeca Festival',
    location: 'New York, USA',
    type: 'premiere',
    dates: 'Jun 4–15, 2026',
    submissionDeadline: 'Jan 9, 2026',
    deadlineDate: new Date('2026-01-09'),
    notes: 'Strong for docs and narrative features. Industry-accessible NYC location.',
    url: 'https://www.tribecafilm.com',
    laneAffinity: ['independent-film', 'prestige-awards'],
    formatAffinity: ['film'],
    genreAffinity: ['drama', 'documentary', 'comedy', 'thriller'],
    budgetAffinity: ['low', 'medium'],
    stageAffinity: ['packaging', 'financing', 'pre-production'],
  },
  {
    name: 'Venice Film Festival',
    location: 'Venice, Italy',
    type: 'premiere',
    dates: 'Aug 27 – Sep 6, 2026',
    submissionDeadline: 'Jun 15, 2026',
    deadlineDate: new Date('2026-06-15'),
    notes: 'Awards-season launchpad. Venice Production Bridge for financing.',
    url: 'https://www.labiennale.org',
    laneAffinity: ['prestige-awards', 'studio-streamer', 'international-copro'],
    formatAffinity: ['film', 'tv-series'],
    genreAffinity: ['drama', 'arthouse', 'biography', 'war', 'romance'],
    budgetAffinity: ['medium', 'high', 'mega'],
    stageAffinity: ['development', 'packaging', 'financing'],
  },
  {
    name: 'Toronto International Film Festival',
    location: 'Toronto, Canada',
    type: 'hybrid',
    dates: 'Sep 10–20, 2026',
    submissionDeadline: 'Jun 1, 2026',
    deadlineDate: new Date('2026-06-01'),
    marketDates: 'Sep 10–14, 2026 (Industry)',
    notes: 'Biggest audience festival. Strong for distribution deals.',
    url: 'https://www.tiff.net',
    laneAffinity: ['studio-streamer', 'independent-film', 'prestige-awards', 'genre-market'],
    formatAffinity: ['film'],
    genreAffinity: ['drama', 'documentary', 'comedy', 'thriller', 'horror', 'action', 'biography'],
    budgetAffinity: ['low', 'medium', 'high', 'mega'],
    stageAffinity: ['packaging', 'financing', 'pre-production'],
  },
  {
    name: 'San Sebastián Film Festival',
    location: 'San Sebastián, Spain',
    type: 'premiere',
    dates: 'Sep 18–26, 2026',
    submissionDeadline: 'Jun 30, 2026',
    deadlineDate: new Date('2026-06-30'),
    notes: 'Key Ibero-American and European cinema. Co-production Forum.',
    url: 'https://www.sansebastianfestival.com',
    laneAffinity: ['international-copro', 'independent-film', 'prestige-awards'],
    formatAffinity: ['film'],
    genreAffinity: ['drama', 'arthouse', 'social realism', 'romance'],
    budgetAffinity: ['low', 'medium'],
    stageAffinity: ['development', 'packaging', 'financing'],
  },
  {
    name: 'American Film Market (AFM)',
    location: 'Las Vegas, USA',
    type: 'market',
    dates: 'Nov 3–8, 2026',
    submissionDeadline: 'Ongoing registration',
    deadlineDate: new Date('2026-09-15'),
    marketDates: 'Nov 3–8, 2026',
    notes: 'Largest film market by volume. Pre-sales, territory deals, packaging.',
    url: 'https://americanfilmmarket.com',
    laneAffinity: ['genre-market', 'independent-film', 'fast-turnaround', 'low-budget'],
    formatAffinity: ['film'],
    genreAffinity: ['action', 'horror', 'thriller', 'sci-fi', 'comedy', 'drama'],
    budgetAffinity: ['micro', 'low', 'medium', 'high'],
    stageAffinity: ['packaging', 'financing'],
  },
  {
    name: 'MIPCOM / MIPJunior',
    location: 'Cannes, France',
    type: 'market',
    dates: 'Oct 19–22, 2026',
    submissionDeadline: 'Ongoing registration',
    deadlineDate: new Date('2026-08-15'),
    marketDates: 'Oct 19–22, 2026',
    notes: 'Global TV content market. Pre-sales for series. Co-production matchmaking.',
    url: 'https://www.mipcom.com',
    laneAffinity: ['studio-streamer', 'international-copro', 'fast-turnaround'],
    formatAffinity: ['tv-series'],
    genreAffinity: ['drama', 'comedy', 'thriller', 'documentary', 'animation', 'reality'],
    budgetAffinity: ['medium', 'high', 'mega'],
    stageAffinity: ['development', 'packaging', 'financing'],
  },
  {
    name: 'Locarno Film Festival',
    location: 'Locarno, Switzerland',
    type: 'premiere',
    dates: 'Aug 5–15, 2026',
    submissionDeadline: 'Apr 30, 2026',
    deadlineDate: new Date('2026-04-30'),
    notes: 'Discovery festival. Open Doors co-production lab for emerging markets.',
    url: 'https://www.locarnofestival.ch',
    laneAffinity: ['independent-film', 'international-copro', 'prestige-awards'],
    formatAffinity: ['film'],
    genreAffinity: ['drama', 'arthouse', 'experimental'],
    budgetAffinity: ['micro', 'low', 'medium'],
    stageAffinity: ['development', 'packaging'],
  },
];

const TYPE_STYLES: Record<string, string> = {
  premiere: 'bg-primary/15 text-primary border-primary/30',
  market: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  hybrid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

// Map budget_range values to affinity keys
function normaliseBudget(budgetRange: string): string[] {
  const lower = budgetRange.toLowerCase();
  if (lower.includes('micro') || lower.includes('under') || lower.includes('250')) return ['micro'];
  if (lower.includes('low') || lower.includes('500k') || lower.includes('1m') || lower.includes('2m')) return ['micro', 'low'];
  if (lower.includes('medium') || lower.includes('5m') || lower.includes('10m') || lower.includes('3m')) return ['low', 'medium'];
  if (lower.includes('high') || lower.includes('15m') || lower.includes('20m') || lower.includes('25m')) return ['medium', 'high'];
  if (lower.includes('mega') || lower.includes('studio') || lower.includes('50m') || lower.includes('100m')) return ['high', 'mega'];
  return ['low', 'medium']; // fallback
}

interface FestivalMatch {
  festival: Festival;
  score: number;
  reasons: string[];
  deadlineDays: number;
}

interface Props {
  format: string;
  genres: string[];
  budgetRange: string;
  tone: string;
  assignedLane: string | null;
  pipelineStage: string;
}

export function ProjectFestivalMatches({ format, genres, budgetRange, tone, assignedLane, pipelineStage }: Props) {
  const matches = useMemo(() => {
    const now = new Date();
    const budgetKeys = normaliseBudget(budgetRange);
    const results: FestivalMatch[] = [];

    for (const fest of FESTIVALS) {
      const reasons: string[] = [];
      let score = 0;

      // Lane match (strongest signal)
      if (assignedLane && fest.laneAffinity.includes(assignedLane)) {
        score += 4;
        const laneLabel = assignedLane.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        reasons.push(`Aligns with your ${laneLabel} lane`);
      }

      // Format match
      if (fest.formatAffinity.includes(format)) {
        score += 3;
      } else {
        // Format mismatch is a deal-breaker for TV at film-only festivals
        if (format === 'tv-series' && !fest.formatAffinity.includes('tv-series')) {
          continue;
        }
      }

      // Genre overlap
      const genreOverlap = genres.filter(g =>
        fest.genreAffinity.some(fg => fg.toLowerCase() === g.toLowerCase())
      );
      if (genreOverlap.length > 0) {
        score += Math.min(genreOverlap.length * 2, 6);
        reasons.push(`Genre fit: ${genreOverlap.join(', ')}`);
      }

      // Budget fit
      if (budgetKeys.some(bk => fest.budgetAffinity.includes(bk))) {
        score += 2;
        reasons.push('Budget range suits this market');
      }

      // Pipeline stage fit
      if (fest.stageAffinity.includes(pipelineStage)) {
        score += 2;
        reasons.push(`Relevant at your ${pipelineStage} stage`);
      }

      // Market/hybrid bonus for financing stage
      if (pipelineStage === 'financing' && (fest.type === 'market' || fest.type === 'hybrid')) {
        score += 2;
        reasons.push('Active market for closing finance');
      }

      // Deadline proximity bonus (upcoming = more actionable)
      const daysTillDeadline = Math.ceil((fest.deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (score >= 5 && reasons.length > 0) {
        results.push({ festival: fest, score, reasons, deadlineDays: daysTillDeadline });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [format, genres, budgetRange, tone, assignedLane, pipelineStage]);

  if (matches.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center gap-2 mb-1">
        <Calendar className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Target Festivals & Markets</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Matched to your project's lane, format, genre, budget, and current stage.
      </p>

      <div className="space-y-3">
        {matches.map((match, i) => {
          const { festival, reasons, deadlineDays } = match;

          return (
            <motion.div
              key={festival.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="p-4 rounded-lg border border-border/60 bg-card/30 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-display font-semibold text-foreground text-sm">{festival.name}</h4>
                    <Badge className={`text-[10px] px-2 py-0.5 border ${TYPE_STYLES[festival.type]}`}>
                      {festival.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {festival.location}
                    <span className="mx-1">·</span>
                    {festival.dates}
                  </div>
                </div>
                {deadlineDays > 0 && (
                  <Badge
                    className={cn(
                      'text-[10px] px-2 py-0.5 border shrink-0',
                      deadlineDays <= 14 ? 'bg-destructive/15 text-destructive border-destructive/30' :
                      deadlineDays <= 30 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                      deadlineDays <= 90 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
                      'bg-muted text-muted-foreground'
                    )}
                  >
                    <Clock className="h-2.5 w-2.5 mr-1" />
                    {deadlineDays}d to deadline
                  </Badge>
                )}
                {deadlineDays <= 0 && (
                  <Badge className="text-[10px] px-2 py-0.5 border bg-muted text-muted-foreground">
                    Deadline passed
                  </Badge>
                )}
              </div>

              {/* Why this festival */}
              <div className="flex flex-wrap gap-1.5">
                {reasons.map((reason, ri) => (
                  <span
                    key={ri}
                    className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary rounded-full px-2.5 py-0.5"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {reason}
                  </span>
                ))}
              </div>

              {festival.marketDates && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Market:</span> {festival.marketDates}
                </p>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground leading-relaxed flex-1 mr-3">{festival.notes}</p>
                <a
                  href={festival.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                >
                  <ExternalLink className="h-3 w-3" />
                  Website
                </a>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
