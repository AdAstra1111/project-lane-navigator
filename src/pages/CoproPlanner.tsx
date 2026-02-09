import { useState } from 'react';
import { motion } from 'framer-motion';
import { Handshake, Search, Globe, Percent, BookOpen, ExternalLink, Clock, Loader2, Shield, Info, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { IncentiveNav } from '@/components/IncentiveNav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCoproResearch, type CoproFramework } from '@/hooks/useCopro';

const COUNTRIES = [
  'United Kingdom', 'Ireland', 'France', 'Germany', 'Italy', 'Spain', 'Belgium',
  'Netherlands', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland',
  'Czech Republic', 'Hungary', 'Poland', 'Romania', 'Serbia', 'Croatia',
  'Greece', 'Portugal', 'Austria', 'Switzerland', 'Luxembourg',
  'Canada', 'Australia', 'New Zealand', 'South Africa',
  'Israel', 'India', 'South Korea', 'Japan', 'China',
  'Brazil', 'Argentina', 'Colombia', 'Chile', 'Mexico',
  'Morocco', 'Tunisia', 'Jordan', 'United States',
];

const CONFIDENCE_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  medium: { label: 'Medium', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low: { label: 'Low', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const TYPE_LABELS: Record<string, string> = {
  treaty: 'Bilateral Treaty',
  convention: 'Convention',
  fund: 'Fund',
};

function FrameworkCard({ framework }: { framework: CoproFramework }) {
  const conf = CONFIDENCE_STYLES[framework.confidence] || CONFIDENCE_STYLES.medium;
  const verified = framework.last_verified_at
    ? new Date(framework.last_verified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
            <h3 className="font-display font-semibold text-foreground">{framework.name}</h3>
            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
              {TYPE_LABELS[framework.type] || framework.type}
            </Badge>
          </div>
        </div>
        <Badge className={`text-[10px] px-2 py-0.5 border shrink-0 ${conf.className}`}>
          {conf.label} confidence
        </Badge>
      </div>

      {/* Countries */}
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex flex-wrap gap-1">
          {framework.eligible_countries.map(c => (
            <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
          ))}
        </div>
      </div>

      {/* Share constraints */}
      {(framework.min_share_pct || framework.max_share_pct) && (
        <div className="flex items-center gap-2 bg-primary/5 rounded-lg px-3 py-2">
          <Percent className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm text-foreground">
            {framework.min_share_pct != null ? `Min ${framework.min_share_pct}%` : ''}
            {framework.min_share_pct != null && framework.max_share_pct != null ? ' · ' : ''}
            {framework.max_share_pct != null ? `Max ${framework.max_share_pct}%` : ''}
            {' contribution per co-producer'}
          </span>
        </div>
      )}

      {/* Cultural requirements */}
      {framework.cultural_requirements && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cultural Requirements</p>
          <p className="text-sm text-foreground leading-relaxed">{framework.cultural_requirements}</p>
        </div>
      )}

      {/* Notes */}
      {framework.notes && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{framework.notes}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Verified: {verified}</span>
        </div>
        {framework.source_url && (
          <a href={framework.source_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-primary hover:underline">
            <ExternalLink className="h-3 w-3" />
            Source
          </a>
        )}
      </div>
    </motion.div>
  );
}

export default function CoproPlanner() {
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [adding, setAdding] = useState('');
  const { frameworks, isLoading, source, research } = useCoproResearch();

  const addCountry = (c: string) => {
    if (c && !selectedCountries.includes(c)) {
      setSelectedCountries(prev => [...prev, c]);
    }
    setAdding('');
  };

  const removeCountry = (c: string) => {
    setSelectedCountries(prev => prev.filter(x => x !== c));
  };

  const handleSearch = () => {
    if (selectedCountries.length < 2) return;
    research(selectedCountries);
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

          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Handshake className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Incentives & Co-Productions</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Co-Production Planner</h1>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              AI-researched treaties, conventions, and funds for structuring international co-productions.
            </p>
          </div>

          {/* Country selector */}
          <div className="glass-card rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Search className="h-4 w-4 text-primary" />
              <h3 className="font-display font-semibold text-foreground">Select Partner Countries</h3>
            </div>
            <p className="text-xs text-muted-foreground">Choose at least 2 countries to research available co-production frameworks.</p>

            {/* Selected */}
            {selectedCountries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedCountries.map(c => (
                  <Badge key={c} variant="secondary" className="gap-1 pr-1">
                    {c}
                    <button onClick={() => removeCountry(c)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Select value={adding} onValueChange={addCountry}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Add country…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {COUNTRIES.filter(c => !selectedCountries.includes(c)).map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleSearch}
              disabled={selectedCountries.length < 2 || isLoading}
              className="w-full sm:w-auto"
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Researching…</>
              ) : (
                <><Search className="h-4 w-4 mr-1.5" />Research Frameworks</>
              )}
            </Button>
          </div>

          {/* Results */}
          {frameworks.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-foreground text-lg">
                  {frameworks.length} Framework{frameworks.length !== 1 ? 's' : ''} Found
                </h2>
                {source && (
                  <Badge variant="outline" className="text-[10px]">
                    {source === 'cache' ? 'Cached (< 14 days)' : 'Live AI Research'}
                  </Badge>
                )}
              </div>
              {frameworks.map((f, i) => (
                <FrameworkCard key={f.id || `${f.name}-${i}`} framework={f} />
              ))}
            </div>
          )}

          {!isLoading && frameworks.length === 0 && source && (
            <div className="glass-card rounded-xl p-10 text-center">
              <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
              <h4 className="font-display font-semibold text-foreground mb-1">No frameworks found</h4>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                No co-production frameworks were identified for this combination of countries.
              </p>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t border-border/50 pt-6">
            <p>Co-production data is AI-researched from official sources. Always verify treaty details with legal counsel before structuring a deal.</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
