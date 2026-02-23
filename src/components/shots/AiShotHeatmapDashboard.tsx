/**
 * AiShotHeatmapDashboard — Project-level AI shot readiness heatmap + scores.
 * Shows tier distribution, project readiness score, coverage metrics, and shot heatmap grid.
 */
import { useState, useMemo } from 'react';
import { useProjectAiShotReadiness, type AiShotRow, type ProjectAiScores } from '@/hooks/useProjectAiShotReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Loader2, Sparkles, CheckCircle2, AlertTriangle, XCircle,
  BarChart3, Grid3X3, Filter, Image, Zap,
} from 'lucide-react';

interface AiShotHeatmapDashboardProps {
  projectId: string;
}

const tierConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  A: { label: 'Tier A', color: 'text-emerald-400', bgColor: 'bg-emerald-500', icon: <CheckCircle2 className="h-3 w-3" /> },
  B: { label: 'Tier B', color: 'text-blue-400', bgColor: 'bg-blue-500', icon: <Sparkles className="h-3 w-3" /> },
  C: { label: 'Tier C', color: 'text-amber-400', bgColor: 'bg-amber-500', icon: <AlertTriangle className="h-3 w-3" /> },
  D: { label: 'Tier D', color: 'text-red-400', bgColor: 'bg-red-500', icon: <XCircle className="h-3 w-3" /> },
};

type FilterMode = 'all' | 'A' | 'B' | 'C' | 'D' | 'unlabeled' | 'candidates' | 'with-frames';

