import { useState, useMemo, useCallback } from 'react';
import { Filter, Sparkles, ChevronRight, X, Plus, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MODE_GENRES, MODE_BUDGETS } from '@/lib/constants';
import type { ProjectFormat } from '@/lib/types';
import { PITCH_CRITERIA_SCHEMA, isFieldEmpty } from '@/lib/pitch/pitchCriteriaSchema';
import type { EditedFieldsMap } from '@/lib/pitch/normalizePitchCriteria';
import { markEdited } from '@/lib/pitch/normalizePitchCriteria';
import {
  type AnimationPrimary,
  type AnimationStyle,
  type AnimationMeta,
  ANIMATION_PRIMARY_LIST,
  ANIMATION_PRIMARY_LABELS,
  ANIMATION_STYLE_LIST,
  ANIMATION_STYLE_LABELS,
  ANIMATION_TAG_CATEGORIES,
  getAnimationMeta,
} from '@/config/animationMeta';
import {
  type ProductionModality,
  MODALITY_LABELS,
  PRODUCTION_MODALITIES,
  getProjectModality,
  isAnimationModality,
} from '@/config/productionModality';

export interface HardCriteria {
  // Core
  productionType: string;
  genre: string;
  subgenre: string;
  culturalTag: string;
  toneAnchor: string;
  lane: string;
  // Format
  budgetBand: string;
  region: string;
  platformTarget: string;
  riskLevel: string;
  epLength: string;
  epCount: string;
  seasonLength: string;
  runtimeMin: string;
  runtimeMax: string;
  // Audience
  rating: string;
  audience: string;
  languageTerritory: string;
  // World
  settingType: string;
  locationVibe: string;
  arenaProfession: string;
  // Romance
  romanceTropes: string[];
  heatLevel: string;
  obstacleType: string;
  // Must/Avoid
  mustHaveTropes: string[];
  avoidTropes: string[];
  prohibitedComps: string[];
  // Feasibility
  locationsMax: string;
  castSizeMax: string;
  starRole: string;
  // Differentiation
  noveltyLevel: string;
  differentiateBy: string;
  // Notes
  notes: string;
}

