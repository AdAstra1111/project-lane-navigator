/**
 * CreatorDashboard — The morning view.
 * Shows what needs attention today + all projects.
 * Route: /creator
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2, Zap, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useProjects } from '@/hooks/useProjects';

const FORMAT_BADGES: Record<string, string> = {
  'vertical-drama': 'Vertical Drama',
  'tv-series': 'TV Series',
  'feature': 'Feature Film',
  'film': 'Feature Film',
  'documentary': 'Documentary',
  'limited-series': 'Limited Series',
  'short': 'Short Film',
  'animation': 'Animation',
};

type ProjectStatus = 'needs-review' | 'generating' | 'complete' | 'idle';

function getProjectStatus(project: any): { status: ProjectStatus; message: string } {
  // In production these come from the pipeline state; for now derive from project fields
  const autoRunState = project.auto_run_status;
  if (autoRunState === 'running') {
    const stage = project.pending_doc_type || project.current_stage;
    return {
      status: 'generating',
      message: `Auto-Run running${stage ? ` · ${stage.replace(/_/g, ' ')}` : ''}`,
    };
  }
  if (autoRunState === 'waiting_approval' || project.approval_required_for_doc_type) {
    const stage = project.approval_required_for_doc_type || project.pending_doc_type;
    return {
      status: 'needs-review',
      message: `${stage ? stage.replace(/_/g, ' ') : 'Document'} ready for review`,
    };
  }
  return { status: 'idle', message: 'Continue development' };
}

export default function CreatorDashboard() {
  const navigate = useNavigate();
  const { projects, isLoading } = useProjects();

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const actionableProjects = useMemo(() => {
    if (!projects) return [];
    return projects
      .map((p: any) => ({ project: p, ...getProjectStatus(p) }))
      .filter(({ status }) => status === 'needs-review' || status === 'generating');
  }, [projects]);

  const allProjects = useMemo(() => {
    if (!projects) return [];
    return projects.map((p: any) => ({ project: p, ...getProjectStatus(p) }));
  }, [projects]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <div className="text-xs text-muted-foreground mb-1 uppercase tracking-widest">
              {today}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Good{getTimeOfDay()}, Sebastian.
            </h1>
          </div>
          <Button
            onClick={() => navigate('/projects/new')}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-0"
            size="sm"
          >
            <Plus className="h-3.5 w-3.5" />
            New project
          </Button>
        </div>

        {/* TODAY — actionable section */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-10">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading projects…
          </div>
        ) : actionableProjects.length > 0 ? (
          <section className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Needs your attention
            </h2>
            <div className="space-y-2">
              {actionableProjects.map(({ project, status, message }) => (
                <ActionCard
                  key={project.id}
                  project={project}
                  status={status}
                  message={message}
                  onClick={() => navigate(`/creator/projects/${project.id}`)}
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="mb-10 rounded-xl border border-border/20 bg-muted/20 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              All quiet. Pick a project to continue, or start something new.
            </p>
          </div>
        )}

        {/* ALL PROJECTS */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
            All projects
          </h2>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : allProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/40 px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground mb-3">No projects yet.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/projects/new')}
              >
                Start your first project
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {allProjects.map(({ project, status, message }) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  status={status}
                  message={message}
                  onClick={() => navigate(`/creator/projects/${project.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Action card (needs-review / generating) ──────────────────────────────────

function ActionCard({
  project,
  status,
  message,
  onClick,
}: {
  project: any;
  status: ProjectStatus;
  message: string;
  onClick: () => void;
}) {
  const format = project.deliverable_type || project.format || '';

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-border/30 bg-muted/20 hover:bg-muted/40 transition-colors px-4 py-3 flex items-center gap-4 text-left group"
    >
      <div className={cn(
        "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
        status === 'needs-review' ? "bg-amber-500/15" : "bg-blue-500/10"
      )}>
        {status === 'needs-review'
          ? <AlertCircle className="h-4 w-4 text-amber-400" />
          : <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
        }
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{project.title || 'Untitled'}</div>
        <div className={cn(
          "text-xs mt-0.5 truncate",
          status === 'needs-review' ? "text-amber-400" : "text-blue-400/80"
        )}>
          {message}
        </div>
      </div>

      {status === 'needs-review' && (
        <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white border-0 shrink-0">
          Review →
        </Button>
      )}
    </button>
  );
}

// ── Project card (grid tile) ─────────────────────────────────────────────────

function ProjectCard({
  project,
  status,
  message,
  onClick,
}: {
  project: any;
  status: ProjectStatus;
  message: string;
  onClick: () => void;
}) {
  const format = project.deliverable_type || project.format || '';
  const episodeCount = project.season_episode_count;
  const updatedAt = project.updated_at
    ? new Date(project.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null;

  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-border/20 bg-muted/10 hover:bg-muted/30 transition-colors p-4 text-left group flex flex-col gap-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight line-clamp-2 flex-1">
          {project.title || 'Untitled'}
        </span>
        <StatusDot status={status} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
          {FORMAT_BADGES[format] || format || 'Project'}
        </Badge>
        {episodeCount && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
            {episodeCount} eps
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-auto">
        <Clock className="h-2.5 w-2.5" />
        {updatedAt || 'Never updated'}
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: ProjectStatus }) {
  if (status === 'needs-review') {
    return <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0 mt-1" />;
  }
  if (status === 'generating') {
    return <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse shrink-0 mt-1" />;
  }
  return null;
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
