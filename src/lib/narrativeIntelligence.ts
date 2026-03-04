/**
 * Narrative Intelligence v0 — Frontend types + helpers
 * Mirrors the edge function types for UI consumption.
 */

// ── Feature Flag (mirrors backend) ──
export const NARRATIVE_INTELLIGENCE_V0 = false;

// ── NDG Types ──

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

// ── NUE Types ──

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

// ── Beat type display helpers ──

export const BEAT_TYPE_LABELS: Record<BeatType, string> = {
  discovery: "Discovery",
  reversal: "Reversal",
  revelation: "Revelation",
  escalation: "Escalation",
  decision: "Decision",
  conflict: "Conflict",
  setup: "Setup",
  payoff: "Payoff",
};

export const BEAT_TYPE_COLORS: Record<BeatType, string> = {
  discovery: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  reversal: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  revelation: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  escalation: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  decision: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  conflict: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  setup: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  payoff: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
};

export const NODE_TYPE_LABELS: Record<NdgNodeType, string> = {
  plot_structure: "Plot Structure",
  character: "Character",
  world_rule: "World Rule",
  theme: "Theme",
  stakes: "Stakes",
  reversal: "Reversal",
  hook: "Hook",
  constraint: "Constraint",
};
