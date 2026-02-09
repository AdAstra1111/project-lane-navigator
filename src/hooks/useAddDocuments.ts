import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

async function uploadToStorage(files: File[], userId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${timestamp}-${safeName}`;
    const { error } = await supabase.storage.from('project-documents').upload(path, file);
    if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

export function useAddDocuments(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: File[]) => {
      if (!projectId) throw new Error('No project ID');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Upload files to storage
      const documentPaths = await uploadToStorage(files, user.id);

      // 2. Call edge function to extract text and save records
      const { data, error } = await supabase.functions.invoke('extract-documents', {
        body: { projectId, documentPaths },
      });

      if (error) throw new Error(error.message || 'Document extraction failed');
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Documents uploaded successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to upload documents');
    },
  });
}
