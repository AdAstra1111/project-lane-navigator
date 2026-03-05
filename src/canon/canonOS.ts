/**
 * Canon OS — Atomic Unit Store
 *
 * Single source of truth for structured narrative units (characters, events,
 * objects, locations, relationships, themes, rules) extracted from project documents.
 *
 * SHADOW MODE: This system observes and stores units but does NOT affect
 * existing pipelines (Dev Engine, Auto-Run, Promotion). It runs in parallel.
 *
 * Tables: canon_units, canon_unit_mentions, canon_unit_relations
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CanonUnitType =
  | 'character'
  | 'event'
  | 'object'
  | 'location'
  | 'relationship'
  | 'theme'
  | 'rule';

export interface CanonUnit {
  id: string;
  project_id: string;
  unit_type: CanonUnitType;
  label: string;
  attributes: Record<string, unknown>;
  confidence: number;
  source_document_id: string | null;
  source_version_id: string | null;
  provenance_hash: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CanonUnitMention {
  id: string;
  unit_id: string;
  document_id: string;
  version_id: string;
  offset_start: number | null;
  offset_end: number | null;
  confidence: number;
  created_at: string;
}

export interface CanonUnitRelation {
  id: string;
  project_id: string;
  unit_id_from: string;
  unit_id_to: string;
  relation_type: string;
  attributes: Record<string, unknown>;
  confidence: number;
  created_at: string;
}

export interface CreateUnitInput {
  project_id: string;
  unit_type: CanonUnitType;
  label: string;
  attributes?: Record<string, unknown>;
  confidence?: number;
  source_document_id?: string;
  source_version_id?: string;
}

export interface CreateMentionInput {
  unit_id: string;
  document_id: string;
  version_id: string;
  offset_start?: number;
  offset_end?: number;
  confidence?: number;
}

export interface CreateRelationInput {
  project_id: string;
  unit_id_from: string;
  unit_id_to: string;
  relation_type: string;
  attributes?: Record<string, unknown>;
  confidence?: number;
}

// ── Provenance Hash ────────────────────────────────────────────────────────────

function computeProvenanceHash(input: CreateUnitInput): string {
  const raw = `${input.project_id}:${input.unit_type}:${input.label}:${input.source_document_id || ''}:${input.source_version_id || ''}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Core Operations ────────────────────────────────────────────────────────────

/**
 * Create or update a canon unit. Uses UPSERT on (project_id, unit_type, label).
 * Will NOT overwrite if provenance_hash doesn't match (prevents cross-source clobber).
 */
