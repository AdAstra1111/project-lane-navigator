/**
 * Video Generation Plan — Deterministic Plan Builder (v1)
 * Converts CIK blueprint units into a shot plan with camera continuity.
 * No LLM calls. No randomness. Same input => identical output.
 */
import type {
  VideoGenerationPlanV1,
  PlanUnit,
  Shot,
  ShotType,
  CameraMove,
  LensMm,
  ContinuityRuleResult,
  ContinuityWarning,
} from "./types";

/* ── Energy Band Templates ── */

/**
 * Energy is bucketed into 4 bands. Each band maps to a fixed shot template.
 * Band boundaries: [0, 0.3) low | [0.3, 0.6) mid | [0.6, 0.85) high | [0.85, 1.0] peak
 */
type EnergyBand = "low" | "mid" | "high" | "peak";

function energyBand(energy: number): EnergyBand {
  if (energy < 0.3) return "low";
  if (energy < 0.6) return "mid";
  if (energy < 0.85) return "high";
  return "peak";
}

interface BandTemplate {
  shotCount: number;
  shotTypes: ShotType[];
  cameraMoves: CameraMove[];
  lenses: LensMm[];
  /** Per-shot duration in seconds */
  durations: number[];
}

/**
 * Fixed shot templates per energy band.
 * Shot arrays are cycled if shotCount > array length (deterministic wrap).
 */
const BAND_TEMPLATES: Record<EnergyBand, BandTemplate> = {
  low: {
    shotCount: 1,
    shotTypes: ["WIDE"],
    cameraMoves: ["STATIC"],
    lenses: [24],
    durations: [5],
  },
  mid: {
    shotCount: 2,
    shotTypes: ["WIDE", "MEDIUM"],
    cameraMoves: ["DOLLY", "STATIC"],
    lenses: [35, 50],
    durations: [4, 3],
  },
  high: {
    shotCount: 3,
    shotTypes: ["MEDIUM", "CLOSE", "INSERT"],
    cameraMoves: ["TRACKING", "HANDHELD", "PAN"],
    lenses: [50, 85, 35],
    durations: [3, 2.5, 2],
  },
  peak: {
    shotCount: 4,
    shotTypes: ["CLOSE", "ECU", "INSERT", "POV"],
    cameraMoves: ["HANDHELD", "CRANE", "TRACKING", "DOLLY"],
    lenses: [85, 85, 50, 35],
    durations: [2, 1.5, 1.5, 2],
  },
};

/** Lane-specific shot count multipliers (deterministic). */
const LANE_SHOT_MUL: Record<string, number> = {
  vertical_drama: 0.75,  // fewer shots (shorter content)
  advertising: 1.25,     // more shots (denser cuts)
  documentary: 0.85,     // slightly fewer
  music_video: 1.15,     // slightly more
};

/* ── Screen Direction ── */

type ScreenDir = "L" | "R";

/**
 * Deterministic screen direction from unit index.
 * Alternates every 2 units: L L R R L L ...
 */
function screenDirection(unitIndex: number): ScreenDir {
  return Math.floor(unitIndex / 2) % 2 === 0 ? "L" : "R";
}

/* ── Plan Builder ── */

export interface BuildPlanInput {
  projectId: string;
  documentId?: string;
  qualityRunId?: string;
  lane: string;
  units: { intent: string; energy: number; id?: string; beatSummary?: string }[];
}

