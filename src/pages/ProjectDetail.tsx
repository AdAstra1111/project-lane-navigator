import { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Trash2, Loader2, Copy, Download, FileText, FileSpreadsheet, Presentation, ArrowLeftRight, Sparkles, Film, PenTool } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Header } from '@/components/Header';

import { useProject, useProjectDocuments } from '@/hooks/useProjects';
import { useProjects } from '@/hooks/useProjects';
import { useAddDocuments } from '@/hooks/useAddDocuments';
import { useProjectDuplicate } from '@/hooks/useProjectDuplicate';
import { useActiveCastTrends, useActiveSignals } from '@/hooks/useTrends';
import { calculateTrendInfluence } from '@/lib/trend-influence';
import { useAuth } from '@/hooks/useAuth';
import { useScriptCharacters } from '@/hooks/useScriptCharacters';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { generateProjectInsights } from '@/lib/project-insights';
import { calculateReadiness } from '@/lib/readiness-score';
import { calculateFinanceReadiness } from '@/lib/finance-readiness';
import {
  calculateDevelopmentReadiness,
  calculatePackagingReadiness,
  calculatePreProductionReadiness,
  calculateProductionReadiness,
  calculatePostReadiness,
  calculateSalesReadiness,
} from '@/lib/stage-readiness';
import { calculateMasterViability } from '@/lib/master-viability';
import { calculateTVReadiness } from '@/lib/tv-readiness-score';
import { calculateModeReadiness } from '@/lib/mode-readiness';
import { getFormatMeta } from '@/lib/mode-engine';
import { useProjectBudgets } from '@/hooks/useBudgets';
import type { BudgetSummary } from '@/lib/finance-readiness';
import { useTalentTriage } from '@/hooks/useTalentTriage';
import { useProjectScenes, useShootDays, useSceneSchedule } from '@/hooks/useProductionSchedule';
import { computeScheduleMetrics } from '@/lib/schedule-impact';
import { useScoreHistory, useAutoSaveScore } from '@/hooks/useScoreHistory';
import { getStageGates } from '@/lib/pipeline-gates';
import { MonetisationLane, Recommendation, FullAnalysis, PipelineStage, PIPELINE_STAGES } from '@/lib/types';
import { exportProjectPDF } from '@/lib/pdf-export';
import { exportDealsCSV, exportDeliverablesCSV, exportCostsCSV } from '@/lib/csv-export';
import { matchBuyersToProject } from '@/lib/buyer-matcher';
import { useProjectDeals } from '@/hooks/useDeals';
import { useProjectDeliverables } from '@/hooks/useDeliverables';
import { useProjectCostEntries } from '@/hooks/useCostEntries';
import { useRecoupmentScenarios, useRecoupmentTiers } from '@/hooks/useRecoupment';
import { type LifecycleStage } from '@/lib/lifecycle-stages';
import { usePostMilestones, useEditVersions, useVfxShots } from '@/hooks/usePostProduction';


import { useUIMode } from '@/hooks/useUIMode';
import { getEffectiveMode } from '@/lib/visibility';

// New architecture components
import { ProjectSummaryBar } from '@/components/project/ProjectSummaryBar';
import { SimpleProjectView } from '@/components/project/SimpleProjectView';
import { AdvancedProjectView } from '@/components/project/AdvancedProjectView';
import { AutoRunSetupPanel } from '@/components/project/AutoRunSetupPanel';


