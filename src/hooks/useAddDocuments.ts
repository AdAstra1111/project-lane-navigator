import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ScriptInfo {
  isLatestDraft: boolean;
  scriptFiles: string[];
}

async function uploadToStorage(files: File[], userId: string): Promise<{ path: string; fileName: string }[]> {
  const results: { path: string; fileName: string }[] = [];
  for (const file of files) {
    const timestamp = Date.now();
    const randomToken = crypto.randomUUID().slice(0, 8);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${timestamp}-${randomToken}-${safeName}`;
    const { error } = await supabase.storage.from('project-documents').upload(path, file);
    if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    results.push({ path, fileName: file.name });
  }
  return results;
}

export function useAddDocuments(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ files, scriptInfo }: { files: File[]; scriptInfo?: ScriptInfo }) => {
      if (!projectId) throw new Error('No project ID');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Upload files to storage
      const uploadResults = await uploadToStorage(files, user.id);
      const documentPaths = uploadResults.map(r => r.path);

      // 2. Call edge function to extract text and save records
      const { data, error } = await supabase.functions.invoke('extract-documents', {
        body: { projectId, documentPaths },
      });

      if (error) throw new Error(error.message || 'Document extraction failed');
      if (data?.error) throw new Error(data.error);

      // 3. If script detected, create project_scripts record
      if (scriptInfo) {
        const scriptUploads = uploadResults.filter(r =>
          scriptInfo.scriptFiles.includes(r.fileName)
        );

        if (scriptInfo.isLatestDraft) {
          // Archive existing current scripts
          await supabase
            .from('project_scripts')
            .update({ status: 'archived' })
            .eq('project_id', projectId)
            .eq('status', 'current');
        }

        for (const script of scriptUploads) {
          await supabase.from('project_scripts').insert({
            project_id: projectId,
            user_id: user.id,
            version_label: script.fileName.replace(/\.[^.]+$/, ''),
            status: scriptInfo.isLatestDraft ? 'current' : 'archived',
            file_path: script.path,
            notes: scriptInfo.isLatestDraft ? 'Latest draft — auto-detected on upload' : 'Older draft — uploaded for reference',
          });
        }

        // 4. If latest draft, trigger re-analysis
        if (scriptInfo.isLatestDraft) {
          try {
            // Get project data for re-analysis
            const { data: project } = await supabase
              .from('projects')
              .select('*')
              .eq('id', projectId)
              .single();

            if (project) {
              // Get ALL document paths for this project for cumulative analysis
              const { data: allDocs } = await supabase
                .from('project_documents')
                .select('file_path')
                .eq('project_id', projectId);

              const allPaths = allDocs?.map(d => d.file_path) || documentPaths;

              await supabase.functions.invoke('analyze-project', {
                body: {
                  projectInput: {
                    title: project.title,
                    format: project.format,
                    genres: project.genres,
                    budget_range: project.budget_range,
                    target_audience: project.target_audience,
                    tone: project.tone,
                    comparable_titles: project.comparable_titles,
                  },
                  documentPaths: allPaths,
                },
              });

              toast.success('Script recognised — re-analysing project intelligence…');
            }
          } catch (analysisErr) {
            console.error('Re-analysis after script upload failed:', analysisErr);
            // Non-fatal — docs are still uploaded
          }
        }
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-scripts', projectId] });
      if (!variables.scriptInfo) {
        toast.success('Documents uploaded successfully');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to upload documents');
    },
  });
}
