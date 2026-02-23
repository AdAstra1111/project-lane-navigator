/**
 * AiTrailerBuilder — Wizard page for building an AI taster trailer.
 * Uses the ai-trailer-factory edge function for all operations.
 */
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft, ArrowRight, Sparkles, Film, FileText, Image,
  Loader2, Star, Zap, Heart, Download, Package, Play,
} from 'lucide-react';
import { useAiTrailerFactory } from '@/hooks/useAiTrailerFactory';

type Step = 'source' | 'moments' | 'shotlist' | 'generate' | 'assemble';

export default function AiTrailerBuilder() {
  const { id: projectId } = useParams<{ id: string }>();
  const [step, setStep] = useState<Step>('source');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedMomentIds, setSelectedMomentIds] = useState<Set<string>>(new Set());
  const [activeShotlistId, setActiveShotlistId] = useState<string | null>(null);

  const ai = useAiTrailerFactory(projectId);

  const { data: documents = [] } = useQuery({
    queryKey: ['ai-trailer-docs', projectId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('project_documents').select('id, title, doc_type')
        .eq('project_id', projectId)
        .in('doc_type', ['script', 'screenplay', 'treatment', 'episode_script'])
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!projectId,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['ai-trailer-versions', selectedDocId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('project_document_versions').select('id, version_number, created_at')
        .eq('document_id', selectedDocId).order('version_number', { ascending: false });
      return data || [];
    },
    enabled: !!selectedDocId,
  });

  const { data: project } = useQuery({
    queryKey: ['ai-trailer-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'source', label: 'Source', icon: <FileText className="h-4 w-4" /> },
    { key: 'moments', label: 'Moments', icon: <Sparkles className="h-4 w-4" /> },
    { key: 'shotlist', label: 'Shotlist', icon: <Film className="h-4 w-4" /> },
    { key: 'generate', label: 'Generate', icon: <Image className="h-4 w-4" /> },
    { key: 'assemble', label: 'Assemble', icon: <Package className="h-4 w-4" /> },
  ];

  const stepIndex = steps.findIndex(s => s.key === step);
  const canNext = (() => {
    if (step === 'source') return !!selectedVersionId;
    if (step === 'moments') return ai.moments.length > 0;
    if (step === 'shotlist') return ai.shotlists.length > 0;
    return true;
  })();

  const activeShotlist = ai.shotlists.find(s => s.id === activeShotlistId) || ai.shotlists[0];
  const generateProgress = ai.generateTrailerAssets.data;

  return (
    <PageTransition>
      <Header />
      <div className="min-h-screen bg-background pt-16">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {/* Top bar */}
          <div className="flex items-center gap-3 mb-6">
            <Link to={`/projects/${projectId}/development`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />Back
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Trailer Factory
              </h1>
              {project?.title && <p className="text-xs text-muted-foreground">{project.title}</p>}
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center gap-1 mb-6">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setStep(s.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
                  step === s.key
                    ? 'bg-primary text-primary-foreground'
                    : i < stepIndex
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>

          {/* Step: Source */}
          {step === 'source' && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Choose Source Script</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {documents.length === 0 && (
                  <p className="text-xs text-muted-foreground">No script documents found. Create a script first.</p>
                )}
                {documents.map((doc: any) => (
                  <button key={doc.id}
                    onClick={() => { setSelectedDocId(doc.id); setSelectedVersionId(null); }}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      selectedDocId === doc.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                    }`}>
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="text-[10px] text-muted-foreground">{doc.doc_type}</p>
                  </button>
                ))}
                {selectedDocId && versions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-2">Select version:</p>
                    <div className="flex flex-wrap gap-2">
                      {versions.map((v: any) => (
                        <Badge key={v.id} variant={selectedVersionId === v.id ? 'default' : 'outline'}
                          className="cursor-pointer text-xs" onClick={() => setSelectedVersionId(v.id)}>
                          v{v.version_number}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Moments */}
          {step === 'moments' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Moments</CardTitle>
                <Button size="sm" className="text-xs gap-1"
                  onClick={() => {
                    if (selectedDocId && selectedVersionId)
                      ai.extractMoments.mutate({ documentId: selectedDocId, versionId: selectedVersionId });
                  }}
                  disabled={ai.extractMoments.isPending || !selectedVersionId}>
                  {ai.extractMoments.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Extract Moments
                </Button>
              </CardHeader>
              <CardContent>
                {ai.isLoadingMoments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : ai.moments.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No moments extracted yet. Click "Extract Moments" to analyze the script.</p>
                ) : (
                  <ScrollArea className="max-h-[60vh]">
                    <div className="space-y-2">
                      {ai.moments.map(m => (
                        <div key={m.id} className={`p-3 rounded border transition-colors ${
                          selectedMomentIds.has(m.id) ? 'border-primary bg-primary/5' : 'border-border'
                        }`}>
                          <div className="flex items-start gap-2">
                            <Checkbox checked={selectedMomentIds.has(m.id)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedMomentIds);
                                if (checked) next.add(m.id); else next.delete(m.id);
                                setSelectedMomentIds(next);
                              }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{m.moment_summary}</p>
                              {m.scene_number && <span className="text-[10px] text-muted-foreground">Scene {m.scene_number}</span>}
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-[10px] flex items-center gap-0.5"><Zap className="h-2.5 w-2.5 text-amber-400" />{m.hook_strength}</span>
                                <span className="text-[10px] flex items-center gap-0.5"><Star className="h-2.5 w-2.5 text-blue-400" />{m.spectacle_score}</span>
                                <span className="text-[10px] flex items-center gap-0.5"><Heart className="h-2.5 w-2.5 text-red-400" />{m.emotional_score}</span>
                                {m.ai_friendly && (
                                  <Badge variant="outline" className="text-[8px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">AI-Friendly</Badge>
                                )}
                              </div>
                              {m.suggested_visual_approach && (
                                <p className="text-[10px] text-muted-foreground mt-1 italic">{m.suggested_visual_approach}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Shotlist */}
          {step === 'shotlist' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Shotlist</CardTitle>
                <Button size="sm" className="text-xs gap-1"
                  onClick={() => ai.buildShotlist.mutate({ count: 16 })}
                  disabled={ai.buildShotlist.isPending || ai.moments.length === 0}>
                  {ai.buildShotlist.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Film className="h-3 w-3" />}
                  Build Shotlist
                </Button>
              </CardHeader>
              <CardContent>
                {ai.isLoadingShotlists ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : !activeShotlist ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No shotlist yet. Extract moments first, then build a shotlist.</p>
                ) : (
                  <ScrollArea className="max-h-[60vh]">
                    <div className="space-y-2">
                      {(activeShotlist.items || []).map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-3 p-2 rounded border border-border">
                          <span className="text-xs font-mono text-muted-foreground w-6">{item.index}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">{item.shot_title}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{item.shot_description}</p>
                          </div>
                          <Badge variant="outline" className={`text-[8px] ${
                            item.ai_suggested_tier === 'A' ? 'bg-emerald-500/10 text-emerald-400' :
                            item.ai_suggested_tier === 'B' ? 'bg-blue-500/10 text-blue-400' :
                            'bg-amber-500/10 text-amber-400'
                          }`}>{item.ai_suggested_tier}</Badge>
                          <span className="text-[10px] text-muted-foreground">{item.intended_duration}s</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Generate */}
          {step === 'generate' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Generate Trailer Assets</CardTitle>
                <Button size="sm" className="text-xs gap-1"
                  onClick={() => {
                    if (activeShotlist) ai.generateTrailerAssets.mutate(activeShotlist.id);
                  }}
                  disabled={ai.generateTrailerAssets.isPending || !activeShotlist}>
                  {ai.generateTrailerAssets.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Generate All Assets
                </Button>
              </CardHeader>
              <CardContent>
                {ai.generateTrailerAssets.isPending ? (
                  <div className="space-y-3 py-4">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <p className="text-xs text-muted-foreground">Generating frames and animating clips… This may take a few minutes.</p>
                    </div>
                    <Progress value={50} className="h-2" />
                  </div>
                ) : generateProgress ? (
                  <div className="space-y-3 py-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold text-primary">{generateProgress.framesGenerated}</p>
                        <p className="text-[10px] text-muted-foreground">Frames</p>
                      </div>
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold text-primary">{generateProgress.clipsGenerated}</p>
                        <p className="text-[10px] text-muted-foreground">Clips</p>
                      </div>
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold text-primary">{generateProgress.total}</p>
                        <p className="text-[10px] text-muted-foreground">Total Beats</p>
                      </div>
                    </div>
                    {generateProgress.results && (
                      <ScrollArea className="max-h-[40vh]">
                        <div className="space-y-1">
                          {generateProgress.results.map((r: any) => (
                            <div key={r.index} className="flex items-center gap-2 text-[10px]">
                              <span className="font-mono text-muted-foreground w-5">#{r.index}</span>
                              <Badge variant="outline" className={`text-[8px] ${
                                r.status === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}>{r.status}</Badge>
                              {r.frame_url && (
                                <img src={r.frame_url} alt={`Beat ${r.index}`} className="h-8 w-14 object-cover rounded" />
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Image className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground mb-2">
                      Generate AI storyboard frames and animated clips for each beat in the trailer shotlist.
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Up to 4 frames per beat • Up to 8 animated clips for top beats
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step: Assemble */}
          {step === 'assemble' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Assemble Taster Trailer</CardTitle>
                <Button size="sm" className="text-xs gap-1"
                  onClick={() => { if (activeShotlist) ai.assembleTrailer.mutate(activeShotlist.id); }}
                  disabled={ai.assembleTrailer.isPending || !activeShotlist}>
                  {ai.assembleTrailer.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                  Assemble
                </Button>
              </CardHeader>
              <CardContent>
                {ai.assembleTrailer.isSuccess && ai.assembleTrailer.data ? (
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold">{ai.assembleTrailer.data.timeline?.frame_count || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Frames</p>
                      </div>
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold">{ai.assembleTrailer.data.timeline?.clip_count || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Clips</p>
                      </div>
                      <div className="p-3 rounded border border-border">
                        <p className="text-2xl font-bold">{Math.round(ai.assembleTrailer.data.timeline?.total_duration || 0)}s</p>
                        <p className="text-[10px] text-muted-foreground">Duration</p>
                      </div>
                    </div>

                    {ai.assembleTrailer.data.missing_frames?.length > 0 && (
                      <p className="text-[10px] text-amber-400">
                        {ai.assembleTrailer.data.missing_frames.length} beats missing frames. Go back to Generate to fill gaps.
                      </p>
                    )}

                    {ai.assembleTrailer.data.timeline_url && (
                      <a href={ai.assembleTrailer.data.timeline_url} target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="text-xs gap-1 w-full">
                          <Download className="h-3 w-3" />Download Timeline JSON
                        </Button>
                      </a>
                    )}

                    {/* Timeline preview */}
                    {ai.assembleTrailer.data.timeline?.timeline && (
                      <ScrollArea className="max-h-[40vh]">
                        <div className="space-y-1">
                          {ai.assembleTrailer.data.timeline.timeline.map((t: any) => (
                            <div key={t.index} className="flex items-center gap-2 p-1.5 rounded border border-border">
                              <span className="font-mono text-[10px] text-muted-foreground w-5">#{t.index}</span>
                              {t.frame_url && (
                                <img src={t.frame_url} alt={t.shot_title} className="h-8 w-14 object-cover rounded" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-medium truncate">{t.shot_title}</p>
                                <p className="text-[9px] text-muted-foreground">{t.intended_duration}s</p>
                              </div>
                              {t.has_clip && <Play className="h-3 w-3 text-primary" />}
                              {t.text_card && <Badge variant="outline" className="text-[7px]">{t.text_card}</Badge>}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}

                    <p className="text-xs text-muted-foreground text-center">{ai.assembleTrailer.data.message}</p>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-xs text-muted-foreground">
                      Click "Assemble" to create a trailer timeline from your shotlist and generated assets.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <Button variant="outline" size="sm" className="text-xs gap-1"
              onClick={() => setStep(steps[Math.max(0, stepIndex - 1)].key)}
              disabled={stepIndex === 0}>
              <ArrowLeft className="h-3 w-3" />Previous
            </Button>
            <Button size="sm" className="text-xs gap-1"
              onClick={() => setStep(steps[Math.min(steps.length - 1, stepIndex + 1)].key)}
              disabled={stepIndex >= steps.length - 1 || !canNext}>
              Next<ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
