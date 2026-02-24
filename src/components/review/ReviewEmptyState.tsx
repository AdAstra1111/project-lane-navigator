import { useNavigate } from 'react-router-dom';
import { FileText, Upload, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjects } from '@/hooks/useProjects';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ReviewEmptyStateProps {
  reviewType: 'quick-review' | 'deep-review';
  onSelectProject: (projectId: string) => void;
  onSelectDoc: (projectId: string, docId: string) => void;
}

export function ReviewEmptyState({ reviewType, onSelectProject, onSelectDoc }: ReviewEmptyStateProps) {
  const { projects } = useProjects();
  const navigate = useNavigate();
  const label = reviewType === 'quick-review' ? 'Quick Review' : 'Deep Review';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center space-y-8">
        <div className="space-y-3">
          <span className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/50">
            IFFY
          </span>
          <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">
            {label}
          </h1>
          <p className="text-sm text-muted-foreground">
            Select a project and document to begin analysis.
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 bg-card/40 p-6 space-y-3">
              <FolderOpen className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">No projects yet. Create one to get started.</p>
              <Button onClick={() => navigate('/projects/new')}>
                Create Project
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-4 text-left">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Pick a project
              </label>
              <Select onValueChange={(id) => onSelectProject(id)}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground/50">
              Or{' '}
              <button
                onClick={() => navigate('/dashboard')}
                className="underline hover:text-foreground transition-colors"
              >
                upload a script from the Dashboard
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sub-component: once project is picked, show doc list */
export function ReviewDocPicker({ projectId, reviewType }: { projectId: string; reviewType: string }) {
  const navigate = useNavigate();

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['project-documents', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, title, doc_type, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-2">Loading documents…</div>;
  }

  if (docs.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/40 p-5 text-center space-y-3">
        <Upload className="h-6 w-6 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        <Button size="sm" variant="outline" onClick={() => navigate('/dashboard')}>
          Go to Dashboard to upload
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2 text-left">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Choose a document
      </label>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {docs.map(doc => (
          <button
            key={doc.id}
            onClick={() => navigate(`/${reviewType}?projectId=${projectId}&docId=${doc.id}`)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-muted/40 transition-colors"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            <span className="text-sm text-foreground truncate flex-1">{doc.title || 'Untitled'}</span>
            <span className="text-[10px] text-muted-foreground/50 shrink-0">{doc.doc_type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
