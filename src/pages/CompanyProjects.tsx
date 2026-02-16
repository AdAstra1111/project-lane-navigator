import { useState, useMemo } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderOpen, Layers, Plus, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExplorerLayout } from '@/components/explorer/ExplorerLayout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useCompany, useCompanyProjects, useProjectCompanies } from '@/hooks/useCompanies';
import { useProjects } from '@/hooks/useProjects';
import { useDashboardScores } from '@/hooks/useDashboardScores';
import { getFormatMeta, FORMAT_META } from '@/lib/mode-engine';
import { normalizeFormat } from '@/lib/format-helpers';
import { Project } from '@/lib/types';

export default function CompanyProjects() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const view = searchParams.get('view') || 'all';
  const typeKey = searchParams.get('type');

  const { data: company } = useCompany(id);
  const { data: companyProjects = [], isLoading } = useCompanyProjects(id);
  const { unlinkProject } = useProjectCompanies(undefined);
  const { data: projectScores = {} } = useDashboardScores(companyProjects as Project[]);
  const { togglePin } = useProjects();

  const setView = (v: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('view', v);
    p.delete('type');
    setSearchParams(p);
  };

  const setType = (t: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('view', 'type');
    p.set('type', t);
    setSearchParams(p);
  };

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const p of companyProjects) {
      const key = normalizeFormat((p as any).format || '') || 'unknown';
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [companyProjects]);

  const sortedTypes = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);
  }, [grouped]);

  const filteredProjects = useMemo(() => {
    if (view === 'type' && typeKey) return grouped[typeKey] || [];
    return companyProjects;
  }, [view, typeKey, grouped, companyProjects]);

  const handleUnlink = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!id) return;
    unlinkProject.mutate({ projectId, companyId: id });
  };

  const getTypeLabel = (key: string) => {
    if (key === 'unknown') return 'Unknown';
    const meta = FORMAT_META.find(f => f.value === key);
    return meta?.label || key;
  };

  const getTypeIcon = (key: string) => {
    const meta = FORMAT_META.find(f => f.value === key);
    return meta?.icon || FolderOpen;
  };

  // Build title
  const pageTitle = view === 'type' && typeKey
    ? `Projects · ${getTypeLabel(typeKey)}`
    : view === 'type'
      ? 'Projects · By Type'
      : 'Projects';

  // Breadcrumbs
  const breadcrumbs: { label: string; to?: string }[] = [
    { label: 'Companies', to: '/companies' },
    { label: company?.name || '…', to: `/companies/${id}` },
  ];
  if (view === 'type' && typeKey) {
    breadcrumbs.push({ label: 'Projects', to: `/companies/${id}/projects` });
    breadcrumbs.push({ label: getTypeLabel(typeKey) });
  } else {
    breadcrumbs.push({ label: 'Projects' });
  }

  return (
    <ExplorerLayout
      breadcrumbs={breadcrumbs}
      title={pageTitle}
      subtitle={`${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''}`}
      actions={
        <div className="flex items-center gap-2">
          {!(view === 'type' && typeKey) && (
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setView('all')}
                className={`px-2.5 py-1 text-xs transition-colors ${view === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >All</button>
              <button
                onClick={() => setView('type')}
                className={`px-2.5 py-1 text-xs transition-colors ${view === 'type' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >By Type</button>
            </div>
          )}
          <Link to="/projects/new">
            <Button size="sm" className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" /> New Project
            </Button>
          </Link>
        </div>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      ) : view === 'type' && !typeKey ? (
        /* By Type folder view */
        <div className="glass-card rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTypes.map((key, i) => {
                const Icon = getTypeIcon(key);
                const count = grouped[key].length;
                const lastUpdated = grouped[key].reduce((latest: string, p: any) => {
                  return p.updated_at > latest ? p.updated_at : latest;
                }, grouped[key][0]?.created_at || '');
                return (
                  <TableRow
                    key={key}
                    className="cursor-pointer group"
                    onClick={() => setType(key)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {getTypeLabel(key)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{count}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {lastUpdated ? new Date(lastUpdated).toLocaleDateString() : '—'}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedTypes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                    No projects yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <FolderOpen className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-display font-semibold text-foreground mb-1 text-sm">No projects found</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            {view === 'type' && typeKey
              ? `No ${getTypeLabel(typeKey)} projects in this company.`
              : 'No projects in this company yet.'}
          </p>
        </div>
      ) : (
        /* Project table view */
        <div className="glass-card rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%]">Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project: any) => {
                const formatMeta = getFormatMeta(normalizeFormat(project.format || ''));
                const readiness = projectScores[project.id]?.readiness;
                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer group"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {project.pinned && <span className="text-[10px]">⭐</span>}
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors truncate max-w-[260px]">
                          {project.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {formatMeta.shortLabel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground capitalize">
                        {project.pipeline_stage?.replace(/-/g, ' ') || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {readiness != null ? (
                        <span className={`text-xs tabular-nums font-medium ${readiness >= 70 ? 'text-emerald-500' : readiness >= 40 ? 'text-amber-500' : 'text-destructive'}`}>
                          {readiness}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {new Date(project.updated_at).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleUnlink(e, project.id)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                          title="Unlink from company"
                        >
                          <Unlink className="h-3 w-3" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </ExplorerLayout>
  );
}