export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { project, isLoading } = useProject(id);
  const { documents } = useProjectDocuments(id);
  const { deleteProject } = useProjects();
  const addDocuments = useAddDocuments(id);
  const { duplicate } = useProjectDuplicate();

  const { data: castTrends = [] } = useActiveCastTrends();
  const { data: trendSignals = [] } = useActiveSignals();
  const { user } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [incentiveAnalysedThisSession, setIncentiveAnalysedThisSession] = useState(false);


  const { cast } = useProjectCast(id);
  const { partners } = useProjectPartners(id);
  const { scripts } = useProjectScripts(id);
  const { scenarios: financeScenarios } = useProjectFinance(id);
  const { hods } = useProjectHODs(id);
  const { deals } = useProjectDeals(id);
  const { deliverables } = useProjectDeliverables(id);
  const { entries: costEntries } = useProjectCostEntries(id);
  const { budgets, addBudget } = useProjectBudgets(id);

  const { scenes: projectScenes } = useProjectScenes(id);
  const { shootDays } = useShootDays(id);
  const { schedule: sceneScheduleEntries } = useSceneSchedule(id);

  const scheduleMetrics = useMemo(() => {
    return computeScheduleMetrics(projectScenes, shootDays, sceneScheduleEntries, project?.format);
  }, [projectScenes, shootDays, sceneScheduleEntries, project?.format]);

  const budgetSummary: BudgetSummary = useMemo(() => {
    const locked = budgets.filter(b => b.status === 'locked');
    return {
      count: budgets.length,
      hasLocked: locked.length > 0,
      lockedTotal: locked.reduce((s, b) => s + Number(b.total_amount), 0),
    };
  }, [budgets]);

  const incentiveAnalysed = incentiveAnalysedThisSession || !!(project as any)?.incentive_insights;
  const insightTriage = useTalentTriage(id || '');
  const { data: scriptCharacters = [], isLoading: scriptCharsLoading } = useScriptCharacters(id);
  const insights = useMemo(() => {
    if (!project || castTrends.length === 0) return null;
    return generateProjectInsights(project, castTrends);
  }, [project, castTrends]);

  const isTV = project?.format === 'tv-series';
  const isFilm = project?.format === 'film';
  const isAlternateMode = project && !isTV && !isFilm;
  const formatMeta = project ? getFormatMeta(project.format) : null;

  const lifecycleStage: LifecycleStage = ((project as any)?.lifecycle_stage as LifecycleStage) || 'development';

  const trendInfluence = useMemo(() => {
    if (!project || (!trendSignals.length && !castTrends.length)) return null;
    return calculateTrendInfluence(project, trendSignals, castTrends);
  }, [project, trendSignals, castTrends]);

  const readiness = useMemo(() => {
    if (!project) return null;
    return calculateReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary, scheduleMetrics, trendInfluence?.readinessAdjustment, project.script_coverage_verdict);
  }, [project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary, scheduleMetrics, trendInfluence]);

  const tvReadiness = useMemo(() => {
    if (!project || !isTV) return null;
    return calculateTVReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary);
  }, [project, isTV, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary]);

  const financeReadiness = useMemo(() => {
    if (!project || isAlternateMode) return null;
    return calculateFinanceReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary, scheduleMetrics);
  }, [project, isAlternateMode, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary, scheduleMetrics]);

  const modeReadiness = useMemo(() => {
    if (!project || !isAlternateMode) return null;
    return calculateModeReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary);
  }, [project, isAlternateMode, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary]);

  const { history: scoreHistory } = useScoreHistory(id);
  useAutoSaveScore(id, readiness?.score ?? null, financeReadiness?.score ?? null);

  // Per-stage readiness scores
  const devReadiness = useMemo(() => {
    if (!project) return null;
    return calculateDevelopmentReadiness(project, scripts, project.script_coverage_verdict);
  }, [project, scripts]);

  const pkgReadiness = useMemo(() => {
    if (!project) return null;
    return calculatePackagingReadiness(project, cast, partners, hods);
  }, [project, cast, partners, hods]);

  const preProReadiness = useMemo(() => {
    if (!project) return null;
    return calculatePreProductionReadiness(project, financeScenarios, hods, incentiveAnalysed, budgetSummary, scheduleMetrics);
  }, [project, financeScenarios, hods, incentiveAnalysed, budgetSummary, scheduleMetrics]);

  const prodReadiness = useMemo(() => {
    return calculateProductionReadiness(budgetSummary, scheduleMetrics, costEntries as any);
  }, [budgetSummary, scheduleMetrics, costEntries]);

  const { milestones: postMilestones } = usePostMilestones(id);
  const { versions: editVersions } = useEditVersions(id);
  const { shots: vfxShots } = useVfxShots(id);

  const postReadiness = useMemo(() => {
    return calculatePostReadiness(deliverables as any, budgetSummary, costEntries as any, postMilestones as any, editVersions as any, vfxShots as any);
  }, [deliverables, budgetSummary, costEntries, postMilestones, editVersions, vfxShots]);

  const salesReadiness = useMemo(() => {
    if (!project) return null;
    return calculateSalesReadiness(project, partners, deals as any, deliverables as any);
  }, [project, partners, deals, deliverables]);

  const masterViability = useMemo(() => {
    if (!project) return null;
    const stageResults: any = {};
    if (devReadiness) stageResults['development'] = devReadiness;
    if (pkgReadiness) stageResults['packaging'] = pkgReadiness;
    if (preProReadiness) stageResults['pre-production'] = preProReadiness;
    if (prodReadiness) stageResults['production'] = prodReadiness;
    if (postReadiness) stageResults['post-production'] = postReadiness;
    if (salesReadiness) stageResults['sales-delivery'] = salesReadiness;
    return calculateMasterViability(
      stageResults,
      project.format,
      lifecycleStage,
      project.confidence,
      trendInfluence ? (50 + (trendInfluence.readinessAdjustment.adjustment * 10)) : null,
    );
  }, [project, devReadiness, pkgReadiness, preProReadiness, prodReadiness, postReadiness, salesReadiness, lifecycleStage, trendInfluence]);

  // Persist viability breakdown to DB
  useEffect(() => {
    if (!masterViability?.components || !id) return;
    supabase.from('projects').update({
      viability_breakdown: masterViability.components as any,
    }).eq('id', id).then();
  }, [masterViability?.components, id]);

  const currentScript = scripts.find(s => s.status === 'current');
  const scriptText = useMemo(() => {
    if (!project) return null;
    if (documents.length) {
      // Helper: get effective text from either extracted_text or version_plaintext
      const getText = (d: typeof documents[0]) => d.extracted_text || d.version_plaintext || null;

      if (currentScript) {
        const scriptDoc = documents.find(d => getText(d) && d.file_path === currentScript.file_path);
        if (scriptDoc) return getText(scriptDoc);
      }
      const scriptDoc = documents.find(d => getText(d) && d.file_name.match(/\.(pdf|txt|fdx|fountain|docx|doc|md)$/i));
      if (scriptDoc) return getText(scriptDoc);
      // Check for dev-engine script docs or script_pdf
      const devScript = documents.find(d => getText(d) && ((d.doc_type as string) === 'script' || (d.doc_type as string) === 'feature_script' || (d.doc_type as string) === 'episode_script' || (d.doc_type as string) === 'season_script' || (d.doc_type as string) === 'script_pdf' || d.doc_type === 'treatment'));
      if (devScript) return getText(devScript);
      const anyDoc = documents.find(d => getText(d));
      if (anyDoc) return getText(anyDoc);
    }
    if (project?.document_urls?.length) return '__SCRIPT_EXISTS_NO_TEXT__';
    if (currentScript) return '__SCRIPT_EXISTS_NO_TEXT__';
    return null;
  }, [documents, currentScript, project]);

  const nextStageGates = useMemo(() => {
    if (!project) return null;
    const stageOrder: PipelineStage[] = ['development', 'packaging', 'financing', 'pre-production'];
    const currentIdx = stageOrder.indexOf(project.pipeline_stage as PipelineStage);
    const nextStage = stageOrder[currentIdx + 1];
    if (!nextStage) return null;
    return getStageGates(nextStage, project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed);
  }, [project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed]);

  const handleDelete = async () => {
    if (!id) return;
    await deleteProject.mutateAsync(id);
    navigate('/dashboard');
  };

  const handleDuplicate = () => {
    if (!id) return;
    duplicate.mutate(id);
  };

  const handleExportPDF = async () => {
    if (!project || !readiness) return;
    let buyerMatches: import('@/lib/buyer-matcher').BuyerMatch[] = [];
    try {
      const { data: buyers } = await (await import('@/integrations/supabase/client')).supabase
        .from('market_buyers').select('*').eq('status', 'active');
      if (buyers && buyers.length > 0) {
        const castTerritories = [...new Set(cast.flatMap(c => c.territory_tags))];
        buyerMatches = matchBuyersToProject(buyers as any[], {
          format: project.format, genres: project.genres, budget_range: project.budget_range,
          tone: project.tone, target_audience: project.target_audience,
          assigned_lane: project.assigned_lane, cast_territories: castTerritories,
        });
      }
    } catch { /* proceed without */ }
    const totalSpent = costEntries.reduce((s, c) => s + Number(c.amount || 0), 0);
    const lockedBudgets = budgets.filter(b => b.status === 'locked');
    const totalBudget = lockedBudgets.reduce((s, b) => s + Number(b.total_amount), 0);
    const dates = costEntries.map(c => new Date(c.entry_date).getTime()).filter(Boolean);
    const spanMs = dates.length > 1 ? Math.max(...dates) - Math.min(...dates) : 0;
    const weeks = Math.max(1, spanMs / (7 * 24 * 60 * 60 * 1000));
    const burnRate = totalSpent / weeks;
    exportProjectPDF({
      project, readiness, financeReadiness, cast, partners, hods, financeScenarios,
      buyerMatches, deals, deliverables,
      costSummary: totalSpent > 0 ? { totalSpent, totalBudget, burnRate } : undefined,
    });
  };

  const handleExportDealsCSV = () => { if (project) exportDealsCSV(deals, project.title); };
  const handleExportDeliverablesCSV = () => { if (project) exportDeliverablesCSV(deliverables, project.title); };
  const handleExportCostsCSV = () => { if (project) exportCostsCSV(costEntries, project.title); };

  // ProjectDetail is always rendered inside ProjectShell now (Week 2 refactor)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container max-w-6xl py-10">
          <div className="animate-pulse space-y-6">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-32 bg-muted rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="bg-background">
        <main className="container max-w-6xl py-10 text-center">
          <p className="text-muted-foreground">Project not found.</p>
          <Link to="/dashboard">
            <Button variant="link" className="text-primary mt-4">Back to Dashboard</Button>
          </Link>
        </main>
      </div>
    );
  }

  const analysis = project.analysis_passes as FullAnalysis | null;
  const hasNewAnalysis = analysis?.structural_read != null;
  const hasDocuments = documents.length > 0;
  const hasScript = scripts.length > 0;

  // Resolve effective mode
  const { mode: userMode, setMode } = useUIMode();
  const effectiveMode = getEffectiveMode(userMode, (project as any).ui_mode_override);

  const heroImageUrl = (project as any).hero_image_url;

  return (
    <div className="bg-background">

      {/* Hero Image Banner */}
      {heroImageUrl && (
        <div className="relative h-[200px] sm:h-[260px] overflow-hidden -mb-6">
          <img src={heroImageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/50 to-transparent" />
        </div>
      )}

      <main className="container max-w-6xl py-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Project Header (compact) */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                {project.genres && project.genres.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate">{project.genres.join(' · ')}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0 h-8 w-8" title="Export">
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportPDF}>
                    <FileText className="h-3.5 w-3.5 mr-2" />PDF One-Pager
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {deals.length > 0 && (
                    <DropdownMenuItem onClick={handleExportDealsCSV}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />Deals CSV
                    </DropdownMenuItem>
                  )}
                  {deliverables.length > 0 && (
                    <DropdownMenuItem onClick={handleExportDeliverablesCSV}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />Deliverables CSV
                    </DropdownMenuItem>
                  )}
                  {costEntries.length > 0 && (
                    <DropdownMenuItem onClick={handleExportCostsCSV}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />Costs CSV
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0 h-8 w-8 hidden sm:inline-flex" title="Duplicate" onClick={handleDuplicate} disabled={duplicate.isPending}>
                {duplicate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Link to={`/projects/${id}/present`} className="hidden sm:inline-flex">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0 h-8 w-8" title="Presentation Mode">
                  <Presentation className="h-4 w-4" />
                </Button>
              </Link>
              <Link to={`/projects/${id}/pitch-deck`} className="hidden sm:inline-flex">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0 h-8 w-8" title="AI Pitch Deck">
                  <Sparkles className="h-4 w-4" />
                </Button>
              </Link>
              <Link to={`/projects/${id}/trailer-pipeline`} className="hidden sm:inline-flex">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0 h-8 w-8" title="Cinematic Studio">
                  <Film className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/compare" className="hidden sm:inline-flex">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0 h-8 w-8" title="Compare">
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              </Link>
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 h-8 w-8">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete "{project.title}"?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the project, its analysis, and all uploaded documents.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteProject.isPending}>
                      {deleteProject.isPending ? (<><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Deleting…</>) : 'Delete Project'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Summary Bar removed — ProjectShell owns the top bar now */}

          {/* Auto-Run Setup Panel */}
          <AutoRunSetupPanel project={project} />

          {/* Quick-access buttons */}
          <div className="flex items-center gap-3 mt-4 mb-6">
            <Link to={`/projects/${id}/visual-dev`} className="flex-1">
              <Button variant="outline" className="w-full gap-2 h-11">
                <Film className="h-4 w-4 text-primary" />
                Visual Production Hub
              </Button>
            </Link>
            <Link to={`/projects/${id}/development`} className="flex-1">
              <Button variant="outline" className="w-full gap-2 h-11">
                <PenTool className="h-4 w-4 text-primary" />
                Development Engine
              </Button>
            </Link>
          </div>

          {/* Mode-based content */}
          {effectiveMode === 'simple' ? (
            <SimpleProjectView
              project={project}
              readiness={readiness}
              analysis={analysis}
              scriptCount={scripts.length}
              castCount={cast.length}
              partnerCount={partners.length}
              hodCount={hods.length}
              financeScenarioCount={financeScenarios.length}
              onSwitchToAdvanced={() => setMode('advanced')}
            />
          ) : (
            <AdvancedProjectView
              project={project}
              projectId={id!}
              readiness={readiness}
              tvReadiness={tvReadiness}
              modeReadiness={modeReadiness}
              isTV={!!isTV}
              isAlternateMode={!!isAlternateMode}
              scoreHistory={scoreHistory}
              nextStageGates={nextStageGates}
              currentUserId={user?.id || null}
              lifecycleStage={lifecycleStage}
              masterViability={masterViability}
              analysis={analysis}
              hasNewAnalysis={hasNewAnalysis}
              insights={insights}
              scripts={scripts}
              currentScript={currentScript}
              hasDocuments={hasDocuments}
              hasScript={hasScript}
              documents={documents}
              onUpload={(files, scriptInfo, docType) => addDocuments.mutate({ files, scriptInfo, docType })}
              isUploading={addDocuments.isPending}
              scriptText={scriptText}
              devReadiness={devReadiness}
              cast={cast}
              hods={hods}
              scriptCharacters={scriptCharacters}
              scriptCharactersLoading={scriptCharsLoading}
              pkgReadiness={pkgReadiness}
              budgets={budgets}
              addBudget={addBudget}
              deals={deals}
              financeScenarios={financeScenarios}
              scheduleMetrics={scheduleMetrics}
              preProReadiness={preProReadiness}
              prodReadiness={prodReadiness}
              postReadiness={postReadiness}
              partners={partners}
              deliverables={deliverables as any}
              trendSignals={trendSignals}
              salesReadiness={salesReadiness}
              financeReadiness={financeReadiness}
              onIncentiveAnalysed={setIncentiveAnalysedThisSession}
              costEntries={costEntries}
            />
          )}
        </motion.div>
      </main>
    </div>
  );
}
