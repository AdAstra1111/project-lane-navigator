/**
 * Narrative Integrity Engine (NIE) — Phase 1
 *
 * Post-analyze diagnostic overlay that evaluates cross-document narrative
 * coherence. Runs AFTER doc-local analyze completes; appends structured
 * integrity findings to the analyze output_json without replacing CI/GP.
 *
 * PHASE 1 SCOPE:
 *   - Doc types: character_bible, beat_sheet
 *   - Integrity domains: character, plot_payoff, canon, ladder_readiness
 *   - Feature-flagged behind NIE_V1
 *   - No schema changes — results stored inside existing output_json
 *
 * ARCHITECTURE:
 *   - loadAdjacentDocPack(): deterministic upstream/downstream doc loader
 *   - evaluateNarrativeIntegrity(): LLM post-pass for cross-doc comparison
 *   - Returns structured NarrativeIntegrityResult
 */

import { LANE_DOC_LADDERS, type LaneKey } from "./documentLadders.ts";
import { getDocPurposeClass, type DocPurposeClass } from "./docPurposeRegistry.ts";

// ── Types ──

export interface IntegrityDomainResult {
  status: "clear" | "warning" | "blocked";
  findings: string[];
  evidence: string[];
}

export interface NarrativeIntegrityResult {
  integrity_score: number;
  integrity_state: "clear" | "warning" | "blocked";
  integrity_domains: {
    character?: IntegrityDomainResult;
    plot_payoff?: IntegrityDomainResult;
    canon?: IntegrityDomainResult;
    ladder_readiness?: IntegrityDomainResult;
  };
  blockers: string[];
  warnings: string[];
  evidence: string[];
  compared_docs: { doc_type: string; doc_id: string; direction: "upstream" | "downstream" }[];
  engine_version: string;
  evaluated_at: string;
}

export interface AdjacentDoc {
  doc_type: string;
  doc_id: string;
  plaintext: string;
  direction: "upstream" | "downstream";
}

export interface AdjacentDocPack {
  upstream: AdjacentDoc | null;
  downstream: AdjacentDoc | null;
  canon_text: string | null;
}

// ── Constants ──

const NIE_VERSION = "nie_v1_phase1";
const ADJACENT_DOC_BUDGET = 8000; // chars per adjacent doc
const CANON_BUDGET = 4000;

/** Doc types supported in Phase 1 */
const NIE_PHASE1_DOC_TYPES = new Set(["character_bible", "beat_sheet"]);

/** Purpose classes eligible for NIE */
const NIE_ELIGIBLE_PURPOSES: Set<DocPurposeClass> = new Set([
  "DEVELOPMENT_ARCHITECTURE",
  "SCRIPT_EXECUTION",
]);

// ── Ladder Utilities ──

function resolveLane(assignedLane: string | null): LaneKey {
  const laneMap: Record<string, LaneKey> = {
    "feature-film": "feature_film",
    "feature_film": "feature_film",
    "film": "feature_film",
    "independent-film": "feature_film",
    "independent_film": "feature_film",
    "series": "series",
    "tv-series": "series",
    "tv_series": "series",
    "vertical-drama": "vertical_drama",
    "vertical_drama": "vertical_drama",
    "documentary": "documentary",
    "animation": "animation",
    "short": "short",
    "short-film": "short",
    "short_film": "short",
  };
  return laneMap[assignedLane || ""] || "feature_film";
}

function getAdjacentDocTypes(
  docType: string,
  lane: LaneKey,
): { upstream: string | null; downstream: string | null } {
  const ladder = LANE_DOC_LADDERS[lane] || LANE_DOC_LADDERS.feature_film;
  const idx = ladder.indexOf(docType);
  if (idx < 0) return { upstream: null, downstream: null };
  return {
    upstream: idx > 0 ? ladder[idx - 1] : null,
    downstream: idx < ladder.length - 1 ? ladder[idx + 1] : null,
  };
}

// ── Adjacent Doc Loading ──

