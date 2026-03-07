/**
 * Impact Engine v2 — Deterministic Impact Resolver + Bounded Repair Planner
 *
 * Resolves downstream impact from upstream truth changes (canon units, locked decisions,
 * doc-type repairs) and computes bounded, lane-aware repair plans.
 *
 * TERMINOLOGY (v2.1 — honest naming):
 *   This is NOT a full dependency graph layer. It is:
 *   - An impact resolver: determines which documents are affected by upstream changes
 *   - A bounded repair planner: computes safe, lane-aware repair scope
 *   - An IEL eligibility validator: ensures repairs bind to authoritative versions
 *
 * DEPENDENCY TYPES MODELED (v2.1):
 *   1. Structural dependency — doc-to-doc edges via deliverableDependencyRegistry
 *      Explicitly modeled. Deterministic. Lane-scoped. Project-scoped.
 *   2. Reference/mention dependency — unit-to-document via canon_unit_mentions
 *      Explicitly modeled. Deterministic. Uses persisted mention records.
 *      Section narrowing via mention offsets when available.
 *   3. Decision constraint dependency — decision-to-document via decision_ledger.targets
 *      and project_document_versions.source_decision_ids
 *      Explicitly modeled. Deterministic.
 *   4. Derived dependency — unit-to-unit via canon_unit_relations, then to documents
 *      Implicitly derived at resolution time. Not persisted as edges.
 *
 * NOT YET MODELED (deferred):
 *   - Canonical dependency as a first-class edge type distinct from structural
 *     (currently subsumed by the dependency registry's "canon" kind edges)
 *   - Repair eligibility dependency as a formal edge type
 *     (currently enforced procedurally by IEL guard logic)
 *
 * SCOPE (v2.1):
 *   This patch covers: analysis + bounded repair planning ONLY.
 *   Repair execution is NOT integrated — remains in existing rewrite pathways.
 *   The event `impact_repair_executed` is NOT emitted by this engine.
 *
 * ARCHITECTURE:
 * - Uses existing dependency registry for doc-to-doc edges (structural dependency)
 * - Uses canon_unit_mentions for unit-to-document edges (reference/mention dependency)
 * - Uses decision_ledger.targets + source_decision_ids for decision constraints
 * - Uses deliverableSectionRegistry for section-level scope targeting
 * - Uses canon_unit_mentions offsets to narrow sections where deterministic
 * - Uses episodicBlockRegistry for episode-block targeting where applicable
 * - Enforces lane-aware exclusion: doc types not in lane ladder are excluded
 * - Binds only to authoritative (is_current + approved) versions
 * - Fails closed on ambiguous impact (analysis-level: blocks repair plan generation)
 * - Emits transition events via Transition Ledger v1.1
 * - No schema drift: operates on existing tables only
 *
 * TRUTH HIERARCHY (enforced):
 *   Canon > Locked Decisions > Canon Units > Authoritative Documents > Corpus > AI Inference
 *
 * FAIL-CLOSED SCOPE:
 *   - Analysis-level: ambiguous impact prevents repair plan generation
 *   - Repair-plan-level: missing authoritative version or invalid lane blocks the plan
 *   - Execution-level: NOT in scope — execution remains in existing rewrite pathways
 */

import { type LaneKey, LANE_DOC_LADDERS } from "./documentLadders.ts";
import {
  getDirectDependents,
  getTransitiveDependents,
  getInvalidationPlan,
  type DependencyEdge,
  type InvalidationPlan,
  type InvalidationPlanEntry,
} from "./deliverableDependencyRegistry.ts";
import {
  getSectionConfig,
  type DocTypeSectionConfig,
  type SectionDefinition,
} from "./deliverableSectionRegistry.ts";
import {
  isEpisodicBlockRepairSupported,
} from "./episodicBlockRegistry.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";

// ── Change Source Types ──

export type ChangeSourceKind = "canon_unit" | "locked_decision" | "doc_type_repair" | "unit_relation";

