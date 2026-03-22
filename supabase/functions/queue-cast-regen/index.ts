import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * queue-cast-regen — Pure job insertion endpoint.
 *
 * Receives pre-planned RegenItems from the canonical client-side planner
 * (castRegenPlanner.ts) and inserts them as queued jobs.
 *
 * NO planner logic lives here. This is a job inserter only.
 */

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
    const { projectId, items } = body;

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "projectId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "items array is required and must be non-empty" }),
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

    // Insert jobs, skipping active duplicates via unique partial index
    let created_count = 0;
    let skipped_duplicates = 0;
    const jobs: Array<{
      id: string;
      output_id: string;
      character_key: string;
      reason: string;
    }> = [];

    for (const item of items) {
      if (!item.output_id || !item.character_key || !item.reason) {
        continue; // skip malformed items
      }

      const { data: inserted, error: insertErr } = await db
        .from("cast_regen_jobs")
        .insert({
          project_id: projectId,
          character_key: item.character_key,
          output_id: item.output_id,
          output_type: item.output_type || "ai_generated_media",
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
