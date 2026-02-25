import React, { useState, useEffect } from 'react';
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
  Search, Star, Loader2, FileText, ChevronDown, CheckCircle2, Plus, Eye,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { INFLUENCE_DIMENSIONS, type InfluenceDimension } from '@/lib/rulesets/types';
import { toast } from 'sonner';

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

export function CompsPanel({ projectId, lane, userId, onInfluencersSet }: CompsPanelProps) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selections, setSelections] = useState<Record<string, InfluencerSelection>>({});
  const [saving, setSaving] = useState(false);

  // Auto-seed state
  const [useProjectDocs, setUseProjectDocs] = useState(true);
  const [seedOverride, setSeedOverride] = useState('');
  const [showSeedOverride, setShowSeedOverride] = useState(false);
  const [seedSources, setSeedSources] = useState<SeedSource[]>([]);
  const [seedPreview, setSeedPreview] = useState('');
  const [showSeedPreview, setShowSeedPreview] = useState(false);

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
    try {
      const { data, error } = await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'find_candidates',
          project_id: projectId,
          lane,
          user_id: userId,
          use_project_docs: useProjectDocs,
          seed_override: showSeedOverride && seedOverride.trim() ? seedOverride.trim() : null,
          filters: {},
        },
      });
      if (error) throw error;

      if (data.fallback_reason && (!data.candidates || data.candidates.length === 0)) {
        toast.info(data.message || 'No seed available. Add project docs or provide a seed manually.');
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
                    {s.title} ({s.kind})
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

          {/* Override Seed */}
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
              {lookupMatches.map((m, i) => (
                <div
                  key={`${m.title}-${m.year}-${i}`}
                  className="flex items-center justify-between gap-2 p-1.5 rounded border border-border/50 bg-background text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{m.title}</span>
                    {m.year && <span className="text-muted-foreground ml-1">({m.year})</span>}
                    <Badge variant="outline" className="text-[8px] ml-1.5">{m.format}</Badge>
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
              ))}
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

        {/* ── Candidate List ── */}
        {candidates.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {candidates.map(c => {
              const selected = !!selections[c.id];
              const isUserValidated = c.query?.source === 'user_requested_lookup';
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
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{c.title}</span>
                        {c.year && <span className="text-muted-foreground">({c.year})</span>}
                        <Badge variant="outline" className="text-[9px] shrink-0">{c.format}</Badge>
                        {isUserValidated && (
                          <Badge variant="secondary" className="text-[8px] shrink-0">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                            validated
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2">{c.rationale}</p>
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
            })}
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
