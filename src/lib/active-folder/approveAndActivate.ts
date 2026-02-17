/**
 * Client-side helpers for the Active Project Folder.
 */

import { supabase } from '@/integrations/supabase/client';

interface ApproveAndActivateOptions {
  projectId: string;
  documentVersionId: string;
  sourceFlow?: string;
  notes?: string;
}

/**
 * Approve a document version (marks approval_status='approved')
 * and set it as the active doc in the project folder.
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
 * Approve and activate multiple versions at once.
 */
export async function approveAndActivateMany(opts: {
  projectId: string;
  documentVersionIds: string[];
  sourceFlow?: string;
}) {
  const { data, error } = await supabase.functions.invoke('project-folder-engine', {
    body: {
      action: 'approve-many',
      projectId: opts.projectId,
      documentVersionIds: opts.documentVersionIds,
      sourceFlow: opts.sourceFlow || 'manual',
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Manually set a specific version as active for a doc_type_key.
 * By default requires the version to be approved.
 */
export async function setActiveVersion(opts: {
  projectId: string;
  docTypeKey: string;
  documentVersionId: string;
  allowDraft?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke('project-folder-engine', {
    body: {
      action: 'set-active',
      projectId: opts.projectId,
      docTypeKey: opts.docTypeKey,
      documentVersionId: opts.documentVersionId,
      allowDraft: opts.allowDraft || false,
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Initialize the active folder for a project.
 * Returns candidates (does NOT auto-activate). UI should present them for approval.
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