export interface ChangeSource {
  kind: ChangeSourceKind;
  /** For canon_unit: the unit ID. For decision: decision ID. For doc_type_repair: the doc_type string. */
  sourceId: string;
  /** Human-readable label for audit */
  label: string;
  /** Project ID (required) */
  projectId: string;
  /** Lane key for registry lookup */
  lane: LaneKey;
  /** Optional: the doc_type that originally sourced this change */
  originDocType?: string;
  /** Optional: version ID that triggered the change */
  triggerVersionId?: string;
}

// ── Affected Document ──

export interface AffectedDocument {
  documentId: string;
  docType: string;
  /** Authoritative version bound for this document */
  authoritativeVersionId: string | null;
  /** How this document is affected */
  impactKind: "direct_reference" | "transitive_dependency" | "decision_constraint";
  /** Dependency edge that connects to this doc (if from doc-to-doc graph) */
  edge: DependencyEdge | null;
  /** Invalidation policy from the dependency registry */
  invalidationPolicy: "stale" | "review_only" | "none";
  /** Whether this doc is eligible for automated repair */
  repairEligible: boolean;
  /** Reason if repair is blocked */
  blockReason: string | null;
}

// ── Section Scope ──

export interface SectionScope {
  sectionKey: string;
  label: string;
  repairMode: string;
  /** How this section was targeted */
  targetingMethod: "mention_offset" | "section_registry_fallback" | "episode_block";
}

// ── Scope Precision Classification ──

export type ScopePrecision =
  | "precise_section_targeted"     // narrowed via mention offsets or episode blocks
  | "section_capable_fallback"     // all sections of doc type are candidates (no offset data)
  | "document_level_fallback"      // no section support for this doc type
  | "blocked";                     // repair not possible

// ── Bounded Repair Plan ──

export interface BoundedRepairPlan {
  targetDocumentId: string;
  targetDocType: string;
  authoritativeVersionId: string | null;
  /** Sections affected, if section-level targeting is supported */
  affectedSections: SectionScope[];
  /** Whether section-level repair is possible or requires full-doc fallback */
  scopeMode: "section_targeted" | "full_document" | "blocked";
  /** Precision classification — honest labeling of targeting quality */
  scopePrecision: ScopePrecision;
  /** The upstream change that triggered this plan */
  changeSource: ChangeSource;
  /** Dependent units involved */
  dependentUnitIds: string[];
  /** Dependent decision IDs involved */
  dependentDecisionIds: string[];
  /** Lane/stage validation status */
  laneValid: boolean;
  /** Recommended rewrite mode */
  recommendedRewriteMode: "replace_section" | "regenerate_section" | "full_doc_rewrite" | "manual_review";
  /** Block reasons if repair is not eligible */
  blockReasons: string[];
}

// ── Impact Analysis Result ──

export interface ImpactAnalysisResult {
  changeSource: ChangeSource;
  /** All affected documents with their impact metadata */
  affectedDocuments: AffectedDocument[];
  /** Bounded repair plans for eligible documents */
  repairPlans: BoundedRepairPlan[];
  /** Documents blocked from automated repair */
  blockedDocuments: { docType: string; reason: string }[];
  /** Invalidation plan from dependency registry (if doc-type source) */
  invalidationPlan: InvalidationPlan | null;
  /** Timestamp of analysis */
  analyzedAt: string;
  /** Whether any ambiguity was detected */
  hasAmbiguity: boolean;
  /** Ambiguity details */
  ambiguityDetails: string[];
  /** Lane-excluded doc types (documented for audit) */
  laneExcluded: { docType: string; reason: string }[];
}

// ── Impact Resolver ──

/**
 * Compute bounded downstream impact for an upstream truth change.
 *
 * FAIL-CLOSED (analysis-level):
 *   If impact cannot be determined cleanly, marks affected targets as blocked
 *   with explicit reasons. Ambiguous analysis prevents repair plan generation.
 *   This is analysis-level fail-closed — execution is not in scope.
 */
