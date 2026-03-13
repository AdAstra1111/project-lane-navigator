/**
 * CreatorProject — The creator-first project view.
 * Three-column layout: Pipeline timeline | Document | Intel panel
 * Route: /creator/projects/:id
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import { PipelineTimeline } from '@/components/creator/PipelineTimeline';
import { IntelPanel } from '@/components/creator/IntelPanel';
import { DocumentViewer } from '@/components/creator/DocumentViewer';
import { useProject, useProjectDocuments } from '@/hooks/useProjects';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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

export default function CreatorProject() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, isLoading: projectLoading } = useProject(id);

  const [activeStage, setActiveStage] = useState<string | undefined>();
  const [autoRun, setAutoRun] = useState(false);
  const [intelCollapsed, setIntelCollapsed] = useState(false);

  const format = (project as any)?.deliverable_type || (project as any)?.format || '';
  const episodeCount = (project as any)?.season_episode_count;

  if (projectLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading project…</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <header className="h-12 border-b border-border/20 flex items-center px-4 gap-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => navigate('/creator')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-semibold truncate">
            {(project as any).title || 'Untitled Project'}
          </h1>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
            {FORMAT_BADGES[format] || format || 'Project'}
            {episodeCount ? ` · ${episodeCount} eps` : ''}
          </Badge>
        </div>

        <div className="ml-auto">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Three-column body */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT: Pipeline timeline (200px) */}
        <aside className="w-[200px] shrink-0 border-r border-border/20 bg-background/80 flex flex-col overflow-hidden">
          <PipelineTimeline
            projectId={id!}
            format={format}
            autoRun={autoRun}
            onAutoRunToggle={setAutoRun}
            onStageClick={setActiveStage}
            activeStage={activeStage}
          />
        </aside>

        {/* CENTRE: Document view */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {activeStage ? (
            <DocumentViewer
              projectId={id!}
              stage={activeStage}
              episodeCount={episodeCount}
              onApproved={() => {
                // Move to the next stage automatically after approval
              }}
            />
          ) : (
            <EmptyState
              projectTitle={(project as any).title}
              onStageSelect={setActiveStage}
            />
          )}
        </main>

        {/* RIGHT: Intel panel (collapsible) */}
        <IntelPanel
          projectId={id!}
          activeStage={activeStage}
          collapsed={intelCollapsed}
          onToggle={() => setIntelCollapsed(v => !v)}
        />
      </div>
    </div>
  );
}

// ── Empty state (no stage selected) ─────────────────────────────────────────

function EmptyState({
  projectTitle,
  onStageSelect,
}: {
  projectTitle: string;
  onStageSelect: (s: string) => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
        <span className="text-2xl">🎬</span>
      </div>
      <div>
        <h3 className="text-base font-semibold mb-1">{projectTitle}</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Select a stage on the left to view and edit that document, or turn on Auto-Run to let IFFY build the pipeline.
        </p>
      </div>
    </div>
  );
}
