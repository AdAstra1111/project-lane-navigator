import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Re-triggers text extraction for all documents in a project
 * that don't yet have extracted_text (pending/failed).
 */
export function useExtractDocuments(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('No project ID');

      // Get documents that are missing extracted text
      const { data: docs, error: fetchErr } = await supabase
        .from('project_documents')
        .select('file_path')
        .eq('project_id', projectId)
        .or('extracted_text.is.null,extraction_status.neq.success');

      if (fetchErr) throw fetchErr;

      let documentPaths = (docs || []).map(d => d.file_path);

      // Fallback: if no project_documents rows, check project.document_urls
      if (documentPaths.length === 0) {
        const { data: project } = await supabase
          .from('projects')
          .select('document_urls')
          .eq('id', projectId)
          .single();

        const urls = (project?.document_urls as string[]) || [];
        if (urls.length > 0) {
          documentPaths = urls;
        } else {
          throw new Error('No documents found to extract');
        }
      }

      const { data, error } = await supabase.functions.invoke('extract-documents', {
        body: { projectId, documentPaths },
      });

      if (error) throw new Error(error.message || 'Extraction failed');
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Document text extraction complete');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to extract documents');
    },
  });
}
