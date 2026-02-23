/**
 * VisualUnits — Main page for Visual Unit Engine v1.0
 * 3-pane review + downstream scaffolds (Storyboard, Trailer, Pitch)
 */
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Sparkles, Loader2, Eye, CheckCircle2, XCircle,
  Lock, Unlock, AlertTriangle, GitCompare, FileText, Film,
  Image, Presentation, Download, Copy, RefreshCw,
} from 'lucide-react';
import {
  useVisualUnitSources, useVisualUnitRuns, useVisualUnitCandidates,
  useVisualUnitMutations,
} from '@/lib/visualUnits/useVisualUnits';
import { VisualUnitSourcesPanel } from '@/components/visualUnits/VisualUnitSourcesPanel';
import { VisualUnitRunsList } from '@/components/visualUnits/VisualUnitRunsList';
import { VisualUnitCandidatesList } from '@/components/visualUnits/VisualUnitCandidatesList';
import { VisualUnitCandidateCard } from '@/components/visualUnits/VisualUnitCandidateCard';
import { VisualUnitDiffPanel } from '@/components/visualUnits/VisualUnitDiffPanel';
import { VisualUnitHistoryTimeline } from '@/components/visualUnits/VisualUnitHistoryTimeline';
import type { VisualUnitCandidate, DiffJson } from '@/lib/types/visualUnits';
import { toast } from 'sonner';

