/**
 * DNA Auto-Flow Engine — Canonical non-UI pipeline for deterministic
 * Character Visual DNA trait extraction, normalization, and auto-persistence.
 *
 * Two modes:
 *   Mode A (conservative): auto-save only high-confidence traits, more unresolved
 *   Mode B (aggressive, DEFAULT): auto-resolve most deterministic traits, fewer clarifications
 *
 * Stages:
 *   1. extract_candidate_traits
 *   2. normalize_traits
 *   3. resolve_directional_ambiguity
 *   4. build_dna_draft
 *   5. evaluate_dna_integrity
 *   6. persist_dna_draft (if threshold met)
 *   7. derive_clarifications
 *
 * This module is the single canonical source of truth for DNA auto-flow.
 * CharacterVisualDNAPanel and rebuild executor consume it — they do not own this logic.
 */

import type { BindingMarker, TraitCategory, MarkerStatus } from './characterTraits';
import {
  extractTraitsFromCanon,
  deriveTraitsFromContext,
  extractNarrativeTraits,
  parseUserNotes,
  detectTraitContradictions,
  detectBindingMarkers,
} from './characterTraits';
import {
  resolveCharacterVisualDNA,
  serializeDNAForStorage,
  deserializeBindingMarkers,
  deserializeEvidenceTraits,
  deserializeTransientStates,
  type CharacterVisualDNA,
  type EvidenceTrait,
  type TransientVisualState,
  type MissingClarification,
  type ClarificationStatus,
} from './visualDNA';
import { resolveCharacterIdentity } from './identityResolver';
import { supabase } from '@/integrations/supabase/client';

// ── Mode Configuration ──

export type DnaAutoFlowMode = 'conservative' | 'aggressive';

export const DNA_AUTO_FLOW_MODE_DEFAULT: DnaAutoFlowMode = 'aggressive';

export interface DnaAutoFlowConfig {
  mode: DnaAutoFlowMode;
}

// ── Trait Classes ──

export type NormalizedTraitClass = 'extracted' | 'normalized' | 'resolved' | 'unresolved';

