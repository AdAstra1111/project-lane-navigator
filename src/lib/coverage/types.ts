/**
 * Project Profile Coverage — Types
 * Additive coverage layer across production types.
 */

// Coverage roles (read-only mapping, never stored in DB as canonical)
export type CoverageRole =
  | 'topline'
  | 'concept'
  | 'market'
  | 'deck'
  | 'blueprint'
  | 'character_bible'
  | 'episode_script'
  | 'feature_script'
  | 'episode_grid'
  | 'season_arc'
  | 'documentary_outline'
  | 'production_draft'
  | 'format_rules'
  | 'other';

export const COVERAGE_ROLE_LABELS: Record<CoverageRole, string> = {
  topline: 'Topline Narrative',
  concept: 'Concept Brief',
  market: 'Market Sheet',
  deck: 'Deck',
  blueprint: 'Blueprint / Series Bible',
  character_bible: 'Character Bible',
  episode_script: 'Episode Script',
  feature_script: 'Feature Script',
  episode_grid: 'Episode Grid',
  season_arc: 'Season Arc',
  documentary_outline: 'Documentary Outline',
  production_draft: 'Production Draft',
  format_rules: 'Format Rules',
  other: 'Document',
};

// Bundle definitions
export type BundleKey = 'PACKAGE' | 'NARRATIVE' | 'COMMERCIAL' | 'DOCU_REALITY';

export interface BundleDef {
  key: BundleKey;
  name: string;
  description: string;
  /** Ordered roles to select from available docs */
  roles: CoverageRole[];
  /** Per-role weights for scoring rollup */
  weights: Partial<Record<CoverageRole, number>>;
  /** Minimum docs for meaningful coverage */
  minDocs: number;
}

// Coverage output schema (v1)
export interface CoverageScoreBlock {
  score: number; // 0-100
  summary: string;
  bullets: string[];
}

export interface CoverageEvidence {
  ref: string; // E1, E2, ...
  document_version_id: string;
  role: string;
  anchor: string;
  note: string;
  kind: 'supported' | 'inference';
}

export interface CoverageContradiction {
  type: string;
  severity: 'high' | 'med' | 'low';
  docA: string; // uuid
  docB: string; // uuid
  description: string;
  evidence_refs: string[];
}

export interface CoverageRiskFlag {
  type: string;
  severity: 'high' | 'med' | 'low';
  description: string;
  evidence_refs: string[];
}

export interface CoverageRecommendation {
  id: string;
  title: string;
  why: string;
  action: string;
  priority: 'high' | 'med' | 'low';
  targets: string[];
}

export interface CoverageOutput {
  schema_version: 'v1';
  subject: {
    subject_type: 'document_version' | 'bundle' | 'project';
    bundle_key: BundleKey | null;
    document_version_ids: string[];
  };
  scores: {
    creative: CoverageScoreBlock;
    commercial: CoverageScoreBlock;
    narrative: CoverageScoreBlock | null;
  };
  confidence: { score: number; drivers: string[] };
  strengths: string[];
  weaknesses: string[];
  recommendations: CoverageRecommendation[];
  risk_flags: CoverageRiskFlag[];
  contradictions: CoverageContradiction[];
  evidence: CoverageEvidence[];
}

// DB row shapes
export interface CoverageSubjectRow {
  id: string;
  project_id: string;
  subject_type: 'document_version' | 'bundle' | 'project';
  document_version_id: string | null;
  bundle_key: string | null;
  bundle_name: string | null;
  bundle_rules: any;
  bundle_document_version_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface CoverageRunRow {
  id: string;
  project_id: string;
  subject_id: string;
  status: string;
  model: string | null;
  output: CoverageOutput;
  creative_score: number | null;
  commercial_score: number | null;
  narrative_score: number | null;
  confidence: number | null;
  risk_flags: CoverageRiskFlag[] | null;
  contradictions: CoverageContradiction[] | null;
  missing_docs: any;
  created_at: string;
}

// Resolved doc info used in UI
export interface CoverageDocInfo {
  documentId: string;
  versionId: string;
  docType: string;
  title: string;
  role: CoverageRole;
  latestRun: CoverageRunRow | null;
}
