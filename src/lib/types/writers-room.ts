/** Writers' Room for Notes — frontend types */

export type NoteThreadStatus = 'open' | 'chosen' | 'applied' | 'discarded';

export interface NoteThread {
  id: string;
  project_id: string;
  document_id: string;
  version_id: string | null;
  note_hash: string;
  note_snapshot: any;
  status: NoteThreadStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface NoteThreadMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: any;
  created_by: string;
  created_at: string;
}

export interface NoteOption {
  id: string;
  pitch: string;
  what_changes: string[];
  pros: string[];
  cons: string[];
  scope_estimate: string;
  cost_flags: string[];
  risk_flags: string[];
  rewrite_instructions: string[];
}

export interface NoteOptionSet {
  id: string;
  thread_id: string;
  option_set_index: number;
  direction: any;
  pinned_constraints: any;
  options: NoteOption[];
  created_by: string;
  created_at: string;
}

export interface NoteThreadSynthesis {
  chosen_option_id: string;
  direction_summary: string;
  locked_constraints_used: string[];
  rewrite_plan: string[];
  verification_checks: string[];
}

export interface NoteThreadState {
  thread_id: string;
  direction: Record<string, any>;
  pinned_constraints: string[];
  selected_option: NoteOption | null;
  synthesis: NoteThreadSynthesis | null;
  last_generated_set: number | null;
  updated_at: string;
  updated_by: string;
}

export interface WritersRoomData {
  thread: NoteThread;
  state: NoteThreadState;
  messages: NoteThreadMessage[];
  optionSets: NoteOptionSet[];
}