export interface NormalizedTrait {
  label: string;
  category: TraitCategory;
  traitClass: NormalizedTraitClass;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

// ── Directional / Body-Side Normalization ──

export type SideConfidence = 'explicit' | 'inferred' | 'unresolved' | 'conflicting';

export interface NormalizedBodyReference {
  region: string;
  side: 'left' | 'right' | 'center' | 'bilateral' | 'unknown';
  sideConfidence: SideConfidence;
  markerStatus: 'resolved' | 'resolved_side_unknown' | 'pending_resolution' | 'conflicting' | 'rejected';
  /** Whether the marker is usable for generation despite side ambiguity */
  usableForGeneration: boolean;
  originalText: string;
}

/**
 * Normalize directional/body-side references in a marker.
 * Determines side confidence and usability.
 */
export function normalizeBodyReference(marker: BindingMarker): NormalizedBodyReference {
  const region = marker.bodyRegion || 'unspecified';
  const side = marker.laterality;
  
  // Regions where side matters
  const sidedRegions = /\b(arm|hand|wrist|leg|foot|eye|ear|shoulder|cheek|knee|elbow|hip|ankle)\b/i;
  const regionNeedsSide = sidedRegions.test(region);
  
  let sideConfidence: SideConfidence;
  let markerStatus: NormalizedBodyReference['markerStatus'];
  let usableForGeneration: boolean;
  
  if (side !== 'unknown') {
    // Explicit side known
    sideConfidence = 'explicit';
    markerStatus = 'resolved';
    usableForGeneration = true;
  } else if (!regionNeedsSide) {
    // Region doesn't need side (e.g., forehead, chest, back)
    sideConfidence = 'explicit'; // side is N/A
    markerStatus = 'resolved';
    usableForGeneration = true;
  } else {
    // Side-relevant region but side unknown
    sideConfidence = 'unresolved';
    markerStatus = 'resolved_side_unknown';
    // Still usable — generation can render without specifying side
    usableForGeneration = true;
  }
  
  return {
    region,
    side,
    sideConfidence,
    markerStatus,
    usableForGeneration,
    originalText: marker.label,
  };
}

/**
 * Resolve directional ambiguity across a set of markers.
 * If multiple evidence sources point to the same side, upgrade confidence.
 */
export function resolveDirectionalAmbiguity(
  markers: BindingMarker[],
  _mode: DnaAutoFlowMode,
): { resolved: BindingMarker[]; references: NormalizedBodyReference[] } {
  const references: NormalizedBodyReference[] = [];
  const resolved = markers.map(marker => {
    const ref = normalizeBodyReference(marker);
    references.push(ref);
    
    // Update marker laterality status based on normalization
    const updatedUnresolved = marker.unresolvedFields.filter(f => {
      if (f === 'laterality' && ref.usableForGeneration) {
        // In aggressive mode, clear laterality from unresolved if usable
        return _mode === 'conservative';
      }
      return true;
    });
    
    return {
      ...marker,
      unresolvedFields: updatedUnresolved,
      requiresUserDecision: _mode === 'conservative' 
        ? marker.requiresUserDecision 
        : updatedUnresolved.length > 0 && !ref.usableForGeneration,
      status: (ref.markerStatus === 'resolved' || ref.markerStatus === 'resolved_side_unknown')
        ? marker.status // preserve approved/detected
        : 'pending_resolution' as MarkerStatus,
    };
  });
  
  return { resolved, references };
}

// ── DNA Integrity Evaluation ──

export type DnaDraftStatus = 'auto_saved_draft' | 'human_confirmed' | 'partially_resolved' | 'needs_review';

export interface DnaIntegrityResult {
  meetsMinimumThreshold: boolean;
  meetsHighThreshold: boolean;
  status: DnaDraftStatus;
  resolvedCoreCount: number;
  totalCoreCount: number;
  hasContradictions: boolean;
  contradictionCount: number;
  missingHighImportance: string[];
  identityStrength: 'strong' | 'partial' | 'weak';
}

const CORE_CATEGORIES: TraitCategory[] = ['age', 'gender', 'build', 'hair', 'skin', 'clothing'];

/**
 * Evaluate whether a DNA draft has enough integrity to auto-persist.
 */
export function evaluateDnaIntegrity(
  dna: CharacterVisualDNA,
  mode: DnaAutoFlowMode,
): DnaIntegrityResult {
  const totalCoreCount = CORE_CATEGORIES.length;
  
  // Count resolved core categories
  const resolvedCategories = new Set<TraitCategory>();
  for (const t of dna.allTraits) {
    if (CORE_CATEGORIES.includes(t.category)) {
      resolvedCategories.add(t.category);
    }
  }
  // Also count evidence traits
  for (const et of dna.evidenceTraits) {
    if (CORE_CATEGORIES.includes(et.category) && (et.confidence === 'high' || et.confidence === 'medium')) {
      resolvedCategories.add(et.category);
    }
  }
  
  const resolvedCoreCount = resolvedCategories.size;
  const hasContradictions = dna.contradictions.length > 0;
  
  // Missing high-importance categories
  const missingHighImportance = dna.missingClarifications
    .filter(c => c.status === 'missing' && c.importance === 'high')
    .map(c => c.category);
  
  // Threshold rules
  // Mode B (aggressive): minimum 2 core categories resolved, no critical contradictions
  // Mode A (conservative): minimum 4 core categories resolved, no contradictions at all
  const minThreshold = mode === 'aggressive' ? 2 : 4;
  const contradictionBlock = mode === 'aggressive' 
    ? dna.contradictions.some(c => c.severity === 'contradiction')
    : hasContradictions;
  
  const meetsMinimumThreshold = resolvedCoreCount >= minThreshold && !contradictionBlock;
  const meetsHighThreshold = resolvedCoreCount >= 4 && !hasContradictions;
  
  let status: DnaDraftStatus;
  if (meetsHighThreshold) {
    status = 'auto_saved_draft';
  } else if (meetsMinimumThreshold) {
    status = 'partially_resolved';
  } else {
    status = 'needs_review';
  }
  
  return {
    meetsMinimumThreshold,
    meetsHighThreshold,
    status,
    resolvedCoreCount,
    totalCoreCount,
    hasContradictions,
    contradictionCount: dna.contradictions.length,
    missingHighImportance,
    identityStrength: dna.identityStrength,
  };
}

// ── Clarification Filtering ──

/**
 * Filter clarifications based on mode policy.
 * Mode B: suppress obviously-resolvable or low-risk clarifications.
 * Mode A: show more clarifications for human review.
 */
export function filterClarifications(
  clarifications: MissingClarification[],
  mode: DnaAutoFlowMode,
): MissingClarification[] {
  if (mode === 'conservative') {
    // Show all non-resolved clarifications
    return clarifications;
  }
  
  // Mode B (aggressive): filter out partial clarifications with answer candidates
  return clarifications.filter(c => {
    // Always show truly missing items
    if (c.status === 'missing') return true;
    
    // For partial: only show if high importance or low-confidence candidate
    if (c.status === 'partial') {
      if (c.importance === 'high') return true;
      if (c.answerCandidate && c.answerCandidate.confidence === 'low') return true;
      // Medium/high confidence partial candidates are "good enough" in aggressive mode
      return false;
    }
    
    return false;
  });
}

// ── Auto-Flow Execution ──

export interface DnaAutoFlowInput {
  projectId: string;
  characterName: string;
  canonCharacter: Record<string, unknown> | null;
  canonJson: Record<string, unknown> | null;
  userNotes: string;
  config?: DnaAutoFlowConfig;
  /** If true, skip edge function extraction and use only local trait resolution */
  localOnly?: boolean;
  /** Pre-existing markers from DB */
  existingMarkers?: BindingMarker[];
  /** Pre-existing evidence from DB */
  existingEvidence?: EvidenceTrait[];
}

export interface DnaAutoFlowResult {
  dna: CharacterVisualDNA;
  integrity: DnaIntegrityResult;
  bodyReferences: NormalizedBodyReference[];
  filteredClarifications: MissingClarification[];
  persisted: boolean;
  persistedVersionNumber: number | null;
  mode: DnaAutoFlowMode;
  stageLog: string[];
}

/**
 * Execute the canonical DNA auto-flow pipeline.
 * This is the single canonical entry point for DNA resolution + optional persistence.
 *
 * Can be called from:
 *   - CharacterVisualDNAPanel (on open / auto-fill)
 *   - Rebuild executor (preflight)
 *   - Future auto-run hooks
 */
export async function executeDnaAutoFlow(
  input: DnaAutoFlowInput,
): Promise<DnaAutoFlowResult> {
  const mode = input.config?.mode || DNA_AUTO_FLOW_MODE_DEFAULT;
  const stageLog: string[] = [];
  
  const { projectId, characterName, canonCharacter, canonJson, userNotes } = input;
  
  // Stage 1: Resolve identity lock state
  stageLog.push('resolve_identity');
  const identity = await resolveCharacterIdentity(projectId, characterName);
  
  // Stage 2: Load persisted markers + evidence if not provided
  stageLog.push('load_persisted_state');
  let markers = input.existingMarkers || [];
  let evidence = input.existingEvidence || [];
  
  if (markers.length === 0 || evidence.length === 0) {
    const { data: currentDna } = await (supabase as any)
      .from('character_visual_dna')
      .select('identity_signature')
      .eq('project_id', projectId)
      .eq('character_name', characterName)
      .eq('is_current', true)
      .maybeSingle();
    
    if (currentDna?.identity_signature) {
      if (markers.length === 0) {
        markers = deserializeBindingMarkers(currentDna.identity_signature);
      }
      if (evidence.length === 0) {
        evidence = deserializeEvidenceTraits(currentDna.identity_signature);
      }
    }
  }
  
  // Stage 3: Extract evidence traits via edge function (unless localOnly)
  if (!input.localOnly && evidence.length === 0) {
    stageLog.push('extract_evidence_traits');
    try {
      const { data, error } = await supabase.functions.invoke('extract-visual-dna', {
        body: { project_id: projectId, character_name: characterName },
      });
      
      if (!error && data?.traits) {
        evidence = (data.traits || []).map((t: any) => ({
          label: t.label,
          category: t.category as TraitCategory,
          source: 'evidence' as const,
          constraint: 'flexible' as const,
          confidence: t.confidence || 'medium',
          evidenceSource: t.evidence_source || 'extraction',
          evidenceExcerpt: t.evidence_excerpt || '',
        }));
        
        // Extract marker candidates
        const markerCandidates: BindingMarker[] = (data.marker_candidates || []).map((m: any) => ({
          id: m.id || `marker_${m.marker_type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          markerType: m.marker_type,
          label: m.label,
          bodyRegion: m.body_region || 'unspecified',
          laterality: m.laterality || 'unknown',
          size: m.size || 'unknown',
          visibility: m.visibility || 'always_visible',
          attributes: m.attributes || {},
          status: (m.unresolved_fields?.length > 0 ? 'pending_resolution' : 'detected') as MarkerStatus,
          requiresUserDecision: (m.unresolved_fields?.length || 0) > 0,
          unresolvedFields: m.unresolved_fields || [],
          confidence: m.confidence || 'high',
          evidenceSource: m.evidence_source || 'extraction',
          evidenceExcerpt: m.evidence_excerpt || '',
          approvedAt: null,
          approvedBy: null,
        }));
        
        // Merge novel markers
        const existingKeys = new Set(markers.map(m => `${m.markerType}:${m.bodyRegion}`));
        for (const mc of markerCandidates) {
          if (!existingKeys.has(`${mc.markerType}:${mc.bodyRegion}`)) {
            markers.push(mc);
          }
        }
        
        stageLog.push(`extracted ${evidence.length} traits, ${markerCandidates.length} markers`);
      }
    } catch (e: any) {
      stageLog.push(`extraction_failed: ${e.message}`);
      // Non-fatal — continue with what we have
    }
  }
  
  // Stage 4: Normalize traits + resolve directional ambiguity
  stageLog.push('normalize_and_resolve');
  const { resolved: resolvedMarkers, references } = resolveDirectionalAmbiguity(markers, mode);
  
  // Stage 5: Build DNA draft
  stageLog.push('build_dna_draft');
  const dna = resolveCharacterVisualDNA(
    characterName,
    canonCharacter,
    canonJson,
    userNotes,
    identity.locked,
    resolvedMarkers,
    evidence,
  );
  
  // Stage 6: Evaluate integrity
  stageLog.push('evaluate_integrity');
  const integrity = evaluateDnaIntegrity(dna, mode);
  
  // Stage 7: Filter clarifications by mode
  stageLog.push('filter_clarifications');
  const filteredClarifications = filterClarifications(dna.missingClarifications, mode);
  
  // Stage 8: Auto-persist if threshold met
  let persisted = false;
  let persistedVersionNumber: number | null = null;
  
  const shouldPersist = mode === 'aggressive' 
    ? integrity.meetsMinimumThreshold
    : integrity.meetsHighThreshold;
  
  if (shouldPersist) {
    stageLog.push('persist_dna_draft');
    try {
      // Get next version
      const { data: existing } = await (supabase as any)
        .from('character_visual_dna')
        .select('version_number')
        .eq('project_id', projectId)
        .eq('character_name', characterName)
        .order('version_number', { ascending: false })
        .limit(1);
      
      const nextVersion = (existing?.[0]?.version_number || 0) + 1;
      
      // Mark old as not current
      await (supabase as any)
        .from('character_visual_dna')
        .update({ is_current: false })
        .eq('project_id', projectId)
        .eq('character_name', characterName);
      
      // Persist
      const serialized = serializeDNAForStorage(dna);
      const { data: session } = await supabase.auth.getSession();
      
      const { error } = await (supabase as any)
        .from('character_visual_dna')
        .insert({
          project_id: projectId,
          character_name: characterName,
          version_number: nextVersion,
          ...serialized,
          is_current: true,
          created_by: session?.session?.user?.id,
        });
      
      if (!error) {
        persisted = true;
        persistedVersionNumber = nextVersion;
        stageLog.push(`persisted v${nextVersion}`);
      } else {
        stageLog.push(`persist_failed: ${error.message}`);
      }
    } catch (e: any) {
      stageLog.push(`persist_error: ${e.message}`);
    }
  } else {
    stageLog.push(`skip_persist: threshold not met (${integrity.resolvedCoreCount}/${integrity.totalCoreCount} core, mode=${mode})`);
  }
  
  return {
    dna,
    integrity,
    bodyReferences: references,
    filteredClarifications,
    persisted,
    persistedVersionNumber,
    mode,
    stageLog,
  };
}

// ── Rebuild Preflight ──

/**
 * Run DNA auto-flow as a preflight for rebuild.
 * Ensures characters have the strongest possible canonical DNA state
 * before rebuild evaluation begins.
 *
 * Returns a summary of what was improved.
 */
export async function runDnaPreflightForRebuild(
  projectId: string,
  canonJson: Record<string, unknown> | null,
  config?: DnaAutoFlowConfig,
): Promise<{
  charactersProcessed: number;
  charactersPersisted: number;
  results: Array<{ name: string; persisted: boolean; integrity: DnaIntegrityResult }>;
}> {
  const characters: { name: string }[] = [];
  if (canonJson?.characters && Array.isArray(canonJson.characters)) {
    for (const c of canonJson.characters) {
      const name = typeof c === 'string' ? c.trim() : (c.name || c.character_name || '').trim();
      if (name && name !== 'Unknown') characters.push({ name });
    }
  }
  
  const results: Array<{ name: string; persisted: boolean; integrity: DnaIntegrityResult }> = [];
  let charactersPersisted = 0;
  
  for (const char of characters.slice(0, 10)) {
    // Find canon character data
    const canonCharacter = Array.isArray(canonJson?.characters)
      ? (canonJson.characters as any[]).find((c: any) => {
          const n = typeof c === 'string' ? c : (c.name || c.character_name || '');
          return n.trim().toLowerCase() === char.name.toLowerCase();
        }) || null
      : null;
    
    try {
      const result = await executeDnaAutoFlow({
        projectId,
        characterName: char.name,
        canonCharacter: typeof canonCharacter === 'object' ? canonCharacter : null,
        canonJson,
        userNotes: '', // Preflight doesn't have user notes context
        config,
        localOnly: true, // Don't call edge function during preflight — use existing evidence
      });
      
      results.push({
        name: char.name,
        persisted: result.persisted,
        integrity: result.integrity,
      });
      
      if (result.persisted) charactersPersisted++;
    } catch (e: any) {
      console.warn(`[dna-preflight] Failed for ${char.name}: ${e.message}`);
      results.push({
        name: char.name,
        persisted: false,
        integrity: {
          meetsMinimumThreshold: false,
          meetsHighThreshold: false,
          status: 'needs_review',
          resolvedCoreCount: 0,
          totalCoreCount: CORE_CATEGORIES.length,
          hasContradictions: false,
          contradictionCount: 0,
          missingHighImportance: [],
          identityStrength: 'weak',
        },
      });
    }
  }
  
  return {
    charactersProcessed: characters.length,
    charactersPersisted,
    results,
  };
}
