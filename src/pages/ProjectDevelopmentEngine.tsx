import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { BgGenBanner } from '@/components/devengine/BgGenBanner';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useDevEngineV2 } from '@/hooks/useDevEngineV2';
import { useScriptPipeline } from '@/hooks/useScriptPipeline';
import { useRewritePipeline } from '@/hooks/useRewritePipeline';
import { useSceneRewritePipeline } from '@/hooks/useSceneRewritePipeline';
import { SceneRewritePanel } from '@/components/devengine/SceneRewritePanel';
import QualityRunHistory from '@/components/cinematic/QualityRunHistory';
import { DocSetManager } from '@/components/notes/DocSetManager';
import { ProcessProgressBar } from '@/components/devengine/ProcessProgressBar';
import { ActivityTimeline } from '@/components/devengine/ActivityTimeline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowRight, Play, Loader2, Target, ClipboardPaste, Upload, Sparkles, Plus,
  AlertTriangle, GitBranch, Clock, Film, Pause, Square, RotateCcw, ChevronDown,
  FileText, ShieldAlert,
} from 'lucide-react';


import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OperationProgress, DEV_ANALYZE_STAGES, DEV_NOTES_STAGES, DEV_REWRITE_STAGES, DEV_CONVERT_STAGES, DEV_GENERATE_STAGES } from '@/components/OperationProgress';
import { useSetAsLatestDraft } from '@/hooks/useSetAsLatestDraft';
import { approveAndActivate, unapproveVersion } from '@/lib/active-folder/approveAndActivate';
import { recordResolutions } from '@/lib/decisions/client';
import { useSeasonTemplate } from '@/hooks/useSeasonTemplate';
import { canPromoteToScript, getDocDisplayName } from '@/lib/can-promote-to-script';
import { DocumentExportDropdown } from '@/components/DocumentExportDropdown';
import { FeatureLengthGuardrails } from '@/components/FeatureLengthGuardrails';
import { ChangeReportPanel } from '@/components/devengine/ChangeReportPanel';
import { deriveScriptChangeArtifacts, isScriptDocType } from '@/lib/script_change';
import { type DevelopmentBehavior, type ConvergenceStatus, computeConvergenceStatus, BEHAVIOR_LABELS, BEHAVIOR_COLORS, DELIVERABLE_LABELS, getDeliverableLabel, defaultDeliverableForDocType, type DeliverableType } from '@/lib/dev-os-config';
import { isSeriesFormat as checkSeriesFormat } from '@/lib/format-helpers';
import { FORMAT_DEFAULTS } from '@/lib/qualifications/resolveQualifications';
import { DeliverablePipeline, type PipelineStageStatus } from '@/components/DeliverablePipeline';
import { StagePlanPanel } from '@/components/stages/StagePlanPanel';

// Extracted components
import { DocumentSidebar } from '@/components/devengine/DocumentSidebar';
import { ActionToolbar } from '@/components/devengine/ActionToolbar';
import { NotesPanel } from '@/components/devengine/NotesPanel';
import { ConvergencePanel } from '@/components/devengine/ConvergencePanel';
import { DriftBanner } from '@/components/devengine/DriftBanner';
import { PromotionIntelligenceCard } from '@/components/devengine/PromotionIntelligenceCard';
import { PipelineNextStepPanel } from '@/components/devengine/PipelineNextStepPanel';
import type { ExistingDoc } from '@/lib/pipeline-brain';
import { DecisionModePanel } from '@/components/devengine/DecisionModePanel';
import type { Decision } from '@/components/devengine/DecisionCard';
import { usePromotionIntelligence, extractNoteCounts } from '@/hooks/usePromotionIntelligence';
import { getNextStage } from '@/lib/stages/registry';
import { AutoRunMissionControl } from '@/components/devengine/AutoRunMissionControl';
import { AutoRunBanner } from '@/components/devengine/AutoRunBanner';
import { AutoRunProgressPanel } from '@/components/devengine/AutoRunProgressPanel';
import { CriteriaPanel } from '@/components/devengine/CriteriaPanel';
import { useAutoRunMissionControl } from '@/hooks/useAutoRunMissionControl';
import { CanonicalQualificationsPanel } from '@/components/devengine/CanonicalQualificationsPanel';
import { QualificationConflictBanner } from '@/components/devengine/QualificationConflictBanner';
import { GenerateSeasonScriptsPanel } from '@/components/devengine/GenerateSeasonScriptsPanel';
import { SeriesWriterAutorunPanel } from '@/components/devengine/SeriesWriterAutorunPanel';
import { useStageResolve } from '@/hooks/useStageResolve';
import { useDecisionCommit } from '@/hooks/useDecisionCommit';
import { isDocStale } from '@/lib/stale-detection';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';
import { StaleDocBanner } from '@/components/devengine/StaleDocBanner';
import { DocumentPackagePanel } from '@/components/devengine/DocumentPackagePanel';
import { CanonicalEditor } from '@/components/devengine/CanonicalEditor';
import { ProvenancePanel } from '@/components/devengine/ProvenancePanel';
import { ConnectivityBanner } from '@/components/devengine/ConnectivityBanner';
import { useDocumentPackage } from '@/hooks/useDocumentPackage';
import { DocAssistantDrawer } from '@/components/devengine/DocAssistantDrawer';
import { IssuesPanel } from '@/components/devengine/IssuesPanel';
import { useProjectIssues } from '@/hooks/useProjectIssues';
import { useDeferredNotes } from '@/hooks/useDeferredNotes';
import { useEpisodeHandoff } from '@/hooks/useEpisodeHandoff';
import { EpisodeHandoffBanner } from '@/components/devengine/EpisodeHandoffBanner';
import { SceneGraphPanel } from '@/components/devengine/SceneGraphPanel';
import { NoteWritersRoomDrawer } from '@/components/notes/NoteWritersRoomDrawer';
import { NextActionsPanel } from '@/components/notes/NextActionsPanel';
import { NoteDrawer } from '@/components/notes/NoteDrawer';
import { useProjectNotes } from '@/lib/notes/useProjectNotes';
import { MessageSquare } from 'lucide-react';
import { WorldRulesAccordion } from '@/components/rulesets/WorldRulesAccordion';
import { ActiveRulesetBadge } from '@/components/rulesets/ActiveRulesetBadge';
import { useProjectRuleset } from '@/hooks/useProjectRuleset';
import { SeedAppliedBanner } from '@/components/devengine/SeedAppliedBanner';
import { StyleSourcesPanel } from '@/components/devengine/StyleSourcesPanel';
import { StyleScoreBadge, StyleEvalPanel } from '@/components/devengine/StyleEvalPanel';
import { AutopilotPanel } from '@/components/dev/AutopilotPanel';
import { DevEngineSimpleView } from '@/components/devengine/DevEngineSimpleView';
import { EngineBar, deriveExecutionMode, type ExecutionMode } from '@/components/devengine/EngineBar';
import { useUIMode } from '@/hooks/useUIMode';
import { useSeedPackStatus } from '@/hooks/useSeedPackStatus';
import { normalizeDecisionsForUI } from '@/lib/decisions/normalizeDecisionUI';
import { useEnrichedPendingDecisions } from '@/hooks/useEnrichedPendingDecisions';
import { FormattedDocContent } from '@/components/devengine/FormattedDocContent';


