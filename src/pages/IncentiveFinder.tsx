import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Landmark, BadgeDollarSign, Clock, Shield, ExternalLink, Loader2, Info } from 'lucide-react';
import { Header } from '@/components/Header';
import { IncentiveNav } from '@/components/IncentiveNav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIncentiveResearch, type IncentiveProgram } from '@/hooks/useIncentives';

const JURISDICTIONS = [
  { value: 'United Kingdom', label: 'United Kingdom' },
  { value: 'Ireland', label: 'Ireland' },
  { value: 'Canada', label: 'Canada' },
  { value: 'Canada - British Columbia', label: 'Canada – British Columbia' },
  { value: 'Canada - Ontario', label: 'Canada – Ontario' },
  { value: 'Canada - Quebec', label: 'Canada – Quebec' },
  { value: 'Australia', label: 'Australia' },
  { value: 'New Zealand', label: 'New Zealand' },
  { value: 'France', label: 'France' },
  { value: 'Germany', label: 'Germany' },
  { value: 'Italy', label: 'Italy' },
  { value: 'Spain', label: 'Spain' },
  { value: 'Belgium', label: 'Belgium' },
  { value: 'Netherlands', label: 'Netherlands' },
  { value: 'Denmark', label: 'Denmark' },
  { value: 'Sweden', label: 'Sweden' },
  { value: 'Norway', label: 'Norway' },
  { value: 'Finland', label: 'Finland' },
  { value: 'Iceland', label: 'Iceland' },
  { value: 'Czech Republic', label: 'Czech Republic' },
  { value: 'Hungary', label: 'Hungary' },
  { value: 'Poland', label: 'Poland' },
  { value: 'Romania', label: 'Romania' },
  { value: 'Serbia', label: 'Serbia' },
  { value: 'Croatia', label: 'Croatia' },
  { value: 'Greece', label: 'Greece' },
  { value: 'Portugal', label: 'Portugal' },
  { value: 'South Africa', label: 'South Africa' },
  { value: 'Colombia', label: 'Colombia' },
  { value: 'Dominican Republic', label: 'Dominican Republic' },
  { value: 'Puerto Rico', label: 'Puerto Rico' },
  { value: 'Morocco', label: 'Morocco' },
  { value: 'Jordan', label: 'Jordan' },
  { value: 'South Korea', label: 'South Korea' },
  { value: 'Japan', label: 'Japan' },
  { value: 'Malaysia', label: 'Malaysia' },
  { value: 'Thailand', label: 'Thailand' },
  { value: 'United States - Georgia', label: 'US – Georgia' },
  { value: 'United States - Louisiana', label: 'US – Louisiana' },
  { value: 'United States - New Mexico', label: 'US – New Mexico' },
  { value: 'United States - New York', label: 'US – New York' },
  { value: 'United States - California', label: 'US – California' },
];

const CONFIDENCE_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  medium: { label: 'Medium', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low: { label: 'Low', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const TYPE_LABELS: Record<string, string> = {
  credit: 'Tax Credit',
  rebate: 'Rebate',
  grant: 'Grant',
  fund: 'Fund',
};

function IncentiveCard({ program }: { program: IncentiveProgram }) {
  const conf = CONFIDENCE_STYLES[program.confidence] || CONFIDENCE_STYLES.medium;
  const verified = program.last_verified_at
    ? new Date(program.last_verified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Unknown';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-semibold text-foreground">{program.name}</h3>
            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
              {TYPE_LABELS[program.type] || program.type}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{program.jurisdiction}</p>
        </div>
        <Badge className={`text-[10px] px-2 py-0.5 border shrink-0 ${conf.className}`}>
          {conf.label} confidence
        </Badge>
      </div>

      {/* Headline Rate */}
      <div className="flex items-center gap-2 bg-primary/5 rounded-lg px-3 py-2">
        <BadgeDollarSign className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground">{program.headline_rate}</span>
      </div>

      {/* Eligibility */}
      <p className="text-sm text-muted-foreground leading-relaxed">{program.eligibility_summary}</p>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        {program.qualifying_spend_rules && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Qualifying Spend</p>
            <p className="text-foreground">{program.qualifying_spend_rules}</p>
          </div>
        )}
        {program.caps_limits && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Caps / Limits</p>
            <p className="text-foreground">{program.caps_limits}</p>
          </div>
        )}
        {program.payment_timing && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Payment Timing</p>
            <p className="text-foreground">{program.payment_timing}</p>
          </div>
        )}
        {program.stackability && (
          <div>
            <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Stackability</p>
            <p className="text-foreground">{program.stackability}</p>
          </div>
        )}
      </div>

      {/* Formats */}
      {program.formats_supported?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {program.formats_supported.map(f => (
            <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
          ))}
        </div>
      )}

      {/* Notes */}
      {program.notes && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{program.notes}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Verified: {verified}</span>
        </div>
        {program.source_url && (
          <a
            href={program.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Source
          </a>
        )}
      </div>
    </motion.div>
  );
}

export default function IncentiveFinder() {
  const [jurisdiction, setJurisdiction] = useState('');
  const [format, setFormat] = useState('');
  const { programs, isLoading, source, research } = useIncentiveResearch();

  const handleSearch = () => {
    if (!jurisdiction) return;
    research({
      jurisdiction,
      format: format || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          <IncentiveNav />

          {/* Page Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Incentives & Co-Productions</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Incentive Finder</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              AI-researched tax credits, rebates, grants, and funds — sourced live and verified with confidence indicators.
            </p>
          </div>

          {/* Search Controls */}
          <div className="glass-card rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Search className="h-4 w-4 text-primary" />
              <h3 className="font-display font-semibold text-foreground">Research Jurisdiction</h3>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Jurisdiction
                </label>
                <Select value={jurisdiction} onValueChange={setJurisdiction}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select jurisdiction" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {JURISDICTIONS.map(j => (
                      <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Format (optional)
                </label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feature-film">Feature Film</SelectItem>
                    <SelectItem value="tv-series">TV Series</SelectItem>
                    <SelectItem value="documentary">Documentary</SelectItem>
                    <SelectItem value="animation">Animation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleSearch}
              disabled={!jurisdiction || isLoading}
              className="w-full sm:w-auto"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Researching…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-1.5" />
                  Research Incentives
                </>
              )}
            </Button>
          </div>

          {/* Results */}
          {programs.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-foreground text-lg">
                  {programs.length} Incentive{programs.length !== 1 ? 's' : ''} Found
                </h2>
                {source && (
                  <Badge variant="outline" className="text-[10px]">
                    {source === 'cache' ? 'Cached (< 7 days)' : 'Live AI Research'}
                  </Badge>
                )}
              </div>
              {programs.map((p, i) => (
                <IncentiveCard key={p.id || `${p.name}-${i}`} program={p} />
              ))}
            </div>
          )}

          {/* Empty state after search */}
          {!isLoading && programs.length === 0 && source && (
            <div className="glass-card rounded-xl p-10 text-center">
              <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
              <h4 className="font-display font-semibold text-foreground mb-1">No incentives found</h4>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                No active incentive programs were identified for this jurisdiction. Try a different territory or check back later.
              </p>
            </div>
          )}

          {/* Methodology */}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Incentive data is AI-researched from official sources and cached for 7 days. Always verify critical details with local counsel before committing spend.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