export default function VisualUnits() {
  const { id: projectId } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState('review');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<VisualUnitCandidate | null>(null);
  const [diffResult, setDiffResult] = useState<{ diff_summary: string; diff_json: DiffJson } | null>(null);

  const { data: project } = useQuery({
    queryKey: ['vue-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  const sourcesQuery = useVisualUnitSources(projectId);
  const runsQuery = useVisualUnitRuns(projectId);
  const candidatesQuery = useVisualUnitCandidates(projectId, selectedRunId || undefined);
  const mutations = useVisualUnitMutations(projectId);

  // Canonical units query
  const canonicalQuery = useQuery({
    queryKey: ['vue-canonical', projectId],
    queryFn: async () => {
      const { data } = await (supabase as any).from('visual_units')
        .select('*').eq('project_id', projectId).order('unit_key');
      return data || [];
    },
    enabled: !!projectId,
  });

  // Events for selected candidate/unit
  const eventsQuery = useQuery({
    queryKey: ['vue-events', projectId, selectedCandidate?.id],
    queryFn: async () => {
      if (!selectedCandidate) return [];
      const { data } = await (supabase as any).from('visual_unit_events')
        .select('*').eq('project_id', projectId)
        .or(`candidate_id.eq.${selectedCandidate.id},unit_id.not.is.null`)
        .order('created_at', { ascending: false }).limit(50);
      return data || [];
    },
    enabled: !!projectId && !!selectedCandidate,
  });

  const runs = runsQuery.data?.runs || [];
  const candidates = candidatesQuery.data?.candidates || [];
  const canonicalUnits = canonicalQuery.data || [];

  const handleCompare = async (candidate: VisualUnitCandidate) => {
    const canonical = canonicalUnits.find((u: any) => u.unit_key === candidate.unit_key);
    if (!canonical) {
      toast.info('No canonical version to compare against');
      return;
    }
    try {
      const result = await mutations.compare.mutateAsync({
        from: { unitKey: candidate.unit_key },
        to: { candidateId: candidate.id },
        write: true,
      });
      setDiffResult(result);
    } catch {}
  };

  const downloadJSON = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const copyJSON = (data: any) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success('Copied to clipboard');
  };

  // Downstream exports
  const storyboardExport = useMemo(() => {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      units: canonicalUnits.map((u: any) => ({
        unit_key: u.unit_key,
        logline: u.canonical_payload?.logline,
        visual_intention: u.canonical_payload?.visual_intention,
        suggested_shots: u.canonical_payload?.suggested_shots,
        tone: u.canonical_payload?.tone,
        location: u.canonical_payload?.location,
        time: u.canonical_payload?.time,
      })),
    };
  }, [canonicalUnits, projectId]);

  const trailerExport = useMemo(() => {
    const sorted = [...canonicalUnits].sort((a: any, b: any) =>
      (b.canonical_payload?.trailer_value || 0) - (a.canonical_payload?.trailer_value || 0)
    );
    // Check for back-to-back same location
    const warnings: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].canonical_payload?.location === sorted[i - 1].canonical_payload?.location) {
        warnings.push(`Beats ${i} and ${i + 1} share location "${sorted[i].canonical_payload?.location}"`);
      }
    }
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      beatlist: sorted.map((u: any, i: number) => ({
        order: i + 1,
        unit_key: u.unit_key,
        trailer_value: u.canonical_payload?.trailer_value,
        logline: u.canonical_payload?.logline,
        visual_intention: u.canonical_payload?.visual_intention,
        location: u.canonical_payload?.location,
        tone: u.canonical_payload?.tone,
      })),
      rhythm_warnings: warnings,
    };
  }, [canonicalUnits, projectId]);

  const pitchExport = useMemo(() => {
    const sorted = [...canonicalUnits].sort((a: any, b: any) =>
      (b.canonical_payload?.pitch_value || 0) - (a.canonical_payload?.pitch_value || 0)
    );
    const heroes = sorted.slice(0, 12);
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      hero_images: heroes.map((u: any) => ({
        unit_key: u.unit_key,
        pitch_value: u.canonical_payload?.pitch_value,
        logline: u.canonical_payload?.logline,
        visual_intention: u.canonical_payload?.visual_intention,
        location: u.canonical_payload?.location,
        tone: u.canonical_payload?.tone,
      })),
      tone_boards: Object.entries(
        heroes.reduce((acc: Record<string, any[]>, u: any) => {
          const tones = u.canonical_payload?.tone || ['general'];
          for (const t of tones) {
            if (!acc[t]) acc[t] = [];
            acc[t].push(u.unit_key);
          }
          return acc;
        }, {})
      ).map(([tone, keys]) => ({ tone, unit_keys: keys })),
    };
  }, [canonicalUnits, projectId]);

  return (
    <PageTransition>
      <Header />
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center gap-3 mb-6">
          <Link to={`/projects/${projectId}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Visual Unit Engine</h1>
            <p className="text-xs text-muted-foreground">{project?.title}</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="review" className="gap-1 text-xs"><Eye className="h-3 w-3" />Review</TabsTrigger>
            <TabsTrigger value="storyboard" className="gap-1 text-xs"><Image className="h-3 w-3" />Storyboard Builder</TabsTrigger>
            <TabsTrigger value="trailer" className="gap-1 text-xs"><Film className="h-3 w-3" />Trailer Builder</TabsTrigger>
            <TabsTrigger value="pitch" className="gap-1 text-xs"><Presentation className="h-3 w-3" />Pitch Visual Plan</TabsTrigger>
          </TabsList>

          {/* ═══ REVIEW TAB ═══ */}
          <TabsContent value="review">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* LEFT: Sources + Runs */}
              <div className="lg:col-span-3 space-y-4">
                <VisualUnitSourcesPanel
                  sources={sourcesQuery.data?.source_versions}
                  warnings={sourcesQuery.data?.warnings}
                  isLoading={sourcesQuery.isLoading}
                  onRefresh={() => sourcesQuery.refetch()}
                />
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs">Runs</CardTitle>
                    <Button size="sm" className="text-[10px] gap-1 h-7"
                      onClick={() => mutations.createRun.mutate({})}
                      disabled={mutations.createRun.isPending}>
                      {mutations.createRun.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      Create Run
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <VisualUnitRunsList
                      runs={runs}
                      selectedRunId={selectedRunId}
                      onSelect={setSelectedRunId}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* MIDDLE: Candidates */}
              <div className="lg:col-span-5 space-y-4">
                {selectedCandidate ? (
                  <VisualUnitCandidateCard
                    candidate={selectedCandidate}
                    canonicalUnit={canonicalUnits.find((u: any) => u.unit_key === selectedCandidate.unit_key)}
                    onAccept={() => mutations.acceptCandidate.mutate(selectedCandidate.id)}
                    onReject={(reason) => mutations.rejectCandidate.mutate({ candidateId: selectedCandidate.id, reason })}
                    onModify={(patch, note) => mutations.modifyCandidate.mutate({ candidateId: selectedCandidate.id, patch, note })}
                    onCompare={() => handleCompare(selectedCandidate)}
                    onLock={() => mutations.lockUnit.mutate(selectedCandidate.unit_key)}
                    onUnlock={() => mutations.unlockUnit.mutate(selectedCandidate.unit_key)}
                    onBack={() => setSelectedCandidate(null)}
                    isPending={mutations.acceptCandidate.isPending || mutations.rejectCandidate.isPending}
                  />
                ) : (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs">
                        Candidates {selectedRunId ? `(Run)` : '(Select a run)'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <VisualUnitCandidatesList
                        candidates={candidates}
                        isLoading={candidatesQuery.isLoading}
                        onSelect={setSelectedCandidate}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* RIGHT: Diff + History */}
              <div className="lg:col-span-4 space-y-4">
                {diffResult && (
                  <VisualUnitDiffPanel
                    diffSummary={diffResult.diff_summary}
                    diffJson={diffResult.diff_json}
                    onClose={() => setDiffResult(null)}
                  />
                )}
                <VisualUnitHistoryTimeline
                  events={eventsQuery.data || []}
                  isLoading={eventsQuery.isLoading}
                />
              </div>
            </div>
          </TabsContent>

          {/* ═══ STORYBOARD BUILDER ═══ */}
          <TabsContent value="storyboard">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Storyboard Builder</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => copyJSON(storyboardExport)}>
                    <Copy className="h-3 w-3" />Copy JSON
                  </Button>
                  <Button size="sm" className="text-xs gap-1" onClick={() => downloadJSON(storyboardExport, `storyboard-${projectId}.json`)}>
                    <Download className="h-3 w-3" />Download
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {canonicalUnits.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No canonical visual units yet. Accept candidates in the Review tab.</p>
                ) : (
                  <ScrollArea className="h-[60vh]">
                    <div className="space-y-2">
                      {canonicalUnits.map((u: any) => (
                        <div key={u.id} className="p-3 rounded border border-border space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-muted-foreground">{u.unit_key}</span>
                            <Badge variant="outline" className="text-[8px]">SB: {u.canonical_payload?.storyboard_value}/10</Badge>
                          </div>
                          <p className="text-xs">{u.canonical_payload?.logline}</p>
                          <p className="text-[10px] text-muted-foreground">{u.canonical_payload?.visual_intention}</p>
                          {u.canonical_payload?.suggested_shots?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {u.canonical_payload.suggested_shots.map((s: any, i: number) => (
                                <Badge key={i} variant="secondary" className="text-[8px]">{s.type}: {s.subject}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ TRAILER BUILDER ═══ */}
          <TabsContent value="trailer">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Builder</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => copyJSON(trailerExport)}>
                    <Copy className="h-3 w-3" />Copy JSON
                  </Button>
                  <Button size="sm" className="text-xs gap-1" onClick={() => downloadJSON(trailerExport, `trailer-beatlist-${projectId}.json`)}>
                    <Download className="h-3 w-3" />Download
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {canonicalUnits.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No canonical visual units yet.</p>
                ) : (
                  <div className="space-y-4">
                    {trailerExport.rhythm_warnings.length > 0 && (
                      <div className="p-2 rounded border border-amber-500/30 bg-amber-500/5">
                        <p className="text-[10px] font-medium text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Rhythm Warnings</p>
                        {trailerExport.rhythm_warnings.map((w, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">{w}</p>
                        ))}
                      </div>
                    )}
                    <ScrollArea className="h-[55vh]">
                      <div className="space-y-2">
                        {trailerExport.beatlist.map((b: any) => (
                          <div key={b.unit_key} className="flex items-center gap-3 p-3 rounded border border-border">
                            <span className="text-lg font-bold text-primary w-8 text-center">{b.order}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{b.logline}</p>
                              <p className="text-[10px] text-muted-foreground">{b.location} • {b.tone?.join(', ')}</p>
                            </div>
                            <Badge className="text-[10px]">{b.trailer_value}/10</Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ PITCH VISUAL PLAN ═══ */}
          <TabsContent value="pitch">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Pitch Visual Plan</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => copyJSON(pitchExport)}>
                    <Copy className="h-3 w-3" />Copy JSON
                  </Button>
                  <Button size="sm" className="text-xs gap-1" onClick={() => downloadJSON(pitchExport, `pitch-plan-${projectId}.json`)}>
                    <Download className="h-3 w-3" />Download
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {canonicalUnits.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No canonical visual units yet.</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Hero Images ({pitchExport.hero_images.length})</p>
                      <ScrollArea className="h-[40vh]">
                        <div className="grid grid-cols-2 gap-2">
                          {pitchExport.hero_images.map((h: any) => (
                            <div key={h.unit_key} className="p-3 rounded border border-border space-y-1">
                              <div className="flex justify-between">
                                <span className="font-mono text-[10px] text-muted-foreground">{h.unit_key}</span>
                                <Badge className="text-[8px]">Pitch: {h.pitch_value}/10</Badge>
                              </div>
                              <p className="text-xs">{h.logline}</p>
                              <p className="text-[10px] text-muted-foreground">{h.visual_intention}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Tone Boards</p>
                      <div className="flex flex-wrap gap-2">
                        {pitchExport.tone_boards.map((tb: any) => (
                          <Badge key={tb.tone} variant="outline" className="text-[10px]">
                            {tb.tone} ({tb.unit_keys.length})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
