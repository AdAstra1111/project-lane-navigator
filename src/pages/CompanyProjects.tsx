import { useState, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderOpen, Layers, ArrowLeft, Plus, LinkIcon, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { ProjectCard } from '@/components/project/ProjectCard';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useCompany, useCompanyProjects, useProjectCompanies } from '@/hooks/useCompanies';
import { useProjects } from '@/hooks/useProjects';
import { useDashboardScores } from '@/hooks/useDashboardScores';
import { getFormatMeta, FORMAT_META } from '@/lib/mode-engine';
import { normalizeFormat } from '@/lib/format-helpers';
import { Project } from '@/lib/types';

export default function CompanyProjects() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Group projects by format
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

  // Filter for type view
  const filteredProjects = useMemo(() => {
    if (view === 'type' && typeKey) {
      return grouped[typeKey] || [];
    }
    return companyProjects;
  }, [view, typeKey, grouped, companyProjects]);

  const handleUnlink = (projectId: string) => {
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

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-10">
          {/* Breadcrumb */}
          <Breadcrumb className="mb-6">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link to="/companies">Companies</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link to={`/companies/${id}`}>{company?.name || '…'}</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              {view === 'type' && typeKey ? (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link to={`/companies/${id}/projects?view=type`}>Projects</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{getTypeLabel(typeKey)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem>
                  <BreadcrumbPage>Projects</BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="flex items-end justify-between mb-8">
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                  {view === 'type' && typeKey ? getTypeLabel(typeKey) : 'Projects'}
                </h1>
                <p className="text-muted-foreground mt-1">
                  {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''}
                  {view === 'type' && typeKey ? ` · ${company?.name}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* View toggle */}
                {!(view === 'type' && typeKey) && (
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button
                      onClick={() => setView('all')}
                      className={`px-3 py-1.5 text-sm transition-colors ${view === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setView('type')}
                      className={`px-3 py-1.5 text-sm transition-colors ${view === 'type' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      By Type
                    </button>
                  </div>
                )}
                <Link to="/projects/new">
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New Project
                  </Button>
                </Link>
              </div>
            </div>

            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="glass-card rounded-lg p-6 animate-pulse">
                    <div className="h-5 w-40 bg-muted rounded mb-2" />
                    <div className="h-3 w-24 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : view === 'type' && !typeKey ? (
              /* By Type folder view */
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedTypes.map((key, i) => {
                  const Icon = getTypeIcon(key);
                  const count = grouped[key].length;
                  const lastUpdated = grouped[key].reduce((latest: string, p: any) => {
                    return p.updated_at > latest ? p.updated_at : latest;
                  }, grouped[key][0]?.created_at || '');
                  return (
                    <motion.button
                      key={key}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                      onClick={() => setType(key)}
                      className="glass-card rounded-lg p-6 text-left transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_30px_hsl(var(--glow-primary))] group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-display font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {getTypeLabel(key)}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {count} project{count !== 1 ? 's' : ''}
                          </p>
                          {lastUpdated && (
                            <p className="text-xs text-muted-foreground/70 mt-1">
                              Updated {new Date(lastUpdated).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <Layers className="h-4 w-4 text-muted-foreground/50 mt-1" />
                      </div>
                    </motion.button>
                  );
                })}
                {sortedTypes.length === 0 && (
                  <p className="text-muted-foreground col-span-full text-center py-12">No projects yet.</p>
                )}
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <FolderOpen className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-2">No projects found</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {view === 'type' && typeKey
                    ? `No ${getTypeLabel(typeKey)} projects in this company.`
                    : 'Link projects to this company to see them here.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProjects.map((project: any, i: number) => (
                  <div key={project.id} className="relative">
                    <ProjectCard
                      project={project}
                      index={i}
                      readinessScore={projectScores[project.id]?.readiness ?? null}
                      financeReadinessScore={projectScores[project.id]?.financeReadiness ?? null}
                      onTogglePin={(pid, pinned) => togglePin.mutate({ projectId: pid, pinned })}
                    />
                    <button
                      onClick={() => handleUnlink(project.id)}
                      className="absolute bottom-3 right-3 z-10 p-1.5 rounded-md bg-background/80 border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                      title="Unlink from company"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </main>
      </div>
    </PageTransition>
  );
}
