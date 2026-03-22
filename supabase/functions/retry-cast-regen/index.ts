/**
 * retry-cast-regen — Backend-authoritative retry for failed cast regen jobs.
 *
 * Creates a NEW queued job from a failed job. The original failed row
 * remains immutable history. Dedup prevents duplicate queued/running jobs.
 *
 * Input: { jobId: string }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Validate caller
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Invalid token" }, 401);

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;

    if (!jobId || typeof jobId !== "string") {
      return json({ error: "jobId is required" }, 400);
    }

    // 1. Fetch failed job
    const { data: failedJob, error: fetchErr } = await db
      .from("cast_regen_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (fetchErr) {
      return json({ error: `Failed to fetch job: ${fetchErr.message}` }, 500);
    }
    if (!failedJob) {
      return json({ error: "Job not found" }, 404);
    }
    if (failedJob.status !== "failed") {
      return json({ error: `Job status is '${failedJob.status}', only 'failed' jobs can be retried` }, 400);
    }

    // 2. Verify project access
    const { data: accessCheck } = await db.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: failedJob.project_id,
    });
    if (!accessCheck) {
      return json({ error: "No access to project" }, 403);
    }

    // 3. Check dedup — skip if queued/running duplicate exists
    const { data: existing } = await db
      .from("cast_regen_jobs")
      .select("id")
      .eq("project_id", failedJob.project_id)
      .eq("character_key", failedJob.character_key)
      .eq("output_id", failedJob.output_id)
      .eq("reason", failedJob.reason)
      .in("status", ["queued", "running"])
      .limit(1);

    if (existing && existing.length > 0) {
      return json({
        action: "retry",
        created: false,
        skipped: true,
        reason: "duplicate_active_job",
        existing_job_id: existing[0].id,
      });
    }

    // 4. Insert new queued job
    const { data: newJob, error: insertErr } = await db
      .from("cast_regen_jobs")
      .insert({
        project_id: failedJob.project_id,
        character_key: failedJob.character_key,
        output_id: failedJob.output_id,
        output_type: failedJob.output_type,
        reason: failedJob.reason,
        status: "queued",
        requested_by: user.id,
      })
      .select("id")
      .single();

    if (insertErr) {
      return json({ error: `Insert failed: ${insertErr.message}` }, 500);
    }

    return json({
      action: "retry",
      created: true,
      skipped: false,
      new_job_id: newJob.id,
      source_failed_job_id: jobId,
    });
  } catch (err) {
    console.error("[retry-cast-regen] fatal:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