export async function upsertCanonUnit(input: CreateUnitInput): Promise<CanonUnit | null> {
  const provHash = computeProvenanceHash(input);

  // Check for existing unit
  const { data: existing } = await (supabase as any)
    .from('canon_units')
    .select('*')
    .eq('project_id', input.project_id)
    .eq('unit_type', input.unit_type)
    .eq('label', input.label)
    .maybeSingle();

  if (existing) {
    // Provenance guard: only update if provenance matches or original has no provenance
    if (existing.provenance_hash && existing.provenance_hash !== provHash) {
      console.warn(`[IEL] canon_unit_provenance_mismatch { unit: "${input.label}", existing_hash: "${existing.provenance_hash}", new_hash: "${provHash}" }`);
      return existing as CanonUnit;
    }

    const { data: updated, error } = await (supabase as any)
      .from('canon_units')
      .update({
        attributes: { ...(existing.attributes || {}), ...(input.attributes || {}) },
        confidence: input.confidence ?? existing.confidence,
        source_document_id: input.source_document_id ?? existing.source_document_id,
        source_version_id: input.source_version_id ?? existing.source_version_id,
        provenance_hash: provHash,
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error(`[IEL] canon_unit_update_failed { unit: "${input.label}", error: "${error.message}" }`);
      return null;
    }
    console.log(`[IEL] canon_unit_updated { id: "${updated.id}", label: "${updated.label}", type: "${updated.unit_type}" }`);
    return updated as CanonUnit;
  }

  // Create new unit
  const { data: created, error } = await (supabase as any)
    .from('canon_units')
    .insert({
      project_id: input.project_id,
      unit_type: input.unit_type,
      label: input.label,
      attributes: input.attributes || {},
      confidence: input.confidence ?? 1.0,
      source_document_id: input.source_document_id || null,
      source_version_id: input.source_version_id || null,
      provenance_hash: provHash,
    })
    .select()
    .single();

  if (error) {
    // Handle unique constraint violation (race condition)
    if (error.code === '23505') {
      console.log(`[IEL] canon_unit_race_resolved { label: "${input.label}" }`);
      return upsertCanonUnit(input); // Retry as update
    }
    console.error(`[IEL] canon_unit_create_failed { label: "${input.label}", error: "${error.message}" }`);
    return null;
  }
  console.log(`[IEL] canon_unit_created { id: "${created.id}", label: "${created.label}", type: "${created.unit_type}", project: "${created.project_id}" }`);
  return created as CanonUnit;
}

/**
 * Record a mention of a canon unit in a document version.
 */
export async function createMention(input: CreateMentionInput): Promise<CanonUnitMention | null> {
  const { data, error } = await (supabase as any)
    .from('canon_unit_mentions')
    .insert({
      unit_id: input.unit_id,
      document_id: input.document_id,
      version_id: input.version_id,
      offset_start: input.offset_start ?? null,
      offset_end: input.offset_end ?? null,
      confidence: input.confidence ?? 1.0,
    })
    .select()
    .single();

  if (error) {
    console.error(`[IEL] canon_mention_failed { unit: "${input.unit_id}", error: "${error.message}" }`);
    return null;
  }
  return data as CanonUnitMention;
}

/**
 * Create a relation between two canon units.
 */
export async function createRelation(input: CreateRelationInput): Promise<CanonUnitRelation | null> {
  const { data, error } = await (supabase as any)
    .from('canon_unit_relations')
    .insert({
      project_id: input.project_id,
      unit_id_from: input.unit_id_from,
      unit_id_to: input.unit_id_to,
      relation_type: input.relation_type,
      attributes: input.attributes || {},
      confidence: input.confidence ?? 1.0,
    })
    .select()
    .single();

  if (error) {
    console.error(`[IEL] canon_relation_failed { error: "${error.message}" }`);
    return null;
  }
  console.log(`[IEL] canon_relation_created { from: "${input.unit_id_from}", to: "${input.unit_id_to}", type: "${input.relation_type}" }`);
  return data as CanonUnitRelation;
}

// ── Query Helpers ──────────────────────────────────────────────────────────────

/**
 * Get all active canon units for a project.
 */
export async function getProjectUnits(projectId: string, unitType?: CanonUnitType): Promise<CanonUnit[]> {
  let query = (supabase as any)
    .from('canon_units')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (unitType) {
    query = query.eq('unit_type', unitType);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`[IEL] canon_units_query_failed { project: "${projectId}", error: "${error.message}" }`);
    return [];
  }
  return (data || []) as CanonUnit[];
}

/**
 * Get all mentions of a unit across document versions.
 */
export async function getUnitMentions(unitId: string): Promise<CanonUnitMention[]> {
  const { data, error } = await (supabase as any)
    .from('canon_unit_mentions')
    .select('*')
    .eq('unit_id', unitId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data || []) as CanonUnitMention[];
}

/**
 * Get all relations for a project.
 */
export async function getProjectRelations(projectId: string): Promise<CanonUnitRelation[]> {
  const { data, error } = await (supabase as any)
    .from('canon_unit_relations')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data || []) as CanonUnitRelation[];
}

/**
 * Get unit count summary for a project (for dashboard display).
 */
export async function getProjectUnitSummary(projectId: string): Promise<Record<CanonUnitType, number>> {
  const units = await getProjectUnits(projectId);
  const summary: Record<string, number> = {
    character: 0, event: 0, object: 0, location: 0,
    relationship: 0, theme: 0, rule: 0,
  };
  for (const u of units) {
    summary[u.unit_type] = (summary[u.unit_type] || 0) + 1;
  }
  return summary as Record<CanonUnitType, number>;
}
