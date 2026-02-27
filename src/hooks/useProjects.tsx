import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Project, ProjectInput, ProjectDocument } from '@/lib/types';
import { classifyProject } from '@/lib/lane-classifier';
import { toast } from 'sonner';

async function uploadDocuments(files: File[], userId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const timestamp = Date.now();
    const randomToken = crypto.randomUUID().slice(0, 8);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${timestamp}-${randomToken}-${safeName}`;
    const { error } = await supabase.storage.from('project-documents').upload(path, file);
    if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}




export function useProjects() {
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('projects')
        .select('*', { count: 'exact' })
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      // Warn if approaching limits
      if (count && count > 450) {
        console.warn(`Project count (${count}) approaching query limit. Consider archiving older projects.`);
      }
      return data as unknown as Project[];
    },
  });

  const togglePin = useMutation({
    mutationFn: async ({ projectId, pinned }: { projectId: string; pinned: boolean }) => {
      const { error } = await supabase
        .from('projects')
        .update({ pinned })
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const createProject = useMutation({
    mutationFn: async ({ input, files, companyId }: { input: ProjectInput; files: File[]; companyId?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Upload files to storage
      let documentPaths: string[] = [];
      if (files.length > 0) {
        documentPaths = await uploadDocuments(files, user.id);
      }

      // 2. Use rules-based lane classification only (no AI analysis on upload)
      const fallbackClassification = classifyProject(input);
      const analysisPasses = null;

      // 4. Insert project
      const { data: project, error: insertError } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title: input.title,
          format: input.format,
          genres: input.genres,
          budget_range: input.budget_range,
          target_audience: input.target_audience,
          tone: input.tone,
          comparable_titles: input.comparable_titles,
          assigned_lane: fallbackClassification?.lane || null,
          confidence: fallbackClassification?.confidence ?? null,
          reasoning: fallbackClassification?.reasoning || null,
          recommendations: fallbackClassification
            ? (fallbackClassification.recommendations as unknown as Json)
            : null,
          document_urls: documentPaths,
          analysis_passes: analysisPasses as unknown as Json,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const projectId = (project as any).id;

      // 5. Document records will be created by extract-documents edge function
      // (called separately if user triggers extraction)

      // 6. Detect scripts among uploaded files and create project_scripts records
      const scriptExtensions = ['.fdx', '.fountain'];
      const scriptLikeExtensions = ['.pdf', '.docx', '.doc', '.txt'];
      const scriptKeywordPattern = /script|screenplay|draft|teleplay|pilot|episode|treatment|_rev|\.rev|_d\d|\.d\d|v\d+[._]/i;
      const nonScriptKeywords = /deck|pitch|lookbook|budget|schedule|synopsis|outline|bible|sizzle|one[- ]?sheet|press[- ]?kit|invoice|contract|deal|memo|letter|resume|cv/i;
      const scriptFiles = files.filter(f => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase();
        // Always treat .fdx/.fountain as scripts
        if (scriptExtensions.includes(ext)) return true;
        // Exclude files with non-script keywords
        if (nonScriptKeywords.test(f.name)) return false;
        // If name contains script-related keywords, treat as script
        if (scriptKeywordPattern.test(f.name)) return true;
        // If there's only 1 file and it's a common doc format, assume it's a script
        if (files.length === 1 && scriptLikeExtensions.includes(ext)) return true;
        return false;
      });

      if (scriptFiles.length > 0) {
        for (const file of scriptFiles) {
          const matchingPath = documentPaths.find(p => p.includes(file.name.replace(/[^a-zA-Z0-9._-]/g, '_')));
          await supabase.from('project_scripts').insert({
            project_id: projectId,
            user_id: user.id,
            version_label: file.name.replace(/\.[^.]+$/, ''),
            status: 'current',
            file_path: matchingPath || null,
            notes: 'Auto-detected as script on project creation',
          });
        }
      }

      // 7. Auto-link to production company if specified
      if (companyId) {
        await supabase.from('project_company_links').insert({
          project_id: projectId,
          company_id: companyId,
          user_id: user.id,
        });
      }

      return project as unknown as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['company-projects'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create project');
    },
  });

  const renameProject = useMutation({
    mutationFn: async ({ projectId, title }: { projectId: string; title: string }) => {
      const { error } = await supabase
        .from('projects')
        .update({ title })
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      queryClient.invalidateQueries({ queryKey: ['dev-engine-project'] });
      queryClient.invalidateQueries({ queryKey: ['company-projects'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to rename project');
    },
  });

  const deleteProject = useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['company-projects'] });
      queryClient.invalidateQueries({ queryKey: ['all-company-links'] });
      queryClient.invalidateQueries({ queryKey: ['project-company-links'] });
      toast.success('Project deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete project');
    },
  });

  return { projects, isLoading, error, createProject, deleteProject, togglePin, renameProject };
}

export function useProject(id: string | undefined) {
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      if (!id) throw new Error('No project ID');
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as Project;
    },
    enabled: !!id,
  });

  return { project, isLoading, error };
}

export function useProjectDocuments(projectId: string | undefined) {
  const { data: documents = [], isLoading, error } = useQuery({
    queryKey: ['project-documents', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project ID');
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, project_id, user_id, file_name, file_path, extraction_status, extracted_text, total_pages, pages_analyzed, error_message, created_at, doc_type, ingestion_source, char_count')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Filter out ghost docs: empty file_path + failed/no content + generic name
      const filtered = (data as unknown as ProjectDocument[]).filter(d => {
        if (!d.file_path && d.file_name === 'document' && d.extraction_status === 'failed') return false;
        return true;
      });
      const docs = filtered;

      // For dev-engine docs (empty file_path) AND script_pdf docs, fetch latest version plaintext
      const docsNeedingVersionText = docs.filter(d => !d.file_path || (d.doc_type as string) === 'script_pdf');
      if (docsNeedingVersionText.length > 0) {
        const { data: versions } = await (supabase as any)
          .from('project_document_versions')
          .select('document_id, plaintext, version_number')
          .in('document_id', docsNeedingVersionText.map(d => d.id))
          .order('version_number', { ascending: false });
        if (versions) {
          // Group by document_id, take latest (first due to desc order)
          const latestByDoc: Record<string, string> = {};
          for (const v of versions) {
            if (!latestByDoc[v.document_id] && v.plaintext) {
              latestByDoc[v.document_id] = v.plaintext;
            }
          }
          for (const doc of docs) {
            if (latestByDoc[doc.id]) {
              doc.version_plaintext = latestByDoc[doc.id];
            }
          }
        }
      }

      return docs;
    },
    enabled: !!projectId,
  });

  return { documents, isLoading, error };
}
