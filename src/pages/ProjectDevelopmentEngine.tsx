import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { useDevEngineV2 } from '@/hooks/useDevEngineV2';
import { useScriptPipeline } from '@/hooks/useScriptPipeline';
import { useRewritePipeline } from '@/hooks/useRewritePipeline';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  ArrowRight, Play, Check, Shield, TrendingUp, TrendingDown, Minus,
  Zap, FileText, Loader2, Target, Sparkles, ArrowUpRight,
  Plus, ClipboardPaste, Upload, ChevronDown, BarChart3,
  AlertTriangle, GitBranch, Clock, RefreshCw, Film, Pause, Square, RotateCcw, Trash2
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OperationProgress, DEV_ANALYZE_STAGES, DEV_NOTES_STAGES, DEV_REWRITE_STAGES, DEV_CONVERT_STAGES } from '@/components/OperationProgress';
import { useSetAsLatestDraft } from '@/hooks/useSetAsLatestDraft';
import { FeatureLengthGuardrails } from '@/components/FeatureLengthGuardrails';
import { type DevelopmentBehavior, BEHAVIOR_LABELS, BEHAVIOR_COLORS, DELIVERABLE_LABELS, defaultDeliverableForDocType, type DeliverableType } from '@/lib/dev-os-config';
import { isSeriesFormat as checkSeriesFormat } from '@/lib/format-helpers';
import { DeliverablePipeline, type PipelineStageStatus } from '@/components/DeliverablePipeline';

// ── Convergence Gauge ──
function ConvergenceGauge({ ci, gp, gap, status, allowedGap }: { ci: number; gp: number; gap: number; status: string; allowedGap?: number }) {
  const statusColor = status === 'Healthy Divergence' ? 'text-emerald-400' :
    status === 'Strategic Tension' ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Script Strength</p>
        <p className="text-2xl font-display font-bold text-foreground">{ci}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Finance Readiness</p>
        <p className="text-2xl font-display font-bold text-foreground">{gp}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Gap</p>
        <p className={`text-2xl font-display font-bold ${statusColor}`}>{gap}</p>
        <p className={`text-[10px] ${statusColor}`}>{status}</p>
      </div>
    </div>
  );
}

// ── Sparkline for convergence ──
function ConvergenceSparkline({ history }: { history: any[] }) {
  if (history.length < 2) return null;
  const w = 200, h = 48, pad = 4;
  const ciPoints = history.map(h => Number(h.creative_score));
  const gpPoints = history.map(h => Number(h.greenlight_score));
  const all = [...ciPoints, ...gpPoints];
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 100);
  const range = max - min || 1;

  const toPath = (pts: number[]) => pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={toPath(ciPoints)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
      <path d={toPath(gpPoints)} fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2" />
    </svg>
  );
}

// ── Doc type badge ──
const DOC_TYPE_LABELS: Record<string, string> = {
  idea: 'Idea', logline: 'Logline', one_pager: 'One-Pager', treatment: 'Treatment',
  script: 'Script', blueprint: 'Blueprint', architecture: 'Architecture',
  notes: 'Notes', outline: 'Outline', deck_text: 'Deck', other: 'Other',
  concept_brief: 'Concept Brief', market_sheet: 'Market Sheet',
  character_bible: 'Character Bible', beat_sheet: 'Beat Sheet',
  production_draft: 'Production Draft', deck: 'Deck', documentary_outline: 'Doc Outline',
};

