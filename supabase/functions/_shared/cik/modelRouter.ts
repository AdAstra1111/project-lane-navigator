/**
 * CIK — Deterministic Model Router
 * Selects model + parameters based on engine, lane, quality signals.
 * No randomness. Deterministic rules only.
 */

export interface ModelRouterInput {
  engine: "trailer" | "storyboard";
  lane?: string;
  expectedUnitCount?: number;
  priorFailures?: string[];
  adapterQualityPercent?: number; // percent_defaulted_fields from adapter
  attemptIndex: number;
}

export interface ModelRouterDecision {
  model: string;
  temperature: number;
  maxTokens: number;
  reasons: string[];
}

/** Known model tiers (deterministic, no external lookups). */
const MODELS = {
  FAST: "google/gemini-2.5-flash",
  BALANCED: "google/gemini-2.5-pro",
  STRONG: "openai/gpt-5",
  STRUCTURED: "openai/gpt-5-mini",
} as const;

/** Ladder/arc failure codes that indicate structural problems. */
const STRUCTURAL_FAILURES = new Set([
  "WEAK_ARC", "ENERGY_DROP", "DIRECTION_REVERSAL", "FLATLINE", "NO_ESCALATION",
]);

/**
 * Select model + parameters deterministically.
 * Attempt 0: cheaper model.
 * Attempt 1: upgrade if structural failures or poor adapter quality.
 */
export function routeModel(input: ModelRouterInput): ModelRouterDecision {
  const reasons: string[] = [];
  const hasStructuralFailures = (input.priorFailures || []).some(f => STRUCTURAL_FAILURES.has(f));
  const hasLowAdapterQuality = (input.adapterQualityPercent ?? 0) > 0.25;
  const isShortForm = input.lane === "vertical_drama" || input.lane === "advertising";

  // Attempt 0: use cost-effective model
  if (input.attemptIndex === 0) {
    if (isShortForm) {
      reasons.push("short_form_lane");
      return {
        model: MODELS.FAST,
        temperature: 0.3,
        maxTokens: 8000,
        reasons,
      };
    }

    if (input.engine === "storyboard") {
      reasons.push("storyboard_default");
      return {
        model: MODELS.BALANCED,
        temperature: 0.4,
        maxTokens: 14000,
        reasons,
      };
    }

    reasons.push("trailer_default");
    return {
      model: MODELS.BALANCED,
      temperature: 0.4,
      maxTokens: 14000,
      reasons,
    };
  }

  // Attempt 1 (repair): escalate if needed
  if (hasLowAdapterQuality) {
    reasons.push("low_adapter_quality");
    return {
      model: MODELS.STRUCTURED,
      temperature: 0.3,
      maxTokens: 14000,
      reasons,
    };
  }

  if (hasStructuralFailures) {
    reasons.push("structural_failures");
    // For structural issues, use the strong model
    if (input.lane === "feature_film" || input.lane === "series") {
      reasons.push("premium_lane");
      return {
        model: MODELS.STRONG,
        temperature: 0.35,
        maxTokens: 16000,
        reasons,
      };
    }
    return {
      model: MODELS.BALANCED,
      temperature: 0.35,
      maxTokens: 14000,
      reasons,
    };
  }

  // Default repair: same tier
  reasons.push("standard_repair");
  return {
    model: MODELS.BALANCED,
    temperature: 0.4,
    maxTokens: 14000,
    reasons,
  };
}

/** Log router decision for telemetry. */
export function logRouterDecision(
  handler: string, phase: string,
  input: ModelRouterInput, decision: ModelRouterDecision,
): void {
  console.error(JSON.stringify({
    type: "CINEMATIC_MODEL_ROUTER",
    handler,
    phase,
    attempt: input.attemptIndex,
    engine: input.engine,
    lane: input.lane,
    chosen_model: decision.model,
    temperature: decision.temperature,
    reasons: decision.reasons,
  }));
}
