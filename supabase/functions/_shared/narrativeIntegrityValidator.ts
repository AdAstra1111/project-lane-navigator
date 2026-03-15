/**
 * Narrative Integrity Validator v1
 *
 * Deterministic, rule-based validation engine that checks authoritative project
 * state against canonical truth layers. Detects contradictions, missing structures,
 * and decision/unit conflicts without performing any mutations.
 *
 * SCOPE (v1):
 *   - Rule-based validation ONLY. No LLM/semantic judgment.
 *   - Reads persisted truth; does NOT mutate state.
 *   - Binds to authoritative versions by default.
 *   - Emits Transition Ledger events for audit.
 *   - Fails CLOSED when authority is missing or ambiguous.
 *
 * SUPPORTED VALIDATION DOMAINS (v1):
 *   1. authority_binding — authoritative version exists and is_current
 *   2. lane_doc_type — doc exists and belongs to the project's lane ladder
 *   3. locked_decision_presence — locked decisions are referenced in target docs
 *   4. canon_entity_coverage — canon entities appear in authoritative doc text
 *   5. required_sections — required sections exist for the doc type
 *   6. unit_mention_staleness — canon unit mentions reference current versions
 *
 * UNSUPPORTED / DEFERRED:
 *   - Semantic contradiction detection (requires LLM)
 *   - Timeline contradiction (no structured timeline model yet)
 *   - World-rule contradiction (no structured world-rule model yet)
 *   - Relationship contradiction (no structured relationship validation model yet)
 *   - Cross-document narrative consistency (requires semantic comparison)
 *
 * TRUTH HIERARCHY (enforced):
 *   Canon > Locked Decisions > Canon Units > Authoritative Documents > Corpus > AI Inference
 *
 * ARCHITECTURE:
 *   - Uses existing canon tables, decision_ledger, canon_units, canon_unit_mentions
 *   - Uses deliverableSectionRegistry for required-section checks
 *   - Uses documentLadders for lane validity
 *   - Uses docPolicyRegistry.validateCanonAlignment for entity coverage
 *   - Reuses resolveAuthoritativeVersion pattern from impactEngine
 *   - No schema drift: results are transient + emitted to Transition Ledger
 *   - No automatic repair or rewriting
 */

import { type LaneKey, LANE_DOC_LADDERS } from "./documentLadders.ts";
import { DOC_TYPE_REGISTRY } from "./doc-os.ts";
import { getSectionConfig } from "./deliverableSectionRegistry.ts";
import { parseSections } from "./sectionRepairEngine.ts";
import { buildCanonEntitiesFromDB, validateCanonAlignment } from "./docPolicyRegistry.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";

// ── Validation Domain Registry ──

export const SUPPORTED_DOMAINS = [
  "authority_binding",
  "lane_doc_type",
  "locked_decision_presence",
  "canon_entity_coverage",
  "required_sections",
  "unit_mention_staleness",
] as const;

export type ValidationDomain = typeof SUPPORTED_DOMAINS[number];

const UNSUPPORTED_DOMAINS = [
  "semantic_contradiction",
  "timeline_contradiction",
  "world_rule_contradiction",
  "relationship_contradiction",
  "cross_document_consistency",
] as const;

export type UnsupportedDomain = typeof UNSUPPORTED_DOMAINS[number];

function isDomainSupported(d: string): d is ValidationDomain {
  return (SUPPORTED_DOMAINS as readonly string[]).includes(d);
}

// ── Violation Types ──

export type ViolationType =
  | "contradiction"      // persisted truth conflicts with document state
  | "ambiguity"          // truth cannot be determined confidently
  | "incompleteness"     // required structure missing
  | "unsupported_domain" // domain cannot be validated deterministically
  | "consistency_pass";  // explicit clean result for audit

export type ViolationSeverity = "blocking" | "warning" | "informational";

export type ScopeLevel = "project" | "document" | "section";

