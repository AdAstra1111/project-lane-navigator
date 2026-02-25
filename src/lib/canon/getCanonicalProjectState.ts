/**
 * getCanonicalProjectState — Single canonical source-of-truth resolver.
 *
 * Loads canon editor fields, locked decisions, and doc set context.
 * Returns merged state with source attribution so all engines and UI
 * components agree on what the project's canonical state is.
 *
 * Precedence:
 *   1. Canon editor saved fields (highest)
 *   2. Locked decisions
 *   3. Doc set summary
 *   4. Unknown
 */

import { supabase } from '@/integrations/supabase/client';

export type CanonSource = 'canon_editor' | 'locked_facts' | 'doc_set' | 'unknown';

export interface CanonEvidence {
  canon_editor_populated: boolean;
  canon_editor_fields: string[];
  locked_decision_count: number;
  locked_decision_ids: string[];
  doc_set_id?: string;
  doc_set_name?: string;
}

export interface CanonicalProjectState {
  state: {
    logline?: string;
    premise?: string;
    characters?: Array<{ name: string; role: string; [k: string]: unknown }>;
    timeline?: string;
    world_rules?: string;
    locations?: string;
    tone_style?: string;
    format_constraints?: string;
    forbidden_changes?: string;
    ongoing_threads?: string;
    [key: string]: unknown;
  };
  source: CanonSource;
  evidence: CanonEvidence;
}

function isNonEmpty(v: unknown): boolean {
  if (!v) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0 && v.some(item => {
    if (typeof item === 'object' && item !== null) {
      return Object.values(item).some(val => typeof val === 'string' && val.trim().length > 0);
    }
    return !!item;
  });
  return false;
}

const CANON_FIELDS = [
  'logline', 'premise', 'characters', 'timeline', 'world_rules',
  'locations', 'tone_style', 'format_constraints', 'forbidden_changes', 'ongoing_threads',
] as const;

export async function getCanonicalProjectState(
  projectId: string,
  _lane?: string,
): Promise<CanonicalProjectState> {
  const evidence: CanonEvidence = {
    canon_editor_populated: false,
    canon_editor_fields: [],
    locked_decision_count: 0,
    locked_decision_ids: [],
  };

  // 1. Load canon editor fields
  let canonJson: Record<string, unknown> = {};
  try {
    const { data } = await (supabase as any)
      .from('project_canon')
      .select('canon_json')
      .eq('project_id', projectId)
      .maybeSingle();
    if (data?.canon_json && typeof data.canon_json === 'object') {
      canonJson = data.canon_json;
    }
  } catch { /* non-fatal */ }

  const populatedFields = CANON_FIELDS.filter(f => isNonEmpty(canonJson[f]));
  evidence.canon_editor_populated = populatedFields.length > 0;
  evidence.canon_editor_fields = populatedFields;

  // 2. Load locked decisions
  let lockedDecisions: Array<{ id: string; title: string; decision_text: string }> = [];
  try {
    const { data } = await supabase
      .from('decision_ledger' as any)
      .select('id, title, decision_text')
      .eq('project_id', projectId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);
    lockedDecisions = (data || []) as any[];
  } catch { /* non-fatal */ }

  evidence.locked_decision_count = lockedDecisions.length;
  evidence.locked_decision_ids = lockedDecisions.map(d => d.id);

  // 3. Determine source + build state
  if (populatedFields.length > 0) {
    // Canon editor is the source of truth
    const state: Record<string, unknown> = {};
    for (const f of CANON_FIELDS) {
      if (isNonEmpty(canonJson[f])) {
        state[f] = canonJson[f];
      }
    }
    return { state, source: 'canon_editor', evidence };
  }

  if (lockedDecisions.length > 0) {
    // Locked decisions are the only source
    const state: Record<string, unknown> = {
      _locked_decisions_summary: lockedDecisions.map(d => d.decision_text).join('; '),
    };
    return { state, source: 'locked_facts', evidence };
  }

  // 4. Unknown — no canon established
  return { state: {}, source: 'unknown', evidence };
}
