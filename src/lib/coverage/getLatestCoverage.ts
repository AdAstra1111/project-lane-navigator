/**
 * Query helpers for fetching latest coverage data.
 */

import { supabase } from '@/integrations/supabase/client';
import type { CoverageRunRow, CoverageSubjectRow } from './types';

/**
 * Get all coverage subjects for a project.
 */
export async function getProjectCoverageSubjects(projectId: string): Promise<CoverageSubjectRow[]> {
  const { data, error } = await supabase
    .from('project_coverage_subjects')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as CoverageSubjectRow[];
}

/**
 * Get the latest coverage run for each subject.
 * Returns a map: subjectId -> latest run.
 */
export async function getLatestRunsBySubject(projectId: string): Promise<Record<string, CoverageRunRow>> {
  const { data, error } = await supabase
    .from('project_coverage_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  
  const map: Record<string, CoverageRunRow> = {};
  for (const row of (data || []) as unknown as CoverageRunRow[]) {
    if (!map[row.subject_id]) {
      map[row.subject_id] = row;
    }
  }
  return map;
}

/**
 * Get the latest run for a specific bundle key.
 */
export async function getLatestBundleRun(projectId: string, bundleKey: string): Promise<CoverageRunRow | null> {
  // Find subject
  const { data: subjects } = await supabase
    .from('project_coverage_subjects')
    .select('id')
    .eq('project_id', projectId)
    .eq('subject_type', 'bundle')
    .eq('bundle_key', bundleKey)
    .limit(1);

  if (!subjects?.length) return null;

  const { data: runs } = await supabase
    .from('project_coverage_runs')
    .select('*')
    .eq('subject_id', subjects[0].id)
    .order('created_at', { ascending: false })
    .limit(1);

  return (runs?.[0] as unknown as CoverageRunRow) || null;
}
