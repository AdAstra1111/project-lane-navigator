/** useProjectNotes — React Query hook for canonical project notes */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listNotes, createNote, triageNote, proposeChangePlan, applyChangePlan, verifyNote, bulkTriageNotes } from './notesApi';
import type { ProjectNote, NoteFilters, TriagePayload } from '@/lib/types/notes';
import { toast } from 'sonner';

export function useProjectNotes(projectId: string | undefined, filters?: NoteFilters) {
  return useQuery({
    queryKey: ['project-notes', projectId, filters],
    queryFn: () => listNotes(projectId!, filters),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useNotesMutations(projectId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project-notes', projectId] });

  const triageMutation = useMutation({
    mutationFn: ({ noteId, triage }: { noteId: string; triage: TriagePayload }) =>
      triageNote(projectId!, noteId, triage),
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposeMutation = useMutation({
    mutationFn: (opts: { noteId: string; fixId?: string; customInstruction?: string; scope?: string; baseVersionId?: string }) =>
      proposeChangePlan(projectId!, opts.noteId, opts),
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: (changeEventId: string) => applyChangePlan(projectId!, changeEventId),
    onSuccess: () => { invalidate(); toast.success('Change plan applied — new version created'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ noteId, result, comment }: { noteId: string; result: 'resolved' | 'reopen'; comment?: string }) =>
      verifyNote(projectId!, noteId, result, comment),
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkTriageMutation = useMutation({
    mutationFn: ({ noteIds, triage }: { noteIds: string[]; triage: TriagePayload }) =>
      bulkTriageNotes(projectId!, noteIds, triage),
    onSuccess: () => { invalidate(); toast.success('Notes triaged'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: (note: Partial<ProjectNote>) => createNote(projectId!, note),
    onSuccess: () => { invalidate(); toast.success('Note created'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { triageMutation, proposeMutation, applyMutation, verifyMutation, bulkTriageMutation, createMutation };
}