// ── Set as Latest Draft Button ──
function SetAsLatestDraftButton({ projectId, title, text }: { projectId?: string; title: string; text: string }) {
  const setAsDraft = useSetAsLatestDraft(projectId);
  return (
    <Card>
      <CardContent className="px-3 py-3">
        <ConfirmDialog
          title="Set as Latest Draft?"
          description={`This will register "${title}" as the project's current script draft, archive any previous draft, and trigger a full re-analysis.`}
          confirmLabel="Set as Latest Draft"
          onConfirm={() => setAsDraft.mutate({ title, text })}
        >
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1.5 border-primary/30 hover:bg-primary/10"
            disabled={setAsDraft.isPending}
          >
            {setAsDraft.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Set as Latest Draft
          </Button>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──
export default function ProjectDevelopmentEngine() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  // Fetch project metadata
  const { data: project } = useQuery({
    queryKey: ['dev-engine-project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('format, development_behavior, episode_target_duration_seconds')
        .eq('id', projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });
  const normalizedFormat = (project?.format || 'film').toLowerCase().replace(/_/g, '-');
  const isFeature = !project?.format || normalizedFormat === 'feature' || normalizedFormat === 'film';
  const isVerticalDrama = normalizedFormat === 'vertical-drama';
  const isSeriesFormat = checkSeriesFormat(normalizedFormat);
  const projectBehavior = (project?.development_behavior as DevelopmentBehavior) || 'market';
  const projectFormat = normalizedFormat;
  const [episodeDuration, setEpisodeDuration] = useState(project?.episode_target_duration_seconds || 120);

  const {
    documents, docsLoading, versions, versionsLoading,
    selectedDoc, selectedVersion, selectedDocId, selectedVersionId,
    selectDocument, setSelectedVersionId,
    runs, allDocRuns, convergenceHistory,
    latestAnalysis, latestNotes, isConverged, convergenceStatus, isLoading,
    analyze, generateNotes, rewrite, convert, createPaste, deleteDocument,
  } = useDevEngineV2(projectId);

  // Script pipeline
  const pipeline = useScriptPipeline(projectId);

  // Rewrite pipeline for long documents
  const rewritePipeline = useRewritePipeline(projectId);

  // Controls
  const [selectedDeliverableType, setSelectedDeliverableType] = useState<DeliverableType>('script');
  // Paste dialog
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteType, setPasteType] = useState('treatment');
  const [pasteText, setPasteText] = useState('');
  const [targetPages, setTargetPages] = useState(100);

  // Notes selection
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());

  // Import landing: auto-select doc/version from query params
  const [importHandled, setImportHandled] = useState(false);
  useEffect(() => {
    if (importHandled || docsLoading) return;
    const docParam = searchParams.get('doc');
    const versionParam = searchParams.get('version');
    if (docParam && documents.some(d => d.id === docParam)) {
      selectDocument(docParam);
      if (versionParam) {
        setSelectedVersionId(versionParam);
      }
      setImportHandled(true);
    }
  }, [documents, docsLoading, searchParams, importHandled, selectDocument, setSelectedVersionId]);

  // Auto-set deliverable type from selected doc
  useEffect(() => {
    if (selectedDoc?.doc_type) {
      const mapped = defaultDeliverableForDocType(selectedDoc.doc_type);
      setSelectedDeliverableType(mapped);
    }
  }, [selectedDoc?.doc_type]);

  const allPrioritizedMoves = useMemo(() => {
    // Support both new (actionable_notes) and old (prioritized_moves) format
    const notes = latestNotes?.actionable_notes || latestNotes?.prioritized_moves;
    if (!notes) return [];
    return notes as any[];
  }, [latestNotes]);

  // Sync episode duration from project data
  useEffect(() => {
    if (project?.episode_target_duration_seconds) {
      setEpisodeDuration(project.episode_target_duration_seconds);
    }
  }, [project?.episode_target_duration_seconds]);

  // Auto-select all notes when they load
  useMemo(() => {
    if (allPrioritizedMoves.length > 0) {
      setSelectedNotes(new Set(allPrioritizedMoves.map((_, i) => i)));
    }
  }, [allPrioritizedMoves]);

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    createPaste.mutate({ title: pasteTitle || 'Pasted Document', docType: pasteType, text: pasteText.trim() });
    setPasteOpen(false);
    setPasteTitle('');
    setPasteText('');
  };

  // Unified engine call — explicit params, no guessing
  // Chains: Analyze → auto-generate Notes
  const handleRunEngine = () => {
    const prevVersion = versions.length > 1 ? versions[versions.length - 2] : null;
    analyze.mutate({
      deliverableType: selectedDeliverableType,
      developmentBehavior: projectBehavior,
      format: projectFormat,
      episodeTargetDurationSeconds: (isVerticalDrama || isSeriesFormat) ? episodeDuration : undefined,
      previousVersionId: prevVersion?.id,
    }, {
      onSuccess: (analysisResult: any) => {
        // Auto-generate notes after analysis completes
        generateNotes.mutate(analysisResult);
      },
    });
  };

  const handleRewrite = () => {
    const approved = allPrioritizedMoves.filter((_, i) => selectedNotes.has(i));
    const protectItems = latestNotes?.protect || latestAnalysis?.protect || [];
    const textLength = (selectedVersion?.plaintext || selectedDoc?.plaintext || '').length;

    if (textLength > 30000 && selectedDocId && selectedVersionId) {
      rewritePipeline.startRewrite(selectedDocId, selectedVersionId, approved, protectItems);
    } else {
      rewrite.mutate({
        approvedNotes: approved,
        protectItems,
        deliverableType: selectedDeliverableType,
        developmentBehavior: projectBehavior,
        format: projectFormat,
      });
    }
  };

  const versionText = selectedVersion?.plaintext ||
    selectedDoc?.plaintext || selectedDoc?.extracted_text || '';

  // Compute pipeline stage statuses from document runs
  const pipelineStatuses = useMemo(() => {
    const statuses: Record<string, PipelineStageStatus> = {};
    for (const doc of documents) {
      const dt = doc.doc_type;
      // Find if any ANALYZE run for this doc has convergence
      const docRuns = allDocRuns.filter(r => r.document_id === doc.id);
      const analyzeRuns = docRuns.filter(r => r.run_type === 'ANALYZE');
      const latestRun = analyzeRuns[analyzeRuns.length - 1];
      const output = latestRun?.output_json;

      if (output) {
        const convStatus = output?.convergence?.status || output?.convergence_status;
        if (convStatus === 'converged' || convStatus === 'Converged' || convStatus === 'Healthy Divergence') {
          statuses[dt] = 'converged';
        } else {
          statuses[dt] = 'in_progress';
        }
      } else if (doc.plaintext || doc.extracted_text) {
        // Has content but no analysis
        if (!statuses[dt]) statuses[dt] = 'in_progress';
      }
    }
    return statuses;
  }, [documents, allDocRuns]);

  // Convergence info from latest analysis (support both v2 and v3 shapes)
  const analysisConvergence = latestAnalysis?.convergence;
  const isAnalysisConverged = analysisConvergence?.status === 'converged' || convergenceStatus === 'Converged';
  const nextBestDocument = analysisConvergence?.next_best_document;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-[1600px] mx-auto px-4 py-4">
          {/* Top bar */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">
                  ← Project
                </Link>
                <h1 className="text-lg font-display font-bold text-foreground">Development Engine</h1>
              </div>
              {/* Visible badges — always shown */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={`text-[10px] ${BEHAVIOR_COLORS[projectBehavior]}`}>
                  Behavior: {BEHAVIOR_LABELS[projectBehavior]}
                </Badge>
                <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground">
                  Format: {normalizedFormat}
                </Badge>
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                  Deliverable: {DELIVERABLE_LABELS[selectedDeliverableType]}
                </Badge>
                {(isVerticalDrama || isSeriesFormat) && (
                  <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground">
                    {episodeDuration}s / ep
                  </Badge>
                )}
                <Badge variant="outline" className={`text-[10px] ${
                  convergenceStatus === 'Converged' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                  convergenceStatus === 'In Progress' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                  'bg-muted/20 text-muted-foreground border-border/30'
                }`}>
                  {convergenceStatus === 'Converged' && <Check className="h-3 w-3 mr-1" />}
                  {convergenceStatus}
                </Badge>
              </div>
            </div>

            {/* Settings row — compact */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedDeliverableType} onValueChange={(v) => setSelectedDeliverableType(v as DeliverableType)}>
                <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DELIVERABLE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={projectBehavior} onValueChange={async (v) => {
                if (!projectId) return;
                await (supabase as any).from('projects').update({ development_behavior: v }).eq('id', projectId);
                qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
              }}>
                <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BEHAVIOR_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(isVerticalDrama || isSeriesFormat) && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    className="h-7 text-xs w-[65px]"
                    value={episodeDuration}
                    onChange={(e) => setEpisodeDuration(Number(e.target.value))}
                    onBlur={async () => {
                      if (!projectId || !episodeDuration) return;
                      await (supabase as any).from('projects').update({ episode_target_duration_seconds: episodeDuration }).eq('id', projectId);
                      qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
                    }}
                    min={30}
                    max={7200}
                  />
                  <span className="text-[10px] text-muted-foreground">s/ep</span>
                </div>
              )}
            </div>

            {/* Deliverable Pipeline */}
            <DeliverablePipeline
              stageStatuses={pipelineStatuses}
              activeDeliverable={selectedDeliverableType}
              onStageClick={(dt) => setSelectedDeliverableType(dt)}
            />
          </div>

          {/* 3-column layout */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4" style={{ minHeight: 'calc(100vh - 180px)' }}>

            {/* ── LEFT: Document Selector ── */}
            <div className="md:col-span-3 space-y-3">
              <Card>
                <CardHeader className="py-3 px-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Documents</CardTitle>
                    <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                          <Plus className="h-3 w-3" /> New
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Paste New Document</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Input placeholder="Title" value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} />
                          <Select value={pasteType} onValueChange={setPasteType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(DELIVERABLE_LABELS).map(([key, label]) => (
                                <SelectItem key={key} value={key}>{label}</SelectItem>
                              ))}
                              <SelectItem value="treatment">Treatment</SelectItem>
                              <SelectItem value="logline">Logline</SelectItem>
                              <SelectItem value="one_pager">One-Pager</SelectItem>
                              <SelectItem value="outline">Outline</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <Textarea placeholder="Paste material here..." value={pasteText}
                            onChange={e => setPasteText(e.target.value)} className="min-h-[200px] font-mono text-sm" />
                          <Button onClick={handlePaste} disabled={!pasteText.trim() || createPaste.isPending} className="w-full">
                            {createPaste.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ClipboardPaste className="h-4 w-4 mr-2" />}
                            Create Document
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                 <CardContent className="px-2 pb-2">
                  <div className="h-[calc(100vh-360px)] overflow-y-auto">
                    <div className="space-y-1">
                      {documents.map(doc => (
                        <div
                          key={doc.id}
                          className={`w-full text-left p-2.5 rounded-md transition-colors text-sm cursor-pointer ${
                            selectedDocId === doc.id
                              ? 'bg-primary/10 border border-primary/30'
                              : 'hover:bg-muted/50 border border-transparent'
                          }`}
                          onClick={() => selectDocument(doc.id)}
                        >
                          <p className="font-medium text-foreground truncate text-xs">{doc.title || doc.file_name}</p>
                          <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                              </Badge>
                              <span className="text-[9px] text-muted-foreground">
                                {doc.source === 'generated' ? '✨' : doc.source === 'paste' ? '📋' : '📄'}
                              </span>
                            </div>
                            <div onClick={e => e.stopPropagation()}>
                              <ConfirmDialog
                                title="Delete Document"
                                description={`Delete "${doc.title || doc.file_name}" and all its versions? This cannot be undone.`}
                                confirmLabel="Delete"
                                variant="destructive"
                                onConfirm={() => deleteDocument.mutate(doc.id)}
                              >
                                <button className="p-1 rounded bg-destructive/20 text-destructive hover:bg-destructive/40 transition-colors">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </ConfirmDialog>
                            </div>
                          </div>
                        </div>
                      ))}
                      {documents.length === 0 && !docsLoading && (
                        <p className="text-xs text-muted-foreground p-3 text-center">No documents yet. Paste or upload to start.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Version selector */}
              {selectedDocId && versions.length > 0 && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <GitBranch className="h-3 w-3" /> Versions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    <div className="space-y-1">
                      {versions.map(v => (
                        <button
                          key={v.id}
                          onClick={() => setSelectedVersionId(v.id)}
                          className={`w-full text-left p-2 rounded-md text-xs transition-colors ${
                            selectedVersionId === v.id
                              ? 'bg-primary/10 border border-primary/30'
                              : 'hover:bg-muted/50 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">v{v.version_number}</span>
                            <Badge variant="outline" className="text-[8px] px-1 py-0 border-border">
                              {new Date(v.created_at).toLocaleDateString()}
                            </Badge>
                          </div>
                          {v.label && <span className="text-muted-foreground text-[10px] block mt-0.5">{v.label}</span>}
                          {v.change_summary && <span className="text-muted-foreground/60 text-[9px] block mt-0.5 truncate">{v.change_summary}</span>}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Generate Feature Script Pipeline */}
              {isFeature && selectedDocId && selectedVersionId && (
                <Card className="border-primary/20">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Film className="h-3 w-3" /> Feature Script Pipeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    {pipeline.status === 'idle' && (
                      <>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-muted-foreground whitespace-nowrap">Target pages:</label>
                          <Input
                            type="number" min={80} max={130} value={targetPages}
                            onChange={e => setTargetPages(Number(e.target.value))}
                            className="h-7 text-xs w-20"
                          />
                        </div>
                        <Button
                          size="sm" className="w-full h-8 text-xs gap-1.5"
                          disabled={isLoading}
                          onClick={() => {
                            if (selectedDocId && selectedVersionId) {
                              pipeline.startPipeline(
                                selectedDocId,
                                selectedVersionId,
                                targetPages,
                                latestAnalysis?.protect || [],
                              );
                            }
                          }}
                        >
                          <Film className="h-3 w-3" />
                          Generate Feature Script
                        </Button>
                      </>
                    )}

                    {pipeline.status !== 'idle' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[9px]">
                            {pipeline.status === 'planning' && 'Planning scenes…'}
                            {pipeline.status === 'writing' && `Writing batch ${pipeline.currentBatch + 1}/${pipeline.totalBatches}`}
                            {pipeline.status === 'assembling' && 'Assembling screenplay…'}
                            {pipeline.status === 'paused' && 'Paused'}
                            {pipeline.status === 'complete' && 'Complete ✓'}
                            {pipeline.status === 'error' && 'Error'}
                          </Badge>
                          <div className="flex gap-1">
                            {(pipeline.status === 'writing') && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.pause}>
                                <Pause className="h-3 w-3" />
                              </Button>
                            )}
                            {pipeline.status === 'paused' && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.resume}>
                                <Play className="h-3 w-3" />
                              </Button>
                            )}
                            {['writing', 'paused'].includes(pipeline.status) && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.abort}>
                                <Square className="h-3 w-3" />
                              </Button>
                            )}
                            {['complete', 'error'].includes(pipeline.status) && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.reset}>
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {pipeline.totalBatches > 0 && (
                          <div className="space-y-1">
                            <Progress
                              value={
                                pipeline.status === 'planning' ? 5 :
                                pipeline.status === 'assembling' ? 95 :
                                pipeline.status === 'complete' ? 100 :
                                Math.round((pipeline.currentBatch / pipeline.totalBatches) * 90) + 5
                              }
                              className="h-1.5"
                            />
                            <div className="flex justify-between text-[9px] text-muted-foreground">
                              <span>{pipeline.pageEstimate} pages</span>
                              <span>{pipeline.wordCount.toLocaleString()} words</span>
                            </div>
                          </div>
                        )}

                        {pipeline.error && (
                          <p className="text-[10px] text-destructive">{pipeline.error}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

            </div>

            {/* ── CENTER: Workspace ── */}
            <div className="md:col-span-6">
              {!selectedDocId ? (
                <Card className="h-full flex items-center justify-center">
                  <div className="text-center space-y-3 p-8">
                    <Target className="h-10 w-10 text-muted-foreground mx-auto" />
                    <p className="text-muted-foreground">Select a document or paste new material to begin</p>
                    <Button variant="outline" onClick={() => setPasteOpen(true)}>
                      <ClipboardPaste className="h-4 w-4 mr-2" /> Paste New Document
                    </Button>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* Version badge */}
                  {selectedVersion && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border gap-1">
                        <GitBranch className="h-2.5 w-2.5" />
                        v{selectedVersion.version_number}
                        {selectedVersion.label ? ` · ${selectedVersion.label}` : ''}
                      </Badge>
                    </div>
                  )}

                  {/* ── TWO-BUTTON DEVELOPMENT LOOP ── */}
                  <div className="flex flex-wrap gap-2">
                    {!isAnalysisConverged ? (
                      <>
                        {/* Primary: Run Review (Analyze + Notes in one) or Apply Rewrite */}
                        {!latestAnalysis ? (
                          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleRunEngine} disabled={isLoading || !versionText}>
                            {analyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            Run Review
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" className="h-8 text-xs gap-1.5"
                              onClick={handleRewrite}
                              disabled={isLoading || rewritePipeline.status !== 'idle' || allPrioritizedMoves.length === 0 || selectedNotes.size === 0}>
                              {(rewrite.isPending || rewritePipeline.status !== 'idle') ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                              Apply Rewrite
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleRunEngine} disabled={isLoading}>
                              {analyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              Run Review Again
                            </Button>
                          </>
                        )}
                        {/* Notes auto-generate after Run Review — manual fallback if needed */}
                        {latestAnalysis && !latestNotes && !generateNotes.isPending && (
                          <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5"
                            onClick={() => generateNotes.mutate(latestAnalysis)} disabled={isLoading}>
                            <Zap className="h-3 w-3" />
                            Generate Notes
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Converged state */}
                        <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => {
                            if (nextBestDocument) {
                              setSelectedDeliverableType(nextBestDocument as DeliverableType);
                              convert.mutate({ targetOutput: nextBestDocument.toUpperCase(), protectItems: latestAnalysis?.protect });
                            }
                          }}
                          disabled={isLoading || !nextBestDocument}>
                          <ArrowRight className="h-3 w-3" />
                          Promote to Next Stage{nextBestDocument ? `: ${DELIVERABLE_LABELS[nextBestDocument as DeliverableType] || nextBestDocument}` : ''}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleRunEngine} disabled={isLoading}>
                          <RefreshCw className="h-3 w-3" />
                          Run Review Again
                        </Button>
                      </>
                    )}
                    {/* Convert button — always available as secondary */}
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5"
                      onClick={() => convert.mutate({ targetOutput: selectedDeliverableType.toUpperCase(), protectItems: latestAnalysis?.protect })}
                      disabled={isLoading || !selectedDocId || !selectedVersionId}>
                      {convert.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                      Convert → {DELIVERABLE_LABELS[selectedDeliverableType]}
                    </Button>
                  </div>

                  <OperationProgress isActive={analyze.isPending} stages={DEV_ANALYZE_STAGES} className="mb-1" />
                  <OperationProgress isActive={generateNotes.isPending} stages={DEV_NOTES_STAGES} className="mb-1" />
                  <OperationProgress isActive={rewrite.isPending} stages={DEV_REWRITE_STAGES} className="mb-1" />
                  <OperationProgress isActive={convert.isPending} stages={DEV_CONVERT_STAGES} className="mb-1" />
                  {rewritePipeline.status !== 'idle' && rewritePipeline.status !== 'complete' && (
                    <div className="mb-1 p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-2 text-sm mb-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="font-medium">
                          {rewritePipeline.status === 'planning' && 'Planning chunked rewrite…'}
                          {rewritePipeline.status === 'writing' && `Rewriting chunk ${rewritePipeline.currentChunk}/${rewritePipeline.totalChunks}…`}
                          {rewritePipeline.status === 'assembling' && 'Assembling final version…'}
                          {rewritePipeline.status === 'error' && `Error: ${rewritePipeline.error}`}
                        </span>
                      </div>
                      {rewritePipeline.totalChunks > 0 && (
                        <Progress value={(rewritePipeline.currentChunk / rewritePipeline.totalChunks) * 100} className="h-1.5" />
                      )}
                    </div>
                  )}

                  {/* Content area */}
                  <Card>
                    <CardContent className="p-4">
                      <ScrollArea className="h-[calc(100vh-380px)]">
                        <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                          {versionText || 'No content available.'}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {/* Feature length guardrails + Set as draft (only for scripts) */}
                  {selectedDocId && selectedVersionId && versionText && (selectedDeliverableType === 'script' || selectedDeliverableType === 'production_draft') && (
                    <FeatureLengthGuardrails
                      projectId={projectId!}
                      versionText={versionText}
                      selectedDocId={selectedDocId}
                      selectedVersionId={selectedVersionId}
                    />
                  )}
                  {selectedDocId && selectedVersionId && versionText && (
                    <SetAsLatestDraftButton
                      projectId={projectId}
                      title={selectedDoc?.title || selectedDoc?.file_name || 'Dev Engine Draft'}
                      text={versionText}
                    />
                  )}
                </div>
              )}
            </div>

            {/* ── RIGHT: Analysis & Notes Panel ── */}
            <div className="md:col-span-3 space-y-3">
              {/* Convergence chart */}
              <Card>
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <BarChart3 className="h-3 w-3" /> Convergence
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  {convergenceHistory.length >= 2 ? (
                    <div className="space-y-2">
                      <ConvergenceSparkline history={convergenceHistory} />
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>— Script Strength <span className="text-primary">━</span></span>
                        <span>Finance Readiness <span className="text-emerald-400">╌</span></span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground py-4 text-center">
                      Analyze 2+ versions to see trend
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Latest scores */}
              {latestAnalysis && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs">Scores</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-3">
                    <ConvergenceGauge
                      ci={latestAnalysis.ci_score || latestAnalysis.scores?.ci_score}
                      gp={latestAnalysis.gp_score || latestAnalysis.scores?.gp_score}
                      gap={latestAnalysis.gap || latestAnalysis.scores?.gap}
                      status={latestAnalysis.convergence_status || latestAnalysis.convergence?.status || ''}
                    />
                    {/* Summary bullets */}
                    {latestAnalysis.summary && (
                      <div className="space-y-1 mt-2">
                        {(latestAnalysis.summary as string[]).slice(0, 5).map((s: string, i: number) => (
                          <p key={i} className="text-[10px] text-muted-foreground">• {s}</p>
                        ))}
                      </div>
                    )}
                    {/* Blocking issues */}
                    {latestAnalysis.blocking_issues?.length > 0 && (
                      <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/20">
                        <p className="text-[10px] font-semibold text-destructive mb-1">Blocking Issues</p>
                        {(latestAnalysis.blocking_issues as string[]).map((b: string, i: number) => (
                          <p key={i} className="text-[10px] text-destructive/80">• {b}</p>
                        ))}
                      </div>
                    )}
                    {latestAnalysis.executive_snapshot && (
                      <p className="text-[10px] text-muted-foreground mt-2 italic">{latestAnalysis.executive_snapshot}</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Actionable Notes */}
              {allPrioritizedMoves.length > 0 && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Notes ({allPrioritizedMoves.length})</CardTitle>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5"
                          onClick={() => setSelectedNotes(new Set(allPrioritizedMoves.map((_, i) => i)))}>All</Button>
                        <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5"
                          onClick={() => setSelectedNotes(new Set())}>None</Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    <ScrollArea className="h-[calc(100vh-700px)] min-h-[150px]">
                      <div className="space-y-1.5 pr-1">
                        {allPrioritizedMoves.map((move: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded border border-border/40 hover:border-border transition-colors">
                            <Checkbox
                              checked={selectedNotes.has(i)}
                              onCheckedChange={() => {
                                setSelectedNotes(prev => {
                                  const next = new Set(prev);
                                  if (next.has(i)) next.delete(i); else next.add(i);
                                  return next;
                                });
                              }}
                              className="mt-0.5 h-3.5 w-3.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 mb-0.5">
                                <Badge variant="outline" className="text-[8px] px-1 py-0">{move.category}</Badge>
                                <Badge variant={move.impact === 'high' ? 'default' : 'secondary'} className="text-[8px] px-1 py-0">{move.impact}</Badge>
                                {move.convergence_lift && (
                                  <span className="text-[8px] text-emerald-400">+{move.convergence_lift}</span>
                                )}
                              </div>
                              <p className="text-[10px] text-foreground leading-relaxed">{move.note}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Rewrite plan preview */}
              {(latestAnalysis?.rewrite_plan || latestNotes?.rewrite_plan) && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs">Rewrite Plan</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <div className="space-y-1">
                      {((latestNotes?.rewrite_plan || latestAnalysis?.rewrite_plan) as string[]).slice(0, 5).map((item: string, i: number) => (
                        <p key={i} className="text-[10px] text-muted-foreground">• {item}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* History */}
              {convergenceHistory.length > 0 && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Clock className="h-3 w-3" /> Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    <ScrollArea className="h-[150px]">
                      <div className="space-y-1.5">
                        {convergenceHistory.slice().reverse().map((pt, i) => (
                          <div key={pt.id} className="p-2 rounded bg-muted/30 text-[10px]">
                            <div className="flex justify-between">
                              <span>SS: {Number(pt.creative_score)} | FR: {Number(pt.greenlight_score)}</span>
                              <span className="text-muted-foreground">{new Date(pt.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Badge variant="outline" className="text-[8px] px-1 py-0">{pt.convergence_status}</Badge>
                              {pt.trajectory && <span className="text-muted-foreground text-[8px]">{pt.trajectory}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
