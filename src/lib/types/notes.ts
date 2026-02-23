/** Canonical Note System — frontend types */

export type NoteSource = 'dev_engine' | 'writers_room' | 'coverage' | 'user' | 'convergence' | 'auto_run';
export type NoteCategory = 'story' | 'character' | 'dialogue' | 'pacing' | 'continuity' | 'canon' | 'format' | 'production' | 'legal';
export type NoteSeverity = 'low' | 'med' | 'high' | 'blocker';
export type NoteTiming = 'now' | 'later' | 'dependent';
export type NoteStatus = 'open' | 'in_progress' | 'applied' | 'dismissed' | 'deferred' | 'needs_decision' | 'reopened';
export type ChangeEventStatus = 'proposed' | 'confirmed' | 'applied' | 'failed';

export interface NoteAnchor {
  kind: 'line_range' | 'scene' | 'beat' | 'doc';
  start?: number;
  end?: number;
  sceneNumber?: number;
  beatId?: string;
  quote?: string;
}

export interface NoteSuggestedFix {
  id: string;
  title: string;
  description: string;
  patch_strategy?: string;
  instructions?: string;
  expected_effect?: string;
  risk_level?: 'low' | 'med' | 'high';
}

export interface ProjectNote {
  id: string;
  project_id: string;
  source: NoteSource;
  doc_type: string | null;
  document_id: string | null;
  version_id: string | null;
  anchor: NoteAnchor | null;
  category: NoteCategory;
  severity: NoteSeverity;
  timing: NoteTiming;
  destination_doc_type: string | null;
  dependent_on_note_id: string | null;
  status: NoteStatus;
  title: string;
  summary: string;
  detail: string | null;
  suggested_fixes: NoteSuggestedFix[] | null;
  applied_change_event_id: string | null;
  legacy_key: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface NoteChangeEvent {
  id: string;
  project_id: string;
  note_id: string;
  document_id: string;
  base_version_id: string | null;
  proposed_patch: any[];
  diff_summary: string | null;
  status: ChangeEventStatus;
  error: string | null;
  result_version_id: string | null;
  created_at: string;
}

export interface NoteEvent {
  id: string;
  project_id: string;
  note_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

export interface PatchSection {
  location: string;
  action: 'replace' | 'insert' | 'delete';
  original_snippet?: string;
  new_snippet?: string;
  rationale?: string;
}

export interface TriagePayload {
  status?: NoteStatus;
  timing?: NoteTiming;
  destinationDocType?: string;
  dependentOnNoteId?: string;
}

export interface NoteFilters {
  docType?: string;
  documentId?: string;
  versionId?: string;
  status?: NoteStatus;
  statuses?: NoteStatus[];
  timing?: NoteTiming;
  category?: NoteCategory;
  severity?: NoteSeverity;
}

export interface EnsureNoteLegacy {
  legacy_key?: string;
  source?: string;
  doc_type?: string | null;
  document_id?: string | null;
  version_id?: string | null;
  category?: string;
  severity?: string;
  timing?: 'now' | 'later' | 'dependent';
  destination_doc_type?: string | null;
  title: string;
  summary: string;
  detail?: string | null;
  suggested_fixes?: any[] | null;
  anchor?: any | null;
}
