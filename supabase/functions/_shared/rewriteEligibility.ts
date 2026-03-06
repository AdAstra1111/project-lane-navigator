/**
 * Rewrite Eligibility Engine — Phase 2C
 *
 * Deterministic delta-based gating to prevent rewrite churn.
 * A rewrite is only eligible when the unresolved problem set
 * has materially changed since the last meaningful attempt.
 *
 * Fingerprint is computed from stable, DB-sourced signals.
 * No schema drift — fingerprints are stored in auto_run_jobs.meta_json.
 */

// ── Fingerprint computation ──

export interface EligibilityInput {
  /** Current doc type being rewritten */
  docType: string;
  /** Baseline version ID used for the rewrite */
  baselineVersionId: string;
  /** IDs of unresolved blocking issues (sorted) */
  blockerIds: string[];
  /** IDs of unresolved high-impact notes (sorted) */
  highImpactIds: string[];
  /** IDs of upstream note blockers from unified note control (sorted) */
  upstreamNoteBlockerIds: string[];
  /** Current resolver hash (qualification/criteria snapshot) */
  resolverHash: string | null;
  /** Hash of accepted decisions bundle */
  acceptedDecisionsHash: string | null;
  /** Whether current version is stale */
  isStale: boolean;
  /** Repair mode / strategy being used */
  strategy: string;
  /** Frontier version ID if in explore path */
  frontierVersionId: string | null;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  fingerprint: string;
  previousFingerprint: string | null;
  materialChanges: string[];
  unchangedInputs: string[];
  blockingFactors: string[];
}

/**
 * Simple deterministic hash (djb2) — no crypto dependency needed.
 */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Compute a deterministic eligibility fingerprint from stable inputs.
 * The fingerprint changes if and only if a material input changes.
 */
export function computeEligibilityFingerprint(input: EligibilityInput): string {
  const parts = [
    `dt:${input.docType}`,
    `bv:${input.baselineVersionId}`,
    `bl:${[...input.blockerIds].sort().join(",")}`,
    `hi:${[...input.highImpactIds].sort().join(",")}`,
    `un:${[...input.upstreamNoteBlockerIds].sort().join(",")}`,
    `rh:${input.resolverHash || "null"}`,
    `ad:${input.acceptedDecisionsHash || "null"}`,
    `st:${input.isStale ? "1" : "0"}`,
    `sg:${input.strategy}`,
    `fv:${input.frontierVersionId || "null"}`,
  ];
  return djb2(parts.join("|"));
}

/**
 * Compare two fingerprints and return which inputs changed.
 */
function diffInputs(
  current: EligibilityInput,
  previous: EligibilityInput | null,
): { changed: string[]; unchanged: string[] } {
  if (!previous) return { changed: ["first_attempt"], unchanged: [] };

  const changed: string[] = [];
  const unchanged: string[] = [];

  const checks: [string, boolean][] = [
    ["baseline_version", current.baselineVersionId !== previous.baselineVersionId],
    ["blocker_set", JSON.stringify([...current.blockerIds].sort()) !== JSON.stringify([...previous.blockerIds].sort())],
    ["high_impact_set", JSON.stringify([...current.highImpactIds].sort()) !== JSON.stringify([...previous.highImpactIds].sort())],
    ["upstream_note_blockers", JSON.stringify([...current.upstreamNoteBlockerIds].sort()) !== JSON.stringify([...previous.upstreamNoteBlockerIds].sort())],
    ["resolver_hash", current.resolverHash !== previous.resolverHash],
    ["accepted_decisions", current.acceptedDecisionsHash !== previous.acceptedDecisionsHash],
    ["stale_state", current.isStale !== previous.isStale],
    ["strategy", current.strategy !== previous.strategy],
    ["frontier_version", current.frontierVersionId !== previous.frontierVersionId],
  ];

  for (const [label, didChange] of checks) {
    if (didChange) changed.push(label);
    else unchanged.push(label);
  }

  return { changed, unchanged };
}

/**
 * Evaluate rewrite eligibility by comparing current fingerprint
 * against the last stored fingerprint.
 *
 * @param current  Current eligibility inputs
 * @param previousFingerprint  Fingerprint from last rewrite attempt (from meta_json)
 * @param previousInput  Previous eligibility inputs (from meta_json, optional for detailed diff)
 * @param mode  "auto" = fail-closed on unchanged; "manual" = warn but allow with override
 */
export function getRewriteEligibility(
  current: EligibilityInput,
  previousFingerprint: string | null,
  previousInput: EligibilityInput | null,
  mode: "auto" | "manual" = "auto",
): EligibilityResult {
  const fingerprint = computeEligibilityFingerprint(current);

  // First attempt — always eligible
  if (!previousFingerprint) {
    return {
      eligible: true,
      reason: "first_attempt",
      fingerprint,
      previousFingerprint: null,
      materialChanges: ["first_attempt"],
      unchangedInputs: [],
      blockingFactors: [],
    };
  }

  // Fingerprint changed — eligible
  if (fingerprint !== previousFingerprint) {
    const { changed, unchanged } = diffInputs(current, previousInput);
    return {
      eligible: true,
      reason: `material_delta_detected: ${changed.join(", ")}`,
      fingerprint,
      previousFingerprint,
      materialChanges: changed.length > 0 ? changed : ["fingerprint_changed"],
      unchangedInputs: unchanged,
      blockingFactors: [],
    };
  }

  // Fingerprint unchanged
  const { changed, unchanged } = diffInputs(current, previousInput);

  if (mode === "manual") {
    // Manual rewrites: warn but allow (user override)
    return {
      eligible: true,
      reason: "manual_override: no material delta but user-initiated",
      fingerprint,
      previousFingerprint,
      materialChanges: changed,
      unchangedInputs: unchanged,
      blockingFactors: ["no_material_delta"],
    };
  }

  // Auto-run: fail-closed
  return {
    eligible: false,
    reason: "no_material_delta: fingerprint unchanged since last attempt",
    fingerprint,
    previousFingerprint,
    materialChanges: changed,
    unchangedInputs: unchanged,
    blockingFactors: ["fingerprint_unchanged", "no_blocker_change", "no_upstream_change"],
  };
}

