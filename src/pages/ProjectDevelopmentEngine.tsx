import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowRight, Play, Loader2, Target, ClipboardPaste, Upload, Sparkles,
  AlertTriangle, GitBranch, Clock, Film, Pause, Square, RotateCcw, ChevronDown,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OperationProgress, DEV_ANALYZE_STAGES, DEV_NOTES_STAGES, DEV_REWRITE_STAGES, DEV_CONVERT_STAGES } from '@/components/OperationProgress';
import { useSetAsLatestDraft } from '@/hooks/useSetAsLatestDraft';
import { useSeasonTemplate } from '@/hooks/useSeasonTemplate';
import { canPromoteToScript } from '@/lib/can-promote-to-script';
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
import { DecisionModePanel } from '@/components/devengine/DecisionModePanel';
import type { Decision } from '@/components/devengine/DecisionCard';
import { usePromotionIntelligence, extractNoteCounts } from '@/hooks/usePromotionIntelligence';
import { AutoRunMissionControl } from '@/components/devengine/AutoRunMissionControl';
import { AutoRunBanner } from '@/components/devengine/AutoRunBanner';
import { CriteriaPanel } from '@/components/devengine/CriteriaPanel';
import { useAutoRunMissionControl } from '@/hooks/useAutoRunMissionControl';
import { CanonicalQualificationsPanel } from '@/components/devengine/CanonicalQualificationsPanel';
import { QualificationConflictBanner } from '@/components/devengine/QualificationConflictBanner';
import { useStageResolve } from '@/hooks/useStageResolve';
import { useDecisionCommit } from '@/hooks/useDecisionCommit';
import { isDocStale } from '@/lib/stale-detection';
import { StaleDocBanner } from '@/components/devengine/StaleDocBanner';
import { DocumentPackagePanel } from '@/components/devengine/DocumentPackagePanel';
import { ProvenancePanel } from '@/components/devengine/ProvenancePanel';
import { ConnectivityBanner } from '@/components/devengine/ConnectivityBanner';
import { useDocumentPackage } from '@/hooks/useDocumentPackage';
import { DocAssistantDrawer } from '@/components/devengine/DocAssistantDrawer';

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
  const [episodeDuration, setEpisodeDuration] = useState<number | null>(null);
  const [seasonEpisodes, setSeasonEpisodes] = useState<number | null>(null);

  // Derive effective values: local override takes priority, then DB, then format defaults
  const effectiveEpisodeDuration = episodeDuration ?? project?.episode_target_duration_seconds ?? (isVerticalDrama ? 60 : 120);
  const effectiveSeasonEpisodes = seasonEpisodes ?? (project as any)?.season_episode_count ?? 8;
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
    analyze, generateNotes, rewrite, convert, createPaste, deleteDocument, deleteVersion, beatSheetToScript,
    driftEvents, latestDrift, acknowledgeDrift, resolveDrift,
  } = useDevEngineV2(projectId);

  const pipeline = useScriptPipeline(projectId);
  const promotionIntel = usePromotionIntelligence();
  const rewritePipeline = useRewritePipeline(projectId);
  const autoRun = useAutoRunMissionControl(projectId);
  const { resolveOnEntry, currentResolverHash, resolvedQuals } = useStageResolve(projectId);
  const { propose } = useDecisionCommit(projectId);
  const { packageStatus: packageStatusData, currentResolverHash: pkgResolverHash } = useDocumentPackage(projectId);

  // Build a map of doc_type -> latest_version_id for LATEST badges
  const latestVersionMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (packageStatusData) {
      for (const pkg of packageStatusData) {
        if (pkg.latestVersionId) {
          map[pkg.docType] = pkg.latestVersionId;
        }
      }
    }
    return map;
  }, [packageStatusData]);
  // Stage-entry re-resolve: call resolve-qualifications when the page loads
  useEffect(() => {
    resolveOnEntry();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect episode count conflicts in upstream artifacts
  const artifactConflicts = useMemo(() => {
    if (!isSeriesFormat || !project) return [];
    const canonicalCount = effectiveSeasonEpisodes;
    const conflicts: Array<{ artifactName: string; artifactEpisodeCount: number; canonicalEpisodeCount: number }> = [];

    // Check latest analysis for stale episode references
    if (latestAnalysis) {
      const snapshot = latestAnalysis.criteria_snapshot;
      if (snapshot?.season_episode_count && snapshot.season_episode_count !== canonicalCount) {
        conflicts.push({
          artifactName: 'Latest Analysis',
          artifactEpisodeCount: snapshot.season_episode_count,
          canonicalEpisodeCount: canonicalCount,
        });
      }
    }

    return conflicts;
  }, [isSeriesFormat, project, effectiveSeasonEpisodes, latestAnalysis]);

  const [selectedDeliverableType, setSelectedDeliverableType] = useState<DeliverableType>('script');
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());
  const [targetPages, setTargetPages] = useState(100);
  const [notesDecisions, setNotesDecisions] = useState<Record<string, string>>({});
  const [notesCustomDirections, setNotesCustomDirections] = useState<Record<string, string>>({});

  const hasUnresolvedMajorDrift = latestDrift?.drift_level === 'major' && !latestDrift?.resolved;

  // Import landing — auto-select from URL params, or stage-appropriate doc, or latest
  const [importHandled, setImportHandled] = useState(false);
  useEffect(() => {
    if (importHandled || docsLoading || documents.length === 0) return;
    const docParam = searchParams.get('doc');
    const versionParam = searchParams.get('version');
    if (docParam && documents.some(d => d.id === docParam)) {
      selectDocument(docParam);
      if (versionParam) setSelectedVersionId(versionParam);
    } else {
      // Prefer document with latest_version_id set (i.e., actively tracked by package system)
      // Then prefer documents that match the current pipeline stage's required doc types
      const pkgData = packageStatusData;
      let bestDoc = documents[0]; // fallback: most recent
      if (pkgData && pkgData.length > 0) {
        // Find the first required doc that exists and has content
        const requiredWithDocs = pkgData
          .filter((p: any) => p.required && p.documentId)
          .sort((a: any, b: any) => b.order - a.order); // highest-order = furthest in pipeline
        const furthest = requiredWithDocs[0];
        if (furthest) {
          const match = documents.find(d => d.id === furthest.documentId);
          if (match) bestDoc = match;
        }
      }
      selectDocument(bestDoc.id);
    }
    setImportHandled(true);
  }, [documents, docsLoading, searchParams, importHandled, selectDocument, setSelectedVersionId, packageStatusData]);

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

  // No sync effect needed — effective values derive from project data directly

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
      projectFormat,
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
      episodeTargetDurationSeconds: (isVerticalDrama || isSeriesFormat) ? effectiveEpisodeDuration : undefined,
      previousVersionId: prevVersion?.id,
    }, {
      onSuccess: (analysisResult: any) => {
        generateNotes.mutate(analysisResult);
      },
    });
  };

  const handleRewrite = (decisions?: Record<string, string>, globalDirections?: any[]) => {
    const approved = allPrioritizedMoves.filter((_, i) => selectedNotes.has(i));
    const protectItems = latestNotes?.protect || latestAnalysis?.protect || [];
    const textLength = (selectedVersion?.plaintext || selectedDoc?.plaintext || '').length;

    // Build decision directives: resolve option details from notes
    let decisionDirectives: any[] = [];
    if (decisions && Object.keys(decisions).length > 0) {
      for (const [noteId, optionId] of Object.entries(decisions)) {
        if (!optionId) continue;

        // Handle "Other" — user-proposed custom solution
        if (optionId === '__other__') {
          const customText = notesCustomDirections[noteId];
          if (customText) {
            const note = [...(tieredNotes.blockers || []), ...(tieredNotes.high || [])].find((n: any) => (n.id || n.note_key) === noteId);
            decisionDirectives.push({
              note_id: noteId,
              note_description: note?.description || note?.note || '',
              selected_option: 'User-proposed solution',
              what_changes: [customText],
            });
          }
          continue;
        }

        // Find the note and its selected option
        const note = [...(tieredNotes.blockers || []), ...(tieredNotes.high || [])].find((n: any) => n.id === noteId);
        if (note?.decisions) {
          const option = note.decisions.find((d: any) => d.option_id === optionId);
          if (option) {
            decisionDirectives.push({
              note_id: noteId,
              note_description: note.description,
              selected_option: option.title,
              what_changes: option.what_changes,
            });
          }
        }
      }
    }

    // Combine approved notes with decision directives
    const enrichedNotes = approved.map((note: any) => {
      const directive = decisionDirectives.find(d => d.note_id === note.id);
      if (directive) {
        return {
          ...note,
          resolution_directive: `Apply: "${directive.selected_option}". Changes: ${directive.what_changes.join(', ')}.`,
        };
      }
      return note;
    });

    // Add global directions as additional context
    if (globalDirections && globalDirections.length > 0) {
      const directionNotes = globalDirections.map((d: any) => ({
        category: 'direction',
        note: `GLOBAL DIRECTION: ${d.direction} — ${d.why}`,
        impact: 'high',
        severity: 'direction',
      }));
      enrichedNotes.push(...directionNotes);
    }

    if (textLength > 30000 && selectedDocId && selectedVersionId) {
      rewritePipeline.startRewrite(selectedDocId, selectedVersionId, enrichedNotes, protectItems);
    } else {
      rewrite.mutate({
        approvedNotes: enrichedNotes,
        protectItems,
        deliverableType: selectedDeliverableType,
        developmentBehavior: projectBehavior,
        format: projectFormat,
      });
    }
  };

  const handlePromote = () => {
    if (!selectedVersionId) {
      toast.error('Select a version before promoting');
      return;
    }
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
    if (!selectedVersionId) {
      toast.error('Select a version before promoting');
      return;
    }
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
  const verticalDramaGating = analysisConvergence?.vertical_drama_gating || null;

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
  const seasonTemplate = useSeasonTemplate(projectId);
  const resolutionSummary = latestNotes?.resolution_summary;
  const stabilityStatus = latestNotes?.stability_status || latestAnalysis?.stability_status;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-[1800px] mx-auto px-4 py-4 space-y-3">

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
              <DocAssistantDrawer
                projectId={projectId}
                selectedDocType={selectedDoc?.doc_type}
                selectedVersionId={selectedVersionId || undefined}
                selectedVersionText={versionText}
                onVersionCreated={(vid) => setSelectedVersionId(vid)}
              />
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
                <Input type="number" className="h-7 text-xs w-[72px]" value={effectiveEpisodeDuration}
                  onChange={(e) => setEpisodeDuration(Number(e.target.value))}
                  onBlur={async () => {
                    if (!projectId || !effectiveEpisodeDuration) return;
                    await (supabase as any).from('projects').update({ episode_target_duration_seconds: effectiveEpisodeDuration }).eq('id', projectId);
                    qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
                  }}
                  min={30} max={7200} />
                <span className="text-[9px] text-muted-foreground">s/ep</span>
                <Input type="number" className="h-7 text-xs w-[64px]" value={effectiveSeasonEpisodes}
                  onChange={(e) => setSeasonEpisodes(Number(e.target.value))}
                  onBlur={async () => {
                    if (!projectId || !effectiveSeasonEpisodes) return;
                    await (supabase as any).from('projects').update({ season_episode_count: effectiveSeasonEpisodes }).eq('id', projectId);
                    qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
                  }}
                  min={3} max={100} />
                <span className="text-[9px] text-muted-foreground">eps</span>
              </div>
            )}
          </div>

          {/* ═══ CONNECTIVITY STATUS ═══ */}
          {projectId && (() => {
            const pkgData = packageStatusData;
            if (!pkgData) return null;
            const staleTypes = pkgData.filter((d: any) => d.status === 'stale').map((d: any) => d.docType);
            const connectedCount = pkgData.filter((d: any) => d.resolverHash).length;
            return (
              <ConnectivityBanner
                projectId={projectId}
                currentResolverHash={currentResolverHash}
                staleDocCount={staleTypes.length}
                staleDocTypes={staleTypes}
                totalDocs={pkgData.length}
                connectedDocs={connectedCount}
              />
            );
          })()}

          {/* ═══ PIPELINE ═══ */}
          <DeliverablePipeline stageStatuses={pipelineStatuses} activeDeliverable={selectedDeliverableType}
            onStageClick={(dt) => setSelectedDeliverableType(dt)} isVerticalDrama={isVerticalDrama} />

          {/* ═══ 3-COLUMN LAYOUT ═══ */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">

            {/* ── LEFT: Documents ── */}
            <div className="md:col-span-2">
              <DocumentSidebar
                documents={documents} docsLoading={docsLoading}
                selectedDocId={selectedDocId} selectDocument={selectDocument}
                deleteDocument={deleteDocument} deleteVersion={deleteVersion} versions={versions}
                selectedVersionId={selectedVersionId} setSelectedVersionId={setSelectedVersionId}
                createPaste={createPaste}
                latestVersionMap={latestVersionMap}
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
            <div className="md:col-span-10 space-y-3" style={{ minHeight: 'calc(100vh - 280px)' }}>
              {/* Auto-Run Banner */}
              {autoRun.job && !['completed'].includes(autoRun.job.status) && (
                <AutoRunBanner
                  job={autoRun.job}
                  steps={autoRun.steps}
                  isRunning={autoRun.isRunning}
                  selectedDocId={selectedDocId}
                  selectedVersionId={selectedVersionId}
                  onPause={autoRun.pause}
                  onRunNext={autoRun.runNext}
                  onResume={autoRun.resume}
                  onSetResumeSource={autoRun.setResumeSource}
                  onStop={autoRun.stop}
                  onScrollToApproval={() => {
                    const el = document.getElementById('approval-queue-anchor');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  onScrollToCriteria={() => {
                    const el = document.getElementById('criteria-panel');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                />
              )}
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
                    onResolve={(resolutionType) => latestDrift && resolveDrift.mutate({ driftEventId: latestDrift.id, resolutionType })}
                    resolvePending={resolveDrift.isPending} />

                  {/* Qualification conflict banner */}
                  {artifactConflicts.length > 0 && (
                    <QualificationConflictBanner
                      conflicts={artifactConflicts}
                      onRegenerate={() => handleRunEngine()}
                      onKeep={() => {}}
                      onCreateDecision={(artifactName) => {
                        const canon = effectiveSeasonEpisodes;
                        const conflict = artifactConflicts.find(c => c.artifactName === artifactName);
                        propose.mutate({
                          fieldPath: 'qualifications.season_episode_count',
                          newValue: canon,
                          decisionType: 'qualifications_update',
                        });
                      }}
                      isRegenerating={analyze.isPending}
                    />
                  )}

                  {/* Stale document banner */}
                  {selectedVersion && currentResolverHash && isDocStale(selectedVersion as any, currentResolverHash) && (
                    <StaleDocBanner
                      docType={selectedDoc?.doc_type || 'document'}
                      oldHash={(selectedVersion as any).depends_on_resolver_hash || ''}
                      currentHash={currentResolverHash}
                      seasonEpisodeCount={resolvedQuals?.season_episode_count || effectiveSeasonEpisodes}
                      onRegenerate={handleRunEngine}
                      isRegenerating={analyze.isPending}
                    />
                  )}

                  {/* Action toolbar — simplified: only Run Review, Promote, Convert */}
                  <ActionToolbar
                    projectId={projectId}
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
                    verticalDramaGating={verticalDramaGating}
                    isVerticalDrama={isVerticalDrama}
                    currentDocType={selectedDoc?.doc_type}
                    seasonEpisodeCount={effectiveSeasonEpisodes}
                    onBeatSheetToScript={(epNum) => beatSheetToScript.mutate({ episodeNumber: epNum, seasonEpisodeCount: effectiveSeasonEpisodes })}
                    beatSheetToScriptPending={beatSheetToScript.isPending}
                    nextAction={promotionIntel.data?.next_action}
                  />

                  {/* Resume auto-run handled by banner above */}

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
                      <ScrollArea className="h-[300px]">
                        <pre className="text-sm text-foreground whitespace-pre-wrap font-body leading-relaxed">
                          {versionText || 'No content available.'}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {versionText && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* Set as Season Template — available for episode scripts on series formats */}
                      {(isSeriesFormat || isVerticalDrama) && (
                        <ConfirmDialog
                          title="Set as Season Template (Style Benchmark)?"
                          description="This sets tone/pacing/quality constraints for generation. It does not change document type or promote to script."
                          confirmLabel="Set as Season Template"
                          onConfirm={() => seasonTemplate.mutate({
                            docType: selectedDoc?.doc_type || '',
                            versionId: selectedVersionId || '',
                            versionText,
                          })}
                        >
                          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
                            disabled={seasonTemplate.isPending}>
                            {seasonTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
                            Set as Season Template (Style Benchmark)
                          </Button>
                        </ConfirmDialog>
                      )}

                      {/* Publish as Script — gated by canPromoteToScript() */}
                      {(() => {
                        const result = canPromoteToScript({
                          docType: selectedDoc?.doc_type,
                          linkedScriptId: null, // TODO: wire linked_script_id when available
                          contentLength: versionText.length,
                        });
                        if (!result.eligible) {
                          console.log('[Promote-to-Script] Hidden:', result.reason, {
                            doc_type: selectedDoc?.doc_type,
                            version_id: selectedVersionId,
                          });
                          return null;
                        }
                        console.log('[Promote-to-Script] Showing: eligible for', selectedDoc?.doc_type);
                        return (
                          <ConfirmDialog
                            title="Publish as Script?"
                            description={`Register "${selectedDoc?.title || 'this document'}" as the project's current script draft. This creates a script record.`}
                            confirmLabel="Publish as Script"
                            onConfirm={() => setAsDraft.mutate({
                              title: selectedDoc?.title || 'Dev Engine Draft',
                              text: versionText,
                              documentId: selectedDocId || undefined,
                              versionId: selectedVersionId || undefined,
                              docType: selectedDoc?.doc_type || undefined,
                            })}
                          >
                            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
                              disabled={setAsDraft.isPending}>
                              {setAsDraft.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                              Publish as Script
                            </Button>
                          </ConfirmDialog>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ═══ INTELLIGENCE PANELS (tabbed, below workspace) ═══ */}

          <Tabs defaultValue="notes" className="w-full">
             <TabsList className="w-full justify-start bg-muted/30 border border-border/50 h-9 flex-wrap">
              <TabsTrigger value="notes" className="text-xs">Notes & Feedback</TabsTrigger>
              <TabsTrigger value="convergence" className="text-xs">Convergence</TabsTrigger>
              <TabsTrigger value="qualifications" className="text-xs">Qualifications</TabsTrigger>
              <TabsTrigger value="autorun" className="text-xs">Auto-Run</TabsTrigger>
              <TabsTrigger value="criteria" className="text-xs">Criteria</TabsTrigger>
              <TabsTrigger value="package" className="text-xs">Package</TabsTrigger>
              <TabsTrigger value="provenance" className="text-xs">Provenance</TabsTrigger>
              {convergenceHistory.length > 0 && (
                <TabsTrigger value="timeline" className="text-xs">Timeline ({convergenceHistory.length})</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="notes" className="mt-3 space-y-3">
              {/* Decisions first, full width */}
              {(tieredNotes.blockers.length > 0 || tieredNotes.high.length > 0 ||
                (autoRun.job?.status === 'paused' && autoRun.job?.stop_reason?.includes('Decisions'))) && (
                <DecisionModePanel
                  projectId={projectId!}
                  documentId={selectedDocId}
                  versionId={selectedVersionId}
                  documentText={versionText}
                  docType={selectedDoc?.doc_type}
                  versionNumber={selectedVersion?.version_number}
                  updatedAt={selectedVersion?.created_at}
                  decisions={(() => {
                    const optionsRun = (runs || []).filter((r: any) => r.run_type === 'OPTIONS').pop();
                    if (optionsRun?.output_json?.decisions) return optionsRun.output_json.decisions;
                    const noteDecisions: Decision[] = [
                      ...tieredNotes.blockers.filter((n: any) => n.decisions?.length > 0).map((n: any) => ({
                        note_id: n.id, severity: 'blocker' as const, note: n.description || n.note,
                        options: n.decisions, recommended_option_id: n.recommended_option_id || n.recommended,
                      })),
                      ...tieredNotes.high.filter((n: any) => n.decisions?.length > 0).map((n: any) => ({
                        note_id: n.id, severity: 'high' as const, note: n.description || n.note,
                        options: n.decisions, recommended_option_id: n.recommended_option_id || n.recommended,
                      })),
                    ];
                    return noteDecisions;
                  })()}
                  globalDirections={(() => {
                    const optionsRun = (runs || []).filter((r: any) => r.run_type === 'OPTIONS').pop();
                    return optionsRun?.output_json?.global_directions || latestNotes?.global_directions || [];
                  })()}
                  jobId={autoRun.job?.id}
                  isAutoRunPaused={autoRun.job?.status === 'paused'}
                  onRewriteComplete={() => {
                    qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
                    qc.invalidateQueries({ queryKey: ['dev-v2-versions'] });
                    qc.invalidateQueries({ queryKey: ['dev-v2-runs'] });
                  }}
                  onAutoRunContinue={(opts, gd) => autoRun.applyDecisionsAndContinue?.(opts, gd)}
                  availableVersions={versions?.map((v: any) => ({ id: v.id, version_number: v.version_number, label: v.label }))}
                  hideApplyButton
                />
              )}

              {/* Notes (excluding notes that have decisions — those live in DecisionModePanel above) */}
              {(() => {
                // Build set of note IDs that are handled by decisions
                const decisionNoteIds = new Set<string>();
                const optionsRun = (runs || []).filter((r: any) => r.run_type === 'OPTIONS').pop();
                if (optionsRun?.output_json?.decisions) {
                  for (const d of optionsRun.output_json.decisions) decisionNoteIds.add(d.note_id);
                }
                // Also exclude notes with inline decisions
                for (const n of [...tieredNotes.blockers, ...tieredNotes.high]) {
                  if (n.decisions?.length > 0) decisionNoteIds.add(n.id || n.note_key);
                }

                const filteredBlockers = tieredNotes.blockers.filter((n: any) => !decisionNoteIds.has(n.id || n.note_key));
                const filteredHigh = tieredNotes.high.filter((n: any) => !decisionNoteIds.has(n.id || n.note_key));
                const filteredTiered = { blockers: filteredBlockers, high: filteredHigh, polish: tieredNotes.polish };
                const filteredAll = [...filteredBlockers, ...filteredHigh, ...tieredNotes.polish];

                if (filteredAll.length === 0) return null;

                return (
                  <NotesPanel
                    allNotes={filteredAll}
                    tieredNotes={filteredTiered}
                    selectedNotes={selectedNotes}
                    setSelectedNotes={setSelectedNotes}
                    onApplyRewrite={handleRewrite}
                    isRewriting={rewrite.isPending || rewritePipeline.status !== 'idle'}
                    isLoading={isLoading}
                    resolutionSummary={resolutionSummary}
                    stabilityStatus={stabilityStatus}
                    globalDirections={latestNotes?.global_directions || []}
                    hideApplyButton
                    onDecisionsChange={setNotesDecisions}
                    onCustomDirectionsChange={setNotesCustomDirections}
                  />
                );
              })()}

              {/* Rewrite Plan + Guardrails — below the notes/decisions grid */}
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
              {versionText && !isVerticalDrama && (selectedDeliverableType === 'script' || selectedDeliverableType === 'production_draft') && (
                <FeatureLengthGuardrails projectId={projectId!} versionText={versionText}
                  selectedDocId={selectedDocId} selectedVersionId={selectedVersionId} />
              )}

              {/* ═══ UNIFIED BIG BUTTON: Apply All Notes & Decisions ═══ */}
              {allPrioritizedMoves.length > 0 && (
                <Button
                  size="lg"
                  className="w-full h-12 text-sm font-semibold gap-2"
                  onClick={() => handleRewrite(
                    Object.keys(notesDecisions).length > 0 ? notesDecisions : undefined,
                    latestNotes?.global_directions || [],
                  )}
                  disabled={isLoading || rewrite.isPending || rewritePipeline.status !== 'idle' || (selectedNotes.size === 0 && Object.values(notesDecisions).filter(Boolean).length === 0)}
                >
                  {(rewrite.isPending || rewritePipeline.status !== 'idle') ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Apply All Notes & Decisions ({selectedNotes.size} notes
                  {Object.values(notesDecisions).filter(Boolean).length > 0
                    ? `, ${Object.values(notesDecisions).filter(Boolean).length} decisions`
                    : ''})
                </Button>
              )}
            </TabsContent>

            <TabsContent value="convergence" className="mt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ConvergencePanel
                  latestAnalysis={latestAnalysis}
                  convergenceHistory={convergenceHistory}
                  convergenceStatus={convergenceStatus}
                  tieredNotes={tieredNotes}
                />
                <div id="approval-queue-anchor">
                  <PromotionIntelligenceCard
                    data={promotionIntel.data}
                    isLoading={promotionIntel.isLoading}
                    jobId={autoRun.job?.id}
                    onJobRefresh={() => autoRun.runNext?.()}
                    onScrollToDecisions={() => {
                      const el = document.getElementById('decision-panel-anchor');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    onPromote={handlePromote}
                    onReReview={handleRunEngine}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="qualifications" className="mt-3">
              <CanonicalQualificationsPanel projectId={projectId!} />
            </TabsContent>

            <TabsContent value="autorun" className="mt-3">
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
                onSetResumeSource={autoRun.setResumeSource}
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
                latestAnalysis={latestAnalysis}
                currentDocText={versionText}
                currentDocMeta={{
                  doc_type: selectedDoc?.doc_type,
                  version: selectedVersion ? versions.indexOf(selectedVersion) + 1 : undefined,
                  char_count: versionText?.length,
                }}
                availableDocuments={documents?.map((d: any) => ({ id: d.id, doc_type: d.doc_type, title: d.title })) || []}
              />
            </TabsContent>

            <TabsContent value="criteria" className="mt-3">
              <CriteriaPanel
                projectId={projectId!}
                documents={documents?.map((d: any) => ({ id: d.id, doc_type: d.doc_type, title: d.title })) || []}
                onCriteriaUpdated={() => qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] })}
              />
            </TabsContent>

            <TabsContent value="package" className="mt-3">
              <DocumentPackagePanel projectId={projectId} />
            </TabsContent>

            <TabsContent value="provenance" className="mt-3">
              <Card>
                <CardContent className="p-4">
                  <ProvenancePanel
                    docType={selectedDoc?.doc_type || ''}
                    versionNumber={selectedVersion?.version_number ?? null}
                    status={(selectedVersion as any)?.status || 'draft'}
                    dependsOnHash={(selectedVersion as any)?.depends_on_resolver_hash || null}
                    currentResolverHash={currentResolverHash}
                    isStale={(selectedVersion as any)?.is_stale || false}
                    staleReason={(selectedVersion as any)?.stale_reason || null}
                    inputsUsed={(selectedVersion as any)?.inputs_used || null}
                    dependsOn={Array.isArray((selectedVersion as any)?.depends_on) ? (selectedVersion as any).depends_on : null}
                    generatorId={(selectedVersion as any)?.generator_id || null}
                    resolvedQualifications={resolvedQuals ? {
                      season_episode_count: resolvedQuals.season_episode_count,
                      episode_target_duration_seconds: resolvedQuals.episode_target_duration_seconds,
                      format: resolvedQuals.format,
                    } : null}
                    onRegenerate={handleRunEngine}
                    isRegenerating={analyze.isPending}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {convergenceHistory.length > 0 && (
              <TabsContent value="timeline" className="mt-3">
                <Card>
                  <CardContent className="p-3">
                    <div className="space-y-1 max-h-[300px] overflow-y-auto">
                      {convergenceHistory.slice().reverse().map((pt) => (
                        <div key={pt.id} className="p-2 rounded bg-muted/30 text-xs flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span>SS: {Number(pt.creative_score)} | FR: {Number(pt.greenlight_score)}</span>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0">{pt.convergence_status}</Badge>
                          </div>
                          <span className="text-muted-foreground text-[10px]">{new Date(pt.created_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
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
