import { useState, useMemo } from 'react';
import { Filter, Sparkles, ChevronRight, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { MODE_GENRES, MODE_BUDGETS } from '@/lib/constants';
import type { ProjectFormat } from '@/lib/types';

export interface HardCriteria {
  productionType: string;
  genre: string;
  culturalTag: string;
  lane: string;
  budgetBand: string;
  region: string;
  platformTarget: string;
  riskLevel: string;
  epLength: string;
  epCount: string;
  rating: string;
  mustHaveTropes: string[];
  avoidTropes: string[];
  notes: string;
}

const EMPTY_CRITERIA: HardCriteria = {
  productionType: '',
  genre: '',
  culturalTag: '',
  lane: '',
  budgetBand: '',
  region: '',
  platformTarget: '',
  riskLevel: 'medium',
  epLength: '',
  epCount: '',
  rating: '',
  mustHaveTropes: [],
  avoidTropes: [],
  notes: '',
};

const PRODUCTION_TYPES = [
  { value: 'film', label: 'Feature Film' },
  { value: 'tv-series', label: 'TV Series' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'short-film', label: 'Short Film' },
  { value: 'digital-series', label: 'Digital Series' },
  { value: 'vertical-drama', label: 'Vertical Drama' },
  { value: 'commercial', label: 'Commercial / Advert' },
  { value: 'branded-content', label: 'Branded Content' },
];

const LANES = [
  { value: 'studio-streamer', label: 'Studio / Streamer' },
  { value: 'independent-film', label: 'Independent Film' },
  { value: 'low-budget', label: 'Low Budget' },
  { value: 'international-copro', label: 'Int\'l Co-Pro' },
  { value: 'genre-market', label: 'Genre / Market' },
  { value: 'prestige-awards', label: 'Prestige / Awards' },
  { value: 'fast-turnaround', label: 'Fast Turnaround' },
];

const REGIONS = ['Global', 'North America', 'Europe', 'UK', 'Asia-Pacific', 'Latin America', 'Middle East & Africa', 'Japan', 'South Korea'];

const PLATFORMS: Record<string, string[]> = {
  film: ['Theatrical', 'Netflix', 'Amazon', 'Apple TV+', 'HBO/Max', 'Disney+', 'Broadcast', 'FAST'],
  'tv-series': ['Netflix', 'Amazon', 'Apple TV+', 'HBO/Max', 'Disney+', 'Broadcast', 'Hulu', 'Paramount+'],
  documentary: ['Netflix', 'Amazon', 'HBO/Max', 'Apple TV+', 'Broadcast', 'Theatrical', 'PBS'],
  'short-film': ['Festival Circuit', 'YouTube', 'Vimeo', 'Streaming Short-Form'],
  'digital-series': ['YouTube', 'TikTok/Mobile', 'Instagram', 'Snapchat', 'FAST', 'Roku Channel'],
  commercial: ['TV Broadcast', 'Social Media', 'Digital/Programmatic', 'Cinema Pre-Roll'],
  'branded-content': ['YouTube', 'Social Media', 'Streaming', 'Brand Channels'],
  'vertical-drama': ['TikTok/Mobile', 'ReelShort', 'YouTube Shorts', 'Instagram Reels', 'Snapchat'],
};

const RATINGS = ['G', 'PG', 'PG-13', 'R', '15', '18', 'TV-MA', 'Unrated'];

const CULTURAL_TAGS = [
  'J-pop', 'K-drama', 'Bollywood', 'Nordic Noir', 'Latin Telenovela', 'Afrofuturism',
  'British Kitchen Sink', 'French New Wave', 'Hong Kong Action', 'Italian Giallo',
  'Anime-Influenced', 'Wuxia', 'Nollywood', 'Middle Eastern', 'Indigenous Stories',
];

interface Props {
  criteria: HardCriteria;
  onChange: (criteria: HardCriteria) => void;
  onGenerate: () => void;
  generating: boolean;
  hasProject: boolean;
}

export function HardCriteriaForm({ criteria, onChange, onGenerate, generating, hasProject }: Props) {
  const [tropeInput, setTropeInput] = useState('');
  const [avoidInput, setAvoidInput] = useState('');

  const update = (patch: Partial<HardCriteria>) => onChange({ ...criteria, ...patch });

  const genres = useMemo(() => {
    if (!criteria.productionType) return [];
    return MODE_GENRES[criteria.productionType as ProjectFormat] || [];
  }, [criteria.productionType]);

  const budgets = useMemo(() => {
    if (!criteria.productionType) return [];
    return MODE_BUDGETS[criteria.productionType as ProjectFormat] || [];
  }, [criteria.productionType]);

  const platforms = useMemo(() => {
    if (!criteria.productionType) return [];
    return PLATFORMS[criteria.productionType] || PLATFORMS.film;
  }, [criteria.productionType]);

  const addTrope = (list: 'mustHaveTropes' | 'avoidTropes', value: string) => {
    const trimmed = value.trim();
    if (!trimmed || criteria[list].includes(trimmed)) return;
    update({ [list]: [...criteria[list], trimmed] });
  };

  const removeTrope = (list: 'mustHaveTropes' | 'avoidTropes', idx: number) => {
    update({ [list]: criteria[list].filter((_, i) => i !== idx) });
  };

  const isSeriesFormat = ['tv-series', 'digital-series', 'vertical-drama'].includes(criteria.productionType);
  const isValid = !!criteria.productionType;

  return (
    <Card className="border-primary/20 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          Hard Criteria
        </CardTitle>
        <CardDescription>
          Non-negotiable constraints for slate generation. Only matching concepts will be produced.
          {!hasProject && (
            <Badge variant="outline" className="ml-2 text-xs">Global Mode — no project context</Badge>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Row 1: Type + Genre + Cultural Tag */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Format / Type *</Label>
            <Select value={criteria.productionType} onValueChange={v => update({ productionType: v, genre: '', budgetBand: '', platformTarget: '' })}>
              <SelectTrigger><SelectValue placeholder="Select format" /></SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Genre</Label>
            <Select value={criteria.genre} onValueChange={v => update({ genre: v })} disabled={!criteria.productionType}>
              <SelectTrigger><SelectValue placeholder="Any genre" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {genres.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cultural / Style Tag</Label>
            <Select value={criteria.culturalTag} onValueChange={v => update({ culturalTag: v })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {CULTURAL_TAGS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: Lane + Budget + Region */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Lane</Label>
            <Select value={criteria.lane} onValueChange={v => update({ lane: v })}>
              <SelectTrigger><SelectValue placeholder="Any lane" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {LANES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Budget Band</Label>
            <Select value={criteria.budgetBand} onValueChange={v => update({ budgetBand: v })} disabled={!criteria.productionType}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {budgets.map((b: any) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Region</Label>
            <Select value={criteria.region} onValueChange={v => update({ region: v })}>
              <SelectTrigger><SelectValue placeholder="Global" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Global</SelectItem>
                {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 3: Platform + Rating + Risk */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Platform Target</Label>
            <Select value={criteria.platformTarget} onValueChange={v => update({ platformTarget: v })} disabled={!criteria.productionType}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {platforms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Rating</Label>
            <Select value={criteria.rating} onValueChange={v => update({ rating: v })}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Risk Level</Label>
            <Select value={criteria.riskLevel} onValueChange={v => update({ riskLevel: v })}>
              <SelectTrigger><SelectValue placeholder="Medium" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low — Safe bets</SelectItem>
                <SelectItem value="medium">Medium — Calculated</SelectItem>
                <SelectItem value="high">High — Bold swings</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Series-specific: Ep Length + Count */}
        {isSeriesFormat && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Episode Length (minutes)</Label>
              <Input type="number" value={criteria.epLength} onChange={e => update({ epLength: e.target.value })} placeholder="e.g. 8, 22, 45, 60" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Episode Count</Label>
              <Input type="number" value={criteria.epCount} onChange={e => update({ epCount: e.target.value })} placeholder="e.g. 6, 10, 80" className="h-9" />
            </div>
          </div>
        )}

        {/* Must-have tropes */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Must-Have Tropes / Themes</Label>
          <div className="flex gap-2">
            <Input
              value={tropeInput}
              onChange={e => setTropeInput(e.target.value)}
              placeholder="e.g. 'enemies to lovers', 'time loop'"
              className="h-9"
              onKeyDown={e => { if (e.key === 'Enter') { addTrope('mustHaveTropes', tropeInput); setTropeInput(''); } }}
            />
            <Button variant="outline" size="sm" className="shrink-0 h-9" onClick={() => { addTrope('mustHaveTropes', tropeInput); setTropeInput(''); }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {criteria.mustHaveTropes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {criteria.mustHaveTropes.map((t, i) => (
                <Badge key={i} variant="default" className="text-xs gap-1 cursor-pointer" onClick={() => removeTrope('mustHaveTropes', i)}>
                  {t} <X className="h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Avoid tropes */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Avoid Tropes / Themes</Label>
          <div className="flex gap-2">
            <Input
              value={avoidInput}
              onChange={e => setAvoidInput(e.target.value)}
              placeholder="e.g. 'chosen one', 'love triangle'"
              className="h-9"
              onKeyDown={e => { if (e.key === 'Enter') { addTrope('avoidTropes', avoidInput); setAvoidInput(''); } }}
            />
            <Button variant="outline" size="sm" className="shrink-0 h-9" onClick={() => { addTrope('avoidTropes', avoidInput); setAvoidInput(''); }}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {criteria.avoidTropes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {criteria.avoidTropes.map((t, i) => (
                <Badge key={i} variant="destructive" className="text-xs gap-1 cursor-pointer" onClick={() => removeTrope('avoidTropes', i)}>
                  {t} <X className="h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Additional Direction</Label>
          <Textarea value={criteria.notes} onChange={e => update({ notes: e.target.value })} placeholder="Any specific constraints, themes, or inspirations…" rows={2} />
        </div>

        {/* Generate */}
        <div className="flex items-center justify-between pt-3 border-t border-border/30">
          <div className="text-xs text-muted-foreground">
            Generates <span className="font-medium text-foreground">10 concepts</span> per batch
          </div>
          <Button onClick={onGenerate} disabled={!isValid || generating} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {generating ? 'Generating…' : 'Generate Slate'}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { EMPTY_CRITERIA };
