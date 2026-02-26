import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Search, Star, Loader2, FileText, ChevronDown, CheckCircle2, Plus, Eye, Film, Tv, Smartphone,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { INFLUENCE_DIMENSIONS, type InfluenceDimension } from '@/lib/rulesets/types';
import { toast } from 'sonner';
import { loadProjectLaneRulesetPrefs, saveProjectLaneRulesetPrefs } from '@/lib/rulesets/uiState';
import { useAuth } from '@/hooks/useAuth';

const DIM_LABELS: Record<InfluenceDimension, string> = {
  pacing: 'Pacing',
  stakes_ladder: 'Stakes Ladder',
  dialogue_style: 'Dialogue Style',
  twist_budget: 'Twist Budget',
  texture_realism: 'Texture / Realism',
  antagonism_model: 'Antagonism Model',
};

interface Candidate {
  id: string;
  title: string;
  year: number | null;
  format: string;
  region: string | null;
  genres: string[];
  rationale: string;
  confidence: number;
  query?: any;
}

interface SeedSource {
  doc_id: string;
  title: string;
  kind: string;
  updated_at: string;
  used_chars: number;
}

interface LookupMatch {
  title: string;
  year?: number | null;
  format: string;
  region?: string | null;
  genres?: string[];
  confidence: number;
  rationale: string;
}

interface InfluencerSelection {
  candidate_id: string;
  weight: number;
  dimensions: InfluenceDimension[];
  emulate_tags: string[];
  avoid_tags: string[];
}

interface CompsPanelProps {
  projectId: string;
  lane: string;
  userId: string;
  onInfluencersSet?: () => void;
}

function inferBucket(c: Candidate): 'vertical' | 'series' | 'film' {
  if (c.query?.format_bucket) {
    const b = c.query.format_bucket.toLowerCase();
    if (b === 'vertical') return 'vertical';
    if (b === 'series') return 'series';
    return 'film';
  }
  const f = (c.format || '').toLowerCase();
  if (f === 'vertical' || f === 'vertical_drama' || f === 'short-form') return 'vertical';
  if (f === 'series' || f === 'tv' || f === 'streaming') return 'series';
  return 'film';
}

const BUCKET_CONFIG = {
  vertical: { label: 'Vertical Drama Comps', icon: Smartphone, description: 'Short-form vertical dramas', color: 'text-primary' },
  series: { label: 'Format-Adjacent Series', icon: Tv, description: 'TV/streaming series with similar tone', color: 'text-muted-foreground' },
  film: { label: 'Film Comps', icon: Film, description: 'Films with similar premise/tone', color: 'text-muted-foreground' },
};

