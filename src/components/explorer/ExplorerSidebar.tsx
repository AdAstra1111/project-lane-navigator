import { useState, useMemo } from 'react';
import { Link, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { Building2, FolderOpen, Layers, Clock, Star, ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCompanies, useCompanyProjects } from '@/hooks/useCompanies';
import { useAllCompanyLinks } from '@/hooks/useAllCompanyLinks';
import { useProjects } from '@/hooks/useProjects';
import { FORMAT_META } from '@/lib/mode-engine';
import { normalizeFormat } from '@/lib/format-helpers';
import { cn } from '@/lib/utils';
import { DeleteProjectDialog } from '@/components/DeleteProjectDialog';

interface TreeItemProps {
  icon: React.ReactNode;
  label: string;
  to?: string;
  active?: boolean;
  depth?: number;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  onDelete?: (e: React.MouseEvent) => void;
}

function TreeItem({ icon, label, to, active, depth = 0, count, expanded, onToggle, children, onDelete }: TreeItemProps) {
  const hasChildren = !!children;
  const content = (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5 px-2 rounded-md text-sm cursor-pointer transition-colors group/tree-item',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={hasChildren && onToggle ? onToggle : undefined}
    >
      {hasChildren ? (
        <span className="w-4 h-4 flex items-center justify-center shrink-0 text-sidebar-foreground/40">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      ) : (
        <span className="w-4 h-4 shrink-0" />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-sidebar-foreground/40 tabular-nums">{count}</span>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover/tree-item:opacity-100 p-0.5 rounded text-sidebar-foreground/30 hover:text-destructive transition-all shrink-0"
          title="Delete project"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  return (
    <div>
      {to && !hasChildren ? <Link to={to}>{content}</Link> : content}
      {hasChildren && expanded && <div>{children}</div>}
    </div>
  );
}

function CompanyTree({ companyId, companyName, onDeleteProject }: { companyId: string; companyName: string; onDeleteProject: (id: string, title: string) => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: projects = [] } = useCompanyProjects(companyId);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [byTypeExpanded, setByTypeExpanded] = useState(false);

  const currentPath = location.pathname;
  const currentView = searchParams.get('view');
  const currentType = searchParams.get('type');

  // Group projects by format for "By Type" tree
  const grouped = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of projects) {
      const key = normalizeFormat((p as any).format || '') || 'unknown';
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [projects]);

  const sortedTypes = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => grouped[b] - grouped[a]);
  }, [grouped]);

  const getTypeLabel = (key: string) => {
    if (key === 'unknown') return 'Unknown';
    const meta = FORMAT_META.find(f => f.value === key);
    return meta?.label || key;
  };

  const recentProjects = useMemo(() => {
    return [...projects]
      .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 10);
  }, [projects]);

  const starredProjects = useMemo(() => {
    return projects.filter((p: any) => p.pinned);
  }, [projects]);

  const isCompanyActive = currentPath === `/companies/${companyId}`;
  const isProjectsAll = currentPath === `/companies/${companyId}/projects` && (!currentView || currentView === 'all');
  const isByTypeRoot = currentPath === `/companies/${companyId}/projects` && currentView === 'type' && !currentType;

  return (
    <>
      <TreeItem
        icon={<Building2 className="h-3.5 w-3.5" />}
        label={companyName}
        to={`/companies/${companyId}`}
        active={isCompanyActive}
        depth={1}
        count={projects.length}
      />
      <TreeItem
        icon={<FolderOpen className="h-3.5 w-3.5" />}
        label="Projects"
        depth={2}
        count={projects.length}
        expanded={projectsExpanded}
        onToggle={() => setProjectsExpanded(!projectsExpanded)}
      >
        <TreeItem
          icon={<FolderOpen className="h-3.5 w-3.5 text-sidebar-foreground/50" />}
          label="All Projects"
          to={`/companies/${companyId}/projects`}
          active={isProjectsAll}
          depth={3}
        />
        <TreeItem
          icon={<Layers className="h-3.5 w-3.5 text-sidebar-foreground/50" />}
          label="By Type"
          depth={3}
          expanded={byTypeExpanded}
          onToggle={() => setByTypeExpanded(!byTypeExpanded)}
        >
          {sortedTypes.map(key => {
            const meta = FORMAT_META.find(f => f.value === key);
            const isActive = currentView === 'type' && currentType === key;
            return (
              <TreeItem
                key={key}
                icon={meta?.icon ? <meta.icon className="h-3.5 w-3.5 text-sidebar-foreground/50" /> : <FolderOpen className="h-3.5 w-3.5 text-sidebar-foreground/50" />}
                label={getTypeLabel(key)}
                to={`/companies/${companyId}/projects?view=type&type=${key}`}
                active={isActive}
                depth={4}
                count={grouped[key]}
              />
            );
          })}
        </TreeItem>
        {recentProjects.length > 0 && (
          <TreeItem
            icon={<Clock className="h-3.5 w-3.5 text-sidebar-foreground/50" />}
            label="Recent"
            depth={3}
            expanded={false}
            onToggle={() => {}}
          >
            {recentProjects.map((p: any) => (
              <TreeItem
                key={p.id}
                icon={<span className="text-[10px]">📄</span>}
                label={p.title}
                to={`/projects/${p.id}`}
                depth={4}
                active={currentPath === `/projects/${p.id}`}
                onDelete={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteProject(p.id, p.title); }}
              />
            ))}
          </TreeItem>
        )}
        {starredProjects.length > 0 && (
          <TreeItem
            icon={<Star className="h-3.5 w-3.5 text-sidebar-foreground/50" />}
            label="Starred"
            depth={3}
            expanded={false}
            onToggle={() => {}}
          >
            {starredProjects.map((p: any) => (
              <TreeItem
                key={p.id}
                icon={<span className="text-[10px]">📄</span>}
                label={p.title}
                to={`/projects/${p.id}`}
                depth={4}
                active={currentPath === `/projects/${p.id}`}
                onDelete={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteProject(p.id, p.title); }}
              />
            ))}
          </TreeItem>
        )}
      </TreeItem>
    </>
  );
}

