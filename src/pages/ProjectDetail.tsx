import { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Trash2, Loader2, Copy, Download, FileText, FileSpreadsheet, Presentation, ArrowLeftRight, Sparkles, Film, PenTool, ImagePlus, ChevronDown, Activity, Eye, Wrench, Zap, Palette, Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
import { useActiveProjectPoster } from '@/hooks/useActiveProjectPoster';
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
import { ReverseEngineerCallout } from '@/components/project/ReverseEngineerCallout';
import { ImportStatusPanel } from '@/components/project/ImportStatusPanel';
import { ScreenplayIntakeBanner } from '@/components/project/ScreenplayIntakeBanner';
import { SceneIntelligencePanel } from '@/components/project/SceneIntelligencePanel';
import { NDGSummaryPanel } from '@/components/project/NDGSummaryPanel';
import { NarrativeRepairDashboard } from '@/components/project/NarrativeRepairDashboard';


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

  // Resolve effective mode — hooks must be before early returns
  const { mode: userMode, setMode } = useUIMode();
  const effectiveMode = getEffectiveMode(userMode, (project as any)?.ui_mode_override);

  const { data: activePoster } = useActiveProjectPoster(id);

  // Accordion state — all collapsed by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    state: false,
    development: false,
    visual: false,
    diagnostics: false,
    repair: false,
    autorun: false,
  });

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

  const heroImageUrl = activePoster.url || (project as any).hero_image_url;

  const toggleSection = (key: string) => {
    setOpenSections(prev => {
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) {
        next[k] = k === key ? !prev[k] : false;
      }
      return next;
    });
  };

  const laneBadgeLabel = project.assigned_lane
    ? project.assigned_lane.charAt(0).toUpperCase() + project.assigned_lane.slice(1)
    : null;

  const episodeCount = (project as any)?.episode_count || null;

  return (
    <div className="bg-background">

      {/* ═══════════════════════════════════════════════════════════════════════
          HERO SECTION — Poster as project identity
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="relative w-full overflow-hidden">
        {heroImageUrl ? (
          <div className="relative min-h-[260px] sm:min-h-[340px]">
            <img
              src={heroImageUrl}
              alt={`${project.title} poster`}
              className="absolute inset-0 w-full h-full object-cover object-top"
              loading="lazy"
            />
            {/* Full scrim for text legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30 pointer-events-none" />
          </div>
        ) : (
          <div className="relative min-h-[200px] sm:min-h-[260px] bg-gradient-to-b from-card/80 to-background">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <ImagePlus className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-xs text-muted-foreground/50">No poster generated</p>
              </div>
            </div>
          </div>
        )}

        {/* Overlay: title, lane, format, actions */}
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
          <div className="container max-w-6xl mx-auto">
            <div className="flex items-end justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {laneBadgeLabel && (
                    <Badge className="bg-primary/80 text-primary-foreground text-[10px] font-medium tracking-wide uppercase px-2 py-0.5">
                      {laneBadgeLabel}
                    </Badge>
                  )}
                  {project.format && (
                    <Badge variant="outline" className="border-white/20 text-white/70 text-[10px]">
                      {project.format.replace(/-/g, ' ')}
                    </Badge>
                  )}
                  {episodeCount && (
                    <Badge variant="outline" className="border-white/20 text-white/70 text-[10px]">
                      {episodeCount} episodes
                    </Badge>
                  )}
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-serif">
                  {project.title}
                </h1>
                {project.genres && project.genres.length > 0 && (
                  <p className="text-xs text-white/50">{project.genres.join(' · ')}</p>
                )}
              </div>

              {/* Primary actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/projects/${id}/poster`}>
                  <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10 text-xs gap-1.5 hidden sm:flex">
                    <ImagePlus className="h-3.5 w-3.5" /> Poster
                  </Button>
                </Link>
                <Link to={`/projects/${id}/visual-dev`}>
                  <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10 text-xs gap-1.5 hidden sm:flex">
                    <Film className="h-3.5 w-3.5" /> Cast &amp; Visuals
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Top-right utility buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8">
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
          <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8 hidden sm:inline-flex" title="Duplicate" onClick={handleDuplicate} disabled={duplicate.isPending}>
            {duplicate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Link to={`/projects/${id}/present`} className="hidden sm:inline-flex">
            <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8">
              <Presentation className="h-4 w-4" />
            </Button>
          </Link>
          <Link to={`/projects/${id}/trailer-pipeline`} className="hidden sm:inline-flex">
            <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8">
              <Film className="h-4 w-4" />
            </Button>
          </Link>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white/60 hover:text-destructive hover:bg-destructive/10 h-8 w-8">
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

      {/* ═══════════════════════════════════════════════════════════════════════
          SYSTEM SECTIONS — Collapsible accordion hierarchy
          ═══════════════════════════════════════════════════════════════════════ */}
      <main className="container max-w-6xl py-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-3"
        >
          {/* Screenplay Intake Banner — always visible when relevant */}
          <ScreenplayIntakeBanner projectId={id} />
          <ImportStatusPanel projectId={id} />

          {/* ── A. PROJECT STATE ── */}
          <SystemSection
            sectionKey="state"
            icon={<Activity className="h-4 w-4" />}
            title="Project State"
            subtitle="What is true right now"
            isOpen={openSections.state}
            onToggle={toggleSection}
          >
            <div className="space-y-4">
              <NDGSummaryPanel projectId={id} />
              <SceneIntelligencePanel projectId={id} />
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
            </div>
          </SystemSection>

          {/* ── B. DEVELOPMENT ENGINE ── */}
          <SystemSection
            sectionKey="development"
            icon={<PenTool className="h-4 w-4" />}
            title="Development Engine"
            subtitle="Build the project"
            isOpen={openSections.development}
            onToggle={toggleSection}
          >
            <div className="space-y-3">
              <ReverseEngineerCallout projectId={id!} documents={documents} />
              <div className="flex items-center gap-3">
                <Link to={`/projects/${id}/development`} className="flex-1">
                  <Button variant="outline" className="w-full gap-2 h-11">
                    <PenTool className="h-4 w-4 text-primary" />
                    Open Development Engine
                  </Button>
                </Link>
              </div>
            </div>
          </SystemSection>

          {/* ── C. VISUAL ENGINE ── */}
          <SystemSection
            sectionKey="visual"
            icon={<Palette className="h-4 w-4" />}
            title="Visual Engine"
            subtitle="Cast photos, references, poster, and presentation"
            isOpen={openSections.visual}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* PRIMARY — Visual Production Hub */}
              <Link to={`/projects/${id}/visual-dev`} className="sm:col-span-2">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 hover:bg-primary/10 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <Film className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">Visual Production Hub</span>
                    <Badge variant="default" className="text-[9px] h-4 px-1.5">Primary</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Cast photos, character identity, world references, visual canon, approval queue, and archive.
                  </p>
                </div>
              </Link>

              {/* Poster Engine */}
              <Link to={`/projects/${id}/poster`}>
                <div className="rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors cursor-pointer h-full">
                  <div className="flex items-center gap-2 mb-0.5">
                    <ImagePlus className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Poster Engine</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Create and choose the project poster.</p>
                </div>
              </Link>

              {/* Image Library */}
              <Link to={`/projects/${id}/images`}>
                <div className="rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors cursor-pointer h-full">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Image Library</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Browse all generated images.</p>
                </div>
              </Link>

              {/* Look Book */}
              <Link to={`/projects/${id}/pitch-deck`} className="sm:col-span-2">
                <div className="rounded-lg border border-border/30 bg-card/20 p-3 hover:bg-card/40 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Look Book</span>
                    <span className="text-[10px] text-muted-foreground italic">Presentation</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Assemble and review the visual presentation deck. Most useful once cast photos and references are built.</p>
                </div>
              </Link>
            </div>
          </SystemSection>

          {/* ── D. NARRATIVE DIAGNOSTICS ── */}
          <SystemSection
            sectionKey="diagnostics"
            icon={<Eye className="h-4 w-4" />}
            title="Narrative Diagnostics"
            subtitle="What needs attention"
            isOpen={openSections.diagnostics}
            onToggle={toggleSection}
          >
            {/* Diagnostics are part of the advanced view's overview tab — link for now */}
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Structural findings, coherence checks, and canon drift alerts surface here.
              </p>
              <Link to={`/projects/${id}/development`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" /> Open Diagnostics
                </Button>
              </Link>
            </div>
          </SystemSection>

          {/* ── E. REPAIR ENGINE ── */}
          <SystemSection
            sectionKey="repair"
            icon={<Wrench className="h-4 w-4" />}
            title="Repair Engine"
            subtitle="Fix the project"
            isOpen={openSections.repair}
            onToggle={toggleSection}
          >
            <NarrativeRepairDashboard projectId={id} />
          </SystemSection>

          {/* ── F. AUTO-RUN ── */}
          <SystemSection
            sectionKey="autorun"
            icon={<Zap className="h-4 w-4" />}
            title="Auto-Run"
            subtitle="Automate the system"
            isOpen={openSections.autorun}
            onToggle={toggleSection}
          >
            <AutoRunSetupPanel project={project} />
          </SystemSection>
        </motion.div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SystemSection — collapsible section container
// ═══════════════════════════════════════════════════════════════════════════════

function SystemSection({
  sectionKey,
  icon,
  title,
  subtitle,
  isOpen,
  onToggle,
  children,
}: {
  sectionKey: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle(sectionKey)}>
      <CollapsibleTrigger className="w-full">
        <div className={cn(
          'flex items-center justify-between w-full px-4 py-3 rounded-lg border border-border/50 transition-colors',
          isOpen ? 'bg-card border-border' : 'bg-card/30 hover:bg-card/60',
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md',
              isOpen ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {icon}
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <ChevronDown className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180',
          )} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-3 pb-1 px-1">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
