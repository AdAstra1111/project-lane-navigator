/**
 * shot-plan-jobs — Durable edge function for "Generate Full Shot Plan"
 * Actions: create_job, get_active_job, pause_job, resume_job, cancel_job, reset_job, tick
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GATEWAY_URL = "https://api.lovable.dev/v1/chat/completions";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Not authenticated");
  return user.id;
}

// Fetch scenes for a project from scene_graph_nodes
async function fetchProjectScenes(admin: any, projectId: string) {
  // Get active scenes ordered by order_key
  const { data, error } = await admin
    .from("scene_graph_nodes")
    .select("id, project_id, display_number, order_key, latest_version_id")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .order("order_key", { ascending: true });
  if (error) throw new Error(`Failed to fetch scenes: ${error.message}`);
  return data || [];
}

// Get counts for a job
async function getJobCounts(admin: any, jobId: string) {
  const { data } = await admin
    .from("shot_plan_job_scenes")
    .select("status")
    .eq("job_id", jobId);
  const scenes = data || [];
  const counts = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0, total: scenes.length };
  for (const s of scenes) {
    if (s.status in counts) (counts as any)[s.status]++;
  }
  return counts;
}

// Generate shots for a single scene via dev-engine-v2
async function generateShotsForScene(
  token: string,
  projectId: string,
  sceneId: string,
  mode: string,
): Promise<{ shots: any[]; shot_set: any }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "shots_generate_for_scene",
      projectId,
      sceneId,
      mode: mode || "coverage",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = "Shot generation failed";
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return resp.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();
    const userId = await getUserId(req);
    const admin = adminClient();
    const authToken = (req.headers.get("Authorization") || "").replace("Bearer ", "");

    switch (action) {
      // ─── CREATE JOB ───
      case "create_job": {
        const { projectId, mode = "coverage" } = params;
        if (!projectId) return json({ error: "projectId required" }, 400);

        // Check for existing active job (idempotent)
        const { data: existing } = await admin
          .from("shot_plan_jobs")
          .select("*")
          .eq("project_id", projectId)
          .in("status", ["running", "paused", "queued"])
          .order("started_at", { ascending: false })
          .limit(1);

        if (existing && existing.length > 0) {
          const counts = await getJobCounts(admin, existing[0].id);
          return json({ job: existing[0], counts, message: "Active job already exists" });
        }

        // Fetch scenes
        const scenes = await fetchProjectScenes(admin, projectId);
        if (scenes.length === 0) return json({ error: "No scenes found" }, 400);

        // Insert job
        const { data: job, error: jobErr } = await admin
          .from("shot_plan_jobs")
          .insert({
            project_id: projectId,
            created_by: userId,
            status: "running",
            mode,
            total_scenes: scenes.length,
            completed_scenes: 0,
            inserted_shots: 0,
            current_scene_index: 0,
            started_at: new Date().toISOString(),
            last_heartbeat_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (jobErr) throw new Error(jobErr.message);

        // Insert scene rows
        const sceneRows = scenes.map((s: any, i: number) => ({
          job_id: job.id,
          project_id: projectId,
          scene_id: s.id,
          scene_order: i,
          status: "pending",
          attempts: 0,
          inserted_shots: 0,
        }));
        const { error: scErr } = await admin.from("shot_plan_job_scenes").insert(sceneRows);
        if (scErr) throw new Error(scErr.message);

        const counts = await getJobCounts(admin, job.id);
        return json({ job, counts, message: "Job created" });
      }

      // ─── GET ACTIVE JOB ───
      case "get_active_job": {
        const { projectId } = params;
        if (!projectId) return json({ error: "projectId required" }, 400);

        const { data } = await admin
          .from("shot_plan_jobs")
          .select("*")
          .eq("project_id", projectId)
          .in("status", ["running", "paused", "queued"])
          .order("started_at", { ascending: false })
          .limit(1);

        const job = data?.[0] || null;
        if (!job) return json({ job: null, counts: null, message: "No active job" });
        const counts = await getJobCounts(admin, job.id);
        return json({ job, counts, message: "Active job found" });
      }

      // ─── PAUSE JOB ───
      case "pause_job": {
        const { projectId, jobId } = params;
        const id = jobId || (await findActiveJobId(admin, projectId));
        if (!id) return json({ error: "No active job" }, 404);

        await admin.from("shot_plan_jobs")
          .update({ status: "paused", last_message: "Paused by user" })
          .eq("id", id)
          .in("status", ["running", "queued"]);

        const { data: job } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        const counts = await getJobCounts(admin, id);
        return json({ job, counts, message: "Job paused" });
      }

      // ─── RESUME JOB ───
      case "resume_job": {
        const { projectId, jobId } = params;
        const id = jobId || (await findActiveJobId(admin, projectId));
        if (!id) return json({ error: "No active job" }, 404);

        await admin.from("shot_plan_jobs")
          .update({ status: "running", last_message: "Resumed", last_heartbeat_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", "paused");

        const { data: job } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        const counts = await getJobCounts(admin, id);
        return json({ job, counts, message: "Job resumed" });
      }

      // ─── CANCEL JOB ───
      case "cancel_job": {
        const { projectId, jobId } = params;
        const id = jobId || (await findActiveJobId(admin, projectId));
        if (!id) return json({ error: "No active job" }, 404);

        await admin.from("shot_plan_jobs")
          .update({ status: "canceled", finished_at: new Date().toISOString(), last_message: "Canceled by user" })
          .eq("id", id);

        const { data: job } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        const counts = await getJobCounts(admin, id);
        return json({ job, counts, message: "Job canceled" });
      }

      // ─── RESET JOB ───
      case "reset_job": {
        const { projectId, mode = "coverage" } = params;
        if (!projectId) return json({ error: "projectId required" }, 400);

        // Cancel any existing active job
        await admin.from("shot_plan_jobs")
          .update({ status: "canceled", finished_at: new Date().toISOString(), last_message: "Reset" })
          .eq("project_id", projectId)
          .in("status", ["running", "paused", "queued"]);

        // Inline create_job logic
        const scenes = await fetchProjectScenes(admin, projectId);
        if (scenes.length === 0) return json({ error: "No scenes found" }, 400);

        const { data: newJob, error: jobErr } = await admin
          .from("shot_plan_jobs")
          .insert({
            project_id: projectId,
            created_by: userId,
            status: "running",
            mode,
            total_scenes: scenes.length,
            completed_scenes: 0,
            inserted_shots: 0,
            current_scene_index: 0,
            started_at: new Date().toISOString(),
            last_heartbeat_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (jobErr) throw new Error(jobErr.message);

        const sceneRows = scenes.map((s: any, i: number) => ({
          job_id: newJob.id,
          project_id: projectId,
          scene_id: s.id,
          scene_order: i,
          status: "pending",
          attempts: 0,
          inserted_shots: 0,
        }));
        await admin.from("shot_plan_job_scenes").insert(sceneRows);

        const counts = await getJobCounts(admin, newJob.id);
        return json({ job: newJob, counts, message: "Job reset and created" });
      }

      // ─── TICK ───
      case "tick": {
        const { projectId, jobId } = params;
        const id = jobId || (await findActiveJobId(admin, projectId));
        if (!id) return json({ error: "No active job" }, 404);

        // Fetch job
        const { data: job } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        if (!job) return json({ error: "Job not found" }, 404);
        if (job.status !== "running") {
          const counts = await getJobCounts(admin, id);
          return json({ job, counts, sceneResult: null, message: `Job is ${job.status}, not running` });
        }

        // Heartbeat
        await admin.from("shot_plan_jobs")
          .update({ last_heartbeat_at: new Date().toISOString() })
          .eq("id", id);

        // Claim next pending scene (ordered by scene_order)
        const { data: pendingScenes } = await admin
          .from("shot_plan_job_scenes")
          .select("*")
          .eq("job_id", id)
          .eq("status", "pending")
          .order("scene_order", { ascending: true })
          .limit(1);

        if (!pendingScenes || pendingScenes.length === 0) {
          // No more pending — finalize
          const counts = await getJobCounts(admin, id);
          await admin.from("shot_plan_jobs").update({
            status: "complete",
            finished_at: new Date().toISOString(),
            last_message: `Complete: ${job.inserted_shots} shots across ${job.total_scenes} scenes`,
            current_scene_id: null,
          }).eq("id", id);

          const { data: finalJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
          return json({ job: finalJob, counts, sceneResult: null, message: "Job complete" });
        }

        const sceneRow = pendingScenes[0];

        // Mark scene as running
        await admin.from("shot_plan_job_scenes").update({
          status: "running",
          attempts: (sceneRow.attempts || 0) + 1,
          error_message: null,
        }).eq("id", sceneRow.id);

        // Update job current scene
        await admin.from("shot_plan_jobs").update({
          current_scene_id: sceneRow.scene_id,
          current_scene_index: sceneRow.scene_order,
          last_message: `Processing scene ${sceneRow.scene_order + 1}/${job.total_scenes}`,
        }).eq("id", id);

        let sceneResult: any = { scene_id: sceneRow.scene_id, status: "failed", shots_inserted: 0, error: null };

        try {
          const result = await generateShotsForScene(authToken, job.project_id, sceneRow.scene_id, job.mode);
          const shotCount = result.shots?.length || 0;

          // Mark scene complete
          await admin.from("shot_plan_job_scenes").update({
            status: "complete",
            inserted_shots: shotCount,
            error_message: null,
            finished_at: new Date().toISOString(),
          }).eq("id", sceneRow.id);

          // Update job counters
          await admin.from("shot_plan_jobs").update({
            completed_scenes: (job.completed_scenes || 0) + 1,
            inserted_shots: (job.inserted_shots || 0) + shotCount,
            last_message: `Completed scene ${sceneRow.scene_order + 1}/${job.total_scenes} (${shotCount} shots)`,
            last_error: null,
          }).eq("id", id);

          sceneResult = { scene_id: sceneRow.scene_id, status: "complete", shots_inserted: shotCount, error: null };
        } catch (err: any) {
          const errMsg = err?.message || "Unknown error";
          console.error(`Shot gen failed for scene ${sceneRow.scene_id}:`, errMsg);

          // Mark scene failed but continue job
          await admin.from("shot_plan_job_scenes").update({
            status: "failed",
            error_message: errMsg,
            finished_at: new Date().toISOString(),
          }).eq("id", sceneRow.id);

          await admin.from("shot_plan_jobs").update({
            completed_scenes: (job.completed_scenes || 0) + 1,
            last_error: errMsg,
            last_message: `Scene ${sceneRow.scene_order + 1} failed: ${errMsg}`,
          }).eq("id", id);

          sceneResult = { scene_id: sceneRow.scene_id, status: "failed", shots_inserted: 0, error: errMsg };
        }

        // Re-fetch job and counts
        const { data: updatedJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        const counts = await getJobCounts(admin, id);

        // Auto-complete if no more pending
        if (counts.pending === 0 && counts.running === 0) {
          await admin.from("shot_plan_jobs").update({
            status: "complete",
            finished_at: new Date().toISOString(),
            last_message: `Complete: ${updatedJob?.inserted_shots || 0} shots`,
            current_scene_id: null,
          }).eq("id", id);
          const { data: finalJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
          return json({ job: finalJob, counts: { ...counts, pending: 0 }, sceneResult, message: "Job complete" });
        }

        return json({ job: updatedJob, counts, sceneResult, message: "Tick processed" });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("shot-plan-jobs error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

// Helper to find active job id for a project
async function findActiveJobId(admin: any, projectId: string): Promise<string | null> {
  if (!projectId) return null;
  const { data } = await admin
    .from("shot_plan_jobs")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["running", "paused", "queued"])
    .order("started_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id || null;
}
