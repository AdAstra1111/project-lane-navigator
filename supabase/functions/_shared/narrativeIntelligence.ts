/**
 * Narrative Intelligence v0 — NDG (Narrative Decision Graph) + NUE (Narrative Unit Engine)
 *
 * INVARIANTS:
 * - Zero schema drift: stores in existing decision_ledger.decision_value and project_document_versions.meta_json
 * - Deterministic: same input → same output (stable hashes, sorted keys)
 * - Feature-flagged: NARRATIVE_INTELLIGENCE_V0 must be true to run extraction
 * - Fail-closed: missing plaintext → skip with IEL log, never fabricate
 */

// ── Feature Flag ──
export const NARRATIVE_INTELLIGENCE_V0 = false;

// ── NDG v0 Types ──

export type NdgNodeType =
  | "plot_structure"
  | "character"
  | "world_rule"
  | "theme"
  | "stakes"
  | "reversal"
  | "hook"
  | "constraint";

export interface NdgNode {
  node_id: string;
  node_type: NdgNodeType;
  summary: string;
  details: string | null;
  confidence: number | null;
  impact_targets: { doc_type: string; scope: "upstream" | "downstream" | "both"; note?: string }[];
  provenance: {
    created_by: "system" | "user" | "autopilot";
    source_doc_type?: string;
    source_version_id?: string;
    created_at: string;
  };
  status: "candidate" | "canon";
  checksum: string;
}

export interface NdgPayload {
  nodes: NdgNode[];
  version: "v0";
}

// ── NUE v0 Types ──

export type BeatType =
  | "discovery"
  | "reversal"
  | "revelation"
  | "escalation"
  | "decision"
  | "conflict"
  | "setup"
  | "payoff";

export interface NueUnit {
  unit_id: string;
  beat_type: BeatType;
  short: string;
  state_change: string;
  characters: string[];
  location: string | null;
  episode_index: number | null;
  links: { ndg_node_id?: string }[];
  confidence: number | null;
}

export interface NuePayload {
  units: NueUnit[];
  version: "v0";
}

// ── Deterministic Hashing ──

