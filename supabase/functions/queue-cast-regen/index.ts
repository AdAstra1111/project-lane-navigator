import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Normalize character key: lowercase, trim, collapse whitespace.
 * Must match src/lib/aiCast/normalizeCharacterKey.ts
 */
function normalizeCharacterKey(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * queue-cast-regen — Backend-authoritative regen job creation.
 *
 * THIS IS THE CANONICAL PLANNER + QUEUE ENDPOINT.
 *
 * The server computes the regen plan from DB truth, filters by
 * caller intent, and inserts jobs. The client never supplies items.
 *
 * Accepts:
 *   - projectId (required)
 *   - characterKey (optional filter)
 *   - reasons (optional filter)
 *   - dryRun (optional: if true, returns plan without creating jobs)
 */

// ── Canonical Planner Types ─────────────────────────────────────────────────

type RegenReason =
  | "out_of_sync_with_current_cast"
  | "unbound"
  | "stale_roster_revoked"
  | "invalid_missing_version";

interface RegenItem {
  output_id: string;
  output_type: "ai_generated_media";
  character_key: string;
  reason: RegenReason;
  stored_actor_version_id: string | null;
  current_actor_version_id: string | null;
}

interface RegenPlan {
  total_items: number;
  by_reason: Record<RegenReason, RegenItem[]>;
  by_character: Record<string, RegenItem[]>;
}

// ── Canonical Planner Logic (SINGLE SOURCE OF TRUTH) ────────────────────────

async function buildCastRegenPlan(
  db: ReturnType<typeof createClient>,
  projectId: string,
): Promise<RegenPlan> {
  // A. Fetch current bindings
  const { data: bindings } = await db
    .from("project_ai_cast")
    .select("character_key, ai_actor_id, ai_actor_version_id")
    .eq("project_id", projectId);

  const bindingMap: Record<
    string,
    { actor_id: string; version_id: string | null }
  > = {};
  const boundActorIds = new Set<string>();
  for (const b of bindings || []) {
    const key = normalizeCharacterKey(b.character_key || "");
    bindingMap[key] = {
      actor_id: b.ai_actor_id,
      version_id: b.ai_actor_version_id,
    };
    if (b.ai_actor_id) boundActorIds.add(b.ai_actor_id);
  }

  // B. Fetch generated outputs with provenance
  const { data: media } = await db
    .from("ai_generated_media")
    .select("id, generation_params")
    .eq("project_id", projectId)
    .limit(500);

  // C. Extract provenance entries
  interface RawEntry {
    outputId: string;
    charKey: string;
    storedVersionId: string | null;
    storedActorId: string | null;
  }
  const rawEntries: RawEntry[] = [];
  const allActorIds = new Set(boundActorIds);

  for (const item of media || []) {
    const params = item.generation_params as any;
    const provenance = params?.cast_provenance || params?.cast_context;
    if (!Array.isArray(provenance)) continue;

    for (const p of provenance) {
      const charKey = normalizeCharacterKey(p.character_key || "");
      if (!charKey) continue;
      const actorId = p.actor_id || null;
      if (actorId) allActorIds.add(actorId);
      rawEntries.push({
        outputId: item.id,
        charKey,
        storedVersionId: p.actor_version_id || null,
        storedActorId: actorId,
      });
    }
  }

  // D. Batch fetch actor roster state
  const actorState: Record<string, { roster_ready: boolean }> = {};
  const actorIdArr = [...allActorIds];
  if (actorIdArr.length > 0) {
    const { data: actorRows } = await db
      .from("ai_actors")
      .select("id, roster_ready")
      .in("id", actorIdArr);
    for (const a of actorRows || []) {
      actorState[a.id] = { roster_ready: a.roster_ready };
    }
  }

  // E. Batch fetch version existence
  const boundVersionIds = [
    ...new Set(
      (bindings || [])
        .map((b: any) => b.ai_actor_version_id)
        .filter(Boolean),
    ),
  ];
  const versionExists = new Set<string>();
  if (boundVersionIds.length > 0) {
    const { data: versionRows } = await db
      .from("ai_actor_versions")
      .select("id")
      .in("id", boundVersionIds);
    for (const v of versionRows || []) {
      versionExists.add(v.id);
    }
  }

  // F. Classify each entry
  // Order: A) unbound → B) invalid_missing_version → C) stale_roster_revoked → D) in-sync skip → E) out_of_sync
  const items: RegenItem[] = [];

  for (const entry of rawEntries) {
    const binding = bindingMap[entry.charKey];
    const currentVersionId = binding?.version_id ?? null;

    // A. No current binding → unbound
    if (!binding) {
      items.push({
        output_id: entry.outputId,
        output_type: "ai_generated_media",
        character_key: entry.charKey,
        reason: "unbound",
        stored_actor_version_id: entry.storedVersionId,
        current_actor_version_id: null,
      });
      continue;
    }

    // B. Bound version row does not exist → invalid_missing_version
    if (currentVersionId && !versionExists.has(currentVersionId)) {
      items.push({
        output_id: entry.outputId,
        output_type: "ai_generated_media",
        character_key: entry.charKey,
        reason: "invalid_missing_version",
        stored_actor_version_id: entry.storedVersionId,
        current_actor_version_id: currentVersionId,
      });
      continue;
    }

    // C. Bound actor roster revoked → stale_roster_revoked
    const bindingActor = binding.actor_id
      ? actorState[binding.actor_id]
      : null;
    if (bindingActor && !bindingActor.roster_ready) {
      items.push({
        output_id: entry.outputId,
        output_type: "ai_generated_media",
        character_key: entry.charKey,
        reason: "stale_roster_revoked",
        stored_actor_version_id: entry.storedVersionId,
        current_actor_version_id: currentVersionId,
      });
      continue;
    }

    // D. In sync → skip
    if (entry.storedVersionId === currentVersionId) continue;

    // E. Version mismatch → out_of_sync_with_current_cast
    items.push({
      output_id: entry.outputId,
      output_type: "ai_generated_media",
      character_key: entry.charKey,
      reason: "out_of_sync_with_current_cast",
      stored_actor_version_id: entry.storedVersionId,
      current_actor_version_id: currentVersionId,
    });
  }

  // G. Build grouped structure
  const byReason: Record<RegenReason, RegenItem[]> = {
    out_of_sync_with_current_cast: [],
    unbound: [],
    stale_roster_revoked: [],
    invalid_missing_version: [],
  };
  const byCharacter: Record<string, RegenItem[]> = {};

  for (const item of items) {
    byReason[item.reason].push(item);
    if (!byCharacter[item.character_key]) byCharacter[item.character_key] = [];
    byCharacter[item.character_key].push(item);
  }

  return {
    total_items: items.length,
    by_reason: byReason,
    by_character: byCharacter,
  };
}

// ── Edge Function Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // Validate user
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { projectId, characterKey, reasons, dryRun } = body;

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "projectId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: projectId,
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "No project access" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── A. Build canonical regen plan (server-side) ──
    const plan = await buildCastRegenPlan(db, projectId);

    // ── B. Filter by caller intent ──
    let filtered: RegenItem[] = [];
    for (const reason of Object.keys(plan.by_reason) as RegenReason[]) {
      filtered.push(...plan.by_reason[reason]);
    }

    if (characterKey) {
      const normKey = normalizeCharacterKey(characterKey);
      filtered = filtered.filter((i) => i.character_key === normKey);
    }
    if (reasons && Array.isArray(reasons) && reasons.length > 0) {
      const reasonSet = new Set(reasons);
      filtered = filtered.filter((i) => reasonSet.has(i.reason));
    }

    // ── C. Dry run: return plan without creating jobs ──
    if (dryRun) {
      return new Response(
        JSON.stringify({ plan, filtered_count: filtered.length, items: filtered }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── D. Insert jobs, skipping active duplicates ──
    let created_count = 0;
    let skipped_duplicates = 0;
    const jobs: Array<{
      id: string;
      output_id: string;
      character_key: string;
      reason: string;
    }> = [];

    for (const item of filtered) {
      const { data: inserted, error: insertErr } = await db
        .from("cast_regen_jobs")
        .insert({
          project_id: projectId,
          character_key: item.character_key,
          output_id: item.output_id,
          output_type: "ai_generated_media",
          reason: item.reason,
          status: "queued",
          requested_by: user.id,
        })
        .select("id")
        .single();

      if (insertErr) {
        // Unique constraint violation = active duplicate
        if (
          insertErr.code === "23505" ||
          insertErr.message?.includes("duplicate") ||
          insertErr.message?.includes("unique")
        ) {
          skipped_duplicates++;
          continue;
        }
        throw insertErr;
      }

      created_count++;
      jobs.push({
        id: inserted.id,
        output_id: item.output_id,
        character_key: item.character_key,
        reason: item.reason,
      });
    }

    return new Response(
      JSON.stringify({ created_count, skipped_duplicates, jobs }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
