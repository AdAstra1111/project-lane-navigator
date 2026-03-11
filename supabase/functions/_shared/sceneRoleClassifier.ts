/**
 * sceneRoleClassifier.ts — Deterministic Heuristic Scene Role Classification
 *
 * Classifies scenes into scene_role_taxonomy roles using:
 *   1. Position fraction (structural zone heuristics)
 *   2. Slugline / summary / content keyword signals
 *
 * Architecture:
 *   - No LLM. No external calls. No DB queries. No schema mutations.
 *   - Deterministic and reproducible for identical input.
 *   - Fail-closed: returns [] when classification is uncertain.
 *   - Returns at most 2 roles per scene (primary + optional secondary).
 *   - role_key values are restricted to SCENE_ROLE_TAXONOMY only.
 *
 * Usage:
 *   import { classifySceneRoles } from "../_shared/sceneRoleClassifier.ts";
 *   const results = classifySceneRoles(orderedScenes);
 *
 * Canonical location: supabase/functions/_shared/sceneRoleClassifier.ts
 */

// ── Taxonomy ──────────────────────────────────────────────────────────────

export const SCENE_ROLE_TAXONOMY = [
  "setup",
  "escalation",
  "reversal",
  "reveal",
  "payoff",
  "breather",
  "transition",
  "climax",
  "denouement",
] as const;

export type SceneRoleKey = typeof SCENE_ROLE_TAXONOMY[number];

export interface SceneRoleClassification {
  role_key:   SceneRoleKey;
  confidence: number;     // 0.0 – 1.0
  note:       string | null;
}

// ── Input / Output types ──────────────────────────────────────────────────

export interface SceneForClassification {
  scene_id:       string;
  position_index: number;    // 0-based order index
  total_scenes:   number;    // total active scene count
  slugline:       string | null;
  summary:        string | null;
  content:        string | null;  // raw screenplay text (first 3 000 chars used)
}

export interface SceneRoleResult {
  scene_id:    string;
  scene_roles: SceneRoleClassification[];
  skipped?:    string;   // present when no roles assigned
}

// ── Structural zone thresholds (fraction of screenplay) ──────────────────
//
// The screenplay is divided into six zones that map to standard three-act structure.
// Thresholds are conservative: they err toward the most structurally certain
// classification for each zone rather than covering every edge case.
//
//   Setup zone:     0.00 – 0.15   (opening 15%)
//   Early zone:     0.15 – 0.28   (inciting + rising action begins)
//   Rising zone:    0.28 – 0.45   (rising action)
//   Midpoint zone:  0.45 – 0.60   (midpoint ± buffer)
//   Late zone:      0.60 – 0.82   (late Act 2 escalation + dark night)
//   Climax zone:    0.82 – 0.94   (Act 3 climax)
//   Denouement:     0.94 – 1.00   (final resolution)
//
const SETUP_MAX      = 0.15;
const EARLY_MIN      = 0.15;
const EARLY_MAX      = 0.28;
const RISING_MIN     = 0.28;
const RISING_MAX     = 0.45;
const MID_MIN        = 0.45;
const MID_MAX        = 0.60;
const LATE_MIN       = 0.60;
const LATE_MAX       = 0.82;
const CLIMAX_MIN     = 0.82;
const CLIMAX_MAX     = 0.94;
const DENOUEMENT_MIN = 0.94;

// ── Keyword signal patterns ───────────────────────────────────────────────

const CLIMAX_PATTERNS: RegExp[] = [
  /\b(final\s+(?:battle|confrontation|showdown)|showdown|face-?off|last\s+stand|climax|defeats?|kills?|explosion|collapse|crash|escapes?|execut|destroy)\b/i,
];

const REVEAL_PATTERNS: RegExp[] = [
  /\b(reveal[s|ed]?|discovers?|realizes?|truth\s+(?:is|comes\s+out)|secret(?:s)?\s+(?:is|are)\s+(?:out|reveal|exposed)|confesses?|admits?\s+(?:to|that)|exposed|unmask|found\s+out|the\s+real)\b/i,
];

const REVERSAL_PATTERNS: RegExp[] = [
  /\b(betray[s|al|ed]?|turns\s+against|unexpected\s+(?:ally|enemy)|double-?cross|pivots?|everything\s+changes?|shocked|stunned|twist|reversal|switches?\s+sides?)\b/i,
];

const ESCALATION_PATTERNS: RegExp[] = [
  /\b(escalat|tension|pressure\s+mounts?|stakes?\s+(?:rise|raised|higher)|desperate|cornered|pursued|hunts?|danger\s+(?:grows?|escalat)|time\s+(?:is\s+running\s+out|running\s+out)|worse|closing\s+in)\b/i,
];

const TRANSITION_PATTERNS: RegExp[] = [
  /\b(meanwhile|later|elsewhere|next\s+(?:day|morning|week)|days?\s+later|weeks?\s+later|montage|intercut|on\s+the\s+road|travelling?|journeys?|arrives?)\b/i,
];

