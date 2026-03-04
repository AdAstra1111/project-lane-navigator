/**
 * Canonical decision normalizer — guarantees safe UI structures.
 * All decision rendering paths MUST use this before .map() calls.
 * NO DB writes, NO semantic changes — IEL logging only.
 */

export type UiDecision = {
  decision_key: string | null;
  title?: string | null;
  summary?: string | null;
  options: any[];
  selectedOptions: any[];
  impacts: any[];
  blockers: any[];
  recommended?: any | null;
  source?: "legacy_pending" | "decision_ledger" | "unknown";
};

export function normalizeDecision(
  input: any,
  source: UiDecision["source"] = "unknown"
): UiDecision {
  const d = input ?? {};

  const options = Array.isArray(d.options) ? d.options : [];
  const selectedOptions = Array.isArray(d.selectedOptions) ? d.selectedOptions : [];
  const impacts = Array.isArray(d.impacts) ? d.impacts : [];
  const blockers = Array.isArray(d.blockers) ? d.blockers : [];

  const out: UiDecision = {
    decision_key: typeof d.decision_key === "string" ? d.decision_key : null,
    title: typeof d.title === "string" ? d.title : null,
    summary: typeof d.summary === "string" ? d.summary : null,
    options,
    selectedOptions,
    impacts,
    blockers,
    recommended: d.recommended ?? null,
    source,
  };

  const missing: string[] = [];
  if (!Array.isArray(d.options)) missing.push("options");
  if (!Array.isArray(d.selectedOptions)) missing.push("selectedOptions");
  if (!Array.isArray(d.impacts)) missing.push("impacts");
  if (!Array.isArray(d.blockers)) missing.push("blockers");

  if (missing.length > 0) {
    console.warn("[decisions][IEL] malformed_decision_payload", {
      source,
      decision_key: out.decision_key,
      missing_fields: missing,
    });
  }

  return out;
}

export function normalizeDecisionList(
  raw: any,
  source: UiDecision["source"] = "unknown"
): UiDecision[] {
  if (!Array.isArray(raw)) {
    console.warn("[decisions][IEL] malformed_decisions_list", {
      source,
      received_type: typeof raw,
    });
    return [];
  }
  return raw.map((d) => normalizeDecision(d, source));
}
