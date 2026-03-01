/**
 * Pitch Criteria Schema — single source of truth for all slate fields.
 * Every optional field that is not explicitly edited defers to Trends (Auto).
 */

export type FieldType = 'string' | 'enum' | 'number' | 'boolean' | 'string[]';

export interface CriteriaFieldDef {
  key: string;
  type: FieldType;
  optional: boolean;
  /** If true, when field is missing/unedited, backend fills from Trends */
  autoWhenMissing: boolean;
  enumValues?: string[];
  maxLen?: number;
  min?: number;
  max?: number;
  maxItems?: number;
  panel: 'core' | 'world' | 'audience' | 'advanced';
}

export const PITCH_CRITERIA_SCHEMA: CriteriaFieldDef[] = [
  // ─── CORE ───
  { key: 'productionType', type: 'string', optional: false, autoWhenMissing: false, panel: 'core' },
  { key: 'genre', type: 'string', optional: true, autoWhenMissing: true, maxLen: 100, panel: 'core' },
  { key: 'subgenre', type: 'string', optional: true, autoWhenMissing: true, maxLen: 100, panel: 'core' },
  { key: 'culturalTag', type: 'string', optional: true, autoWhenMissing: true, maxLen: 100, panel: 'core' },
  { key: 'toneAnchor', type: 'string', optional: true, autoWhenMissing: true, maxLen: 200, panel: 'core' },
  { key: 'lane', type: 'string', optional: true, autoWhenMissing: true, panel: 'core' },
  { key: 'budgetBand', type: 'string', optional: true, autoWhenMissing: true, panel: 'core' },
  { key: 'epLength', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 300, panel: 'core' },
  { key: 'epCount', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 500, panel: 'core' },
  { key: 'seasonLength', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 100, panel: 'core' },
  { key: 'runtimeMin', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 600, panel: 'core' },
  { key: 'runtimeMax', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 600, panel: 'core' },

  // ─── WORLD ───
  { key: 'settingType', type: 'string', optional: true, autoWhenMissing: true, panel: 'world' },
  { key: 'locationVibe', type: 'string', optional: true, autoWhenMissing: true, maxLen: 200, panel: 'world' },
  { key: 'arenaProfession', type: 'string', optional: true, autoWhenMissing: true, maxLen: 200, panel: 'world' },
  { key: 'romanceTropes', type: 'string[]', optional: true, autoWhenMissing: false, maxItems: 12, panel: 'world' },
  { key: 'heatLevel', type: 'string', optional: true, autoWhenMissing: false, panel: 'world' },
  { key: 'obstacleType', type: 'string', optional: true, autoWhenMissing: false, panel: 'world' },

  // ─── AUDIENCE ───
  { key: 'rating', type: 'string', optional: true, autoWhenMissing: true, panel: 'audience' },
  { key: 'audience', type: 'string', optional: true, autoWhenMissing: true, panel: 'audience' },
  { key: 'languageTerritory', type: 'string', optional: true, autoWhenMissing: true, maxLen: 200, panel: 'audience' },
  { key: 'region', type: 'string', optional: true, autoWhenMissing: true, panel: 'audience' },
  { key: 'platformTarget', type: 'string', optional: true, autoWhenMissing: true, panel: 'audience' },

  // ─── ADVANCED ───
  { key: 'riskLevel', type: 'enum', optional: true, autoWhenMissing: false, enumValues: ['low', 'medium', 'high'], panel: 'advanced' },
  { key: 'noveltyLevel', type: 'enum', optional: true, autoWhenMissing: false, enumValues: ['safe', 'balanced', 'bold'], panel: 'advanced' },
  { key: 'differentiateBy', type: 'string', optional: true, autoWhenMissing: true, panel: 'advanced' },
  { key: 'locationsMax', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 100, panel: 'advanced' },
  { key: 'castSizeMax', type: 'number', optional: true, autoWhenMissing: false, min: 1, max: 200, panel: 'advanced' },
  { key: 'starRole', type: 'string', optional: true, autoWhenMissing: false, panel: 'advanced' },
  { key: 'mustHaveTropes', type: 'string[]', optional: true, autoWhenMissing: false, maxItems: 20, panel: 'advanced' },
  { key: 'avoidTropes', type: 'string[]', optional: true, autoWhenMissing: false, maxItems: 20, panel: 'advanced' },
  { key: 'prohibitedComps', type: 'string[]', optional: true, autoWhenMissing: false, maxItems: 20, panel: 'advanced' },
  { key: 'notes', type: 'string', optional: true, autoWhenMissing: false, maxLen: 2000, panel: 'advanced' },
];

/** Sentinel values that mean "not set" */
const SENTINEL_VALUES = new Set(['__any__', '__none__', '']);

export function isFieldEmpty(value: unknown, type: FieldType): boolean {
  if (value == null) return true;
  if (type === 'string[]') return !Array.isArray(value) || value.length === 0;
  if (type === 'string' || type === 'enum') return typeof value !== 'string' || SENTINEL_VALUES.has(value);
  if (type === 'number') return typeof value === 'string' ? value.trim() === '' : value == null;
  if (type === 'boolean') return false; // booleans are always set
  return true;
}
