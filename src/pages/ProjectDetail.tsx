import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Film, Tv, Target, Palette, DollarSign, Users, Quote, CheckCircle2, ShieldAlert, Trash2, Loader2, AlertTriangle, MessageSquareQuote, FileText, Copy, ArrowLeftRight, Download, TrendingUp, Landmark, BarChart3, Package, StickyNote, UsersRound, ChevronDown, PieChart, FileSpreadsheet, PackageCheck, Receipt, FileSignature } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ProjectNoteInput } from '@/components/ProjectNoteInput';
import { cn } from '@/lib/utils';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Header } from '@/components/Header';
import { LaneBadge } from '@/components/LaneBadge';
import { AnalysisPassesDisplay } from '@/components/AnalysisPassesDisplay';
import { DocumentsList } from '@/components/DocumentsList';
import { AddDocumentsUpload } from '@/components/AddDocumentsUpload';
import { ProjectInsightPanel } from '@/components/ProjectInsightPanel';
import { ProjectIncentivePanel } from '@/components/ProjectIncentivePanel';
import { ProjectReadinessScore } from '@/components/ProjectReadinessScore';
import { ProjectAttachmentTabs } from '@/components/ProjectAttachmentTabs';
import { FinanceTab } from '@/components/ProjectAttachmentTabs';
import { ProjectTimeline } from '@/components/ProjectTimeline';
import { ProjectBuyerMatches } from '@/components/ProjectBuyerMatches';
import { ProjectCollaboratorsPanel } from '@/components/ProjectCollaboratorsPanel';
import { ProjectCommentsThread } from '@/components/ProjectCommentsThread';
import { useProject, useProjectDocuments } from '@/hooks/useProjects';
import { useProjects } from '@/hooks/useProjects';
import { useAddDocuments } from '@/hooks/useAddDocuments';
import { useProjectDuplicate } from '@/hooks/useProjectDuplicate';
import { useActiveCastTrends, useActiveSignals } from '@/hooks/useTrends';
import { useAuth } from '@/hooks/useAuth';
import { useScriptCharacters } from '@/hooks/useScriptCharacters';
import { ProjectRelevantSignals } from '@/components/ProjectRelevantSignals';
import { TerritoryHeatMap } from '@/components/TerritoryHeatMap';
import { ScriptCoverage } from '@/components/ScriptCoverage';
import { FinanceWaterfall } from '@/components/FinanceWaterfall';
import { CompAnalysis } from '@/components/CompAnalysis';
import { DealTracker } from '@/components/DealTracker';
import { OwnershipWaterfallPanel } from '@/components/OwnershipWaterfallPanel';
import { BudgetPanel } from '@/components/BudgetPanel';
import { DeliveryIntelligencePanel } from '@/components/DeliveryIntelligencePanel';
import { CostTrackingPanel } from '@/components/CostTrackingPanel';
import { ContractManagerPanel } from '@/components/ContractManagerPanel';
import { ProjectActivityFeed } from '@/components/ProjectActivityFeed';
import { DeadlinePanel } from '@/components/DeadlinePanel';
import { useProjectBudgets } from '@/hooks/useBudgets';
import type { BudgetSummary } from '@/lib/finance-readiness';
import { useTalentTriage } from '@/hooks/useTalentTriage';
import { MarketWindowAlerts } from '@/components/MarketWindowAlerts';
import { ProjectFestivalMatches } from '@/components/ProjectFestivalMatches';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { generateProjectInsights } from '@/lib/project-insights';
import { calculateReadiness } from '@/lib/readiness-score';
import { calculateFinanceReadiness } from '@/lib/finance-readiness';
import { FinanceReadinessPanel } from '@/components/FinanceReadinessPanel';
import { GeographySelector } from '@/components/GeographySelector';
import { PipelineStageSuggestion } from '@/components/PipelineStageSuggestion';
import { ScoreSparkline } from '@/components/ScoreSparkline';
import { useScoreHistory, useAutoSaveScore } from '@/hooks/useScoreHistory';
import { getStageGates } from '@/lib/pipeline-gates';
import { MonetisationLane, Recommendation, FullAnalysis, PipelineStage, PIPELINE_STAGES } from '@/lib/types';
import { BUDGET_RANGES, TARGET_AUDIENCES, TONES } from '@/lib/constants';
import { exportProjectPDF } from '@/lib/pdf-export';
import { exportDealsCSV, exportDeliverablesCSV, exportCostsCSV, exportBudgetCSV } from '@/lib/csv-export';
import { matchBuyersToProject } from '@/lib/buyer-matcher';
import { useProjectDeals } from '@/hooks/useDeals';
import { useProjectDeliverables } from '@/hooks/useDeliverables';
import { useProjectCostEntries } from '@/hooks/useCostEntries';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  Packaging: Users,
  Finance: DollarSign,
  Strategy: Target,
  Market: Palette,
};

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Confidence</span>
        <span className="font-medium text-foreground">{percent}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
        />
      </div>
    </div>
  );
}

