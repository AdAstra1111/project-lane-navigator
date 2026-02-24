/**
 * Cinematic Intelligence Kernel — Repair instruction builders
 * Produces minimal constraint bullets from CIK score failures.
 */
import type { CinematicScore, CinematicFailureCode } from "./cinematic-model.ts";

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

export function buildTrailerRepairInstruction(score: CinematicScore): string {
  const bullets = failureBullets(score.failures, "trailer");
  const base = `${SHAPE_GUARD}

The previous output failed cinematic quality checks (score=${score.score.toFixed(2)}, failures: ${score.failures.join(", ")}).
Fix the following issues:
${bullets.join("\n")}

Maintain all existing required fields and overall structure.`;
  const amplified = amplifyRepairInstruction(base, score.failures);
  const withIntent = addIntentSequencingHint(amplified, score.failures);
  return addPolarityRampLock(withIntent, score.failures);
}

export function buildStoryboardRepairInstruction(score: CinematicScore): string {
  const bullets = failureBullets(score.failures, "storyboard");
  const base = `${SHAPE_GUARD}${STORYBOARD_GUARD}

The previous output failed cinematic quality checks (score=${score.score.toFixed(2)}, failures: ${score.failures.join(", ")}).
Fix the following issues:
${bullets.join("\n")}

Maintain all existing required fields and overall structure.`;
  const amplified = amplifyRepairInstruction(base, score.failures);
  const withIntent = addIntentSequencingHint(amplified, score.failures);
  return addPolarityRampLock(withIntent, score.failures);
}
