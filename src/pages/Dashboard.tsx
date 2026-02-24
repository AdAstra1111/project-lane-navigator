import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Clapperboard, ArrowLeftRight, Kanban, Archive, FileDown, X, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { ProjectCard } from '@/components/project/ProjectCard';
import { IntroExperience } from '@/components/IntroExperience';
import { GuidedTutorial } from '@/components/GuidedTutorial';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { DashboardAnalytics } from '@/components/dashboard/DashboardAnalytics';
import { DailyBriefing } from '@/components/dashboard/DailyBriefing';
import { DashboardActivityFeed } from '@/components/dashboard/DashboardActivityFeed';
import { ScriptIngestCard } from '@/components/dashboard/ScriptIngestCard';
import { DashboardCountdowns } from '@/components/dashboard/DashboardCountdowns';
import { RoleDashboard } from '@/components/dashboard/RoleDashboard';
import { SlateMomentum } from '@/components/dashboard/SlateMomentum';
import { CrossProjectIntelligence } from '@/components/dashboard/CrossProjectIntelligence';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageTransition } from '@/components/PageTransition';
import { useProjects } from '@/hooks/useProjects';
import { useCompanies } from '@/hooks/useCompanies';
import { useDashboardScores } from '@/hooks/useDashboardScores';
import { useAllCompanyLinks } from '@/hooks/useAllCompanyLinks';
import { exportProjectsCsv } from '@/lib/csv-export';
import { toast } from 'sonner';

