/**
 * CIK — Adapter Sanitization Layer
 * Deterministic post-adapter cleanup: clamp, default, normalize.
 * No new failure codes; reuses TOO_SHORT for broken adapters.
 */
import type { CinematicUnit, CinematicIntent } from "../cinematic-model.ts";

const VALID_INTENTS: ReadonlySet<string> = new Set([
  "intrigue", "threat", "wonder", "chaos", "emotion", "release",
]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface AdapterQualityMetrics {
  extracted_unit_count: number;
  expected_unit_count?: number;
  missing_energy: number;
  missing_tension: number;
  missing_density: number;
  missing_intent: number;
  out_of_range_clamped: number;
  percent_defaulted_fields: number;
}

/**
 * Sanitize adapter-produced units: clamp numerics, default missing, normalize strings.
 * Returns sanitized units + quality metrics for telemetry.
 */
export function sanitizeUnits(
  units: CinematicUnit[],
  expectedUnitCount?: number,
): { units: CinematicUnit[]; quality: AdapterQualityMetrics } {
  let missingEnergy = 0;
  let missingTension = 0;
  let missingDensity = 0;
  let missingIntent = 0;
  let outOfRangeClamped = 0;
  const totalFields = units.length * 4; // energy, tension, density, intent per unit

  const sanitized = units.map((u) => {
    const raw = u as any;

    // Energy
    let energy: number;
    if (raw.energy == null || typeof raw.energy !== "number" || isNaN(raw.energy)) {
      energy = 0.45;
      missingEnergy++;
    } else if (raw.energy < 0 || raw.energy > 1) {
      energy = clamp(raw.energy, 0, 1);
      outOfRangeClamped++;
    } else {
      energy = raw.energy;
    }

    // Tension
    let tension: number;
    if (raw.tension == null || typeof raw.tension !== "number" || isNaN(raw.tension)) {
      tension = 0.45;
      missingTension++;
    } else if (raw.tension < 0 || raw.tension > 1) {
      tension = clamp(raw.tension, 0, 1);
      outOfRangeClamped++;
    } else {
      tension = raw.tension;
    }

    // Density
    let density: number;
    if (raw.density == null || typeof raw.density !== "number" || isNaN(raw.density)) {
      density = 0.45;
      missingDensity++;
    } else if (raw.density < 0 || raw.density > 1) {
      density = clamp(raw.density, 0, 1);
      outOfRangeClamped++;
    } else {
      density = raw.density;
    }

    // Tonal polarity
    const tonal_polarity = (raw.tonal_polarity == null || typeof raw.tonal_polarity !== "number" || isNaN(raw.tonal_polarity))
      ? 0
      : clamp(raw.tonal_polarity, -1, 1);

    // Intent
    let intent: CinematicIntent;
    if (!raw.intent || !VALID_INTENTS.has(raw.intent)) {
      intent = "intrigue";
      missingIntent++;
    } else {
      intent = raw.intent as CinematicIntent;
    }

    // ID: trim + default
    const id = (typeof raw.id === "string" && raw.id.trim()) ? raw.id.trim() : `unit_${units.indexOf(u)}`;

    return { id, intent, energy, tension, density, tonal_polarity };
  });

  const defaultedFields = missingEnergy + missingTension + missingDensity + missingIntent;

  return {
    units: sanitized,
    quality: {
      extracted_unit_count: units.length,
      expected_unit_count: expectedUnitCount,
      missing_energy: missingEnergy,
      missing_tension: missingTension,
      missing_density: missingDensity,
      missing_intent: missingIntent,
      out_of_range_clamped: outOfRangeClamped,
      percent_defaulted_fields: totalFields > 0 ? defaultedFields / totalFields : 0,
    },
  };
}