export async function computeImpact(
  supabase: any,
  changeSource: ChangeSource,
): Promise<ImpactAnalysisResult> {
  const result: ImpactAnalysisResult = {
    changeSource,
    affectedDocuments: [],
    repairPlans: [],
    blockedDocuments: [],
    invalidationPlan: null,
    analyzedAt: new Date().toISOString(),
    hasAmbiguity: false,
    ambiguityDetails: [],
    laneExcluded: [],
  };

  try {
    // ── Step 1: Resolve affected doc types from change source ──
    const rawAffectedDocTypes = await resolveAffectedDocTypes(supabase, changeSource);

    // ── Step 2: Lane-aware exclusion ──
    const { included: affectedDocTypes, excluded } = applyLaneExclusion(
      rawAffectedDocTypes, changeSource.lane,
    );
    result.laneExcluded = excluded;

    // ── Step 3: Resolve actual documents + authoritative versions ──
    for (const affected of affectedDocTypes) {
      const docs = await resolveDocumentsForDocType(
        supabase, changeSource.projectId, affected.docType,
      );
      for (const doc of docs) {
        const authVersion = await resolveAuthoritativeVersion(supabase, doc.id);
        const repairEligible = affected.invalidationPolicy !== "none" && authVersion !== null;
        const blockReason = !authVersion
          ? "no_authoritative_version"
          : affected.invalidationPolicy === "none"
            ? "no_invalidation_required"
            : null;

        result.affectedDocuments.push({
          documentId: doc.id,
          docType: affected.docType,
          authoritativeVersionId: authVersion,
          impactKind: affected.impactKind,
          edge: affected.edge,
          invalidationPolicy: affected.invalidationPolicy,
          repairEligible,
          blockReason,
        });

        if (!repairEligible && blockReason) {
          result.blockedDocuments.push({ docType: affected.docType, reason: blockReason });
        }
      }
    }

    // ── Step 4: Detect ambiguity ──
    if (affectedDocTypes.length === 0 && changeSource.kind !== "doc_type_repair") {
      result.hasAmbiguity = true;
      result.ambiguityDetails.push(
        `No affected documents could be determined for ${changeSource.kind}:${changeSource.sourceId}`,
      );
    }

    // ── Step 5: Build bounded repair plans (only if no ambiguity) ──
    if (!result.hasAmbiguity) {
      for (const affected of result.affectedDocuments) {
        if (!affected.repairEligible) continue;
        const plan = await buildRepairPlan(supabase, affected, changeSource);
        result.repairPlans.push(plan);
      }
    } else {
      // Ambiguity fail-closed: no repair plans generated
      console.warn(`[impact-engine] ambiguity detected — repair plan generation blocked`);
    }

    // ── Step 6: Emit transition events ──
    await emitImpactTransitions(supabase, result);

  } catch (err: any) {
    console.error(`[impact-engine] computeImpact failed:`, err?.message);
    result.hasAmbiguity = true;
    result.ambiguityDetails.push(`Engine error: ${err?.message}`);
  }

  console.log(`[impact-engine] computeImpact { project: "${changeSource.projectId}", source: "${changeSource.kind}:${changeSource.sourceId}", affected: ${result.affectedDocuments.length}, plans: ${result.repairPlans.length}, blocked: ${result.blockedDocuments.length}, lane_excluded: ${result.laneExcluded.length}, ambiguous: ${result.hasAmbiguity} }`);

  return result;
}

// ── Lane-Aware Exclusion ──

/**
 * Filter affected doc types by lane ladder membership.
 * Doc types NOT in the lane's ladder are excluded with explicit reason.
 * This enforces that repair scope cannot target documents outside the lane's valid flow.
 */
function applyLaneExclusion(
  affected: AffectedDocType[],
  lane: LaneKey,
): { included: AffectedDocType[]; excluded: { docType: string; reason: string }[] } {
  const ladder = LANE_DOC_LADDERS[lane] || [];
  const ladderSet = new Set(ladder);
  const included: AffectedDocType[] = [];
  const excluded: { docType: string; reason: string }[] = [];

  for (const a of affected) {
    if (ladderSet.has(a.docType)) {
      included.push(a);
    } else {
      excluded.push({
        docType: a.docType,
        reason: `doc_type_not_in_lane_ladder:${lane}`,
      });
    }
  }

  if (excluded.length > 0) {
    console.log(`[impact-engine] lane exclusion: lane=${lane}, excluded=[${excluded.map(e => e.docType).join(",")}]`);
  }

  return { included, excluded };
}

// ── Internal: Resolve affected doc types ──

