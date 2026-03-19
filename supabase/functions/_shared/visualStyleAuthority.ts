/**
 * Visual Style Authority Layer (VSAL) — Shared resolver for all image generation.
 *
 * Resolves the project's canonical visual style profile from `project_visual_style`.
 * Every image generation must call this resolver and inject the returned style lock.
 * No fallback to generic cinematic defaults — missing profiles block generation.
 *
 * Consumed by: generate-lookbook-image, generate-poster, storyboard-engine,
 *              ai-trailer-factory, ai-production-layer, auto-populate-visual-set
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface VisualStyleProfile {
  id: string;
  project_id: string;
  period: string;
  cultural_context: string;
  lighting_philosophy: string;
  camera_philosophy: string;
  composition_philosophy: string;
  texture_materiality: string;
  color_response: string;
  environment_realism: string;
  forbidden_traits: string[];
  is_complete: boolean;
}

export interface VisualStyleLock {
  period: string;
  cultural_context: string;
  lighting: string;
  camera: string;
  composition: string;
  texture: string;
  color: string;
  realism: string;
  forbid: string[];
}

export interface VisualStyleResolution {
  found: boolean;
  complete: boolean;
  lock: VisualStyleLock | null;
  promptBlock: string | null;
  negativeBlock: string | null;
  error: string | null;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the visual style profile for a project from the database.
 * Returns a structured lock for injection into generation prompts.
 *
 * If profile is missing or incomplete, returns error — NO fallback.
 */
export async function resolveVisualStyleProfile(
  supabase: { from: (table: string) => any },
  projectId: string,
): Promise<VisualStyleResolution> {
  const { data, error } = await supabase
    .from("project_visual_style")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error(`[VSAL] DB error resolving style for ${projectId}: ${error.message}`);
    return {
      found: false,
      complete: false,
      lock: null,
      promptBlock: null,
      negativeBlock: null,
      error: `visual_style_db_error: ${error.message}`,
    };
  }

  if (!data) {
    return {
      found: false,
      complete: false,
      lock: null,
      promptBlock: null,
      negativeBlock: null,
      error: "visual_style_missing",
    };
  }

  const profile = data as VisualStyleProfile;

  // Completeness check — all core fields must be non-empty
  const requiredFields: (keyof VisualStyleProfile)[] = [
    "period", "lighting_philosophy", "camera_philosophy",
    "composition_philosophy", "texture_materiality", "color_response",
    "environment_realism",
  ];
  const missingFields = requiredFields.filter(
    (f) => !profile[f] || (typeof profile[f] === "string" && (profile[f] as string).trim() === "")
  );

  if (missingFields.length > 0) {
    return {
      found: true,
      complete: false,
      lock: null,
      promptBlock: null,
      negativeBlock: null,
      error: `visual_style_incomplete: missing ${missingFields.join(", ")}`,
    };
  }

  const lock: VisualStyleLock = {
    period: profile.period,
    cultural_context: profile.cultural_context,
    lighting: profile.lighting_philosophy,
    camera: profile.camera_philosophy,
    composition: profile.composition_philosophy,
    texture: profile.texture_materiality,
    color: profile.color_response,
    realism: profile.environment_realism,
    forbid: profile.forbidden_traits || [],
  };

  const promptBlock = buildStylePromptBlock(lock);
  const negativeBlock = lock.forbid.length > 0 ? lock.forbid.join(", ") : null;

  return {
    found: true,
    complete: true,
    lock,
    promptBlock,
    negativeBlock,
    error: null,
  };
}

// ── Prompt Block Builder ─────────────────────────────────────────────────────

function buildStylePromptBlock(lock: VisualStyleLock): string {
  const lines: string[] = [
    `[VISUAL STYLE AUTHORITY — MANDATORY]`,
    ``,
    `Period / Era: ${lock.period}`,
  ];

  if (lock.cultural_context) {
    lines.push(`Cultural Context: ${lock.cultural_context}`);
  }

  lines.push(
    `Lighting: ${lock.lighting}`,
    `Camera: ${lock.camera}`,
    `Composition: ${lock.composition}`,
    `Texture / Materiality: ${lock.texture}`,
    `Color Response: ${lock.color}`,
    `Environment Realism: ${lock.realism}`,
  );

  if (lock.forbid.length > 0) {
    lines.push(
      ``,
      `FORBIDDEN MODERN TRAITS (DO NOT INCLUDE):`,
      ...lock.forbid.map((f) => `- ${f}`),
    );
  }

  lines.push(
    ``,
    `All visual elements MUST be consistent with this style authority.`,
    `Do NOT default to modern cinematic aesthetics unless explicitly permitted above.`,
  );

  return lines.join("\n");
}

/**
 * Format a VisualStyleLock into the negative prompt additions.
 */
export function getStyleAuthorityNegatives(lock: VisualStyleLock): string {
  const base = lock.forbid.length > 0 ? lock.forbid.join(", ") : "";
  return base;
}

/**
 * Validate a style resolution and return error response if invalid.
 * Helper for edge functions to gate generation.
 */
export function validateStyleOrError(
  resolution: VisualStyleResolution,
): { valid: true } | { valid: false; status: number; body: Record<string, unknown> } {
  if (!resolution.found) {
    return {
      valid: false,
      status: 400,
      body: {
        error: "visual_style_missing_or_incomplete",
        message: "No visual style profile found for this project. Create one in the Visual Production Hub before generating images.",
        code: "VSAL_MISSING",
      },
    };
  }
  if (!resolution.complete) {
    return {
      valid: false,
      status: 400,
      body: {
        error: "visual_style_missing_or_incomplete",
        message: `Visual style profile is incomplete: ${resolution.error}. Complete all fields before generating images.`,
        code: "VSAL_INCOMPLETE",
        detail: resolution.error,
      },
    };
  }
  return { valid: true };
}