function RecommendationCard({ rec, index }: { rec: Recommendation; index: number }) {
  const Icon = CATEGORY_ICONS[rec.category] || Target;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 + index * 0.1, duration: 0.3 }}
      className="glass-card rounded-lg p-5"
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider mb-1">{rec.category}</p>
          <h4 className="font-display font-semibold text-foreground mb-1">{rec.title}</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">{rec.description}</p>
        </div>
      </div>
    </motion.div>
  );
}

function DoAvoidSection({ doNext, avoid }: { doNext: string[]; avoid: string[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <h4 className="font-display font-semibold text-foreground">Do Next</h4>
        </div>
        <ol className="space-y-3">
          {doNext.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="text-emerald-400 font-bold shrink-0">{i + 1}.</span>
              <span className="text-foreground leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-5 w-5 text-red-400" />
          <h4 className="font-display font-semibold text-foreground">Avoid</h4>
        </div>
        <ol className="space-y-3">
          {avoid.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="text-red-400 font-bold shrink-0">{i + 1}.</span>
              <span className="text-foreground leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ─── Collapsible section wrapper ─── */
function Section({
  icon: Icon,
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full glass-card rounded-xl px-5 py-4 flex items-center gap-3 hover:bg-card/90 transition-colors group cursor-pointer">
          <Icon className="h-4 w-4 text-primary shrink-0" />
          <span className="font-display font-semibold text-foreground text-base flex-1 text-left">{title}</span>
          {badge}
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
        <div className="pt-3 space-y-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

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
  const { budgets } = useProjectBudgets(id);

  const budgetSummary: BudgetSummary = useMemo(() => {
    const locked = budgets.filter(b => b.status === 'locked');
    return {
      count: budgets.length,
      hasLocked: locked.length > 0,
      lockedTotal: locked.reduce((s, b) => s + Number(b.total_amount), 0),
    };
  }, [budgets]);

  // Incentive analysis is considered done if either: already persisted in DB or run this session
  const incentiveAnalysed = incentiveAnalysedThisSession || !!(project as any)?.incentive_insights;
  const insightTriage = useTalentTriage(id || '');
  const { data: scriptCharacters = [], isLoading: scriptCharsLoading } = useScriptCharacters(id);
  const insights = useMemo(() => {
    if (!project || castTrends.length === 0) return null;
    return generateProjectInsights(project, castTrends);
  }, [project, castTrends]);

  const readiness = useMemo(() => {
    if (!project) return null;
    return calculateReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary);
  }, [project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary]);

  const financeReadiness = useMemo(() => {
    if (!project) return null;
    return calculateFinanceReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary);
  }, [project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed, budgetSummary]);

  // Score history: auto-save daily snapshot
  const { history: scoreHistory } = useScoreHistory(id);
  useAutoSaveScore(id, readiness?.score ?? null, financeReadiness?.score ?? null);

  // Pipeline stage auto-suggestion: check if next stage gates are all met
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
        .from('market_buyers')
        .select('*')
        .eq('status', 'active');
      if (buyers && buyers.length > 0) {
        const castTerritories = [...new Set(cast.flatMap(c => c.territory_tags))];
        buyerMatches = matchBuyersToProject(buyers as any[], {
          format: project.format,
          genres: project.genres,
          budget_range: project.budget_range,
          tone: project.tone,
          target_audience: project.target_audience,
          assigned_lane: project.assigned_lane,
          cast_territories: castTerritories,
        });
      }
    } catch { /* proceed without buyer matches */ }

    const totalSpent = costEntries.reduce((s, c) => s + Number(c.amount || 0), 0);
    const lockedBudgets = budgets.filter(b => b.status === 'locked');
    const totalBudget = lockedBudgets.reduce((s, b) => s + Number(b.total_amount), 0);
    const dates = costEntries.map(c => new Date(c.entry_date).getTime()).filter(Boolean);
    const spanMs = dates.length > 1 ? Math.max(...dates) - Math.min(...dates) : 0;
    const weeks = Math.max(1, spanMs / (7 * 24 * 60 * 60 * 1000));
    const burnRate = totalSpent / weeks;

    exportProjectPDF({
      project,
      readiness,
      financeReadiness,
      cast,
      partners,
      hods,
      financeScenarios,
      buyerMatches,
      deals,
      deliverables,
      costSummary: totalSpent > 0 ? { totalSpent, totalBudget, burnRate } : undefined,
    });
  };

  const handleExportDealsCSV = () => {
    if (!project) return;
    exportDealsCSV(deals, project.title);
  };

  const handleExportDeliverablesCSV = () => {
    if (!project) return;
    exportDeliverablesCSV(deliverables, project.title);
  };

  const handleExportCostsCSV = () => {
    if (!project) return;
    exportCostsCSV(costEntries, project.title);
  };

  const getLabel = (value: string, list: readonly { value: string; label: string }[]) =>
    list.find(item => item.value === value)?.label || value;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-3xl py-10">
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
        <main className="container max-w-3xl py-10 text-center">
          <p className="text-muted-foreground">Project not found.</p>
          <Link to="/dashboard">
            <Button variant="link" className="text-primary mt-4">Back to Dashboard</Button>
          </Link>
        </main>
      </div>
    );
  }

  const legacyRecs = (project.recommendations || []) as Recommendation[];
  const analysis = project.analysis_passes as FullAnalysis | null;
  const hasNewAnalysis = analysis?.structural_read != null;
  const hasDocuments = documents.length > 0;
  const currentScript = scripts.find(s => s.status === 'current');
  const hasScript = scripts.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          {/* ─── ALWAYS VISIBLE: Header ─── */}
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            All Projects
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {project.format === 'tv-series' ? (
                  <Tv className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Film className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  {project.format === 'tv-series' ? 'TV Series' : 'Film'}
                </span>
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                {project.title}
              </h1>
              {project.genres && project.genres.length > 0 && (
                <p className="text-muted-foreground mt-1">{project.genres.join(' · ')}</p>
              )}
            </div>

            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Export">
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportPDF}>
                    <FileText className="h-3.5 w-3.5 mr-2" />
                    PDF One-Pager
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {deals.length > 0 && (
                    <DropdownMenuItem onClick={handleExportDealsCSV}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
                      Deals CSV
                    </DropdownMenuItem>
                  )}
                  {deliverables.length > 0 && (
                    <DropdownMenuItem onClick={handleExportDeliverablesCSV}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
                      Deliverables CSV
                    </DropdownMenuItem>
                  )}
                  {costEntries.length > 0 && (
                    <DropdownMenuItem onClick={handleExportCostsCSV}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
                      Costs CSV
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Duplicate as scenario" onClick={handleDuplicate} disabled={duplicate.isPending}>
                {duplicate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Link to="/compare">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="Compare scenarios">
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
                      This will permanently delete the project, its analysis, and all uploaded documents. This action cannot be undone.
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

          {/* ─── ALWAYS VISIBLE: Readiness ─── */}
          {readiness && <ProjectReadinessScore readiness={readiness} />}

          {/* ─── Score Trend Sparklines ─── */}
          {scoreHistory.length >= 2 && (
            <div className="glass-card rounded-xl px-5 py-3 flex flex-wrap gap-6">
              <ScoreSparkline history={scoreHistory} field="readiness_score" label="Readiness Trend" />
              <ScoreSparkline history={scoreHistory} field="finance_readiness_score" label="Finance Trend" />
            </div>
          )}

          {/* ─── ALWAYS VISIBLE: Lane + Confidence ─── */}
          {project.assigned_lane && (
            <div className="glass-card rounded-xl p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Primary Lane</p>
                <LaneBadge lane={project.assigned_lane as MonetisationLane} size="lg" />
              </div>
              {project.confidence != null && (
                <div className="flex-1 max-w-xs">
                  <ConfidenceMeter confidence={project.confidence} />
                </div>
              )}
            </div>
          )}

          {/* ─── ALWAYS VISIBLE: IFFY Verdict ─── */}
          {hasNewAnalysis && analysis?.verdict && (
            <div className="glass-card rounded-xl p-5 border-l-4 border-primary">
              <div className="flex items-start gap-3">
                <MessageSquareQuote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">IFFY Verdict</p>
                  <p className="text-lg font-display font-semibold text-foreground">{analysis.verdict}</p>
                </div>
              </div>
            </div>
          )}

          {/* ─── ALWAYS VISIBLE: Script Status ─── */}
          <div className={cn(
            'flex items-center gap-3 glass-card rounded-lg px-4 py-2.5 text-sm',
            currentScript ? 'border-l-4 border-emerald-500/50' : hasScript ? 'border-l-4 border-amber-500/50' : 'border-l-4 border-muted'
          )}>
            <FileText className={cn('h-4 w-4 shrink-0', currentScript ? 'text-emerald-400' : 'text-muted-foreground')} />
            {currentScript ? (
              <span className="text-foreground">
                Current Script: <strong>{currentScript.version_label}</strong>
                <span className="text-muted-foreground ml-2 text-xs">
                  {new Date(currentScript.created_at).toLocaleDateString()}
                </span>
                {scripts.length > 1 && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    · {scripts.length - 1} archived version{scripts.length > 2 ? 's' : ''}
                  </span>
                )}
              </span>
            ) : hasScript ? (
              <span className="text-muted-foreground">
                {scripts.length} archived script{scripts.length > 1 ? 's' : ''} — no current draft set
              </span>
            ) : (
              <span className="text-muted-foreground">No script attached — upload one to unlock deeper analysis</span>
            )}
          </div>

          {/* ─── Pipeline Stage Suggestion ─── */}
          {id && project && nextStageGates && (
            <PipelineStageSuggestion
              projectId={id}
              currentStage={project.pipeline_stage as PipelineStage}
              nextStageGates={nextStageGates}
            />
          )}

          {/* ═══ COLLAPSIBLE SECTIONS ═══ */}

          {/* 1. Project Details */}
          <Section icon={FileText} title="Project Details" defaultOpen>
            <div className="glass-card rounded-xl p-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-0.5">Budget Range</p>
                  <p className="text-foreground font-medium">{getLabel(project.budget_range, BUDGET_RANGES)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">Target Audience</p>
                  <p className="text-foreground font-medium">{getLabel(project.target_audience, TARGET_AUDIENCES)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">Tone</p>
                  <p className="text-foreground font-medium">{getLabel(project.tone, TONES)}</p>
                </div>
                {project.comparable_titles && (
                  <div>
                    <p className="text-muted-foreground mb-0.5">Comparables</p>
                    <p className="text-foreground font-medium">{project.comparable_titles}</p>
                  </div>
                )}
              </div>
            </div>
            {id && (
              <GeographySelector
                projectId={id}
                primaryTerritory={(project as any).primary_territory || ''}
                secondaryTerritories={(project as any).secondary_territories || []}
              />
            )}
          </Section>

          {/* 2. Analysis & Signals */}
          <Section icon={TrendingUp} title="Analysis & Signals">
            {project && <ProjectRelevantSignals project={project} />}
            {hasNewAnalysis && analysis && <AnalysisPassesDisplay passes={analysis} />}
            {hasNewAnalysis && analysis?.do_next && analysis?.avoid && (
              <DoAvoidSection doNext={analysis.do_next} avoid={analysis.avoid} />
            )}
            {hasNewAnalysis && analysis?.lane_not_suitable && (
              <div className="glass-card rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Lane Not Suitable For</p>
                    <p className="text-sm text-foreground leading-relaxed">{analysis.lane_not_suitable}</p>
                  </div>
                </div>
              </div>
            )}
            {project.reasoning && (
              <div className="glass-card rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <Quote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-display font-semibold text-foreground mb-2">Why This Lane</h4>
                    <p className="text-muted-foreground leading-relaxed">{project.reasoning}</p>
                  </div>
                </div>
              </div>
            )}
            {!hasNewAnalysis && legacyRecs.length > 0 && (
              <div>
                <h4 className="font-display font-semibold text-foreground text-lg mb-3">Recommendations</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  {legacyRecs.map((rec, i) => (
                    <RecommendationCard key={rec.title} rec={rec} index={i} />
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* 2. Intelligence */}
          {insights && (
            <Section icon={Target} title="Intelligence">
              <ProjectInsightPanel insights={insights} />
            </Section>
          )}

          {/* 3. Packaging & Attachments */}
          <Section icon={Package} title="Packaging" badge={
            readiness ? (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {readiness.breakdown.packaging}/30
              </span>
            ) : null
          }>
            {id && <ProjectAttachmentTabs
              projectId={id}
              projectContext={{ title: project.title, format: project.format, budget_range: project.budget_range, genres: project.genres }}
              projectTitle={project.title}
              format={project.format}
              genres={project.genres || []}
              budgetRange={project.budget_range}
              tone={project.tone}
              assignedLane={project.assigned_lane}
              scriptCharacters={scriptCharacters}
              scriptCharactersLoading={scriptCharsLoading}
            />}
            {id && hasDocuments && (
              <ScriptCoverage
                projectId={id}
                projectTitle={project.title}
                format={project.format}
                genres={project.genres || []}
                hasDocuments={hasDocuments}
              />
            )}
          </Section>

          {/* 4. Finance & Incentives */}
          <Section icon={DollarSign} title="Finance & Incentives" badge={
            readiness ? (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {readiness.breakdown.finance}/25
              </span>
            ) : null
          }>
            {financeReadiness && <FinanceReadinessPanel result={financeReadiness} />}
            {id && <FinanceTab projectId={id} />}
            <FinanceWaterfall scenarios={financeScenarios} />
            {project && id && (
              <ProjectIncentivePanel
                projectId={id}
                format={project.format}
                budget_range={project.budget_range}
                genres={project.genres || []}
                onAnalysed={setIncentiveAnalysedThisSession}
              />
            )}
            {id && <DealTracker projectId={id} />}
            {id && <DeadlinePanel projectId={id} />}
          </Section>

          {/* 5. Budget */}
          {id && (
            <Section icon={FileSpreadsheet} title="Budget">
              <BudgetPanel projectId={id} assignedLane={project?.assigned_lane} />
            </Section>
          )}

          {/* 5b. Cost Tracking */}
          {id && (
            <Section icon={Receipt} title="Cost Tracking">
              <CostTrackingPanel projectId={id} />
            </Section>
          )}

          {/* 6. Delivery Intelligence */}
          {id && (
            <Section icon={PackageCheck} title="Delivery Intelligence">
              <DeliveryIntelligencePanel projectId={id} />
            </Section>
          )}

          {/* 7. Contracts */}
          {id && (
            <Section icon={FileSignature} title="Contracts">
              <ContractManagerPanel projectId={id} />
            </Section>
          )}

          {/* 8. Ownership & Waterfall */}
          {id && (
            <Section icon={PieChart} title="Ownership & Waterfall">
              <OwnershipWaterfallPanel projectId={id} />
            </Section>
          )}

          {/* 6. Market & Buyers */}
          <Section icon={BarChart3} title="Market & Buyers">
            {project && <ProjectBuyerMatches project={project} />}
            {project && (
              <ProjectFestivalMatches
                format={project.format}
                genres={project.genres || []}
                budgetRange={project.budget_range}
                tone={project.tone}
                assignedLane={project.assigned_lane}
                pipelineStage={project.pipeline_stage}
              />
            )}
            {project && trendSignals.length > 0 && (
              <MarketWindowAlerts
                genres={project.genres || []}
                tone={project.tone}
                format={project.format}
                signals={trendSignals}
              />
            )}
            {project && (
              <CompAnalysis
                projectTitle={project.title}
                format={project.format}
                genres={project.genres || []}
                budgetRange={project.budget_range}
                tone={project.tone}
                comparableTitles={project.comparable_titles}
              />
            )}
            <TerritoryHeatMap
              partners={partners}
              castTerritories={[...new Set(cast.flatMap(c => c.territory_tags))]}
              incentiveJurisdictions={[]}
            />
          </Section>

          {/* 6. Notes & Documents */}
          <Section icon={StickyNote} title="Notes & Documents">
            {id && <ProjectNoteInput projectId={id} />}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-display font-semibold text-foreground text-lg">
                  {hasDocuments ? 'Uploaded Documents' : 'Documents'}
                </h4>
              </div>
              {hasDocuments && <DocumentsList documents={documents} />}
              <div className={hasDocuments ? 'mt-4' : ''}>
                <AddDocumentsUpload
                  existingCount={documents.length}
                  onUpload={(files, scriptInfo) => addDocuments.mutate({ files, scriptInfo })}
                  isUploading={addDocuments.isPending}
                />
              </div>
            </div>
          </Section>

          {/* 7. Team & Activity */}
          <Section icon={UsersRound} title="Team & Activity">
            {id && <ProjectCollaboratorsPanel projectId={id} isOwner={project.user_id === user?.id} />}
            {id && <ProjectCommentsThread projectId={id} currentUserId={user?.id || null} />}
            {id && <ProjectActivityFeed projectId={id} />}
            {id && <ProjectTimeline projectId={id} />}
          </Section>

        </motion.div>
      </main>
    </div>
  );
}
