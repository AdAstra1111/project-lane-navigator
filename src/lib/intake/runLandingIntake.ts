/**
 * Landing intake pipeline: creates project, uploads files to storage,
 * triggers extraction + analysis via existing edge functions.
 */
import { supabase } from '@/integrations/supabase/client';
import { classifyProject } from '@/lib/lane-classifier';
import type { ProjectFormat, ProjectInput } from '@/lib/types';

interface IntakeFile {
  file: File;
  name: string;
}

interface IntakeResult {
  projectId: string;
  title: string;
}

function inferTitle(files: IntakeFile[]): string {
  const primary = files[0]?.name || 'Untitled';
  return primary.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled Project';
}

function inferFormat(fileName: string): ProjectFormat {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'fdx' || ext === 'fountain') return 'film';
  return 'film';
}

async function uploadToStorage(files: File[], userId: string): Promise<string[]> {
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

export type IntakeProgress = {
  step: 'uploading' | 'creating' | 'extracting' | 'analyzing' | 'done' | 'error';
  message: string;
};

export async function runLandingIntake(
  files: File[],
  onProgress?: (p: IntakeProgress) => void,
): Promise<IntakeResult> {
  const report = (step: IntakeProgress['step'], message: string) => onProgress?.({ step, message });

  // 1. Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const intakeFiles: IntakeFile[] = files.map(f => ({ file: f, name: f.name }));
  const title = inferTitle(intakeFiles);
  const format = inferFormat(intakeFiles[0]?.name || '');

  // 2. Upload files to storage
  report('uploading', `Uploading ${files.length} file${files.length !== 1 ? 's' : ''}…`);
  const documentPaths = await uploadToStorage(files, user.id);

  // 3. Create project
  report('creating', 'Creating project…');
  const projectInput: ProjectInput = {
    title,
    format,
    genres: [],
    budget_range: '',
    target_audience: '',
    tone: '',
    comparable_titles: '',
  };

  const fallback = classifyProject(projectInput);

  const { data: project, error: insertError } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      title,
      format,
      genres: [],
      budget_range: '',
      target_audience: '',
      tone: '',
      comparable_titles: '',
      document_urls: documentPaths,
      assigned_lane: fallback?.lane || null,
      confidence: fallback?.confidence ?? null,
      reasoning: fallback?.reasoning || null,
    })
    .select('id, title')
    .single();

  if (insertError || !project) throw new Error(insertError?.message || 'Failed to create project');

  const projectId = project.id;

  // 4. Extract documents via existing edge function
  report('extracting', 'Extracting text from documents…');
  const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-documents', {
    body: { projectId, documentPaths, docType: 'script' },
  });

  if (extractError) {
    console.error('Extract error:', extractError);
    // Non-fatal: project + files exist; extraction might have partially worked
  }

  // 5. Analysis is NOT auto-triggered on upload.
  // User must choose lane and start Auto-Run from the project page.

  report('done', 'Upload complete — choose lane and start Auto-Run from the project page.');
  return { projectId, title };
}
