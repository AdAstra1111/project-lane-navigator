import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, AlertTriangle, MapPin, ExternalLink, Bell } from 'lucide-react';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
}

const FESTIVALS: Festival[] = [
  {
    name: 'Sundance Film Festival',
    location: 'Park City, USA',
    type: 'premiere',
    dates: 'Jan 16–26, 2026',
    submissionDeadline: 'Sep 12, 2025',
    deadlineDate: new Date('2025-09-12'),
    notes: 'Key launchpad for independent films. Early submissions preferred. Short film & feature tracks.',
    url: 'https://www.sundance.org',
  },
  {
    name: 'Berlin International Film Festival',
    location: 'Berlin, Germany',
    type: 'hybrid',
    dates: 'Feb 12–22, 2026',
    submissionDeadline: 'Oct 6, 2025',
    deadlineDate: new Date('2025-10-06'),
    marketDates: 'Feb 12–16, 2026 (EFM)',
    notes: 'European Film Market (EFM) runs parallel. Strong for arthouse, political cinema, co-productions.',
    url: 'https://www.berlinale.de',
  },
  {
    name: 'SXSW Film & TV Festival',
    location: 'Austin, USA',
    type: 'premiere',
    dates: 'Mar 7–15, 2026',
    submissionDeadline: 'Oct 20, 2025',
    deadlineDate: new Date('2025-10-20'),
    notes: 'Genre-friendly. Great for buzz and audience discovery. Episodic pilot track available.',
    url: 'https://www.sxsw.com',
  },
  {
    name: 'Cannes Film Festival',
    location: 'Cannes, France',
    type: 'hybrid',
    dates: 'May 12–23, 2026',
    submissionDeadline: 'Mar 15, 2026',
    deadlineDate: new Date('2026-03-15'),
    marketDates: 'May 13–17, 2026 (Marché du Film)',
    notes: 'Premier global market. Pre-sales, packaging, and prestige premieres. Invitation-only competition.',
    url: 'https://www.festival-cannes.com',
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
  },
  {
    name: 'Locarno Film Festival',
    location: 'Locarno, Switzerland',
    type: 'premiere',
    dates: 'Aug 5–15, 2026',
    submissionDeadline: 'Apr 30, 2026',
    deadlineDate: new Date('2026-04-30'),
    notes: 'Discovery festival. Open Doors co-production lab for emerging markets. Strong for auteur cinema.',
    url: 'https://www.locarnofestival.ch',
  },
  {
    name: 'Venice Film Festival',
    location: 'Venice, Italy',
    type: 'premiere',
    dates: 'Aug 27 – Sep 6, 2026',
    submissionDeadline: 'Jun 15, 2026',
    deadlineDate: new Date('2026-06-15'),
    notes: 'Awards-season launchpad. Horizons section for emerging voices. Venice Production Bridge for financing.',
    url: 'https://www.labiennale.org',
  },
  {
    name: 'Telluride Film Festival',
    location: 'Telluride, USA',
    type: 'premiere',
    dates: 'Sep 4–7, 2026',
    submissionDeadline: 'Invitation only',
    deadlineDate: new Date('2026-07-01'),
    notes: 'No public submissions. By-invitation. Key awards-season premiere slot.',
    url: 'https://www.telluridefilmfestival.org',
  },
  {
    name: 'Toronto International Film Festival',
    location: 'Toronto, Canada',
    type: 'hybrid',
    dates: 'Sep 10–20, 2026',
    submissionDeadline: 'Jun 1, 2026',
    deadlineDate: new Date('2026-06-01'),
    marketDates: 'Sep 10–14, 2026 (Industry)',
    notes: 'Biggest audience festival. Strong for distribution deals. Platform, Midnight, and Discovery programmes.',
    url: 'https://www.tiff.net',
  },
  {
    name: 'San Sebastián Film Festival',
    location: 'San Sebastián, Spain',
    type: 'premiere',
    dates: 'Sep 18–26, 2026',
    submissionDeadline: 'Jun 30, 2026',
    deadlineDate: new Date('2026-06-30'),
    notes: 'Key Ibero-American and European cinema. Europe-Latin America Co-production Forum.',
    url: 'https://www.sansebastianfestival.com',
  },
  {
    name: 'American Film Market (AFM)',
    location: 'Las Vegas, USA',
    type: 'market',
    dates: 'Nov 3–8, 2026',
    submissionDeadline: 'Ongoing registration',
    deadlineDate: new Date('2026-09-15'),
    marketDates: 'Nov 3–8, 2026',
    notes: 'Largest film market by volume. Pre-sales, territory deals, packaging. Essential for independent financing.',
    url: 'https://americanfilmmarket.com',
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
  },
];

