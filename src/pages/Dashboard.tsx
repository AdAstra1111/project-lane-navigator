import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/Header';
import { ProjectCard } from '@/components/ProjectCard';
import { useProjects } from '@/hooks/useProjects';

export default function Dashboard() {
  const { projects, isLoading } = useProjects();

  return (
    <div className="min-h-screen bg-background">
      <Header />
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
            <Link to="/projects/new">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-1.5" />
                New Project
              </Button>
            </Link>
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
                No projects yet
              </h2>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Create your first project and IFFY will classify it into the right monetisation lane.
              </p>
              <Link to="/projects/new">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create First Project
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project, i) => (
                <ProjectCard key={project.id} project={project} index={i} />
              ))}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
