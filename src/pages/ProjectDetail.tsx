import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Trash2, Loader2, Copy, Download, FileText, FileSpreadsheet, Presentation, ArrowLeftRight, Menu } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
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
import { LaneBadge } from '@/components/LaneBadge';
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

// Stage components
import { LifecycleSidebar } from '@/components/LifecycleSidebar';
import { OverviewDashboard } from '@/components/stages/OverviewDashboard';
import { DevelopmentStage } from '@/components/stages/DevelopmentStage';
import { PackagingStage } from '@/components/stages/PackagingStage';
import { PreProductionStage } from '@/components/stages/PreProductionStage';
import { ProductionStage } from '@/components/stages/ProductionStage';
import { PostProductionStage } from '@/components/stages/PostProductionStage';
import { SalesDeliveryStage } from '@/components/stages/SalesDeliveryStage';
import { FinancingLayer } from '@/components/stages/FinancingLayer';
import { BudgetingLayer } from '@/components/stages/BudgetingLayer';
import { RecoupmentLayer } from '@/components/stages/RecoupmentLayer';
import { TrendsLayer } from '@/components/stages/TrendsLayer';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') || 'overview';
  const setActiveView = useCallback((view: string) => {
    setSearchParams({ view }, { replace: false });
  }, [setSearchParams]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    return calculateMasterViability(stageResults, project.format, lifecycleStage);
  }, [project, devReadiness, pkgReadiness, preProReadiness, prodReadiness, postReadiness, salesReadiness, lifecycleStage]);

  const currentScript = scripts.find(s => s.status === 'current');
  const scriptText = useMemo(() => {
    if (!project) return null;
    if (documents.length) {
      if (currentScript) {
        const scriptDoc = documents.find(d => d.extracted_text && d.file_path === currentScript.file_path);
        if (scriptDoc?.extracted_text) return scriptDoc.extracted_text;
      }
      const scriptDoc = documents.find(d => d.extracted_text && d.file_name.match(/\.(pdf|txt|fdx|fountain|docx|doc|md)$/i));
      if (scriptDoc?.extracted_text) return scriptDoc.extracted_text;
      const anyDoc = documents.find(d => d.extracted_text);
      if (anyDoc?.extracted_text) return anyDoc.extracted_text;
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
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
      <div className="min-h-screen bg-background">
        <Header />
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

  const renderStageContent = () => {
    switch (activeView) {
      case 'overview':
        return (
          <OverviewDashboard
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
            onNavigateToStage={setActiveView}
            masterViability={masterViability}
          />
        );
      case 'development':
        return (
          <DevelopmentStage
            project={project}
            projectId={id!}
            analysis={analysis}
            hasNewAnalysis={hasNewAnalysis}
            insights={insights}
            scripts={scripts}
            currentScript={currentScript}
            hasDocuments={hasDocuments}
            hasScript={hasScript}
            documents={documents}
            onUpload={(files, scriptInfo) => addDocuments.mutate({ files, scriptInfo })}
            isUploading={addDocuments.isPending}
            scriptText={scriptText}
            stageReadiness={devReadiness}
          />
        );
      case 'packaging':
        return (
          <PackagingStage
            project={project}
            projectId={id!}
            cast={cast}
            hods={hods}
            scriptCharacters={scriptCharacters}
            scriptCharactersLoading={scriptCharsLoading}
            scriptText={scriptText}
            isTV={!!isTV}
            stageReadiness={pkgReadiness}
          />
        );
      case 'pre-production':
        return (
          <PreProductionStage
            project={project}
            projectId={id!}
            budgets={budgets}
            addBudget={addBudget}
            deals={deals}
            financeScenarios={financeScenarios}
            scheduleMetrics={scheduleMetrics}
            scriptText={scriptText}
            hods={hods}
            budgetLines={[]}
            onIncentiveAnalysed={setIncentiveAnalysedThisSession}
            stageReadiness={preProReadiness}
          />
        );
      case 'production':
        return (
          <ProductionStage
            projectId={id!}
            totalPlannedScenes={scheduleMetrics.totalScenes || 0}
            totalShootDays={scheduleMetrics.shootDayCount || 0}
            stageReadiness={prodReadiness}
          />
        );
      case 'post-production':
        return <PostProductionStage projectId={id!} stageReadiness={postReadiness} />;
      case 'sales-delivery':
        return (
          <SalesDeliveryStage
            project={project}
            projectId={id!}
            cast={cast}
            partners={partners}
            deals={deals}
            deliverables={deliverables as any}
            trendSignals={trendSignals}
            stageReadiness={salesReadiness}
          />
        );
      case 'financing':
        return (
          <FinancingLayer
            project={project}
            projectId={id!}
            financeReadiness={financeReadiness}
            financeScenarios={financeScenarios}
            onIncentiveAnalysed={setIncentiveAnalysedThisSession}
          />
        );
      case 'budgeting':
        return (
          <BudgetingLayer
            project={project}
            projectId={id!}
            budgets={budgets}
            deals={deals}
            financeScenarios={financeScenarios}
            isTV={!!isTV}
            shootDayCount={scheduleMetrics.shootDayCount || 0}
          />
        );
      case 'recoupment':
        return (
          <RecoupmentLayer
            projectId={id!}
            budgets={budgets}
          />
        );
      case 'trends':
        return <TrendsLayer project={project} projectId={id!} lifecycleStage={lifecycleStage} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-6xl py-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (activeView !== 'overview') {
                    setActiveView('overview');
                    setSidebarOpen(true);
                  } else {
                    navigate('/dashboard');
                  }
                }}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  {formatMeta && (
                    <>
                      <formatMeta.icon className={`h-3.5 w-3.5 ${formatMeta.color}`} />
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        {formatMeta.shortLabel}
                      </span>
                    </>
                  )}
                </div>
                <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">
                  {project.title}
                </h1>
                {project.genres && project.genres.length > 0 && (
                  <p className="text-sm text-muted-foreground">{project.genres.join(' · ')}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-muted-foreground"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Export">
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
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Duplicate" onClick={handleDuplicate} disabled={duplicate.isPending}>
                {duplicate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Link to={`/projects/${id}/present`}>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Presentation Mode">
                  <Presentation className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/compare">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Compare">
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              </Link>
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0">
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

          {/* Lifecycle Layout: Sidebar + Content */}
          <div className="flex gap-6">
            {/* Sidebar - hidden on mobile unless toggled */}
            <div className={cn(
              'transition-all duration-200 lg:block',
              sidebarOpen ? 'block' : 'hidden'
            )}>
              <LifecycleSidebar
                currentLifecycleStage={lifecycleStage}
                activeView={activeView}
                onViewChange={(view) => {
                  setActiveView(view);
                  // Only auto-close on mobile
                  if (window.innerWidth < 1024) setSidebarOpen(false);
                }}
                stageScores={masterViability?.stageScores}
              />
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              {renderStageContent()}
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