const DENOUEMENT_PATTERNS: RegExp[] = [
  /\b(aftermath|settle[sd]?|peaceful|quiet\s+morning|goodbye|farewell|last\s+time|together\s+at\s+last|final\s+(?:moments?|scene|shot|frame)|home\s+at\s+last|healed?|recover|resolve[sd]?)\b/i,
];

const BREATHER_PATTERNS: RegExp[] = [
  /\b(laugh[s|ter|ing]?|joke[sd]?|playful|gentle\s+moment|tender|romantic\s+moment|banter|smile[sd]?|comedy\s+relief|light\s+moment|relief)\b/i,
];

const SETUP_PATTERNS: RegExp[] = [
  /\b(introduces?|establishes?|meet[s]?\s+(?:us|the)|we\s+(?:see|meet)|opens?\s+on|begins?\s+with|wakes?\s+up|morning\s+routine|new\s+(?:day|world|city)|arriving|first\s+(?:look|glimpse|day))\b/i,
];

// ── Internal helpers ──────────────────────────────────────────────────────

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

function combineText(
  slugline: string | null,
  summary:  string | null,
  content:  string | null,
): string {
  // Use content sparingly — first 3 000 chars to avoid false positives from long scenes
  const contentExcerpt = content ? content.slice(0, 3000) : "";
  return [slugline ?? "", summary ?? "", contentExcerpt].join(" ");
}

// ── Core classifier ───────────────────────────────────────────────────────

/**
 * Classify a single scene using structural zones + keyword signals.
 *
 * Algorithm:
 *   1. Compute position fraction (0.0 = first scene, 1.0 = last scene)
 *   2. Assign a primary zone-based role
 *   3. Override or supplement with keyword signals
 *   4. Deduplicate, cap at 2 roles, sort by confidence descending
 *   5. Return [] when confidence of all candidates is below 0.50 (fail-closed)
 *
 * Notes:
 *   - Confidence values are heuristic — they indicate relative reliability,
 *     not calibrated probabilities.
 *   - Position-zone confidence is boosted near zone edges (more certain) and
 *     reduced near zone midpoints (ambiguous).
 *   - Keyword signals can promote or add secondary roles cross-zone.
 */