export default function Dashboard() {
  const { projects, isLoading, togglePin, deleteProject } = useProjects();
  const { companies } = useCompanies();
  const { linkMap } = useAllCompanyLinks();
  const navigate = useNavigate();
  const primaryCompany = companies.length > 0 ? companies[0] : null;
  const [roleView, setRoleView] = useState<string>('none');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter projects by selected company
  const filteredProjects = useMemo(() => {
    if (selectedCompanyId === 'all') return projects;
    const companyProjectIds = linkMap[selectedCompanyId] || new Set<string>();
    return projects.filter(p => companyProjectIds.has(p.id));
  }, [projects, selectedCompanyId, linkMap]);

  const { data: projectScores = {} } = useDashboardScores(filteredProjects);

  const displayCompany = selectedCompanyId !== 'all'
    ? companies.find(c => c.id === selectedCompanyId) || primaryCompany
    : primaryCompany;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkExport = () => {
    const selected = filteredProjects.filter(p => selectedIds.has(p.id));
    if (selected.length === 0) return;
    exportProjectsCsv(selected);
    toast.success(`Exported ${selected.length} project${selected.length !== 1 ? 's' : ''}`);
    clearSelection();
  };

  const handleBulkDelete = () => {
    selectedIds.forEach(id => deleteProject.mutate(id));
    toast.success(`Deleted ${selectedIds.size} project${selectedIds.size !== 1 ? 's' : ''}`);
    clearSelection();
  };

  const handleTogglePin = (id: string, pinned: boolean) => {
    togglePin.mutate({ projectId: id, pinned });
  };

  return (
    <PageTransition>
    <div className="min-h-screen bg-background">
      <Header />
      <IntroExperience />
      <GuidedTutorial autoShow />
      <main className="container py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
            <div>
              {displayCompany && (
                <div className="mb-3">
                  {displayCompany.logo_url ? (
                    <img
                      src={displayCompany.logo_url}
                      alt={displayCompany.name}
                      className="h-12 max-w-[320px] object-contain rounded-lg invert-0 dark:invert"
                    />
                  ) : (
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: displayCompany.color_accent ? displayCompany.color_accent + '20' : 'hsl(var(--primary) / 0.1)' }}
                    >
                      <Building2 className="h-4 w-4" style={{ color: displayCompany.color_accent || 'hsl(var(--primary))' }} />
                    </div>
                  )}
                </div>
              )}
              
              <p className="text-muted-foreground mt-1">
                {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''} classified
                {selectedCompanyId !== 'all' && ` · ${displayCompany?.name || 'Company'}`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Company filter tabs */}
              {companies.length > 1 && (
                <Select value={selectedCompanyId} onValueChange={(v) => { setSelectedCompanyId(v); clearSelection(); }}>
                  <SelectTrigger className="w-40 h-9 text-sm">
                    <Building2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {filteredProjects.length >= 1 && (
                <Link to="/pipeline">
                  <Button variant="outline" size="sm">
                    <Kanban className="h-4 w-4 mr-1.5" />
                    Pipeline
                  </Button>
                </Link>
              )}
              {filteredProjects.length >= 2 && (
                <Link to="/compare">
                  <Button variant="outline" size="sm">
                    <ArrowLeftRight className="h-4 w-4 mr-1.5" />
                    Compare
                  </Button>
                </Link>
              )}
              <Select value={roleView} onValueChange={setRoleView}>
                <SelectTrigger className="w-32 h-9 text-sm">
                  <SelectValue placeholder="Role View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All Projects</SelectItem>
                  <SelectItem value="producer">Producer</SelectItem>
                  <SelectItem value="sales_agent">Sales Agent</SelectItem>
                  <SelectItem value="lawyer">Lawyer</SelectItem>
                  <SelectItem value="creative">Creative</SelectItem>
                </SelectContent>
              </Select>
              <Link to="/projects/new">
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Project
                </Button>
              </Link>
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-lg px-4 py-2.5 mb-4 flex items-center justify-between"
            >
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleBulkExport}>
                  <FileDown className="h-3.5 w-3.5 mr-1" />
                  Export CSV
                </Button>
                <ConfirmDialog
                  title={`Delete ${selectedIds.size} project${selectedIds.size !== 1 ? 's' : ''}?`}
                  description="This will permanently remove the selected projects and all their data. This cannot be undone."
                  onConfirm={handleBulkDelete}
                >
                  <Button variant="destructive" size="sm">
                    <Archive className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </ConfirmDialog>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearSelection}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          )}

          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="glass-card rounded-xl p-5 animate-pulse">
                  <div className="h-2.5 w-14 bg-muted rounded mb-3" />
                  <div className="h-4 w-36 bg-muted rounded mb-2" />
                  <div className="h-2.5 w-24 bg-muted rounded mb-4" />
                  <div className="h-5 w-20 bg-muted rounded-full" />
                </div>
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="h-14 w-14 rounded-xl bg-muted/50 flex items-center justify-center mb-6">
                <Clapperboard className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                {selectedCompanyId !== 'all' ? 'No projects linked to this company' : 'Start by adding a project'}
              </h2>
              <p className="text-muted-foreground mb-6 max-w-sm">
                {selectedCompanyId !== 'all'
                  ? 'Link projects to this company from the project detail page, or create a new one.'
                  : 'From inception to legacy — one decision at a time. Start with a concept, pitch, or cast attachment.'}
              </p>
              <Link to="/projects/new">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create{selectedCompanyId !== 'all' ? '' : ' First'} Project
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <DailyBriefing projects={filteredProjects} projectScores={projectScores} />
              <OnboardingChecklist projectCount={filteredProjects.length} />

              <ScriptIngestCard projects={filteredProjects} />
              {roleView !== 'none' && (
                <RoleDashboard projects={filteredProjects} role={roleView as any} />
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProjects.map((project, i) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    index={i}
                    readinessScore={projectScores[project.id]?.readiness ?? null}
                    financeReadinessScore={projectScores[project.id]?.financeReadiness ?? null}
                    selected={selectedIds.has(project.id)}
                    onSelect={toggleSelect}
                    onTogglePin={handleTogglePin}
                  />
                ))}
              </div>
              <SlateMomentum projects={filteredProjects} projectScores={projectScores} />
              <CrossProjectIntelligence projects={filteredProjects} projectScores={projectScores} />
              <DashboardAnalytics projects={filteredProjects} />
              <DashboardCountdowns projectTitleMap={Object.fromEntries(filteredProjects.map(p => [p.id, p.title]))} />
              <DashboardActivityFeed />
            </>
          )}
        </motion.div>
      </main>
    </div>
    </PageTransition>
  );
}
