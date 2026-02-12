import { useState, useMemo } from 'react';
import { FileText, ChevronRight, Sparkles, Save, History, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { useDevelopmentBriefs, type DevelopmentBrief } from '@/hooks/useDevelopmentBriefs';
import { MODE_GENRES, MODE_AUDIENCES, MODE_BUDGETS } from '@/lib/constants';
import type { ProjectFormat } from '@/lib/types';

const PRODUCTION_TYPES = [
  { value: 'film', label: 'Feature Film' },
  { value: 'tv-series', label: 'TV Series' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'short-film', label: 'Short Film' },
  { value: 'digital-series', label: 'Digital Series' },
  { value: 'commercial', label: 'Commercial / Advert' },
  { value: 'branded-content', label: 'Branded Content' },
  { value: 'vertical-drama', label: 'Vertical Drama' },
];

const REGIONS = ['Global', 'North America', 'Europe', 'UK', 'Asia-Pacific', 'Latin America', 'Middle East & Africa'];

const PLATFORMS: Record<string, string[]> = {
  film: ['Theatrical', 'Netflix', 'Amazon', 'Apple TV+', 'HBO/Max', 'Disney+', 'Broadcast', 'FAST'],
  'tv-series': ['Netflix', 'Amazon', 'Apple TV+', 'HBO/Max', 'Disney+', 'Broadcast', 'Hulu', 'Paramount+'],
  documentary: ['Netflix', 'Amazon', 'HBO/Max', 'Apple TV+', 'Broadcast', 'Theatrical', 'PBS'],
  'short-film': ['Festival Circuit', 'YouTube', 'Vimeo', 'Streaming Short-Form', 'Broadcast'],
  'digital-series': ['YouTube', 'TikTok/Mobile', 'Instagram', 'Snapchat', 'FAST', 'Roku Channel'],
  commercial: ['TV Broadcast', 'Social Media', 'Digital/Programmatic', 'Cinema Pre-Roll', 'OOH'],
  'branded-content': ['YouTube', 'Social Media', 'Streaming', 'Brand Channels', 'Broadcast'],
  'vertical-drama': ['TikTok/Mobile', 'ReelShort', 'YouTube Shorts', 'Instagram Reels', 'Snapchat'],
};

const RISK_LEVELS = [
  { value: 'low', label: 'Low — Safe bets, proven genres', description: 'Familiar territory with established audiences' },
  { value: 'medium', label: 'Medium — Calculated risks', description: 'Fresh angle on proven concepts' },
  { value: 'high', label: 'High — Bold swings', description: 'Untested territory, high reward potential' },
];

const SUBGENRES: Record<string, string[]> = {
  Drama: ['Family Drama', 'Legal Drama', 'Medical Drama', 'Political Drama', 'Period Drama', 'Social Realism'],
  Comedy: ['Romantic Comedy', 'Dark Comedy', 'Satire', 'Slapstick', 'Mockumentary', 'Workplace Comedy'],
  Horror: ['Supernatural', 'Slasher', 'Psychological', 'Folk Horror', 'Body Horror', 'Found Footage'],
  'Sci-Fi': ['Hard Sci-Fi', 'Space Opera', 'Cyberpunk', 'Dystopian', 'Time Travel', 'Post-Apocalyptic'],
  Thriller: ['Psychological', 'Conspiracy', 'Legal', 'Espionage', 'Survival', 'Techno-Thriller'],
  Action: ['Martial Arts', 'Military', 'Heist', 'Disaster', 'Spy Action', 'Superhero'],
  Romance: ['Period Romance', 'Contemporary', 'Second Chance', 'Forbidden', 'Slow Burn'],
  Fantasy: ['Epic Fantasy', 'Urban Fantasy', 'Dark Fantasy', 'Fairy Tale', 'Mythological'],
  Documentary: ['Vérité', 'Investigative', 'Essay Film', 'Portrait', 'Nature'],
  Animation: ['2D', '3D/CGI', 'Stop-Motion', 'Mixed Media', 'Anime-Influenced'],
};

interface Props {
  onGenerate: (brief: DevelopmentBrief) => void;
  generating: boolean;
}

export function DevelopmentBriefBuilder({ onGenerate, generating }: Props) {
  const { briefs, save, remove } = useDevelopmentBriefs();
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [productionType, setProductionType] = useState('');
  const [genre, setGenre] = useState('');
  const [subgenre, setSubgenre] = useState('');
  const [budgetBand, setBudgetBand] = useState('');
  const [region, setRegion] = useState('');
  const [platformTarget, setPlatformTarget] = useState('');
  const [audienceDemo, setAudienceDemo] = useState('');
  const [riskAppetite, setRiskAppetite] = useState('medium');
  const [notes, setNotes] = useState('');

  // Derived options based on production type
  const genres = useMemo(() => {
    if (!productionType) return [];
    return MODE_GENRES[productionType as ProjectFormat] || [];
  }, [productionType]);

  const budgets = useMemo(() => {
    if (!productionType) return [];
    return MODE_BUDGETS[productionType as ProjectFormat] || [];
  }, [productionType]);

  const audiences = useMemo(() => {
    if (!productionType) return [];
    return MODE_AUDIENCES[productionType as ProjectFormat] || [];
  }, [productionType]);

  const platforms = useMemo(() => {
    if (!productionType) return [];
    return PLATFORMS[productionType] || PLATFORMS.film;
  }, [productionType]);

  const subgenres = useMemo(() => {
    if (!genre) return [];
    return SUBGENRES[genre] || [];
  }, [genre]);

  const isValid = productionType && genre;

  // Reset dependent fields when production type changes
  const handleProductionTypeChange = (val: string) => {
    setProductionType(val);
    setGenre('');
    setSubgenre('');
    setBudgetBand('');
    setPlatformTarget('');
    setAudienceDemo('');
  };

  const handleGenreChange = (val: string) => {
    setGenre(val);
    setSubgenre('');
  };

  const handleSaveAndGenerate = async () => {
    if (!isValid) {
      toast.error('Production Type and Genre are required');
      return;
    }
    try {
      const clean = (v: string) => v === '__any__' ? '' : v;
      const brief = await save({
        name: name || `${productionType} — ${genre} brief`,
        production_type: productionType,
        genre,
        subgenre: clean(subgenre),
        budget_band: clean(budgetBand),
        region: clean(region),
        platform_target: clean(platformTarget),
        audience_demo: clean(audienceDemo),
        risk_appetite: riskAppetite,
        notes,
      });
      onGenerate(brief);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save brief');
    }
  };

  const handleLoadBrief = (brief: DevelopmentBrief) => {
    setName(brief.name);
    setProductionType(brief.production_type);
    // Defer setting dependent fields
    setTimeout(() => {
      setGenre(brief.genre);
      setSubgenre(brief.subgenre || '');
      setBudgetBand(brief.budget_band || '');
      setRegion(brief.region || '');
      setPlatformTarget(brief.platform_target || '');
      setAudienceDemo(brief.audience_demo || '');
      setRiskAppetite(brief.risk_appetite || 'medium');
      setNotes(brief.notes || '');
    }, 50);
    setShowHistory(false);
    toast.success('Brief loaded');
  };

  return (
    <Card className="border-primary/20 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Development Brief
            </CardTitle>
            <CardDescription className="mt-1">
              Define your brief before generating ideas. Production Type and Genre are required gates.
            </CardDescription>
          </div>
          {briefs.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-3.5 w-3.5" />
              Saved ({briefs.length})
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Saved briefs */}
        {showHistory && briefs.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Previous Briefs</p>
            {briefs.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-md hover:bg-muted/40 cursor-pointer group" onClick={() => handleLoadBrief(b)}>
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-xs shrink-0">{b.production_type}</Badge>
                  <span className="truncate">{b.name || `${b.genre} brief`}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => { e.stopPropagation(); remove(b.id); }}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Brief name */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Brief Name (optional)</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q2 Horror Slate Exploration" className="h-9" />
        </div>

        {/* Row 1: Production Type + Genre (mandatory) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Production Type <span className="text-destructive">*</span>
            </Label>
            <Select value={productionType} onValueChange={handleProductionTypeChange}>
              <SelectTrigger className={!productionType ? 'border-destructive/50' : ''}>
                <SelectValue placeholder="Select production type" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Genre <span className="text-destructive">*</span>
            </Label>
            <Select value={genre} onValueChange={handleGenreChange} disabled={!productionType}>
              <SelectTrigger className={productionType && !genre ? 'border-destructive/50' : ''}>
                <SelectValue placeholder={productionType ? "Select genre" : "Select production type first"} />
              </SelectTrigger>
              <SelectContent>
                {genres.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Subgenre (conditional) */}
        {subgenres.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Subgenre</Label>
            <Select value={subgenre} onValueChange={setSubgenre}>
              <SelectTrigger>
                <SelectValue placeholder="Optional: narrow the genre" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {subgenres.map(sg => (
                  <SelectItem key={sg} value={sg}>{sg}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Row 2: Budget + Region */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Budget Band</Label>
            <Select value={budgetBand} onValueChange={setBudgetBand} disabled={!productionType}>
              <SelectTrigger>
                <SelectValue placeholder="Any budget" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {budgets.map((b: any) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger>
                <SelectValue placeholder="Global" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Global</SelectItem>
                {REGIONS.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 3: Platform + Audience */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Platform Target</Label>
            <Select value={platformTarget} onValueChange={setPlatformTarget} disabled={!productionType}>
              <SelectTrigger>
                <SelectValue placeholder="Any platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {platforms.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Audience Demo</Label>
            <Select value={audienceDemo} onValueChange={setAudienceDemo} disabled={!productionType}>
              <SelectTrigger>
                <SelectValue placeholder="Any audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                {audiences.map((a: any) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Risk Appetite */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Risk Appetite</Label>
          <div className="grid grid-cols-3 gap-2">
            {RISK_LEVELS.map(r => (
              <button
                key={r.value}
                onClick={() => setRiskAppetite(r.value)}
                className={`rounded-lg border p-3 text-left transition-all ${
                  riskAppetite === r.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border/40 hover:border-border'
                }`}
              >
                <span className="text-sm font-medium">{r.value.charAt(0).toUpperCase() + r.value.slice(1)}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Additional Notes</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any specific direction, themes, or constraints…" rows={2} />
        </div>

        {/* Generate button */}
        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {!productionType && <Badge variant="outline" className="text-destructive border-destructive/30">Set Production Type</Badge>}
            {productionType && !genre && <Badge variant="outline" className="text-destructive border-destructive/30">Set Genre</Badge>}
            {isValid && <Badge variant="outline" className="text-primary border-primary/30">Brief ready</Badge>}
          </div>
          <Button onClick={handleSaveAndGenerate} disabled={!isValid || generating} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {generating ? 'Generating…' : 'Save Brief & Generate Ideas'}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
