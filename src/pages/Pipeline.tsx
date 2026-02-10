import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Film, Tv, Check, X, ChevronRight, GripVertical } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { LaneBadge } from '@/components/LaneBadge';
import { useProjects } from '@/hooks/useProjects';
import { usePipelineStage } from '@/hooks/usePipelineStage';
import { useProjectCast, useProjectPartners, useProjectScripts, useProjectFinance, useProjectHODs } from '@/hooks/useProjectAttachments';
import { getStageGates, type GateCheck } from '@/lib/pipeline-gates';
import { Project, MonetisationLane, PipelineStage, PIPELINE_STAGES } from '@/lib/types';

const STAGE_COLORS: Record<PipelineStage, string> = {
  development: 'border-muted-foreground/30',
  packaging: 'border-primary/40',
  financing: 'border-accent/50',
  'pre-production': 'border-lane-lowbudget/50',
};

const STAGE_HEADER_BG: Record<PipelineStage, string> = {
  development: 'bg-muted/50',
  packaging: 'bg-primary/10',
  financing: 'bg-accent/10',
  'pre-production': 'bg-lane-lowbudget/10',
};

function PipelineProjectCard({ project, nextStage }: { project: Project; nextStage?: PipelineStage }) {
  const { updateStage } = usePipelineStage();
  const { cast } = useProjectCast(project.id);
  const { partners } = useProjectPartners(project.id);
  const { scripts } = useProjectScripts(project.id);
  const { scenarios: financeScenarios } = useProjectFinance(project.id);
  const { hods } = useProjectHODs(project.id);

  const currentGates = useMemo(() =>
    getStageGates(project.pipeline_stage as PipelineStage, project, cast, partners, scripts, financeScenarios, hods, false),
    [project, cast, partners, scripts, financeScenarios, hods]
  );

  const nextGates = useMemo(() => {
    if (!nextStage) return null;
    return getStageGates(nextStage, project, cast, partners, scripts, financeScenarios, hods, false);
  }, [nextStage, project, cast, partners, scripts, financeScenarios, hods]);

  const metCount = currentGates.gates.filter(g => g.met).length;
  const totalCount = currentGates.gates.length;
  const FormatIcon = project.format === 'tv-series' ? Tv : Film;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-lg p-4 group"
    >
      <Link to={`/projects/${project.id}`} className="block mb-3">
        <div className="flex items-start gap-2">
          <FormatIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h4 className="font-display font-semibold text-foreground text-sm truncate group-hover:text-primary transition-colors">
              {project.title}
            </h4>
            {project.genres?.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{project.genres.join(' · ')}</p>
            )}
          </div>
        </div>
      </Link>

      {project.assigned_lane && (
        <div className="mb-3">
          <LaneBadge lane={project.assigned_lane as MonetisationLane} size="sm" />
        </div>
      )}

      {/* Gate progress */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Stage gates</span>
          <span className="font-medium text-foreground">{metCount}/{totalCount}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${totalCount > 0 ? (metCount / totalCount) * 100 : 0}%` }}
          />
        </div>
        <div className="space-y-1">
          {currentGates.gates.map((gate, i) => (
            <GateItem key={i} gate={gate} />
          ))}
        </div>
      </div>

      {/* Advance button */}
      {nextStage && currentGates.allMet && (
        <Button
          size="sm"
          className="w-full text-xs"
          onClick={() => updateStage.mutate({ projectId: project.id, stage: nextStage })}
          disabled={updateStage.isPending}
        >
          Advance to {PIPELINE_STAGES.find(s => s.value === nextStage)?.label}
          <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      )}
    </motion.div>
  );
}

function GateItem({ gate }: { gate: GateCheck }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {gate.met ? (
        <Check className="h-3 w-3 text-primary shrink-0" />
      ) : (
        <X className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      )}
      <span className={gate.met ? 'text-foreground' : 'text-muted-foreground'}>
        {gate.label}
      </span>
    </div>
  );
}

export default function Pipeline() {
  const { projects, isLoading } = useProjects();
  const { updateStage } = usePipelineStage();

  const columns = useMemo(() => {
    return PIPELINE_STAGES.map((stage, idx) => ({
      ...stage,
      projects: projects.filter(p => (p.pipeline_stage || 'development') === stage.value),
      nextStage: idx < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[idx + 1].value : undefined,
    }));
  }, [projects]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center gap-3 mb-8">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                Deal Pipeline
              </h1>
              <p className="text-muted-foreground mt-1">
                Track projects from development to pre-production
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="glass-card rounded-lg p-4 animate-pulse">
                  <div className="h-5 w-24 bg-muted rounded mb-4" />
                  <div className="h-20 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-24">
              <p className="text-muted-foreground mb-4">No projects yet. Create one to start tracking your pipeline.</p>
              <Link to="/projects/new">
                <Button>Create Project</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
              {columns.map((col) => (
                <div key={col.value} className={`rounded-xl border ${STAGE_COLORS[col.value]} min-h-[300px]`}>
                  <div className={`px-4 py-3 rounded-t-xl ${STAGE_HEADER_BG[col.value]} border-b border-border/30`}>
                    <div className="flex items-center justify-between">
                      <h2 className="font-display font-semibold text-foreground text-sm">{col.label}</h2>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {col.projects.length}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 space-y-3">
                    {col.projects.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 text-center py-8">No projects</p>
                    ) : (
                      col.projects.map(project => (
                        <PipelineProjectCard
                          key={project.id}
                          project={project}
                          nextStage={col.nextStage}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
