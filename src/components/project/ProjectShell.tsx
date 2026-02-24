/**
 * ProjectShell — Unified project workspace frame (Week 5 polish).
 * Overlay inspector drawer, refined rail + bar, URL-synced drawer state.
 */
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  LayoutGrid, FileText, BookOpen, Image, Film, Briefcase,
  PanelRightOpen, PanelRightClose, ChevronLeft, Loader2,
  CheckCircle2, AlertTriangle, ArrowRight, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// UI opacity hierarchy for ProjectBar/Rail/Inspector toggle.
// Do NOT inline text-muted-foreground/* here — use SHELL_UI tokens.
// Exempt: OperatingModeToggle, PipelineStateBar, InspectorDrawer tabs (intentional).
const SHELL_UI = {
  meta:        'text-muted-foreground/70',
  inactive:    'text-muted-foreground/60',
  disabled:    'text-muted-foreground/50',
  hoverText:   'hover:text-foreground',
  hoverBg:     'hover:bg-muted/40',
  border:      'border-border/50',
  borderSubtle:'border-border/10',
} as const;

const SHELL_FOCUS = 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';
import { useProject } from '@/hooks/useProjects';
import { useOperatingMode, type OperatingMode } from '@/hooks/useOperatingMode';
import { usePipelineState } from '@/hooks/usePipelineState';
import { LaneBadge } from '@/components/LaneBadge';
import type { MonetisationLane } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AnalysisPanel } from '@/components/project/AnalysisPanel';
import { VersionsPanel } from '@/components/project/VersionsPanel';
import { ActivityLogPanel } from '@/components/project/ActivityLogPanel';

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
    <div className="flex items-center gap-3 h-6">
      {(['develop', 'produce'] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cn(
              'text-xs font-medium capitalize pb-0.5 transition-opacity duration-150 border-b',
              active
                ? 'text-foreground border-foreground/40'
                : 'text-muted-foreground/50 border-transparent hover:text-foreground/70',
            )}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/* ── Right Inspector Drawer (overlay) ── */
const DRAWER_TABS = ['Analysis', 'Versions', 'AI'] as const;
type DrawerTab = (typeof DRAWER_TABS)[number];

function InspectorDrawer({ open, onClose, projectId, activeTab, onTabChange }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  activeTab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus drawer on open
  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Panel */}
      <aside
        ref={drawerRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="fixed top-11 bottom-0 right-0 z-50 w-[420px] max-w-[90vw] border-l border-border/15 bg-card/95 backdrop-blur-xl flex flex-col shadow-2xl outline-none animate-in slide-in-from-right-4 duration-150"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/10 shrink-0">
          <div className="flex items-center gap-0.5">
            {DRAWER_TABS.map((t) => (
              <button
                key={t}
                onClick={() => onTabChange(t)}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
                  activeTab === t
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {activeTab === 'Analysis' && <AnalysisPanel projectId={projectId} mode="compact" />}
          {activeTab === 'Versions' && <VersionsPanel projectId={projectId} />}
          {activeTab === 'AI' && <ActivityLogPanel projectId={projectId} />}
        </div>
      </aside>
    </>
  );
}

/* ── Pipeline State Bar (authoritative via pipeline-brain) ── */

const STAGE_LABELS: Record<string, string> = {
  script: 'Script',
  canon: 'Canon',
  visual_dev: 'Visual Dev',
  trailer: 'Trailer',
  prep: 'Prep',
  blueprint: 'Blueprint',
  treatment: 'Treatment',
  bible: 'Bible',
  pilot: 'Pilot',
  pitch: 'Pitch',
  greenlight: 'Greenlight',
  production: 'Production',
  post: 'Post',
  delivery: 'Delivery',
};

function humanStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function PipelineStateBar({ projectId }: { projectId: string }) {
  const { pipelineState, isLoading } = usePipelineState(projectId);

  if (isLoading || !pipelineState) {
    return (
      <div className="h-8 border-t border-border/10 bg-card/10 flex items-center px-4 gap-3 shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/30">Pipeline</span>
        <div className="flex items-center gap-1">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-2 w-2 rounded-full bg-muted-foreground/10 animate-pulse" />
          ))}
        </div>
        <div className="h-2 w-16 rounded bg-muted-foreground/8 animate-pulse" />
      </div>
    );
  }

  const { currentStage, completedCount, totalStages, nextSteps, pipeline } = pipelineState;
  const nextStep = nextSteps[0];
  const isGate = nextStep?.action === 'approve';

  return (
    <div className="h-8 border-t border-border/10 bg-card/10 flex items-center px-4 gap-3 shrink-0 overflow-x-auto">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/30 shrink-0">Pipeline</span>

      {/* Stepper indicators */}
      <div className="flex items-center gap-1 shrink-0">
        {pipeline.map((stage) => {
          const status = pipelineState.completedStages[stage];
          const isCurrent = stage === currentStage;
          const exists = status?.exists;
          const approved = status?.hasApproved;
          return (
            <Tooltip key={stage}>
              <TooltipTrigger asChild>
                <div className={cn(
                  'relative h-2 w-2 rounded-full transition-all',
                  isCurrent && 'ring-[1.5px] ring-foreground/25 ring-offset-1 ring-offset-background',
                  exists
                    ? 'bg-foreground/30'
                    : 'border border-muted-foreground/20 bg-transparent',
                )}>
                  {approved && (
                    <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-[7px] w-[7px] text-foreground/40" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                {humanStage(stage)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Status text */}
      <div className="flex items-center gap-1.5 text-[11px] shrink-0">
        <span className="text-muted-foreground/40">{completedCount}/{totalStages}</span>
        {currentStage && (
          <>
            <span className="text-muted-foreground/25">·</span>
            <span className="text-foreground/60 font-medium">{humanStage(currentStage)}</span>
          </>
        )}
      </div>

      {/* Next step */}
      {nextStep && (
        <div className="flex items-center gap-1 text-[11px] shrink-0">
          <ArrowRight className="h-3 w-3 text-muted-foreground/20" />
          {isGate && <AlertTriangle className="h-3 w-3 text-muted-foreground/30" />}
          <span className="text-muted-foreground/40">{nextStep.label}</span>
        </div>
      )}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { project, isLoading } = useProject(projectId);
  const { mode, setMode } = useOperatingMode(projectId);

  // ── Drawer state derived from URL (source of truth) ──
  const TAB_MAP: Record<string, DrawerTab> = { analysis: 'Analysis', versions: 'Versions', ai: 'AI' };

  const drawerOpen = searchParams.get('drawer') === 'open';
  const activeTab: DrawerTab = TAB_MAP[searchParams.get('drawerTab')?.toLowerCase() ?? ''] ?? 'Analysis';

  // Normalize: if drawer=open but no drawerTab, add drawerTab=analysis
  useEffect(() => {
    if (searchParams.get('drawer') === 'open' && !searchParams.get('drawerTab')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('drawerTab', 'analysis');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Open drawer with a specific tab
  const syncUrlOpen = useCallback(
    (tab: DrawerTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('drawer', 'open');
        next.set('drawerTab', tab.toLowerCase());
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  // Close drawer — removes only drawer + drawerTab, preserves everything else
  const syncUrlClose = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('drawer');
      next.delete('drawerTab');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleDrawerClose = useCallback(() => {
    syncUrlClose();
  }, [syncUrlClose]);

  const handleDrawerToggle = useCallback(() => {
    if (drawerOpen) {
      syncUrlClose();
    } else {
      syncUrlOpen(activeTab);
    }
  }, [drawerOpen, activeTab, syncUrlOpen, syncUrlClose]);

  const handleTabChange = useCallback(
    (t: DrawerTab) => {
      syncUrlOpen(t);
    },
    [syncUrlOpen],
  );

  // Keyboard shortcut: "\" to toggle drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '\\' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        handleDrawerToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDrawerToggle]);

  if (!projectId) return null;

  const railLinks = buildRailLinks(projectId);
  const visibleLinks = railLinks.filter(
    (l) => l.modes === 'all' || l.modes.includes(mode),
  );

  const lane = project?.assigned_lane as MonetisationLane | undefined;

  return (
    <div className="min-h-screen flex flex-col bg-background" data-project-shell>
      {/* ── Top ProjectBar ── */}
      <header className="sticky top-0 z-50 h-10 border-b border-border/10 bg-background/90 backdrop-blur-2xl flex items-center px-3">
        {/* Left: back + title + metadata */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => navigate('/dashboard')}
            className={cn('h-8 w-8 rounded-md flex items-center justify-center transition-colors shrink-0', SHELL_UI.inactive, SHELL_UI.hoverText, SHELL_UI.hoverBg, SHELL_FOCUS)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {isLoading ? (
            <div className="h-3 w-32 rounded bg-muted-foreground/10 animate-pulse" />
          ) : (
            <>
              <Link
                to={`/projects/${projectId}`}
                className="text-sm font-display font-medium text-foreground truncate max-w-[260px] hover:text-foreground/80 transition-colors"
              >
                {project?.title || 'Untitled'}
              </Link>
              {lane && <LaneBadge lane={lane} size="sm" />}
              {project?.confidence != null && (
                <span className={cn('text-[10px]', SHELL_UI.meta)}>
                  {Math.round(project.confidence * 100)}%
                </span>
              )}
            </>
          )}
        </div>

        {/* Center: mode toggle */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <OperatingModeToggle mode={mode} onChange={setMode} />
        </div>

        {/* Right: drawer toggle */}
        <div className="flex items-center shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleDrawerToggle}
                className={cn(
                  `h-8 w-8 rounded-md flex items-center justify-center transition-colors border ${SHELL_FOCUS}`,
                  drawerOpen
                    ? `text-foreground/70 ${SHELL_UI.border} bg-muted/20`
                    : cn(SHELL_UI.inactive, 'border-transparent', SHELL_UI.hoverText, SHELL_UI.hoverBg),
                )}
              >
                {drawerOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px]">
              Inspector <kbd className="ml-1 text-[9px] bg-muted/50 px-1 rounded">\</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ── Body: rail + content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail — icon-only with active indicator */}
        <nav className="w-12 border-r border-border/10 bg-background flex flex-col items-center py-3 gap-0.5 shrink-0">
          {visibleLinks.map((link) => {
            const active = location.pathname === link.to || (link.to !== '/dashboard' && location.pathname.startsWith(link.to));
            return (
              <Tooltip key={link.to} delayDuration={200}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate(link.to)}
                    className={cn(
                      'relative w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                      active
                        ? 'text-primary'
                        : cn(SHELL_UI.inactive, SHELL_UI.hoverText, SHELL_UI.hoverBg),
                    )}
                  >
                    {/* Active indicator bar */}
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-primary" />
                    )}
                    <link.icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-[10px]">
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
      </div>

      {/* ── Pipeline state bar ── */}
      <PipelineStateBar projectId={projectId} />

      {/* ── Inspector overlay drawer ── */}
      <InspectorDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        projectId={projectId}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
    </div>
  );
}
