/**
 * shot-plan-jobs — Durable edge function for "Generate Full Shot Plan"
 * Actions: create_job, get_active_job, pause_job, resume_job, cancel_job, reset_job, recover_job, tick
 * Hardened: atomic claim via RPC, idempotent shots, retries, dead-heartbeat recovery
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 3;
const STALE_SECONDS = 90;

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

async function fetchProjectScenes(admin: any, projectId: string) {
  // Join scene_graph_order (for ordering + active flag) with scene_graph_scenes
  const { data: orderRows, error: orderErr } = await admin
    .from("scene_graph_order")
    .select("scene_id, order_key, is_active")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .order("order_key", { ascending: true });
  if (orderErr) throw new Error(`Failed to fetch scenes: ${orderErr.message}`);
  if (!orderRows || orderRows.length === 0) return [];

  // Get latest version for each scene
  const sceneIds = orderRows.map((r: any) => r.scene_id);
  const { data: versions, error: verErr } = await admin
    .from("scene_graph_versions")
    .select("id, scene_id, version_number, slugline")
    .in("scene_id", sceneIds)
    .order("version_number", { ascending: false });
  if (verErr) throw new Error(`Failed to fetch scene versions: ${verErr.message}`);

  // Map scene_id -> latest version
  const latestVersionMap = new Map<string, any>();
  for (const v of (versions || [])) {
    if (!latestVersionMap.has(v.scene_id)) latestVersionMap.set(v.scene_id, v);
  }

  // Build result matching the shape the rest of the function expects
  return orderRows.map((row: any, idx: number) => {
    const latestVer = latestVersionMap.get(row.scene_id);
    return {
      id: row.scene_id,
      project_id: projectId,
      display_number: idx + 1,
      order_key: row.order_key,
      latest_version_id: latestVer?.id || null,
    };
  });
}

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

/** Atomic claim via RPC — returns claimed scene row or null */
async function claimNextScene(admin: any, jobId: string): Promise<any | null> {
  const { data, error } = await admin.rpc("claim_next_shot_plan_scene", {
    p_job_id: jobId,
    p_stale_seconds: STALE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (error) {
    console.error("claim_next_shot_plan_scene RPC error:", error);
    return null;
  }
  return data?.[0] || null;
}

/** Delete prior shots created by this job for a given scene (idempotency) */
async function deleteJobShotsForScene(admin: any, sceneId: string, jobId: string, jobSceneId: string) {
  const { error } = await admin
    .from("scene_shots")
    .delete()
    .eq("scene_id", sceneId)
    .eq("shot_plan_job_id", jobId)
    .eq("shot_plan_job_scene_id", jobSceneId);
  if (error) console.error("Failed to delete prior job shots:", error);
}

/** Generate shots for a single scene via dev-engine-v2 */
async function generateShotsForScene(
  token: string,
  projectId: string,
  sceneId: string,
  mode: string,
  meta: { shot_plan_job_id: string; shot_plan_job_scene_id: string },
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
      meta,
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

/** Recover stale running scenes for a job */
async function recoverStaleScenes(admin: any, jobId: string) {
  // Find scenes stuck in 'running' with stale started_at
  const { data: staleScenes } = await admin
    .from("shot_plan_job_scenes")
    .select("id, attempts")
    .eq("job_id", jobId)
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - STALE_SECONDS * 1000).toISOString());

  if (!staleScenes || staleScenes.length === 0) return 0;

  let recovered = 0;
  for (const s of staleScenes) {
    const newStatus = (s.attempts || 0) >= MAX_ATTEMPTS ? "failed" : "pending";
    await admin.from("shot_plan_job_scenes").update({
      status: newStatus,
      error_message: newStatus === "failed" ? "Max attempts exceeded (stale recovery)" : "Recovered from stale state",
      finished_at: newStatus === "failed" ? new Date().toISOString() : null,
    }).eq("id", s.id);
    recovered++;
  }
  return recovered;
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

        // Idempotent: return existing active job
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

        const scenes = await fetchProjectScenes(admin, projectId);
        if (scenes.length === 0) return json({ error: "No scenes found" }, 400);

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

        // Cancel any existing active jobs
        await admin.from("shot_plan_jobs")
          .update({ status: "canceled", finished_at: new Date().toISOString(), last_message: "Reset" })
          .eq("project_id", projectId)
          .in("status", ["running", "paused", "queued"]);

        // Create fresh job inline
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

      // ─── RECOVER JOB ───
      case "recover_job": {
        const { projectId, jobId } = params;
        const id = jobId || (await findActiveJobId(admin, projectId));
        if (!id) return json({ error: "No active job" }, 404);

        const { data: job } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        if (!job) return json({ error: "Job not found" }, 404);

        // Recover stale scenes
        const recovered = await recoverStaleScenes(admin, id);

        // Update heartbeat
        await admin.from("shot_plan_jobs").update({
          last_heartbeat_at: new Date().toISOString(),
          last_message: `Recovered ${recovered} stale scene(s)`,
          status: "running",
        }).eq("id", id);

        const { data: updatedJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        const counts = await getJobCounts(admin, id);
        return json({ job: updatedJob, counts, message: `Recovered ${recovered} stale scenes` });
      }

      // ─── TICK ───
      case "tick": {
        const { projectId, jobId } = params;
        const id = jobId || (await findActiveJobId(admin, projectId));
        if (!id) return json({ error: "No active job" }, 404);

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

        // Atomic claim via RPC
        const claimed = await claimNextScene(admin, id);

        if (!claimed) {
          // No claimable scenes — check if done
          const counts = await getJobCounts(admin, id);
          if (counts.pending === 0 && counts.running === 0) {
            // Finalize
            await admin.from("shot_plan_jobs").update({
              status: "complete",
              finished_at: new Date().toISOString(),
              last_message: `Complete: ${job.inserted_shots} shots across ${job.total_scenes} scenes`,
              current_scene_id: null,
            }).eq("id", id);

            const { data: finalJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
            return json({ job: finalJob, counts, sceneResult: null, message: "Job complete" });
          }
          // Scenes still running (in another tab/tick) — wait
          return json({ job, counts, sceneResult: null, message: "Waiting for running scenes" });
        }

        // Update job current scene
        await admin.from("shot_plan_jobs").update({
          current_scene_id: claimed.scene_id,
          current_scene_index: claimed.scene_order,
          last_message: `Processing scene ${claimed.scene_order + 1}/${job.total_scenes}`,
        }).eq("id", id);

        // Idempotent: delete prior shots for this job+scene before generating
        await deleteJobShotsForScene(admin, claimed.scene_id, id, claimed.id);

        let sceneResult: any = { scene_id: claimed.scene_id, status: "failed", shots_inserted: 0, error: null };

        try {
          const result = await generateShotsForScene(
            authToken, job.project_id, claimed.scene_id, job.mode,
            { shot_plan_job_id: id, shot_plan_job_scene_id: claimed.id },
          );
          const shotCount = result.shots?.length || 0;

          // Tag inserted shots with job IDs (best-effort if dev-engine-v2 didn't)
          if (result.shots?.length > 0) {
            const shotIds = result.shots.map((s: any) => s.id).filter(Boolean);
            if (shotIds.length > 0) {
              await admin.from("scene_shots").update({
                shot_plan_job_id: id,
                shot_plan_job_scene_id: claimed.id,
                shot_plan_source: "ai_shot_plan",
              }).in("id", shotIds);
            }
          }

          // Mark scene complete
          await admin.from("shot_plan_job_scenes").update({
            status: "complete",
            inserted_shots: shotCount,
            error_message: null,
            finished_at: new Date().toISOString(),
          }).eq("id", claimed.id);

          // Update job counters from fresh counts
          const freshCounts = await getJobCounts(admin, id);
          await admin.from("shot_plan_jobs").update({
            completed_scenes: freshCounts.complete,
            inserted_shots: (job.inserted_shots || 0) + shotCount,
            last_message: `Completed scene ${claimed.scene_order + 1}/${job.total_scenes} (${shotCount} shots)`,
            last_error: null,
          }).eq("id", id);

          sceneResult = { scene_id: claimed.scene_id, status: "complete", shots_inserted: shotCount, error: null };
        } catch (err: any) {
          const errMsg = err?.message || "Unknown error";
          console.error(`Shot gen failed for scene ${claimed.scene_id} (attempt ${claimed.attempts}):`, errMsg);

          // Retry logic: if under max attempts, set back to pending; else mark failed
          const newStatus = (claimed.attempts || 0) >= MAX_ATTEMPTS ? "failed" : "pending";
          await admin.from("shot_plan_job_scenes").update({
            status: newStatus,
            error_message: errMsg,
            finished_at: newStatus === "failed" ? new Date().toISOString() : null,
          }).eq("id", claimed.id);

          await admin.from("shot_plan_jobs").update({
            last_error: errMsg,
            last_message: newStatus === "failed"
              ? `Scene ${claimed.scene_order + 1} failed permanently after ${claimed.attempts} attempts`
              : `Scene ${claimed.scene_order + 1} failed (attempt ${claimed.attempts}/${MAX_ATTEMPTS}), will retry`,
          }).eq("id", id);

          sceneResult = { scene_id: claimed.scene_id, status: newStatus, shots_inserted: 0, error: errMsg };
        }

        // Re-fetch job and counts
        const { data: updatedJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
        const counts = await getJobCounts(admin, id);

        // Auto-complete if no more pending/running
        if (counts.pending === 0 && counts.running === 0) {
          await admin.from("shot_plan_jobs").update({
            status: "complete",
            finished_at: new Date().toISOString(),
            last_message: `Complete: ${updatedJob?.inserted_shots || 0} shots`,
            current_scene_id: null,
          }).eq("id", id);
          const { data: finalJob } = await admin.from("shot_plan_jobs").select("*").eq("id", id).single();
          return json({ job: finalJob, counts: { ...counts, pending: 0, running: 0 }, sceneResult, message: "Job complete" });
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
