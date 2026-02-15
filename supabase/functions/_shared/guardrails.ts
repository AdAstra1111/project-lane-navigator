/**
 * IFFY Production Guardrail Framework
 * 
 * Provides a unified guardrail injection layer for all LLM-calling edge functions.
 * Supports production-type profiles, project-level overrides, per-engine engineMode,
 * hard-lock vs soft-bias modes, and post-output validation.
 */

import { getProductionTypeContext, getConditioningBlock, checkDisallowedConcepts } from "./productionTypeRules.ts";

// ─── Types ───

export type EngineMode = "hard-lock" | "soft-bias" | "advisory";

export interface GuardrailPolicy {
  productionType: string;
  engineMode: EngineMode;
  disallowedConcepts: string[];
  documentaryFabricationCheck: boolean;
  customText: string | null;
  profileName: string;
}

export interface GuardrailBlock {
  textBlock: string;
  policy: GuardrailPolicy;
  hash: string;
  profileName: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: Array<{
    type: "disallowed_concept" | "documentary_fabrication" | "custom_rule";
    detail: string;
    severity: "hard" | "soft";
  }>;
}

export interface GuardrailsConfig {
  enabled?: boolean;
  profile?: string;
  engineModes?: Record<string, EngineMode>;
  overrides?: {
    engineMode?: EngineMode;
    additionalDisallowed?: string[];
    customText?: string;
    absurdityRange?: [number, number];
    forbidden?: string[];
    mustInclude?: string[];
  };
  customText?: string;
}

export interface GuardrailInput {
  project?: {
    format?: string;
    production_type?: string;
    assigned_lane?: string;
    budget_range?: string;
    guardrails?: GuardrailsConfig;
    guardrails_config?: GuardrailsConfig;
  };
  productionType?: string;
  engineName?: string;
  engineMode?: EngineMode;
  laneWeights?: Record<string, number>;
  corpusEnabled?: boolean;
  corpusCalibration?: any;
}

// ─── Engine Mode Profiles ───

const ENGINE_MODE_DEFAULTS: Record<string, EngineMode> = {
  documentary: "hard-lock",
  "documentary-series": "hard-lock",
  "hybrid-documentary": "hard-lock",
  film: "soft-bias",
  "tv-series": "soft-bias",
  "limited-series": "soft-bias",
  "vertical-drama": "soft-bias",
  "short-film": "soft-bias",
  commercial: "soft-bias",
  "branded-content": "soft-bias",
  "music-video": "soft-bias",
  "proof-of-concept": "soft-bias",
  "digital-series": "soft-bias",
  hybrid: "advisory",
  "anim-feature": "soft-bias",
  "anim-series": "soft-bias",
  reality: "soft-bias",
  "podcast-ip": "soft-bias",
};

// ─── Simple hash for tracking ───

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

// ─── Resolve guardrails config ───

function resolveGuardrailsConfig(project?: GuardrailInput["project"]): GuardrailsConfig | null {
  if (!project) return null;
  // Prefer guardrails_config (new JSONB column), fall back to guardrails (legacy)
  const cfg = project.guardrails_config || project.guardrails;
  if (!cfg || cfg.enabled === false) return null;
  return cfg;
}

// ─── Resolve engine mode ───

function resolveEngineMode(
  pt: string,
  engineName: string | undefined,
  explicitMode: EngineMode | undefined,
  config: GuardrailsConfig | null,
): EngineMode {
  // 1. Explicit override in function call
  if (explicitMode) return explicitMode;
  // 2. Per-engine override in project guardrails_config
  if (config?.engineModes && engineName && config.engineModes[engineName]) {
    return config.engineModes[engineName];
  }
  // 3. Override in config.overrides.engineMode
  if (config?.overrides?.engineMode) return config.overrides.engineMode;
  // 4. Default for production type
  return ENGINE_MODE_DEFAULTS[pt] || "soft-bias";
}

// ─── Core Builder ───

/**
 * Build a guardrail block that can be injected into any LLM system prompt.
 * Returns both the text to inject and the policy metadata for logging/validation.
 */