function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return String(obj);
  if (Array.isArray(obj)) return obj.map(stableStringify).join("|");
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}:${stableStringify(obj[k])}`)
    .join(",");
}

export function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function computeNodeChecksum(node: Omit<NdgNode, "checksum">): string {
  const normalized = stableStringify({
    node_id: node.node_id,
    node_type: node.node_type,
    summary: node.summary,
    details: node.details,
  });
  return djb2Hash(normalized);
}

export function computeUnitId(docType: string, canonicalText: string): string {
  return djb2Hash(`${docType}::${canonicalText.trim().toLowerCase()}`);
}

// ── NUE Extraction (deterministic, from plaintext) ──

const BEAT_MARKERS: Record<string, BeatType> = {
  discover: "discovery",
  reveal: "revelation",
  revers: "reversal",
  twist: "reversal",
  escalat: "escalation",
  decid: "decision",
  choos: "decision",
  conflict: "conflict",
  confront: "conflict",
  setup: "setup",
  plant: "setup",
  payoff: "payoff",
  resolv: "payoff",
};

/**
 * Extract narrative units from plaintext deterministically.
 * Returns empty array if plaintext is missing/empty (fail-closed).
 */
export function extractUnitsFromPlaintext(
  plaintext: string | null | undefined,
  docType: string,
  episodeIndex?: number | null,
): NueUnit[] {
  if (!plaintext || plaintext.trim().length < 50) return [];

  const units: NueUnit[] = [];
  // Split into paragraphs/sections, look for narrative beats
  const paragraphs = plaintext.split(/\n{2,}/).filter((p) => p.trim().length > 20);

  for (const para of paragraphs) {
    const lower = para.toLowerCase();
    let detectedBeat: BeatType | null = null;

    for (const [marker, beat] of Object.entries(BEAT_MARKERS)) {
      if (lower.includes(marker)) {
        detectedBeat = beat;
        break;
      }
    }

    if (!detectedBeat) continue;

    // Extract a short summary (first sentence or first 120 chars)
    const firstSentence = para.match(/^[^.!?]+[.!?]/)?.[0] || para.slice(0, 120);
    const short = firstSentence.trim();

    // Extract character names (capitalized words that appear multiple times)
    const namePattern = /\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?)\b/g;
    const names = new Set<string>();
    let match;
    while ((match = namePattern.exec(para)) !== null) {
      const name = match[1];
      // Filter common non-name words
      if (!["The", "This", "That", "There", "Then", "When", "Where", "What", "How", "But", "And", "She", "His", "Her", "They"].includes(name)) {
        names.add(name);
      }
    }

    const unitId = computeUnitId(docType, short);

    units.push({
      unit_id: unitId,
      beat_type: detectedBeat,
      short,
      state_change: `${detectedBeat} detected in ${docType}`,
      characters: Array.from(names).slice(0, 5),
      location: null,
      episode_index: episodeIndex ?? null,
      links: [],
      confidence: 0.5,
    });
  }

  return units;
}

/**
 * Build NUE payload for a version.
 */
export function buildNuePayload(units: NueUnit[]): NuePayload {
  return { units, version: "v0" };
}

// ── NDG Impact Analysis ──

/**
 * Compute which doc types are impacted by NDG nodes for a given current doc type.
 * Read-only — does NOT trigger any rewrites.
 */
export function computeImpactedDocs(
  ndgNodes: NdgNode[],
  currentDocType: string,
  ladder: string[],
): string[] {
  const impacted = new Set<string>();
  const currentIdx = ladder.indexOf(currentDocType);

  for (const node of ndgNodes) {
    for (const target of node.impact_targets) {
      if (target.doc_type === currentDocType) continue;
      const targetIdx = ladder.indexOf(target.doc_type);
      if (targetIdx < 0) continue;

      if (target.scope === "upstream" && targetIdx < currentIdx) impacted.add(target.doc_type);
      else if (target.scope === "downstream" && targetIdx > currentIdx) impacted.add(target.doc_type);
      else if (target.scope === "both") impacted.add(target.doc_type);
    }
  }

  return Array.from(impacted).sort((a, b) => ladder.indexOf(a) - ladder.indexOf(b));
}

// ── NDG Node from Legacy Pending Decision (read-only translation) ──

export function pendingDecisionToNdgCandidate(decision: any): NdgNode | null {
  if (!decision || !decision.decision_key) return null;

  const node: Omit<NdgNode, "checksum"> = {
    node_id: `legacy:${decision.decision_key}`,
    node_type: "constraint",
    summary: decision.title || decision.decision_key,
    details: decision.decision_text || null,
    confidence: null,
    impact_targets: [],
    provenance: {
      created_by: "system",
      source_doc_type: decision.decision_value?.scope_json?.doc_type,
      created_at: decision.created_at || new Date().toISOString(),
    },
    status: "candidate",
  };

  return { ...node, checksum: computeNodeChecksum(node) };
}

// ── DB Helpers (edge function context) ──

/**
 * Persist NUE extraction results to a version's meta_json.
 * Merges with existing meta_json — does not overwrite other keys.
 */
export async function persistNueToVersion(
  supabase: any,
  versionId: string,
  nuePayload: NuePayload,
): Promise<void> {
  // Read existing meta_json
  const { data: ver } = await supabase
    .from("project_document_versions")
    .select("meta_json")
    .eq("id", versionId)
    .maybeSingle();

  const existingMeta = ver?.meta_json || {};
  const merged = { ...existingMeta, nue: nuePayload };

  const { error } = await supabase
    .from("project_document_versions")
    .update({ meta_json: merged })
    .eq("id", versionId);

  if (error) {
    console.error(`[narrative-intelligence][IEL] nue_persist_failed { version_id: "${versionId}", error: "${error.message}" }`);
    throw error;
  }

  console.log(`[narrative-intelligence][IEL] nue_extracted { version_id: "${versionId}", unit_count: ${nuePayload.units.length}, source: "plaintext", version: "v0" }`);
}

/**
 * Load NDG nodes from decision_ledger for a project.
 */
export async function loadNdgNodes(
  supabase: any,
  projectId: string,
): Promise<NdgNode[]> {
  const { data: rows } = await supabase
    .from("decision_ledger")
    .select("decision_key, title, decision_text, decision_value, status, created_at, created_by")
    .eq("project_id", projectId)
    .in("source", ["ndg_v0"])
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  return rows
    .map((r: any) => {
      const ndg = r.decision_value?.ndg;
      if (!ndg) return null;
      return ndg as NdgNode;
    })
    .filter(Boolean) as NdgNode[];
}

/**
 * Persist an NDG node to decision_ledger.
 */
export async function persistNdgNode(
  supabase: any,
  projectId: string,
  node: NdgNode,
  userId?: string,
): Promise<void> {
  const { error } = await supabase.from("decision_ledger").insert({
    project_id: projectId,
    decision_key: `ndg:${node.node_id}`,
    title: node.summary.slice(0, 200),
    decision_text: `[NDG ${node.node_type}] ${node.summary}`,
    decision_value: { ndg: node },
    scope: "project",
    source: "ndg_v0",
    status: node.status === "canon" ? "active" : "workflow_pending",
    created_by: userId || null,
  });

  if (error) {
    console.error(`[narrative-intelligence][IEL] ndg_persist_failed { node_id: "${node.node_id}", error: "${error.message}" }`);
    throw error;
  }
}

/**
 * Load NUE payload from a version's meta_json.
 */
export async function loadNueFromVersion(
  supabase: any,
  versionId: string,
): Promise<NuePayload | null> {
  const { data: ver } = await supabase
    .from("project_document_versions")
    .select("meta_json")
    .eq("id", versionId)
    .maybeSingle();

  return ver?.meta_json?.nue || null;
}
