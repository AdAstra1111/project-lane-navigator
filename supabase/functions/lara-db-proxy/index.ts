/**
 * lara-db-proxy — Secure DB proxy for Lara Lane (OpenClaw assistant)
 * 
 * Allows the AI assistant to read and write IFFY database tables
 * using the service role key (bypassing RLS), authenticated via a shared secret.
 * 
 * Auth: Request must include header X-Lara-Secret matching env LARA_PROXY_SECRET.
 * All operations are pre-defined — no raw SQL passthrough.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lara-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const secret = req.headers.get("x-lara-secret");
    const expectedSecret = Deno.env.get("LARA_PROXY_SECRET") || "lara-ph-iffy-2026-9kPxMw";
    if (secret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Supabase client with service role key ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { op, params } = body;

    let result: any;

    switch (op) {

      // ── READ: Get active auto_run_job for a project ──
      case "get_active_job": {
        const { project_id } = params;
        const { data, error } = await supabase
          .from("auto_run_jobs")
          .select("id, status, current_document, step_count, last_ci, last_gp, stop_reason, pause_reason, follow_latest, converge_target_json, stage_loop_count, created_at, updated_at")
          .eq("project_id", project_id)
          .in("status", ["running", "paused", "stopped", "queued", "completed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        result = data;
        break;
      }

      // ── READ: Get recent auto_run_steps for a job ──
      case "get_job_steps": {
        const { job_id, limit = 20, doc_type } = params;
        let q = supabase
          .from("auto_run_steps")
          .select("id, step_index, document, action, ci, gp, gap, message, created_at")
          .eq("job_id", job_id)
          .order("step_index", { ascending: false })
          .limit(limit);
        if (doc_type) q = q.eq("document", doc_type);
        const { data, error } = await q;
        if (error) throw error;
        result = data;
        break;
      }

      // ── READ: Get versions for a doc type ──
      case "get_versions": {
        const { project_id, doc_type, limit = 10 } = params;
        const { data: doc, error: docErr } = await supabase
          .from("project_documents")
          .select("id")
          .eq("project_id", project_id)
          .eq("doc_type", doc_type)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (docErr) throw docErr;
        if (!doc) { result = []; break; }
        const { data, error } = await supabase
          .from("project_document_versions")
          .select("id, version_number, approval_status, is_current, meta_json, created_at")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false })
          .limit(limit);
        if (error) throw error;
        result = data;
        break;
      }

      // ── READ: Get project summary ──
      case "get_project": {
        const { project_id } = params;
        const { data, error } = await supabase
          .from("projects")
          .select("id, title, format, created_at, updated_at")
          .eq("id", project_id)
          .maybeSingle();
        if (error) throw error;
        result = data;
        break;
      }

      // ── WRITE: Update job current_document and/or status ──
      case "update_job": {
        const { job_id, patch } = params;
        const ALLOWED_FIELDS = ["current_document", "status", "stage_loop_count", "follow_latest", "converge_target_json", "pause_reason", "stop_reason"];
        const safePatch: Record<string, any> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (ALLOWED_FIELDS.includes(k)) safePatch[k] = v;
        }
        if (Object.keys(safePatch).length === 0) throw new Error("No valid fields to update");
        const { data, error } = await supabase
          .from("auto_run_jobs")
          .update(safePatch)
          .eq("id", job_id)
          .select("id, status, current_document, stage_loop_count")
          .maybeSingle();
        if (error) throw error;
        result = data;
        break;
      }

      // ── WRITE: Set meta_json.ci and .gp on a specific version ──
      case "set_version_scores": {
        const { version_id, ci, gp } = params;
        const { data, error } = await supabase.rpc("jsonb_set_ci_gp", { version_id, ci_val: ci, gp_val: gp }).maybeSingle()
          .catch(() => ({ data: null, error: { message: "rpc not found, using update" } }));
        
        // Fallback to direct update
        const { data: updData, error: updErr } = await supabase
          .from("project_document_versions")
          .update({
            meta_json: supabase.rpc ? undefined : null, // handled below
          })
          .eq("id", version_id);

        // Use jsonb_set via raw update
        const { data: rawData, error: rawErr } = await supabase
          .from("project_document_versions")
          .update({ meta_json: { ci, gp } })
          .eq("id", version_id)
          .select("id, version_number, meta_json, approval_status")
          .maybeSingle();
        if (rawErr) throw rawErr;
        result = rawData;
        break;
      }

      // ── WRITE: Set version scores via JSONB merge ──
      case "patch_version_meta": {
        const { version_id, meta_patch } = params;
        const ALLOWED_META = ["ci", "gp", "gap", "score_source"];
        const safeMeta: Record<string, any> = {};
        for (const [k, v] of Object.entries(meta_patch)) {
          if (ALLOWED_META.includes(k)) safeMeta[k] = v;
        }
        // Get current meta_json first, then merge
        const { data: current, error: fetchErr } = await supabase
          .from("project_document_versions")
          .select("meta_json")
          .eq("id", version_id)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        const merged = { ...(current?.meta_json ?? {}), ...safeMeta };
        const { data, error } = await supabase
          .from("project_document_versions")
          .update({ meta_json: merged })
          .eq("id", version_id)
          .select("id, version_number, meta_json, approval_status")
          .maybeSingle();
        if (error) throw error;
        result = data;
        break;
      }

      // ── WRITE: Approve a version and write scores ──
      case "approve_version": {
        const { version_id, ci, gp } = params;
        const { data: current, error: fetchErr } = await supabase
          .from("project_document_versions")
          .select("meta_json")
          .eq("id", version_id)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        const merged = { ...(current?.meta_json ?? {}), ci, gp, score_source: "lara_proxy_approve" };
        const { data, error } = await supabase
          .from("project_document_versions")
          .update({ approval_status: "approved", is_current: true, meta_json: merged })
          .eq("id", version_id)
          .select("id, version_number, approval_status, is_current, meta_json")
          .maybeSingle();
        if (error) throw error;
        result = data;
        break;
      }

      // ── READ: List all projects for a company/user ──
      case "list_projects": {
        const { limit = 20 } = params;
        const { data, error } = await supabase
          .from("projects")
          .select("id, title, format, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (error) throw error;
        result = data;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown op: ${op}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ ok: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[lara-db-proxy] error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