export function buildGuardrailBlock(input: GuardrailInput): GuardrailBlock {
  const pt = input.productionType || input.project?.format || input.project?.production_type || "film";
  const config = resolveGuardrailsConfig(input.project);

  // Determine engine mode with per-engine support
  const engineMode = resolveEngineMode(pt, input.engineName, input.engineMode, config);

  // Get production type context
  const ctx = getProductionTypeContext(pt);
  const conditioningBlock = getConditioningBlock(pt);

  // Build disallowed list (base + overrides)
  const disallowed = [...ctx.disallowedConcepts];
  if (config?.overrides?.additionalDisallowed) {
    disallowed.push(...config.overrides.additionalDisallowed);
  }
  if (config?.overrides?.forbidden) {
    disallowed.push(...config.overrides.forbidden);
  }

  // Documentary fabrication check
  const isDoc = ["documentary", "documentary-series", "hybrid-documentary"].includes(pt);

  // Build profile name
  const profileName = config?.profile || `${ctx.label} (${engineMode})`;

  // Custom text
  const customText = config?.overrides?.customText || config?.customText || null;

  // mustInclude block
  let mustIncludeBlock = "";
  if (config?.overrides?.mustInclude?.length) {
    mustIncludeBlock = `\nMUST INCLUDE THEMES/CONCEPTS: ${config.overrides.mustInclude.join(", ")}`;
  }

  // Build enforcement phrasing based on engine mode
  let enforcementBlock: string;
  if (engineMode === "hard-lock") {
    enforcementBlock = `\n═══ GUARDRAIL ENFORCEMENT: HARD LOCK ═══
The following rules are NON-NEGOTIABLE. Violation will cause output rejection:
- NEVER reference or recommend: ${disallowed.join(', ')}
- All output must be strictly within the production type's domain
${isDoc ? '- DOCUMENTARY REALITY LOCK: Do NOT invent characters, fabricate scenes, create fictional dialogue, or generate INT./EXT. sluglines that don\'t exist in source material. Use [PLACEHOLDER] for unconfirmed information.' : ''}
${customText ? `- PROJECT-SPECIFIC RULE: ${customText}` : ''}${mustIncludeBlock}
═══ END HARD LOCK ═══`;
  } else if (engineMode === "soft-bias") {
    enforcementBlock = `\n═══ GUARDRAIL GUIDANCE: SOFT BIAS ═══
Prefer outputs that align with the production type's domain. Avoid these concepts unless specifically relevant:
${disallowed.join(', ')}
${customText ? `\nPROJECT-SPECIFIC GUIDANCE: ${customText}` : ''}${mustIncludeBlock}
═══ END SOFT BIAS ═══`;
  } else {
    enforcementBlock = `\n═══ GUARDRAIL ADVISORY ═══
Consider the production type's typical domain when generating output. The following concepts are unusual for this type: ${disallowed.slice(0, 5).join(', ')}
${customText ? `\nNote: ${customText}` : ''}${mustIncludeBlock}
═══ END ADVISORY ═══`;
  }

  // Corpus calibration block (if enabled)
  let corpusBlock = "";
  if (input.corpusEnabled && input.corpusCalibration) {
    const cal = input.corpusCalibration;
    corpusBlock = `\n═══ CORPUS CALIBRATION ═══
From ${cal.sample_size || 'N/A'} analyzed scripts of this format:
- Median page count: ${cal.median_page_count || 'N/A'}
- Median scene count: ${cal.median_scene_count || 'N/A'}
- Median dialogue ratio: ${cal.median_dialogue_ratio ? Math.round(cal.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Median midpoint position: ${cal.median_midpoint_position || 'N/A'}
- Median cast size: ${cal.median_cast_size || 'N/A'}
Use these as structural reference points. Deviate only with creative justification.
IMPORTANT: Do NOT imitate or copy any specific screenplay. Use only aggregate statistics.
═══ END CORPUS CALIBRATION ═══`;
  }

  // Lane weighting block
  let laneBlock = "";
  if (input.project?.assigned_lane) {
    laneBlock = `\nASSIGNED MONETISATION LANE: ${input.project.assigned_lane}`;
    if (input.project.budget_range) {
      laneBlock += ` | BUDGET: ${input.project.budget_range}`;
    }
  }

  const fullTextBlock = `${conditioningBlock}${enforcementBlock}${corpusBlock}${laneBlock}`;

  const policy: GuardrailPolicy = {
    productionType: pt,
    engineMode,
    disallowedConcepts: disallowed,
    documentaryFabricationCheck: isDoc,
    customText,
    profileName,
  };

  return {
    textBlock: fullTextBlock,
    policy,
    hash: simpleHash(fullTextBlock),
    profileName,
  };
}

