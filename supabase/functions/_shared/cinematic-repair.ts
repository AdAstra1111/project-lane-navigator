/**
 * Cinematic Intelligence Kernel — Repair instruction builders
 * Produces minimal constraint bullets from CIK score failures.
 */
import type { CinematicScore, CinematicFailureCode } from "./cinematic-model.ts";
import { CINEMATIC_THRESHOLDS } from "./cinematic-score.ts";

function failureBullets(failures: CinematicFailureCode[], domain: "trailer" | "storyboard"): string[] {
  const bullets: string[] = [];
  const unitLabel = domain === "trailer" ? "beat" : "panel";

  for (const f of failures) {
    switch (f) {
      case "NO_PEAK":
        bullets.push(`• Ensure at least one climax ${unitLabel} late in the sequence has very high energy/tension (movement_intensity_target >= 9 for trailers, vivid action for storyboards).`);
        break;
      case "NO_ESCALATION":
        bullets.push(`• Later ${unitLabel}s MUST have noticeably higher energy than early ${unitLabel}s. Build a clear upward trajectory.`);
        break;
      case "FLATLINE":
        bullets.push(`• Avoid consecutive ${unitLabel}s with nearly identical energy. Include at least one jump of ≥0.20 energy between adjacent ${unitLabel}s.`);
        break;
      case "LOW_CONTRAST":
        bullets.push(`• Add a clear contrast pivot: a calm-to-chaos or hope-to-threat transition within the sequence.`);
        break;
      case "TONAL_WHIPLASH":
        bullets.push(`• Reduce abrupt polarity flips. Add ramp/transition ${unitLabel}s between tonal shifts. Max 1 polarity flip across the sequence.`);
        break;
      case "TOO_SHORT":
        bullets.push(`• Ensure at least 4 ${unitLabel}s in the output.`);
        break;
      case "WEAK_ARC":
        bullets.push(`• Build a clear dramatic arc: start restrained, build through mid, peak near the end.`);
        break;
      case "LOW_INTENT_DIVERSITY":
        bullets.push(`• Use at least 3 distinct intents across ${unitLabel}s (e.g., intrigue, threat, chaos, emotion, release).`);
        break;
      case "PACING_MISMATCH":
        bullets.push(`• Fix pacing: late ${unitLabel}s should have higher density than early ones. Avoid uniform density throughout.`);
        break;
      case "ENERGY_DROP":
        bullets.push(`• Do NOT let energy drop in the final ${unitLabel}s. The ending must maintain or exceed mid-sequence energy.`);
        break;
      case "DIRECTION_REVERSAL":
        bullets.push(`• Reduce energy zigzag. Energy should trend upward overall, not alternate high-low-high repeatedly.`);
        break;
      case "EYE_LINE_BREAK":
        bullets.push(`• Ensure visual continuity: consecutive ${unitLabel}s should have coherent intent progression, not random jumps.`);
        break;
    }
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
 * Returns deduped deterministic bullets.
 */
export function numericTargetsForFailures(args: {
  failures: string[];
  unitCount: number;
  thresholds?: typeof CINEMATIC_THRESHOLDS;
}): string[] {
  const { failures, unitCount, thresholds: t = CINEMATIC_THRESHOLDS } = args;
  const out: string[] = [];
  const latePeakMin = Math.max(1, Math.floor(unitCount * 0.75));
  const latePeakStr = `peakIndex must be >= ${latePeakMin} (peak in last 25% of ${unitCount} units)`;

  for (const f of failures) {
    switch (f) {
      case "TOO_SHORT":
        out.push(`unitCount must equal ${unitCount} exactly (no more, no less)`);
        break;
      case "NO_PEAK":
        out.push(latePeakStr);
        out.push(`final unit must read as an explicit climax/turning-point beat`);
        break;
      case "NO_ESCALATION":
      case "WEAK_ARC":
        out.push(`escalationScore must be >= ${Number(t.min_slope ?? 0.01).toFixed(2)}`);
        out.push(`energy must generally rise across units with at most 1 small dip`);
        break;
      case "FLATLINE":
        out.push(`contrastScore must be >= ${Number(t.min_contrast ?? 0.55).toFixed(2)}`);
        out.push(`ensure at least 2 units are clearly higher-intensity than the baseline units`);
        break;
      case "LOW_CONTRAST":
        out.push(`contrastScore must be >= ${Number(t.min_contrast ?? 0.55).toFixed(2)}`);
        break;
      case "TONAL_WHIPLASH":
        out.push(`polarity sign flips must be <= ${Math.max(1, Math.floor(unitCount * 0.2))} total`);
        out.push(`avoid abrupt tonal inversions; delete outlier units first`);
        break;
      case "LOW_INTENT_DIVERSITY":
        out.push(`intentsDistinctCount must be >= 3`);
        out.push(`intents must appear in a clear sequence (setup → complication → payoff)`);
        break;
      case "PACING_MISMATCH":
        out.push(`pacing variance must decrease by removing or splitting outlier-long units`);
        out.push(`adjacent units should have smoother duration/intensity changes`);
        break;
      case "ENERGY_DROP":
        out.push(`post-peak units must not de-escalate; delete or tighten any drop after the peak`);
        out.push(latePeakStr);
        break;
      case "DIRECTION_REVERSAL":
        out.push(`directionReversalCount must be <= ${Math.max(0, Math.floor(unitCount * 0.15))}`);
        out.push(`if reversal exists, place it once as an intentional midpoint twist`);
        break;
      default:
        break;
    }
  }
  return Array.from(new Set(out));
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
 * Never drops: shape guard, numeric targets, no-new-intent.
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

  // Build numeric targets (context-aware)
  const contextTargets = numericTargetsForFailures({
    failures: score.failures,
    unitCount,
  });
  const contextTargetsBlock = contextTargets.length > 0
    ? `\nCONTEXT-AWARE NUMERIC TARGETS (MANDATORY):\n${contextTargets.map(t => `• ${t}`).join("\n")}`
    : "";

  // Static failure targets
  const staticTargets = score.failures
    .map(f => FAILURE_TARGETS[f])
    .filter(Boolean)
    .map(t => `• ${t}`);
  const staticTargetsBlock = staticTargets.length > 0
    ? `\nNUMERIC TARGETS (MUST MEET):\n${staticTargets.join("\n")}`
    : "";

  // Optional sections
  const intentHint = (score.failures.includes("LOW_INTENT_DIVERSITY") || score.failures.includes("WEAK_ARC"))
    ? `\nINTENT ARC SUGGESTION (REPAIR ONLY):
- Early units: intrigue or wonder (setup/mystery)
- Mid units: threat or chaos (escalation)
- Late units: emotion or release (resolution/button)
Rules:
- Use at least 3 distinct intents across units.
- Keep peak intensity in final 2 units.`
    : "";

  const polarityLock = (score.failures.includes("TONAL_WHIPLASH") || score.failures.includes("WEAK_ARC"))
    ? `\nTONAL RAMP LOCK (REPAIR ONLY):
- No more than 1 polarity sign flip across units.
- Adjacent tonal_polarity changes should be gradual (prefer step <= 0.6).
- Use a ramp (generally darker->lighter or lighter->darker), not oscillation.`
    : "";

  const sections: RepairSection[] = [
    { label: "core", text: coreBase, priority: 100 },
    { label: "no-new-intent", text: NO_NEW_INTENT_BLOCK, priority: 90 },
    { label: "context-targets", text: contextTargetsBlock, priority: 85 },
    { label: "static-targets", text: staticTargetsBlock, priority: 80 },
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