export function ExplorerSidebar() {
  const { companies, isLoading } = useCompanies();
  const { linkMap } = useAllCompanyLinks();
  const { deleteProject } = useProjects();
  const location = useLocation();
  const { id: paramId } = useParams<{ id: string }>();
  const [companiesExpanded, setCompaniesExpanded] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  // Determine selected company from URL
  const selectedCompanyId = useMemo(() => {
    const match = location.pathname.match(/\/companies\/([^/]+)/);
    return match?.[1] || null;
  }, [location.pathname]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-3 border-b border-sidebar-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
          Explorer
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-2 px-1">
        <TreeItem
          icon={<Building2 className="h-3.5 w-3.5" />}
          label="Companies"
          depth={0}
          count={companies.length}
          expanded={companiesExpanded}
          onToggle={() => setCompaniesExpanded(!companiesExpanded)}
        >
          {isLoading ? (
            <div className="px-6 py-2">
              <div className="h-3 w-24 bg-sidebar-accent rounded animate-pulse" />
            </div>
          ) : companies.length === 0 ? (
            <div className="px-8 py-2 text-xs text-sidebar-foreground/40">
              No companies yet
            </div>
          ) : (
            companies.map(c => {
              const isSelected = selectedCompanyId === c.id;
              if (isSelected) {
                return <CompanyTree key={c.id} companyId={c.id} companyName={c.name} onDeleteProject={(id, title) => setDeleteTarget({ id, title })} />;
              }
              const count = linkMap[c.id]?.size || 0;
              return (
                <TreeItem
                  key={c.id}
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  label={c.name}
                  to={`/companies/${c.id}`}
                  active={false}
                  depth={1}
                  count={count}
                />
              );
            })
          )}
        </TreeItem>
      </div>
      <div className="px-3 py-2 border-t border-sidebar-border">
        <Link to="/projects/new">
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground">
            <Plus className="h-3 w-3 mr-1.5" />
            New Project
          </Button>
        </Link>
      </div>
      <DeleteProjectDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        projectTitle={deleteTarget?.title || ''}
        onConfirm={() => {
          if (deleteTarget) {
            deleteProject.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        isPending={deleteProject.isPending}
      />
    </div>
  );
}