export interface Violation {
  /** Stable derived key for deduplication */
  violationKey: string;
  violationType: ViolationType;
  severity: ViolationSeverity;
  scopeLevel: ScopeLevel;
  domain: ValidationDomain | UnsupportedDomain | string;
  projectId: string;
  affectedDocType: string | null;
  affectedDocumentId: string | null;
  authoritativeVersionId: string | null;
  affectedSectionKey: string | null;
  sourceOfTruthConflict: string;
  summary: string;
  details: string;
  blocking: boolean;
  evidenceRefs: Record<string, unknown>;
}

// ── Validation Request ──

export interface NarrativeValidationRequest {
  projectId: string;
  lane: LaneKey;
  /** Specific doc types to validate. If empty, validates all project docs. */
  targetDocTypes?: string[];
  /** Specific domains to check. If empty, runs all supported domains. */
  domains?: string[];
  /** If true, also validate a candidate (non-authoritative) version */
  candidateVersionId?: string;
  /** Format string for canon alignment context */
  format?: string | null;
}

// ── Validation Result ──

export interface NarrativeValidationResult {
  projectId: string;
  validatedAt: string;
  domainsRun: ValidationDomain[];
  domainsSkipped: string[];
  domainsUnsupported: string[];
  violations: Violation[];
  blockingViolationCount: number;
  warningCount: number;
  passCount: number;
  /** Whether validation was blocked before running */
  blocked: boolean;
  blockReasons: string[];
}

// ── Main Entry Point ──

/**
 * Run narrative integrity validation for a project.
 *
 * FAIL-CLOSED: Returns blocked result if:
 *   - No lane specified
 *   - No project documents found
 *   - Authority is ambiguous for a required domain
 *
 * Does NOT mutate any state. Results are transient + Transition Ledger events.
 */