// ─── Output Validation ───

/**
 * Validate AI output against the guardrail policy.
 * Returns violations that can trigger regeneration for hard-lock engines.
 */
export function validateOutput(text: string, policy: GuardrailPolicy): ValidationResult {
  const violations: ValidationResult["violations"] = [];

  // Check disallowed concepts
  const conceptViolations = checkDisallowedConcepts(policy.productionType, text);
  for (const v of conceptViolations) {
    violations.push({
      type: "disallowed_concept",
      detail: `Output references disallowed concept: "${v}"`,
      severity: policy.engineMode === "hard-lock" ? "hard" : "soft",
    });
  }

  // Documentary fabrication check
  if (policy.documentaryFabricationCheck) {
    const sceneHeadingPattern = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s/gm;
    const headings = text.match(sceneHeadingPattern);
    if (headings && headings.length > 0) {
      violations.push({
        type: "documentary_fabrication",
        detail: `Documentary output contains ${headings.length} scene heading(s) (INT./EXT.) which may indicate fabrication`,
        severity: "hard",
      });
    }
  }

  return {
    ok: violations.filter(v => v.severity === "hard").length === 0,
    violations,
  };
}

/**
 * Build a regeneration prompt that includes violation feedback.
 */
export function buildRegenerationPrompt(violations: ValidationResult["violations"]): string {
  const hardViolations = violations.filter(v => v.severity === "hard");
  if (hardViolations.length === 0) return "";
  
  return `\n\n═══ GUARDRAIL VIOLATION — REGENERATION REQUIRED ═══
Your previous output was rejected for the following violations:
${hardViolations.map((v, i) => `${i + 1}. ${v.detail}`).join('\n')}

Fix ALL violations in this regeneration. Do NOT repeat the same errors.
═══ END VIOLATION NOTICE ═══`;
}

// ─── Corpus Getter (unified) ───

/**
 * Fetch corpus calibration data for a project's production type.
 * Returns null if unavailable. Used by engines that need corpus influence.
 */
export async function getCorpusCalibration(
  db: any,
  productionType: string,
  genre?: string,
): Promise<any | null> {
  try {
    const pt = (productionType || "film").toLowerCase();
    const g = (genre || "").toLowerCase();

    // 1. Try genre baseline
    if (g) {
      const { data: baselines } = await db
        .from("corpus_insights")
        .select("pattern, production_type, lane")
        .eq("insight_type", "baseline_profile");
      if (baselines?.length) {
        const match = baselines.find((d: any) => {
          const cpt = (d.production_type || "").toLowerCase();
          return (cpt === pt || pt.includes(cpt) || cpt.includes(pt)) &&
            (d.lane || "").toLowerCase() === g;
        });
        if (match?.pattern && (match.pattern.sample_size || 0) >= 3) {
          return match.pattern;
        }
      }
    }

    // 2. Try production type calibration
    const { data } = await db
      .from("corpus_insights")
      .select("pattern, production_type")
      .eq("insight_type", "calibration");
    if (data?.length) {
      const match = data.find((d: any) => {
        const cpt = (d.production_type || "").toLowerCase();
        return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
      });
      if (match?.pattern && (match.pattern.sample_size || 0) >= 3) {
        return match.pattern;
      }
    }

    // 3. Try gold baseline
    const { data: goldData } = await db
      .from("corpus_insights")
      .select("pattern, production_type")
      .eq("insight_type", "gold_baseline");
    if (goldData?.length) {
      const match = goldData.find((d: any) => {
        const cpt = (d.production_type || "").toLowerCase();
        return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
      }) || goldData.find((d: any) => d.production_type === "all");
      if (match?.pattern) return match.pattern;
    }
  } catch { /* non-critical */ }

  return null;
}
