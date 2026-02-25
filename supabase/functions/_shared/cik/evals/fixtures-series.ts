/**
 * CIK Eval Fixtures — series lane
 */
import type { EvalFixture } from "./evalRunner.ts";

function u(id: string, energy: number, tension: number, density: number, polarity: number, intent: string) {
  return { id, energy, tension, density, tonal_polarity: polarity, intent: intent as any };
}

export const SERIES_FIXTURES: EvalFixture[] = [
  {
    name: "ser_cliffhanger_arc",
    lane: "series",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.45, 0.45, 0.40, -0.1, "wonder"),
      u("2", 0.60, 0.60, 0.50, 0.0, "threat"),
      u("3", 0.75, 0.75, 0.65, 0.1, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: true,
    description: "Clean series arc with late peak",
  },
  {
    name: "ser_role_lock_early_violation",
    lane: "series",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "release"),
      u("1", 0.40, 0.40, 0.35, -0.1, "emotion"),
      u("2", 0.55, 0.55, 0.50, 0.0, "threat"),
      u("3", 0.70, 0.70, 0.60, 0.1, "chaos"),
      u("4", 0.85, 0.85, 0.75, 0.2, "emotion"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Early window has 2 late-class intents — role lock violation",
  },
  {
    name: "ser_mid_role_violation",
    lane: "series",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.45, 0.45, 0.40, -0.1, "wonder"),
      u("2", 0.55, 0.55, 0.50, 0.0, "intrigue"),
      u("3", 0.60, 0.60, 0.55, 0.0, "intrigue"),
      u("4", 0.85, 0.85, 0.75, 0.2, "emotion"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["PACING_MISMATCH"],
    description: "Mid window has 2 early-class intents — role lock",
  },
  {
    name: "ser_second_last_must_be_late",
    lane: "series",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "threat"),
      u("2", 0.70, 0.70, 0.60, 0.1, "chaos"),
      u("3", 0.85, 0.85, 0.75, 0.2, "chaos"),
      u("4", 0.80, 0.80, 0.70, 0.1, "intrigue"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Second-last unit is early-class — series requires LATE",
  },
  {
    name: "ser_too_short",
    lane: "series",
    units: [
      u("0", 0.50, 0.50, 0.50, 0.0, "chaos"),
      u("1", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["TOO_SHORT"],
    description: "Below minimum units",
  },
  {
    name: "ser_lower_mid_energy_fail",
    lane: "series",
    units: [
      u("0", 0.25, 0.25, 0.25, -0.3, "intrigue"),
      u("1", 0.35, 0.35, 0.30, -0.2, "wonder"),
      u("2", 0.48, 0.48, 0.42, -0.1, "threat"),
      u("3", 0.65, 0.65, 0.55, 0.0, "chaos"),
      u("4", 0.82, 0.82, 0.72, 0.2, "emotion"),
      u("5", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Series mid-arc bar is 0.50 — 0.48 at mid fails WEAK_ARC",
  },
  {
    name: "ser_flat",
    lane: "series",
    units: [
      u("0", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("1", 0.50, 0.50, 0.50, 0.0, "wonder"),
      u("2", 0.50, 0.50, 0.50, 0.0, "threat"),
      u("3", 0.50, 0.50, 0.50, 0.0, "chaos"),
      u("4", 0.50, 0.50, 0.50, 0.0, "emotion"),
    ],
    expectedPass: false,
    description: "Flat energy",
  },
  {
    name: "ser_clean_8_unit",
    lane: "series",
    units: [
      u("0", 0.25, 0.25, 0.25, -0.3, "intrigue"),
      u("1", 0.35, 0.35, 0.30, -0.2, "wonder"),
      u("2", 0.50, 0.50, 0.45, -0.1, "threat"),
      u("3", 0.62, 0.62, 0.55, 0.0, "chaos"),
      u("4", 0.75, 0.75, 0.65, 0.1, "chaos"),
      u("5", 0.85, 0.85, 0.75, 0.2, "emotion"),
      u("6", 0.92, 0.92, 0.85, 0.3, "emotion"),
      u("7", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: true,
    description: "Clean 8-unit series arc",
  },
  {
    name: "ser_energy_drop",
    lane: "series",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "threat"),
      u("2", 0.75, 0.75, 0.65, 0.1, "chaos"),
      u("3", 0.92, 0.92, 0.85, 0.3, "emotion"),
      u("4", 0.60, 0.60, 0.50, 0.0, "emotion"),
      u("5", 0.55, 0.55, 0.45, -0.1, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["ENERGY_DROP"],
    description: "Significant tail drop",
  },
  {
    name: "ser_no_peak_late",
    lane: "series",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.92, 0.92, 0.85, 0.3, "chaos"),
      u("2", 0.60, 0.60, 0.50, 0.0, "threat"),
      u("3", 0.55, 0.55, 0.45, -0.1, "wonder"),
      u("4", 0.65, 0.65, 0.55, 0.0, "emotion"),
      u("5", 0.70, 0.70, 0.60, 0.1, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Peak at unit 1, not late — series needs peak in last 3",
  },
];
