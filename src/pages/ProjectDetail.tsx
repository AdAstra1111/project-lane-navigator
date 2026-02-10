import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Film, Tv, Target, Palette, DollarSign, Users, Quote, CheckCircle2, ShieldAlert, Trash2, Loader2, AlertTriangle, MessageSquareQuote, FileText, Copy, ArrowLeftRight, Download } from 'lucide-react';
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
import { Header } from '@/components/Header';
import { LaneBadge } from '@/components/LaneBadge';
import { AnalysisPassesDisplay } from '@/components/AnalysisPassesDisplay';
import { DocumentsList } from '@/components/DocumentsList';
import { AddDocumentsUpload } from '@/components/AddDocumentsUpload';
import { ProjectInsightPanel } from '@/components/ProjectInsightPanel';
import { ProjectIncentivePanel } from '@/components/ProjectIncentivePanel';
import { ProjectReadinessScore } from '@/components/ProjectReadinessScore';
import { ProjectAttachmentTabs } from '@/components/ProjectAttachmentTabs';
import { ProjectTimeline } from '@/components/ProjectTimeline';
import { ProjectBuyerMatches } from '@/components/ProjectBuyerMatches';
import { ProjectCollaboratorsPanel } from '@/components/ProjectCollaboratorsPanel';
import { ProjectCommentsThread } from '@/components/ProjectCommentsThread';
import { useProject, useProjectDocuments } from '@/hooks/useProjects';
import { useProjects } from '@/hooks/useProjects';
import { useAddDocuments } from '@/hooks/useAddDocuments';
import { useProjectDuplicate } from '@/hooks/useProjectDuplicate';
import { useActiveCastTrends } from '@/hooks/useTrends';
import { useAuth } from '@/hooks/useAuth';
import { ProjectRelevantSignals } from '@/components/ProjectRelevantSignals';
import { TerritoryHeatMap } from '@/components/TerritoryHeatMap';
import { ScriptCoverage } from '@/components/ScriptCoverage';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { generateProjectInsights } from '@/lib/project-insights';
import { calculateReadiness } from '@/lib/readiness-score';
import { MonetisationLane, Recommendation, FullAnalysis } from '@/lib/types';
import { BUDGET_RANGES, TARGET_AUDIENCES, TONES } from '@/lib/constants';
import { exportProjectPDF } from '@/lib/pdf-export';
import { matchBuyersToProject } from '@/lib/buyer-matcher';



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
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.3 }}
        className="glass-card rounded-xl p-5"
      >
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
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.3 }}
        className="glass-card rounded-xl p-5"
      >
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
      </motion.div>
    </div>
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
  const { user } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [incentiveAnalysed, setIncentiveAnalysed] = useState(false);

  // Attachment hooks for readiness calculation
  const { cast } = useProjectCast(id);
  const { partners } = useProjectPartners(id);
  const { scripts } = useProjectScripts(id);
  const { scenarios: financeScenarios } = useProjectFinance(id);
  const { hods } = useProjectHODs(id);

  const insights = useMemo(() => {
    if (!project || castTrends.length === 0) return null;
    return generateProjectInsights(project, castTrends);
  }, [project, castTrends]);

  const readiness = useMemo(() => {
    if (!project) return null;
    return calculateReadiness(project, cast, partners, scripts, financeScenarios, hods, incentiveAnalysed);
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
    // Fetch buyer data on-demand for export
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

    exportProjectPDF({
      project,
      readiness,
      cast,
      partners,
      hods,
      financeScenarios,
      buyerMatches,
    });
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Back */}
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            All Projects
          </Link>

          {/* Header */}
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
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary shrink-0"
                title="Export PDF one-pager"
                onClick={handleExportPDF}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary shrink-0"
                title="Duplicate as scenario"
                onClick={handleDuplicate}
                disabled={duplicate.isPending}
              >
                {duplicate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Link to="/compare">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-primary shrink-0"
                  title="Compare scenarios"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              </Link>
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  >
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
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={deleteProject.isPending}
                  >
                    {deleteProject.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        Deleting…
                      </>
                    ) : (
                      'Delete Project'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            </div>
          </div>

          {/* Readiness Score */}
          {readiness && <ProjectReadinessScore readiness={readiness} />}

          {/* Script Status Banner */}
          {(() => {
            const currentScript = scripts.find(s => s.status === 'current');
            const hasScript = scripts.length > 0;
            return (
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
            );
          })()}

          {/* Relevant Signals — matched to this project */}
          {project && <ProjectRelevantSignals project={project} />}

          {/* IFFY Verdict */}
          {hasNewAnalysis && analysis?.verdict && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="glass-card rounded-xl p-6 border-l-4 border-primary"
            >
              <div className="flex items-start gap-3">
                <MessageSquareQuote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">IFFY Verdict</p>
                  <p className="text-lg font-display font-semibold text-foreground">{analysis.verdict}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Lane + Confidence */}
          {project.assigned_lane && (
            <div className="glass-card rounded-xl p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Primary Lane</p>
                  <LaneBadge lane={project.assigned_lane as MonetisationLane} size="lg" />
                </div>
              </div>
              {project.confidence != null && <ConfidenceMeter confidence={project.confidence} />}
            </div>
          )}

          {/* Attachment Tabs: Cast, Partners, Scripts, Finance */}
          {id && <ProjectAttachmentTabs projectId={id} projectContext={{ title: project.title, format: project.format, budget_range: project.budget_range, genres: project.genres }} />}

          {/* Project Notes with Impact Analysis */}
          {id && <ProjectNoteInput projectId={id} />}

          {/* Rationale */}
          {project.reasoning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="glass-card rounded-xl p-6"
            >
              <div className="flex items-start gap-3">
                <Quote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-display font-semibold text-foreground mb-2">Why This Lane</h3>
                  <p className="text-muted-foreground leading-relaxed">{project.reasoning}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Script Coverage */}
          {id && hasDocuments && (
            <ScriptCoverage
              projectId={id}
              projectTitle={project.title}
              format={project.format}
              genres={project.genres || []}
              hasDocuments={hasDocuments}
            />
          )}

          {/* Analysis Passes (new format) */}
          {hasNewAnalysis && analysis && (
            <AnalysisPassesDisplay passes={analysis} />
          )}

          {/* DO / AVOID (new format) */}
          {hasNewAnalysis && analysis?.do_next && analysis?.avoid && (
            <DoAvoidSection doNext={analysis.do_next} avoid={analysis.avoid} />
          )}
          {/* Lane NOT suitable for */}
          {hasNewAnalysis && analysis?.lane_not_suitable && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.3 }}
              className="glass-card rounded-xl p-5"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Lane Not Suitable For</p>
                  <p className="text-sm text-foreground leading-relaxed">{analysis.lane_not_suitable}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Intelligence Panel */}
          {insights && <ProjectInsightPanel insights={insights} />}

          {/* Incentives & Co-Production Panel */}
          {project && (
            <ProjectIncentivePanel
              format={project.format}
              budget_range={project.budget_range}
              genres={project.genres || []}
            />
          )}

          {/* Buyer / Market Match Engine */}
          {project && <ProjectBuyerMatches project={project} />}

          {/* Territory Heat Map */}
          <TerritoryHeatMap
            partners={partners}
            castTerritories={[...new Set(cast.flatMap(c => c.territory_tags))]}
            incentiveJurisdictions={[]}
          />

          {/* Legacy Recommendations (old format) */}
          {!hasNewAnalysis && legacyRecs.length > 0 && (
            <div>
              <h3 className="font-display font-semibold text-foreground text-xl mb-4">Recommendations</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {legacyRecs.map((rec, i) => (
                  <RecommendationCard key={rec.title} rec={rec} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* Project Details */}
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-display font-semibold text-foreground mb-4">Project Details</h3>
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

          {/* Team & Collaboration */}
          {id && <ProjectCollaboratorsPanel projectId={id} isOwner={project.user_id === user?.id} />}

          {/* Discussion Thread */}
          {id && <ProjectCommentsThread projectId={id} currentUserId={user?.id || null} />}

          {/* Updates Timeline */}
          {id && <ProjectTimeline projectId={id} />}

          {/* Documents */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-foreground text-xl">
                {hasDocuments ? 'Uploaded Documents' : 'Documents'}
              </h3>
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
        </motion.div>
      </main>
    </div>
  );
}