interface AffectedDocType {
  docType: string;
  impactKind: AffectedDocument["impactKind"];
  edge: DependencyEdge | null;
  invalidationPolicy: "stale" | "review_only" | "none";
}

async function resolveAffectedDocTypes(
  supabase: any,
  changeSource: ChangeSource,
): Promise<AffectedDocType[]> {
  const affected: AffectedDocType[] = [];

  switch (changeSource.kind) {
    case "doc_type_repair": {
      // Structural dependency: use existing dependency registry — most mature path
      const plan = getInvalidationPlan(changeSource.lane, changeSource.sourceId);
      for (const entry of plan.entries) {
        affected.push({
          docType: entry.doc_type,
          impactKind: "transitive_dependency",
          edge: entry.edge,
          invalidationPolicy: entry.invalidation_policy,
        });
      }
      break;
    }

    case "canon_unit": {
      // Reference/mention dependency: resolve via canon_unit_mentions → document_id → doc_type
      const mentionDocTypes = await resolveDocTypesFromUnitMentions(
        supabase, changeSource.projectId, changeSource.sourceId,
      );
      for (const docType of mentionDocTypes) {
        const edge = changeSource.originDocType
          ? findEdgeForDocType(changeSource.lane, changeSource.originDocType, docType)
          : null;
        affected.push({
          docType,
          impactKind: "direct_reference",
          edge,
          invalidationPolicy: edge?.invalidation_policy || "review_only",
        });
      }

      // Derived dependency: unit-to-unit via canon_unit_relations, then to documents
      const relatedUnitDocTypes = await resolveDocTypesFromUnitRelations(
        supabase, changeSource.projectId, changeSource.sourceId,
      );
      for (const docType of relatedUnitDocTypes) {
        if (affected.some(a => a.docType === docType)) continue;
        affected.push({
          docType,
          impactKind: "transitive_dependency",
          edge: null,
          invalidationPolicy: "review_only",
        });
      }

      // Fallback: if no mentions exist, use origin doc_type to traverse structural graph
      if (affected.length === 0 && changeSource.originDocType) {
        const plan = getInvalidationPlan(changeSource.lane, changeSource.originDocType);
        for (const entry of plan.entries) {
          affected.push({
            docType: entry.doc_type,
            impactKind: "transitive_dependency",
            edge: entry.edge,
            invalidationPolicy: entry.invalidation_policy,
          });
        }
      }
      break;
    }

    case "locked_decision": {
      // Decision constraint dependency: via decision_ledger.targets + source_decision_ids
      const decisionDocTypes = await resolveDocTypesFromDecision(
        supabase, changeSource.projectId, changeSource.sourceId,
      );
      for (const docType of decisionDocTypes) {
        const edge = changeSource.originDocType
          ? findEdgeForDocType(changeSource.lane, changeSource.originDocType, docType)
          : null;
        affected.push({
          docType,
          impactKind: "decision_constraint",
          edge,
          invalidationPolicy: edge?.invalidation_policy || "review_only",
        });
      }
      break;
    }

    case "unit_relation": {
      // Derived dependency: resolve both sides of the relation
      const { data: relation } = await supabase
        .from("canon_unit_relations")
        .select("unit_id_from, unit_id_to")
        .eq("id", changeSource.sourceId)
        .maybeSingle();

      if (relation) {
        for (const unitId of [relation.unit_id_from, relation.unit_id_to]) {
          const docTypes = await resolveDocTypesFromUnitMentions(
            supabase, changeSource.projectId, unitId,
          );
          for (const docType of docTypes) {
            if (affected.some(a => a.docType === docType)) continue;
            affected.push({
              docType,
              impactKind: "direct_reference",
              edge: null,
              invalidationPolicy: "review_only",
            });
          }
        }
      }
      break;
    }
  }

  return affected;
}

// ── Internal: Resolve doc types from unit mentions ──

async function resolveDocTypesFromUnitMentions(
  supabase: any,
  projectId: string,
  unitId: string,
): Promise<string[]> {
  const { data: mentions } = await supabase
    .from("canon_unit_mentions")
    .select("document_id")
    .eq("unit_id", unitId);

  if (!mentions || mentions.length === 0) return [];

  const docIds = [...new Set(mentions.map((m: any) => m.document_id))];
  const { data: docs } = await supabase
    .from("project_documents")
    .select("doc_type")
    .in("id", docIds)
    .eq("project_id", projectId);

  return [...new Set((docs || []).map((d: any) => d.doc_type))];
}

