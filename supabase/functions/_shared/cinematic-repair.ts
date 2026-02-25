/**
 * Cinematic Intelligence Kernel — Repair instruction builders
 * Produces minimal constraint bullets from CIK score failures.
 */
import type { CinematicScore, CinematicFailureCode } from "./cinematic-model.ts";
import { CINEMATIC_THRESHOLDS } from "./cinematic-score.ts";
import { lateStartIndexForUnitCount, minUpFracForUnitCount, maxZigzagFlipsForUnitCount } from "./cik/ladderLockConstants.ts";

// Deterministic priority order for failure bullets (Critical→Structure→Pacing→Tone→Metadata)
const BULLET_PRIORITY: readonly CinematicFailureCode[] = [
  "TOO_SHORT", "NO_PEAK", "NO_ESCALATION", "WEAK_ARC",
  "FLATLINE", "ENERGY_DROP", "DIRECTION_REVERSAL",
  "LOW_CONTRAST", "PACING_MISMATCH", "TONAL_WHIPLASH",
  "LOW_INTENT_DIVERSITY", "EYE_LINE_BREAK",
];

const BULLET_TEXT: Record<string, (u: string) => string> = {
  NO_PEAK: u => `Ensure a climax ${u} late with very high energy/tension.`,
  NO_ESCALATION: u => `Later ${u}s MUST have higher energy than early ${u}s.`,
  FLATLINE: u => `Avoid consecutive ${u}s with identical energy; include ≥0.20 jump.`,
  LOW_CONTRAST: () => `Add a contrast pivot: calm-to-chaos or hope-to-threat.`,
  TONAL_WHIPLASH: () => `Reduce polarity flips. Max 1 flip across the sequence.`,
  TOO_SHORT: u => `Ensure at least 4 ${u}s in the output.`,
  WEAK_ARC: () => `Build a clear arc: restrained start, build through mid, peak near end.`,
  LOW_INTENT_DIVERSITY: u => `Use ≥3 distinct intents across ${u}s.`,
  PACING_MISMATCH: u => `Fix pacing: late ${u}s need higher density than early ones.`,
  ENERGY_DROP: u => `Do NOT let energy drop in final ${u}s.`,
  DIRECTION_REVERSAL: () => `Reduce energy zigzag; trend upward overall.`,
  EYE_LINE_BREAK: u => `Ensure visual continuity between consecutive ${u}s.`,
};

