/**
 * CIK Eval Fixtures — vertical_drama lane
 */
import type { EvalFixture } from "./evalRunner.ts";

function u(id: string, energy: number, tension: number, density: number, polarity: number, intent: string) {
  return { id, energy, tension, density, tonal_polarity: polarity, intent: intent as any };
}

export const VERTICAL_DRAMA_FIXTURES: EvalFixture[] = [
  {
    name: "vd_clean_short",
    lane: "vertical_drama",
    units: [
      u("0", 0.35, 0.35, 0.30, -0.2, "intrigue"),
      u("1", 0.65, 0.65, 0.55, 0.0, "threat"),
      u("2", 0.92, 0.92, 0.85, 0.3, "chaos"),
      u("3", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: true,
    description: "Clean 4-unit short-form arc with button ending",
  },
  {
    name: "vd_3_unit_min_fail",
    lane: "vertical_drama",
    units: [
      u("0", 0.40, 0.40, 0.35, -0.1, "intrigue"),
      u("1", 0.75, 0.75, 0.65, 0.1, "chaos"),
      u("2", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    description: "3 units — passes min_units=3 but fails other structural checks",
  },
  {
    name: "vd_5_unit_clean",
    lane: "vertical_drama",
    units: [
      u("0", 0.30, 0.30, 0.25, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, -0.1, "wonder"),
      u("2", 0.70, 0.70, 0.60, 0.0, "threat"),
      u("3", 0.90, 0.90, 0.80, 0.2, "chaos"),
      u("4", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: true,
    description: "5-unit vertical_drama with clean escalation and button ending",
  },
  {
    name: "vd_no_button_ending",
    lane: "vertical_drama",
    units: [
      u("0", 0.35, 0.35, 0.30, -0.2, "intrigue"),
      u("1", 0.65, 0.65, 0.55, 0.0, "threat"),
      u("2", 0.85, 0.85, 0.75, 0.2, "chaos"),
      u("3", 0.92, 0.92, 0.85, 0.3, "intrigue"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Final unit is not a button (late intent is early-class)",
  },
  {
    name: "vd_early_first_required",
    lane: "vertical_drama",
    units: [
      u("0", 0.35, 0.35, 0.30, -0.2, "release"),
      u("1", 0.65, 0.65, 0.55, 0.0, "threat"),
      u("2", 0.85, 0.85, 0.75, 0.2, "chaos"),
      u("3", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "First unit is late-class intent — role lock violation",
  },
  {
    name: "vd_flat_energy",
    lane: "vertical_drama",
    units: [
      u("0", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("1", 0.50, 0.50, 0.50, 0.0, "threat"),
      u("2", 0.50, 0.50, 0.50, 0.0, "chaos"),
      u("3", 0.50, 0.50, 0.50, 0.0, "release"),
    ],
    expectedPass: false,
    description: "Flat energy in short form",
  },
  {
    name: "vd_steep_ramp_fail",
    lane: "vertical_drama",
    units: [
      u("0", 0.20, 0.20, 0.20, -0.3, "intrigue"),
      u("1", 0.55, 0.55, 0.50, 0.0, "threat"),
      u("2", 0.80, 0.80, 0.70, 0.2, "chaos"),
      u("3", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    description: "Steep ramp — but mid energy below threshold triggers WEAK_ARC",
  },
  {
    name: "vd_energy_drop",
    lane: "vertical_drama",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.70, 0.70, 0.60, 0.1, "threat"),
      u("2", 0.95, 0.95, 0.90, 0.4, "chaos"),
      u("3", 0.60, 0.60, 0.50, 0.0, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["ENERGY_DROP"],
    description: "Tail drop in short form — strict enforcement",
  },
  {
    name: "vd_too_short",
    lane: "vertical_drama",
    units: [
      u("0", 0.90, 0.90, 0.80, 0.0, "chaos"),
      u("1", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["TOO_SHORT"],
    description: "Only 2 units — below vertical_drama minimum of 3",
  },
  {
    name: "vd_8_unit_pass",
    lane: "vertical_drama",
    units: [
      u("0", 0.25, 0.25, 0.25, -0.3, "intrigue"),
      u("1", 0.35, 0.35, 0.30, -0.2, "wonder"),
      u("2", 0.50, 0.50, 0.45, -0.1, "threat"),
      u("3", 0.62, 0.62, 0.55, 0.0, "threat"),
      u("4", 0.75, 0.75, 0.65, 0.1, "chaos"),
      u("5", 0.85, 0.85, 0.75, 0.2, "chaos"),
      u("6", 0.92, 0.92, 0.85, 0.3, "emotion"),
      u("7", 0.95, 0.95, 0.90, 0.4, "release"),
    ],
    expectedPass: true,
    description: "8-unit vertical_drama with clean escalation and button",
  },
  {
    name: "vd_low_peak",
    lane: "vertical_drama",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "threat"),
      u("2", 0.70, 0.70, 0.60, 0.1, "chaos"),
      u("3", 0.82, 0.82, 0.75, 0.3, "release"),
    ],
    expectedPass: false,
    description: "Peak below 0.90 for vertical_drama — NO_PEAK or WEAK_ARC",
  },
];