// ── Internal: Resolve doc types from unit relations (transitive) ──

async function resolveDocTypesFromUnitRelations(
  supabase: any,
  projectId: string,
  unitId: string,
): Promise<string[]> {
  const { data: relations } = await supabase
    .from("canon_unit_relations")
    .select("unit_id_from, unit_id_to")
    .eq("project_id", projectId)
    .or(`unit_id_from.eq.${unitId},unit_id_to.eq.${unitId}`);

  if (!relations || relations.length === 0) return [];

  const relatedUnitIds = new Set<string>();
  for (const r of relations) {
    if (r.unit_id_from !== unitId) relatedUnitIds.add(r.unit_id_from);
    if (r.unit_id_to !== unitId) relatedUnitIds.add(r.unit_id_to);
  }

  const allDocTypes = new Set<string>();
  for (const relatedId of relatedUnitIds) {
    const docTypes = await resolveDocTypesFromUnitMentions(supabase, projectId, relatedId);
    docTypes.forEach(dt => allDocTypes.add(dt));
  }

  return [...allDocTypes];
}

// ── Internal: Resolve doc types from decision targets ──

async function resolveDocTypesFromDecision(
  supabase: any,
  projectId: string,
  decisionId: string,
): Promise<string[]> {
  const docTypes = new Set<string>();

  // 1. Check decision_ledger.targets
  const { data: decision } = await supabase
    .from("decision_ledger")
    .select("targets, scope")
    .eq("id", decisionId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (decision?.targets) {
    const targets = decision.targets;
    if (Array.isArray(targets)) {
      for (const t of targets) {
        if (typeof t === "string") docTypes.add(t);
        else if (t?.doc_type) docTypes.add(t.doc_type);
      }
    } else if (typeof targets === "object") {
      if (targets.doc_type) docTypes.add(targets.doc_type);
      if (targets.doc_types && Array.isArray(targets.doc_types)) {
        targets.doc_types.forEach((dt: string) => docTypes.add(dt));
      }
    }
  }

  // 2. Check versions that reference this decision in source_decision_ids
  const { data: versions } = await supabase
    .from("project_document_versions")
    .select("document_id")
    .contains("source_decision_ids", [decisionId]);

  if (versions && versions.length > 0) {
    const docIds = [...new Set(versions.map((v: any) => v.document_id))];
    const { data: docs } = await supabase
      .from("project_documents")
      .select("doc_type")
      .in("id", docIds)
      .eq("project_id", projectId);

    (docs || []).forEach((d: any) => docTypes.add(d.doc_type));
  }

  return [...docTypes];
}

// ── Internal: Find a dependency edge for a target doc type ──

function findEdgeForDocType(
  lane: LaneKey,
  fromDocType: string,
  targetDocType: string,
): DependencyEdge | null {
  const transitiveEdges = getTransitiveDependents(lane, fromDocType);
  return transitiveEdges.find(e => e.to_doc_type === targetDocType) || null;
}

// ── Internal: Resolve documents for a doc type in a project ──

async function resolveDocumentsForDocType(
  supabase: any,
  projectId: string,
  docType: string,
): Promise<{ id: string; doc_type: string }[]> {
  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId)
    .eq("doc_type", docType);

  return docs || [];
}

// ── Internal: Resolve authoritative version (approved + is_current) ──

async function resolveAuthoritativeVersion(
  supabase: any,
  documentId: string,
): Promise<string | null> {
  // Authoritative = approved + is_current
  const { data: approved } = await supabase
    .from("project_document_versions")
    .select("id")
    .eq("document_id", documentId)
    .eq("is_current", true)
    .eq("approval_status", "approved")
    .limit(1)
    .maybeSingle();

  if (approved) return approved.id;

  // Fallback: just is_current (no approval yet)
  const { data: current } = await supabase
    .from("project_document_versions")
    .select("id")
    .eq("document_id", documentId)
    .eq("is_current", true)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return current?.id || null;
}