export function AiShotHeatmapDashboard({ projectId }: AiShotHeatmapDashboardProps) {
  const { shots, mediaByShotId, scores, isLoading, refetch } = useProjectAiShotReadiness(projectId);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sortBy, setSortBy] = useState<'order' | 'confidence' | 'tier'>('order');

  const filteredShots = useMemo(() => {
    let result = [...shots];

    switch (filter) {
      case 'A': case 'B': case 'C': case 'D':
        result = result.filter(s => s.ai_readiness_tier === filter);
        break;
      case 'unlabeled':
        result = result.filter(s => !s.ai_readiness_tier);
        break;
      case 'candidates':
        result = result.filter(s => s.ai_candidate);
        break;
      case 'with-frames':
        result = result.filter(s => (mediaByShotId[s.id]?.frames ?? 0) > 0);
        break;
    }

    if (sortBy === 'confidence') {
      result.sort((a, b) => (b.ai_confidence ?? -1) - (a.ai_confidence ?? -1));
    } else if (sortBy === 'tier') {
      const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
      result.sort((a, b) => (tierOrder[a.ai_readiness_tier ?? ''] ?? 4) - (tierOrder[b.ai_readiness_tier ?? ''] ?? 4));
    }

    return result;
  }, [shots, filter, sortBy, mediaByShotId]);

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (shots.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 text-center">
          <Grid3X3 className="h-6 w-6 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">No shots found for this project. Generate shot plans first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* Project Readiness Score */}
        <ReadinessScoreCard scores={scores} onRefresh={refetch} />

        {/* Tier Distribution */}
        <TierDistributionCard scores={scores} onFilterTier={(t) => setFilter(t as FilterMode)} />

        {/* Coverage Metrics */}
        <CoverageMetricsCard scores={scores} />

        {/* Filters + Sort */}
        <Card className="border-border/50">
          <CardHeader className="px-3 py-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-1">
                <Grid3X3 className="h-3.5 w-3.5" />
                Shot Heatmap
                <Badge variant="secondary" className="text-[8px] h-4 px-1 ml-1">{filteredShots.length}/{shots.length}</Badge>
              </CardTitle>
              <div className="flex items-center gap-1">
                <Select value={filter} onValueChange={(v) => setFilter(v as FilterMode)}>
                  <SelectTrigger className="h-6 text-[9px] w-[90px]">
                    <Filter className="h-2.5 w-2.5 mr-0.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[10px]">All</SelectItem>
                    <SelectItem value="A" className="text-[10px]">Tier A</SelectItem>
                    <SelectItem value="B" className="text-[10px]">Tier B</SelectItem>
                    <SelectItem value="C" className="text-[10px]">Tier C</SelectItem>
                    <SelectItem value="D" className="text-[10px]">Tier D</SelectItem>
                    <SelectItem value="unlabeled" className="text-[10px]">Unlabeled</SelectItem>
                    <SelectItem value="candidates" className="text-[10px]">AI Candidates</SelectItem>
                    <SelectItem value="with-frames" className="text-[10px]">Has Frames</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                  <SelectTrigger className="h-6 text-[9px] w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order" className="text-[10px]">Order</SelectItem>
                    <SelectItem value="confidence" className="text-[10px]">Confidence</SelectItem>
                    <SelectItem value="tier" className="text-[10px]">Tier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <ScrollArea className="max-h-[400px]">
              {/* Heatmap Grid */}
              <div className="grid grid-cols-8 gap-1">
                {filteredShots.map((shot, i) => (
                  <ShotHeatmapCell
                    key={shot.id}
                    shot={shot}
                    index={i}
                    mediaInfo={mediaByShotId[shot.id]}
                  />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

// ── Readiness Score Card ──

function ReadinessScoreCard({ scores, onRefresh }: { scores: ProjectAiScores; onRefresh: () => void }) {
  const scoreColor =
    scores.readinessScore >= 70 ? 'text-emerald-400' :
    scores.readinessScore >= 40 ? 'text-amber-400' :
    'text-red-400';

  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-primary" />
            AI Production Readiness
          </CardTitle>
          <Button size="sm" variant="ghost" className="h-5 text-[8px] px-1.5" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <span className={`text-3xl font-bold font-mono ${scoreColor}`}>{scores.readinessScore}</span>
            <span className="text-[9px] text-muted-foreground block">/100</span>
          </div>
          <div className="flex-1 space-y-1">
            <Progress value={scores.readinessScore} className="h-2" />
            <div className="flex justify-between text-[8px] text-muted-foreground">
              <span>{scores.totalShots} shots</span>
              <span>{scores.labeledShots} labeled</span>
              <span>{scores.aiCandidateCount} AI-viable</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tier Distribution Card ──

function TierDistributionCard({ scores, onFilterTier }: { scores: ProjectAiScores; onFilterTier: (tier: string) => void }) {
  const { tierDistribution, totalShots } = scores;
  const tiers = ['A', 'B', 'C', 'D'] as const;

  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tier Distribution</span>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {/* Stacked bar */}
        <div className="flex h-5 rounded-sm overflow-hidden mb-2">
          {tiers.map(t => {
            const count = tierDistribution[t];
            const pct = totalShots > 0 ? (count / totalShots) * 100 : 0;
            if (pct === 0) return null;
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>
                  <button
                    className={`${tierConfig[t].bgColor} opacity-80 hover:opacity-100 transition-opacity`}
                    style={{ width: `${pct}%` }}
                    onClick={() => onFilterTier(t)}
                  />
                </TooltipTrigger>
                <TooltipContent className="text-[10px]">
                  {tierConfig[t].label}: {count} shots ({Math.round(pct)}%)
                </TooltipContent>
              </Tooltip>
            );
          })}
          {tierDistribution.unlabeled > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="bg-muted-foreground/20 hover:bg-muted-foreground/30 transition-colors"
                  style={{ width: `${(tierDistribution.unlabeled / totalShots) * 100}%` }}
                  onClick={() => onFilterTier('unlabeled')}
                />
              </TooltipTrigger>
              <TooltipContent className="text-[10px]">
                Unlabeled: {tierDistribution.unlabeled} shots
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Legend */}
        <div className="grid grid-cols-5 gap-1">
          {tiers.map(t => (
            <button
              key={t}
              className="flex items-center gap-0.5 text-[9px] hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
              onClick={() => onFilterTier(t)}
            >
              <span className={`w-2 h-2 rounded-sm ${tierConfig[t].bgColor}`} />
              <span className={tierConfig[t].color}>{t}</span>
              <span className="text-muted-foreground font-mono">{tierDistribution[t]}</span>
            </button>
          ))}
          <button
            className="flex items-center gap-0.5 text-[9px] hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
            onClick={() => onFilterTier('unlabeled')}
          >
            <span className="w-2 h-2 rounded-sm bg-muted-foreground/20" />
            <span className="text-muted-foreground">?</span>
            <span className="text-muted-foreground font-mono">{tierDistribution.unlabeled}</span>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Coverage Metrics Card ──

function CoverageMetricsCard({ scores }: { scores: ProjectAiScores }) {
  const metrics = [
    { label: 'Label Coverage', value: scores.labelCoverage, suffix: '%' },
    { label: 'AI Candidate Rate', value: scores.aiCandidateRate, suffix: '%' },
    { label: 'Avg Confidence', value: scores.avgConfidence, suffix: '%' },
    { label: 'Frame Coverage', value: scores.generationCoverage, suffix: '%' },
    { label: 'Motion Still Coverage', value: scores.motionStillCoverage, suffix: '%' },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Coverage Metrics</span>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-3 gap-1.5">
          {metrics.map(m => (
            <div key={m.label} className="p-1.5 rounded border border-border/50 bg-muted/10">
              <span className="text-[8px] text-muted-foreground block">{m.label}</span>
              <div className="flex items-baseline gap-0.5">
                <span className="text-sm font-bold font-mono">{m.value}</span>
                <span className="text-[8px] text-muted-foreground">{m.suffix}</span>
              </div>
              <Progress value={m.value} className="h-1 mt-0.5" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Shot Heatmap Cell ──

function ShotHeatmapCell({ shot, index, mediaInfo }: {
  shot: AiShotRow;
  index: number;
  mediaInfo?: { frames: number; motionStills: number; selectedFrames: number };
}) {
  const tier = shot.ai_readiness_tier;
  const conf = shot.ai_confidence;

  const cellColor = !tier
    ? 'bg-muted-foreground/10 border-border/30'
    : tier === 'A'
    ? 'bg-emerald-500/20 border-emerald-500/40'
    : tier === 'B'
    ? 'bg-blue-500/20 border-blue-500/40'
    : tier === 'C'
    ? 'bg-amber-500/20 border-amber-500/40'
    : 'bg-red-500/20 border-red-500/40';

  // Opacity based on confidence for labeled shots
  const opacityStyle = tier && conf != null
    ? { opacity: Math.max(0.4, conf / 100) }
    : {};

  const hasFrames = (mediaInfo?.frames ?? 0) > 0;
  const hasMotion = (mediaInfo?.motionStills ?? 0) > 0;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div
          className={`relative aspect-square rounded-sm border cursor-pointer transition-all hover:scale-110 hover:z-10 ${cellColor}`}
          style={opacityStyle}
        >
          {/* Tier letter */}
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-mono">
            {tier || '?'}
          </span>
          {/* Media indicators */}
          <div className="absolute bottom-0 right-0 flex gap-px p-px">
            {hasFrames && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            {hasMotion && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-56 text-[10px]" side="top">
        <div className="space-y-1.5">
          <div className="font-medium text-xs">{shot.shot_title || `Shot ${index + 1}`}</div>
          <div className="flex flex-wrap gap-1">
            {tier && (
              <Badge variant="outline" className={`text-[8px] h-4 px-1 ${tierConfig[tier]?.color || ''}`}>
                {tierConfig[tier]?.label || tier}
              </Badge>
            )}
            {conf != null && (
              <Badge variant="secondary" className="text-[8px] h-4 px-1">{conf}% conf</Badge>
            )}
          </div>
          {shot.shot_type && <p className="text-muted-foreground">Type: {shot.shot_type} {shot.framing || ''}</p>}
          {shot.camera_movement && shot.camera_movement !== 'static' && (
            <p className="text-muted-foreground">Camera: {shot.camera_movement}</p>
          )}
          {shot.emotional_intent && <p className="text-muted-foreground">Intent: {shot.emotional_intent}</p>}
          {shot.location_hint && <p className="text-muted-foreground">Location: {shot.location_hint}</p>}
          <Separator />
          <div className="flex gap-2 text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Image className="h-2.5 w-2.5" /> {mediaInfo?.frames ?? 0} frames
            </span>
            <span className="flex items-center gap-0.5">
              <Zap className="h-2.5 w-2.5" /> {mediaInfo?.motionStills ?? 0} motion
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
