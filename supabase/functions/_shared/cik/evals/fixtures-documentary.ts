/**
 * CIK Eval Fixtures — documentary lane
 */
import type { EvalFixture } from "./evalRunner.ts";

function u(id: string, energy: number, tension: number, density: number, polarity: number, intent: string) {
  return { id, energy, tension, density, tonal_polarity: polarity, intent: intent as any };
}

export const DOCUMENTARY_FIXTURES: EvalFixture[] = [
  {
    name: "doc_contemplative_arc",
    lane: "documentary",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.3, "intrigue"),
      u("1", 0.40, 0.40, 0.40, -0.1, "wonder"),
      u("2", 0.55, 0.55, 0.50, 0.0, "threat"),
      u("3", 0.70, 0.70, 0.60, 0.1, "chaos"),
      u("4", 0.85, 0.85, 0.75, 0.3, "emotion"),
      u("5", 0.90, 0.90, 0.85, 0.4, "release"),
    ],
    expectedPass: true,
    forbiddenFailures: ["LOW_CONTRAST"],
    description: "Contemplative doc arc — should not fail on contrast",
  },
  {
    name: "doc_relaxed_tonal_fail",
    lane: "documentary",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.5, "intrigue"),
      u("1", 0.45, 0.45, 0.40, 0.5, "wonder"),
      u("2", 0.60, 0.60, 0.55, -0.3, "threat"),
      u("3", 0.75, 0.75, 0.65, 0.2, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("5", 0.92, 0.92, 0.88, 0.4, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["TONAL_WHIPLASH"],
    description: "3 tonal flips hits doc max_tonal_flips=3 threshold (>=3 triggers)",
  },
  {
    name: "doc_tonal_2_flips_ok",
    lane: "documentary",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.3, "intrigue"),
      u("1", 0.45, 0.45, 0.40, 0.2, "wonder"),
      u("2", 0.60, 0.60, 0.55, 0.1, "threat"),
      u("3", 0.75, 0.75, 0.65, 0.2, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("5", 0.92, 0.92, 0.88, 0.4, "release"),
    ],
    expectedPass: true,
    forbiddenFailures: ["TONAL_WHIPLASH"],
    description: "Documentary with 1 tonal flip — well under doc threshold",
  },
  {
    name: "doc_low_end_energy_fail",
    lane: "documentary",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "wonder"),
      u("2", 0.65, 0.65, 0.55, 0.1, "threat"),
      u("3", 0.80, 0.80, 0.70, 0.2, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("5", 0.72, 0.72, 0.65, 0.1, "release"),
    ],
    expectedPass: false,
    description: "End energy 0.72 passes doc threshold 0.65 but tail drop from 0.88 triggers ENERGY_DROP",
  },
  {
    name: "doc_early_intent_in_late_window",
    lane: "documentary",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.50, 0.50, 0.45, 0.0, "wonder"),
      u("2", 0.65, 0.65, 0.55, 0.1, "threat"),
      u("3", 0.80, 0.80, 0.70, 0.2, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "intrigue"),
      u("5", 0.92, 0.92, 0.88, 0.4, "intrigue"),
    ],
    expectedPass: false,
    expectedFailures: ["WEAK_ARC"],
    description: "Documentary forbids EARLY intents in final 30%",
  },
  {
    name: "doc_too_short",
    lane: "documentary",
    units: [
      u("0", 0.60, 0.60, 0.50, 0.0, "intrigue"),
      u("1", 0.90, 0.90, 0.85, 0.3, "release"),
    ],
    expectedPass: false,
    expectedFailures: ["TOO_SHORT"],
    description: "2 units — below minimum",
  },
  {
    name: "doc_flat",
    lane: "documentary",
    units: [
      u("0", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      u("1", 0.50, 0.50, 0.50, 0.0, "wonder"),
      u("2", 0.50, 0.50, 0.50, 0.0, "threat"),
      u("3", 0.50, 0.50, 0.50, 0.0, "chaos"),
    ],
    expectedPass: false,
    description: "Flat energy — fails flatline",
  },
  {
    name: "doc_more_reversals_fail",
    lane: "documentary",
    units: [
      u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
      u("1", 0.55, 0.55, 0.50, 0.0, "wonder"),
      u("2", 0.45, 0.45, 0.40, -0.1, "threat"),
      u("3", 0.70, 0.70, 0.60, 0.1, "chaos"),
      u("4", 0.60, 0.60, 0.55, 0.0, "emotion"),
      u("5", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("6", 0.92, 0.92, 0.88, 0.4, "release"),
    ],
    expectedPass: false,
    description: "Multiple reversals — ladder lock detects meaningful down steps",
  },
  {
    name: "doc_clean_pass",
    lane: "documentary",
    units: [
      u("0", 0.25, 0.25, 0.25, -0.3, "intrigue"),
      u("1", 0.40, 0.40, 0.35, -0.1, "wonder"),
      u("2", 0.55, 0.55, 0.50, 0.0, "threat"),
      u("3", 0.72, 0.72, 0.62, 0.1, "chaos"),
      u("4", 0.88, 0.88, 0.80, 0.3, "emotion"),
      u("5", 0.92, 0.92, 0.88, 0.4, "release"),
    ],
    expectedPass: true,
    description: "Clean documentary arc",
  },
  {
    name: "doc_no_escalation",
    lane: "documentary",
    units: [
      u("0", 0.70, 0.70, 0.60, 0.0, "intrigue"),
      u("1", 0.65, 0.65, 0.55, 0.0, "wonder"),
      u("2", 0.60, 0.60, 0.50, 0.0, "threat"),
      u("3", 0.55, 0.55, 0.45, 0.0, "chaos"),
    ],
    expectedPass: false,
    description: "Descending energy — no escalation",
  },
  {
    name: "doc_borderline_contrast",
    lane: "documentary",
    units: [
      u("0", 0.35, 0.35, 0.30, -0.2, "intrigue"),
      u("1", 0.45, 0.45, 0.40, -0.1, "wonder"),
      u("2", 0.55, 0.55, 0.50, 0.0, "threat"),
      u("3", 0.65, 0.65, 0.60, 0.1, "chaos"),
      u("4", 0.85, 0.85, 0.75, 0.3, "emotion"),
      u("5", 0.92, 0.92, 0.88, 0.4, "release"),
    ],
    expectedPass: true,
    forbiddenFailures: ["LOW_CONTRAST"],
    description: "Documentary contrast threshold is 0.40 — should pass",
  },
];