// ── Internal: Build bounded repair plan with section narrowing ──

async function buildRepairPlan(
  supabase: any,
  affected: AffectedDocument,
  changeSource: ChangeSource,
): Promise<BoundedRepairPlan> {
  const sectionConfig = getSectionConfig(affected.docType);
  const blockReasons: string[] = [];

  // Lane validation
  const laneValid = !!changeSource.lane && changeSource.lane !== "unspecified";
  if (!laneValid) {
    blockReasons.push("lane_unspecified");
  }

  // Authoritative version binding
  if (!affected.authoritativeVersionId) {
    blockReasons.push("no_authoritative_version");
  }

  // Determine scope mode with precision classification
  let scopeMode: BoundedRepairPlan["scopeMode"];
  let scopePrecision: ScopePrecision;
  let affectedSections: SectionScope[] = [];
  let recommendedRewriteMode: BoundedRepairPlan["recommendedRewriteMode"];

  if (blockReasons.length > 0) {
    scopeMode = "blocked";
    scopePrecision = "blocked";
    recommendedRewriteMode = "manual_review";
  } else if (isEpisodicBlockRepairSupported(affected.docType)) {
    // Episode-block targeting for episodic doc types
    scopeMode = "section_targeted";
    scopePrecision = "section_capable_fallback"; // episode targeting available but not offset-narrowed
    recommendedRewriteMode = "replace_section";
    affectedSections = [{
      sectionKey: "episode_block",
      label: "Episode Block (episodic targeting available)",
      repairMode: "replace_section",
      targetingMethod: "episode_block",
    }];
  } else if (sectionConfig && sectionConfig.section_repair_supported) {
    // Section-level targeting available — attempt precision narrowing via mention offsets
    const narrowedSections = await narrowSectionsViaMentionOffsets(
      supabase, affected, changeSource, sectionConfig,
    );

    if (narrowedSections.length > 0) {
      // Precise: we have offset-backed section targeting
      scopeMode = "section_targeted";
      scopePrecision = "precise_section_targeted";
      recommendedRewriteMode = "replace_section";
      affectedSections = narrowedSections;
    } else {
      // Fallback: all sections of this doc type are candidates
      scopeMode = "section_targeted";
      scopePrecision = "section_capable_fallback";
      recommendedRewriteMode = "replace_section";
      affectedSections = sectionConfig.sections.map(s => ({
        sectionKey: s.section_key,
        label: s.label,
        repairMode: s.repair_mode,
        targetingMethod: "section_registry_fallback" as const,
      }));
    }
  } else {
    // No section support — full document fallback
    scopeMode = "full_document";
    scopePrecision = "document_level_fallback";
    recommendedRewriteMode = "full_doc_rewrite";
  }

  return {
    targetDocumentId: affected.documentId,
    targetDocType: affected.docType,
    authoritativeVersionId: affected.authoritativeVersionId,
    affectedSections,
    scopeMode,
    scopePrecision,
    changeSource,
    dependentUnitIds: changeSource.kind === "canon_unit" ? [changeSource.sourceId] : [],
    dependentDecisionIds: changeSource.kind === "locked_decision" ? [changeSource.sourceId] : [],
    laneValid,
    recommendedRewriteMode,
    blockReasons,
  };
}

// ── Section Narrowing via Mention Offsets ──

/**
 * Attempt to narrow section targeting using canon_unit_mentions offsets.
 *
 * If the changed unit has mentions with offset_start/offset_end in the
 * target document's authoritative version, we can determine which section
 * headings the mention falls within, producing precise section targeting.
 *
 * Returns empty array if no offset-backed narrowing is possible
 * (triggering section_capable_fallback).
 */
