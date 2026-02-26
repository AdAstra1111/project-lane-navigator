import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FolderPlus, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  idea: PitchIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApplyDevSeedDialog({ idea, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');

  if (!idea) return null;

  const defaultTitle = idea.title || 'Untitled Project';

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const title = projectTitle.trim() || defaultTitle;

      // 1. Create project
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .insert({
          title,
          user_id: user.id,
          production_format: idea.production_type || 'film',
          genre: idea.genre || '',
          assigned_lane: idea.recommended_lane || 'independent-film',
          budget_range: idea.budget_band || '',
          status: 'development',
          source_pitch_idea_id: idea.id,
        } as any)
        .select('id')
        .single();

      if (projErr) throw projErr;

      // 2. Update pitch idea with promoted_to_project_id
      await supabase
        .from('pitch_ideas')
        .update({ promoted_to_project_id: project.id, status: 'in-development' } as any)
        .eq('id', idea.id);

      // 3. Create initial "Idea" document from the pitch
      const ideaContent = [
        `# ${title}`,
        '',
        `**Logline:** ${idea.logline}`,
        '',
        idea.one_page_pitch || '',
        '',
        idea.why_us ? `**Why Us:** ${idea.why_us}` : '',
      ].filter(Boolean).join('\n');

      const { data: doc } = await supabase
        .from('project_documents')
        .insert({
          project_id: project.id,
          user_id: user.id,
          doc_type: 'idea',
          title: `${title} — Idea`,
        } as any)
        .select('id')
        .single();

      if (doc) {
        await supabase
          .from('project_document_versions')
          .insert({
            document_id: doc.id,
            project_id: project.id,
            version_number: 1,
            content: ideaContent,
            status: 'draft',
            is_current: true,
            created_by: user.id,
          } as any);
      }

      // 4. Invalidate queries
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });

      toast.success('Project created from DevSeed');
      onOpenChange(false);
      navigate(`/projects/${project.id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            Create Project from DevSeed
          </DialogTitle>
          <DialogDescription>
            Creates a new project with the pitch idea as the starting document. Canon and prefs are set as drafts — nothing is committed until you review in the Development Engine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Project Title</Label>
            <Input
              value={projectTitle}
              onChange={e => setProjectTitle(e.target.value)}
              placeholder={defaultTitle}
              className="h-9"
            />
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground mb-1">This will create:</p>
            <p>• New project with lane: <span className="text-foreground">{idea.recommended_lane}</span></p>
            <p>• Initial "Idea" document from the pitch logline & one-pager</p>
            <p>• Genre: <span className="text-foreground">{idea.genre}</span> | Budget: <span className="text-foreground">{idea.budget_band}</span></p>
            <p className="mt-2 text-muted-foreground">⚠ No canon or lane prefs are written — use the Development Engine to iterate.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Skip</Button>
          <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
