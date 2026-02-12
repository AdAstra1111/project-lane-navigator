import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Clapperboard, ArrowLeftRight, Kanban, Archive, FileDown, X, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { ProjectCard } from '@/components/ProjectCard';
import { IntroExperience } from '@/components/IntroExperience';
import { GuidedTutorial } from '@/components/GuidedTutorial';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { DashboardAnalytics } from '@/components/DashboardAnalytics';
import { DailyBriefing } from '@/components/DailyBriefing';
import { DashboardActivityFeed } from '@/components/DashboardActivityFeed';
import { DashboardCountdowns } from '@/components/DashboardCountdowns';
import { RoleDashboard } from '@/components/RoleDashboard';
import { SlateMomentum } from '@/components/SlateMomentum';
import { CrossProjectIntelligence } from '@/components/CrossProjectIntelligence';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageTransition } from '@/components/PageTransition';
import { useProjects } from '@/hooks/useProjects';
import { useCompanies } from '@/hooks/useCompanies';
import { useDashboardScores } from '@/hooks/useDashboardScores';
import { exportProjectsCsv } from '@/lib/csv-export';
import { toast } from 'sonner';

export default function Dashboard() {
  const { projects, isLoading, togglePin, deleteProject } = useProjects();
  const { companies } = useCompanies();
  const primaryCompany = companies.length > 0 ? companies[0] : null;
  const [roleView, setRoleView] = useState<string>('none');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data: projectScores = {} } = useDashboardScores(projects);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkExport = () => {
    const selected = projects.filter(p => selectedIds.has(p.id));
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
      <main className="container py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-end justify-between mb-8">
            <div>
              {primaryCompany && (
                <div className="flex items-center gap-2.5 mb-3">
                  {primaryCompany.logo_url ? (
                    <img
                      src={primaryCompany.logo_url}
                      alt={primaryCompany.name}
                      className="h-8 max-w-[200px] rounded-md object-contain"
                    />
                  ) : (
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: primaryCompany.color_accent ? primaryCompany.color_accent + '20' : 'hsl(var(--primary) / 0.1)' }}
                    >
                      <Building2 className="h-4 w-4" style={{ color: primaryCompany.color_accent || 'hsl(var(--primary))' }} />
                    </div>
                  )}
                  <span className="text-sm font-medium text-muted-foreground">{primaryCompany.name}</span>
                </div>
              )}
              
              <p className="text-muted-foreground mt-1">
                {projects.length} project{projects.length !== 1 ? 's' : ''} classified
              </p>
            </div>
            <div className="flex items-center gap-2">
              {projects.length >= 1 && (
                <Link to="/pipeline">
                  <Button variant="outline">
                    <Kanban className="h-4 w-4 mr-1.5" />
                    Pipeline
                  </Button>
                </Link>
              )}
              {projects.length >= 2 && (
                <Link to="/compare">
                  <Button variant="outline">
                    <ArrowLeftRight className="h-4 w-4 mr-1.5" />
                    Compare
                  </Button>
                </Link>
              )}
              <Select value={roleView} onValueChange={setRoleView}>
                <SelectTrigger className="w-36">
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
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="glass-card rounded-lg p-5 animate-pulse">
                  <div className="h-3 w-16 bg-muted rounded mb-3" />
                  <div className="h-5 w-40 bg-muted rounded mb-2" />
                  <div className="h-3 w-28 bg-muted rounded mb-4" />
                  <div className="h-6 w-24 bg-muted rounded-full" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center mb-6">
                <Clapperboard className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                Start by adding a project
              </h2>
              <p className="text-muted-foreground mb-6 max-w-sm">
                From inception to legacy — one decision at a time. Start with a concept, pitch, or cast attachment.
              </p>
              <Link to="/projects/new">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create First Project
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <DailyBriefing projects={projects} projectScores={projectScores} />
              <OnboardingChecklist projectCount={projects.length} />
              {roleView !== 'none' && (
                <RoleDashboard projects={projects} role={roleView as any} />
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project, i) => (
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
              <SlateMomentum projects={projects} projectScores={projectScores} />
              <CrossProjectIntelligence projects={projects} projectScores={projectScores} />
              <DashboardAnalytics projects={projects} />
              <DashboardCountdowns projectTitleMap={Object.fromEntries(projects.map(p => [p.id, p.title]))} />
              <DashboardActivityFeed />
            </>
          )}
        </motion.div>
      </main>
    </div>
    </PageTransition>
  );
}
