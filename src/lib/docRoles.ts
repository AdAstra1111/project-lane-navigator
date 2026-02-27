/**
 * docRoles.ts — Single source of truth for document role classification.
 * Used to filter system/internal docs from creative docs in the UI.
 */

/** All allowed doc_role values, matching DB column */
export type DocRole =
  | 'creative_primary'
  | 'creative_supporting'
  | 'derived_output'
  | 'system_index'
  | 'system_analysis'
  | 'system_provenance'
  | 'job_artifact';

/** Roles that appear in the main creative Documents panel */
export const CREATIVE_ROLES: readonly DocRole[] = [
  'creative_primary',
  'creative_supporting',
  'derived_output',
];

/** Roles that are system/internal — hidden by default */
export const SYSTEM_ROLES: readonly DocRole[] = [
  'system_index',
  'system_analysis',
  'system_provenance',
  'job_artifact',
];

/** Classify a doc_type string into its canonical doc_role (for new inserts / runtime fallback) */
export function inferDocRole(docType: string): DocRole {
  // Scene graph / change report are system artifacts keyed by source doc ID
  if (docType.startsWith('scene_graph__')) return 'system_index';
  if (docType.startsWith('change_report__')) return 'system_analysis';
  if (docType === 'universe_manifest') return 'system_index';

  // Gate / diagnostic artifacts
  if (docType.startsWith('gate_')) return 'system_analysis';

  // Master build is derived output
  if (docType === 'season_master_script') return 'derived_output';

  // Supporting creative docs
  const supporting = new Set([
    'character_bible', 'format_rules', 'canon', 'nec',
    'project_overview', 'market_positioning', 'creative_brief',
  ]);
  if (supporting.has(docType)) return 'creative_supporting';

  // Everything else is creative primary
  return 'creative_primary';
}

/** Check if a doc_role is a creative role (visible in main panel) */
export function isCreativeRole(role: string | null | undefined): boolean {
  return CREATIVE_ROLES.includes((role || 'creative_primary') as DocRole);
}

/** Check if a doc_role is a system role (hidden by default) */
export function isSystemRole(role: string | null | undefined): boolean {
  return SYSTEM_ROLES.includes((role || 'creative_primary') as DocRole);
}
