/**
 * AiTrailerBuilder — Wizard page for building an AI taster trailer.
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
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft, ArrowRight, Sparkles, Film, FileText, Image,
  Loader2, Star, Zap, Heart, CheckCircle2, Download, Package,
} from 'lucide-react';
import { useAiProduction } from '@/hooks/useAiProduction';

type Step = 'source' | 'moments' | 'shotlist' | 'generate' | 'assemble';

export default function AiTrailerBuilder() {
  const { id: projectId } = useParams<{ id: string }>();
  const [step, setStep] = useState<Step>('source');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedMomentIds, setSelectedMomentIds] = useState<Set<string>>(new Set());
  const [activeShotlistId, setActiveShotlistId] = useState<string | null>(null);

  const {
    moments, shotlists, isLoadingMoments, isLoadingShotlists,
    extractMoments, buildShotlist, assembleTrailer,
  } = useAiProduction(projectId);

  // Fetch project documents
  const { data: documents = [] } = useQuery({
    queryKey: ['ai-trailer-docs', projectId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('project_documents')
        .select('id, title, doc_type')
        .eq('project_id', projectId)
        .in('doc_type', ['script', 'screenplay', 'treatment', 'episode_script'])
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!projectId,
  });

  // Fetch versions for selected doc
  const { data: versions = [] } = useQuery({
    queryKey: ['ai-trailer-versions', selectedDocId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('project_document_versions')
        .select('id, version_number, created_at')
        .eq('document_id', selectedDocId)
        .order('version_number', { ascending: false });
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
    if (step === 'moments') return moments.length > 0;
    if (step === 'shotlist') return shotlists.length > 0;
    return true;
  })();

  const activeShotlist = shotlists.find(s => s.id === activeShotlistId) || shotlists[0];

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
                AI Trailer Builder
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

          {/* Step Content */}
          {step === 'source' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Choose Source Script</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {documents.length === 0 && (
                  <p className="text-xs text-muted-foreground">No script documents found. Create a script first.</p>
                )}
                {documents.map((doc: any) => (
                  <button
                    key={doc.id}
                    onClick={() => { setSelectedDocId(doc.id); setSelectedVersionId(null); }}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      selectedDocId === doc.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="text-[10px] text-muted-foreground">{doc.doc_type}</p>
                  </button>
                ))}

                {selectedDocId && versions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-2">Select version:</p>
                    <div className="flex flex-wrap gap-2">
                      {versions.map((v: any) => (
                        <Badge
                          key={v.id}
                          variant={selectedVersionId === v.id ? 'default' : 'outline'}
                          className="cursor-pointer text-xs"
                          onClick={() => setSelectedVersionId(v.id)}
                        >
                          v{v.version_number}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {step === 'moments' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Moments</CardTitle>
                <Button
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => {
                    if (selectedDocId && selectedVersionId) {
                      extractMoments.mutate({ documentId: selectedDocId, versionId: selectedVersionId });
                    }
                  }}
                  disabled={extractMoments.isPending || !selectedVersionId}
                >
                  {extractMoments.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Extract Moments
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingMoments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : moments.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No moments extracted yet. Click "Extract Moments" to analyze the script.</p>
                ) : (
                  <ScrollArea className="max-h-[60vh]">
                    <div className="space-y-2">
                      {moments.map(m => (
                        <div
                          key={m.id}
                          className={`p-3 rounded border transition-colors ${
                            selectedMomentIds.has(m.id) ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={selectedMomentIds.has(m.id)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedMomentIds);
                                if (checked) next.add(m.id); else next.delete(m.id);
                                setSelectedMomentIds(next);
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{m.moment_summary}</p>
                              {m.scene_number && (
                                <span className="text-[10px] text-muted-foreground">Scene {m.scene_number}</span>
                              )}
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-[10px] flex items-center gap-0.5">
                                  <Zap className="h-2.5 w-2.5 text-amber-400" />{m.hook_strength}
                                </span>
                                <span className="text-[10px] flex items-center gap-0.5">
                                  <Star className="h-2.5 w-2.5 text-blue-400" />{m.spectacle_score}
                                </span>
                                <span className="text-[10px] flex items-center gap-0.5">
                                  <Heart className="h-2.5 w-2.5 text-red-400" />{m.emotional_score}
                                </span>
                                {m.ai_friendly && (
                                  <Badge variant="outline" className="text-[8px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                    AI-Friendly
                                  </Badge>
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

          {step === 'shotlist' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Trailer Shotlist</CardTitle>
                <Button
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => buildShotlist.mutate({ count: 12 })}
                  disabled={buildShotlist.isPending || moments.length === 0}
                >
                  {buildShotlist.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Film className="h-3 w-3" />}
                  Build Shotlist
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingShotlists ? (
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
                          <Badge
                            variant="outline"
                            className={`text-[8px] ${
                              item.ai_suggested_tier === 'A' ? 'bg-emerald-500/10 text-emerald-400' :
                              item.ai_suggested_tier === 'B' ? 'bg-blue-500/10 text-blue-400' :
                              'bg-amber-500/10 text-amber-400'
                            }`}
                          >
                            {item.ai_suggested_tier}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{item.intended_duration}s</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {step === 'generate' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Generate Media</CardTitle>
              </CardHeader>
              <CardContent className="text-center py-8">
                <Image className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-xs text-muted-foreground mb-4">
                  Generate AI storyboard frames for each shot in the trailer shotlist.
                  Use the Shot List page to generate frames individually.
                </p>
                <Link to={`/projects/${projectId}/shot-list`}>
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <Image className="h-3 w-3" />Go to Shot List
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {step === 'assemble' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Assemble Taster Trailer</CardTitle>
                <Button
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => {
                    if (activeShotlist) {
                      assembleTrailer.mutate({ trailerShotlistId: activeShotlist.id });
                    }
                  }}
                  disabled={assembleTrailer.isPending || !activeShotlist}
                >
                  {assembleTrailer.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                  Assemble
                </Button>
              </CardHeader>
              <CardContent className="text-center py-8">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">
                  {assembleTrailer.isSuccess
                    ? 'Trailer timeline assembled! Check downloads below.'
                    : 'Click "Assemble" to create a trailer timeline from your shotlist and generated frames.'}
                </p>
                {assembleTrailer.data?.timeline_url && (
                  <a
                    href={assembleTrailer.data.timeline_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-4"
                  >
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      <Download className="h-3 w-3" />Download Timeline
                    </Button>
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={() => setStep(steps[Math.max(0, stepIndex - 1)].key)}
              disabled={stepIndex === 0}
            >
              <ArrowLeft className="h-3 w-3" />Previous
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1"
              onClick={() => setStep(steps[Math.min(steps.length - 1, stepIndex + 1)].key)}
              disabled={stepIndex >= steps.length - 1 || !canNext}
            >
              Next<ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