/**
 * Build eligibility input from live DB state.
 * Called before each rewrite attempt.
 */
export async function buildEligibilityInput(
  supabase: any,
  projectId: string,
  docType: string,
  baselineVersionId: string,
  options: {
    blockers?: any[];
    highImpactNotes?: any[];
    resolverHash?: string | null;
    acceptedDecisionsHash?: string | null;
    strategy?: string;
    frontierVersionId?: string | null;
  },
): Promise<EligibilityInput> {
  // Get upstream note blockers
  let upstreamNoteBlockerIds: string[] = [];
  try {
    const { getUnifiedUpstreamNoteBlockers } = await import("./unifiedNoteControl.ts");
    const upstreamBlockers = await getUnifiedUpstreamNoteBlockers(supabase, projectId, docType);
    upstreamNoteBlockerIds = upstreamBlockers.map((b: any) => b.id).sort();
  } catch (e: any) {
    console.warn("[rewrite-eligibility] upstream note query failed:", e?.message);
  }

  // Check stale state
  let isStale = false;
  try {
    const { data: verRow } = await supabase
      .from("project_document_versions")
      .select("is_stale")
      .eq("id", baselineVersionId)
      .maybeSingle();
    isStale = verRow?.is_stale === true;
  } catch {
    // ignore — default false
  }

  const blockerIds = (options.blockers || [])
    .map((b: any) => b.id || b.note_key || "")
    .filter(Boolean)
    .sort();

  const highImpactIds = (options.highImpactNotes || [])
    .map((n: any) => n.id || n.note_key || "")
    .filter(Boolean)
    .sort();

  return {
    docType,
    baselineVersionId,
    blockerIds,
    highImpactIds,
    upstreamNoteBlockerIds,
    resolverHash: options.resolverHash || null,
    acceptedDecisionsHash: options.acceptedDecisionsHash || null,
    isStale,
    strategy: options.strategy || "unknown",
    frontierVersionId: options.frontierVersionId || null,
  };
}

/**
 * Build the scope key for eligibility persistence.
 * Scoped by doc_type + strategy to prevent cross-doc and cross-strategy collisions.
 */
export function buildEligibilityScopeKey(docType: string, strategy: string): string {
  return `${docType}::${strategy}`;
}

/**
 * Read the previous eligibility fingerprint from auto_run_jobs.meta_json,
 * scoped by doc_type + strategy.
 *
 * Falls back to legacy flat fields for backward compatibility with
 * jobs that were persisted before scoping was introduced.
 */
export function readPreviousEligibility(
  jobMetaJson: any,
  scopeKey?: string,
): {
  fingerprint: string | null;
  input: EligibilityInput | null;
} {
  if (!jobMetaJson) return { fingerprint: null, input: null };

  // Scoped read (preferred)
  if (scopeKey) {
    const scopedMap = jobMetaJson.eligibility_state_by_scope;
    if (scopedMap && scopedMap[scopeKey]) {
      return {
        fingerprint: scopedMap[scopeKey].fingerprint || null,
        input: scopedMap[scopeKey].input || null,
      };
    }
  }

  // Legacy flat fallback (pre-scoping jobs)
  return {
    fingerprint: jobMetaJson.last_eligibility_fingerprint || null,
    input: jobMetaJson.last_eligibility_input || null,
  };
}

/**
 * Build the meta_json patch to persist eligibility state after a rewrite attempt,
 * scoped by doc_type + strategy.
 *
 * Stores under `eligibility_state_by_scope[scopeKey]` to prevent cross-doc
 * and cross-strategy fingerprint collisions within a single job.
 *
 * NOTE: Phase 2C eligibility is currently enforced on auto-run only.
 * Manual rewrite path is NOT yet wired.
 */
export function buildEligibilityPersistPatch(
  existingMetaJson: any,
  fingerprint: string,
  input: EligibilityInput,
  scopeKey?: string,
): Record<string, any> {
  const base = existingMetaJson || {};

  if (scopeKey) {
    const existingScoped = base.eligibility_state_by_scope || {};
    return {
      ...base,
      eligibility_state_by_scope: {
        ...existingScoped,
        [scopeKey]: {
          fingerprint,
          input,
          updated_at: new Date().toISOString(),
        },
      },
    };
  }

  // Legacy flat write (should not be reached after this patch)
  return {
    ...base,
    last_eligibility_fingerprint: fingerprint,
    last_eligibility_input: input,
    last_eligibility_at: new Date().toISOString(),
  };
}
