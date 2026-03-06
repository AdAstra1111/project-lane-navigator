/**
 * Narrative Unit Engine — Phase 1 Types
 */

export type NUEUnitType =
  | 'PROTAGONIST_OBJECTIVE'
  | 'ANTAGONIST_FORCE'
  | 'SEASON_ENGINE'
  | 'RELATIONSHIP_TENSION'
  | 'MARKET_HOOK';

export interface NarrativeUnit {
  id: string;
  project_id: string;
  unit_type: NUEUnitType;
  unit_key: string;
  payload_json: Record<string, unknown>;
  source_doc_type: string;
  source_doc_version_id: string | null;
  confidence: number;
  extraction_method: string;
  created_at: string;
  updated_at: string;
}

export interface ExtractionResult {
  units: Array<{
    unit_type: NUEUnitType;
    unit_key: string;
    payload_json: Record<string, unknown>;
    source_doc_type: string;
    source_doc_version_id: string | null;
    confidence: number;
    extraction_method: string;
  }>;
  persisted: number;
  errors: string[];
  duration_ms: number;
}

export const UNIT_TYPE_LABELS: Record<NUEUnitType, string> = {
  PROTAGONIST_OBJECTIVE: 'Protagonist Objective',
  ANTAGONIST_FORCE: 'Antagonist Force',
  SEASON_ENGINE: 'Season Engine',
  RELATIONSHIP_TENSION: 'Relationship Tension',
  MARKET_HOOK: 'Market Hook',
};
