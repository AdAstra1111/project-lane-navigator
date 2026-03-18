/**
 * Canonical Image System — Types & role definitions.
 * Every image in the system has a declared role and canon constraints.
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

export interface CanonConstraints {
  era?: string;
  geography?: string;
  culture?: string;
  architecture?: string;
  wardrobe?: string;
  technology_level?: string;
  tone_style?: string;
  forbidden_elements?: string[];
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
  /** Resolved signed URL — populated client-side */
  signedUrl?: string;
}

/** Role limits — max active images per role */
export const ROLE_LIMITS: Record<ProjectImageRole, number> = {
  poster_primary: 1,
  poster_variant: 6,
  character_primary: 1, // per entity_id
  character_variant: 4, // per entity_id
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
