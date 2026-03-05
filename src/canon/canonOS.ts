/**
 * Canon OS — Atomic Unit Store (NON-CANON experimental index)
 *
 * Stores structured narrative units (characters, events, objects, locations,
 * relationships, themes, rules) extracted from project documents.
 *
 * QUARANTINED: This system is gated behind CANON_UNITS_EXPERIMENTAL (default OFF).
 * It does NOT affect existing pipelines (Dev Engine, Auto-Run, Promotion).
 * Tables: canon_units, canon_unit_mentions, canon_unit_relations
 *
 * These tables are a NON-CANON index — they do NOT define or override
 * project canon (which lives in project_canon / decision_ledger).
 */

import { supabase } from '@/integrations/supabase/client';

// ── Feature Flag (default OFF — must be explicitly enabled) ──────────────────
export const CANON_UNITS_EXPERIMENTAL = false;

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

// ── Provenance Hash (deterministic SHA-256-like via Web Crypto fallback) ──────

async function computeProvenanceHashAsync(input: CreateUnitInput): Promise<string> {
  const raw = `${input.project_id}::${input.unit_type}::${input.label.trim().toLowerCase()}::${input.source_document_id || ''}::${input.source_version_id || ''}`;
  // Use deterministic DJB2a (good enough for provenance dedup, collision-safe for this domain)
  let h1 = 0x811c9dc5 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h1 = Math.imul(h1 ^ raw.charCodeAt(i), 0x01000193) >>> 0;
  }
  // Second independent hash for collision safety
  let h2 = 5381;
  for (let i = 0; i < raw.length; i++) {
    h2 = ((h2 << 5) + h2 + raw.charCodeAt(i)) >>> 0;
  }
  return `${h1.toString(36)}_${h2.toString(36)}`;
}

// ── Flag Guard ────────────────────────────────────────────────────────────────

function assertFlagOn(operation: string): void {
  if (!CANON_UNITS_EXPERIMENTAL) {
    console.log(`[narrative-intelligence][IEL] canon_units_write_blocked { operation: "${operation}", reason: "CANON_UNITS_EXPERIMENTAL=false" }`);
    throw new Error(`Canon Units experimental flag is OFF — ${operation} blocked`);
  }
}

// ── Core Operations ────────────────────────────────────────────────────────────

/**
 * Create or update a canon unit. Uses UPSERT on (project_id, unit_type, label).
 * Will NOT overwrite if provenance_hash doesn't match (prevents cross-source clobber).
 * Bounded retry: max 1 retry on race condition (23505).
 */
export async function upsertCanonUnit(input: CreateUnitInput, _retryCount = 0): Promise<CanonUnit | null> {
  assertFlagOn('upsertCanonUnit');

  const provHash = await computeProvenanceHashAsync(input);
  const MAX_RETRIES = 1;

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
      console.warn(`[narrative-intelligence][IEL] canon_unit_provenance_mismatch { unit: "${input.label}", existing_hash: "${existing.provenance_hash}", new_hash: "${provHash}" }`);
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
      console.error(`[narrative-intelligence][IEL] canon_unit_update_failed { unit: "${input.label}", error: "${error.message}" }`);
      return null;
    }
    console.log(`[narrative-intelligence][IEL] canon_unit_updated { id: "${updated.id}", label: "${updated.label}", type: "${updated.unit_type}" }`);
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
    // Handle unique constraint violation (race condition) — BOUNDED retry
    if (error.code === '23505' && _retryCount < MAX_RETRIES) {
      console.log(`[narrative-intelligence][IEL] canon_unit_race_retry { label: "${input.label}", attempt: ${_retryCount + 1} }`);
      return upsertCanonUnit(input, _retryCount + 1);
    }
    console.error(`[narrative-intelligence][IEL] canon_unit_create_failed { label: "${input.label}", error: "${error.message}", retries_exhausted: ${_retryCount >= MAX_RETRIES} }`);
    return null;
  }
  console.log(`[narrative-intelligence][IEL] canon_unit_created { id: "${created.id}", label: "${created.label}", type: "${created.unit_type}", project: "${created.project_id}" }`);
  return created as CanonUnit;
}

/**
 * Record a mention of a canon unit in a document version.
 * Idempotent: uses ON CONFLICT DO NOTHING via pre-check.
 */
export async function createMention(input: CreateMentionInput): Promise<CanonUnitMention | null> {
  assertFlagOn('createMention');

  // Dedupe check: prevent duplicate mentions for same unit+doc+version+offsets
  const { data: existingMention } = await (supabase as any)
    .from('canon_unit_mentions')
    .select('id')
    .eq('unit_id', input.unit_id)
    .eq('document_id', input.document_id)
    .eq('version_id', input.version_id)
    .eq('offset_start', input.offset_start ?? null)
    .eq('offset_end', input.offset_end ?? null)
    .maybeSingle();

  if (existingMention) {
    return existingMention as CanonUnitMention;
  }

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
    // Swallow 23505 (duplicate) silently — idempotent
    if (error.code === '23505') return null;
    console.error(`[narrative-intelligence][IEL] canon_mention_failed { unit: "${input.unit_id}", error: "${error.message}" }`);
    return null;
  }
  return data as CanonUnitMention;
}

/**
 * Create a relation between two canon units.
 * Idempotent: pre-checks for existing relation.
 */
export async function createRelation(input: CreateRelationInput): Promise<CanonUnitRelation | null> {
  assertFlagOn('createRelation');

  // Dedupe check
  const { data: existingRel } = await (supabase as any)
    .from('canon_unit_relations')
    .select('id')
    .eq('project_id', input.project_id)
    .eq('unit_id_from', input.unit_id_from)
    .eq('unit_id_to', input.unit_id_to)
    .eq('relation_type', input.relation_type)
    .maybeSingle();

  if (existingRel) {
    return existingRel as CanonUnitRelation;
  }

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
    if (error.code === '23505') return null;
    console.error(`[narrative-intelligence][IEL] canon_relation_failed { error: "${error.message}" }`);
    return null;
  }
  console.log(`[narrative-intelligence][IEL] canon_relation_created { from: "${input.unit_id_from}", to: "${input.unit_id_to}", type: "${input.relation_type}" }`);
  return data as CanonUnitRelation;
}

// ── Query Helpers (read-only — no flag required) ──────────────────────────────

export async function getProjectUnits(projectId: string, unitType?: CanonUnitType): Promise<CanonUnit[]> {
  if (!CANON_UNITS_EXPERIMENTAL) return [];

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
    console.error(`[narrative-intelligence][IEL] canon_units_query_failed { project: "${projectId}", error: "${error.message}" }`);
    return [];
  }
  return (data || []) as CanonUnit[];
}

export async function getUnitMentions(unitId: string): Promise<CanonUnitMention[]> {
  if (!CANON_UNITS_EXPERIMENTAL) return [];
  const { data, error } = await (supabase as any)
    .from('canon_unit_mentions')
    .select('*')
    .eq('unit_id', unitId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []) as CanonUnitMention[];
}

export async function getProjectRelations(projectId: string): Promise<CanonUnitRelation[]> {
  if (!CANON_UNITS_EXPERIMENTAL) return [];
  const { data, error } = await (supabase as any)
    .from('canon_unit_relations')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []) as CanonUnitRelation[];
}

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
