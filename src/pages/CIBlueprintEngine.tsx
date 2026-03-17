import { useState } from 'react';
import { Header } from '@/components/Header';
import { Loader2, Zap, TrendingUp, Award, Rocket, ChevronDown, FlaskConical, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  useBuildBlueprint,
  useBlueprintCandidates,
  useBlueprints,
  usePromoteCandidate,
  type BuildConfig,
  type BlueprintCandidate,
} from '@/hooks/useBlueprintEngine';

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.min(100, (Number(value) / max) * 100);
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">{Number(value).toFixed(0)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CandidateCard({ candidate, onPromote, promoting }: { candidate: BlueprintCandidate; onPromote: () => void; promoting: boolean }) {
  const scoringMethod = (candidate as any).scoring_method || 'unknown';
  const [expanded, setExpanded] = useState(false);
  const meetsThresholds = Number(candidate.score_total) >= 95 && Number(candidate.score_market_heat) >= 80 && Number(candidate.score_feasibility) >= 75 && Number(candidate.score_lane_fit) >= 80;

  return (
    <Card className="border-border/30 hover:border-primary/30 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{candidate.title}</h3>
              <Badge variant="outline" className="text-[10px] shrink-0">{candidate.format}</Badge>
              <Badge variant="secondary" className="text-[10px] shrink-0">{candidate.genre}</Badge>
              {candidate.lane && <Badge variant="outline" className="text-[10px] shrink-0">{candidate.lane}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{candidate.logline}</p>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-lg font-bold font-mono ${Number(candidate.score_total) >= 95 ? 'text-emerald-500' : Number(candidate.score_total) >= 80 ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {Number(candidate.score_total).toFixed(0)}
            </div>
            <div className="text-[10px] text-muted-foreground">CI Score</div>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <ScoreBar label="Market" value={candidate.score_market_heat} />
          <ScoreBar label="Feasible" value={candidate.score_feasibility} />
          <ScoreBar label="Lane Fit" value={candidate.score_lane_fit} />
          <ScoreBar label="Saturation" value={candidate.score_saturation_risk} />
          <ScoreBar label="Co. Fit" value={candidate.score_company_fit} />
        </div>

        {expanded && (
          <div className="pt-2 border-t border-border/20 space-y-2">
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{candidate.one_page_pitch}</p>
            {candidate.raw_response?.protagonist_archetype && (
              <p className="text-xs"><span className="text-muted-foreground">Protagonist: </span>{candidate.raw_response.protagonist_archetype}</p>
            )}
            {candidate.raw_response?.conflict_engine && (
              <p className="text-xs"><span className="text-muted-foreground">Conflict: </span>{candidate.raw_response.conflict_engine}</p>
            )}
            {candidate.raw_response?.hook_clarity && (
              <p className="text-xs"><span className="text-muted-foreground">Hook: </span>{candidate.raw_response.hook_clarity}</p>
            )}
            <div className="pt-1 text-[10px] text-muted-foreground/60 font-mono">
              Provenance: blueprint={candidate.blueprint_id?.slice(0, 8)} | run={candidate.run_id?.slice(0, 8)}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setExpanded(!expanded)}>
            <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Less' : 'More'}
          </Button>
          <div className="flex items-center gap-2">
            {candidate.promotion_status === 'promoted' ? (
              <Badge variant="default" className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Promoted to Pitch Idea</Badge>
            ) : candidate.scoring_method === 'scoring_failed' ? (
              <Badge variant="outline" className="text-[10px] text-destructive">Scoring failed</Badge>
            ) : candidate.scoring_method === 'pending' ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Scoring…</Badge>
            ) : meetsThresholds ? (
              <Button size="sm" className="h-7 text-xs gap-1" onClick={onPromote} disabled={promoting}>
                {promoting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                Promote to Pitch Idea
              </Button>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Below threshold</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CIBlueprintEngine() {
  const [config, setConfig] = useState<BuildConfig>({
    format: 'film',
    lane: '',
    genre: '',
    engine: '',
    budgetBand: '',
    candidateCount: 5,
    useTrends: true,
    useExemplars: false,
    ciMin: 95,
  });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const buildMutation = useBuildBlueprint();
  const promoteMutation = usePromoteCandidate();
  const { data: candidates = [], isLoading: loadingCandidates } = useBlueprintCandidates(activeRunId);
  const { data: blueprints = [] } = useBlueprints(activeRunId);

  const handleBuild = async () => {
    const result = await buildMutation.mutateAsync(config);
    setActiveRunId(result.run_id);
  };

  const blueprint = blueprints[0];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-6 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-display font-bold">CI Blueprint Engine</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Reverse-engineer elite idea patterns, generate structurally strong candidates, and promote winners.
          </p>
        </div>

        {/* Controls */}
        <Card className="border-border/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Blueprint Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Format</Label>
                <Select value={config.format} onValueChange={(v) => setConfig(c => ({ ...c, format: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['film', 'tv-series', 'limited-series', 'vertical-drama', 'documentary', 'documentary-series', 'short-film', 'anim-feature', 'anim-series'].map(f => (
                      <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Lane</Label>
                <Select value={config.lane || '__any'} onValueChange={(v) => setConfig(c => ({ ...c, lane: v === '__any' ? '' : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any" className="text-xs">Any</SelectItem>
                    {['prestige', 'mainstream', 'indie', 'genre', 'arthouse', 'commercial', 'platform'].map(l => (
                      <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Genre</Label>
                <Input className="h-8 text-xs" placeholder="e.g. thriller" value={config.genre} onChange={(e) => setConfig(c => ({ ...c, genre: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Budget Band</Label>
                <Select value={config.budgetBand || '__any'} onValueChange={(v) => setConfig(c => ({ ...c, budgetBand: v === '__any' ? '' : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any" className="text-xs">Any</SelectItem>
                    {['micro', 'low', 'mid', 'high', 'tentpole'].map(b => (
                      <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Candidates ({config.candidateCount})</Label>
                <Slider min={1} max={10} step={1} value={[config.candidateCount]} onValueChange={([v]) => setConfig(c => ({ ...c, candidateCount: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">CI Threshold ({config.ciMin})</Label>
                <Slider min={80} max={100} step={1} value={[config.ciMin]} onValueChange={([v]) => setConfig(c => ({ ...c, ciMin: v }))} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={config.useTrends} onCheckedChange={(v) => setConfig(c => ({ ...c, useTrends: v }))} />
                <Label className="text-xs flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Trends</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={config.useExemplars} onCheckedChange={(v) => setConfig(c => ({ ...c, useExemplars: v }))} />
                <Label className="text-xs flex items-center gap-1"><Award className="h-3 w-3" /> Exemplars Only</Label>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button onClick={handleBuild} disabled={buildMutation.isPending} className="gap-1.5">
                {buildMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {buildMutation.isPending ? 'Generating...' : 'Build Blueprint & Generate'}
              </Button>
              {buildMutation.isPending && (
                <span className="text-xs text-muted-foreground animate-pulse">Analyzing patterns and generating candidates…</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Blueprint Summary */}
        {blueprint && (
          <Card className="border-border/30 bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Blueprint Pattern</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Source Ideas: </span>
                  <span className="font-medium">{blueprint.derived_from_idea_ids?.length || 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg CI: </span>
                  <span className="font-mono font-medium">{(blueprint.score_pattern as any)?.avg_total?.toFixed(1) || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg Market Heat: </span>
                  <span className="font-mono font-medium">{(blueprint.score_pattern as any)?.avg_market_heat?.toFixed(1) || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Trends Used: </span>
                  <span className="font-medium">{(blueprint.market_design as any)?.trendCount || 0}</span>
                </div>
              </div>
              {(blueprint.score_pattern as any)?.common_genres?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(blueprint.score_pattern as any).common_genres.map((g: string) => (
                    <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Candidates */}
        {activeRunId && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Generated Candidates
                {candidates.length > 0 && <Badge variant="secondary" className="text-[10px]">{candidates.length}</Badge>}
              </h2>
            </div>

            {loadingCandidates ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading candidates…
              </div>
            ) : candidates.length === 0 ? (
              <Card className="border-dashed border-border/40">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertCircle className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">No candidates generated yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {candidates.map((c) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    onPromote={() => promoteMutation.mutate(c.id)}
                    promoting={promoteMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!activeRunId && !buildMutation.isPending && (
          <Card className="border-dashed border-border/40">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FlaskConical className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <h3 className="text-sm font-medium text-muted-foreground mb-1">No blueprint built yet</h3>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Configure your parameters above and click "Build Blueprint & Generate" to derive patterns from high-CI ideas and generate new candidates.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