function failureBullets(failures: CinematicFailureCode[], domain: "trailer" | "storyboard"): string[] {
  const unitLabel = domain === "trailer" ? "beat" : "panel";
  // Sort by deterministic priority
  const sorted = [...failures].sort((a, b) => {
    const ia = BULLET_PRIORITY.indexOf(a);
    const ib = BULLET_PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const MAX_BULLETS = 6;
  const shown = sorted.slice(0, MAX_BULLETS);
  const rest = sorted.slice(MAX_BULLETS);
  const bullets = shown.map(f => {
    const fn = BULLET_TEXT[f];
    return fn ? `• ${fn(unitLabel)}` : `• Fix: ${f}`;
  });
  if (rest.length > 0) {
    bullets.push(`• Also address: ${rest.join(", ")}.`);
  }
  return bullets;
}

const FAILURE_TARGETS: Record<string, string> = {
  NO_PEAK: "Ensure at least one of final 2 units has energy >= 0.92 and tension >= 0.82",
  NO_ESCALATION: "Ensure energy[0] <= 0.45 and energy[last] >= 0.85 (clear ramp)",
  FLATLINE: "Ensure at least two adjacent deltas >= 0.18 and no run of 3 deltas < 0.03",
  LOW_CONTRAST: "Ensure one pivot where tonal_polarity changes by >= 0.60 OR energy delta >= 0.25",
  TONAL_WHIPLASH: "Max 1 polarity flip across the sequence; use intermediate polarity units",
  TOO_SHORT: "Ensure unit count >= 4",
  WEAK_ARC: "Ensure a clear arc: early <=0.55, mid >=0.60, final >=0.85, and peak occurs in the final 2 units",
  LOW_INTENT_DIVERSITY: "Use at least 3 distinct intents across the sequence (e.g., intrigue -> threat -> chaos/emotion -> release)",
  PACING_MISMATCH: "Late units density >= 0.5; density variance across units should be >= 0.01; avoid uniform density",
  ENERGY_DROP: "energy[last] >= energy[mid]; final 20% of units must not trend downward; energy[last] >= 0.80",
  DIRECTION_REVERSAL: "Max 3 energy direction reversals (sign changes in energy deltas > 0.08); prefer monotonic ramp",
  EYE_LINE_BREAK: "Adjacent units should share coherent intent progression; max 2 intent changes per 3 consecutive units",
};

/**
 * Compute per-failure numeric targets using actual thresholds + unit count.
 * Returns deduped deterministic bullets AND a set of covered failure codes
 * so callers can deconflict against static targets.
 */
export function numericTargetsForFailures(args: {
  failures: string[];
  unitCount: number;
  thresholds?: typeof CINEMATIC_THRESHOLDS;
}): { targets: string[]; covered: Set<string> } {
  const { failures, unitCount, thresholds: t = CINEMATIC_THRESHOLDS } = args;
  const out: string[] = [];
  const covered = new Set<string>();
  const latePeakMin = Math.max(1, Math.floor(unitCount * 0.75));
  const latePeakStr = `peakIndex must be >= ${latePeakMin} (peak in last 25% of ${unitCount} units)`;

  const LADDER_FAILURES: ReadonlySet<string> = new Set([
    "DIRECTION_REVERSAL", "ENERGY_DROP", "FLATLINE", "PACING_MISMATCH", "WEAK_ARC",
  ]);

  for (const f of failures) {
    switch (f) {
      case "TOO_SHORT":
        out.push(`unitCount must equal ${unitCount} exactly (no more, no less)`);
        covered.add("TOO_SHORT");
        break;
      case "NO_PEAK":
        out.push(latePeakStr);
        out.push(`final unit must read as an explicit climax/turning-point beat`);
        covered.add("NO_PEAK");
        break;
      case "NO_ESCALATION":
      case "WEAK_ARC":
        out.push(`escalationScore must be >= ${Number(t.min_slope ?? 0.01).toFixed(2)}`);
        out.push(`energy must generally rise across units with at most 1 small dip`);
        covered.add(f);
        break;
      case "FLATLINE":
        out.push(`contrastScore must be >= ${Number(t.min_contrast ?? 0.55).toFixed(2)}`);
        out.push(`ensure at least 2 units are clearly higher-intensity than the baseline units`);
        covered.add("FLATLINE");
        break;
      case "LOW_CONTRAST":
        out.push(`contrastScore must be >= ${Number(t.min_contrast ?? 0.55).toFixed(2)}`);
        covered.add("LOW_CONTRAST");
        break;
      case "TONAL_WHIPLASH":
        out.push(`polarity sign flips must be <= ${Math.max(1, Math.floor(unitCount * 0.2))} total`);
        out.push(`avoid abrupt tonal inversions; delete outlier units first`);
        covered.add("TONAL_WHIPLASH");
        break;
      case "LOW_INTENT_DIVERSITY":
        out.push(`intentsDistinctCount must be >= 3`);
        out.push(`intents must appear in a clear sequence (setup → complication → payoff)`);
        covered.add("LOW_INTENT_DIVERSITY");
        break;
      case "PACING_MISMATCH":
        out.push(`pacing variance must decrease by removing or splitting outlier-long units`);
        out.push(`adjacent units should have smoother duration/intensity changes`);
        covered.add("PACING_MISMATCH");
        break;
      case "ENERGY_DROP":
        out.push(`post-peak units must not de-escalate; delete or tighten any drop after the peak`);
        out.push(latePeakStr);
        covered.add("ENERGY_DROP");
        break;
      case "DIRECTION_REVERSAL":
        out.push(`directionReversalCount must be <= ${Math.max(0, Math.floor(unitCount * 0.15))}`);
        out.push(`if reversal exists, place it once as an intentional midpoint twist`);
        covered.add("DIRECTION_REVERSAL");
        break;
      default:
        break;
    }
  }

  // CIK v3.12 — Compact ladder targets (when any ladder failure present)
  const hasLadderFailure = failures.some(f => LADDER_FAILURES.has(f));
  if (hasLadderFailure && unitCount >= 3) {
    const lateStart = lateStartIndexForUnitCount(unitCount);
    const minUp = minUpFracForUnitCount(unitCount);
    const maxFlips = maxZigzagFlipsForUnitCount(unitCount);
    out.push(`Rises ≥ ${Math.round(minUp * 100)}%`);
    out.push(`Dips ≤1; 0 in final 25%`);
    out.push(`Peak units ${lateStart + 1}–${unitCount}`);
    out.push(`Zigzags ≤ ${maxFlips}`);
    for (const f of failures) {
      if (LADDER_FAILURES.has(f)) covered.add(f);
    }
  }

  return { targets: Array.from(new Set(out)), covered };
}

export function amplifyRepairInstruction(base: string, failures: string[]): string {
  const targets = failures
    .map((f) => FAILURE_TARGETS[f])
    .filter(Boolean)
    .map((t) => `• ${t}`);
  if (targets.length === 0) return base;
  return `${base}

NUMERIC TARGETS (MUST MEET):
${targets.join("\n")}`;
}

const SHAPE_GUARD = `
CRITICAL REPAIR CONSTRAINTS:
- DO NOT change the response JSON shape, field names, or required structure.
- Return the EXACT same JSON schema as before.`;

const STORYBOARD_GUARD = `
- DO NOT drop, rename, or duplicate unit_key values.
- Return exactly one panel entry per requested unit_key.`;

const NO_NEW_INTENT_BLOCK = `
CONSTRAINTS (ATTEMPT 1):
- Do NOT introduce new characters, settings, subplots, or premise.
- Do NOT add new intent categories. Only rephrase, delete, reorder, and intensify existing intent.
- Prefer deletion and reordering over adding material.
- Keep unit count EXACT.`;

const PROCEDURE_TRAILER = `
PROCEDURE (MANDATORY, ATTEMPT 1)
1) Fix structure using ONLY deletion and reordering first:
   - Delete or tighten any flat/outlier units.
   - Reorder units so energy/intent ramps toward a late peak.
2) Then minimally rephrase remaining units to meet numeric targets.
Rules:
- Prefer deleting 1 weak unit over adding new material.
- Do NOT introduce new content; deletion/reorder > rewrite.`;

const PROCEDURE_STORYBOARD = `
PROCEDURE (MANDATORY, ATTEMPT 1)
1) Fix structure using ONLY tightening and minimal reordering within existing unit_keys:
   - Do NOT drop, rename, or duplicate unit_key values.
   - Prefer tightening/deleting nonessential beats inside a panel over adding new beats.
2) Then minimally rephrase to meet numeric targets.
Rules:
- No new characters/settings/props not already implied.`;

const LADDER_LOCK_SUFFIX = `
LADDER LOCK (ATTEMPT 1): adjacent units generally rise; ≤1 dip total (midpoint only); 0 dips in final 25%; peak in final 25%; reorder/delete before rephrase; keep exact unitCount; no new intents/chars/setting.`;

export function addIntentSequencingHint(base: string, failures: string[]): string {
  if (!failures.includes("LOW_INTENT_DIVERSITY") && !failures.includes("WEAK_ARC")) return base;
  return `${base}

INTENT ARC SUGGESTION (REPAIR ONLY):
- Early units: intrigue or wonder (setup/mystery)
- Mid units: threat or chaos (escalation)
- Late units: emotion or release (resolution/button)
Rules:
- Use at least 3 distinct intents across units.
- Keep peak intensity in final 2 units.`;
}

export function addPolarityRampLock(base: string, failures: string[]): string {
  if (!failures.includes("TONAL_WHIPLASH") && !failures.includes("WEAK_ARC")) return base;
  return `${base}

TONAL RAMP LOCK (REPAIR ONLY):
- No more than 1 polarity sign flip across units.
- Adjacent tonal_polarity changes should be gradual (prefer step <= 0.6).
- Use a ramp (generally darker->lighter or lighter->darker), not oscillation.
- Do NOT change main JSON schema.`;
}

/**
 * Assemble a bounded repair instruction from sections.
 * Drops optional sections if total exceeds MAX_REPAIR_CHARS.
 * Never drops: shape guard, numeric targets, no-new-intent, procedure.
 */
const MAX_REPAIR_CHARS = 2500;

interface RepairSection {
  label: string;
  text: string;
  priority: number; // lower = dropped first
}

function assembleRepairSections(sections: RepairSection[]): string {
  // Sort by priority desc (highest kept first)
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  let result = sorted.map(s => s.text).join("\n");
  if (result.length <= MAX_REPAIR_CHARS) return result;

  // Drop lowest-priority sections until under limit (max 5 iterations)
  const kept = [...sorted];
  for (let i = 0; i < 5 && kept.length > 1; i++) {
    const lowest = kept.reduce((min, s, idx) => s.priority < kept[min].priority ? idx : min, 0);
    kept.splice(lowest, 1);
    result = kept.map(s => s.text).join("\n");
    if (result.length <= MAX_REPAIR_CHARS) break;
  }
  return result;
}

function buildRepairInstruction(
  score: CinematicScore,
  domain: "trailer" | "storyboard",
  unitCount: number,
): string {
  const guard = domain === "storyboard" ? `${SHAPE_GUARD}${STORYBOARD_GUARD}` : SHAPE_GUARD;
  const bullets = failureBullets(score.failures, domain);
  const coreBase = `${guard}

The previous output failed cinematic quality checks (score=${score.score.toFixed(2)}, failures: ${score.failures.join(", ")}).
Fix the following issues:
${bullets.join("\n")}

Maintain all existing required fields and overall structure.`;

  // Build numeric targets (context-aware) with coverage tracking
  const ctx = numericTargetsForFailures({
    failures: score.failures,
    unitCount,
  });
  const contextTargetsBlock = ctx.targets.length > 0
    ? `\nCONTEXT-AWARE NUMERIC TARGETS (MANDATORY):\n${ctx.targets.map(t => `• ${t}`).join("\n")}`
    : "";

  // Static failure targets — only for failures NOT covered by context targets
  const deconflictedStaticTargets = score.failures
    .filter(f => !ctx.covered.has(f))
    .map(f => FAILURE_TARGETS[f])
    .filter(Boolean)
    .map(t => `• ${t}`);
  const staticTargetsBlock = deconflictedStaticTargets.length > 0
    ? `\nNUMERIC TARGETS (MUST MEET):\n${deconflictedStaticTargets.join("\n")}`
    : "";

  // Procedure block by domain — append ladder suffix when ladder failures present
  const LADDER_FAILURE_SET = new Set(["DIRECTION_REVERSAL", "ENERGY_DROP", "FLATLINE", "PACING_MISMATCH", "WEAK_ARC"]);
  const hasLadderFailure = score.failures.some(f => LADDER_FAILURE_SET.has(f));
  const baseProcedure = domain === "storyboard" ? PROCEDURE_STORYBOARD : PROCEDURE_TRAILER;
  const procedureBlock = hasLadderFailure ? baseProcedure + LADDER_LOCK_SUFFIX : baseProcedure;

  // Optional sections
  const intentHint = (score.failures.includes("LOW_INTENT_DIVERSITY") || score.failures.includes("WEAK_ARC"))
    ? `\nINTENT ARC SUGGESTION (REPAIR ONLY):
- Early: intrigue/wonder; Mid: threat/chaos; Late: emotion/release.
- ≥3 distinct intents; peak intensity in final 2 units.`
    : "";

  const polarityLock = (score.failures.includes("TONAL_WHIPLASH") || score.failures.includes("WEAK_ARC"))
    ? `\nTONAL RAMP LOCK: ≤1 polarity flip; gradual changes (step ≤0.6); use a ramp not oscillation.`
    : "";

  const sections: RepairSection[] = [
    { label: "core", text: coreBase, priority: 100 },
    { label: "no-new-intent", text: NO_NEW_INTENT_BLOCK, priority: 95 },
    { label: "procedure", text: procedureBlock, priority: 92 },
    { label: "context-targets", text: contextTargetsBlock, priority: 90 },
    { label: "static-targets", text: staticTargetsBlock, priority: 85 },
    { label: "polarity-lock", text: polarityLock, priority: 30 },
    { label: "intent-hint", text: intentHint, priority: 20 },
  ].filter(s => s.text.length > 0);

  return assembleRepairSections(sections);
}

export function buildTrailerRepairInstruction(score: CinematicScore, unitCount?: number): string {
  return buildRepairInstruction(score, "trailer", unitCount ?? 6);
}

export function buildStoryboardRepairInstruction(score: CinematicScore, unitCount?: number): string {
  return buildRepairInstruction(score, "storyboard", unitCount ?? 8);
}
