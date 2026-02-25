/**
 * normalizeCanonFacts — Converts the resolved canonical project state
 * into a flat, categorized list of CanonFact items for the UI.
 */

import type { CanonicalProjectState, CanonSource } from './getCanonicalProjectState';

export type CanonCategory =
  | 'logline' | 'premise' | 'character' | 'world_rule' | 'timeline'
  | 'location' | 'tone_style' | 'format_constraint' | 'ongoing_thread'
  | 'forbidden_change' | 'other';

export type CanonFactStatus = 'accepted' | 'locked' | 'suggested';

export interface CanonFactEvidence {
  canon_version_id?: string;
  decision_id?: string;
  doc_id?: string;
  field?: string;
  index?: number;
}

export interface CanonFact {
  id: string;
  category: CanonCategory;
  text: string;
  status: CanonFactStatus;
  source: CanonSource;
  evidence: CanonFactEvidence;
  /** For character facts, store the full character object */
  characterData?: { name: string; role: string; goals?: string; traits?: string; secrets?: string; relationships?: string };
}

const CATEGORY_LABELS: Record<CanonCategory, string> = {
  logline: 'Logline',
  premise: 'Premise',
  character: 'Character',
  world_rule: 'World Rule',
  timeline: 'Timeline',
  location: 'Location',
  tone_style: 'Tone & Style',
  format_constraint: 'Format Constraint',
  ongoing_thread: 'Ongoing Thread',
  forbidden_change: 'Forbidden Change',
  other: 'Other',
};

export { CATEGORY_LABELS };

function statusForSource(source: CanonSource, category: CanonCategory): CanonFactStatus {
  if (category === 'forbidden_change') return 'locked';
  if (source === 'canon_editor') return 'accepted';
  if (source === 'locked_facts') return 'locked';
  return 'suggested';
}

function splitLines(text: string): string[] {
  return text.split(/\n/).map(l => l.trim()).filter(Boolean);
}

export function normalizeCanonFacts(
  canonState: CanonicalProjectState | null,
): CanonFact[] {
  if (!canonState || !canonState.state) return [];

  const { state, source, evidence } = canonState;
  const facts: CanonFact[] = [];

  // Simple string fields
  const stringFields: Array<{ key: string; category: CanonCategory }> = [
    { key: 'logline', category: 'logline' },
    { key: 'premise', category: 'premise' },
    { key: 'timeline', category: 'timeline' },
    { key: 'world_rules', category: 'world_rule' },
    { key: 'locations', category: 'location' },
    { key: 'tone_style', category: 'tone_style' },
    { key: 'format_constraints', category: 'format_constraint' },
    { key: 'ongoing_threads', category: 'ongoing_thread' },
    { key: 'forbidden_changes', category: 'forbidden_change' },
  ];

  for (const { key, category } of stringFields) {
    const val = state[key];
    if (!val) continue;

    if (typeof val === 'string' && val.trim()) {
      // For multi-line fields, split into separate facts
      if (['world_rule', 'location', 'ongoing_thread', 'forbidden_change'].includes(category)) {
        const lines = splitLines(val);
        lines.forEach((line, i) => {
          facts.push({
            id: `${key}_${i}`,
            category,
            text: line,
            status: statusForSource(source, category),
            source,
            evidence: { field: key, index: i },
          });
        });
      } else {
        facts.push({
          id: key,
          category,
          text: val.trim(),
          status: statusForSource(source, category),
          source,
          evidence: { field: key },
        });
      }
    }
  }

  // Characters
  const chars = state.characters;
  if (Array.isArray(chars)) {
    chars.forEach((ch: any, i: number) => {
      if (!ch || typeof ch !== 'object') return;
      const name = ch.name || 'Unnamed';
      const parts = [name];
      if (ch.role) parts.push(`(${ch.role})`);
      if (ch.goals) parts.push(`— Goals: ${ch.goals}`);

      facts.push({
        id: `character_${i}`,
        category: 'character',
        text: parts.join(' '),
        status: statusForSource(source, 'character'),
        source,
        evidence: { field: 'characters', index: i },
        characterData: ch,
      });
    });
  }

  // Locked decisions summary (if source is locked_facts)
  if (source === 'locked_facts' && state._locked_decisions_summary) {
    const summary = String(state._locked_decisions_summary);
    const parts = summary.split('; ').filter(Boolean);
    parts.forEach((part, i) => {
      facts.push({
        id: `locked_decision_${i}`,
        category: 'other',
        text: part,
        status: 'locked',
        source: 'locked_facts',
        evidence: {
          decision_id: evidence?.locked_decision_ids?.[i],
        },
      });
    });
  }

  return facts;
}