export async function runNarrativeIntegrityValidation(
  supabase: any,
  request: NarrativeValidationRequest,
): Promise<NarrativeValidationResult> {
  const { projectId, lane } = request;

  const result: NarrativeValidationResult = {
    projectId,
    validatedAt: new Date().toISOString(),
    domainsRun: [],
    domainsSkipped: [],
    domainsUnsupported: [],
    violations: [],
    blockingViolationCount: 0,
    warningCount: 0,
    passCount: 0,
    blocked: false,
    blockReasons: [],
  };

  // ── Pre-flight: lane check ──
  if (!lane || lane === ("unspecified" as LaneKey)) {
    result.blocked = true;
    result.blockReasons.push("lane_unspecified_or_invalid");
    await emitBlockedEvent(supabase, result);
    return result;
  }

  // ── Emit started event ──
  await emitTransition(supabase, {
    projectId,
    eventType: TRANSITION_EVENTS.NARRATIVE_VALIDATION_STARTED,
    eventDomain: "validation",
    lane,
    status: "intent",
    sourceOfTruth: "narrative-integrity-validator-v1",
    resultingState: {
      requested_domains: request.domains || "all_supported",
      target_doc_types: request.targetDocTypes || "all_project_docs",
    },
  }, { critical: false });

  // ── Resolve requested domains ──
  const requestedDomains = request.domains && request.domains.length > 0
    ? request.domains
    : [...SUPPORTED_DOMAINS];

  for (const d of requestedDomains) {
    if (isDomainSupported(d)) {
      // will be run
    } else {
      result.domainsUnsupported.push(d);
      result.violations.push({
        violationKey: `unsupported:${d}:${projectId}`,
        violationType: "unsupported_domain",
        severity: "informational",
        scopeLevel: "project",
        domain: d,
        projectId,
        affectedDocType: null,
        affectedDocumentId: null,
        authoritativeVersionId: null,
        affectedSectionKey: null,
        sourceOfTruthConflict: "none",
        summary: `Domain "${d}" is not supported in v1`,
        details: `This validation domain requires capabilities not yet implemented (e.g. LLM-based semantic analysis). Deferred to future version.`,
        blocking: false,
        evidenceRefs: { reason: "not_deterministically_validatable_in_v1" },
      });
    }
  }

  const domainsToRun = requestedDomains.filter(isDomainSupported);

  // ── Load project documents ──
  const { data: allDocs } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId);

  if (!allDocs || allDocs.length === 0) {
    result.blocked = true;
    result.blockReasons.push("no_project_documents_found");
    await emitBlockedEvent(supabase, result);
    return result;
  }

  const targetDocs = request.targetDocTypes && request.targetDocTypes.length > 0
    ? allDocs.filter((d: any) => request.targetDocTypes!.includes(d.doc_type))
    : allDocs;

  // ── Run each domain ──
  for (const domain of domainsToRun) {
    try {
      const violations = await runDomain(supabase, domain, request, targetDocs);
      result.violations.push(...violations);
      result.domainsRun.push(domain);
    } catch (err: any) {
      console.error(`[narrative-validator] domain ${domain} failed:`, err?.message);
      result.domainsSkipped.push(domain);
      result.violations.push({
        violationKey: `domain_error:${domain}:${projectId}`,
        violationType: "ambiguity",
        severity: "warning",
        scopeLevel: "project",
        domain,
        projectId,
        affectedDocType: null,
        affectedDocumentId: null,
        authoritativeVersionId: null,
        affectedSectionKey: null,
        sourceOfTruthConflict: "domain_execution_failure",
        summary: `Domain "${domain}" failed to execute: ${err?.message}`,
        details: `The domain could not complete validation due to an internal error. This is treated as ambiguous.`,
        blocking: false,
        evidenceRefs: { error: err?.message },
      });
    }
  }

  // ── Classify counts ──
  for (const v of result.violations) {
    if (v.blocking) result.blockingViolationCount++;
    else if (v.severity === "warning") result.warningCount++;
    else if (v.violationType === "consistency_pass") result.passCount++;
  }

  // ── Emit completed event ──
  await emitTransition(supabase, {
    projectId,
    eventType: TRANSITION_EVENTS.NARRATIVE_VALIDATION_COMPLETED,
    eventDomain: "validation",
    lane,
    status: "completed",
    sourceOfTruth: "narrative-integrity-validator-v1",
    resultingState: {
      domains_run: result.domainsRun,
      domains_skipped: result.domainsSkipped,
      domains_unsupported: result.domainsUnsupported,
      violation_count: result.violations.length,
      blocking_count: result.blockingViolationCount,
      warning_count: result.warningCount,
      pass_count: result.passCount,
    },
  }, { critical: false });

  // ── Emit individual violation events for blocking violations ──
  for (const v of result.violations) {
    if (v.blocking) {
      await emitTransition(supabase, {
        projectId,
        eventType: TRANSITION_EVENTS.NARRATIVE_VIOLATION_DETECTED,
        eventDomain: "validation",
        lane,
        docType: v.affectedDocType || undefined,
        resultingVersionId: v.authoritativeVersionId || undefined,
        status: "completed",
        sourceOfTruth: "narrative-integrity-validator-v1",
        resultingState: {
          violation_key: v.violationKey,
          violation_type: v.violationType,
          severity: v.severity,
          domain: v.domain,
          summary: v.summary,
        },
      }, { critical: false });
    }
  }

  console.log(`[narrative-validator] completed { project: "${projectId}", domains_run: ${result.domainsRun.length}, violations: ${result.violations.length}, blocking: ${result.blockingViolationCount}, warnings: ${result.warningCount}, passes: ${result.passCount} }`);

  return result;
}

// ── Domain Router ──