// ── Main Page ──
export default function ProjectDevelopmentEngine() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode: uiMode, setMode: setUIMode } = useUIMode();
  // PATCH 3: When ?tab=autorun, default to simple view for this session without overwriting saved preference.
  // userExplicitlyToggled prevents re-overriding if user navigates to autorun tab later after toggling.
  const userExplicitlyToggledRef = useRef(false);
  const [autorunSessionOverride, setAutorunSessionOverride] = useState<boolean>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'autorun';
  });
  // Re-set override when tab changes to autorun (SPA navigation) — unless user already toggled
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'autorun' && !userExplicitlyToggledRef.current) {
      setAutorunSessionOverride(true);
    } else if (tabParam !== 'autorun') {
      setAutorunSessionOverride(false);
    }
  }, [searchParams]);
  const viewMode = autorunSessionOverride ? 'simple' : uiMode;
  const handleToggleMode = useCallback(() => {
    // User explicitly toggled — clear session override and persist preference based on effective viewMode
    userExplicitlyToggledRef.current = true;
    setAutorunSessionOverride(false);
    const nextMode = viewMode === 'simple' ? 'advanced' : 'simple';
    setUIMode(nextMode);
  }, [viewMode, setUIMode]);
  // Execution mode preference (persists to job when one exists, otherwise local)
  const [localExecutionMode, setLocalExecutionMode] = useState<ExecutionMode>('full_autopilot');
  const qc = useQueryClient();
  const VALID_TABS = new Set(['notes', 'issues', 'convergence', 'qualifications', 'autorun', 'series-scripts', 'criteria', 'package', 'canon', 'provenance', 'scenes', 'quality', 'docsets', 'timeline']);
  const initialTab = (() => { const t = searchParams.get('tab'); return t && VALID_TABS.has(t) ? t : 'notes'; })();
  const [intelligenceTab, setIntelligenceTab] = useState(initialTab);

  // Sync tab from URL when searchParams change (e.g. navigated with ?tab=autorun)
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && VALID_TABS.has(tabParam) && tabParam !== intelligenceTab) {
      setIntelligenceTab(tabParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps



  // Fetch project metadata — staleTime:0 + refetchOnWindowFocus ensures title changes
  // made elsewhere in the app (ProjectDetail, settings) are always reflected here.
  const { data: project, isError: projectNotFound } = useQuery({
    queryKey: ['dev-engine-project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('title, format, development_behavior, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, assigned_lane, budget_range, genres, comparable_titles, tone, target_audience, guardrails_config, source_pitch_idea_id')
        .eq('id', projectId!)
        .single();
      if (error) {
        // PGRST116 = not found; surface as null rather than throw to avoid blank screen
        if ((error as any).code === 'PGRST116' || error.message?.includes('Results contain 0 rows')) {
          return null;
        }
        throw error;
      }

      // Try to extract logline & premise from pitch idea or idea document
      let pitchLogline: string | null = null;
      let pitchPremise: string | null = null;

      // 1) From linked pitch_idea
      if (data.source_pitch_idea_id) {
        const { data: pitch } = await supabase
          .from('pitch_ideas')
          .select('logline, one_page_pitch')
          .eq('id', data.source_pitch_idea_id)
          .single();
        if (pitch?.logline) pitchLogline = pitch.logline;
        if (pitch?.one_page_pitch) pitchPremise = pitch.one_page_pitch;
      }

      // 2) Fallback: parse from latest idea document plaintext
      if (!pitchLogline || !pitchPremise) {
        const { data: ideaDoc } = await supabase
          .from('project_documents')
          .select('plaintext')
          .eq('project_id', projectId!)
          .eq('doc_type', 'idea')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (ideaDoc?.plaintext) {
          const text = ideaDoc.plaintext;
          if (!pitchLogline) {
            const loglineMatch = text.match(/\*\*Logline:\*\*\s*(.+?)(?:\n|$)/i) || text.match(/Logline:\s*(.+?)(?:\n|$)/i);
            if (loglineMatch) pitchLogline = loglineMatch[1].trim();
          }
          if (!pitchPremise) {
            const premiseMatch = text.match(/## One-Page Pitch\s*\n([\s\S]+?)(?:\n##|\n\*\*|$)/i);
            if (premiseMatch) pitchPremise = premiseMatch[1].trim();
          }
        }
      }

      return { ...data, pitchLogline, pitchPremise };
    },
    enabled: !!projectId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });




  // Invalidate the project query whenever the projects row changes in realtime
  // (covers title edits made from ProjectDetail or any other surface).
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`dev-engine-project-title-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, qc]);

  const normalizedFormat = (project?.format || 'film').toLowerCase().replace(/_/g, '-');
  const isFeature = !project?.format || normalizedFormat === 'feature' || normalizedFormat === 'film';
  const isVerticalDrama = normalizedFormat === 'vertical-drama';
  const isSeriesFormat = checkSeriesFormat(normalizedFormat);
  const projectBehavior = (project?.development_behavior as DevelopmentBehavior) || 'market';
  const projectFormat = normalizedFormat;
  const [episodeDurationMin, setEpisodeDurationMin] = useState<number | null>(null);
  const [episodeDurationMax, setEpisodeDurationMax] = useState<number | null>(null);
  const [seasonEpisodes, setSeasonEpisodes] = useState<number | null>(null);

  // Derive effective values: local override takes priority, then DB min/max, then DB scalar, then format defaults
  const defaultDur = isVerticalDrama ? 60 : 120;
  const effectiveEpisodeDurationMin = episodeDurationMin ?? (project as any)?.episode_target_duration_min_seconds ?? project?.episode_target_duration_seconds ?? defaultDur;
  const effectiveEpisodeDurationMax = episodeDurationMax ?? (project as any)?.episode_target_duration_max_seconds ?? project?.episode_target_duration_seconds ?? defaultDur;
  const formatDefaultEpisodes = FORMAT_DEFAULTS[normalizedFormat]?.season_episode_count;
  const effectiveSeasonEpisodes: number | null = seasonEpisodes ?? (project as any)?.season_episode_count ?? formatDefaultEpisodes ?? null;
  const [softGateOpen, setSoftGateOpen] = useState(false);
  const [pendingStageAction, setPendingStageAction] = useState<(() => void) | null>(null);
  const [driftOverrideOpen, setDriftOverrideOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [globalWritersRoomOpen, setGlobalWritersRoomOpen] = useState(false);
  const [nextActionNoteId, setNextActionNoteId] = useState<string | null>(null);
  const [nextActionDrawerOpen, setNextActionDrawerOpen] = useState(false);
  const lastPromotionGateVersionRef = useRef<string | null>(null);

  // Canonical notes for NextActionsPanel
  const { data: canonicalNotes = [] } = useProjectNotes(projectId, {
    statuses: ['open', 'reopened', 'needs_decision', 'in_progress'],
    timing: 'now',
  });

  const {
    documents, docsLoading, versions, versionsLoading,
    selectedDoc, selectedVersion, selectedDocId, selectedVersionId,
    selectDocument, setSelectedVersionId,
    runs, allDocRuns, convergenceHistory,
    latestAnalysis, latestNotes, isConverged, convergenceStatus, isLoading,
    analyze, generateNotes, rewrite, convert, createPaste, deleteDocument, deleteVersion, beatSheetToScript,
    driftEvents, latestDrift, acknowledgeDrift, resolveDrift,
    approvedVersionMap,
  } = useDevEngineV2(projectId);

  const isBgGenerating = (selectedVersion as any)?.meta_json?.bg_generating === true;
  const isSeasonScript = selectedDoc?.doc_type === 'season_script';



    if (globalDirections && globalDirections.length > 0) {
      const directionNotes = globalDirections.map((d: any) => ({
        category: 'direction',
        note: `GLOBAL DIRECTION: ${d.direction} — ${d.why}`,
        impact: 'high',
        severity: 'direction',
      }));
      enrichedNotes.push(...directionNotes);
    }

    // Record decisions after rewrite
    const afterRewrite = () => {
      recordResolutions({
        projectId: projectId!,
        source: decisions && Object.keys(decisions).length > 0 ? 'dev_engine_decision' : 'dev_engine_rewrite',
        notes: enrichedNotes.filter((n: any) => n.severity !== 'direction'),
        selectedOptions: decisions ? Object.entries(decisions).filter(([,v]) => !!v).map(([noteId, optionId]) => ({
          note_id: noteId, option_id: optionId, custom_direction: notesCustomDirections[noteId] || undefined,
        })) : undefined,
        globalDirections: globalDirections,
        currentDocTypeKey: selectedDeliverableType,
      }).catch(e => console.warn('[decisions] record failed:', e));
    };

    if (textLength > 30000 && selectedDocId && selectedVersionId) {
      const selected = sceneRewrite.selectedRewriteMode;

      let probe = sceneRewrite.probeResult;
      if (!probe && selected !== 'chunk') {
        probe = await sceneRewrite.probe(selectedDocId, selectedVersionId) ?? null;
      }

      let effectiveMode: 'scene' | 'chunk' = 'chunk';
      let rewriteModeReason = 'fallback_error';

      if (selected === 'chunk') {
        effectiveMode = 'chunk';
        rewriteModeReason = 'user_selected_chunk';
      } else if (selected === 'scene') {
        if (probe?.has_scenes === false) {
          effectiveMode = 'chunk';
          rewriteModeReason = 'fallback_scene_unavailable';
          toast.warning('No scenes detected — falling back to chunk rewrite.');
        } else {
          effectiveMode = 'scene';
          rewriteModeReason = 'user_selected_scene';
        }
      } else {
        if (probe?.has_scenes) {
          effectiveMode = 'scene';
          rewriteModeReason = 'auto_probe_scene';
        } else {
          effectiveMode = 'chunk';
          rewriteModeReason = 'auto_probe_chunk';
        }
      }

      const provenance = {
        rewriteModeSelected: selected,
        rewriteModeEffective: effectiveMode,
        rewriteModeReason,
        rewriteProbe: probe ? {
          has_scenes: probe.has_scenes,
          scenes_count: probe.scenes_count,
          script_chars: probe.script_chars,
        } : null,
        rewriteModeDebug: {
          selected,
          probed_has_scenes: probe?.has_scenes ?? null,
          probed_scenes_count: probe?.scenes_count ?? null,
          probed_script_chars: probe?.script_chars ?? null,
          decision_timestamp: new Date().toISOString(),
        },
      };

      if (effectiveMode === 'scene') {
        // Build scope plan via backend for real contracts
        if (selectedDocId && selectedVersionId && enrichedNotes.length > 0) {
          const scopePlan = await sceneRewrite.planScope(selectedDocId, selectedVersionId, enrichedNotes);

          if (scopePlan) {
            const totalScenes = sceneRewrite.totalScenesInScript || probe?.scenes_count || scopePlan.target_scene_numbers.length;

            // Only do selective if we have fewer targets than total scenes
            if (scopePlan.target_scene_numbers.length < totalScenes) {
              toast.info(`Selective rewrite: ${scopePlan.target_scene_numbers.length} scenes targeted (${totalScenes} total)`);
              const enqueueResult = await sceneRewrite.enqueue(
                selectedDocId, selectedVersionId, enrichedNotes, protectItems,
                scopePlan.target_scene_numbers,
              );
              if (enqueueResult) {
                sceneRewrite.processAll(selectedVersionId);
              }
            } else {
              // All scenes targeted — full rewrite
              const enqueueResult = await sceneRewrite.enqueue(selectedDocId, selectedVersionId, enrichedNotes, protectItems);
              if (enqueueResult) {
                sceneRewrite.processAll(selectedVersionId);
              }
            }
          } else {
            // Scope plan failed, fall back to full rewrite
            const enqueueResult = await sceneRewrite.enqueue(selectedDocId, selectedVersionId, enrichedNotes, protectItems);
            if (enqueueResult) {
              sceneRewrite.processAll(selectedVersionId);
            }
          }
        } else {
          if (selectedDocId && selectedVersionId) {
            const enqueueResult = await sceneRewrite.enqueue(selectedDocId, selectedVersionId, enrichedNotes, protectItems);
            if (enqueueResult) {
              sceneRewrite.processAll(selectedVersionId);
            }
          }
        }
      } else {
        rewritePipeline.startRewrite(selectedDocId, selectedVersionId, enrichedNotes, protectItems, provenance);
      }
      afterRewrite();
    } else {
      // Build selectedOptions for the edge function so it gets crisp decision directives
      // (especially custom "Other" directions — these go into SELECTED DECISION OPTIONS block)
      const selectedOptionsForRewrite = decisions
        ? Object.entries(decisions)
            .filter(([, v]) => !!v)
            .map(([noteId, optionId]) => ({
              note_id: noteId,
              option_id: optionId,
              custom_direction: notesCustomDirections[noteId] || undefined,
            }))
        : undefined;

      rewrite.mutate({
        approvedNotes: enrichedNotes,
        protectItems,
        deliverableType: selectedDeliverableType,
        developmentBehavior: projectBehavior,
        format: projectFormat,
        selectedOptions: selectedOptionsForRewrite,
        globalDirections: globalDirections || [],
      }, {
        onSuccess: afterRewrite,
        onError: (err: any) => {
          // Auto-redirect to chunked pipeline if server says document is too long
          if (err?.needsPipeline && selectedDocId && selectedVersionId) {
            console.log(`[ui] needsPipeline fallback: single-pass rejected (${err.charCount} chars), redirecting to chunked pipeline`);
            toast.info('Document too large for single-pass — using chunked rewrite pipeline.');
            rewritePipeline.startRewrite(selectedDocId, selectedVersionId, enrichedNotes, protectItems);
            afterRewrite();
          } else {
            toast.error(err?.message || 'Rewrite failed');
          }
        },
      });
    }
  };

  const handlePromote = () => {
    // PATCH A — always use authoritative version, never stale selectedVersionId
    const promoteVersionId = effectiveVersionId;
    if (!promoteVersionId) {
      toast.error('Select a version before promoting');
      return;
    }
    if (hasUnresolvedMajorDrift) {
      setDriftOverrideOpen(true);
      return;
    }
    // PIPELINE AUTHORITY: use Pipeline Brain exclusively, never fall back to LLM output
    const promoteTarget = promotionIntel.data?.next_document;
    // Use promotion-gate-bound analysis, not selected-version-scoped latestAnalysis
    const gateAnalysis = promotionGateAnalysis || latestAnalysis;
    // DB meta_json is source of truth; analysis is fallback only
    const metaCi = ((authoritativeVersion as any)?.meta_json as any)?.ci ?? null;
    const metaGp = ((authoritativeVersion as any)?.meta_json as any)?.gp ?? null;
    const analysisCi = gateAnalysis?.ci_score ?? gateAnalysis?.scores?.ci ?? null;
    const analysisGp = gateAnalysis?.gp_score ?? gateAnalysis?.scores?.gp ?? null;
    const promoteCi = (typeof metaCi === 'number') ? metaCi : analysisCi;
    const promoteGp = (typeof metaGp === 'number') ? metaGp : analysisGp;
    const isApprovedAndHighConfidence = authoritativeVersion?.approval_status === 'approved'
      && typeof promoteCi === 'number'
      && typeof promoteGp === 'number'
      && promoteCi >= 85
      && promoteGp >= 85;

    // Approved + high-score manual override: allow deterministic adjacent promotion
    // even if local note-derived gates are stale/noisy.
    const approvedOverrideTarget = !promoteTarget && isApprovedAndHighConfidence
      ? getNextStage(selectedDeliverableType, projectFormat)
      : null;

    const nextBestDocument = promoteTarget || approvedOverrideTarget;
    console.log(`[ui][IEL] promotion_source_of_truth { project_id: "${projectId}", format: "${projectFormat}", from_doc: "${selectedDeliverableType}", to_doc: "${nextBestDocument || 'null'}", recommendation: "${promotionIntel.data?.recommendation || 'none'}", readiness: ${promotionIntel.data?.readiness_score ?? 'N/A'}, approved_override: ${approvedOverrideTarget ? 'true' : 'false'}, promote_ci: ${promoteCi ?? 'N/A'}, promote_gp: ${promoteGp ?? 'N/A'}, effective_version_id: "${promoteVersionId}", authoritative_version_id: "${authoritativeVersion?.id || 'none'}", selected_version_id: "${selectedVersionId || 'none'}" }`);
    if (!promotionIntel.data && !approvedOverrideTarget) {
      toast.error('Run a review first before promoting');
      return;
    }
    if (!nextBestDocument) {
      // Provide actionable feedback based on recommendation
      const rec = promotionIntel.data?.recommendation;
      const reasons = promotionIntel.data?.reasons?.slice(0, 2).join('. ') || '';
      if (rec === 'stabilise') {
        toast.error(`Cannot promote yet — stabilisation needed. ${reasons}`);
      } else if (rec === 'escalate') {
        toast.error(`Cannot promote — escalation required. ${reasons}`);
      } else {
        toast.error(`No valid next stage found for promotion. ${reasons}`);
      }
      return;
    }
    // Lane gate: block conversion to feature_script for non-feature lanes
    const lane = project?.assigned_lane;
    if (nextBestDocument === 'feature_script' && lane && !['feature_film', 'animation', 'short', 'unspecified'].includes(lane)) {
      toast.error(`"Feature Script" is not available for ${lane.replace(/_/g, ' ')} projects`);
      return;
    }
    setSelectedDeliverableType(nextBestDocument as DeliverableType);
    convert.mutate({ targetOutput: nextBestDocument.toUpperCase(), protectItems: gateAnalysis?.protect });
  };

  const handleSkipStage = () => {
    if (!selectedVersionId) {
      toast.error('Select a version before promoting');
      return;
    }
    // PIPELINE AUTHORITY: use Pipeline Brain exclusively
    const skipTarget = promotionIntel.data?.next_document;
    setPendingStageAction(() => () => {
      if (skipTarget) {
        setSelectedDeliverableType(skipTarget as DeliverableType);
        convert.mutate({ targetOutput: skipTarget.toUpperCase(), protectItems: latestAnalysis?.protect });
      }
    });
    setSoftGateOpen(true);
  };

  const versionText = selectedVersion?.plaintext || selectedDoc?.plaintext || selectedDoc?.extracted_text || '';

  const [editableText, setEditableText] = useState(versionText);
  const [isSavingText, setIsSavingText] = useState(false);
  useEffect(() => { setEditableText(versionText); }, [versionText]);
  const qcRef = useQueryClient();
  const saveEditedText = useCallback(async () => {
    if (!selectedVersionId || editableText === versionText) return;
    setIsSavingText(true);
    try {
      // Fetch previous plaintext before overwriting
      let previousPlaintext: string | null = null;
      let previousVersionId: string | null = null;
      if (selectedDoc && isScriptDocType(selectedDoc.doc_type)) {
        const { data: prevVer } = await (supabase as any)
          .from('project_document_versions')
          .select('id, plaintext')
          .eq('id', selectedVersionId)
          .maybeSingle();
        if (prevVer?.plaintext && prevVer.plaintext !== editableText) {
          previousPlaintext = prevVer.plaintext;
          previousVersionId = prevVer.id;
        }
      }

      const { error } = await (supabase as any)
        .from('project_document_versions')
        .update({ plaintext: editableText })
        .eq('id', selectedVersionId);
      if (error) throw error;
      toast.success('Saved');
      qcRef.invalidateQueries({ queryKey: ['dev-v2-versions', selectedDocId] });

      // Trigger deterministic script change derivatives
      if (selectedDoc && isScriptDocType(selectedDoc.doc_type) && projectId) {
        const { data: { user } } = await supabase.auth.getUser();
        const existingDocTypes = documents.map(d => d.doc_type);
        deriveScriptChangeArtifacts({
          projectId,
          sourceDocId: selectedDocId!,
          sourceDocType: selectedDoc.doc_type,
          newVersionId: selectedVersionId,
          newPlaintext: editableText,
          previousPlaintext,
          previousVersionId,
          actorUserId: user?.id || '',
          existingDocTypes,
        }).then(() => {
          qcRef.invalidateQueries({ queryKey: ['change-report', projectId, selectedDocId] });
        }).catch(() => { /* non-fatal */ });
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setIsSavingText(false);
    }
  }, [selectedVersionId, editableText, versionText, selectedDocId, qcRef]);

  const analysisConvergence = latestAnalysis?.convergence;
  const isAnalysisConverged = analysisConvergence?.status === 'converged' || convergenceStatus === 'Converged';
  // PIPELINE AUTHORITY: nextBestDocument MUST come from Pipeline Brain (promotionIntel),
  // NOT from LLM analysis output. The LLM's convergence.next_best_document is unreliable
  // and can suggest stages that skip the ladder (e.g. concept_brief → episode_beats).
  const nextBestDocument = promotionIntel.data?.next_document ?? null;
  const verticalDramaGating = analysisConvergence?.vertical_drama_gating || null;
  // IEL: log if LLM suggestion disagrees with Pipeline Brain
  const llmNextBest = analysisConvergence?.next_best_document;
  if (llmNextBest && nextBestDocument && llmNextBest !== nextBestDocument) {
    console.warn(`[ui][IEL] promotion_alt_source_ignored { source: "llm_convergence", suggested: "${llmNextBest}", enforced: "${nextBestDocument}", current_doc: "${selectedDeliverableType}", format: "${projectFormat}" }`);
  }

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

   // Approve version mutation
  const [approvePending, setApprovePending] = useState(false);
  const handleApproveVersion = async () => {
    if (!projectId || !selectedVersionId) {
      toast.error('Select a version first');
      return;
    }
    setApprovePending(true);
    try {
      await approveAndActivate({
        projectId,
        documentVersionId: selectedVersionId,
        sourceFlow: 'dev_engine',
      });
      toast.success('Version approved & activated in Active Folder');
      qc.invalidateQueries({ queryKey: ['active-folder', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-versions', selectedDocId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-approved', projectId] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    } finally {
      setApprovePending(false);
    }
  };

  // Unapprove version mutation
  const [unapproving, setUnapproving] = useState(false);
  const handleUnapproveVersion = async () => {
    if (!projectId || !selectedVersionId) return;
    setUnapproving(true);
    try {
      await unapproveVersion({
        projectId,
        documentVersionId: selectedVersionId,
      });
      toast.success('Version unapproved');
      qc.invalidateQueries({ queryKey: ['active-folder', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-versions', selectedDocId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-approved', projectId] });
      qc.invalidateQueries({ queryKey: ['project-package', projectId] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to unapprove');
    } finally {
      setUnapproving(false);
    }
  };

  const resolutionSummary = latestNotes?.resolution_summary;
  const stabilityStatus = latestNotes?.stability_status || latestAnalysis?.stability_status;

  // ── Project not found guard — avoids blank screen on stale/deleted project IDs ──
  if (project === null) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-sm">This project no longer exists or you don't have access.</p>
        <Link to="/projects" className="text-primary text-sm underline underline-offset-2">← Back to Projects</Link>
      </div>
    );
  }

  return (
    <>
    <div className="max-w-[1800px] mx-auto px-4 py-4 space-y-3">

      {/* ═══ ENGINE BAR — canonical source of truth ═══ */}
      <EngineBar
        job={autoRun.job}
        isRunning={autoRun.isRunning}
        uiMode={viewMode}
        onToggleMode={handleToggleMode}
        executionMode={effectiveExecutionMode}
        onSetExecutionMode={(mode: ExecutionMode) => {
          setLocalExecutionMode(mode);
          if (autoRun.job?.id) {
            const allowDefaults = mode === 'full_autopilot' || mode === 'assisted';
            autoRun.toggleAllowDefaults?.(allowDefaults);
          }
        }}
        onPause={autoRun.pause}
        onResume={() => autoRun.resume?.()}
        onStop={autoRun.stop}
      />

      {/* ═══ CONTEXT BADGES ═══ */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={`text-[10px] ${BEHAVIOR_COLORS[projectBehavior]}`}>
          {BEHAVIOR_LABELS[projectBehavior]}
        </Badge>
        <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground">
          {normalizedFormat}
        </Badge>
        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
          {getDeliverableLabel(selectedDeliverableType, normalizedFormat)}
        </Badge>
        {searchParams.get('source') === 'series-writer' && (
          <Link
            to={`/projects/${projectId}/series-writer${searchParams.get('ep') ? `?ep=${searchParams.get('ep')}` : ''}`}
          >
            <Badge variant="outline" className="text-[10px] gap-1 cursor-pointer hover:bg-primary/10 border-primary/30 text-primary">
              <ArrowRight className="h-3 w-3 rotate-180" /> Return to Series Writer
              {searchParams.get('ep') && ` (EP ${searchParams.get('ep')})`}
            </Badge>
          </Link>
        )}
        <DocAssistantDrawer
          projectId={projectId}
          selectedDocType={selectedDoc?.doc_type}
          selectedVersionId={selectedVersionId || undefined}
          selectedVersionText={versionText}
          onVersionCreated={(vid) => setSelectedVersionId(vid)}
        />
      </div>

      {/* ═══ SIMPLE MODE / ADVANCED MODE ═══ */}
      {viewMode === 'simple' ? (
        <>
        {/* ═══ CLEAN MODE: Simplified workspace with EngineBar + document + decisions only when blocked ═══ */}
        <DevEngineSimpleView
          projectId={projectId!}
          projectTitle={(project as any)?.title || ''}
          format={normalizedFormat}
          documents={documents}
          docsLoading={docsLoading}
          approvedVersionMap={approvedVersionMap}
          selectedDocId={selectedDocId}
          selectedVersionId={selectedVersionId}
          versionText={versionText}
          selectDocument={selectDocument}
          setSelectedVersionId={setSelectedVersionId}
          autoRunJob={autoRun.job}
          autoRunSteps={autoRun.steps}
          autoRunIsRunning={autoRun.isRunning}
          autoRunConnectionState={autoRun.connectionState}
          autoRunError={autoRun.error}
          autoRunActivated={autoRun.activated}
          seedDocs={seedStatus.docs}
          seedLoading={seedStatus.isLoading}
        />

        {/* World Rules — shown in Simple mode when comparables exist or rulesetUserId available */}
        {rulesetUserId && projectId && (
          <WorldRulesAccordion projectId={projectId} lane={rulesetLane} userId={rulesetUserId} />
        )}

        {/* Decision surface — only shown when engine is BLOCKED in clean mode */}
        {autoRun.job?.awaiting_approval && (() => {
          const jobHasDecisions = Array.isArray(autoRun.job?.pending_decisions) && (autoRun.job!.pending_decisions as any[]).length > 0;
          if (!jobHasDecisions) return null;
          const decisions = (autoRun.job!.pending_decisions as any[]).map((d: any) => {
            const missingFields: string[] = [];
            if (!d.question) missingFields.push('question');
            if (!Array.isArray(d.options) || d.options.length === 0) missingFields.push('options');
            if (missingFields.length > 0) {
              console.warn('[ui][IEL] blocking_decision_rendered', {
                job_id: autoRun.job?.id, doc_type: autoRun.job?.current_document,
                decision_id: d.id, decision_key: d.decision_key,
                missing_fields: missingFields,
              });
            }
            return {
              note_id: d.id,
              severity: d.impact === 'blocking' ? 'blocker' as const : 'high' as const,
              note: d.question || d.reason || d.decision_key || 'Decision required',
              options: (Array.isArray(d.options) ? d.options : []).map((o: any) => ({
                option_id: o.value || o.option_id || o.label || 'unknown',
                title: o.label || o.value || o.title || 'Option',
                what_changes: [o.why || o.label || o.value || ''].filter(Boolean),
              })),
              recommended_option_id: typeof d.recommended === 'object' && d.recommended !== null ? d.recommended.value : d.recommended,
              decision_key: d.decision_key,
              source: d.source,
            };
          });
          return (
            <DecisionModePanel
              projectId={projectId!}
              documentId={selectedDocId}
              versionId={selectedVersionId}
              documentText={versionText}
              docType={selectedDoc?.doc_type}
              versionNumber={selectedVersion?.version_number}
              updatedAt={selectedVersion?.created_at}
              decisions={decisions}
              globalDirections={[]}
              jobId={autoRun.job?.id}
              isAutoRunPaused={autoRun.job?.status === 'paused'}
              onRewriteComplete={() => {
                invalidateDevEngine(qc, { projectId, docId: selectedDocId, versionId: selectedVersionId, deep: true });
              }}
              onAutoRunContinue={(opts, gd) => autoRun.applyDecisionsAndContinue?.(opts, gd)}
              availableVersions={versions?.map((v: any) => ({ id: v.id, version_number: v.version_number, label: v.label }))}
              hideApplyButton={!autoRun.job?.id}
            />
          );
        })()}
        </>
      ) : (
      <div data-devengine-advanced-wrapper>
      {/* ═══ SEED APPLIED BANNER ═══ */}
      {seedDraft && projectId && rulesetUserId && (
        <SeedAppliedBanner
          projectId={projectId}
          userId={rulesetUserId}
          lane={rulesetLane}
          seedDraft={seedDraft}
          historyLen={seedHistoryLen}
          docs={documents}
          onSelectDoc={selectDocument}
          prefsExist={lanePrefsExist}
          onPrefsApplied={() => refetchLanePrefs()}
        />
      )}

      {/* ═══ PROJECT AUTOPILOT PANEL ═══ */}
      {projectId && (
        <AutopilotPanel
          projectId={projectId}
          pitchIdeaId={project?.source_pitch_idea_id}
          lane={project?.assigned_lane || null}
          format={normalizedFormat || null}
          documents={documents?.map((d: any) => ({ id: d.id, doc_type: d.doc_type })) || []}
          approvedVersionMap={approvedVersionMap as Record<string, any>}
          onSelectDocument={selectDocument}
          externalAutoRunJob={autoRun.job}
        />
      )}

      {/* ═══ STYLE SOURCES ═══ */}
      {projectId && rulesetUserId && (
        <StyleSourcesPanel
          projectId={projectId}
          userId={rulesetUserId}
          lane={rulesetLane}
          activeText={versionText}
        />
      )}

          {/* ═══ CONNECTIVITY STATUS ═══ */}
          {projectId && (() => {
            const pkgData = packageStatusData;
            if (!pkgData) return null;
            const staleTypes = pkgData.filter((d: any) => d.status === 'stale').map((d: any) => d.docType);
            const versionedDocs = pkgData.filter((d: any) => d.latestVersionId);
            const criteriaLinkedCount = versionedDocs.filter((d: any) => d.criteriaConnected).length;
            const provenanceKnownCount = versionedDocs.filter((d: any) => d.provenanceKnown).length;
            const totalVersioned = versionedDocs.length;
            return (
              <ConnectivityBanner
                projectId={projectId}
                currentResolverHash={currentResolverHash}
                staleDocCount={staleTypes.length}
                staleDocTypes={staleTypes}
                totalDocs={totalVersioned}
                criteriaLinkedDocs={criteriaLinkedCount}
                provenanceKnownDocs={provenanceKnownCount}
                isAutopilotActive={autoRun.isRunning || (autoRun.job?.status === 'running')}
              />
            );
          })()}

          {/* ═══ PIPELINE ═══ */}
          <DeliverablePipeline stageStatuses={pipelineStatuses} activeDeliverable={selectedDeliverableType}
            onStageClick={(dt) => setSelectedDeliverableType(dt)} isVerticalDrama={isVerticalDrama} projectFormat={normalizedFormat} />

          {/* ═══ STAGE PLAN PANEL (drift verification) ═══ */}
          {(project as any)?.format && (
            <StagePlanPanel
              projectFormat={(project as any).format}
              currentDocType={selectedDeliverableType || undefined}
              existingDocTypes={documents.map(d => d.doc_type)}
            />
          )}

          {/* ═══ 2-COLUMN FLEX LAYOUT ═══ */}
          <div className="flex flex-col md:flex-row gap-3">

            {/* ── LEFT: Documents (self-sizing via DocumentSidebar) ── */}
            <div className="shrink-0">
              <DocumentSidebar
                documents={documents} docsLoading={docsLoading}
                selectedDocId={selectedDocId} selectDocument={selectDocument}
                deleteDocument={deleteDocument} deleteVersion={deleteVersion} versions={versions}
                selectedVersionId={selectedVersionId} setSelectedVersionId={setSelectedVersionId}
                createPaste={createPaste}
                latestVersionMap={latestVersionMap}
                approvedVersionMap={approvedVersionMap}
                projectTitle={(project as any)?.title || ''}
                format={normalizedFormat}
                onOpenPackage={() => setIntelligenceTab('package')}
                projectId={projectId}
              />

              {/* Script Pipeline removed — feature scripts are generated via Auto-Run */}
            </div>

            {/* ── CENTER: Workspace ── */}
            <div className="flex-1 min-w-0 space-y-3" style={{ minHeight: 'calc(100vh - 280px)' }}>
              {/* Auto-Run Banner */}
              {autoRun.activated && autoRun.job && !['completed'].includes(autoRun.job.status) && (
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
                  onClear={autoRun.clear}
                   onScrollToApproval={() => {
                     const jobHasDecisions = Array.isArray(autoRun.job?.pending_decisions) && (autoRun.job!.pending_decisions as any[]).length > 0;
                     if (jobHasDecisions) {
                       setIntelligenceTab('notes');
                       setTimeout(() => {
                         const el = document.getElementById('decision-panel-anchor');
                         el?.scrollIntoView({ behavior: 'smooth' });
                       }, 100);
                     } else {
                       setIntelligenceTab('convergence');
                       setTimeout(() => {
                         const el = document.getElementById('approval-queue-anchor');
                         el?.scrollIntoView({ behavior: 'smooth' });
                       }, 100);
                     }
                   }}
                   onScrollToCriteria={() => {
                     setIntelligenceTab('criteria');
                     setTimeout(() => {
                       const el = document.getElementById('criteria-panel');
                       el?.scrollIntoView({ behavior: 'smooth' });
                     }, 100);
                   }}
                />
              )}
              {!selectedDocId ? (
                <Card className="h-full flex items-center justify-center min-h-[400px]">
                  <div className="text-center space-y-4 p-8 max-w-sm">
                    <Sparkles className="h-8 w-8 text-primary mx-auto" />
                    <p className="text-sm text-muted-foreground">No documents yet — start by creating an idea</p>
                    <Button size="sm" className="gap-1.5" onClick={() => {
                      createPaste.mutate({ title: 'New Idea', docType: 'idea', text: '## Idea\n\nDescribe your concept here…' });
                    }} disabled={createPaste.isPending}>
                      {createPaste.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Create New Idea
                    </Button>
                    <p className="text-[10px] text-muted-foreground">Or use the <strong>+ New</strong> button in the sidebar to paste existing material</p>
                  </div>
                </Card>
              ) : (
                <>
                  {/* Version badge + style meta */}
                  {selectedVersion && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1">
                        <GitBranch className="h-2.5 w-2.5" />
                        v{selectedVersion.version_number}
                        {selectedVersion.label ? ` · ${selectedVersion.label}` : ''}
                      </Badge>
                      {(selectedVersion as any)?.meta_json?.style_benchmark && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-1">
                          Style: {(selectedVersion as any).meta_json.style_benchmark}
                        </Badge>
                      )}
                      {(selectedVersion as any)?.meta_json?.pacing_feel && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-1">
                          Pacing: {(selectedVersion as any).meta_json.pacing_feel}
                        </Badge>
                      )}
                      {(selectedVersion as any)?.meta_json?.lane && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 text-muted-foreground">
                          {(selectedVersion as any).meta_json.lane}
                        </Badge>
                      )}
                      {/* Style score badge */}
                      {(selectedVersion as any)?.meta_json && (
                        <StyleScoreBadge metaJson={(selectedVersion as any).meta_json} />
                      )}
                    </div>
                  )}

                  {/* Style eval panel */}
                  {selectedVersion && projectId && selectedDoc && (
                    <StyleEvalPanel
                      projectId={projectId}
                      documentId={selectedDoc.id}
                      metaJson={(selectedVersion as any)?.meta_json}
                    />
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
                      seasonEpisodeCount={resolvedQuals?.season_episode_count || effectiveSeasonEpisodes || undefined}
                      onRegenerate={handleStaleRegenerate}
                      isRegenerating={false}
                    />
                  )}

                  {/* Episode handoff banner */}
                  {activeHandoffForDoc && (
                    <EpisodeHandoffBanner
                      handoffId={activeHandoffForDoc.id}
                      episodeNumber={activeHandoffForDoc.episode_number}
                      issueTitle={activeHandoffForDoc.issue_title}
                      versions={versions.map(v => ({
                        id: v.id,
                        version_number: v.version_number,
                        change_summary: v.change_summary,
                        created_at: v.created_at,
                      }))}
                      onReturn={(hId, vId) => episodeHandoff.returnToSeriesWriter.mutate({ handoffId: hId, versionId: vId })}
                      onCancel={(hId) => episodeHandoff.cancelHandoff.mutate(hId)}
                      isReturning={episodeHandoff.returnToSeriesWriter.isPending}
                      isCancelling={episodeHandoff.cancelHandoff.isPending}
                    />
                  )}

                  {/* World Rules */}
                  {rulesetUserId && (
                    <WorldRulesAccordion projectId={projectId!} lane={rulesetLane} userId={rulesetUserId} />
                  )}

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
                    rewritePending={rewrite.isPending || rewritePipeline.status !== 'idle' || sceneRewrite.mode === 'processing' || sceneRewrite.mode === 'enqueuing'}
                    convertPending={convert.isPending}
                    generateNotesPending={generateNotes.isPending}
                    verticalDramaGating={verticalDramaGating}
                    isVerticalDrama={isVerticalDrama}
                    currentDocType={selectedDoc?.doc_type}
                    seasonEpisodeCount={effectiveSeasonEpisodes ?? undefined}
                    onBeatSheetToScript={(epNum) => beatSheetToScript.mutate({ episodeNumber: epNum, seasonEpisodeCount: effectiveSeasonEpisodes ?? undefined })}
                    beatSheetToScriptPending={beatSheetToScript.isPending}
                    nextAction={promotionIntel.data?.next_action}
                    onApproveVersion={selectedVersionId ? handleApproveVersion : undefined}
                    onUnapproveVersion={selectedVersionId ? handleUnapproveVersion : undefined}
                    approvePending={approvePending}
                    unapproving={unapproving}
                    isVersionApproved={selectedVersion?.approval_status === 'approved'}
                    autoReviewEnabled={autoReviewEnabled}
                    onAutoReviewToggle={setAutoReviewEnabled}
                    format={normalizedFormat}
                    assignedLane={project?.assigned_lane}
                    onGenerateDocument={handleGenerateDocument}
                    generateDocumentPending={isGeneratingDocument}
                    isBgGenerating={isBgGenerating}
                  />

                  {/* Resume auto-run handled by banner above */}

                  {/* Progress indicators */}
                  <OperationProgress isActive={analyze.isPending} stages={DEV_ANALYZE_STAGES} onStop={() => analyze.reset()} onRestart={handleRunEngine} />
                  <OperationProgress isActive={generateNotes.isPending} stages={DEV_NOTES_STAGES} onStop={() => generateNotes.reset()} onRestart={() => generateNotes.mutate(latestAnalysis)} />
                  <OperationProgress isActive={rewrite.isPending} stages={DEV_REWRITE_STAGES} onStop={() => rewrite.reset()} onRestart={() => handleRewrite()} />
                  <OperationProgress isActive={isBgGenerating || isGeneratingDocument} stages={DEV_GENERATE_STAGES} stallTimeoutMs={300_000} />
                  <OperationProgress isActive={convert.isPending} stages={DEV_CONVERT_STAGES} onStop={() => convert.reset()} onRestart={() => {
                    // PIPELINE AUTHORITY: use Pipeline Brain (promotionIntel), never LLM output
                    const nbd = promotionIntel.data?.next_document;
                    const llmNbd = latestAnalysis?.convergence?.next_best_document;
                    if (llmNbd && nbd && llmNbd !== nbd) {
                      console.warn(`[ui][IEL] promotion_alt_source_ignored { source: "llm_convergence", suggested: "${llmNbd}", enforced: "${nbd}" }`);
                    }
                    if (nbd) convert.mutate({ targetOutput: nbd.toUpperCase(), protectItems: latestAnalysis?.protect });
                  }} />
                  {/* Chunk rewrite progress with ProcessProgressBar */}
                  {rewritePipeline.status !== 'idle' && rewritePipeline.status !== 'complete' && (
                    <div className="p-2 rounded-lg border bg-muted/30 space-y-2">
                      <ProcessProgressBar
                        percent={rewritePipeline.smoothedPercent}
                        actualPercent={rewritePipeline.progress.percent}
                        phase={rewritePipeline.progress.phase}
                        label={rewritePipeline.progress.label}
                        etaMs={rewritePipeline.etaMs}
                        status={
                          rewritePipeline.status === 'error' ? 'error' : 'working'
                        }
                      />
                      <div className="flex gap-0.5 justify-end">
                        {rewritePipeline.status !== 'error' && (
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => rewritePipeline.reset()} title="Stop">
                            <Square className="h-3 w-3" />
                          </Button>
                        )}
                        {rewritePipeline.status === 'error' && (
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { rewritePipeline.reset(); handleRewrite(); }} title="Restart">
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      {/* Chunk activity timeline */}
                      {rewritePipeline.activityItems.length > 0 && (
                        <ActivityTimeline items={rewritePipeline.activityItems} onClear={rewritePipeline.clearActivity} />
                      )}
                    </div>
                  )}
                  {/* Scene-level rewrite panel */}
                  {sceneRewrite.total > 0 && selectedDocId && selectedVersionId && (
                    <SceneRewritePanel
                      projectId={projectId!}
                      documentId={selectedDocId}
                      versionId={selectedVersionId}
                      approvedNotes={[]}
                      protectItems={[]}
                      pipelineInstance={sceneRewrite}
                      onComplete={(newVersionId) => {
                        postOperationVersionId.current = newVersionId;
                        setSelectedVersionId(newVersionId);
                        sceneRewrite.reset();
                      }}
                    />
                  )}

                   {/* Document content — editable */}
                   <Card>
                     <CardContent className="p-4">
                          {isBgGenerating ? (
                            selectedVersionId ? (
                              <BgGenBanner
                                versionId={selectedVersionId}
                                episodeCount={(selectedVersion as any)?.meta_json?.episode_count}
                                docType={selectedDoc?.doc_type}
                                onAllChunksDone={handleAllChunksDone}
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center h-[300px] gap-3 text-muted-foreground">
                                <Loader2 className="h-6 w-6 animate-spin" />
                                <p className="text-sm text-center max-w-sm">
                                  Generating content — this may take a few minutes. The page will update automatically when ready.
                                </p>
                              </div>
                            )
                          ) : (<>
                            <FormattedDocContent
                              text={editableText}
                              editable={true}
                              onChange={setEditableText}
                              className="w-full h-[300px] text-sm text-foreground whitespace-pre-wrap font-body leading-relaxed bg-transparent border-none outline-none resize-none focus:ring-0"
                            />
                            {editableText !== versionText && (
                              <div className="flex justify-end mt-2">
                                <Button size="sm" variant="outline" className="mr-2 text-xs" onClick={() => setEditableText(versionText)}>
                                  Discard
                                </Button>
                                <Button size="sm" className="text-xs" onClick={saveEditedText} disabled={isSavingText}>
                                  {isSavingText ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                  Save
                                </Button>
                              </div>
                            )}
                           </>)}
                     </CardContent>
                   </Card>

                  {versionText && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* Export document */}
                      <DocumentExportDropdown
                        text={versionText}
                        title={getDocDisplayName((project as any)?.title, selectedDoc?.doc_type)}
                      />
                      {/* Set / Unset Season Template — available for series formats */}
                      {(isSeriesFormat || isVerticalDrama) && (() => {
                        const isActiveTemplate = (project as any)?.season_style_template_version_id === selectedVersionId;
                        if (isActiveTemplate) {
                          return (
                            <ConfirmDialog
                              title="Remove Season Template?"
                              description="This will clear the style benchmark. Future generations will not be constrained by this template."
                              confirmLabel="Remove Template"
                              onConfirm={() => seasonTemplate.unsetTemplate.mutate()}
                            >
                              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-primary text-primary"
                                disabled={seasonTemplate.unsetTemplate.isPending}>
                                {seasonTemplate.unsetTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
                                Season Template (Active) — Click to Remove
                              </Button>
                            </ConfirmDialog>
                          );
                        }
                        return (
                          <ConfirmDialog
                            title="Set as Season Template (Style Benchmark)?"
                            description="This sets tone/pacing/quality constraints for generation. It does not change document type or promote to script."
                            confirmLabel="Set as Season Template"
                            onConfirm={() => seasonTemplate.setTemplate.mutate({
                              docType: selectedDoc?.doc_type || '',
                              versionId: selectedVersionId || '',
                              versionText,
                            })}
                          >
                            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
                              disabled={seasonTemplate.setTemplate.isPending}>
                              {seasonTemplate.setTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
                              Set as Season Template (Style Benchmark)
                            </Button>
                          </ConfirmDialog>
                        );
                      })()}

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
                             description={`Register "${getDocDisplayName((project as any)?.title, selectedDoc?.doc_type)}" as the project's current script draft. This creates a script record.`}
                             confirmLabel="Publish as Script"
                             onConfirm={() => setAsDraft.mutate({
                               title: getDocDisplayName((project as any)?.title, selectedDoc?.doc_type),
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

          <Tabs value={intelligenceTab} onValueChange={setIntelligenceTab} className="w-full">
             <TabsList className="w-full justify-start bg-muted/30 border border-border/50 h-9 flex-wrap">
              <TabsTrigger value="notes" className="text-xs">Notes & Feedback</TabsTrigger>
              <TabsTrigger value="issues" className="text-xs flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" />
                Issues
              </TabsTrigger>
              <TabsTrigger value="convergence" className="text-xs">Convergence</TabsTrigger>
              <TabsTrigger value="qualifications" className="text-xs">Qualifications</TabsTrigger>
              <TabsTrigger value="autorun" className="text-xs">Auto-Run</TabsTrigger>
              {(isVerticalDrama || isSeriesFormat) && (
                <TabsTrigger value="series-scripts" className="text-xs">Season Scripts</TabsTrigger>
              )}
              <TabsTrigger value="criteria" className="text-xs">Criteria</TabsTrigger>
              <TabsTrigger value="package" className="text-xs">Package</TabsTrigger>
              <TabsTrigger value="canon" className="text-xs">Canon</TabsTrigger>
              <TabsTrigger value="provenance" className="text-xs">Provenance</TabsTrigger>
               <TabsTrigger value="scenes" className="text-xs">Scenes</TabsTrigger>
               <TabsTrigger value="quality" className="text-xs">Quality</TabsTrigger>
               <TabsTrigger value="docsets" className="text-xs">Doc Sets</TabsTrigger>
               {convergenceHistory.length > 0 && (
                 <TabsTrigger value="timeline" className="text-xs">Timeline ({convergenceHistory.length})</TabsTrigger>
               )}
             </TabsList>

            <TabsContent value="notes" className="mt-3 space-y-3">
              {/* Next Actions Panel */}
              {projectId && (
                <NextActionsPanel
                  notes={canonicalNotes}
                  currentDocType={selectedDoc?.doc_type}
                  currentDocumentId={selectedDocId || undefined}
                  projectId={projectId}
                  onOpenNote={(note) => {
                    setNextActionNoteId(note.id);
                    setNextActionDrawerOpen(true);
                  }}
                />
              )}
              {/* Decisions first, full width */}
              {(() => {
                const optionsRun = (runs || []).filter((r: any) => r.run_type === 'OPTIONS').sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || '')).pop();
                const optionsRunHasDecisions = (optionsRun?.output_json?.decisions?.length > 0);
                const jobHasDecisions = enrichedPending.decisions.length > 0 && autoRun.job?.pause_reason === 'pending_decisions';
                const hasNoteDecisions = tieredNotes.blockers.some((n: any) => n.decisions?.length > 0) || tieredNotes.high.some((n: any) => n.decisions?.length > 0);
                const showPanel = optionsRunHasDecisions || jobHasDecisions || hasNoteDecisions
                  || tieredNotes.blockers.length > 0 || tieredNotes.high.length > 0
                  || (autoRun.job?.status === 'paused' && autoRun.job?.stop_reason?.includes('Decisions'));

                if (!showPanel) return null;

                // Build decisions: prefer job.pending_decisions (enriched), then OPTIONS run, then inline note decisions
                const decisions = (() => {
                  if (jobHasDecisions) {
                    return normalizeDecisionsForUI(
                      enrichedPending.decisions as any[],
                      'project-development-engine:job_pending_decisions'
                    ) as Decision[];
                  }
                  if (optionsRunHasDecisions) {
                    return normalizeDecisionsForUI(
                      optionsRun.output_json.decisions || [],
                      'project-development-engine:options_run'
                    ) as Decision[];
                  }
                  const noteDecisions: Decision[] = [
                    ...tieredNotes.blockers.filter((n: any) => n.decisions?.length > 0).map((n: any) => ({
                      note_id: n.id || n.note_key, severity: 'blocker' as const, note: n.description || n.note,
                      options: n.decisions, recommended_option_id: n.recommended_option_id || n.recommended,
                    })),
                    ...tieredNotes.high.filter((n: any) => n.decisions?.length > 0).map((n: any) => ({
                      note_id: n.id || n.note_key, severity: 'high' as const, note: n.description || n.note,
                      options: n.decisions, recommended_option_id: n.recommended_option_id || n.recommended,
                    })),
                  ];
                  return normalizeDecisionsForUI(noteDecisions as any[], 'project-development-engine:inline_note_decisions') as Decision[];
                })();

                return (
                  <DecisionModePanel
                    projectId={projectId!}
                    documentId={selectedDocId}
                    versionId={selectedVersionId}
                    documentText={versionText}
                    docType={selectedDoc?.doc_type}
                    versionNumber={selectedVersion?.version_number}
                    updatedAt={selectedVersion?.created_at}
                    decisions={decisions}
                    globalDirections={(() => {
                      const oRun = (runs || []).filter((r: any) => r.run_type === 'OPTIONS').pop();
                      return oRun?.output_json?.global_directions || latestNotes?.global_directions || [];
                    })()}
                    jobId={autoRun.job?.id}
                    isAutoRunPaused={autoRun.job?.status === 'paused'}
                    onRewriteComplete={() => {
                      invalidateDevEngine(qc, { projectId, docId: selectedDocId, versionId: selectedVersionId, deep: true });
                    }}
                    onAutoRunContinue={(opts, gd) => autoRun.applyDecisionsAndContinue?.(opts, gd)}
                    availableVersions={versions?.map((v: any) => ({ id: v.id, version_number: v.version_number, label: v.label }))}
                    hideApplyButton={!autoRun.job?.id}
                  />
                );
              })()}

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
                    deferredNotes={deferredNotes}
                    persistedDeferredNotes={deferred.deferredNotes}
                    onPinDeferred={(id) => deferred.pinNote.mutate(id)}
                    onUnpinDeferred={(id) => deferred.unpinNote.mutate(id)}
                    onDismissDeferred={(id) => deferred.dismissNote.mutate(id)}
                    dismissedDeferredNotes={deferred.dismissedNotes}
                    onRepinDeferred={(id) => deferred.repinNote.mutate(id)}
                    carriedNotes={carriedNotes}
                    currentDocType={selectedDoc?.doc_type}
                    currentVersionId={selectedVersionId || undefined}
                    bundles={latestNotes?.bundles || latestAnalysis?.bundles || []}
                    decisionSets={latestNotes?.decision_sets ?? []}
                    mutedByDecision={latestNotes?.muted_by_decision ?? []}
                    projectId={projectId}
                    documentId={selectedDocId || undefined}
                    onDecisionApplied={() => {
                      invalidateDevEngine(qc, {
                        projectId,
                        docId: selectedDocId,
                        versionId: selectedVersionId,
                        deep: true,
                      });
                    }}
                    onResolveCarriedNote={async (noteId, action, extra, noteSnapshot) => {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session) { toast.error('Not authenticated'); return; }
                      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-carried-note`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                        body: JSON.stringify({
                          note_id: noteId,
                          project_id: projectId,
                          action,
                          current_doc_type: selectedDoc?.doc_type,
                          current_version_id: selectedVersionId,
                          patch_content: action === 'apply_patch' ? extra : undefined,
                          note_snapshot: noteSnapshot || undefined,
                        }),
                      });
                      const result = await resp.json();
                      if (!resp.ok) { toast.error(result.error || 'Failed'); return result; }
                      if (action === 'mark_resolved') toast.success('Note resolved');
                      if (action === 'dismiss') toast.success('Note dismissed');
                      if (action === 'apply_patch') toast.success('Patch applied — new version created');
                      // Full system invalidation — all panels refresh regardless of action type
                      invalidateDevEngine(qc, {
                        projectId,
                        docId: selectedDocId,
                        versionId: selectedVersionId,
                        deep: true,
                      });
                      return result;
                    }}
                    onClearOldNotes={() => deferred.bulkDismissAll.mutate()}
                    onNoteResolvedLocally={(noteId) => {
                      setLocallyResolvedNoteIds(prev => new Set([...prev, noteId]));
                    }}
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
              {versionText && !isVerticalDrama && (selectedDeliverableType === 'feature_script' || selectedDeliverableType === 'production_draft') && (
                <FeatureLengthGuardrails projectId={projectId!} versionText={versionText}
                  selectedDocId={selectedDocId} selectedVersionId={selectedVersionId} />
              )}

              {/* Change Report Panel — script docs only */}
              {projectId && selectedDocId && selectedDoc && isScriptDocType(selectedDoc.doc_type) && (
                <ChangeReportPanel projectId={projectId} sourceDocId={selectedDocId} sourceDocType={selectedDoc.doc_type} />
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

            <TabsContent value="issues" className="mt-3">
              <IssuesPanel
                projectId={projectId!}
                docType={selectedDoc?.doc_type}
                docVersionId={selectedVersionId || undefined}
                currentText={versionText}
                latestRunNotes={(() => {
                  const notes = latestNotes;
                  if (!notes) return [];
                  // Extract flat notes array from whatever shape the run returns
                  const arr = notes.notes || notes.blocking_issues || notes.high_impact || notes.polish || [];
                  return arr.map((n: any) => ({
                    category: n.category || 'polish',
                    severity: n.severity ?? 3,
                    anchor: n.anchor || n.scene_ref,
                    summary: n.description || n.note || n.summary || '',
                    detail: n.detail || n.description || n.note || '',
                    evidence_snippet: n.evidence,
                  }));
                })()}
                isRunning={generateNotes.isPending || analyze.isPending}
              />
            </TabsContent>

            <TabsContent value="convergence" className="mt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ConvergencePanel
                  latestAnalysis={latestAnalysis}
                  convergenceHistory={convergenceHistory}
                  convergenceStatus={convergenceStatus}
                  tieredNotes={tieredNotes}
                  versionMetaJson={(selectedVersion as any)?.meta_json ?? null}
                />
                <div className="space-y-3">
                  {/* Auto-Run Progress Panel */}
                  {autoRun.activated && autoRun.job && !['completed'].includes(autoRun.job.status) && (
                    <AutoRunProgressPanel
                      job={autoRun.job}
                      steps={autoRun.steps}
                      format={projectFormat}
                      isRunning={autoRun.isRunning}
                      onPause={autoRun.pause}
                      onResume={autoRun.resume}
                      onStop={autoRun.stop}
                      onApproveAndContinue={() => autoRun.approveNext('approve')}
                      onReject={() => autoRun.approveNext('revise')}
                      onForcePromote={autoRun.forcePromote}
                    />
                  )}
                  {/* Pipeline Brain — authoritative next step */}
                  <PipelineNextStepPanel
                    format={projectFormat}
                    existingDocs={(documents || []).map((d: any) => ({
                      docType: d.doc_type || 'idea',
                      hasApproved: !!(approvedVersionMap as any)?.[d.id],
                      activeVersionId: (approvedVersionMap as any)?.[d.id] || null,
                    } as ExistingDoc))}
                    criteria={{
                      episodeCount: effectiveSeasonEpisodes ?? undefined,
                      episodeLengthMin: effectiveEpisodeDurationMin,
                      episodeLengthMax: effectiveEpisodeDurationMax,
                      seasonEpisodeCount: effectiveSeasonEpisodes ?? undefined,
                    }}
                    deferredNoteCount={deferred.deferredNotes.filter(n => n.status === 'deferred').length}
                    onNavigateToStage={(docType) => {
                      const doc = documents?.find((d: any) => d.doc_type === docType);
                      if (doc) selectDocument(doc.id);
                    }}
                    onEnterSeriesWriter={() => {
                      window.location.href = `/projects/${projectId}/advanced?tab=series`;
                    }}
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
              </div>
            </TabsContent>

            <TabsContent value="qualifications" className="mt-3">
              <CanonicalQualificationsPanel projectId={projectId!} />
            </TabsContent>

            <TabsContent value="autorun" id="autorun-mission-control" className="mt-3">
              <AutoRunMissionControl
                projectId={projectId!}
                currentDeliverable={selectedDeliverableType}
                activated={autoRun.activated}
                onActivate={autoRun.activate}
                job={autoRun.job}
                steps={autoRun.steps}
                isRunning={autoRun.isRunning}
                error={autoRun.error}
                connectionState={autoRun.connectionState}
                onStart={autoRun.start}
                onRunNext={autoRun.runNext}
                onResume={autoRun.resume}
                onSetResumeSource={autoRun.setResumeSource}
                onPause={autoRun.pause}
                onStop={autoRun.stop}
                onClear={autoRun.clear}
                onApproveDecision={autoRun.approveDecision}
                onApplyDecisionsAndContinue={autoRun.applyDecisionsAndContinue}
                onGetPendingDoc={autoRun.getPendingDoc}
                onApproveNext={autoRun.approveNext}
                onApproveSeedCore={autoRun.approveSeedCore}
                onSetStage={autoRun.setStage}
                onForcePromote={autoRun.forcePromote}
                onRestartFromStage={autoRun.restartFromStage}
                onSaveStorySetup={autoRun.saveStorySetup}
                onSaveQualifications={autoRun.saveQualifications}
                onSaveLaneBudget={autoRun.saveLaneBudget}
                onSaveGuardrails={autoRun.saveGuardrails}
                fetchDocumentText={autoRun.fetchDocumentText}
                onUpdateStepLimit={autoRun.updateStepLimit}
                onResumeFromStepLimit={autoRun.resumeFromStepLimit}
                onToggleAllowDefaults={autoRun.toggleAllowDefaults}
                onUpdateVersionCap={autoRun.updateVersionCap}
                onUpdateTarget={autoRun.updateTarget}
                onRepairBaseline={autoRun.repairBaseline}
                latestAnalysis={latestAnalysis}
                currentDocText={versionText}
                currentDocMeta={{
                  doc_type: selectedDoc?.doc_type,
                  version: selectedVersion ? versions.indexOf(selectedVersion) + 1 : undefined,
                  char_count: versionText?.length,
                }}
                availableDocuments={documents?.map((d: any) => ({ id: d.id, doc_type: d.doc_type, title: getDocDisplayName((project as any)?.title, d.doc_type) })) || []}
                project={project}
                approvedVersionMap={approvedVersionMap}
              />
            </TabsContent>

            <TabsContent value="series-scripts" className="mt-3 space-y-4">
              {(isVerticalDrama || isSeriesFormat) && (
                <SeriesWriterAutorunPanel projectId={projectId!} />
              )}
              <GenerateSeasonScriptsPanel projectId={projectId!} />
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

            <TabsContent value="canon" className="mt-3">
              <Card>
                <CardContent className="p-4">
                  <CanonicalEditor projectId={projectId!} />
                </CardContent>
              </Card>
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
                      episode_target_duration_min_seconds: resolvedQuals.episode_target_duration_min_seconds,
                      episode_target_duration_max_seconds: resolvedQuals.episode_target_duration_max_seconds,
                      format: resolvedQuals.format,
                    } : null}
                    onRegenerate={handleStaleRegenerate}
                    isRegenerating={false}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="scenes" className="mt-3">
               <SceneGraphPanel projectId={projectId!} documents={documents} />
             </TabsContent>

             <TabsContent value="quality" className="mt-3">
                <QualityRunHistory projectId={projectId!} />
              </TabsContent>

              <TabsContent value="docsets" className="mt-3">
                <DocSetManager projectId={projectId!} />
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
      )}

      {/* ═══ SHARED OVERLAYS (visible in both modes) ═══ */}

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

      {/* Floating Writers' Room button */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
        onClick={() => setGlobalWritersRoomOpen(true)}
        title="Open Writers' Room"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>

      {/* Global Writers' Room Drawer */}
      {projectId && selectedDocId && (
        <NoteWritersRoomDrawer
          open={globalWritersRoomOpen}
          onOpenChange={setGlobalWritersRoomOpen}
          projectId={projectId}
          documentId={selectedDocId}
          versionId={selectedVersionId || undefined}
          note={{ description: 'General discussion', category: 'general', note_hash: `general-${selectedDocId}` }}
          scriptContext={versionText?.slice(0, 6000)}
        />
      )}

      {/* Next Actions → Unified NoteDrawer */}
      <NoteDrawer
        open={nextActionDrawerOpen}
        projectId={projectId || ''}
        noteId={nextActionNoteId}
        onApplied={() => {}}
        onClose={() => {
          setNextActionDrawerOpen(false);
          setNextActionNoteId(null);
        }}
      />

    </div>
    </>
  );
}