function getDeadlineStatus(deadline: Date): { label: string; className: string; urgent: boolean } {
  const now = new Date();
  const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) return { label: 'Passed', className: 'bg-muted text-muted-foreground', urgent: false };
  if (daysUntil <= 14) return { label: `${daysUntil}d left`, className: 'bg-destructive/15 text-destructive border-destructive/30', urgent: true };
  if (daysUntil <= 30) return { label: `${daysUntil}d left`, className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', urgent: true };
  if (daysUntil <= 90) return { label: `${daysUntil}d left`, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', urgent: false };
  return { label: `${daysUntil}d left`, className: 'bg-muted text-muted-foreground', urgent: false };
}

const TYPE_STYLES: Record<string, string> = {
  premiere: 'bg-primary/15 text-primary border-primary/30',
  market: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  hybrid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

export default function FestivalCalendar() {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showUpcoming, setShowUpcoming] = useState(true);

  const filtered = useMemo(() => {
    let result = [...FESTIVALS];
    if (typeFilter !== 'all') result = result.filter(f => f.type === typeFilter);
    if (showUpcoming) result = result.filter(f => f.deadlineDate >= new Date());
    return result.sort((a, b) => a.deadlineDate.getTime() - b.deadlineDate.getTime());
  }, [typeFilter, showUpcoming]);

  const urgentCount = FESTIVALS.filter(f => {
    const days = Math.ceil((f.deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days > 0 && days <= 30;
  }).length;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Market Intelligence</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Festival Calendar</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Key festivals, markets, and submission deadlines for the international film industry.
            </p>
          </div>

          {/* Urgent alert */}
          {urgentCount > 0 && (
            <div className="flex items-center gap-3 glass-card rounded-lg px-4 py-3 border-l-4 border-amber-500/50">
              <Bell className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-sm text-foreground">
                <strong>{urgentCount}</strong> deadline{urgentCount > 1 ? 's' : ''} approaching within 30 days
              </p>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="premiere">Premiere</SelectItem>
                <SelectItem value="market">Market</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showUpcoming ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowUpcoming(!showUpcoming)}
            >
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              {showUpcoming ? 'Upcoming Only' : 'Show All'}
            </Button>
          </div>

          {/* Festival list */}
          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No festivals match your filters
              </div>
            ) : (
              filtered.map((festival) => {
                const status = getDeadlineStatus(festival.deadlineDate);
                return (
                  <motion.div
                    key={festival.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'glass-card rounded-xl p-5 space-y-3',
                      status.urgent && 'ring-1 ring-amber-500/20'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-display font-semibold text-foreground">{festival.name}</h3>
                          <Badge className={`text-[10px] px-2 py-0.5 border ${TYPE_STYLES[festival.type]}`}>
                            {festival.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {festival.location}
                        </div>
                      </div>
                      <Badge className={`text-[10px] px-2 py-0.5 border shrink-0 ${status.className}`}>
                        {status.label}
                      </Badge>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Festival Dates</p>
                        <p className="text-foreground">{festival.dates}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Submission Deadline</p>
                        <p className={cn('font-medium', status.urgent ? 'text-amber-400' : 'text-foreground')}>
                          {festival.submissionDeadline}
                        </p>
                      </div>
                      {festival.marketDates && (
                        <div className="sm:col-span-2">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Market Dates</p>
                          <p className="text-foreground">{festival.marketDates}</p>
                        </div>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed">{festival.notes}</p>

                    <a
                      href={festival.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Visit website
                    </a>
                  </motion.div>
                );
              })
            )}
          </div>

          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Dates are indicative and based on historical patterns. Always verify deadlines directly with festival organisers.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
