/**
 * devseed-orchestrator — Edge function for DevSeed backfill pipeline.
 *
 * Actions:
 *   - status: get current job state + items for a pitch idea / project
 *   - enqueue_backfill: create a devseed_job + items for backfill
 *   - tick: claim + process next item(s) — with foundation gate
 *   - pause / resume
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// DevSeed 5 doc types — the foundation set
const FOUNDATION_DOC_TYPES = ["idea", "concept_brief", "treatment", "character_bible", "market_sheet"];

// Development doc types per lane
const DEV_DOCS_SERIES = ["season_arc", "episode_grid"];
const DEV_DOCS_FEATURE = ["story_outline", "beat_sheet"];

function getDevDocItems(lane: string, episodeCount: number | null): Array<{ item_key: string; doc_type: string; episode_index: number | null }> {
  if (lane === "vertical_drama" || lane === "vertical-drama" || lane === "series") {
    const items: Array<{ item_key: string; doc_type: string; episode_index: number | null }> = [];
    for (const dt of DEV_DOCS_SERIES) {
      items.push({ item_key: dt, doc_type: dt, episode_index: null });
    }
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

/**
 * Check if all foundation items are complete (not failed/queued/running).
 * Returns { allApproved, failed[], incomplete[] }
 */
async function checkFoundationGate(sb: any, jobId: string) {
  const { data: foundationItems } = await sb
    .from("devseed_job_items")
    .select("id, item_key, doc_type, status, gate_score, gate_failures, output_doc_id, output_version_id")
    .eq("job_id", jobId)
    .eq("phase", "foundation");

  if (!foundationItems || foundationItems.length === 0) {
    return { allApproved: true, failed: [], incomplete: [] };
  }

  const failed = foundationItems.filter((i: any) => i.status === "failed");
  const incomplete = foundationItems.filter((i: any) => !["complete", "failed"].includes(i.status));
  const withGateFailures = foundationItems.filter((i: any) => i.status === "complete" && i.gate_failures?.length > 0);

  // Foundation gate: all must be complete with no gate failures
  const allApproved = failed.length === 0 && incomplete.length === 0 && withGateFailures.length === 0;

  return {
    allApproved,
    failed: [...failed, ...withGateFailures].map((i: any) => ({
      item_key: i.item_key,
      doc_type: i.doc_type,
      status: i.status,
      gate_failures: i.gate_failures,
      output_doc_id: i.output_doc_id,
      output_version_id: i.output_version_id,
    })),
    incomplete: incomplete.map((i: any) => ({
      item_key: i.item_key,
      doc_type: i.doc_type,
      status: i.status,
    })),
  };
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");

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
        .in("status", ["queued", "running", "paused", "paused_blocked"])
        .limit(1);

      if (existing && existing.length > 0) {
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

      // Build item list with phase tags
      const items: Array<{ item_key: string; doc_type: string; episode_index: number | null; phase: string }> = [];

      // Foundation items (DevSeed 5)
      for (const dt of FOUNDATION_DOC_TYPES) {
        items.push({ item_key: dt, doc_type: dt, episode_index: null, phase: "foundation" });
      }

      // Dev pack items
      if (includeDevPack) {
        const devItems = getDevDocItems(lane || "feature", episodeCount);
        for (const di of devItems) {
          items.push({ ...di, phase: "devpack" });
        }
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

      // Insert items with phase
      const itemRows = items.map(item => ({
        job_id: job.id,
        item_key: item.item_key,
        doc_type: item.doc_type,
        episode_index: item.episode_index,
        phase: item.phase,
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

      const { data: job } = await sb.from("devseed_jobs").select("*").eq("id", jobId).single();
      if (!job) throw new Error("Job not found");
      if (job.created_by !== user.id) throw new Error("Not authorized");
      if (!["running"].includes(job.status)) {
        return new Response(JSON.stringify({ done: job.status === "complete", job }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── FOUNDATION GATE: before claiming, check if we're about to enter devpack phase ──
      // Are there any queued foundation items left?
      const { data: queuedFoundation } = await sb
        .from("devseed_job_items")
        .select("id")
        .eq("job_id", jobId)
        .eq("phase", "foundation")
        .in("status", ["queued", "claimed", "running"])
        .limit(1);

      const foundationStillProcessing = queuedFoundation && queuedFoundation.length > 0;

      // If foundation is done processing, check gate before allowing devpack
      if (!foundationStillProcessing) {
        const { data: devpackQueued } = await sb
          .from("devseed_job_items")
          .select("id")
          .eq("job_id", jobId)
          .eq("phase", "devpack")
          .eq("status", "queued")
          .limit(1);

        const hasDevpackWork = devpackQueued && devpackQueued.length > 0;

        if (hasDevpackWork) {
          const gate = await checkFoundationGate(sb, jobId);
          if (!gate.allApproved) {
            // PAUSE with blockers — do NOT proceed to devpack
            const blockers = [
              ...gate.failed.map((f: any) => ({
                type: "foundation_gate_failed",
                doc_type: f.doc_type,
                item_key: f.item_key,
                gate_failures: f.gate_failures,
                output_doc_id: f.output_doc_id,
                output_version_id: f.output_version_id,
              })),
              ...gate.incomplete.map((i: any) => ({
                type: "foundation_incomplete",
                doc_type: i.doc_type,
                item_key: i.item_key,
                status: i.status,
              })),
            ];

            await sb.from("devseed_jobs").update({
              status: "paused_blocked",
              progress_json: {
                ...job.progress_json,
                current_step: null,
                blockers,
                last_error: "Foundation docs must be approved before dev pack can proceed",
              },
            }).eq("id", jobId);

            const { data: allItems } = await sb
              .from("devseed_job_items")
              .select("*")
              .eq("job_id", jobId)
              .order("episode_index", { ascending: true, nullsFirst: true })
              .order("item_key", { ascending: true });

            return new Response(JSON.stringify({
              done: false,
              blocked: true,
              blockers,
              items: allItems,
              job: { ...job, status: "paused_blocked" },
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }

      // Claim next item (RPC respects phase ordering: foundation first)
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
            progress_json: { ...job.progress_json, current_step: null, blockers: [] },
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
        progress_json: { ...job.progress_json, current_step: item.item_key, blockers: [] },
      }).eq("id", jobId);

      // Mark running
      await sb.from("devseed_job_items").update({ status: "running" }).eq("id", item.id);

      try {
        // Process item
        const { data: existingDoc } = await sb
          .from("project_documents")
          .select("id")
          .eq("project_id", job.project_id)
          .eq("doc_type", item.doc_type)
          .limit(1);

        let outputDocId = existingDoc?.[0]?.id || null;
        let outputVersionId: string | null = null;

        if (outputDocId) {
          const { data: currentVer } = await sb
            .from("project_document_versions")
            .select("id, version_number, plaintext")
            .eq("document_id", outputDocId)
            .eq("is_current", true)
            .limit(1)
            .single();

          outputVersionId = currentVer?.id || null;

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

                // For foundation items: if there are blocking issues, mark as FAILED
                if (item.phase === "foundation" && failures.length > 0) {
                  await sb.from("devseed_job_items").update({
                    status: "failed",
                    output_doc_id: outputDocId,
                    output_version_id: outputVersionId,
                    gate_score: ci,
                    gate_failures: failures,
                    error_code: "gate_failed",
                    error_detail: `Foundation gate failed: ${failures.join(", ")}`,
                  }).eq("id", item.id);

                  // Immediately pause the job — do not continue
                  await sb.from("devseed_jobs").update({
                    status: "paused_blocked",
                    progress_json: {
                      ...job.progress_json,
                      current_step: null,
                      blockers: [{
                        type: "foundation_gate_failed",
                        doc_type: item.doc_type,
                        item_key: item.item_key,
                        gate_failures: failures,
                        output_doc_id: outputDocId,
                        output_version_id: outputVersionId,
                      }],
                      last_error: `Foundation doc "${item.doc_type}" failed gate: ${failures[0]}`,
                    },
                  }).eq("id", jobId);
                } else {
                  await sb.from("devseed_job_items").update({
                    status: "complete",
                    output_doc_id: outputDocId,
                    output_version_id: outputVersionId,
                    gate_score: ci,
                    gate_failures: failures.length > 0 ? failures : null,
                  }).eq("id", item.id);
                }
              } else {
                await sb.from("devseed_job_items").update({
                  status: "complete",
                  output_doc_id: outputDocId,
                  output_version_id: outputVersionId,
                }).eq("id", item.id);
              }
            } catch {
              await sb.from("devseed_job_items").update({
                status: "complete",
                output_doc_id: outputDocId,
                output_version_id: outputVersionId,
              }).eq("id", item.id);
            }
          } else {
            // Content too short — for foundation, this is a failure
            if (item.phase === "foundation") {
              await sb.from("devseed_job_items").update({
                status: "failed",
                output_doc_id: outputDocId,
                output_version_id: outputVersionId,
                gate_failures: ["content_too_short"],
                error_code: "content_too_short",
                error_detail: "Document content is too short for gate assessment",
              }).eq("id", item.id);

              await sb.from("devseed_jobs").update({
                status: "paused_blocked",
                progress_json: {
                  ...job.progress_json,
                  current_step: null,
                  blockers: [{
                    type: "foundation_gate_failed",
                    doc_type: item.doc_type,
                    item_key: item.item_key,
                    gate_failures: ["content_too_short"],
                    output_doc_id: outputDocId,
                    output_version_id: outputVersionId,
                  }],
                  last_error: `Foundation doc "${item.doc_type}" content too short`,
                },
              }).eq("id", jobId);
            } else {
              await sb.from("devseed_job_items").update({
                status: "complete",
                output_doc_id: outputDocId,
                output_version_id: outputVersionId,
                gate_failures: ["content_too_short"],
              }).eq("id", item.id);
            }
          }
        } else {
          // Doc doesn't exist — foundation docs MUST exist
          if (item.phase === "foundation") {
            await sb.from("devseed_job_items").update({
              status: "failed",
              error_code: "doc_not_found",
              error_detail: `Foundation doc "${item.doc_type}" not found in project`,
            }).eq("id", item.id);

            await sb.from("devseed_jobs").update({
              status: "paused_blocked",
              progress_json: {
                ...job.progress_json,
                current_step: null,
                blockers: [{
                  type: "foundation_gate_failed",
                  doc_type: item.doc_type,
                  item_key: item.item_key,
                  gate_failures: ["doc_not_found"],
                }],
                last_error: `Foundation doc "${item.doc_type}" does not exist`,
              },
            }).eq("id", jobId);
          } else {
            await sb.from("devseed_job_items").update({
              status: "complete",
              error_code: "doc_not_found",
              error_detail: `No document found for ${item.doc_type}`,
            }).eq("id", item.id);
          }
        }
      } catch (err: any) {
        await sb.from("devseed_job_items").update({
          status: "failed",
          error_code: "processing_error",
          error_detail: err.message,
        }).eq("id", item.id);

        // If foundation item, pause job
        if (item.phase === "foundation") {
          await sb.from("devseed_jobs").update({
            status: "paused_blocked",
            progress_json: {
              ...job.progress_json,
              current_step: null,
              blockers: [{
                type: "foundation_gate_failed",
                doc_type: item.doc_type,
                item_key: item.item_key,
                gate_failures: ["processing_error"],
              }],
              last_error: err.message,
            },
          }).eq("id", jobId);
        }
      }

      // Update progress count
      const { count: doneCount } = await sb
        .from("devseed_job_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId)
        .in("status", ["complete", "failed"]);

      // Re-read job status (may have been paused by foundation failure above)
      const { data: updatedJob } = await sb.from("devseed_jobs").select("status, progress_json").eq("id", jobId).single();
      const currentStatus = updatedJob?.status || job.status;
      const currentProgress = updatedJob?.progress_json || job.progress_json;

      if (currentStatus === "running") {
        await sb.from("devseed_jobs").update({
          progress_json: { ...currentProgress, done_items: doneCount || 0 },
        }).eq("id", jobId);

        // Check if all items are done
        const { data: pendingItems } = await sb
          .from("devseed_job_items")
          .select("id")
          .eq("job_id", jobId)
          .in("status", ["queued", "claimed", "running"])
          .limit(1);

        if (!pendingItems || pendingItems.length === 0) {
          await sb.from("devseed_jobs").update({ status: "complete" }).eq("id", jobId);
        }
      } else {
        // Job was paused by foundation gate — just update done_items
        await sb.from("devseed_jobs").update({
          progress_json: { ...currentProgress, done_items: doneCount || 0 },
        }).eq("id", jobId);
      }

      // Fetch updated items
      const { data: allItems } = await sb
        .from("devseed_job_items")
        .select("*")
        .eq("job_id", jobId)
        .order("episode_index", { ascending: true, nullsFirst: true })
        .order("item_key", { ascending: true });

      const { data: finalJob } = await sb.from("devseed_jobs").select("*").eq("id", jobId).single();

      return new Response(JSON.stringify({
        done: finalJob?.status === "complete",
        blocked: finalJob?.status === "paused_blocked",
        processed_item: item.item_key,
        items: allItems,
        job: finalJob,
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
      // Reset failed foundation items to queued for retry
      await sb.from("devseed_job_items")
        .update({ status: "queued", error_code: null, error_detail: null, gate_failures: null })
        .eq("job_id", jobId)
        .eq("status", "failed")
        .eq("phase", "foundation");

      await sb.from("devseed_jobs").update({
        status: "running",
        progress_json: sb.rpc ? undefined : undefined, // handled below
      }).eq("id", jobId).eq("created_by", user.id);

      // Clear blockers in progress_json
      const { data: currentJob } = await sb.from("devseed_jobs").select("progress_json").eq("id", jobId).single();
      if (currentJob) {
        await sb.from("devseed_jobs").update({
          progress_json: { ...currentJob.progress_json, blockers: [], last_error: null },
        }).eq("id", jobId);
      }

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
