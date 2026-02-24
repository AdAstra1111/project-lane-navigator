/**
 * ProjectShell — Unified project workspace frame.
 * Replaces Header on new /projects/:id/* workspace routes.
 * Provides: sticky ProjectBar, left icon-rail, main content, pipeline bar,
 * right inspector drawer (toggled with "\").
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  LayoutGrid, FileText, BookOpen, Image, Film, Briefcase,
  PanelRightOpen, PanelRightClose, ChevronLeft, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/hooks/useProjects';
import { useOperatingMode, type OperatingMode } from '@/hooks/useOperatingMode';
import { LaneBadge } from '@/components/LaneBadge';
import type { MonetisationLane } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/* ── Left-rail link definition ── */
interface RailLink {
  icon: React.ElementType;
  label: string;
  to: string;
  modes: OperatingMode[] | 'all';
}

function buildRailLinks(projectId: string): RailLink[] {
  const p = `/projects/${projectId}`;
  return [
    { icon: LayoutGrid, label: 'Projects',   to: '/dashboard',        modes: 'all' },
    { icon: FileText,   label: 'Script',      to: `${p}/script`,      modes: ['develop'] },
    { icon: BookOpen,   label: 'Canon',       to: `${p}/canon`,       modes: ['develop'] },
    { icon: Image,      label: 'Visual Dev',  to: `${p}/visual-dev`,  modes: ['produce'] },
    { icon: Film,       label: 'Trailer',     to: `${p}/trailer`,     modes: ['produce'] },
    { icon: Briefcase,  label: 'Produce',     to: `${p}/produce`,     modes: ['produce'] },
  ];
}

/* ── Operating Mode Toggle ── */
function OperatingModeToggle({ mode, onChange }: { mode: OperatingMode; onChange: (m: OperatingMode) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5">
      {(['develop', 'produce'] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-all capitalize',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/* ── Right Inspector Drawer ── */
const DRAWER_TABS = ['Versions', 'Analysis', 'AI'] as const;

function InspectorDrawer({ open }: { open: boolean }) {
  const [tab, setTab] = useState<(typeof DRAWER_TABS)[number]>('Versions');

  if (!open) return null;

  return (
    <aside className="w-72 border-l border-border/20 bg-card/30 flex flex-col shrink-0">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/20">
        {DRAWER_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
              tab === t
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted-foreground/50 text-center">
          {tab} panel — coming soon
        </p>
      </div>
    </aside>
  );
}

/* ── Pipeline State Bar ── */
function PipelineStateBar({ stage }: { stage: string | null }) {
  return (
    <div className="h-8 border-t border-border/20 bg-card/20 flex items-center px-4 gap-2 shrink-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Pipeline</span>
      <span className="text-[11px] text-muted-foreground">
        {stage || 'Not classified'}
      </span>
    </div>
  );
}

/* ── Main Shell ── */
interface ProjectShellProps {
  children: ReactNode;
}

export function ProjectShell({ children }: ProjectShellProps) {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { project, isLoading } = useProject(projectId);
  const { mode, setMode } = useOperatingMode(projectId);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Keyboard shortcut: "\" to toggle drawer
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === '\\' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
      }
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!projectId) return null;

  const railLinks = buildRailLinks(projectId);
  const visibleLinks = railLinks.filter(
    (l) => l.modes === 'all' || l.modes.includes(mode),
  );

  const lane = project?.assigned_lane as MonetisationLane | undefined;
  const pipelineStage = (project as any)?.pipeline_stage as string | null ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Top ProjectBar ── */}
      <header className="sticky top-0 z-50 h-12 border-b border-border/20 bg-background/80 backdrop-blur-2xl flex items-center px-3 gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => navigate('/dashboard')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Title + lane */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Link
                to={`/projects/${projectId}`}
                className="text-sm font-display font-semibold text-foreground truncate max-w-[260px] hover:text-primary transition-colors"
              >
                {project?.title || 'Untitled'}
              </Link>
              {lane && <LaneBadge lane={lane} size="sm" />}
              {project?.confidence != null && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">
                  {Math.round(project.confidence * 100)}%
                </span>
              )}
            </>
          )}
        </div>

        {/* Mode toggle */}
        <OperatingModeToggle mode={mode} onChange={setMode} />

        {/* Drawer toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setDrawerOpen(!drawerOpen)}
            >
              {drawerOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Inspector <kbd className="ml-1 text-[10px] bg-muted px-1 rounded">\</kbd>
          </TooltipContent>
        </Tooltip>
      </header>

      {/* ── Body: rail + content + drawer ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        <nav className="w-14 border-r border-border/20 bg-card/20 flex flex-col items-center py-3 gap-1 shrink-0">
          {visibleLinks.map((link) => {
            const active = location.pathname === link.to || (link.to !== '/dashboard' && location.pathname.startsWith(link.to));
            return (
              <Tooltip key={link.to}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate(link.to)}
                    className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center transition-all',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <link.icon className="h-4.5 w-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {link.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Right inspector drawer */}
        <InspectorDrawer open={drawerOpen} />
      </div>

      {/* ── Pipeline state bar ── */}
      <PipelineStateBar stage={pipelineStage} />
    </div>
  );
}