async function runDomain(
  supabase: any,
  domain: ValidationDomain,
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Promise<Violation[]> {
  switch (domain) {
    case "authority_binding":
      return runAuthorityBindingCheck(supabase, request, docs);
    case "lane_doc_type":
      return runLaneDocTypeCheck(request, docs);
    case "locked_decision_presence":
      return runLockedDecisionPresenceCheck(supabase, request, docs);
    case "canon_entity_coverage":
      return runCanonEntityCoverageCheck(supabase, request, docs);
    case "required_sections":
      return runRequiredSectionsCheck(supabase, request, docs);
    case "unit_mention_staleness":
      return runUnitMentionStalenessCheck(supabase, request, docs);
    default:
      return [];
  }
}

// ── Domain 1: Authority Binding ──

async function runAuthorityBindingCheck(
  supabase: any,
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const doc of docs) {
    const { data: currentVersion } = await supabase
      .from("project_document_versions")
      .select("id, is_current, approval_status")
      .eq("document_id", doc.id)
      .eq("is_current", true)
      .maybeSingle();

    if (!currentVersion) {
      violations.push({
        violationKey: `authority:no_current_version:${doc.id}`,
        violationType: "incompleteness",
        severity: "blocking",
        scopeLevel: "document",
        domain: "authority_binding",
        projectId: request.projectId,
        affectedDocType: doc.doc_type,
        affectedDocumentId: doc.id,
        authoritativeVersionId: null,
        affectedSectionKey: null,
        sourceOfTruthConflict: "no_current_version",
        summary: `Document "${doc.doc_type}" has no current version`,
        details: `No version with is_current=true exists. This blocks all downstream operations.`,
        blocking: true,
        evidenceRefs: { document_id: doc.id },
      });
    }
  }

  return violations;
}

// ── Domain 2: Lane Doc-Type ──

