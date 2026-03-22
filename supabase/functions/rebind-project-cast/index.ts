import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { projectId, characterKey, nextActorId, nextActorVersionId, reason } = body;

    if (!projectId || !characterKey) {
      return new Response(
        JSON.stringify({ error: "projectId and characterKey are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    const isUnbind = !nextActorId;

    // 1. Fetch current binding
    const { data: currentBinding } = await db
      .from("project_ai_cast")
      .select("id, ai_actor_id, ai_actor_version_id")
      .eq("project_id", projectId)
      .eq("character_key", characterKey)
      .maybeSingle();

    // 2. For rebind: validate next actor is roster-ready with approved version
    if (!isUnbind) {
      const { data: nextActor, error: actorErr } = await db
        .from("ai_actors")
        .select("id, roster_ready, approved_version_id")
        .eq("id", nextActorId)
        .maybeSingle();

      if (actorErr || !nextActor) {
        return new Response(
          JSON.stringify({ error: "Actor not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!nextActor.roster_ready) {
        return new Response(
          JSON.stringify({ error: "Actor is not roster-ready" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Use provided version or fall back to actor's approved version
      const resolvedVersionId = nextActorVersionId || nextActor.approved_version_id;
      if (!resolvedVersionId) {
        return new Response(
          JSON.stringify({ error: "No approved version available for this actor" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate version belongs to actor
      const { data: versionCheck } = await db
        .from("ai_actor_versions")
        .select("id")
        .eq("id", resolvedVersionId)
        .eq("actor_id", nextActorId)
        .maybeSingle();

      if (!versionCheck) {
        return new Response(
          JSON.stringify({ error: "Version does not belong to actor" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 3. Insert history row
      await db.from("project_ai_cast_history").insert({
        project_id: projectId,
        character_key: characterKey,
        previous_ai_actor_id: currentBinding?.ai_actor_id || null,
        previous_ai_actor_version_id: currentBinding?.ai_actor_version_id || null,
        next_ai_actor_id: nextActorId,
        next_ai_actor_version_id: resolvedVersionId,
        change_type: "rebind",
        change_reason: reason || null,
        changed_by: user.id,
      });

      // 4. Upsert binding
      const { error: upsertErr } = await db
        .from("project_ai_cast")
        .upsert(
          {
            project_id: projectId,
            character_key: characterKey,
            ai_actor_id: nextActorId,
            ai_actor_version_id: resolvedVersionId,
          },
          { onConflict: "project_id,character_key" }
        );

      if (upsertErr) {
        return new Response(
          JSON.stringify({ error: "Failed to update binding: " + upsertErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          action: "rebind",
          character_key: characterKey,
          previous_actor_id: currentBinding?.ai_actor_id || null,
          next_actor_id: nextActorId,
          next_actor_version_id: resolvedVersionId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // UNBIND
      if (!currentBinding) {
        return new Response(
          JSON.stringify({ action: "unbind", character_key: characterKey, was_bound: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert history
      await db.from("project_ai_cast_history").insert({
        project_id: projectId,
        character_key: characterKey,
        previous_ai_actor_id: currentBinding.ai_actor_id,
        previous_ai_actor_version_id: currentBinding.ai_actor_version_id,
        next_ai_actor_id: null,
        next_ai_actor_version_id: null,
        change_type: "unbind",
        change_reason: reason || null,
        changed_by: user.id,
      });

      // Delete binding
      const { error: delErr } = await db
        .from("project_ai_cast")
        .delete()
        .eq("id", currentBinding.id);

      if (delErr) {
        return new Response(
          JSON.stringify({ error: "Failed to unbind: " + delErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          action: "unbind",
          character_key: characterKey,
          was_bound: true,
          previous_actor_id: currentBinding.ai_actor_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
