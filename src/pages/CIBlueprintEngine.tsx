import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { Loader2, Zap, TrendingUp, Award, Rocket, ChevronDown, FlaskConical, Sparkles, AlertCircle, ExternalLink, Dna } from 'lucide-react';
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
import { useDnaProfiles } from '@/hooks/useNarrativeDna';

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

function CandidateCard({ candidate, onPromote, promoting, onOpenPitchIdea }: { candidate: BlueprintCandidate; onPromote: () => void; promoting: boolean; onOpenPitchIdea?: (pitchIdeaId: string) => void }) {
  const scoringMethod = (candidate as any).scoring_method || 'unknown';
  const [expanded, setExpanded] = useState(false);
  const meetsThresholds = Number(candidate.score_total) >= 95 && Number(candidate.score_market_heat) >= 80 && Number(candidate.score_feasibility) >= 75 && Number(candidate.score_lane_fit) >= 80;
  const promotedPitchIdeaId = candidate.promoted_pitch_idea_id || candidate.pitch_idea_id;
  const provenance = candidate.provenance || {};
  const isDnaInformed = provenance.optimizer_mode === 'dna_informed' || !!provenance.source_dna_profile_id;

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
              {isDnaInformed && (
                <Badge variant="outline" className="text-[10px] shrink-0 border-violet-500/30 text-violet-400">
                  <Dna className="h-2.5 w-2.5 mr-0.5" />DNA
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{candidate.logline}</p>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-lg font-bold font-mono ${Number(candidate.score_total) >= 95 ? 'text-emerald-500' : Number(candidate.score_total) >= 80 ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {Number(candidate.score_total).toFixed(0)}
            </div>
            <div className="text-[10px] text-muted-foreground">CI Score</div>
            {scoringMethod === 'independent_evaluation' && (
              <div className="text-[9px] text-emerald-500/70">✓ Evaluated</div>
            )}
            {scoringMethod === 'scoring_failed' && (
              <div className="text-[9px] text-destructive/70">⚠ Unscored</div>
            )}
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
            {isDnaInformed && provenance.dna_source_title && (
              <div className="flex items-center gap-1.5 text-[10px] text-violet-400/80">
                <Dna className="h-3 w-3" />
                <span>DNA: {provenance.dna_source_title}</span>
                {provenance.source_engine_key && <span>· Engine: {provenance.source_engine_key}</span>}
              </div>
            )}
            <div className="pt-1 text-[10px] text-muted-foreground/60 font-mono">
              Provenance: blueprint={candidate.blueprint_id?.slice(0, 8)} | run={candidate.run_id?.slice(0, 8)}
              {provenance.optimizer_mode ? ` | mode=${provenance.optimizer_mode}` : ''}
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
              <div className="flex items-center gap-1.5">
                <Badge variant="default" className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Promoted</Badge>
                {promotedPitchIdeaId && onOpenPitchIdea && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onOpenPitchIdea(promotedPitchIdeaId)}>
                    <ExternalLink className="h-3 w-3" />
                    Open Pitch Idea
                  </Button>
                )}
              </div>
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
  const navigate = useNavigate();
  const [config, setConfig] = useState<BuildConfig>({
    format: 'film',
    lane: '',
    genre: '',
    engine: '',
    budgetBand: '',
    candidateCount: 5,
    useTrends: true,
    useExemplars: false,
    ciMin: 80,
    sourceDnaProfileId: null,
    useLearningPoolOnly: false,
  });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<{
    source_idea_count: number; optimizer_mode: string; dna_profile_title: string | null;
    dna_match_count?: number; engine_match_count?: number; generic_fallback_count?: number;
    fallback_stage?: string; final_ci_threshold?: number; genre_relaxed?: boolean; lane_relaxed?: boolean;
    learning_pool_only?: boolean; learning_pool_match_count?: number;
  } | null>(null);

  const buildMutation = useBuildBlueprint();
  const promoteMutation = usePromoteCandidate();
  const { data: candidates = [], isLoading: loadingCandidates } = useBlueprintCandidates(activeRunId);
  const { data: blueprints = [] } = useBlueprints(activeRunId);
  const { data: dnaProfiles = [] } = useDnaProfiles();

  const lockedProfiles = dnaProfiles.filter(p => p.status === 'locked');
  const selectedDna = lockedProfiles.find(p => p.id === config.sourceDnaProfileId);

  const handleBuild = async () => {
    const result = await buildMutation.mutateAsync(config);
    setActiveRunId(result.run_id);
    setBuildResult({
      source_idea_count: result.source_idea_count,
      optimizer_mode: result.optimizer_mode,
      dna_profile_title: result.dna_profile_title,
      dna_match_count: result.dna_match_count,
      engine_match_count: result.engine_match_count,
      generic_fallback_count: result.generic_fallback_count,
      fallback_stage: result.fallback_stage,
      final_ci_threshold: result.final_ci_threshold,
      genre_relaxed: result.genre_relaxed,
      lane_relaxed: result.lane_relaxed,
      learning_pool_only: result.learning_pool_only,
      learning_pool_match_count: result.learning_pool_match_count,
    });
  };

  const handleOpenPitchIdea = (pitchIdeaId: string) => {
    navigate(`/pitch-ideas?highlight=${pitchIdeaId}`);
  };

  const promotedCount = candidates.filter(c => c.promotion_status === 'promoted').length;

  const blueprint = blueprints[0];
  const isDnaMode = !!config.sourceDnaProfileId;
  const blueprintMode = blueprint?.blueprint_mode || (isDnaMode ? 'dna_informed' : 'ci_pattern');

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

            {/* DNA Profile Selector */}
            <div className="rounded-md border border-border/40 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Dna className="h-3.5 w-3.5 text-violet-400" />
                <Label className="text-xs font-medium">Narrative DNA Constraint</Label>
                <Badge variant="outline" className="text-[9px] ml-auto">Optional</Badge>
              </div>
              <Select
                value={config.sourceDnaProfileId || '__none'}
                onValueChange={(v) => setConfig(c => ({ ...c, sourceDnaProfileId: v === '__none' ? null : v }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="No DNA constraint" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-xs">None — generic CI patterns</SelectItem>
                  {lockedProfiles.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.source_title}
                      {(p as any).primary_engine_key ? ` [${(p as any).primary_engine_key}]` : ''}
                      {p.extraction_confidence != null ? ` (${Math.round(p.extraction_confidence * 100)}%)` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDna && (
                <div className="rounded border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5 text-[11px] space-y-0.5">
                  <div className="font-medium text-violet-300/90">{selectedDna.source_title}</div>
                  {selectedDna.thematic_spine && (
                    <div className="text-muted-foreground"><span className="text-violet-400/60">Spine:</span> {selectedDna.thematic_spine}</div>
                  )}
                  <div className="text-muted-foreground/70 italic">Blueprint will be optimized for this DNA's structural patterns</div>
                </div>
              )}
              {lockedProfiles.length === 0 && (
                <p className="text-[10px] text-muted-foreground/60">No locked DNA profiles available. Lock a profile at /narrative-dna first.</p>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Candidates ({config.candidateCount})</Label>
                <Slider min={1} max={10} step={1} value={[config.candidateCount]} onValueChange={([v]) => setConfig(c => ({ ...c, candidateCount: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">CI Threshold ({config.ciMin})</Label>
                <Slider min={50} max={100} step={5} value={[config.ciMin]} onValueChange={([v]) => setConfig(c => ({ ...c, ciMin: v }))} />
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
                {buildMutation.isPending ? 'Generating...' : isDnaMode ? 'Build DNA-Informed Blueprint' : 'Build Blueprint & Generate'}
              </Button>
              {buildMutation.isPending && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  {isDnaMode ? 'Analyzing DNA patterns and generating candidates…' : 'Analyzing patterns and generating candidates…'}
                </span>
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
                <Badge variant="outline" className={`text-[10px] ml-auto ${blueprintMode === 'dna_informed' ? 'border-violet-500/30 text-violet-400' : ''}`}>
                  {blueprintMode === 'dna_informed' ? '🧬 DNA-Informed' : '📊 CI Pattern'}
                </Badge>
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
              {blueprint.source_dna_profile_id && (
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-violet-400/80">
                  <Dna className="h-3 w-3" />
                  <span>DNA: {blueprint.source_engine_key ? `${blueprint.source_engine_key} engine` : 'profile active'}</span>
                  {blueprint.dna_constraint_mode && <span>· mode: {blueprint.dna_constraint_mode}</span>}
                </div>
              )}
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

        {/* Retrieval Breakdown */}
        {buildResult && activeRunId && (
          <div className="space-y-2">
            <div className="rounded-md border border-border/40 bg-muted/20 px-4 py-3 text-xs space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">Source Ideas:</span>
                <span className="font-mono font-medium">{buildResult.source_idea_count}</span>
                <span className="text-muted-foreground ml-2">Mode:</span>
                <Badge variant="outline" className={`text-[10px] ${buildResult.optimizer_mode === 'dna_informed' ? 'border-violet-500/30 text-violet-400' : ''}`}>
                  {buildResult.optimizer_mode === 'dna_informed' ? '🧬 DNA-Informed' : '📊 CI Pattern'}
                </Badge>
                {buildResult.dna_profile_title && (
                  <>
                    <span className="text-muted-foreground ml-2">DNA:</span>
                    <span className="font-medium text-violet-400">{buildResult.dna_profile_title}</span>
                  </>
                )}
              </div>

              {/* Fallback telemetry */}
              <div className="flex items-center gap-3 text-[11px] flex-wrap">
                <span className="text-muted-foreground">Retrieval:</span>
                <span>CI ≥ <span className="font-mono font-medium">{buildResult.final_ci_threshold ?? config.ciMin}</span></span>
                {buildResult.fallback_stage && buildResult.fallback_stage !== 'exact' && (
                  <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                    fallback: {buildResult.fallback_stage.replace(/_/g, ' ')}
                  </Badge>
                )}
                {buildResult.genre_relaxed && (
                  <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">genre relaxed</Badge>
                )}
                {buildResult.lane_relaxed && (
                  <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">lane relaxed</Badge>
                )}
              </div>

              {buildResult.optimizer_mode === 'dna_informed' && (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-muted-foreground">DNA breakdown:</span>
                  <span><span className="text-violet-400 font-medium">{buildResult.dna_match_count ?? 0}</span> DNA-exact</span>
                  <span><span className="text-primary font-medium">{buildResult.engine_match_count ?? 0}</span> engine</span>
                  <span><span className="text-muted-foreground font-medium">{buildResult.generic_fallback_count ?? 0}</span> generic</span>
                </div>
              )}

              {buildResult.source_idea_count === 0 && (
                <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 flex items-center gap-1.5 text-amber-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>No usable source ideas found after all fallback stages</span>
                </div>
              )}
              {buildResult.source_idea_count > 0 && buildResult.optimizer_mode === 'dna_informed' && (buildResult.dna_match_count ?? 0) === 0 && (buildResult.engine_match_count ?? 0) === 0 && (
                <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 flex items-center gap-1.5 text-amber-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>Using generic fallback (no DNA-matched source ideas found)</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Candidates */}
        {activeRunId && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Generated Candidates
                {candidates.length > 0 && <Badge variant="secondary" className="text-[10px]">{candidates.length}</Badge>}
                {promotedCount > 0 && <Badge variant="default" className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{promotedCount} promoted</Badge>}
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
                    onOpenPitchIdea={handleOpenPitchIdea}
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
                {lockedProfiles.length > 0 && ' You can also select a DNA profile to constrain generation.'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
