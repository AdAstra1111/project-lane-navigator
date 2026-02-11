import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Plus, LinkIcon, Unlink, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { ProjectCard } from '@/components/ProjectCard';
import { useCompany, useCompanyProjects, useProjectCompanies } from '@/hooks/useCompanies';
import { useProjects } from '@/hooks/useProjects';
import { useDashboardScores } from '@/hooks/useDashboardScores';
import { Project } from '@/lib/types';

function LinkProjectControl({ companyId, existingProjectIds }: { companyId: string; existingProjectIds: string[] }) {
  const { projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const { linkProject } = useProjectCompanies(undefined);

  const unlinkedProjects = projects.filter(p => !existingProjectIds.includes(p.id));

  const handleLink = () => {
    if (!selectedProjectId) return;
    linkProject.mutate({ projectId: selectedProjectId, companyId });
    setSelectedProjectId('');
  };

  if (unlinkedProjects.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Link a project..." />
        </SelectTrigger>
        <SelectContent>
          {unlinkedProjects.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={handleLink} disabled={!selectedProjectId || linkProject.isPending}>
        <LinkIcon className="h-3.5 w-3.5 mr-1" />
        Link
      </Button>
    </div>
  );
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: company, isLoading: companyLoading } = useCompany(id);
  const { data: companyProjects = [], isLoading: projectsLoading } = useCompanyProjects(id);
  const { unlinkProject } = useProjectCompanies(undefined);
  const { data: projectScores = {} } = useDashboardScores(companyProjects as Project[]);
  const { togglePin } = useProjects();

  const isLoading = companyLoading || projectsLoading;

  const handleUnlink = (projectId: string) => {
    if (!id) return;
    unlinkProject.mutate({ projectId, companyId: id });
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-10">
          <Link to="/companies" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            All Companies
          </Link>

          {isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-64 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
          ) : company ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                      {company.name}
                    </h1>
                    <p className="text-muted-foreground mt-1">
                      {companyProjects.length} project{companyProjects.length !== 1 ? 's' : ''} linked
                    </p>
                  </div>
                </div>
                <LinkProjectControl
                  companyId={company.id}
                  existingProjectIds={companyProjects.map((p: any) => p.id)}
                />
              </div>

              {companyProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <LinkIcon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-foreground mb-2">No projects linked yet</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Use the dropdown above to link existing projects to this company, or create a new project and link it here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {companyProjects.map((project: any, i: number) => (
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
          ) : (
            <p className="text-muted-foreground">Company not found.</p>
          )}
        </main>
      </div>
    </PageTransition>
  );
}
