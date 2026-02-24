import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Search, FileText, Clock, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileUpload } from '@/components/FileUpload';
import { useAddDocuments } from '@/hooks/useAddDocuments';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Project } from '@/lib/types';

interface ScriptIngestCardProps {
  projects: Project[];
}

export function ScriptIngestCard({ projects }: ScriptIngestCardProps) {
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects[0]?.id || ''
  );
  const [files, setFiles] = useState<File[]>([]);

  const addDocs = useAddDocuments(selectedProjectId || undefined);

  // Fetch recent uploads for the selected project
  const { data: recentDocs = [] } = useQuery({
    queryKey: ['recent-uploads', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, title, doc_type, created_at, file_path')
        .eq('project_id', selectedProjectId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  const handleUpload = async () => {
    if (!selectedProjectId) {
      toast.error('Select a project first');
      return;
    }
    if (files.length === 0) return;

    try {
      await addDocs.mutateAsync({ files, docType: 'document' });
      setFiles([]);
      toast.success('Files uploaded and linked to project');
    } catch {
      // error handled by hook
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="space-y-4">
      {/* Ingest + Review row */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Upload card */}
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              Ingest Script / Docs
            </h3>
          </div>

          {/* Project selector */}
          {projects.length > 0 ? (
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">Create a project first to upload files.</p>
          )}

          <FileUpload files={files} onFilesChange={setFiles} />

          {files.length > 0 && selectedProjectId && (
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={addDocs.isPending}
              className="w-full"
            >
              {addDocs.isPending ? 'Uploading…' : `Upload ${files.length} file${files.length !== 1 ? 's' : ''} to ${selectedProject?.title || 'project'}`}
            </Button>
          )}
        </div>

        {/* Quick actions card */}
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 flex flex-col justify-center items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">Analyse a script in seconds</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(selectedProjectId ? `/quick-review?projectId=${selectedProjectId}` : '/quick-review')}
            >
              <Zap className="h-4 w-4 mr-1.5" />
              Quick Review
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(selectedProjectId ? `/deep-review?projectId=${selectedProjectId}` : '/deep-review')}
            >
              <Search className="h-4 w-4 mr-1.5" />
              Deep Review
            </Button>
          </div>
        </div>
      </div>

      {/* Recent uploads */}
      {recentDocs.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Recent Uploads — {selectedProject?.title}
          </h4>
          <div className="space-y-1">
            {recentDocs.map(doc => (
              <div key={doc.id} className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  <span className="text-xs text-foreground truncate">{doc.title || 'Untitled'}</span>
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">{doc.doc_type}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => navigate(`/quick-review?projectId=${selectedProjectId}&docId=${doc.id}`)}
                  >
                    Quick
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => navigate(`/deep-review?projectId=${selectedProjectId}&docId=${doc.id}`)}
                  >
                    Deep
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