export function CompsPanel({ projectId, lane, userId, onInfluencersSet }: CompsPanelProps) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selections, setSelections] = useState<Record<string, InfluencerSelection>>({});
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  // Format filter toggles — defaults differ by lane
  const isVertical = lane === 'vertical_drama';
  const [includeFilms, setIncludeFilms] = useState(!isVertical);
  const [includeSeries, setIncludeSeries] = useState(true);
  const [includeVertical, setIncludeVertical] = useState(isVertical);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const userChangedRef = React.useRef(false);

  // Load persisted comps prefs on mount
  useEffect(() => {
    userChangedRef.current = false;
    loadProjectLaneRulesetPrefs(projectId, lane).then(prefs => {
      if (prefs.comps) {
        if (typeof prefs.comps.include_films === 'boolean') setIncludeFilms(prefs.comps.include_films);
        if (typeof prefs.comps.include_series === 'boolean') setIncludeSeries(prefs.comps.include_series);
        if (typeof prefs.comps.include_vertical === 'boolean') setIncludeVertical(prefs.comps.include_vertical);
      }
      // Allow a tick for state to flush before enabling persistence
      setTimeout(() => {
        setPrefsLoaded(true);
      }, 0);
    });
  }, [projectId, lane]);

  // Wrap setters to track user-initiated changes
  const handleSetIncludeFilms = useCallback((v: boolean) => { userChangedRef.current = true; setIncludeFilms(v); }, []);
  const handleSetIncludeSeries = useCallback((v: boolean) => { userChangedRef.current = true; setIncludeSeries(v); }, []);
  const handleSetIncludeVertical = useCallback((v: boolean) => { userChangedRef.current = true; setIncludeVertical(v); }, []);

  // Persist comps prefs when toggles change (only after user interaction)
  const persistCompsPrefs = useCallback(async (films: boolean, series: boolean, vertical: boolean) => {
    if (!user?.id) return;
    const prefs = await loadProjectLaneRulesetPrefs(projectId, lane);
    await saveProjectLaneRulesetPrefs(projectId, lane, {
      ...prefs,
      comps: { include_films: films, include_series: series, include_vertical: vertical },
    }, user.id);
  }, [projectId, lane, user?.id]);

  useEffect(() => {
    if (prefsLoaded && userChangedRef.current) {
      persistCompsPrefs(includeFilms, includeSeries, includeVertical);
    }
  }, [includeFilms, includeSeries, includeVertical, prefsLoaded, persistCompsPrefs]);

  // Auto-seed state
  const [useProjectDocs, setUseProjectDocs] = useState(true);
  const [seedOverride, setSeedOverride] = useState('');
  const [showSeedOverride, setShowSeedOverride] = useState(false);
  const [seedSources, setSeedSources] = useState<SeedSource[]>([]);
  const [seedPreview, setSeedPreview] = useState('');
  const [showSeedPreview, setShowSeedPreview] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [seedDebug, setSeedDebug] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  // Lookup state
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMatches, setLookupMatches] = useState<LookupMatch[]>([]);
  const [showLookupResults, setShowLookupResults] = useState(false);

  // Load existing candidates on mount
  useEffect(() => {
    const loadExisting = async () => {
      const { data } = await (supabase as any)
        .from('comparable_candidates')
        .select('*')
        .eq('project_id', projectId)
        .eq('lane', lane)
        .order('created_at', { ascending: false })
        .limit(20);
      if (data?.length) setCandidates(data);
    };
    loadExisting();
  }, [projectId, lane]);

  const findCandidates = async () => {
    setLoading(true);
    setSeedSources([]);
    setSeedPreview('');
    setFallbackReason(null);
    setSeedDebug(null);
    setShowDebug(false);
    try {
      const { data, error } = await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'find_candidates',
          project_id: projectId,
          lane,
          user_id: userId,
          use_project_docs: useProjectDocs,
          seed_override: showSeedOverride && seedOverride.trim() ? seedOverride.trim() : null,
          include_films: includeFilms,
          include_series: includeSeries,
          include_vertical: includeVertical,
          filters: {},
        },
      });
      if (error) throw error;

      if (data.fallback_reason && (!data.candidates || data.candidates.length === 0)) {
        toast.info(data.message || 'No seed available. Add project docs or provide a seed manually.');
        setFallbackReason(data.fallback_reason);
        setSeedDebug(data.debug);
      }

      setCandidates(data.candidates || []);
      setSeedSources(data.seed_sources || []);
      setSeedPreview(data.seed_text_preview || '');
    } catch (err: any) {
      console.error('Find candidates error:', err);
      toast.error('Failed to find comparables');
    } finally {
      setLoading(false);
    }
  };

  const lookupComp = async () => {
    if (!lookupQuery.trim()) return;
    setLookupLoading(true);
    setLookupMatches([]);
    setShowLookupResults(true);
    try {
      const { data, error } = await supabase.functions.invoke('comps-engine', {
        body: { action: 'lookup_comp', query: lookupQuery.trim(), lane },
      });
      if (error) throw error;
      setLookupMatches(data.matches || []);
      if (!data.matches?.length) toast.info('No matches found. Try a different title.');
    } catch (err) {
      console.error('Lookup error:', err);
      toast.error('Lookup failed');
    } finally {
      setLookupLoading(false);
    }
  };

  const confirmLookupMatch = async (match: LookupMatch) => {
    // Warn if selecting a film while films are excluded
    const matchFormat = (match.format || '').toLowerCase();
    const isFilmMatch = matchFormat === 'film' || matchFormat === 'feature' || matchFormat === 'feature_film';
    if (isFilmMatch && !includeFilms) {
      const enable = confirm(
        `"${match.title}" is a film, but films are currently excluded.\n\nEnable "Include films" to add this comp?`
      );
      if (!enable) return;
      handleSetIncludeFilms(true);
    }

    try {
      const { data, error } = await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'confirm_lookup',
          project_id: projectId,
          lane,
          user_id: userId,
          match: { ...match, lookup_query: lookupQuery.trim() },
        },
      });
      if (error) throw error;
      if (data.candidate) {
        setCandidates(prev => [data.candidate, ...prev]);
        toast.success(`Added "${match.title}" as a validated comp`);
      }
      setShowLookupResults(false);
      setLookupQuery('');
      setLookupMatches([]);
    } catch (err) {
      console.error('Confirm lookup error:', err);
      toast.error('Failed to confirm comp');
    }
  };

  const toggleCandidate = (id: string) => {
    setSelections(prev => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return {
        ...prev,
        [id]: {
          candidate_id: id,
          weight: 1.0,
          dimensions: ['pacing', 'stakes_ladder'] as InfluenceDimension[],
          emulate_tags: [],
          avoid_tags: [],
        },
      };
    });
  };

  const updateSelection = (id: string, updates: Partial<InfluencerSelection>) => {
    setSelections(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  };

  const toggleDimension = (id: string, dim: InfluenceDimension) => {
    setSelections(prev => {
      const sel = prev[id];
      if (!sel) return prev;
      const dims = sel.dimensions.includes(dim)
        ? sel.dimensions.filter(d => d !== dim)
        : [...sel.dimensions, dim];
      return { ...prev, [id]: { ...sel, dimensions: dims } };
    });
  };

  const saveInfluencers = async () => {
    setSaving(true);
    try {
      const influencer_selections = Object.values(selections);
      if (influencer_selections.length === 0) return;

      await supabase.functions.invoke('comps-engine', {
        body: { action: 'set_influencers', project_id: projectId, lane, user_id: userId, influencer_selections },
      });
      await supabase.functions.invoke('comps-engine', {
        body: { action: 'build_engine_profile', project_id: projectId, lane, user_id: userId },
      });
      onInfluencersSet?.();
      toast.success('Influencers set & engine profile built');
    } catch (err) {
      console.error('Save influencers error:', err);
      toast.error('Failed to save influencers');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = Object.keys(selections).length;

  // Bucket candidates
  const verticalCandidates = candidates.filter(c => inferBucket(c) === 'vertical');
  const seriesCandidates = candidates.filter(c => inferBucket(c) === 'series');
  const filmCandidates = candidates.filter(c => inferBucket(c) === 'film');

  const renderCandidateCard = (c: Candidate) => {
    const selected = !!selections[c.id];
    const isUserValidated = c.query?.source === 'user_requested_lookup';
    const bucket = inferBucket(c);
    const whyComp = c.query?.why_this_comp;

    return (
      <div
        key={c.id}
        className={`p-2 rounded-md border text-xs cursor-pointer transition-colors ${
          selected ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'
        }`}
        onClick={() => toggleCandidate(c.id)}
      >
        <div className="flex items-start gap-2">
          <Checkbox checked={selected} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium truncate">{c.title}</span>
              {c.year && <span className="text-muted-foreground">({c.year})</span>}
              <Badge
                variant="outline"
                className={`text-[9px] shrink-0 ${
                  bucket === 'vertical' ? 'border-primary/40 text-primary' :
                  bucket === 'series' ? 'border-secondary text-secondary-foreground' :
                  'border-muted text-muted-foreground'
                }`}
              >
                {c.format}
              </Badge>
              {isUserValidated && (
                <Badge variant="secondary" className="text-[8px] shrink-0">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  validated
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 line-clamp-2">{c.rationale}</p>
            {whyComp && (
              <p className="text-[9px] text-primary/70 mt-0.5 italic">{whyComp}</p>
            )}
            {c.genres?.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {(c.genres as string[]).slice(0, 3).map(g => (
                  <Badge key={g} variant="secondary" className="text-[8px]">{g}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {selected && (
          <div className="mt-2 pl-6 space-y-2" onClick={e => e.stopPropagation()}>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Weight</label>
              <Slider
                value={[selections[c.id].weight]}
                min={0.1} max={2.0} step={0.1}
                onValueChange={([v]) => updateSelection(c.id, { weight: v })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Influence Dimensions</label>
              <div className="flex flex-wrap gap-1">
                {INFLUENCE_DIMENSIONS.map(dim => (
                  <Badge
                    key={dim}
                    variant={selections[c.id].dimensions.includes(dim) ? 'default' : 'outline'}
                    className="text-[8px] cursor-pointer"
                    onClick={() => toggleDimension(c.id, dim)}
                  >
                    {DIM_LABELS[dim]}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBucket = (
    bucketKey: 'vertical' | 'series' | 'film',
    items: Candidate[],
    defaultOpen: boolean,
  ) => {
    if (items.length === 0) return null;
    const config = BUCKET_CONFIG[bucketKey];
    const Icon = config.icon;

    return (
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1.5 text-xs hover:bg-muted/20 rounded px-1">
          <div className="flex items-center gap-1.5">
            <Icon className={`h-3.5 w-3.5 ${config.color}`} />
            <span className="font-medium">{config.label}</span>
            <Badge variant="outline" className="text-[8px] px-1.5 py-0">{items.length}</Badge>
          </div>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="text-[9px] text-muted-foreground mb-1.5 px-1">{config.description}</p>
          <div className="space-y-1.5">
            {items.map(renderCandidateCard)}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Star className="h-4 w-4 text-primary" />
          Comparables
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Auto-Seed Controls ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={useProjectDocs} onCheckedChange={setUseProjectDocs} />
              <label className="text-xs text-muted-foreground">Use Project Docs</label>
            </div>
            <Button size="sm" onClick={findCandidates} disabled={loading} className="h-8 text-xs">
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
              Find Comparables
            </Button>
          </div>

          {/* ── Format Filter Toggles ── */}
          {isVertical && (
            <div className="flex items-center gap-4 text-[10px] bg-muted/30 rounded-md p-2">
              <span className="text-muted-foreground font-medium shrink-0">Format filters:</span>
              <div className="flex items-center gap-1.5">
                <Switch checked={includeVertical} onCheckedChange={handleSetIncludeVertical} className="scale-75" />
                <span className="text-muted-foreground">Vertical</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={includeSeries} onCheckedChange={handleSetIncludeSeries} className="scale-75" />
                <span className="text-muted-foreground">Series</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={includeFilms} onCheckedChange={handleSetIncludeFilms} className="scale-75" />
                <span className="text-muted-foreground">Films</span>
              </div>
            </div>
          )}

          {/* Seed Sources Display */}
          {seedSources.length > 0 && (
            <div className="bg-muted/40 rounded-md p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                <FileText className="h-3 w-3" />
                Based on:
              </div>
              <div className="flex flex-wrap gap-1">
                {seedSources.map(s => (
                  <Badge key={s.doc_id} variant="secondary" className="text-[9px]">
                    {s.title} ({s.kind}) · {s.used_chars.toLocaleString()} chars
                  </Badge>
                ))}
              </div>
              {seedPreview && (
                <button
                  onClick={() => setShowSeedPreview(!showSeedPreview)}
                  className="text-[10px] text-primary hover:underline flex items-center gap-1"
                >
                  <Eye className="h-3 w-3" />
                  {showSeedPreview ? 'Hide' : 'View'} seed summary
                </button>
              )}
              {showSeedPreview && seedPreview && (
                <pre className="text-[10px] text-muted-foreground bg-muted/50 p-2 rounded whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {seedPreview}
                </pre>
              )}
            </div>
          )}

          {/* Fallback / Debug Info */}
          {fallbackReason && candidates.length === 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-2 space-y-1">
              <p className="text-[10px] text-destructive font-medium">Seed extraction failed</p>
              <p className="text-[10px] text-muted-foreground">{fallbackReason}</p>
              {seedDebug && (
                <Collapsible open={showDebug} onOpenChange={setShowDebug}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                    <ChevronDown className={`h-3 w-3 transition-transform ${showDebug ? 'rotate-180' : ''}`} />
                    Debug details ({seedDebug.found_docs} docs found)
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 space-y-0.5">
                      {seedDebug.tried?.map((t: any, i: number) => (
                        <p key={i} className="text-[9px] text-muted-foreground font-mono">
                          {t.kind}: {t.extracted_chars} chars — {t.reason}
                        </p>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}

          <Collapsible open={showSeedOverride} onOpenChange={setShowSeedOverride}>
            <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3 w-3 transition-transform ${showSeedOverride ? 'rotate-180' : ''}`} />
              Override seed (optional)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Textarea
                value={seedOverride}
                onChange={e => setSeedOverride(e.target.value)}
                placeholder="Paste a premise/logline to use instead of project docs…"
                className="text-xs min-h-[60px] mt-1"
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* ── Lookup a Comparable ── */}
        <div className="border-t border-border/30 pt-3 space-y-2">
          <label className="text-[10px] text-muted-foreground font-medium">Lookup a Comparable</label>
          <div className="flex gap-2">
            <Input
              value={lookupQuery}
              onChange={e => setLookupQuery(e.target.value)}
              placeholder="e.g. Succession, Industry, Crash Landing…"
              className="h-8 text-xs"
              onKeyDown={e => e.key === 'Enter' && lookupComp()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={lookupComp}
              disabled={lookupLoading || !lookupQuery.trim()}
              className="h-8 text-xs shrink-0"
            >
              {lookupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            </Button>
          </div>

          {showLookupResults && lookupMatches.length > 0 && (
            <div className="space-y-1.5 bg-muted/30 rounded-md p-2">
              <p className="text-[10px] text-muted-foreground font-medium">
                Select the correct match:
              </p>
              {lookupMatches.map((m, i) => {
                const matchBucket = inferBucket({ format: m.format } as Candidate);
                const isLaneFit = (isVertical && matchBucket === 'vertical') || (!isVertical && matchBucket !== 'vertical');
                return (
                  <div
                    key={`${m.title}-${m.year}-${i}`}
                    className={`flex items-center justify-between gap-2 p-1.5 rounded border text-xs ${
                      isLaneFit ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-background'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{m.title}</span>
                        {m.year && <span className="text-muted-foreground">({m.year})</span>}
                        <Badge variant="outline" className="text-[8px]">{m.format}</Badge>
                        {isLaneFit && (
                          <Badge variant="secondary" className="text-[8px] bg-primary/10 text-primary">
                            Best fit
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{m.rationale}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] shrink-0 text-primary"
                      onClick={() => confirmLookupMatch(m)}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-0.5" />
                      This one
                    </Button>
                  </div>
                );
              })}
              <button
                onClick={() => { setShowLookupResults(false); setLookupMatches([]); }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                None of these — refine search
              </button>
            </div>
          )}
        </div>

        {/* ── No Docs Empty State ── */}
        {candidates.length === 0 && !loading && seedSources.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground space-y-1">
            <p>No comparables yet.</p>
            <p>Click <strong>Find Comparables</strong> to auto-seed from project docs, or look up a specific title above.</p>
          </div>
        )}

        {/* ── Bucketed Candidate List ── */}
        {candidates.length > 0 && (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {isVertical ? (
              <>
                {renderBucket('vertical', verticalCandidates, true)}
                {renderBucket('series', seriesCandidates, true)}
                {renderBucket('film', filmCandidates, false)}
                {verticalCandidates.length === 0 && seriesCandidates.length === 0 && (
                  <div className="text-center py-3 text-[10px] text-muted-foreground bg-muted/20 rounded-md">
                    <p>No vertical or series comps found.</p>
                    <p>Try enabling "Include Films" or refining your seed.</p>
                  </div>
                )}
              </>
            ) : (
              // Non-vertical lanes: show flat list
              <div className="space-y-1.5">
                {candidates.map(renderCandidateCard)}
              </div>
            )}
          </div>
        )}

        {/* ── Save Influencers ── */}
        {selectedCount > 0 && (
          <Button
            size="sm"
            onClick={saveInfluencers}
            disabled={saving || selectedCount < 2 || selectedCount > 5}
            className="w-full h-8 text-xs"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Set {selectedCount} Influencer{selectedCount !== 1 ? 's' : ''} & Build Profile
          </Button>
        )}
        {selectedCount > 0 && (selectedCount < 2 || selectedCount > 5) && (
          <p className="text-[10px] text-destructive">Select 2–5 influencers</p>
        )}
      </CardContent>
    </Card>
  );
}
