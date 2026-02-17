/**
 * Client-side helper to approve a document version and activate it in the project folder.
 */

import { supabase } from '@/integrations/supabase/client';

interface ApproveAndActivateOptions {
  projectId: string;
  documentVersionId: string;
  sourceFlow?: string;
  notes?: string;
}

/**
 * Approve a document version and set it as the active doc in the project folder.
 * Calls the project-folder-engine edge function.
 */
export async function approveAndActivate(opts: ApproveAndActivateOptions) {
  const { data, error } = await supabase.functions.invoke('project-folder-engine', {
    body: {
      action: 'approve',
      projectId: opts.projectId,
      documentVersionId: opts.documentVersionId,
      sourceFlow: opts.sourceFlow || 'manual',
      notes: opts.notes,
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Manually set a specific version as active for a doc_type_key.
 */
export async function setActiveVersion(opts: {
  projectId: string;
  docTypeKey: string;
  documentVersionId: string;
}) {
  const { data, error } = await supabase.functions.invoke('project-folder-engine', {
    body: {
      action: 'set-active',
      projectId: opts.projectId,
      docTypeKey: opts.docTypeKey,
      documentVersionId: opts.documentVersionId,
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Initialize the active folder for a project (lazy backfill).
 * Picks latest version per doc_type_key for docs that don't have an active entry yet.
 */
export async function initActiveFolder(projectId: string) {
  const { data, error } = await supabase.functions.invoke('project-folder-engine', {
    body: {
      action: 'init',
      projectId,
    },
  });

  if (error) throw error;
  return data;
}