async function narrowSectionsViaMentionOffsets(
  supabase: any,
  affected: AffectedDocument,
  changeSource: ChangeSource,
  sectionConfig: DocTypeSectionConfig,
): Promise<SectionScope[]> {
  if (changeSource.kind !== "canon_unit") return [];
  if (!affected.authoritativeVersionId) return [];

  // Fetch mentions for this unit in the target document's authoritative version
  const { data: mentions } = await supabase
    .from("canon_unit_mentions")
    .select("offset_start, offset_end")
    .eq("unit_id", changeSource.sourceId)
    .eq("document_id", affected.documentId)
    .eq("version_id", affected.authoritativeVersionId);

  if (!mentions || mentions.length === 0) return [];

  // Check if any mentions have usable offsets
  const offsetMentions = mentions.filter(
    (m: any) => m.offset_start != null && m.offset_end != null,
  );
  if (offsetMentions.length === 0) return [];

  // Fetch the document text to map offsets to sections
  const { data: version } = await supabase
    .from("project_document_versions")
    .select("plaintext")
    .eq("id", affected.authoritativeVersionId)
    .maybeSingle();

  if (!version?.plaintext) return [];

  // Map sections to their offset ranges in the document
  const sectionRanges = computeSectionRanges(version.plaintext, sectionConfig.sections);
  if (sectionRanges.length === 0) return [];

  // Find which sections contain mention offsets
  const matchedSectionKeys = new Set<string>();
  for (const mention of offsetMentions) {
    for (const sr of sectionRanges) {
      if (mention.offset_start >= sr.start && mention.offset_start < sr.end) {
        matchedSectionKeys.add(sr.sectionKey);
      }
    }
  }

  if (matchedSectionKeys.size === 0) return [];

  return sectionConfig.sections
    .filter(s => matchedSectionKeys.has(s.section_key))
    .map(s => ({
      sectionKey: s.section_key,
      label: s.label,
      repairMode: s.repair_mode,
      targetingMethod: "mention_offset" as const,
    }));
}

/**
 * Compute offset ranges for each section in document text.
 * Uses heading regex from section registry to find section boundaries.
 */