const EMPTY_CRITERIA: HardCriteria = {
  productionType: '', genre: '', subgenre: '', culturalTag: '', toneAnchor: '', lane: '',
  budgetBand: '', region: '', platformTarget: '', riskLevel: 'medium', epLength: '', epCount: '',
  seasonLength: '', runtimeMin: '', runtimeMax: '',
  rating: '', audience: '', languageTerritory: '',
  settingType: '', locationVibe: '', arenaProfession: '',
  romanceTropes: [], heatLevel: '', obstacleType: '',
  mustHaveTropes: [], avoidTropes: [], prohibitedComps: [],
  locationsMax: '', castSizeMax: '', starRole: '',
  noveltyLevel: 'balanced', differentiateBy: '',
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
  { value: 'international-copro', label: "Int'l Co-Pro" },
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
const AUDIENCES = ['YA (13–17)', 'Young Adult (18–34)', 'Adult (25–54)', 'Family', 'Niche'];
const SETTING_TYPES = ['Contemporary', 'Period / Historical', 'Near Future', 'Far Future', 'Alt-Reality / Fantasy'];
const HEAT_LEVELS = ['Clean', 'Warm', 'Spicy', 'Explicit'];
const OBSTACLE_TYPES = ['Family', 'Career', 'Status / Class', 'Secret Identity', 'Supernatural', 'Distance', 'Rival', 'Circumstance'];
const NOVELTY_LEVELS = [
  { value: 'safe', label: 'Safe — proven formulas' },
  { value: 'balanced', label: 'Balanced — fresh but grounded' },
  { value: 'bold', label: 'Bold — high novelty' },
];
const DIFFERENTIATE_BY = ['Tone', 'Setting', 'Protagonist', 'Structure', 'Theme', 'Visual Style', 'Genre Blend'];
const ROMANCE_TROPES = [
  'Enemies to Lovers', 'Friends to Lovers', 'Fake Dating', 'Second Chance',
  'Forbidden Love', 'Love Triangle', 'Contract Relationship', 'Arranged Marriage',
  'Slow Burn', 'Forced Proximity', 'Secret Identity', 'Opposites Attract',
];
const CULTURAL_TAGS = [
  'J-pop', 'K-drama', 'Bollywood', 'Nordic Noir', 'Latin Telenovela', 'Afrofuturism',
  'British Kitchen Sink', 'French New Wave', 'Hong Kong Action', 'Italian Giallo',
  'Anime-Influenced', 'Wuxia', 'Nollywood', 'Middle Eastern', 'Indigenous Stories',
];

export type ResolutionMeta = Record<string, { status: string; scope: string; note?: string }>;

interface Props {
  criteria: HardCriteria;
  onChange: (criteria: HardCriteria) => void;
  onGenerate: () => void;
  generating: boolean;
  hasProject: boolean;
  editedFields: EditedFieldsMap;
  onEditedFieldsChange: (edited: EditedFieldsMap) => void;
  resolutionMeta?: ResolutionMeta;
  /** project_features of the selected project (null/undefined when global mode) */
  projectFeatures?: Record<string, any> | null;
  /** Current animation meta selections for global mode (lifted state) */
  animationMeta?: AnimationMeta;
  onAnimationMetaChange?: (meta: AnimationMeta) => void;
  /** Global-mode production modality (ignored when hasProject) */
  globalModality?: ProductionModality;
  onGlobalModalityChange?: (m: ProductionModality) => void;
}

/** Tiny Auto/Manual indicator with resolution status */
function AutoIndicator({ fieldKey, editedFields, resolutionMeta }: { fieldKey: string; editedFields: EditedFieldsMap; resolutionMeta?: ResolutionMeta }) {
  const def = PITCH_CRITERIA_SCHEMA.find(f => f.key === fieldKey);
  if (!def?.optional || !def.autoWhenMissing) return null;
  const isEdited = editedFields[fieldKey] === true;

  if (isEdited) {
    return <span className="text-[9px] uppercase tracking-wider font-medium ml-1 text-primary">Manual</span>;
  }

  const resolution = resolutionMeta?.[fieldKey];
  if (resolution) {
    const scopeLabels: Record<string, string> = {
      lane_trends: 'Trends',
      production_trends: 'Production Trends',
      global_trends: 'Global Trends',
      broad_trends: 'Broad Trends',
      lane_default: 'Lane Default',
      unresolved: 'No signal',
    };
    const label = scopeLabels[resolution.scope] || 'Auto';
    const color = resolution.scope === 'unresolved' ? 'text-muted-foreground/40' : 'text-muted-foreground/60';
    return <span className={`text-[9px] uppercase tracking-wider font-medium ml-1 ${color}`}>Auto ({label})</span>;
  }

  return <span className="text-[9px] uppercase tracking-wider font-medium ml-1 text-muted-foreground/60">Auto</span>;
}

function TagInput({ value, onChange, placeholder, variant = 'default' }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; variant?: 'default' | 'destructive' }) {
  const [input, setInput] = useState('');
  const add = (v: string) => { const t = v.trim(); if (t && !value.includes(t)) onChange([...value, t]); };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input value={input} onChange={e => setInput(e.target.value)} placeholder={placeholder} className="h-9"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(input); setInput(''); } }} />
        <Button variant="outline" size="sm" className="shrink-0 h-9" onClick={() => { add(input); setInput(''); }}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t, i) => (
            <Badge key={i} variant={variant} className="text-xs gap-1 cursor-pointer" onClick={() => remove(i)}>
              {t} <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/** Animation-specific subgenre controls — replaces text Subgenre input for animation modality */
function AnimationSubgenreControls({
  animMeta,
  onChange,
  isProjectMode,
}: {
  animMeta: AnimationMeta;
  onChange: (meta: AnimationMeta) => void;
  isProjectMode: boolean;
}) {
  return (
    <div className="col-span-full space-y-3 rounded-md p-3 border border-accent/30 bg-accent/5">
      <Label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
        <Palette className="h-3.5 w-3.5" />
        Animation Details
        <Badge variant="outline" className="text-[10px]">
          {isProjectMode ? 'Project-tuned' : 'Global — this generation only'}
        </Badge>
      </Label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Animation Subgenre (was "Primary Genre") */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Animation Subgenre</Label>
          <Select
            value={animMeta.primary || '__none__'}
            onValueChange={v => onChange({ ...animMeta, primary: v === '__none__' ? null : v as AnimationPrimary })}
            disabled={isProjectMode}
          >
            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Any</SelectItem>
              {ANIMATION_PRIMARY_LIST.map(p => (
                <SelectItem key={p} value={p}>{ANIMATION_PRIMARY_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Style */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Animation Style</Label>
          <Select
            value={animMeta.style || '__none__'}
            onValueChange={v => onChange({ ...animMeta, style: v === '__none__' ? null : v as AnimationStyle })}
            disabled={isProjectMode}
          >
            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Any</SelectItem>
              {ANIMATION_STYLE_LIST.map(s => (
                <SelectItem key={s} value={s}>{ANIMATION_STYLE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tags grouped by category */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Tags</Label>
        {Object.entries(ANIMATION_TAG_CATEGORIES).map(([category, tags]) => (
          <div key={category} className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{category}</span>
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => {
                const active = animMeta.tags.includes(tag);
                return (
                  <Badge
                    key={tag}
                    variant={active ? 'default' : 'outline'}
                    className={`text-[10px] cursor-pointer ${isProjectMode ? 'pointer-events-none opacity-70' : ''}`}
                    onClick={() => {
                      if (isProjectMode) return;
                      const next = active
                        ? animMeta.tags.filter(t => t !== tag)
                        : [...animMeta.tags, tag];
                      onChange({ ...animMeta, tags: next });
                    }}
                  >
                    {tag.replace(/_/g, ' ')}
                  </Badge>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/50">
        {isProjectMode
          ? 'Project-tuned: animation metadata is set via project settings.'
          : 'Global mode: selections apply to this generation only.'}
      </p>
    </div>
  );
}

export function HardCriteriaForm({ criteria, onChange, onGenerate, generating, hasProject, editedFields, onEditedFieldsChange, resolutionMeta, projectFeatures, animationMeta, onAnimationMetaChange, globalModality, onGlobalModalityChange }: Props) {
  /** Update value AND mark field as edited */
  const update = (patch: Partial<HardCriteria>) => {
    let newEdited = editedFields;
    for (const key of Object.keys(patch)) {
      newEdited = markEdited(newEdited, key);
    }
    onEditedFieldsChange(newEdited);
    onChange({ ...criteria, ...patch });
  };

  // Derive effective modality: project mode → from DB, global mode → from prop
  const effectiveModality: ProductionModality = hasProject
    ? getProjectModality(projectFeatures)
    : (globalModality || 'live_action');
  const isAnim = isAnimationModality(effectiveModality);

  // Animation meta: in project mode, seed from project_features (read-only); global mode uses lifted state
  const projectAnimMeta = useMemo(() => getAnimationMeta(projectFeatures), [projectFeatures]);
  const effectiveAnimMeta: AnimationMeta = hasProject ? projectAnimMeta : (animationMeta || { primary: null, tags: [], style: null });

  const handleAnimMetaChange = useCallback((meta: AnimationMeta) => {
    onAnimationMetaChange?.(meta);
  }, [onAnimationMetaChange]);

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

  const isSeriesFormat = ['tv-series', 'digital-series', 'vertical-drama'].includes(criteria.productionType);
  const isFilmFormat = ['film', 'short-film'].includes(criteria.productionType);
  const isRomanceGenre = criteria.genre?.toLowerCase().includes('romance') || criteria.subgenre?.toLowerCase().includes('romance');
  const isValid = !!criteria.productionType;

  return (
    <Card className="border-primary/20 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          Hard Criteria
        </CardTitle>
        <CardDescription>
          Non-negotiable constraints for slate generation. Unset optional fields use Trends automatically.
          {!hasProject && <Badge variant="outline" className="ml-2 text-xs">Global Mode</Badge>}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs defaultValue="core" className="w-full">
          <TabsList className="w-full grid grid-cols-4 h-9">
            <TabsTrigger value="core" className="text-xs">Core</TabsTrigger>
            <TabsTrigger value="world" className="text-xs">World</TabsTrigger>
            <TabsTrigger value="audience" className="text-xs">Audience</TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
          </TabsList>

          {/* ─── CORE TAB ─── */}
          <TabsContent value="core" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Format / Type *</Label>
                <Select value={criteria.productionType} onValueChange={v => update({ productionType: v, genre: '', budgetBand: '', platformTarget: '' })}>
                  <SelectTrigger><SelectValue placeholder="Select format" /></SelectTrigger>
                  <SelectContent>{PRODUCTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Genre <AutoIndicator fieldKey="genre" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.genre} onValueChange={v => update({ genre: v })} disabled={!criteria.productionType}>
                  <SelectTrigger><SelectValue placeholder="Any genre" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {genres.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Production Modality — global mode only (project mode derives from DB) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Production Modality
                  {hasProject && <span className="text-[9px] uppercase tracking-wider font-medium ml-1 text-muted-foreground/60">From project</span>}
                </Label>
                <Select
                  value={effectiveModality}
                  onValueChange={v => {
                    if (!hasProject) onGlobalModalityChange?.(v as ProductionModality);
                  }}
                  disabled={hasProject}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRODUCTION_MODALITIES.map(m => (
                      <SelectItem key={m} value={m}>{MODALITY_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Subgenre: show animation controls when animation/hybrid, else regular text */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {!isAnim && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Subgenre <AutoIndicator fieldKey="subgenre" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                  <Input value={criteria.subgenre} onChange={e => update({ subgenre: e.target.value })} placeholder='e.g. "workplace romance"' className="h-9" />
                </div>
              )}
            </div>

            {/* Animation subgenre controls — shown when animation/hybrid modality */}
            {isAnim && (
              <AnimationSubgenreControls
                animMeta={effectiveAnimMeta}
                onChange={handleAnimMetaChange}
                isProjectMode={hasProject}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Cultural / Style Anchor <AutoIndicator fieldKey="culturalTag" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.culturalTag} onValueChange={v => update({ culturalTag: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {CULTURAL_TAGS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tone Anchor <AutoIndicator fieldKey="toneAnchor" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Input value={criteria.toneAnchor} onChange={e => update({ toneAnchor: e.target.value })} placeholder='e.g. "sweet but sharp"' className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Lane <AutoIndicator fieldKey="lane" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.lane} onValueChange={v => update({ lane: v })}>
                  <SelectTrigger><SelectValue placeholder="Any lane" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {LANES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Format constraints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Budget Band <AutoIndicator fieldKey="budgetBand" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.budgetBand} onValueChange={v => update({ budgetBand: v })} disabled={!criteria.productionType}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {budgets.map((b: any) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isSeriesFormat && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Episode Length (min)</Label>
                    <Input type="number" value={criteria.epLength} onChange={e => update({ epLength: e.target.value })} placeholder={criteria.productionType === 'vertical-drama' ? '2–3' : '30/45/60'} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Episode Count</Label>
                    <Input type="number" value={criteria.epCount} onChange={e => update({ epCount: e.target.value })} placeholder={criteria.productionType === 'vertical-drama' ? '30' : '6/8/10'} className="h-9" />
                  </div>
                </>
              )}
              {isFilmFormat && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Runtime Min (min)</Label>
                    <Input type="number" value={criteria.runtimeMin} onChange={e => update({ runtimeMin: e.target.value })} placeholder="80" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Runtime Max (min)</Label>
                    <Input type="number" value={criteria.runtimeMax} onChange={e => update({ runtimeMax: e.target.value })} placeholder="120" className="h-9" />
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* ─── WORLD TAB ─── */}
          <TabsContent value="world" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Setting Type <AutoIndicator fieldKey="settingType" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.settingType} onValueChange={v => update({ settingType: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {SETTING_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Location Vibe <AutoIndicator fieldKey="locationVibe" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Input value={criteria.locationVibe} onChange={e => update({ locationVibe: e.target.value })} placeholder='e.g. "Tokyo nightlife"' className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Arena / Profession <AutoIndicator fieldKey="arenaProfession" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Input value={criteria.arenaProfession} onChange={e => update({ arenaProfession: e.target.value })} placeholder='e.g. "idol industry"' className="h-9" />
              </div>
            </div>

            {/* Romance-specific */}
            <div className={`space-y-3 rounded-md p-3 ${isRomanceGenre ? 'border border-primary/30 bg-primary/5' : 'border border-border/30'}`}>
              <Label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                Romance Specifics {isRomanceGenre && <Badge variant="default" className="text-[10px]">Active</Badge>}
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Heat Level</Label>
                  <Select value={criteria.heatLevel} onValueChange={v => update({ heatLevel: v })}>
                    <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Any</SelectItem>
                      {HEAT_LEVELS.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Obstacle Type</Label>
                  <Select value={criteria.obstacleType} onValueChange={v => update({ obstacleType: v })}>
                    <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Any</SelectItem>
                      {OBSTACLE_TYPES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Romance Tropes (multi-select)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ROMANCE_TROPES.map(t => {
                    const active = criteria.romanceTropes.includes(t);
                    return (
                      <Badge key={t} variant={active ? 'default' : 'outline'} className="text-xs cursor-pointer"
                        onClick={() => update({ romanceTropes: active ? criteria.romanceTropes.filter(x => x !== t) : [...criteria.romanceTropes, t] })}>
                        {t}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── AUDIENCE TAB ─── */}
          <TabsContent value="audience" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Audience <AutoIndicator fieldKey="audience" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.audience} onValueChange={v => update({ audience: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {AUDIENCES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rating <AutoIndicator fieldKey="rating" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.rating} onValueChange={v => update({ rating: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Language / Territory <AutoIndicator fieldKey="languageTerritory" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Input value={criteria.languageTerritory} onChange={e => update({ languageTerritory: e.target.value })} placeholder='e.g. "Japanese", "bilingual"' className="h-9" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Region <AutoIndicator fieldKey="region" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.region} onValueChange={v => update({ region: v })}>
                  <SelectTrigger><SelectValue placeholder="Global" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Global</SelectItem>
                    {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Platform Target <AutoIndicator fieldKey="platformTarget" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.platformTarget} onValueChange={v => update({ platformTarget: v })} disabled={!criteria.productionType}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {platforms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          {/* ─── ADVANCED TAB ─── */}
          <TabsContent value="advanced" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Novelty Level</Label>
                <Select value={criteria.noveltyLevel} onValueChange={v => update({ noveltyLevel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NOVELTY_LEVELS.map(n => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Differentiate By <AutoIndicator fieldKey="differentiateBy" editedFields={editedFields} resolutionMeta={resolutionMeta} /></Label>
                <Select value={criteria.differentiateBy} onValueChange={v => update({ differentiateBy: v })}>
                  <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {DIFFERENTIATE_BY.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Risk Level</Label>
                <Select value={criteria.riskLevel} onValueChange={v => update({ riskLevel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low — Safe bets</SelectItem>
                    <SelectItem value="medium">Medium — Calculated</SelectItem>
                    <SelectItem value="high">High — Bold swings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Max Locations</Label>
                <Input type="number" value={criteria.locationsMax} onChange={e => update({ locationsMax: e.target.value })} placeholder="No limit" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Max Cast Size</Label>
                <Input type="number" value={criteria.castSizeMax} onChange={e => update({ castSizeMax: e.target.value })} placeholder="No limit" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Star Role Needed?</Label>
                <Select value={criteria.starRole} onValueChange={v => update({ starRole: v })}>
                  <SelectTrigger><SelectValue placeholder="Not required" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not required</SelectItem>
                    <SelectItem value="yes-lead">Yes — lead role</SelectItem>
                    <SelectItem value="yes-supporting">Yes — supporting role</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Must-Have Tropes / Themes</Label>
              <TagInput value={criteria.mustHaveTropes} onChange={v => update({ mustHaveTropes: v })} placeholder='e.g. "enemies to lovers"' />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Avoid Tropes / Themes</Label>
              <TagInput value={criteria.avoidTropes} onChange={v => update({ avoidTropes: v })} placeholder='e.g. "love triangle"' variant="destructive" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prohibited Comps (titles to avoid resembling)</Label>
              <TagInput value={criteria.prohibitedComps} onChange={v => update({ prohibitedComps: v })} placeholder='e.g. "Twilight"' variant="destructive" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Additional Direction</Label>
              <Textarea value={criteria.notes} onChange={e => update({ notes: e.target.value })} placeholder="Any specific constraints, themes, or inspirations…" rows={2} />
            </div>
          </TabsContent>
        </Tabs>

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