export function classifySceneRole(scene: SceneForClassification): SceneRoleClassification[] {
  const { position_index, total_scenes, slugline, summary, content } = scene;

  // Position fraction: 0.0 → first scene, 1.0 → last scene
  const frac = total_scenes > 1 ? position_index / (total_scenes - 1) : 0.5;

  const all = combineText(slugline, summary, content);
  const candidates: SceneRoleClassification[] = [];

  // ── Zone 1: Setup (0.00 – 0.15) ──────────────────────────────────────
  if (frac <= SETUP_MAX) {
    // Confidence rises as fraction approaches 0 (opener = most certain)
    const conf = Math.min(0.90, 0.75 + (SETUP_MAX - frac) * 1.0);
    candidates.push({ role_key: "setup", confidence: conf, note: `opening zone (${pct(frac)}%)` });

    // Early reveal possible even in setup zone (inciting incident at page 10-15)
    if (frac > 0.08 && anyMatch(all, REVEAL_PATTERNS)) {
      candidates.push({ role_key: "reveal", confidence: 0.68, note: "inciting reveal in opening zone" });
    }
  }

  // ── Zone 2: Early / Inciting (0.15 – 0.28) ──────────────────────────
  if (frac > EARLY_MIN && frac <= EARLY_MAX) {
    if (anyMatch(all, REVEAL_PATTERNS)) {
      candidates.push({ role_key: "reveal", confidence: 0.80, note: "reveal in inciting zone" });
    } else if (anyMatch(all, SETUP_PATTERNS)) {
      candidates.push({ role_key: "setup", confidence: 0.68, note: "extended setup" });
    } else {
      candidates.push({ role_key: "escalation", confidence: 0.65, note: `early escalation (${pct(frac)}%)` });
    }
  }

  // ── Zone 3: Rising Action (0.28 – 0.45) ─────────────────────────────
  if (frac > RISING_MIN && frac <= RISING_MAX) {
    if (anyMatch(all, REVEAL_PATTERNS)) {
      candidates.push({ role_key: "reveal", confidence: 0.74, note: "reveal in rising action" });
    } else if (anyMatch(all, ESCALATION_PATTERNS)) {
      candidates.push({ role_key: "escalation", confidence: 0.78, note: "rising action escalation" });
    } else {
      candidates.push({ role_key: "escalation", confidence: 0.60, note: `rising action (${pct(frac)}%)` });
    }
  }

  // ── Zone 4: Midpoint (0.45 – 0.60) ──────────────────────────────────
  if (frac > MID_MIN && frac <= MID_MAX) {
    if (anyMatch(all, REVERSAL_PATTERNS)) {
      candidates.push({ role_key: "reversal", confidence: 0.85, note: `reversal at midpoint (${pct(frac)}%)` });
    } else if (anyMatch(all, REVEAL_PATTERNS)) {
      candidates.push({ role_key: "reveal", confidence: 0.78, note: `midpoint reveal (${pct(frac)}%)` });
    } else {
      candidates.push({ role_key: "escalation", confidence: 0.58, note: `midpoint escalation (${pct(frac)}%)` });
    }
  }

  // ── Zone 5: Late Act 2 (0.60 – 0.82) ────────────────────────────────
  if (frac > LATE_MIN && frac <= LATE_MAX) {
    if (anyMatch(all, REVERSAL_PATTERNS)) {
      candidates.push({ role_key: "reversal", confidence: 0.80, note: `late Act 2 reversal (${pct(frac)}%)` });
    } else if (anyMatch(all, CLIMAX_PATTERNS)) {
      // Early climax signal in late zone — slightly lower confidence than structural climax zone
      candidates.push({ role_key: "climax", confidence: 0.72, note: "climax language in late Act 2" });
    } else if (anyMatch(all, ESCALATION_PATTERNS)) {
      candidates.push({ role_key: "escalation", confidence: 0.75, note: `late escalation (${pct(frac)}%)` });
    } else {
      candidates.push({ role_key: "escalation", confidence: 0.60, note: `late Act 2 (${pct(frac)}%)` });
    }
  }

  // ── Zone 6: Climax (0.82 – 0.94) ────────────────────────────────────
  if (frac > CLIMAX_MIN && frac <= CLIMAX_MAX) {
    // Confidence peaks in the middle of the climax zone
    const distFromCenter = Math.abs(frac - (CLIMAX_MIN + CLIMAX_MAX) / 2);
    const conf = Math.min(0.92, 0.80 + (0.12 - distFromCenter * 0.5));
    candidates.push({ role_key: "climax", confidence: conf, note: `climax zone (${pct(frac)}%)` });
  }

  // ── Zone 7: Denouement (0.94 – 1.00) ────────────────────────────────
  if (frac > DENOUEMENT_MIN) {
    const conf = Math.min(0.95, 0.85 + (frac - DENOUEMENT_MIN) * 2.5);
    candidates.push({ role_key: "denouement", confidence: conf, note: `denouement zone (final ${pct(1 - frac)}%)` });
  }

  // ── Cross-zone keyword signals (additive secondary roles) ────────────

  // Climax language anywhere in the back half → secondary climax signal
  if (frac > 0.50 && anyMatch(all, CLIMAX_PATTERNS) &&
      !candidates.some(c => c.role_key === "climax")) {
    candidates.push({ role_key: "climax", confidence: 0.62, note: "climax language outside structural zone" });
  }

  // Transition language → low-confidence transition (structural connective tissue)
  if (anyMatch(all, TRANSITION_PATTERNS) &&
      !candidates.some(c => c.role_key === "transition")) {
    candidates.push({ role_key: "transition", confidence: 0.55, note: "transition language detected" });
  }

  // Breather signals → low-confidence breather (override only as secondary)
  if (anyMatch(all, BREATHER_PATTERNS) && frac > 0.15 && frac < 0.85 &&
      !candidates.some(c => c.role_key === "breather")) {
    candidates.push({ role_key: "breather", confidence: 0.52, note: "breather / relief moment detected" });
  }

  // Denouement language in final third (secondary signal)
  if (frac > 0.65 && anyMatch(all, DENOUEMENT_PATTERNS) &&
      !candidates.some(c => c.role_key === "denouement")) {
    candidates.push({ role_key: "denouement", confidence: 0.65, note: "resolution language in final act" });
  }

  // ── Deduplicate: keep highest confidence per role_key ─────────────────
  const byKey = new Map<SceneRoleKey, SceneRoleClassification>();
  for (const c of candidates) {
    const existing = byKey.get(c.role_key);
    if (!existing || c.confidence > existing.confidence) {
      byKey.set(c.role_key, { ...c, confidence: Math.min(c.confidence, 1.0) });
    }
  }

  // Return top 2 by confidence, filtering out sub-threshold entries
  const CONFIDENCE_THRESHOLD = 0.50;
  return [...byKey.values()]
    .filter(c => c.confidence >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);
}

// ── Batch classifier ──────────────────────────────────────────────────────

/**
 * Classify scene roles for an ordered array of scenes.
 * Returns one SceneRoleResult per scene, including skipped entries.
 *
 * Idempotent: does not mutate the input array.
 * Fail-closed: scenes with no heuristic match return { scene_roles: [] }.
 *
 * @param scenes        Ordered array (position_index must already reflect order)
 * @param stopOnEmpty   If true, stop processing when first no-match scene found (debug)
 */
export function classifySceneRoles(scenes: SceneForClassification[]): SceneRoleResult[] {
  return scenes.map(scene => {
    const roles = classifySceneRole(scene);
    if (roles.length === 0) {
      return { scene_id: scene.scene_id, scene_roles: [], skipped: "no_heuristic_match" };
    }
    return { scene_id: scene.scene_id, scene_roles: roles };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}