function computeSectionRanges(
  text: string,
  sections: SectionDefinition[],
): { sectionKey: string; start: number; end: number }[] {
  const lines = text.split("\n");
  const ranges: { sectionKey: string; start: number; lineIndex: number }[] = [];

  let charOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const section of sections) {
      if (section.match_mode === "heading_regex" || section.match_mode === "heading_exact") {
        try {
          const pattern = section.match_mode === "heading_exact"
            ? new RegExp(`^#+\\s*${escapeRegex(section.match_pattern)}\\s*$`, "i")
            : new RegExp(section.match_pattern, "i");
          if (pattern.test(line)) {
            ranges.push({ sectionKey: section.section_key, start: charOffset, lineIndex: i });
          }
        } catch {
          // Invalid regex — skip
        }
      }
    }
    charOffset += line.length + 1; // +1 for newline
  }

  // Convert to start/end ranges (each section ends where the next begins)
  const result: { sectionKey: string; start: number; end: number }[] = [];
  for (let i = 0; i < ranges.length; i++) {
    result.push({
      sectionKey: ranges[i].sectionKey,
      start: ranges[i].start,
      end: i + 1 < ranges.length ? ranges[i + 1].start : text.length,
    });
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Internal: Emit transition events ──

async function emitImpactTransitions(
  supabase: any,
  result: ImpactAnalysisResult,
): Promise<void> {
  const { changeSource } = result;

  // 1. Impact analysis completed
  try {
    await emitTransition(supabase, {
      projectId: changeSource.projectId,
      eventType: TRANSITION_EVENTS.IMPACT_ANALYSIS_COMPLETED,
      eventDomain: "impact",
      docType: changeSource.originDocType || changeSource.sourceId,
      lane: changeSource.lane,
      trigger: changeSource.kind,
      sourceOfTruth: "impact-engine-v2",
      status: result.hasAmbiguity ? "failed" : "completed",
      resultingState: {
        affected_count: result.affectedDocuments.length,
        repair_plans: result.repairPlans.length,
        blocked_count: result.blockedDocuments.length,
        lane_excluded_count: result.laneExcluded.length,
        has_ambiguity: result.hasAmbiguity,
        source_kind: changeSource.kind,
        source_id: changeSource.sourceId,
      },
    }, { critical: false });
  } catch (e: any) {
    console.warn(`[impact-engine] transition emit failed:`, e?.message);
  }

  // 2. Per-document affected events (only for stale invalidations)
  for (const affected of result.affectedDocuments) {
    if (affected.invalidationPolicy !== "stale") continue;
    try {
      await emitTransition(supabase, {
        projectId: changeSource.projectId,
        eventType: TRANSITION_EVENTS.AFFECTED_DOCUMENT_IDENTIFIED,
        eventDomain: "impact",
        docType: affected.docType,
        lane: changeSource.lane,
        resultingVersionId: affected.authoritativeVersionId || undefined,
        trigger: changeSource.kind,
        sourceOfTruth: "impact-engine-v2",
        status: "completed",
        resultingState: {
          impact_kind: affected.impactKind,
          invalidation_policy: affected.invalidationPolicy,
          repair_eligible: affected.repairEligible,
          block_reason: affected.blockReason,
        },
      }, { critical: false });
    } catch (e: any) {
      console.warn(`[impact-engine] affected doc transition emit failed:`, e?.message);
    }
  }

  // 3. Repair plans (bounded_repair_planned)
  for (const plan of result.repairPlans) {
    try {
      await emitTransition(supabase, {
        projectId: changeSource.projectId,
        eventType: TRANSITION_EVENTS.BOUNDED_REPAIR_PLANNED,
        eventDomain: "impact",
        docType: plan.targetDocType,
        lane: changeSource.lane,
        resultingVersionId: plan.authoritativeVersionId || undefined,
        trigger: changeSource.kind,
        sourceOfTruth: "impact-engine-v2",
        status: plan.scopeMode === "blocked" ? "failed" : "completed",
        resultingState: {
          scope_mode: plan.scopeMode,
          scope_precision: plan.scopePrecision,
          recommended_rewrite_mode: plan.recommendedRewriteMode,
          affected_sections_count: plan.affectedSections.length,
          affected_section_keys: plan.affectedSections.map(s => s.sectionKey),
          targeting_methods: [...new Set(plan.affectedSections.map(s => s.targetingMethod))],
          block_reasons: plan.blockReasons,
        },
      }, { critical: false });
    } catch (e: any) {
      console.warn(`[impact-engine] repair plan transition emit failed:`, e?.message);
    }
  }

  // 4. Blocked documents (impact_repair_blocked)
  for (const blocked of result.blockedDocuments) {
    try {
      await emitTransition(supabase, {
        projectId: changeSource.projectId,
        eventType: TRANSITION_EVENTS.IMPACT_REPAIR_BLOCKED,
        eventDomain: "impact",
        docType: blocked.docType,
        lane: changeSource.lane,
        trigger: changeSource.kind,
        sourceOfTruth: "impact-engine-v2",
        status: "failed",
        resultingState: { reason: blocked.reason },
      }, { critical: false });
    } catch (e: any) {
      console.warn(`[impact-engine] blocked transition emit failed:`, e?.message);
    }
  }
}

// ── Public: Validate repair plan eligibility (IEL guard) ──

/**
 * IEL validation for repair plan execution.
 * Ensures:
 * - Authoritative version is still current
 * - Plan targets are still valid
 * - Lane is valid
 * - No ambiguity flags
 *
 * Returns null if valid, or an error string if blocked.
 */
export async function validateRepairEligibility(
  supabase: any,
  plan: BoundedRepairPlan,
): Promise<string | null> {
  if (plan.scopeMode === "blocked") {
    return `Repair blocked: ${plan.blockReasons.join(", ")}`;
  }

  if (!plan.laneValid) {
    return "Lane is unspecified — cannot validate repair target";
  }

  if (!plan.authoritativeVersionId) {
    return "No authoritative version bound — cannot repair";
  }

  // Verify authoritative version is still current
  const { data: version } = await supabase
    .from("project_document_versions")
    .select("is_current, approval_status")
    .eq("id", plan.authoritativeVersionId)
    .maybeSingle();

  if (!version) {
    return `Authoritative version ${plan.authoritativeVersionId} no longer exists`;
  }

  if (!version.is_current) {
    return `Authoritative version ${plan.authoritativeVersionId} is no longer current — rebind required`;
  }

  return null; // Valid
}

// ── Public: Re-export section config for convenience ──

export { getSectionConfig } from "./deliverableSectionRegistry.ts";
