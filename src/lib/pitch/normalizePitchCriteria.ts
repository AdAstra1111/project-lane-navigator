/**
 * Edit-tracking + normalization for Pitch Slate criteria.
 * Only fields explicitly edited by the user are sent as manual_criteria.
 * Unedited optional+autoWhenMissing fields go into auto_fields for Trends resolution.
 */

import { PITCH_CRITERIA_SCHEMA, isFieldEmpty, type CriteriaFieldDef } from './pitchCriteriaSchema';

export type EditedFieldsMap = Record<string, boolean>;

/** Initialize all fields as unedited */
export function initEditedFields(): EditedFieldsMap {
  const map: EditedFieldsMap = {};
  for (const f of PITCH_CRITERIA_SCHEMA) {
    map[f.key] = false;
  }
  return map;
}

/** Mark a field as edited by user interaction */
export function markEdited(edited: EditedFieldsMap, fieldKey: string): EditedFieldsMap {
  return { ...edited, [fieldKey]: true };
}

interface NormalizedResult {
  manual_criteria: Record<string, unknown>;
  auto_fields: string[];
  meta: { edited_fields: string[] };
}

function cleanString(v: unknown, maxLen?: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  let s = v.trim();
  if (s === '' || s === '__any__' || s === '__none__') return undefined;
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function cleanNumber(v: unknown, def: CriteriaFieldDef): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (isNaN(n)) return undefined;
  if (def.min != null && n < def.min) return undefined;
  if (def.max != null && n > def.max) return undefined;
  return n;
}

function cleanStringArray(v: unknown, maxItems?: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const cleaned = v
    .map(x => (typeof x === 'string' ? x.trim() : ''))
    .filter(x => x.length > 0);
  if (cleaned.length === 0) return undefined;
  return maxItems ? cleaned.slice(0, maxItems) : cleaned;
}

/**
 * Normalize pitch criteria:
 * - Only includes fields in manual_criteria if the user explicitly edited them AND value is valid.
 * - Fields that are optional+autoWhenMissing and NOT edited go into auto_fields.
 * - Deterministic ordering throughout.
 */
export function normalizePitchCriteria(
  rawValues: Record<string, unknown>,
  editedFields: EditedFieldsMap
): NormalizedResult {
  const manual: Record<string, unknown> = {};
  const autoFields: string[] = [];
  const editedList: string[] = [];

  for (const def of PITCH_CRITERIA_SCHEMA) {
    const wasEdited = editedFields[def.key] === true;
    const raw = rawValues[def.key];

    if (wasEdited) {
      editedList.push(def.key);

      // Validate and clean the value
      let cleaned: unknown;
      switch (def.type) {
        case 'string':
          cleaned = cleanString(raw, def.maxLen);
          break;
        case 'enum':
          cleaned = cleanString(raw);
          if (cleaned && def.enumValues && !def.enumValues.includes(cleaned as string)) {
            cleaned = undefined;
          }
          break;
        case 'number':
          cleaned = cleanNumber(raw, def);
          break;
        case 'string[]':
          cleaned = cleanStringArray(raw, def.maxItems);
          break;
        case 'boolean':
          cleaned = Boolean(raw);
          break;
      }

      if (cleaned != null) {
        manual[def.key] = cleaned;
      } else if (def.optional && def.autoWhenMissing) {
        // Edited but ended up empty/invalid → treat as auto
        autoFields.push(def.key);
      }
    } else {
      // Not edited
      if (def.optional && def.autoWhenMissing) {
        autoFields.push(def.key);
      }
      // Non-auto unedited fields are simply omitted (not sent, no trends fill)
    }
  }

  // Stable ordering
  autoFields.sort();
  editedList.sort();

  return {
    manual_criteria: manual,
    auto_fields: autoFields,
    meta: { edited_fields: editedList },
  };
}