export async function loadAdjacentDocPack(
  supabaseClient: any,
  projectId: string,
  docType: string,
  assignedLane: string | null,
): Promise<AdjacentDocPack> {
  const lane = resolveLane(assignedLane);
  const { upstream, downstream } = getAdjacentDocTypes(docType, lane);

  const loadDoc = async (targetDocType: string, direction: "upstream" | "downstream"): Promise<AdjacentDoc | null> => {
    try {
      const { data: doc } = await supabaseClient
        .from("project_documents")
        .select("id, doc_type")
        .eq("project_id", projectId)
        .eq("doc_type", targetDocType)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!doc) return null;

      const { data: ver } = await supabaseClient
        .from("project_document_versions")
        .select("plaintext")
        .eq("document_id", doc.id)
        .eq("is_current", true)
        .maybeSingle();

      if (!ver?.plaintext || ver.plaintext.trim().length < 50) return null;

      return {
        doc_type: targetDocType,
        doc_id: doc.id,
        plaintext: ver.plaintext.slice(0, ADJACENT_DOC_BUDGET),
        direction,
      };
    } catch (e) {
      console.warn(`[NIE] Failed to load adjacent doc ${targetDocType}:`, e);
      return null;
    }
  };

  // Load canon
  let canonText: string | null = null;
  try {
    const { data: canonRow } = await supabaseClient
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();
    if (canonRow?.canon_json) {
      const cj = canonRow.canon_json;
      const parts: string[] = [];
      if (cj.logline) parts.push(`Logline: ${cj.logline}`);
      if (cj.premise) parts.push(`Premise: ${cj.premise}`);
      if (cj.genre) parts.push(`Genre: ${cj.genre}`);
      if (cj.tone) parts.push(`Tone: ${cj.tone}`);
      if (Array.isArray(cj.characters)) {
        parts.push(`Characters: ${cj.characters.map((c: any) => c.name || c).join(", ")}`);
      }
      if (Array.isArray(cj.world_rules)) {
        parts.push(`World Rules:\n- ${cj.world_rules.join("\n- ")}`);
      }
      if (cj.themes) parts.push(`Themes: ${Array.isArray(cj.themes) ? cj.themes.join(", ") : cj.themes}`);
      canonText = parts.join("\n").slice(0, CANON_BUDGET);
    }
  } catch (e) {
    console.warn("[NIE] Failed to load canon:", e);
  }

  // Load upstream and downstream in parallel
  const [upDoc, downDoc] = await Promise.all([
    upstream ? loadDoc(upstream, "upstream") : Promise.resolve(null),
    downstream ? loadDoc(downstream, "downstream") : Promise.resolve(null),
  ]);

  return { upstream: upDoc, downstream: downDoc, canon_text: canonText };
}

// ── NIE Evaluation ──

/**
 * Check if NIE should run for this doc type.
 */
export function shouldRunNIE(docType: string): boolean {
  if (!NIE_PHASE1_DOC_TYPES.has(docType)) return false;
  const purpose = getDocPurposeClass(docType);
  return NIE_ELIGIBLE_PURPOSES.has(purpose);
}

/**
 * Build the NIE comparison prompt for the LLM.
 */
function buildNIEPrompt(
  docType: string,
  docText: string,
  pack: AdjacentDocPack,
): { system: string; user: string } {
  const contextParts: string[] = [];

  if (pack.canon_text) {
    contextParts.push(`=== CANON (authoritative project truth) ===\n${pack.canon_text}`);
  }
  if (pack.upstream) {
    contextParts.push(`=== UPSTREAM DOC: ${pack.upstream.doc_type} ===\n${pack.upstream.plaintext}`);
  }
  if (pack.downstream) {
    contextParts.push(`=== DOWNSTREAM DOC: ${pack.downstream.doc_type} ===\n${pack.downstream.plaintext}`);
  }

  const system = `You are a narrative integrity validator for film/TV development.
Your job is to compare a document against its adjacent documents and canon to detect cross-document narrative issues.

You evaluate FOUR integrity domains:

1. CHARACTER INTEGRITY
   - Are character wants/needs/contradictions consistent across documents?
   - Do character arcs in this doc align with what adjacent docs establish or expect?
   - Are relationship dynamics coherent?
   - Is protagonist/antagonist function maintained?

2. PLOT/PAYOFF INTEGRITY
   - Does setup in upstream docs have payoff in this or downstream docs?
   - Is climax/aftermath present where expected?
   - Is antagonist resolution explicit where required?
   - Does escalation path complete rather than truncate?

3. CANON INTEGRITY
   - Does this document contradict any locked canon facts?
   - Is there factual or world-rule drift?
   - Are character roles/identities consistent with canon?

4. LADDER READINESS INTEGRITY
   - Does this document provide what the next stage actually needs?
   - Are required handoff elements present?
   - Are there unresolved gaps blocking next-stage usefulness?

For each domain, assess:
- status: "clear" (no issues), "warning" (minor inconsistencies), or "blocked" (serious cross-doc problems)
- findings: specific issues found (empty array if clear)
- evidence: brief quotes or references supporting findings

Return ONLY valid JSON in this exact shape:
{
  "integrity_score": <0-100, 100=perfect coherence>,
  "integrity_state": "<clear|warning|blocked>",
  "domains": {
    "character": { "status": "<clear|warning|blocked>", "findings": ["..."], "evidence": ["..."] },
    "plot_payoff": { "status": "<clear|warning|blocked>", "findings": ["..."], "evidence": ["..."] },
    "canon": { "status": "<clear|warning|blocked>", "findings": ["..."], "evidence": ["..."] },
    "ladder_readiness": { "status": "<clear|warning|blocked>", "findings": ["..."], "evidence": ["..."] }
  },
  "blockers": ["<only serious cross-doc issues that should block promotion>"],
  "warnings": ["<minor inconsistencies worth noting>"]
}

RULES:
- Only flag CROSS-DOCUMENT issues. Do not repeat doc-local quality issues.
- Be specific: name characters, scenes, beats involved.
- If no adjacent docs are available for a domain, mark it "clear" with finding "insufficient_context".
- Do not hallucinate issues. If alignment is good, say so.
- integrity_score: 90-100 = clear, 60-89 = warning, <60 = blocked.`;

  const userPrompt = `DOCUMENT BEING EVALUATED (type: ${docType}):
${docText.slice(0, 12000)}

${contextParts.length > 0 ? "\nCROSS-REFERENCE CONTEXT:\n" + contextParts.join("\n\n") : "\nNo adjacent documents available for comparison."}

Evaluate narrative integrity across all four domains. Return JSON only.`;

  return { system, user: userPrompt };
}

