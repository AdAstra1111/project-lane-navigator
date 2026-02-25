/**
 * CIK Eval Fixtures — feature_film lane
 * 10 deterministic test cases for regression-proofing.
 */
import type { EvalFixture } from "./evalRunner.ts";

function u(id: string, energy: number, tension: number, density: number, polarity: number, intent: string) {
  return { id, energy, tension, density, tonal_polarity: polarity, intent: intent as any };
}

export const FEATURE_FILM_FIXTURES: EvalFixture[] = [
  {
    name: "ff_clean_arc",
    lane: "feature_film",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.3, "intrigue"),
      u("1", 0.45, 0.45, 0.40, -0.1, "wonder"),
      u("2", 0.60, 0.60, 0.50, 0.0, "threat"),
      u("3", 0.75, 0.75, 0.60, 0.1, "chaos"),
      u("4", 0.88, 0.88, 0.75, 0.3, "emotion"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: true,
    description: "Clean escalating arc with peak at end",
  },
  {
    name: "ff_flat_energy",
    lane: "feature_film",
    units: [
      u("0", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("1", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("2", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("3", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("4", 0.50, 0.50, 0.50, 0.0, "intrigue"),
    ],
    expectedPass: false,
    expectedFailures: ["FLATLINE"],
    description: "Completely flat energy — should fail",
  },
  {
    name: "ff_too_short",
    lane: "feature_film",
    units: [
      u("0", 0.90, 0.90, 0.80, 0.0, "chaos"),
      u("1", 0.95, 0.95, 0.90, 0.1, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["TOO_SHORT"],
    description: "Only 2 units — below minimum",
  },
  {
    name: "ff_early_peak",
    lane: "feature_film",
    units: [
      u("0", 0.95, 0.95, 0.90, 0.4, "chaos"),
      u("1", 0.70, 0.70, 0.60, 0.2, "threat"),
      u("2", 0.50, 0.50, 0.40, 0.0, "intrigue"),
      u("3", 0.40, 0.40, 0.30, -0.1, "wonder"),
      u("4", 0.30, 0.30, 0.25, -0.2, "intrigue"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Peak at start, descending — weak arc",
  },
  {
    name: "ff_tonal_whiplash",
    lane: "feature_film",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.8, "intrigue"),
      u("1", 0.50, 0.50, 0.50, 0.8, "wonder"),
      u("2", 0.70, 0.70, 0.60, -0.8, "threat"),
      u("3", 0.85, 0.85, 0.75, 0.8, "chaos"),
      u("4", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["TONAL_WHIPLASH"],
    description: "Extreme polarity oscillation",
  },
  {
    name: "ff_no_peak",
    lane: "feature_film",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.40, 0.40, 0.35, -0.1, "wonder"),
      u("2", 0.50, 0.50, 0.45, 0.0, "threat"),
      u("3", 0.60, 0.60, 0.55, 0.1, "chaos"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Gradual rise but never reaches peak energy",
  },
  {
    name: "ff_energy_drop_tail",
    lane: "feature_film",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "wonder"),
      u("2", 0.70, 0.70, 0.60, 0.1, "threat"),
      u("3", 0.90, 0.90, 0.80, 0.3, "chaos"),
      u("4", 0.95, 0.95, 0.90, 0.4, "emotion"),
      u("5", 0.60, 0.60, 0.50, 0.0, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["ENERGY_DROP"],
    description: "Strong build then significant tail drop",
  },
  {
    name: "ff_low_intent_diversity",
    lane: "feature_film",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "intrigue"),
      u("2", 0.70, 0.70, 0.60, 0.1, "intrigue"),
      u("3", 0.85, 0.85, 0.75, 0.2, "intrigue"),
      u("4", 0.95, 0.95, 0.90, 0.4, "intrigue"),
    ],
    expectedPass: false,
    expectedFailures: ["LOW_INTENT_DIVERSITY"],
    description: "All same intent",
  },
  {
    name: "ff_borderline_pass",
    lane: "feature_film",
    units: [
      u("0", 0.35, 0.35, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, -0.1, "wonder"),
      u("2", 0.65, 0.65, 0.55, 0.0, "threat"),
      u("3", 0.78, 0.78, 0.65, 0.1, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("5", 0.93, 0.93, 0.88, 0.4, "release"),
    ],
    expectedPass: true,
    description: "Borderline but passing — clean ramp",
  },
  {
    name: "ff_zigzag_oscillation",
    lane: "feature_film",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.70, 0.70, 0.60, 0.1, "threat"),
      u("2", 0.40, 0.40, 0.35, -0.1, "wonder"),
      u("3", 0.80, 0.80, 0.70, 0.2, "chaos"),
      u("4", 0.50, 0.50, 0.45, 0.0, "intrigue"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    description: "Heavy zigzag energy oscillation",
  },
];