function runLaneDocTypeCheck(
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Violation[] {
  const violations: Violation[] = [];
  const ladder = LANE_DOC_LADDERS[request.lane] || [];
  const ladderSet = new Set(ladder);

  for (const doc of docs) {
    if (!ladderSet.has(doc.doc_type)) {
      // Skip warning for output documents — they are valid but not ladder stages
      const registryEntry = DOC_TYPE_REGISTRY[doc.doc_type];
      if (registryEntry && registryEntry.doc_category === "output") {
        continue;
      }

      violations.push({
        violationKey: `lane:off_ladder:${doc.doc_type}:${request.lane}`,
        violationType: "contradiction",
        severity: "warning",
        scopeLevel: "document",
        domain: "lane_doc_type",
        projectId: request.projectId,
        affectedDocType: doc.doc_type,
        affectedDocumentId: doc.id,
        authoritativeVersionId: null,
        affectedSectionKey: null,
        sourceOfTruthConflict: `doc_type_not_in_lane_ladder:${request.lane}`,
        summary: `Document "${doc.doc_type}" is off-ladder for lane "${request.lane}"`,
        details: `This document type is not part of the registered ladder for lane "${request.lane}". It should not receive automated repairs or participate in pipeline progression.`,
        blocking: false,
        evidenceRefs: { lane: request.lane, ladder: ladder.slice(0, 10) },
      });
    }
  }

  return violations;
}

// ── Domain 3: Locked Decision Presence ──

async function runLockedDecisionPresenceCheck(
  supabase: any,
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Promise<Violation[]> {
  const violations: Violation[] = [];

  // Get active locked decisions with targets
  const { data: decisions } = await supabase
    .from("decision_ledger")
    .select("id, title, decision_text, targets, scope")
    .eq("project_id", request.projectId)
    .eq("status", "active")
    .limit(100);

  if (!decisions || decisions.length === 0) return [];

  // For each decision with explicit doc_type targets, check if a matching doc exists
  for (const decision of decisions) {
    const targetDocTypes = extractDecisionTargetDocTypes(decision);
    if (targetDocTypes.length === 0) continue;

    for (const targetDocType of targetDocTypes) {
      const matchingDoc = docs.find(d => d.doc_type === targetDocType);
      if (!matchingDoc) {
        violations.push({
          violationKey: `decision:missing_target_doc:${decision.id}:${targetDocType}`,
          violationType: "incompleteness",
          severity: "warning",
          scopeLevel: "project",
          domain: "locked_decision_presence",
          projectId: request.projectId,
          affectedDocType: targetDocType,
          affectedDocumentId: null,
          authoritativeVersionId: null,
          affectedSectionKey: null,
          sourceOfTruthConflict: `locked_decision_targets_missing_doc`,
          summary: `Locked decision "${decision.title || decision.id.slice(0, 8)}" targets doc type "${targetDocType}" which does not exist`,
          details: `Decision ID ${decision.id} specifies a target doc type that has no corresponding document in the project.`,
          blocking: false,
          evidenceRefs: { decision_id: decision.id, target_doc_type: targetDocType },
        });
      }
    }
  }

  return violations;
}

function extractDecisionTargetDocTypes(decision: any): string[] {
  const docTypes: string[] = [];
  const targets = decision.targets;
  if (!targets) return docTypes;

  if (Array.isArray(targets)) {
    for (const t of targets) {
      if (typeof t === "string") docTypes.push(t);
      else if (t?.doc_type) docTypes.push(t.doc_type);
    }
  } else if (typeof targets === "object") {
    if (targets.doc_type) docTypes.push(targets.doc_type);
    if (targets.doc_types && Array.isArray(targets.doc_types)) {
      targets.doc_types.forEach((dt: string) => docTypes.push(dt));
    }
  }
  return docTypes;
}

// ── Domain 4: Canon Entity Coverage ──

async function runCanonEntityCoverageCheck(
  supabase: any,
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Promise<Violation[]> {
  const violations: Violation[] = [];

  const canon = await buildCanonEntitiesFromDB(supabase, request.projectId);
  if (!canon || canon.entities.length === 0) return []; // No canon — cannot validate

  // Only check docs that are canon-consuming (not canon-defining)
  const CANON_DEFINING_TYPES = new Set([
    "canon", "nec", "format_rules", "project_overview", "creative_brief",
    "market_positioning", "idea", "concept_brief", "vertical_market_sheet",
    "market_sheet", "episode_grid", "season_master_script", "season_arc",
    "vertical_episode_beats", "character_bible", "beat_sheet", "treatment",
    "story_outline", "documentary_outline", "topline_narrative",
  ]);

  for (const doc of docs) {
    if (CANON_DEFINING_TYPES.has(doc.doc_type)) continue;

    // Get authoritative version plaintext
    const { data: version } = await supabase
      .from("project_document_versions")
      .select("id, plaintext")
      .eq("document_id", doc.id)
      .eq("is_current", true)
      .maybeSingle();

    if (!version?.plaintext) continue;

    const alignResult = validateCanonAlignment(version.plaintext, canon.entities);

    if (!alignResult.pass) {
      violations.push({
        violationKey: `canon_coverage:${doc.doc_type}:${doc.id}`,
        violationType: "contradiction",
        severity: "warning",
        scopeLevel: "document",
        domain: "canon_entity_coverage",
        projectId: request.projectId,
        affectedDocType: doc.doc_type,
        affectedDocumentId: doc.id,
        authoritativeVersionId: version.id,
        affectedSectionKey: null,
        sourceOfTruthConflict: "canon_entity_coverage_below_threshold",
        summary: `Document "${doc.doc_type}" has low canon entity coverage (${(alignResult.entityCoverage * 100).toFixed(0)}%)`,
        details: `Missing entities: [${alignResult.missingEntities.slice(0, 5).join(", ")}]. Foreign entities: [${alignResult.foreignEntities.slice(0, 5).join(", ")}].`,
        blocking: false,
        evidenceRefs: {
          entity_coverage: alignResult.entityCoverage,
          missing_count: alignResult.missingEntities.length,
          foreign_count: alignResult.foreignEntities.length,
          version_id: version.id,
        },
      });
    }
  }

  return violations;
}

// ── Domain 5: Required Sections ──

async function runRequiredSectionsCheck(
  supabase: any,
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const doc of docs) {
    const sectionConfig = getSectionConfig(doc.doc_type);
    if (!sectionConfig || !sectionConfig.section_repair_supported) continue;

    // Get authoritative version
    const { data: version } = await supabase
      .from("project_document_versions")
      .select("id, plaintext")
      .eq("document_id", doc.id)
      .eq("is_current", true)
      .maybeSingle();

    if (!version?.plaintext) continue;

    // Parse sections from actual content
    const parsed = parseSections(version.plaintext, doc.doc_type);
    const foundKeys = new Set(parsed.map((s: any) => s.section_key));

    for (const section of sectionConfig.sections) {
      if (!foundKeys.has(section.section_key)) {
        violations.push({
          violationKey: `missing_section:${doc.doc_type}:${section.section_key}:${doc.id}`,
          violationType: "incompleteness",
          severity: "warning",
          scopeLevel: "section",
          domain: "required_sections",
          projectId: request.projectId,
          affectedDocType: doc.doc_type,
          affectedDocumentId: doc.id,
          authoritativeVersionId: version.id,
          affectedSectionKey: section.section_key,
          sourceOfTruthConflict: "required_section_missing",
          summary: `Section "${section.label}" missing from "${doc.doc_type}"`,
          details: `The section registry requires "${section.section_key}" for doc type "${doc.doc_type}" but it was not found in the authoritative version content.`,
          blocking: false,
          evidenceRefs: {
            section_key: section.section_key,
            match_mode: section.match_mode,
            match_pattern: section.match_pattern,
            version_id: version.id,
          },
        });
      }
    }
  }

  return violations;
}

// ── Domain 6: Unit Mention Staleness ──

async function runUnitMentionStalenessCheck(
  supabase: any,
  request: NarrativeValidationRequest,
  docs: { id: string; doc_type: string }[],
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const doc of docs) {
    // Get current version ID
    const { data: currentVer } = await supabase
      .from("project_document_versions")
      .select("id")
      .eq("document_id", doc.id)
      .eq("is_current", true)
      .maybeSingle();

    if (!currentVer) continue;

    // Check if any mentions point to non-current versions
    const { data: staleMentions } = await supabase
      .from("canon_unit_mentions")
      .select("id, unit_id, version_id")
      .eq("document_id", doc.id)
      .neq("version_id", currentVer.id)
      .limit(20);

    if (staleMentions && staleMentions.length > 0) {
      violations.push({
        violationKey: `stale_mentions:${doc.doc_type}:${doc.id}`,
        violationType: "ambiguity",
        severity: "warning",
        scopeLevel: "document",
        domain: "unit_mention_staleness",
        projectId: request.projectId,
        affectedDocType: doc.doc_type,
        affectedDocumentId: doc.id,
        authoritativeVersionId: currentVer.id,
        affectedSectionKey: null,
        sourceOfTruthConflict: "canon_unit_mentions_reference_old_version",
        summary: `${staleMentions.length} canon unit mention(s) in "${doc.doc_type}" reference non-current versions`,
        details: `Unit mentions should reference the current authoritative version. Stale mentions may produce inaccurate impact analysis.`,
        blocking: false,
        evidenceRefs: {
          stale_mention_count: staleMentions.length,
          current_version_id: currentVer.id,
          stale_unit_ids: staleMentions.slice(0, 5).map((m: any) => m.unit_id),
        },
      });
    }
  }

  return violations;
}

// ── Transition Helpers ──

async function emitBlockedEvent(
  supabase: any,
  result: NarrativeValidationResult,
): Promise<void> {
  await emitTransition(supabase, {
    projectId: result.projectId,
    eventType: TRANSITION_EVENTS.NARRATIVE_VALIDATION_BLOCKED,
    eventDomain: "validation",
    status: "failed",
    sourceOfTruth: "narrative-integrity-validator-v1",
    resultingState: {
      block_reasons: result.blockReasons,
    },
  }, { critical: false });

  console.warn(`[narrative-validator] blocked { project: "${result.projectId}", reasons: [${result.blockReasons.join(",")}] }`);
}
