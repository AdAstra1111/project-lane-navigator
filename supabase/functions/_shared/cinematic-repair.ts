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
    }
  }
  return bullets;
}

const SHAPE_GUARD = `
CRITICAL REPAIR CONSTRAINTS:
- DO NOT change the response JSON shape, field names, or required structure.
- Return the EXACT same JSON schema as before.`;

const STORYBOARD_GUARD = `
- DO NOT drop, rename, or duplicate unit_key values.
- Return exactly one panel entry per requested unit_key.`;

export function buildTrailerRepairInstruction(score: CinematicScore): string {
  const bullets = failureBullets(score.failures, "trailer");
  return `${SHAPE_GUARD}

The previous output failed cinematic quality checks (score=${score.score.toFixed(2)}, failures: ${score.failures.join(", ")}).
Fix the following issues:
${bullets.join("\n")}

Maintain all existing required fields and overall structure.`;
}

export function buildStoryboardRepairInstruction(score: CinematicScore): string {
  const bullets = failureBullets(score.failures, "storyboard");
  return `${SHAPE_GUARD}${STORYBOARD_GUARD}

The previous output failed cinematic quality checks (score=${score.score.toFixed(2)}, failures: ${score.failures.join(", ")}).
Fix the following issues:
${bullets.join("\n")}

Maintain all existing required fields and overall structure.`;
}