export function buildVideoGenerationPlan(input: BuildPlanInput): VideoGenerationPlanV1 {
  const { projectId, documentId, qualityRunId, lane, units: rawUnits } = input;
  const laneMul = LANE_SHOT_MUL[lane] || 1.0;

  // Build plan units
  const planUnits: PlanUnit[] = rawUnits.map((u, i) => ({
    unitIndex: i,
    intent: u.intent,
    energy: u.energy,
    beatSummary: u.beatSummary,
  }));

  // Build shots per unit
  const allShots: Shot[] = [];
  let shotIndex = 0;

  for (let ui = 0; ui < rawUnits.length; ui++) {
    const unit = rawUnits[ui];
    const band = energyBand(unit.energy);
    const template = BAND_TEMPLATES[band];
    const adjustedCount = Math.max(1, Math.round(template.shotCount * laneMul));
    const dir = screenDirection(ui);

    for (let si = 0; si < adjustedCount; si++) {
      const shotType = template.shotTypes[si % template.shotTypes.length];
      const cameraMove = template.cameraMoves[si % template.cameraMoves.length];
      const lensMm = template.lenses[si % template.lenses.length];
      const durationSec = template.durations[si % template.durations.length];

      const continuityTags: string[] = [
        `screenDirection:${dir}`,
        `energyBand:${band}`,
      ];

      allShots.push({
        shotIndex,
        unitIndex: ui,
        shotType,
        cameraMove,
        lensMm,
        durationSec,
        description: `${shotType} ${cameraMove} ${lensMm}mm — ${unit.intent} (${band})`,
        continuityTags,
      });

      shotIndex++;
    }
  }

  // Continuity enforcement
  const warnings: ContinuityWarning[] = [];
  const rules: ContinuityRuleResult[] = [];

  // Rule 1: Screen direction flips
  let dirFlips = 0;
  let lastDir: ScreenDir | null = null;
  for (const shot of allShots) {
    const dirTag = shot.continuityTags.find(t => t.startsWith("screenDirection:"));
    const dir = dirTag?.split(":")[1] as ScreenDir | undefined;
    if (dir && lastDir && dir !== lastDir) {
      dirFlips++;
      if (dirFlips > 1) {
        // Check if previous shot was a transition (INSERT or DRONE)
        const prevShot = allShots[shot.shotIndex - 1];
        if (prevShot && prevShot.shotType !== "INSERT" && prevShot.shotType !== "DRONE") {
          warnings.push({
            shotIndex: shot.shotIndex,
            rule: "screen_direction_flip",
            message: `Screen direction flip at shot ${shot.shotIndex} without transition shot`,
            severity: "warn",
          });
        }
      }
    }
    if (dir) lastDir = dir;
  }
  rules.push({
    rule: "screen_direction_continuity",
    passed: warnings.filter(w => w.rule === "screen_direction_flip").length === 0,
    detail: `${dirFlips} direction change(s)`,
  });

  // Rule 2: Lens continuity (no 24->85 or 85->24 jump without intermediate)
  const LENS_JUMP_THRESHOLD = 0.3; // energy jump that allows lens skip
  for (let i = 1; i < allShots.length; i++) {
    const prev = allShots[i - 1];
    const curr = allShots[i];
    const lensDiff = Math.abs(curr.lensMm - prev.lensMm);
    if (lensDiff > 50) {
      // Check if energy jump justifies it
      const prevUnit = rawUnits[prev.unitIndex];
      const currUnit = rawUnits[curr.unitIndex];
      const energyJump = Math.abs(currUnit.energy - prevUnit.energy);
      if (energyJump < LENS_JUMP_THRESHOLD) {
        warnings.push({
          shotIndex: curr.shotIndex,
          rule: "lens_continuity",
          message: `Lens jump ${prev.lensMm}mm→${curr.lensMm}mm at shot ${curr.shotIndex} without sufficient energy jump (${energyJump.toFixed(2)} < ${LENS_JUMP_THRESHOLD})`,
          severity: "warn",
        });
      }
    }
  }
  rules.push({
    rule: "lens_continuity",
    passed: warnings.filter(w => w.rule === "lens_continuity").length === 0,
  });

  // Rule 3: Move continuity (STATIC->HANDHELD whiplash)
  const MOVE_JUMP_THRESHOLD = 0.35;
  for (let i = 1; i < allShots.length; i++) {
    const prev = allShots[i - 1];
    const curr = allShots[i];
    const isWhiplash =
      (prev.cameraMove === "STATIC" && curr.cameraMove === "HANDHELD") ||
      (prev.cameraMove === "HANDHELD" && curr.cameraMove === "STATIC");
    if (isWhiplash) {
      const prevUnit = rawUnits[prev.unitIndex];
      const currUnit = rawUnits[curr.unitIndex];
      const energyJump = Math.abs(currUnit.energy - prevUnit.energy);
      if (energyJump < MOVE_JUMP_THRESHOLD) {
        warnings.push({
          shotIndex: curr.shotIndex,
          rule: "move_continuity",
          message: `Camera move whiplash ${prev.cameraMove}→${curr.cameraMove} at shot ${curr.shotIndex}`,
          severity: "info",
        });
      }
    }
  }
  rules.push({
    rule: "move_continuity",
    passed: warnings.filter(w => w.rule === "move_continuity").length === 0,
  });

  // Pacing
  const totalShots = allShots.length;
  const totalDuration = allShots.reduce((s, sh) => s + sh.durationSec, 0);
  const avgShotLengthSec = totalShots > 0 ? totalDuration / totalShots : 0;
  const energyCurve = rawUnits.map(u => u.energy);

  return {
    metadata: {
      projectId,
      documentId,
      qualityRunId,
      lane,
      createdAt: new Date().toISOString(),
      planVersion: "v1",
    },
    units: planUnits,
    shotPlan: allShots,
    pacing: { totalShots, avgShotLengthSec, energyCurve },
    continuity: { rules, warnings },
  };
}
