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
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ArrowRight, Play, Loader2, Target, ClipboardPaste, Upload,
  AlertTriangle, GitBranch, Clock, Film, Pause, Square, RotateCcw, ChevronDown,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OperationProgress, DEV_ANALYZE_STAGES, DEV_NOTES_STAGES, DEV_REWRITE_STAGES, DEV_CONVERT_STAGES } from '@/components/OperationProgress';
import { useSetAsLatestDraft } from '@/hooks/useSetAsLatestDraft';
import { FeatureLengthGuardrails } from '@/components/FeatureLengthGuardrails';
import { type DevelopmentBehavior, BEHAVIOR_LABELS, BEHAVIOR_COLORS, DELIVERABLE_LABELS, defaultDeliverableForDocType, type DeliverableType } from '@/lib/dev-os-config';
import { isSeriesFormat as checkSeriesFormat } from '@/lib/format-helpers';
import { DeliverablePipeline, type PipelineStageStatus } from '@/components/DeliverablePipeline';

// Extracted components
import { DocumentSidebar } from '@/components/devengine/DocumentSidebar';
import { ActionToolbar } from '@/components/devengine/ActionToolbar';
import { NotesPanel } from '@/components/devengine/NotesPanel';
import { ConvergencePanel } from '@/components/devengine/ConvergencePanel';
import { DriftBanner } from '@/components/devengine/DriftBanner';
import { PromotionIntelligenceCard } from '@/components/devengine/PromotionIntelligenceCard';
import { usePromotionIntelligence, extractNoteCounts } from '@/hooks/usePromotionIntelligence';
import { AutoRunMissionControl } from '@/components/devengine/AutoRunMissionControl';
import { useAutoRunMissionControl } from '@/hooks/useAutoRunMissionControl';

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
        .select('format, development_behavior, episode_target_duration_seconds, season_episode_count')
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
  const [seasonEpisodes, setSeasonEpisodes] = useState((project as any)?.season_episode_count || 8);
  const [softGateOpen, setSoftGateOpen] = useState(false);
  const [pendingStageAction, setPendingStageAction] = useState<(() => void) | null>(null);
  const [driftOverrideOpen, setDriftOverrideOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  const {
    documents, docsLoading, versions, versionsLoading,
    selectedDoc, selectedVersion, selectedDocId, selectedVersionId,
    selectDocument, setSelectedVersionId,
    runs, allDocRuns, convergenceHistory,
    latestAnalysis, latestNotes, isConverged, convergenceStatus, isLoading,
    analyze, generateNotes, rewrite, convert, createPaste, deleteDocument,
    driftEvents, latestDrift, acknowledgeDrift, resolveDrift,
  } = useDevEngineV2(projectId);

  const pipeline = useScriptPipeline(projectId);
  const promotionIntel = usePromotionIntelligence();
  const rewritePipeline = useRewritePipeline(projectId);
  const autoRun = useAutoRunMissionControl(projectId);

  const [selectedDeliverableType, setSelectedDeliverableType] = useState<DeliverableType>('script');
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());
  const [targetPages, setTargetPages] = useState(100);

  const hasUnresolvedMajorDrift = latestDrift?.drift_level === 'major' && !latestDrift?.resolved;

  // Import landing
  const [importHandled, setImportHandled] = useState(false);
  useEffect(() => {
    if (importHandled || docsLoading) return;
    const docParam = searchParams.get('doc');
    const versionParam = searchParams.get('version');
    if (docParam && documents.some(d => d.id === docParam)) {
      selectDocument(docParam);
      if (versionParam) setSelectedVersionId(versionParam);
      setImportHandled(true);
    }
  }, [documents, docsLoading, searchParams, importHandled, selectDocument, setSelectedVersionId]);

  // Auto-set deliverable type from selected doc
  useEffect(() => {
    if (selectedDoc?.doc_type) {
      setSelectedDeliverableType(defaultDeliverableForDocType(selectedDoc.doc_type));
    }
  }, [selectedDoc?.doc_type]);

  // Tiered notes
  const tieredNotes = useMemo(() => {
    const blockers = latestNotes?.blocking_issues || latestAnalysis?.blocking_issues || [];
    const high = latestNotes?.high_impact_notes || latestAnalysis?.high_impact_notes || [];
    const polish = latestNotes?.polish_notes || latestAnalysis?.polish_notes || [];
    return { blockers, high, polish };
  }, [latestNotes, latestAnalysis]);

  const allPrioritizedMoves = useMemo(() => {
    const all = [
      ...tieredNotes.blockers.map((n: any) => ({ ...n, note: n.description || n.note, severity: 'blocker' })),
      ...tieredNotes.high.map((n: any) => ({ ...n, note: n.description || n.note, severity: 'high' })),
      ...tieredNotes.polish.map((n: any) => ({ ...n, note: n.description || n.note, severity: 'polish' })),
    ];
    if (all.length > 0) return all;
    const notes = latestNotes?.actionable_notes || latestNotes?.prioritized_moves;
    if (!notes) return [];
    return notes as any[];
  }, [tieredNotes, latestNotes]);

  // Sync episode params
  useEffect(() => {
    if (project?.episode_target_duration_seconds) setEpisodeDuration(project.episode_target_duration_seconds);
    if ((project as any)?.season_episode_count) setSeasonEpisodes((project as any).season_episode_count);
  }, [project?.episode_target_duration_seconds, (project as any)?.season_episode_count]);

  // Auto-select all notes
  useMemo(() => {
    if (allPrioritizedMoves.length > 0) {
      setSelectedNotes(new Set(allPrioritizedMoves.map((_, i) => i)));
    }
  }, [allPrioritizedMoves]);

  // Trigger Promotion Intelligence after analysis completes
  useEffect(() => {
    if (!latestAnalysis) { promotionIntel.clear(); return; }
    const ci = latestAnalysis?.ci_score ?? latestAnalysis?.scores?.ci ?? 0;
    const gp = latestAnalysis?.gp_score ?? latestAnalysis?.scores?.gp ?? 0;
    const gap = latestAnalysis?.gap ?? 0;
    const trajectory = latestAnalysis?.convergence?.trajectory ?? latestAnalysis?.trajectory ?? null;
    const { blockers, highImpact } = extractNoteCounts(latestAnalysis, latestNotes);
    const iterCount = allDocRuns.filter((r: any) => r.run_type === 'ANALYZE').length;
    promotionIntel.computeLocal({
      ci, gp, gap, trajectory,
      convergenceStatus: convergenceStatus,
      currentDocument: selectedDeliverableType,
      blockersCount: blockers.length,
      highImpactCount: highImpact.length,
      iterationCount: iterCount,
      blockerTexts: blockers,
      highImpactTexts: highImpact,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAnalysis, latestNotes]);

  // Handlers
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

  const handlePromote = () => {
    if (hasUnresolvedMajorDrift) {
      setDriftOverrideOpen(true);
      return;
    }
    const nextBestDocument = latestAnalysis?.convergence?.next_best_document;
    if (nextBestDocument) {
      setSelectedDeliverableType(nextBestDocument as DeliverableType);
      convert.mutate({ targetOutput: nextBestDocument.toUpperCase(), protectItems: latestAnalysis?.protect });
    }
  };

  const handleSkipStage = () => {
    const nextBestDocument = latestAnalysis?.convergence?.next_best_document;
    setPendingStageAction(() => () => {
      if (nextBestDocument) {
        setSelectedDeliverableType(nextBestDocument as DeliverableType);
        convert.mutate({ targetOutput: nextBestDocument.toUpperCase(), protectItems: latestAnalysis?.protect });
      }
    });
    setSoftGateOpen(true);
  };

  const versionText = selectedVersion?.plaintext || selectedDoc?.plaintext || selectedDoc?.extracted_text || '';

  const analysisConvergence = latestAnalysis?.convergence;
  const isAnalysisConverged = analysisConvergence?.status === 'converged' || convergenceStatus === 'Converged';
  const nextBestDocument = analysisConvergence?.next_best_document;

  // Pipeline statuses
  const pipelineStatuses = useMemo(() => {
    const statuses: Record<string, PipelineStageStatus> = {};
    for (const doc of documents) {
      const dt = doc.doc_type;
      const docRuns = allDocRuns.filter(r => r.document_id === doc.id);
      const analyzeRuns = docRuns.filter(r => r.run_type === 'ANALYZE');
      const latestRun = analyzeRuns[analyzeRuns.length - 1];
      const output = latestRun?.output_json;
      if (output) {
        const convStatus = output?.convergence?.status || output?.convergence_status;
        statuses[dt] = (convStatus === 'converged' || convStatus === 'Converged' || convStatus === 'Healthy Divergence')
          ? 'converged' : 'in_progress';
      } else if (doc.plaintext || doc.extracted_text) {
        if (!statuses[dt]) statuses[dt] = 'in_progress';
      }
    }
    return statuses;
  }, [documents, allDocRuns]);

  const setAsDraft = useSetAsLatestDraft(projectId);
  const resolutionSummary = latestNotes?.resolution_summary;
  const stabilityStatus = latestNotes?.stability_status || latestAnalysis?.stability_status;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-[1600px] mx-auto px-4 py-4 space-y-3">

          {/* ═══ HEADER BAR ═══ */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Link to={`/projects/${projectId}`} className="text-xs text-muted-foreground hover:text-foreground">
                ← Project
              </Link>
              <h1 className="text-base font-display font-bold text-foreground">Development Engine</h1>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={`text-[10px] ${BEHAVIOR_COLORS[projectBehavior]}`}>
                {BEHAVIOR_LABELS[projectBehavior]}
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground">
                {normalizedFormat}
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                {DELIVERABLE_LABELS[selectedDeliverableType]}
              </Badge>
            </div>
          </div>

          {/* ═══ SETTINGS STRIP ═══ */}
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
                <Input type="number" className="h-7 text-xs w-[60px]" value={episodeDuration}
                  onChange={(e) => setEpisodeDuration(Number(e.target.value))}
                  onBlur={async () => {
                    if (!projectId || !episodeDuration) return;
                    await (supabase as any).from('projects').update({ episode_target_duration_seconds: episodeDuration }).eq('id', projectId);
                    qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
                  }}
                  min={30} max={7200} />
                <span className="text-[9px] text-muted-foreground">s/ep</span>
                <Input type="number" className="h-7 text-xs w-[50px]" value={seasonEpisodes}
                  onChange={(e) => setSeasonEpisodes(Number(e.target.value))}
                  onBlur={async () => {
                    if (!projectId || !seasonEpisodes) return;
                    await (supabase as any).from('projects').update({ season_episode_count: seasonEpisodes }).eq('id', projectId);
                    qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
                  }}
                  min={3} max={100} />
                <span className="text-[9px] text-muted-foreground">eps</span>
              </div>
            )}
          </div>

          {/* ═══ PIPELINE ═══ */}
          <DeliverablePipeline stageStatuses={pipelineStatuses} activeDeliverable={selectedDeliverableType}
            onStageClick={(dt) => setSelectedDeliverableType(dt)} />

          {/* ═══ 3-COLUMN LAYOUT ═══ */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4" style={{ minHeight: 'calc(100vh - 240px)' }}>

            {/* ── LEFT: Documents ── */}
            <div className="md:col-span-3">
              <DocumentSidebar
                documents={documents} docsLoading={docsLoading}
                selectedDocId={selectedDocId} selectDocument={selectDocument}
                deleteDocument={deleteDocument} versions={versions}
                selectedVersionId={selectedVersionId} setSelectedVersionId={setSelectedVersionId}
                createPaste={createPaste}
              />

              {/* Feature Script Pipeline — only for features */}
              {isFeature && selectedDocId && selectedVersionId && (
                <Card className="border-primary/20 mt-3">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Film className="h-3 w-3" /> Script Pipeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    {pipeline.status === 'idle' ? (
                      <>
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground whitespace-nowrap">Pages:</label>
                          <Input type="number" min={80} max={130} value={targetPages}
                            onChange={e => setTargetPages(Number(e.target.value))} className="h-7 text-xs w-16" />
                        </div>
                        <Button size="sm" className="w-full h-7 text-[10px] gap-1" disabled={isLoading}
                          onClick={() => selectedDocId && selectedVersionId && pipeline.startPipeline(
                            selectedDocId, selectedVersionId, targetPages, latestAnalysis?.protect || [])}>
                          <Film className="h-3 w-3" /> Generate Script
                        </Button>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[9px]">
                            {pipeline.status === 'planning' && 'Planning…'}
                            {pipeline.status === 'writing' && `Batch ${pipeline.currentBatch + 1}/${pipeline.totalBatches}`}
                            {pipeline.status === 'assembling' && 'Assembling…'}
                            {pipeline.status === 'paused' && 'Paused'}
                            {pipeline.status === 'complete' && '✓ Complete'}
                            {pipeline.status === 'error' && 'Error'}
                          </Badge>
                          <div className="flex gap-0.5">
                            {pipeline.status === 'writing' && (
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={pipeline.pause}><Pause className="h-3 w-3" /></Button>
                            )}
                            {pipeline.status === 'paused' && (
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={pipeline.resume}><Play className="h-3 w-3" /></Button>
                            )}
                            {['writing', 'paused'].includes(pipeline.status) && (
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={pipeline.abort}><Square className="h-3 w-3" /></Button>
                            )}
                            {['complete', 'error'].includes(pipeline.status) && (
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={pipeline.reset}><RotateCcw className="h-3 w-3" /></Button>
                            )}
                          </div>
                        </div>
                        {pipeline.totalBatches > 0 && (
                          <Progress value={
                            pipeline.status === 'planning' ? 5 :
                            pipeline.status === 'assembling' ? 95 :
                            pipeline.status === 'complete' ? 100 :
                            Math.round((pipeline.currentBatch / pipeline.totalBatches) * 90) + 5
                          } className="h-1.5" />
                        )}
                        {pipeline.error && <p className="text-[9px] text-destructive">{pipeline.error}</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── CENTER: Workspace ── */}
            <div className="md:col-span-6 space-y-3">
              {!selectedDocId ? (
                <Card className="h-full flex items-center justify-center min-h-[400px]">
                  <div className="text-center space-y-3 p-8">
                    <Target className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground">Select or paste a document to begin</p>
                  </div>
                </Card>
              ) : (
                <>
                  {/* Version badge */}
                  {selectedVersion && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1">
                        <GitBranch className="h-2.5 w-2.5" />
                        v{selectedVersion.version_number}
                        {selectedVersion.label ? ` · ${selectedVersion.label}` : ''}
                      </Badge>
                    </div>
                  )}

                  {/* Drift banner */}
                  <DriftBanner drift={latestDrift}
                    onAcknowledge={() => latestDrift && acknowledgeDrift.mutate(latestDrift.id)}
                    onResolve={() => latestDrift && resolveDrift.mutate({ driftEventId: latestDrift.id, resolutionType: 'accept_drift' })} />

                  {/* Action toolbar */}
                  <ActionToolbar
                    hasAnalysis={!!latestAnalysis}
                    isConverged={isAnalysisConverged}
                    isLoading={isLoading}
                    onRunReview={handleRunEngine}
                    onApplyRewrite={handleRewrite}
                    onPromote={handlePromote}
                    onSkipStage={handleSkipStage}
                    onConvert={() => convert.mutate({ targetOutput: selectedDeliverableType.toUpperCase(), protectItems: latestAnalysis?.protect })}
                    selectedNoteCount={selectedNotes.size}
                    totalNoteCount={allPrioritizedMoves.length}
                    nextBestDocument={nextBestDocument || null}
                    selectedDeliverableType={selectedDeliverableType}
                    hasUnresolvedDrift={hasUnresolvedMajorDrift}
                    analyzePending={analyze.isPending}
                    rewritePending={rewrite.isPending || rewritePipeline.status !== 'idle'}
                    convertPending={convert.isPending}
                    generateNotesPending={generateNotes.isPending}
                  />

                  {/* Progress indicators */}
                  <OperationProgress isActive={analyze.isPending} stages={DEV_ANALYZE_STAGES} />
                  <OperationProgress isActive={generateNotes.isPending} stages={DEV_NOTES_STAGES} />
                  <OperationProgress isActive={rewrite.isPending} stages={DEV_REWRITE_STAGES} />
                  <OperationProgress isActive={convert.isPending} stages={DEV_CONVERT_STAGES} />
                  {rewritePipeline.status !== 'idle' && rewritePipeline.status !== 'complete' && (
                    <div className="p-2 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-2 text-xs">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>
                          {rewritePipeline.status === 'planning' && 'Planning rewrite…'}
                          {rewritePipeline.status === 'writing' && `Chunk ${rewritePipeline.currentChunk}/${rewritePipeline.totalChunks}`}
                          {rewritePipeline.status === 'assembling' && 'Assembling…'}
                          {rewritePipeline.status === 'error' && `Error: ${rewritePipeline.error}`}
                        </span>
                      </div>
                      {rewritePipeline.totalChunks > 0 && (
                        <Progress value={(rewritePipeline.currentChunk / rewritePipeline.totalChunks) * 100} className="h-1 mt-1" />
                      )}
                    </div>
                  )}

                  {/* Document content */}
                  <Card>
                    <CardContent className="p-4">
                      <ScrollArea className="h-[calc(100vh-440px)]">
                        <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                          {versionText || 'No content available.'}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {versionText && (
                    <div className="flex justify-end">
                      <ConfirmDialog
                        title="Set as Latest Draft?"
                        description={`Register "${selectedDoc?.title || 'this document'}" as the project's current script draft.`}
                        confirmLabel="Set as Latest Draft"
                        onConfirm={() => setAsDraft.mutate({ title: selectedDoc?.title || 'Dev Engine Draft', text: versionText })}
                      >
                        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
                          disabled={setAsDraft.isPending}>
                          {setAsDraft.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                          Set as Latest Draft
                        </Button>
                      </ConfirmDialog>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── RIGHT: Intelligence ── */}
            <div className="md:col-span-3 space-y-3">
              {/* Convergence */}
              <ConvergencePanel
                latestAnalysis={latestAnalysis}
                convergenceHistory={convergenceHistory}
                convergenceStatus={convergenceStatus}
                tieredNotes={tieredNotes}
              />

              {/* Promotion Intelligence */}
              <PromotionIntelligenceCard
                data={promotionIntel.data}
                isLoading={promotionIntel.isLoading}
                onPromote={handlePromote}
                onReReview={handleRunEngine}
              />

              {/* Auto-Run Panel */}
              <AutoRunMissionControl
                projectId={projectId!}
                currentDeliverable={selectedDeliverableType}
                job={autoRun.job}
                steps={autoRun.steps}
                isRunning={autoRun.isRunning}
                error={autoRun.error}
                onStart={autoRun.start}
                onRunNext={autoRun.runNext}
                onResume={autoRun.resume}
                onPause={autoRun.pause}
                onStop={autoRun.stop}
                onClear={autoRun.clear}
                onApproveDecision={autoRun.approveDecision}
                onGetPendingDoc={autoRun.getPendingDoc}
                onApproveNext={autoRun.approveNext}
                onSetStage={autoRun.setStage}
                onForcePromote={autoRun.forcePromote}
                onRestartFromStage={autoRun.restartFromStage}
                onSaveStorySetup={autoRun.saveStorySetup}
                onSaveQualifications={autoRun.saveQualifications}
                onSaveLaneBudget={autoRun.saveLaneBudget}
                onSaveGuardrails={autoRun.saveGuardrails}
                fetchDocumentText={autoRun.fetchDocumentText}
              />
              {versionText && !isVerticalDrama && (selectedDeliverableType === 'script' || selectedDeliverableType === 'production_draft') && (
                <FeatureLengthGuardrails projectId={projectId!} versionText={versionText}
                  selectedDocId={selectedDocId} selectedVersionId={selectedVersionId} />
              )}

              {/* Notes */}
              <NotesPanel
                allNotes={allPrioritizedMoves}
                tieredNotes={tieredNotes}
                selectedNotes={selectedNotes}
                setSelectedNotes={setSelectedNotes}
                onApplyRewrite={handleRewrite}
                isRewriting={rewrite.isPending || rewritePipeline.status !== 'idle'}
                isLoading={isLoading}
                resolutionSummary={resolutionSummary}
                stabilityStatus={stabilityStatus}
              />

              {/* Rewrite plan */}
              {(latestAnalysis?.rewrite_plan || latestNotes?.rewrite_plan) && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs">Rewrite Plan</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <div className="space-y-0.5">
                      {((latestNotes?.rewrite_plan || latestAnalysis?.rewrite_plan) as string[]).slice(0, 5).map((item: string, i: number) => (
                        <p key={i} className="text-[9px] text-muted-foreground">• {item}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Timeline — collapsed */}
              {convergenceHistory.length > 0 && (
                <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
                  <Card>
                    <CardHeader className="py-2 px-3">
                      <CollapsibleTrigger className="flex items-center justify-between w-full">
                        <CardTitle className="text-xs flex items-center gap-1.5">
                          <Clock className="h-3 w-3" /> Timeline ({convergenceHistory.length})
                        </CardTitle>
                        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${timelineOpen ? 'rotate-0' : '-rotate-90'}`} />
                      </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                      <CardContent className="px-2 pb-2">
                        <div className="space-y-1 max-h-[150px] overflow-y-auto">
                          {convergenceHistory.slice().reverse().map((pt) => (
                            <div key={pt.id} className="p-1.5 rounded bg-muted/30 text-[9px]">
                              <div className="flex justify-between">
                                <span>SS: {Number(pt.creative_score)} | FR: {Number(pt.greenlight_score)}</span>
                                <span className="text-muted-foreground">{new Date(pt.created_at).toLocaleDateString()}</span>
                              </div>
                              <Badge variant="outline" className="text-[7px] px-1 py-0 mt-0.5">{pt.convergence_status}</Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drift Override Dialog */}
      <Dialog open={driftOverrideOpen} onOpenChange={setDriftOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Unresolved Major Drift
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Major structural drift detected. Proceeding may cause instability downstream.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDriftOverrideOpen(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => {
                setDriftOverrideOpen(false);
                if (nextBestDocument) {
                  setSelectedDeliverableType(nextBestDocument as DeliverableType);
                  convert.mutate({ targetOutput: nextBestDocument.toUpperCase(), protectItems: latestAnalysis?.protect });
                }
              }}>Promote Anyway</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Soft Gate Dialog */}
      <Dialog open={softGateOpen} onOpenChange={setSoftGateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" /> Stage Not Converged
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This stage hasn't converged. Proceeding may increase rewrite cycles downstream.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setSoftGateOpen(false)}>Cancel</Button>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => {
                setSoftGateOpen(false);
                pendingStageAction?.();
                setPendingStageAction(null);
              }}>Proceed Anyway</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
