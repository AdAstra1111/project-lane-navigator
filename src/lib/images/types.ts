/**
 * Canonical Image System — Types & role definitions.
 * Every image in the system has a declared role, asset group, and canon constraints.
 */

export type ProjectImageRole =
  | 'poster_primary'
  | 'poster_variant'
  | 'character_primary'
  | 'character_variant'
  | 'world_establishing'
  | 'world_detail'
  | 'visual_reference'
  | 'lookbook_cover'
  | 'marketing_variant';

export type AssetGroup = 'character' | 'world' | 'key_moment' | 'visual_language' | 'poster';

export type ShotType =
  | 'close_up'
  | 'medium'
  | 'wide'
  | 'full_body'
  | 'profile'
  | 'over_shoulder'
  | 'detail'
  | 'tableau'
  | 'emotional_variant'
  | 'atmospheric'
  | 'time_variant'
  | 'lighting_ref'
  | 'texture_ref'
  | 'composition_ref'
  | 'color_ref';

export type CurationState = 'active' | 'candidate' | 'archived' | 'rejected';

export interface CanonConstraints {
  era?: string;
  geography?: string;
  culture?: string;
  architecture?: string;
  wardrobe?: string;
  technology_level?: string;
  tone_style?: string;
  forbidden_elements?: string[];
  source_feature?: string;
  section?: string;
}

export interface ProjectImage {
  id: string;
  project_id: string;
  role: ProjectImageRole;
  entity_id: string | null;
  strategy_key: string | null;
  prompt_used: string;
  negative_prompt: string;
  canon_constraints: CanonConstraints;
  storage_path: string;
  storage_bucket: string;
  width: number | null;
  height: number | null;
  is_primary: boolean;
  is_active: boolean;
  source_poster_id: string | null;
  created_at: string;
  created_by: string | null;
  user_id: string;
  provider: string;
  model: string;
  style_mode: string;
  generation_config: Record<string, unknown>;
  /** New Visual Asset System fields */
  asset_group: AssetGroup | null;
  subject: string | null;
  shot_type: ShotType | null;
  curation_state: CurationState;
  /** Provenance — story binding */
  subject_type: string | null;
  subject_ref: string | null;
  generation_purpose: string | null;
  location_ref: string | null;
  moment_ref: string | null;
  /** Resolved signed URL — populated client-side */
  signedUrl?: string;
}

/** Shot packs define what shots to generate per asset group */
export const SHOT_PACKS: Record<AssetGroup, ShotType[]> = {
  character: ['close_up', 'medium', 'full_body', 'profile', 'emotional_variant'],
  world: ['wide', 'atmospheric', 'detail', 'time_variant'],
  key_moment: ['tableau', 'medium', 'close_up', 'wide'],
  visual_language: ['lighting_ref', 'texture_ref', 'composition_ref', 'color_ref'],
  poster: [], // poster uses its own engine
};

/** Human-readable shot type labels */
export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  close_up: 'Close-Up',
  medium: 'Medium Shot',
  wide: 'Wide Shot',
  full_body: 'Full Body',
  profile: 'Profile',
  over_shoulder: 'Over Shoulder',
  detail: 'Detail',
  tableau: 'Tableau',
  emotional_variant: 'Emotional Variant',
  atmospheric: 'Atmospheric',
  time_variant: 'Time Variant',
  lighting_ref: 'Lighting Reference',
  texture_ref: 'Texture Reference',
  composition_ref: 'Composition Reference',
  color_ref: 'Color Reference',
};

/** Role limits — max active images per role */
export const ROLE_LIMITS: Record<ProjectImageRole, number> = {
  poster_primary: 1,
  poster_variant: 6,
  character_primary: 1,
  character_variant: 4,
  world_establishing: 3,
  world_detail: 6,
  visual_reference: 8,
  lookbook_cover: 1,
  marketing_variant: 6,
};

/** Roles that are scoped per entity (e.g., per character) */
export const PER_ENTITY_ROLES: ProjectImageRole[] = [
  'character_primary',
  'character_variant',
];

/** Which roles each document type consumes */
export const DOCUMENT_IMAGE_MAP: Record<string, ProjectImageRole[]> = {
  lookbook: ['poster_primary', 'lookbook_cover', 'character_primary', 'world_establishing', 'visual_reference'],
  character_bible: ['character_primary'],
  world_document: ['world_establishing', 'world_detail'],
  visual_language: ['visual_reference'],
  poster: ['poster_primary', 'poster_variant'],
  marketing: ['marketing_variant', 'poster_primary'],
};
