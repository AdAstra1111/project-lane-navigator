/** Hook for canonical notes engine API calls */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectNote, NoteFilters, TriagePayload, NoteSuggestedFix } from '@/lib/types/notes';

async function callNotesEngine(action: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase.functions.invoke('notes-engine', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function listNotes(projectId: string, filters?: NoteFilters): Promise<ProjectNote[]> {
  const data = await callNotesEngine('list_notes', { projectId, filters });
  return data.notes || [];
}

export async function createNote(projectId: string, note: Partial<ProjectNote>): Promise<ProjectNote> {
  const data = await callNotesEngine('create_note', { projectId, note });
  return data.note;
}

export async function triageNote(projectId: string, noteId: string, triage: TriagePayload): Promise<ProjectNote> {
  const data = await callNotesEngine('triage_note', { projectId, noteId, triage });
  return data.note;
}

export async function proposeChangePlan(
  projectId: string, noteId: string,
  opts?: { fixId?: string; customInstruction?: string; scope?: string; baseVersionId?: string }
) {
  return callNotesEngine('propose_change_plan', { projectId, noteId, ...opts });
}

export async function applyChangePlan(projectId: string, changeEventId: string) {
  return callNotesEngine('apply_change_plan', { projectId, changeEventId });
}

export async function verifyNote(
  projectId: string, noteId: string, result: 'resolved' | 'reopen', comment?: string
) {
  return callNotesEngine('verify_note', { projectId, noteId, result, comment });
}

export async function bulkTriageNotes(projectId: string, noteIds: string[], triage: TriagePayload) {
  return callNotesEngine('bulk_triage', { projectId, noteIds, triage });
}

export async function migrateLegacyNotes(projectId: string) {
  return callNotesEngine('migrate_legacy', { projectId });
}
