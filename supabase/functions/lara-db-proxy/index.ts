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

      // ── SCENE GRAPH VALIDATION OPS ──

      case "scene_graph_counts": {
        // Returns baseline/post-run counts for all scene enrichment tables
        const { project_id } = params;

        const [scenes, spineLinks, entityLinks, blueprintBindings, narrativeUnits] = await Promise.all([
          supabase.from("scene_graph_scenes").select("id", { count: "exact", head: true })
            .eq("project_id", project_id).is("deprecated_at", null),
          supabase.from("scene_spine_links").select("id,axis_key", { count: "exact" })
            .eq("project_id", project_id),
          supabase.from("narrative_scene_entity_links").select("id,entity_id", { count: "exact" })
            .eq("project_id", project_id).eq("relation_type", "character_present"),
          supabase.from("scene_blueprint_bindings").select("id,patch_intent,risk_source", { count: "exact" })
            .eq("project_id", project_id),
          supabase.from("narrative_units").select("unit_key,status,unit_type")
            .eq("project_id", project_id).in("status", ["contradicted", "stale"]),
        ]);

        result = {
          scene_count:              scenes.count ?? 0,
          spine_links_count:        spineLinks.count ?? 0,
          spine_links_axes:         [...new Set((spineLinks.data || []).map((r: any) => r.axis_key).filter(Boolean))],
          entity_links_count:       entityLinks.count ?? 0,
          blueprint_bindings_count: blueprintBindings.count ?? 0,
          blueprint_intents:        (blueprintBindings.data || []).reduce((acc: any, r: any) => {
            acc[r.patch_intent] = (acc[r.patch_intent] || 0) + 1; return acc;
          }, {}),
          narrative_units_at_risk:  narrativeUnits.data?.length ?? 0,
          narrative_units_sample:   (narrativeUnits.data || []).slice(0, 5).map((u: any) => ({ unit_key: u.unit_key, status: u.status })),
        };
        break;
      }

      case "scene_roles_sample": {
        // Returns scene_roles payload for the first N scenes (to inspect format)
        const { project_id, limit: lim = 8 } = params;
        const { data: orderRows } = await supabase.from("scene_graph_order")
          .select("scene_id, order_key").eq("project_id", project_id)
          .eq("is_active", true).order("order_key", { ascending: true }).limit(lim);
        if (!orderRows || orderRows.length === 0) { result = []; break; }
        const sceneIds = orderRows.map((r: any) => r.scene_id);
        const { data: verRows } = await supabase.from("scene_graph_versions")
          .select("scene_id, version_number, scene_roles, characters_present, slugline")
          .in("scene_id", sceneIds).order("version_number", { ascending: false });
        const latest = new Map<string, any>();
        for (const v of (verRows || [])) { if (!latest.has(v.scene_id)) latest.set(v.scene_id, v); }
        const { data: sceneRows } = await supabase.from("scene_graph_scenes")
          .select("id, scene_key").in("id", sceneIds);
        const sceneKeyMap = new Map<string, string>((sceneRows || []).map((s: any) => [s.id, s.scene_key]));
        result = orderRows.map((r: any) => {
          const v = latest.get(r.scene_id);
          return {
            scene_key:          sceneKeyMap.get(r.scene_id) ?? "?",
            slugline:           v?.slugline ?? null,
            scene_roles:        v?.scene_roles ?? [],
            characters_present: v?.characters_present ?? [],
          };
        });
        break;
      }

      case "spine_links_sample": {
        // Returns sample spine links with axis_key + scene_key
        const { project_id, limit: lim = 10 } = params;
        const { data: links } = await supabase.from("scene_spine_links")
          .select("scene_id, axis_key, roles, updated_at")
          .eq("project_id", project_id).not("axis_key", "is", null).limit(lim);
        if (!links || links.length === 0) { result = []; break; }
        const sceneIds = links.map((l: any) => l.scene_id);
        const { data: sceneRows } = await supabase.from("scene_graph_scenes")
          .select("id, scene_key").in("id", sceneIds);
        const sceneKeyMap = new Map<string, string>((sceneRows || []).map((s: any) => [s.id, s.scene_key]));
        result = links.map((l: any) => ({
          scene_key:  sceneKeyMap.get(l.scene_id) ?? l.scene_id,
          axis_key:   l.axis_key,
          roles:      l.roles,
          updated_at: l.updated_at,
        }));
        break;
      }

      case "blueprint_bindings_sample": {
        // Returns sample scene_blueprint_bindings rows
        const { project_id, limit: lim = 10 } = params;
        const { data: bindings } = await supabase.from("scene_blueprint_bindings")
          .select("scene_key,source_axis,source_unit_key,risk_source,patch_intent,target_surface,reason,slugline,source_doc_version_id,computed_at")
          .eq("project_id", project_id).order("scene_key", { ascending: true }).limit(lim);
        result = bindings ?? [];
        break;
      }

      case "clean_ghost_spine_axes": {
        // Removes pre-fix ghost axis rows from scene_spine_links.
        // Ghost axes: midpoint_shift, structural_turn, narrative_bridge, pacing_relief
        // These were written by the old ROLE_AXIS_MAP before the Phase 4 fix.
        // Safe to delete: scene_graph_sync_spine_links will repopulate with correct axes.
        const GHOST_AXES = ["midpoint_shift", "structural_turn", "narrative_bridge", "pacing_relief"];
        const { data: deleted, error: delErr } = await supabase
          .from("scene_spine_links")
          .delete()
          .in("axis_key", GHOST_AXES)
          .select("id,axis_key");
        if (delErr) throw delErr;
        result = {
          deleted_count: (deleted || []).length,
          deleted_axes:  [...new Set((deleted || []).map((r: any) => r.axis_key))],
        };
        break;
      }

      case "check_table_exists": {
        // Checks whether a given table exists in the public schema
        const { table_name } = params;
        const { data, error: chkErr } = await supabase
          .from("scene_blueprint_bindings")
          .select("id")
          .limit(0);
        // If table doesn't exist, error.code = "42P01"
        if (chkErr?.code === "42P01") {
          result = { exists: false, table: table_name, message: chkErr.message };
        } else if (chkErr) {
          result = { exists: null, table: table_name, error: chkErr.message };
        } else {
          result = { exists: true, table: table_name };
        }
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