/**
 * Run the Narrative Integrity Engine evaluation.
 */
export async function evaluateNarrativeIntegrity(
  callAIFn: (apiKey: string, model: string, system: string, user: string, temperature?: number, maxTokens?: number) => Promise<string>,
  parseAIJsonFn: (apiKey: string, raw: string) => Promise<any>,
  apiKey: string,
  model: string,
  docType: string,
  docText: string,
  pack: AdjacentDocPack,
): Promise<NarrativeIntegrityResult> {
  const { system, user } = buildNIEPrompt(docType, docText, pack);

  const comparedDocs: NarrativeIntegrityResult["compared_docs"] = [];
  if (pack.upstream) comparedDocs.push({ doc_type: pack.upstream.doc_type, doc_id: pack.upstream.doc_id, direction: "upstream" });
  if (pack.downstream) comparedDocs.push({ doc_type: pack.downstream.doc_type, doc_id: pack.downstream.doc_id, direction: "downstream" });

  // Default result for fallback
  const defaultResult: NarrativeIntegrityResult = {
    integrity_score: 100,
    integrity_state: "clear",
    integrity_domains: {},
    blockers: [],
    warnings: [],
    evidence: [],
    compared_docs: comparedDocs,
    engine_version: NIE_VERSION,
    evaluated_at: new Date().toISOString(),
  };

  // If no adjacent docs and no canon, skip LLM call — insufficient context
  if (!pack.upstream && !pack.downstream && !pack.canon_text) {
    console.log("[NIE] No adjacent docs or canon available — returning clear (insufficient_context)");
    defaultResult.integrity_domains = {
      character: { status: "clear", findings: ["insufficient_context"], evidence: [] },
      plot_payoff: { status: "clear", findings: ["insufficient_context"], evidence: [] },
      canon: { status: "clear", findings: ["insufficient_context"], evidence: [] },
      ladder_readiness: { status: "clear", findings: ["insufficient_context"], evidence: [] },
    };
    return defaultResult;
  }

  try {
    const raw = await callAIFn(apiKey, model, system, user, 0.1, 4000);
    const parsed = await parseAIJsonFn(apiKey, raw);

    if (!parsed || typeof parsed.integrity_score !== "number") {
      console.warn("[NIE] LLM output invalid, returning default");
      return defaultResult;
    }

    // Normalize integrity_state from score if not provided
    const score = Math.max(0, Math.min(100, parsed.integrity_score));
    const state: "clear" | "warning" | "blocked" =
      parsed.integrity_state || (score >= 90 ? "clear" : score >= 60 ? "warning" : "blocked");

    // Map domains
    const domains: NarrativeIntegrityResult["integrity_domains"] = {};
    const rawDomains = parsed.domains || {};
    for (const key of ["character", "plot_payoff", "canon", "ladder_readiness"] as const) {
      const d = rawDomains[key];
      if (d) {
        domains[key] = {
          status: (["clear", "warning", "blocked"].includes(d.status) ? d.status : "clear") as "clear" | "warning" | "blocked",
          findings: Array.isArray(d.findings) ? d.findings.slice(0, 10) : [],
          evidence: Array.isArray(d.evidence) ? d.evidence.slice(0, 10) : [],
        };
      }
    }

    // Collect all evidence from domains
    const allEvidence: string[] = [];
    for (const d of Object.values(domains)) {
      if (d) allEvidence.push(...d.evidence);
    }

    return {
      integrity_score: score,
      integrity_state: state,
      integrity_domains: domains,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.slice(0, 10) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 10) : [],
      evidence: allEvidence.slice(0, 20),
      compared_docs: comparedDocs,
      engine_version: NIE_VERSION,
      evaluated_at: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[NIE] Evaluation failed:", err?.message);
    return defaultResult;
  }
}
