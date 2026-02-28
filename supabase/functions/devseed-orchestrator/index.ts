/**
 * devseed-orchestrator — Edge function for DevSeed backfill pipeline.
 *
 * Actions:
 *   - status: get current job state + items for a pitch idea / project
 *   - enqueue_backfill: create a devseed_job + items for backfill
 *   - tick: claim + process next item(s)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// DevSeed 5 doc types that get backfilled (quality pass)
const DEVSEED_DOC_TYPES = ["idea", "concept_brief", "treatment", "character_bible", "market_sheet"];

// Development doc types per lane
const DEV_DOCS_SERIES = ["season_arc", "episode_grid"];
const DEV_DOCS_FEATURE = ["story_outline", "beat_sheet"];

function getDevDocItems(lane: string, episodeCount: number | null): Array<{ item_key: string; doc_type: string; episode_index: number | null }> {
  if (lane === "vertical_drama" || lane === "vertical-drama" || lane === "series") {
    const items: Array<{ item_key: string; doc_type: string; episode_index: number | null }> = [];
    for (const dt of DEV_DOCS_SERIES) {
      items.push({ item_key: dt, doc_type: dt, episode_index: null });
    }
    // Per-episode beats + scripts if episode count is locked
    if (episodeCount && episodeCount > 0) {
      for (let i = 1; i <= episodeCount; i++) {
        items.push({ item_key: `vertical_episode_beats:E${String(i).padStart(2, "0")}`, doc_type: "vertical_episode_beats", episode_index: i });
        items.push({ item_key: `episode_script:E${String(i).padStart(2, "0")}`, doc_type: "episode_script", episode_index: i });
      }
      items.push({ item_key: "season_master_script", doc_type: "season_master_script", episode_index: null });
    }
    return items;
  }
  if (lane === "feature" || lane === "independent-film" || lane === "studio-film") {
    return DEV_DOCS_FEATURE.map(dt => ({ item_key: dt, doc_type: dt, episode_index: null }));
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // User client for auth
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Service client for DB operations
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action } = body;

    // ── STATUS ──
    if (action === "status") {
      const { pitchIdeaId, projectId, jobId } = body;
      let query = sb.from("devseed_jobs").select("*").eq("created_by", user.id);
      if (jobId) query = query.eq("id", jobId);
      else if (projectId) query = query.eq("project_id", projectId);
      else if (pitchIdeaId) query = query.eq("pitch_idea_id", pitchIdeaId);
      else throw new Error("Provide jobId, projectId, or pitchIdeaId");

      query = query.order("created_at", { ascending: false }).limit(1);
      const { data: jobs } = await query;
      const job = jobs?.[0] || null;

      let items: any[] = [];
      if (job) {
        const { data } = await sb
          .from("devseed_job_items")
          .select("*")
          .eq("job_id", job.id)
          .order("episode_index", { ascending: true, nullsFirst: true })
          .order("item_key", { ascending: true });
        items = data || [];
      }

      return new Response(JSON.stringify({ job, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ENQUEUE BACKFILL ──
    if (action === "enqueue_backfill") {
      const { pitchIdeaId, projectId, lane, includeDevPack } = body;
      if (!pitchIdeaId || !projectId) throw new Error("pitchIdeaId and projectId required");

      // Check for existing active job
      const { data: existing } = await sb
        .from("devseed_jobs")
        .select("id, status")
        .eq("project_id", projectId)
        .in("status", ["queued", "running", "paused"])
        .limit(1);

      if (existing && existing.length > 0) {
        // Return existing job
        return new Response(JSON.stringify({ job_id: existing[0].id, resumed: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get episode count for dev pack
      let episodeCount: number | null = null;
      if (includeDevPack) {
        const { data: proj } = await sb.from("projects").select("season_episode_count, season_episode_count_locked, assigned_lane").eq("id", projectId).single();
        if (proj?.assigned_lane && ["vertical_drama", "vertical-drama", "series"].includes(proj.assigned_lane)) {
          if (!proj.season_episode_count_locked || !proj.season_episode_count) {
            return new Response(JSON.stringify({
              error: "Episode count must be locked before backfilling development pack for series/vertical projects",
              blocker: "episode_count_not_locked",
            }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          episodeCount = proj.season_episode_count;
        }
      }

      // Build item list
      const items: Array<{ item_key: string; doc_type: string; episode_index: number | null }> = [];

      // DevSeed 5 quality pass
      for (const dt of DEVSEED_DOC_TYPES) {
        items.push({ item_key: dt, doc_type: dt, episode_index: null });
      }

      // Dev pack items
      if (includeDevPack) {
        const devItems = getDevDocItems(lane || "feature", episodeCount);
        items.push(...devItems);
      }

      // Create job
      const { data: job, error: jobErr } = await sb
        .from("devseed_jobs")
        .insert({
          pitch_idea_id: pitchIdeaId,
          project_id: projectId,
          lane: lane || "feature",
          mode: "backfill",
          status: "queued",
          include_dev_pack: !!includeDevPack,
          created_by: user.id,
          progress_json: { total_items: items.length, done_items: 0, current_step: null, blockers: [], last_error: null },
        })
        .select("id")
        .single();

      if (jobErr) throw new Error(`Failed to create job: ${jobErr.message}`);

      // Insert items
      const itemRows = items.map(item => ({
        job_id: job.id,
        item_key: item.item_key,
        doc_type: item.doc_type,
        episode_index: item.episode_index,
        status: "queued",
      }));

      const { error: itemErr } = await sb.from("devseed_job_items").insert(itemRows);
      if (itemErr) throw new Error(`Failed to insert items: ${itemErr.message}`);

      // Set job to running
      await sb.from("devseed_jobs").update({ status: "running" }).eq("id", job.id);

      return new Response(JSON.stringify({ job_id: job.id, total_items: items.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── TICK ──
    if (action === "tick") {
      const { jobId } = body;
      if (!jobId) throw new Error("jobId required");

      // Verify job ownership
      const { data: job } = await sb.from("devseed_jobs").select("*").eq("id", jobId).single();
      if (!job) throw new Error("Job not found");
      if (job.created_by !== user.id) throw new Error("Not authorized");
      if (job.status !== "running") {
        return new Response(JSON.stringify({ done: job.status === "complete", job }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Claim next item
      const { data: claimed } = await sb.rpc("claim_next_devseed_items", {
        p_job_id: jobId,
        p_limit: 1,
        p_claimed_by: "tick",
      });

      if (!claimed || claimed.length === 0) {
        // Check if all done
        const { data: remaining } = await sb
          .from("devseed_job_items")
          .select("id")
          .eq("job_id", jobId)
          .in("status", ["queued", "claimed", "running"])
          .limit(1);

        if (!remaining || remaining.length === 0) {
          await sb.from("devseed_jobs").update({
            status: "complete",
            progress_json: { ...job.progress_json, current_step: null },
          }).eq("id", jobId);

          return new Response(JSON.stringify({ done: true, job: { ...job, status: "complete" } }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ done: false, waiting: true, job }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const item = claimed[0];

      // Update progress
      await sb.from("devseed_jobs").update({
        progress_json: { ...job.progress_json, current_step: item.item_key },
      }).eq("id", jobId);

      // Mark running
      await sb.from("devseed_job_items").update({ status: "running" }).eq("id", item.id);

      try {
        // Process item: call dev-engine-v2 analyze for quality assessment
        // For now, just check if the doc exists and mark complete
        const { data: existingDoc } = await sb
          .from("project_documents")
          .select("id")
          .eq("project_id", job.project_id)
          .eq("doc_type", item.doc_type)
          .limit(1);

        let outputDocId = existingDoc?.[0]?.id || null;
        let outputVersionId: string | null = null;

        if (outputDocId) {
          // Get current version
          const { data: currentVer } = await sb
            .from("project_document_versions")
            .select("id, version_number, plaintext")
            .eq("document_id", outputDocId)
            .eq("is_current", true)
            .limit(1)
            .single();

          outputVersionId = currentVer?.id || null;

          // Run quality gate via dev-engine-v2 analyze
          if (currentVer?.plaintext && currentVer.plaintext.length > 100) {
            try {
              const analyzeResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceKey}`,
                },
                body: JSON.stringify({
                  action: "analyze",
                  projectId: job.project_id,
                  documentId: outputDocId,
                  versionId: currentVer.id,
                }),
              });

              if (analyzeResp.ok) {
                const analyzeData = await analyzeResp.json();
                const ci = analyzeData?.ci_score || analyzeData?.scores?.ci || null;
                const failures = analyzeData?.blocking_issues?.map((b: any) => b.title || b.summary || "blocker") || [];

                await sb.from("devseed_job_items").update({
                  status: "complete",
                  output_doc_id: outputDocId,
                  output_version_id: outputVersionId,
                  gate_score: ci,
                  gate_failures: failures.length > 0 ? failures : null,
                }).eq("id", item.id);
              } else {
                // Analyze failed but doc exists — mark complete anyway
                await sb.from("devseed_job_items").update({
                  status: "complete",
                  output_doc_id: outputDocId,
                  output_version_id: outputVersionId,
                }).eq("id", item.id);
              }
            } catch {
              // Non-fatal: mark complete with doc reference
              await sb.from("devseed_job_items").update({
                status: "complete",
                output_doc_id: outputDocId,
                output_version_id: outputVersionId,
              }).eq("id", item.id);
            }
          } else {
            // Doc exists but content too short — mark complete, needs manual work
            await sb.from("devseed_job_items").update({
              status: "complete",
              output_doc_id: outputDocId,
              output_version_id: outputVersionId,
              gate_failures: ["content_too_short"],
            }).eq("id", item.id);
          }
        } else {
          // Doc doesn't exist yet — mark complete (placeholder for future generation)
          await sb.from("devseed_job_items").update({
            status: "complete",
            error_code: "doc_not_found",
            error_detail: `No document found for ${item.doc_type}`,
          }).eq("id", item.id);
        }
      } catch (err: any) {
        await sb.from("devseed_job_items").update({
          status: "failed",
          error_code: "processing_error",
          error_detail: err.message,
        }).eq("id", item.id);
      }

      // Update progress count
      const { data: doneCount } = await sb
        .from("devseed_job_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId)
        .in("status", ["complete", "failed"]);

      const doneItems = (doneCount as any)?.length || 0;
      await sb.from("devseed_jobs").update({
        progress_json: { ...job.progress_json, done_items: doneItems, current_step: null },
      }).eq("id", jobId);

      // Check if all items are done
      const { data: pendingItems } = await sb
        .from("devseed_job_items")
        .select("id")
        .eq("job_id", jobId)
        .in("status", ["queued", "claimed", "running"])
        .limit(1);

      const allDone = !pendingItems || pendingItems.length === 0;
      if (allDone) {
        await sb.from("devseed_jobs").update({ status: "complete" }).eq("id", jobId);
      }

      // Fetch updated items
      const { data: allItems } = await sb
        .from("devseed_job_items")
        .select("*")
        .eq("job_id", jobId)
        .order("episode_index", { ascending: true, nullsFirst: true })
        .order("item_key", { ascending: true });

      return new Response(JSON.stringify({
        done: allDone,
        processed_item: item.item_key,
        items: allItems,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PAUSE ──
    if (action === "pause") {
      const { jobId } = body;
      await sb.from("devseed_jobs").update({ status: "paused" }).eq("id", jobId).eq("created_by", user.id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── RESUME ──
    if (action === "resume") {
      const { jobId } = body;
      await sb.from("devseed_jobs").update({ status: "running" }).eq("id", jobId).eq("created_by", user.id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
