/**
 * Note → Prompt Delta Compiler (Deterministic)
 * Converts user-written per-shot notes into deterministic prompt deltas.
 * No LLM usage. Fixed keyword mapping only.
 * Same inputs => identical output.
 */

export interface PromptDelta {
  /** Constraints to add to the prompt */
  addConstraints: string[];
  /** Constraints to remove (by prefix match) */
  removeConstraints: string[];
  /** Camera move override (if any) */
  cameraMoveOverride?: string;
  /** Duration multiplier (1.0 = no change) */
  durationMultiplier: number;
  /** Additional negative prompt terms */
  addNegative: string[];
  /** Warnings for unresolvable or conflicting requests */
  warnings: string[];
  /** Raw notes text preserved for audit */
  rawNotes: string;
}

/** Keyword → delta mapping. Order matters: first match wins per category. */
const KEYWORD_MAP: {
  pattern: RegExp;
  apply: (delta: PromptDelta) => void;
}[] = [
  // Lighting
  { pattern: /\bbrighter\b/i, apply: d => d.addConstraints.push("lighting:high_key") },
  { pattern: /\bdarker\b/i, apply: d => d.addConstraints.push("lighting:low_key") },
  { pattern: /\bhigh[- ]?key\b/i, apply: d => d.addConstraints.push("lighting:high_key") },
  { pattern: /\blow[- ]?key\b/i, apply: d => d.addConstraints.push("lighting:low_key") },
  { pattern: /\bgolden[- ]?hour\b/i, apply: d => d.addConstraints.push("lighting:golden_hour") },
  { pattern: /\bsilhouette\b/i, apply: d => d.addConstraints.push("lighting:silhouette") },

  // Pacing
  { pattern: /\bslower\b/i, apply: d => { d.durationMultiplier = Math.min(d.durationMultiplier * 1.1, 1.5); } },
  { pattern: /\bfaster\b/i, apply: d => { d.durationMultiplier = Math.max(d.durationMultiplier * 0.9, 0.5); } },
  { pattern: /\bmuch slower\b/i, apply: d => { d.durationMultiplier = Math.min(d.durationMultiplier * 1.25, 1.5); } },
  { pattern: /\bmuch faster\b/i, apply: d => { d.durationMultiplier = Math.max(d.durationMultiplier * 0.75, 0.5); } },

  // Camera
  { pattern: /\bmore handheld\b/i, apply: d => { d.cameraMoveOverride = "HANDHELD"; } },
  { pattern: /\bsteadier\b|more stable\b/i, apply: d => { d.cameraMoveOverride = "STATIC"; } },
  { pattern: /\bdolly\b/i, apply: d => { d.cameraMoveOverride = "DOLLY"; } },
  { pattern: /\bcrane\b/i, apply: d => { d.cameraMoveOverride = "CRANE"; } },
  { pattern: /\btracking\b/i, apply: d => { d.cameraMoveOverride = "TRACKING"; } },

  // Mood / atmosphere
  { pattern: /\bmoody\b/i, apply: d => d.addConstraints.push("mood:moody") },
  { pattern: /\btense\b/i, apply: d => d.addConstraints.push("mood:tense") },
  { pattern: /\bserene\b|peaceful\b/i, apply: d => d.addConstraints.push("mood:serene") },
  { pattern: /\bchaotic\b/i, apply: d => d.addConstraints.push("mood:chaotic") },

  // Negative
  { pattern: /\bno shake\b/i, apply: d => d.addNegative.push("camera shake") },
  { pattern: /\bno blur\b/i, apply: d => d.addNegative.push("motion blur") },
  { pattern: /\bno flicker\b/i, apply: d => d.addNegative.push("flicker") },
];

export interface CompileDeltaInput {
  notes: string;
  shotType?: string;
  cameraMove?: string;
  energyBand?: string;
}

/**
 * Compile user notes into a deterministic prompt delta.
 * Unknown text is preserved but does NOT change the prompt.
 */
export function compilePromptDelta(input: CompileDeltaInput): PromptDelta {
  const { notes, cameraMove, energyBand } = input;

  const delta: PromptDelta = {
    addConstraints: [],
    removeConstraints: [],
    durationMultiplier: 1.0,
    addNegative: [],
    warnings: [],
    rawNotes: notes || "",
  };

  if (!notes || notes.trim().length === 0) return delta;

  // Track which patterns matched
  const matchedRanges: boolean[] = new Array(KEYWORD_MAP.length).fill(false);

  for (let i = 0; i < KEYWORD_MAP.length; i++) {
    const { pattern, apply } = KEYWORD_MAP[i];
    if (pattern.test(notes)) {
      matchedRanges[i] = true;
      apply(delta);
    }
  }

  // Validate camera move override against energy constraints
  if (delta.cameraMoveOverride) {
    const lowEnergy = energyBand === "low" || energyBand === "mid";
    if (delta.cameraMoveOverride === "HANDHELD" && lowEnergy && cameraMove === "STATIC") {
      delta.warnings.push(
        `Camera move HANDHELD requested via notes but energy band is ${energyBand}; override applied with warning.`
      );
    }
  }

  // Check for contradictions
  const hasHighKey = delta.addConstraints.includes("lighting:high_key");
  const hasLowKey = delta.addConstraints.includes("lighting:low_key");
  if (hasHighKey && hasLowKey) {
    delta.warnings.push("Contradictory lighting: both 'brighter' and 'darker' requested. Last one wins.");
    // Remove the first (brighter), keep darker
    delta.addConstraints = delta.addConstraints.filter(c => c !== "lighting:high_key");
  }

  // Clamp duration multiplier
  delta.durationMultiplier = Math.round(delta.durationMultiplier * 1000) / 1000;

  return delta;
}

/**
 * Apply a prompt delta to shot fields, returning modified values.
 * Deterministic: same delta + same shot => same result.
 */
export function applyDelta(
  baseDurationSec: number,
  baseCameraMove: string,
  baseContinuityTags: string[],
  delta: PromptDelta
): {
  durationSec: number;
  cameraMove: string;
  continuityTags: string[];
  additionalNegative: string[];
} {
  // Duration
  const durationSec = Math.round(baseDurationSec * delta.durationMultiplier * 100) / 100;

  // Camera move
  const cameraMove = delta.cameraMoveOverride || baseCameraMove;

  // Continuity tags: add new, remove by prefix
  let tags = [...baseContinuityTags];
  for (const remove of delta.removeConstraints) {
    tags = tags.filter(t => !t.startsWith(remove));
  }
  for (const add of delta.addConstraints) {
    if (!tags.includes(add)) tags.push(add);
  }

  return {
    durationSec,
    cameraMove,
    continuityTags: tags,
    additionalNegative: [...delta.addNegative],
  };
}
