/**
 * Server-safe canonical cast resolver for edge functions.
 *
 * SINGLE SOURCE OF TRUTH for resolving project-bound cast identity in backend.
 * Reads ONLY from project_ai_cast with pinned ai_actor_version_id.
 *
 * Rules:
 * - MUST NOT fallback to ai_actors.approved_version_id
 * - MUST NOT fallback to latest version
 * - MUST NOT use is_approved
 * - If no binding exists → explicit null result
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServerCastResult {
  bound: true;
  actor_id: string;
  actor_name: string;
  actor_version_id: string;
  description: string | null;
  negative_prompt: string | null;
  reference_images: string[];
}

export interface ServerCastUnbound {
  bound: false;
}

export type ServerCastContext = ServerCastResult | ServerCastUnbound;

// ── Normalize (must match canonical normalizeCharacterKey) ──────────────────

export function normalizeCharacterKey(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve cast context for a single character in a project.
 * Reads ONLY from project_ai_cast — no fallback.
 */
export async function resolveServerCastContext(
  db: any,
  projectId: string,
  characterKey: string,
): Promise<ServerCastContext> {
  const normKey = normalizeCharacterKey(characterKey);

  // 1. Read canonical binding
  const { data: binding } = await db
    .from("project_ai_cast")
    .select("ai_actor_id, ai_actor_version_id")
    .eq("project_id", projectId)
    .eq("character_key", normKey)
    .maybeSingle();

  if (!binding || !binding.ai_actor_version_id) {
    return { bound: false };
  }

  // 2. Fetch actor metadata
  const { data: actor } = await db
    .from("ai_actors")
    .select("id, name, description, negative_prompt")
    .eq("id", binding.ai_actor_id)
    .maybeSingle();

  // 3. Fetch pinned version assets
  const { data: assets } = await db
    .from("ai_actor_assets")
    .select("asset_type, public_url, meta_json")
    .eq("actor_version_id", binding.ai_actor_version_id)
    .in("asset_type", [
      "reference_image",
      "reference_headshot",
      "reference_full_body",
      "screen_test_still",
    ]);

  return {
    bound: true,
    actor_id: binding.ai_actor_id,
    actor_name: actor?.name || "",
    actor_version_id: binding.ai_actor_version_id,
    description: actor?.description || null,
    negative_prompt: actor?.negative_prompt || null,
    reference_images: (assets || [])
      .map((a: any) => a.public_url)
      .filter(Boolean),
  };
}
