import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Clapperboard, ArrowLeftRight, Kanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { ProjectCard } from '@/components/ProjectCard';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { DashboardAnalytics } from '@/components/DashboardAnalytics';
import { RoleDashboard } from '@/components/RoleDashboard';
import { useProjects } from '@/hooks/useProjects';

export default function Dashboard() {
  const { projects, isLoading } = useProjects();
  const [roleView, setRoleView] = useState<string>('none');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <OnboardingOverlay />
      <main className="container py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-end justify-between mb-8">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                Projects
              </h1>
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
                IFFY will guide you one decision at a time. Attach a script, add cast, and build towards finance-ready.
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
              <DashboardAnalytics projects={projects} />
              {roleView !== 'none' && (
                <RoleDashboard projects={projects} role={roleView as any} />
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project, i) => (
                  <ProjectCard key={project.id} project={project} index={i} />
                ))}
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}
