import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { project_id, document_id, settings_json, action, demo_run_id } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: poll — return current state
    if (action === "poll" && demo_run_id) {
      const { data, error } = await supabase
        .from("demo_runs")
        .select("*")
        .eq("id", demo_run_id)
        .single();
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: advance — advance one step
    if (action === "advance" && demo_run_id) {
      return await advanceStep(supabase, demo_run_id, project_id);
    }

    // Default: create new demo run
    const lane = settings_json?.lane || "feature_film";
    const settings = settings_json || {};

    // Idempotency check: look for existing running/complete run with same settings
    const settingsStr = JSON.stringify({ project_id, document_id, settings });
    let hash = 0x811c9dc5;
    for (let i = 0; i < settingsStr.length; i++) {
      hash ^= settingsStr.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const settingsHash = (hash >>> 0).toString(16);

    if (!body.force_new) {
      const { data: existing } = await supabase
        .from("demo_runs")
        .select("id, status, step")
        .eq("project_id", project_id)
        .in("status", ["running", "complete"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({
          demo_run_id: existing[0].id,
          status: existing[0].status,
          step: existing[0].step,
          reused: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create new demo run
    const { data: run, error: insertErr } = await supabase
      .from("demo_runs")
      .insert({
        project_id,
        document_id: document_id || null,
        lane,
        status: "running",
        step: "cik",
        settings_json: { ...settings, _hash: settingsHash },
        links_json: {},
        log_json: [{ step: "cik", action: "created", ts: new Date().toISOString() }],
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({
      demo_run_id: run.id,
      status: "running",
      step: "cik",
      reused: false,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

const STEP_ORDER = ["cik", "video_plan", "render_job", "rough_cut", "feedback", "complete"];
const MAX_STEP_RETRIES = 2;

async function advanceStep(supabase: any, demoRunId: string, projectId: string) {
  const { data: run, error: fetchErr } = await supabase
    .from("demo_runs")
    .select("*")
    .eq("id", demoRunId)
    .single();

  if (fetchErr) throw fetchErr;
  if (run.status === "complete" || run.status === "error" || run.status === "canceled") {
    return new Response(JSON.stringify({ status: run.status, step: run.step, message: "Run already terminal" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const currentIdx = STEP_ORDER.indexOf(run.step);
  if (currentIdx === -1) throw new Error("Invalid step: " + run.step);

  const nextStepName = currentIdx < STEP_ORDER.length - 1 ? STEP_ORDER[currentIdx + 1] : null;
  const log = Array.isArray(run.log_json) ? [...run.log_json] : [];
  const links = run.links_json || {};

  try {
    // Simulate step completion — each step would normally invoke its respective function
    // For the demo orchestrator, we record the transition and let the frontend poll sub-systems
    log.push({ step: run.step, action: "completed", ts: new Date().toISOString() });

    if (!nextStepName || nextStepName === "complete") {
      // Pipeline complete
      log.push({ step: "complete", action: "pipeline_complete", ts: new Date().toISOString() });
      await supabase
        .from("demo_runs")
        .update({
          status: "complete",
          step: "complete",
          log_json: log,
          links_json: links,
          updated_at: new Date().toISOString(),
        })
        .eq("id", demoRunId);

      return new Response(JSON.stringify({ status: "complete", step: "complete" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Advance to next step
    log.push({ step: nextStepName, action: "started", ts: new Date().toISOString() });
    await supabase
      .from("demo_runs")
      .update({
        step: nextStepName,
        log_json: log,
        links_json: links,
        updated_at: new Date().toISOString(),
      })
      .eq("id", demoRunId);

    return new Response(JSON.stringify({ status: "running", step: nextStepName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (stepErr: any) {
    log.push({ step: run.step, action: "error", ts: new Date().toISOString(), detail: stepErr.message });
    await supabase
      .from("demo_runs")
      .update({
        status: "error",
        last_error: stepErr.message,
        log_json: log,
        updated_at: new Date().toISOString(),
      })
      .eq("id", demoRunId);

    return new Response(JSON.stringify({ status: "error", step: run.step, error: stepErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
