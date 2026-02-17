/**
 * Extract structured decision entries from resolved notes and selected options.
 */

export interface DecisionEntry {
  decision_key: string;
  title: string;
  decision_text: string;
  decision_value: Record<string, any> | null;
  source_note_id: string | null;
}

interface NoteInput {
  id?: string;
  note_key?: string;
  category?: string;
  description?: string;
  note?: string;
  severity?: string;
  resolution_directive?: string;
}

interface SelectedOption {
  note_id: string;
  option_id: string;
  custom_direction?: string;
}

/**
 * Generate a decision_key from a note.
 * Prefers note_key if present; otherwise category + short hash.
 */
export function decisionKeyFromNote(note: NoteInput, selectedOption?: SelectedOption): string {
  if (note.note_key) return note.note_key;
  if (note.id) return note.id;

  const cat = note.category || 'general';
  const desc = (note.description || note.note || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const words = desc.split(/\s+/).slice(0, 6).join('_');
  return `${cat}_${words || 'decision'}`;
}

/**
 * Generate human-readable decision text from a note + option.
 */
export function decisionTextFromNote(
  note: NoteInput,
  selectedOption?: SelectedOption,
  globalDirections?: string[],
): string {
  const parts: string[] = [];

  const noteDesc = note.description || note.note || 'Unnamed note';
  parts.push(`Issue: ${noteDesc}`);

  if (note.resolution_directive) {
    parts.push(`Resolution: ${note.resolution_directive}`);
  } else if (selectedOption) {
    if (selectedOption.custom_direction) {
      parts.push(`Decision: Custom — ${selectedOption.custom_direction}`);
    } else {
      parts.push(`Decision: Apply option "${selectedOption.option_id}"`);
    }
  }

  return parts.join(' | ');
}

/**
 * Extract decision entries from a set of resolved notes + selections.
 */
export function extractDecisions(
  notes: NoteInput[],
  selectedOptions?: SelectedOption[],
  globalDirections?: string[],
): DecisionEntry[] {
  const optionMap = new Map<string, SelectedOption>();
  for (const so of selectedOptions || []) {
    optionMap.set(so.note_id, so);
  }

  const entries: DecisionEntry[] = [];

  for (const note of notes) {
    const noteId = note.id || note.note_key || '';
    const option = optionMap.get(noteId);

    entries.push({
      decision_key: decisionKeyFromNote(note, option),
      title: (note.description || note.note || 'Decision').slice(0, 200),
      decision_text: decisionTextFromNote(note, option, globalDirections),
      decision_value: option ? { option_id: option.option_id, custom_direction: option.custom_direction } : null,
      source_note_id: noteId || null,
    });
  }

  // Global directions as separate decisions
  if (globalDirections && globalDirections.length > 0) {
    for (const dir of globalDirections) {
      entries.push({
        decision_key: `global_direction_${dir.slice(0, 20).toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        title: `Global Direction: ${dir.slice(0, 120)}`,
        decision_text: dir,
        decision_value: null,
        source_note_id: null,
      });
    }
  }

  return entries;
}
