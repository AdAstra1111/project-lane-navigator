import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Search, Star, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { INFLUENCE_DIMENSIONS, type InfluenceDimension } from '@/lib/rulesets/types';

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
  const [seedLogline, setSeedLogline] = useState('');

  const findCandidates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'find_candidates',
          project_id: projectId,
          lane,
          user_id: userId,
          seed_text: { logline: seedLogline },
          filters: {},
        },
      });
      if (error) throw error;
      setCandidates(data.candidates || []);
    } catch (err) {
      console.error('Find candidates error:', err);
    } finally {
      setLoading(false);
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
    setSelections(prev => ({
      ...prev,
      [id]: { ...prev[id], ...updates },
    }));
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
        body: {
          action: 'set_influencers',
          project_id: projectId,
          lane,
          user_id: userId,
          influencer_selections,
        },
      });

      // Build engine profile
      await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'build_engine_profile',
          project_id: projectId,
          lane,
          user_id: userId,
        },
      });

      onInfluencersSet?.();
    } catch (err) {
      console.error('Save influencers error:', err);
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
        <div className="flex gap-2">
          <Input
            value={seedLogline}
            onChange={e => setSeedLogline(e.target.value)}
            placeholder="Logline or premise..."
            className="h-8 text-xs"
          />
          <Button size="sm" onClick={findCandidates} disabled={loading} className="h-8 text-xs shrink-0">
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
            Find
          </Button>
        </div>

        {candidates.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {candidates.map(c => {
              const selected = !!selections[c.id];
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
                          min={0.1}
                          max={2.0}
                          step={0.1}
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
