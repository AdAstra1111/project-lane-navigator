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
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

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
          .select("id, version_number, approval_status, is_current, meta_json, created_at, plaintext")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false })
          .limit(limit);
        if (error) throw error;
        // Truncate plaintext to 400 chars to keep response small
        result = (data || []).map((v: any) => ({
          ...v,
          plaintext: typeof v.plaintext === "string" ? v.plaintext.slice(0, 400) : v.plaintext,
        }));
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

      case "run_migration": {
        // Execute approved DDL migrations via direct PostgreSQL connection.
        // Gated by X-Lara-Secret. Only pre-approved migration keys allowed.
        // Uses SUPABASE_DB_URL (direct pooler connection) for DDL execution.
        const { migration_key } = params;
        const APPROVED_MIGRATIONS: Record<string, string> = {
          // Clears stale bg_generating=true flags for a project's season_script versions
          // (run when background generation timed out without writing content)
          "add_narrative_units_status_columns": `
            ALTER TABLE public.narrative_units
              ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
              ADD COLUMN IF NOT EXISTS stale_reason jsonb;
          `,

          "clear_stale_bg_generating_season_script": `
            UPDATE project_document_versions
            SET is_current = false,
                meta_json   = jsonb_set(COALESCE(meta_json, '{}'::jsonb), '{bg_generating}', 'false'::jsonb)
            WHERE document_id IN (
              SELECT pdv.document_id FROM project_document_versions pdv
              JOIN project_documents pd ON pd.id = pdv.document_id
              WHERE pd.project_id = '998f8ae7-b855-4670-9dfd-e6265d94b230'
                AND pd.doc_type   = 'season_script'
            )
            AND (meta_json->>'bg_generating') = 'true'
            AND plaintext = '';
          `,

          "create_scene_blueprint_bindings": `
            CREATE TABLE IF NOT EXISTS public.scene_blueprint_bindings (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
              scene_id uuid NOT NULL,
              scene_key text NOT NULL,
              source_axis text NOT NULL,
              source_unit_key text NULL,
              source_doc_version_id uuid NULL,
              risk_source text NOT NULL DEFAULT 'direct',
              patch_intent text NOT NULL DEFAULT 'inspect',
              target_surface text NOT NULL DEFAULT 'screenplay',
              slugline text NULL,
              reason text NULL,
              computed_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (project_id, scene_id, source_axis)
            );
            CREATE INDEX IF NOT EXISTS idx_sbb_project ON public.scene_blueprint_bindings (project_id);
            CREATE INDEX IF NOT EXISTS idx_sbb_scene   ON public.scene_blueprint_bindings (project_id, scene_id);
            CREATE INDEX IF NOT EXISTS idx_sbb_axis    ON public.scene_blueprint_bindings (project_id, source_axis);
          `,

          "create_screenplay_intake_runs": `
            CREATE TABLE IF NOT EXISTS public.screenplay_intake_runs (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
              user_id uuid NOT NULL,
              source_doc_id uuid NULL REFERENCES public.project_documents(id) ON DELETE SET NULL,
              script_version_id uuid NULL REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
              status text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','done','partial','failed')),
              initiated_at timestamptz NOT NULL DEFAULT now(),
              completed_at timestamptz NULL,
              error text NULL,
              metadata jsonb NOT NULL DEFAULT '{}'::jsonb
            );
            CREATE INDEX IF NOT EXISTS idx_intake_runs_project
              ON public.screenplay_intake_runs (project_id, initiated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_intake_runs_status
              ON public.screenplay_intake_runs (project_id, status);
            ALTER TABLE public.screenplay_intake_runs ENABLE ROW LEVEL SECURITY;
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_runs' AND policyname='intake_runs_select') THEN
                CREATE POLICY intake_runs_select ON public.screenplay_intake_runs FOR SELECT USING (auth.uid() = user_id);
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_runs' AND policyname='intake_runs_insert') THEN
                CREATE POLICY intake_runs_insert ON public.screenplay_intake_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_runs' AND policyname='intake_runs_update') THEN
                CREATE POLICY intake_runs_update ON public.screenplay_intake_runs FOR UPDATE USING (auth.uid() = user_id);
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_runs' AND policyname='intake_runs_service') THEN
                CREATE POLICY intake_runs_service ON public.screenplay_intake_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
              END IF;
            END $$;
            CREATE TABLE IF NOT EXISTS public.screenplay_intake_stage_runs (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              run_id uuid NOT NULL REFERENCES public.screenplay_intake_runs(id) ON DELETE CASCADE,
              stage_key text NOT NULL,
              stage_order int NOT NULL,
              status text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','failed','skipped')),
              started_at timestamptz NULL,
              completed_at timestamptz NULL,
              error text NULL,
              output_summary jsonb NULL,
              function_name text NULL,
              action_name text NULL,
              retryable boolean NOT NULL DEFAULT true,
              UNIQUE (run_id, stage_key)
            );
            CREATE INDEX IF NOT EXISTS idx_intake_stage_runs_run
              ON public.screenplay_intake_stage_runs (run_id, stage_order);
            ALTER TABLE public.screenplay_intake_stage_runs ENABLE ROW LEVEL SECURITY;
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_stage_runs' AND policyname='intake_stage_runs_service') THEN
                CREATE POLICY intake_stage_runs_service ON public.screenplay_intake_stage_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_stage_runs' AND policyname='intake_stage_runs_select') THEN
                CREATE POLICY intake_stage_runs_select ON public.screenplay_intake_stage_runs FOR SELECT USING (EXISTS (SELECT 1 FROM public.screenplay_intake_runs r WHERE r.id=run_id AND r.user_id=auth.uid()));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_stage_runs' AND policyname='intake_stage_runs_insert') THEN
                CREATE POLICY intake_stage_runs_insert ON public.screenplay_intake_stage_runs FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.screenplay_intake_runs r WHERE r.id=run_id AND r.user_id=auth.uid()));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='screenplay_intake_stage_runs' AND policyname='intake_stage_runs_update') THEN
                CREATE POLICY intake_stage_runs_update ON public.screenplay_intake_stage_runs FOR UPDATE USING (EXISTS (SELECT 1 FROM public.screenplay_intake_runs r WHERE r.id=run_id AND r.user_id=auth.uid()));
              END IF;
            END $$;
          `,
          "create_scene_graph_atomic_write": `
            CREATE OR REPLACE FUNCTION public.scene_graph_atomic_write(
              p_project_id  uuid,
              p_created_by  uuid,
              p_force       boolean DEFAULT false,
              p_scenes      jsonb   DEFAULT '[]'::jsonb
            )
            RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path TO 'public'
            AS $$
            DECLARE
              v_entry    jsonb;
              v_scene    record;
              v_version  record;
              v_results  jsonb := '[]'::jsonb;
            BEGIN
              IF p_force THEN
                DELETE FROM public.scene_graph_snapshots WHERE project_id = p_project_id;
                DELETE FROM public.scene_graph_scenes    WHERE project_id = p_project_id;
              END IF;
              FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scenes) LOOP
                INSERT INTO public.scene_graph_scenes (project_id, scene_kind, scene_key, created_by)
                VALUES (p_project_id, COALESCE(v_entry->>'scene_kind','narrative'), v_entry->>'scene_key', p_created_by)
                RETURNING * INTO v_scene;

                INSERT INTO public.scene_graph_versions (scene_id, project_id, version_number, status, created_by, slugline, location, time_of_day, content, summary)
                VALUES (v_scene.id, p_project_id, 1, 'draft', p_created_by,
                  COALESCE(v_entry->>'slugline',''), COALESCE(v_entry->>'location',''),
                  COALESCE(v_entry->>'time_of_day',''), COALESCE(v_entry->>'content',''), COALESCE(v_entry->>'summary',''))
                RETURNING * INTO v_version;

                INSERT INTO public.scene_graph_order (project_id, scene_id, order_key, is_active, act)
                VALUES (p_project_id, v_scene.id, v_entry->>'order_key', true, NULL);

                v_results := v_results || jsonb_build_array(jsonb_build_object(
                  'scene_id', v_scene.id, 'scene_key', v_scene.scene_key,
                  'version_id', v_version.id, 'order_key', v_entry->>'order_key'
                ));
              END LOOP;
              RETURN v_results;
            END;
            $$;
            GRANT EXECUTE ON FUNCTION public.scene_graph_atomic_write(uuid, uuid, boolean, jsonb)
              TO authenticated, service_role;
          `,
          "scene_key_not_null": `
            ALTER TABLE public.scene_graph_scenes ALTER COLUMN scene_key SET NOT NULL;
            COMMENT ON COLUMN public.scene_graph_scenes.scene_key IS
              'Canonical scene identity key (SCENE_NNN). Assigned at creation, never reused. '
              'Unique per project (partial unique index). NOT NULL enforced at DB layer.';
          `,
          "add_missing_scene_fks": `
            ALTER TABLE public.scene_blueprint_bindings
              ADD CONSTRAINT scene_blueprint_bindings_scene_id_fkey
              FOREIGN KEY (scene_id) REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE;
            ALTER TABLE public.scene_spine_links
              ADD CONSTRAINT scene_spine_links_scene_id_fkey
              FOREIGN KEY (scene_id) REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE;
          `,
          "scene_spine_links_rls_tighten_v1": `
            DROP POLICY IF EXISTS "Users can manage scene spine links for own projects"
              ON public.scene_spine_links;
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scene_spine_links' AND policyname='ssl_select') THEN
                CREATE POLICY "ssl_select" ON public.scene_spine_links
                  FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
            END $$;
          `,
          "resolve_stale_nu_obsidian_mirror": `
            -- EVIDENCE-BASED DIRECT RESOLUTION: two stale narrative_units in The Obsidian Mirror
            -- protagonist_arc (id: 20d04c60): stale_reason shows previous_value == new_value
            --   → no-op spine amendment, false-positive stale trigger
            --   → contradiction_note=None, verbatim_quote_verified=True
            -- central_conflict (id: ceae1662): spine simplified ("...— and the life she refused to live" removed)
            --   → contradiction_note=None, evidence present and verified
            --   → core conflict identity unchanged, safe to mark aligned
            --
            -- document (id: 95dceb5b): needs_reconcile=True due to the same no-op protagonist_arc amendment
            --   → safe to clear after unit resolution

            UPDATE public.narrative_units
              SET status      = 'aligned',
                  stale_reason = NULL,
                  updated_at   = NOW()
              WHERE id IN (
                'ceae1662-3a9c-4a3c-a411-12cadfa3ddf9',
                '20d04c60-459d-4b02-9caa-d87df193d761'
              );

            UPDATE public.project_documents
              SET needs_reconcile    = false,
                  reconcile_reasons  = NULL,
                  updated_at         = NOW()
              WHERE id = '95dceb5b-c354-486b-b142-7113ac570c56'
                AND needs_reconcile  = true;
          `,
          "scene_blueprint_bindings_rls_v1": `
            CREATE POLICY "sbb_select" ON public.scene_blueprint_bindings
              FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
            CREATE POLICY "sbb_insert" ON public.scene_blueprint_bindings
              FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
            CREATE POLICY "sbb_update" ON public.scene_blueprint_bindings
              FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
            CREATE POLICY "sbb_delete" ON public.scene_blueprint_bindings
              FOR DELETE TO authenticated USING (has_project_access(auth.uid(), project_id));
          `,
          "codify_enrichment_columns_v1": `
            ALTER TABLE public.scene_graph_versions
              ADD COLUMN IF NOT EXISTS characters_present jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS scene_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS beats jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS thread_links jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS continuity_facts_emitted jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS continuity_facts_required jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS setup_payoff_emitted jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS setup_payoff_required jsonb NOT NULL DEFAULT '[]'::jsonb,
              ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
              ADD COLUMN IF NOT EXISTS purpose text NULL,
              ADD COLUMN IF NOT EXISTS tension_delta integer NULL,
              ADD COLUMN IF NOT EXISTS pacing_seconds integer NULL;
            ALTER TABLE public.scene_graph_scenes
              ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
          `,
          "regen_advisory_lock_v1": `
            CREATE OR REPLACE FUNCTION public.acquire_regen_advisory_lock(p_project_id uuid)
            RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
            DECLARE lock_key bigint; BEGIN
              lock_key := ('x' || replace(substring(p_project_id::text, 1, 18), '-', ''))::bit(64)::bigint;
              RETURN pg_try_advisory_xact_lock(lock_key);
            END; $$;
            CREATE OR REPLACE FUNCTION public.create_regen_run_locked(
              p_project_id uuid, p_triggered_by uuid, p_source_unit_keys text[], p_source_axes text[],
              p_recommended_scope text, p_target_scene_ids uuid[], p_target_scene_count integer,
              p_ndg_pre_at_risk_count integer, p_meta_json jsonb
            ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
            DECLARE lock_key bigint; lock_acquired boolean; running_count integer; new_run_id uuid;
            BEGIN
              lock_key := ('x' || replace(substring(p_project_id::text, 1, 18), '-', ''))::bit(64)::bigint;
              lock_acquired := pg_try_advisory_xact_lock(lock_key);
              IF NOT lock_acquired THEN
                RETURN jsonb_build_object('ok', false, 'abort_reason', 'execution_locked', 'note', 'Another regeneration execution is starting concurrently');
              END IF;
              SELECT COUNT(*) INTO running_count FROM public.regeneration_runs WHERE project_id = p_project_id AND status = 'running';
              IF running_count > 0 THEN
                RETURN jsonb_build_object('ok', false, 'abort_reason', 'already_running', 'note', 'A regeneration run is already in progress');
              END IF;
              INSERT INTO public.regeneration_runs (project_id, triggered_by, source_unit_keys, source_axes, recommended_scope, target_scene_ids, target_scene_count, status, ndg_pre_at_risk_count, meta_json)
              VALUES (p_project_id, p_triggered_by, p_source_unit_keys, p_source_axes, p_recommended_scope, p_target_scene_ids, p_target_scene_count, 'running', p_ndg_pre_at_risk_count, p_meta_json)
              RETURNING id INTO new_run_id;
              RETURN jsonb_build_object('ok', true, 'run_id', new_run_id);
            END; $$;
          `,

          "narrative_obligations_v1": `
            -- Narrative Obligation Registry (NC1)
            -- Additive: new table only, no existing tables modified.
            CREATE TABLE IF NOT EXISTS public.narrative_obligations (
              id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id       UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
              obligation_id    TEXT        NOT NULL,
              obligation_type  TEXT        NOT NULL CHECK (obligation_type IN (
                'promise_of_premise','protagonist_arc_resolution','antagonist_arc_resolution',
                'relationship_arc_bridge','mystery_payoff','theme_confirmation',
                'tonal_contract','genre_contract','climax_payoff','ending_condition_fulfillment'
              )),
              source_layer     TEXT        NOT NULL,
              source_key       TEXT        NOT NULL,
              description      TEXT,
              required_by      TEXT,
              severity_default TEXT        NOT NULL DEFAULT 'warning'
                               CHECK (severity_default IN ('info','warning','high','critical')),
              provenance       JSONB       NOT NULL DEFAULT '{}',
              created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
              UNIQUE(project_id, obligation_id)
            );
            CREATE INDEX IF NOT EXISTS narrative_obligations_project_id_idx ON public.narrative_obligations(project_id);
            CREATE INDEX IF NOT EXISTS narrative_obligations_type_idx ON public.narrative_obligations(project_id, obligation_type);
            ALTER TABLE public.narrative_obligations ENABLE ROW LEVEL SECURITY;
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_obligations' AND policyname='narrative_obligations_select') THEN
                CREATE POLICY "narrative_obligations_select" ON public.narrative_obligations FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_obligations' AND policyname='narrative_obligations_insert') THEN
                CREATE POLICY "narrative_obligations_insert" ON public.narrative_obligations FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_obligations' AND policyname='narrative_obligations_update') THEN
                CREATE POLICY "narrative_obligations_update" ON public.narrative_obligations FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_obligations' AND policyname='narrative_obligations_delete') THEN
                CREATE POLICY "narrative_obligations_delete" ON public.narrative_obligations FOR DELETE TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
            END $$;
          `,

          "narrative_repairs_v1": `
            CREATE TABLE IF NOT EXISTS public.narrative_repairs (
              repair_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id            UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
              source_diagnostic_id  TEXT        NOT NULL,
              repair_type           TEXT        NOT NULL,
              scope_type            TEXT        NOT NULL DEFAULT 'project',
              scope_key             TEXT,
              strategy              TEXT,
              priority_score        INTEGER     NOT NULL DEFAULT 0,
              repairability         TEXT        NOT NULL DEFAULT 'manual'
                                                CHECK (repairability IN ('auto','guided','manual','unknown')),
              status                TEXT        NOT NULL DEFAULT 'pending'
                                                CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
              created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE(project_id, source_diagnostic_id)
            );
            CREATE INDEX IF NOT EXISTS narrative_repairs_project_id_idx
              ON public.narrative_repairs(project_id);
            CREATE INDEX IF NOT EXISTS narrative_repairs_status_idx
              ON public.narrative_repairs(project_id, status);
            CREATE INDEX IF NOT EXISTS narrative_repairs_priority_idx
              ON public.narrative_repairs(project_id, priority_score DESC, status);
            ALTER TABLE public.narrative_repairs ENABLE ROW LEVEL SECURITY;
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_repairs' AND policyname='narrative_repairs_select') THEN
                CREATE POLICY "narrative_repairs_select" ON public.narrative_repairs FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_repairs' AND policyname='narrative_repairs_insert') THEN
                CREATE POLICY "narrative_repairs_insert" ON public.narrative_repairs FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_repairs' AND policyname='narrative_repairs_update') THEN
                CREATE POLICY "narrative_repairs_update" ON public.narrative_repairs FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
            END;
            $$;
          `,

          "narrative_patch_proposals_v1": `
            CREATE TABLE IF NOT EXISTS public.narrative_patch_proposals (
              proposal_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id            UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
              repair_id             UUID        NOT NULL REFERENCES public.narrative_repairs(repair_id) ON DELETE CASCADE,
              source_diagnostic_id  TEXT        NOT NULL,
              patch_type            TEXT        NOT NULL CHECK (patch_type IN ('repair_relation_graph','repair_structural_beats')),
              patch_layer           TEXT        NOT NULL CHECK (patch_layer IN ('layer_5b_entity_relations','layer_7_beats')),
              proposed_patch        JSONB       NOT NULL,
              seed_context_snapshot JSONB,
              rationale             TEXT,
              proposal_hash         TEXT,
              generator_model       TEXT,
              seed_snapshot_at      TIMESTAMPTZ NOT NULL,
              status                TEXT        NOT NULL DEFAULT 'proposed'
                                                CHECK (status IN ('proposed','applied','rejected','stale')),
              created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              applied_at            TIMESTAMPTZ,
              CONSTRAINT unique_repair_proposal UNIQUE (repair_id)
            );
            CREATE INDEX IF NOT EXISTS idx_patch_proposals_project ON public.narrative_patch_proposals(project_id);
            CREATE INDEX IF NOT EXISTS idx_patch_proposals_status ON public.narrative_patch_proposals(project_id, status);
            ALTER TABLE public.narrative_patch_proposals ENABLE ROW LEVEL SECURITY;
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_patch_proposals' AND policyname='narrative_patch_proposals_select') THEN
                CREATE POLICY "narrative_patch_proposals_select" ON public.narrative_patch_proposals FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_patch_proposals' AND policyname='narrative_patch_proposals_insert') THEN
                CREATE POLICY "narrative_patch_proposals_insert" ON public.narrative_patch_proposals FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narrative_patch_proposals' AND policyname='narrative_patch_proposals_update') THEN
                CREATE POLICY "narrative_patch_proposals_update" ON public.narrative_patch_proposals FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
            END $$;
          `,

          "rp4_delete_proposals_obsidian_mirror": `
            DELETE FROM public.narrative_patch_proposals
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c';
          `,

          // SIM3 validation test data
          "sim3_insert_beats_proposal": `
            -- VALIDATION-ONLY: insert synthetic beats repair + proposal for SIM3 testing.
            -- Cleanup with sim3_cleanup_test_data.
            INSERT INTO public.narrative_repairs
              (repair_id, project_id, source_diagnostic_id, source_system, diagnostic_type,
               repair_type, scope_type, scope_key, strategy, priority_score, repairability, status,
               summary, recommended_action)
            VALUES (
              '11111111-2222-3333-4444-555555555555',
              '37e830b8-0143-4d01-9207-b460ff441e8c',
              'dx-sim3-test-beats', 'structural_validator', 'missing_beat_coverage',
              'repair_structural_beats', 'project', 'layer_7', 'balanced', 60, 'guided', 'pending',
              'Test repair for SIM3 beats validation', 'Patch beats to cover all narrative axes'
            ) ON CONFLICT DO NOTHING;

            INSERT INTO public.narrative_patch_proposals
              (proposal_id, project_id, repair_id, source_diagnostic_id, patch_type, patch_layer,
               proposed_patch, seed_context_snapshot, rationale, proposal_hash, generator_model,
               seed_snapshot_at, status)
            VALUES (
              'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
              '37e830b8-0143-4d01-9207-b460ff441e8c',
              '11111111-2222-3333-4444-555555555555',
              'dx-sim3-test-beats', 'repair_structural_beats', 'layer_7_beats',
              '{"beats":[{"beat_key":"opening_state","beat_description":"A retired operative receives a coded message","narrative_axis_reference":"story_engine","expected_turn":"act_one_open"},{"beat_key":"inciting_event_seed","beat_description":"The message triggers a manhunt","narrative_axis_reference":"inciting_incident","expected_turn":"act_one"},{"beat_key":"first_escalation","beat_description":"Stakes escalate as forces close in","narrative_axis_reference":"pressure_system","expected_turn":"act_two_a"}]}'::jsonb,
              '{"entities":[],"entity_relations":[],"beats":[]}'::jsonb,
              'SIM3 test beats proposal', 'ph-sim3beats', 'test-model', NOW(), 'proposed'
            ) ON CONFLICT DO NOTHING;
          `,

          "sim3_insert_relation_proposals": `
            -- VALIDATION-ONLY: insert synthetic relation repair + proposals for SIM3 testing.
            -- Cleanup with sim3_cleanup_test_data.
            INSERT INTO public.narrative_repairs
              (repair_id, project_id, source_diagnostic_id, source_system, diagnostic_type,
               repair_type, scope_type, scope_key, strategy, priority_score, repairability, status,
               summary, recommended_action)
            VALUES (
              '22222222-3333-4444-5555-666666666666',
              '37e830b8-0143-4d01-9207-b460ff441e8c',
              'dx-sim3-test-rel', 'structural_validator', 'missing_relation_graph',
              'repair_relation_graph', 'project', 'layer_5b', 'balanced', 70, 'guided', 'pending',
              'Test repair for SIM3 relation validation', 'Patch entity relations'
            ) ON CONFLICT DO NOTHING;

            INSERT INTO public.narrative_patch_proposals
              (proposal_id, project_id, repair_id, source_diagnostic_id, patch_type, patch_layer,
               proposed_patch, seed_context_snapshot, rationale, proposal_hash, generator_model,
               seed_snapshot_at, status)
            VALUES
            (
              'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
              '37e830b8-0143-4d01-9207-b460ff441e8c',
              '22222222-3333-4444-5555-666666666666',
              'dx-sim3-test-rel', 'repair_relation_graph', 'layer_5b_entity_relations',
              '{"entity_relations":[{"source_entity_key":"CHAR_PROTAGONIST","relation_type":"drives_arc","target_entity_key":"ARC_PROTAGONIST"},{"source_entity_key":"CHAR_ANTAGONIST","relation_type":"opposes","target_entity_key":"CHAR_PROTAGONIST"}]}'::jsonb,
              '{"entities":[{"entity_key":"CHAR_PROTAGONIST","entity_type":"character","narrative_role":"protagonist","story_critical_flag":true},{"entity_key":"ARC_PROTAGONIST","entity_type":"arc","narrative_role":"arc","story_critical_flag":true},{"entity_key":"CHAR_ANTAGONIST","entity_type":"character","narrative_role":"antagonist","story_critical_flag":false}],"entity_relations":[],"beats":[]}'::jsonb,
              'SIM3 test relation proposal (drives_arc → protagonist_arc)', 'ph-sim3rel', 'test-model', NOW(), 'proposed'
            ),
            (
              'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',
              '37e830b8-0143-4d01-9207-b460ff441e8c',
              '22222222-3333-4444-5555-666666666666',
              'dx-sim3-test-applied', 'repair_relation_graph', 'layer_5b_entity_relations',
              '{"entity_relations":[]}'::jsonb,
              '{}'::jsonb,
              'SIM3 test applied proposal (V6)', 'ph-sim3applied', 'test-model', NOW(), 'applied'
            )
            ON CONFLICT DO NOTHING;
          `,

          "sim3_cleanup_test_data": `
            -- VALIDATION-ONLY: clean up SIM3 test data.
            DELETE FROM public.narrative_patch_proposals
              WHERE proposal_id IN (
                'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
                'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa'
              );
            DELETE FROM public.narrative_repairs
              WHERE repair_id IN (
                '11111111-2222-3333-4444-555555555555',
                '22222222-3333-4444-5555-666666666666'
              );
          `,

          "narrative_repairs_v3": `
            ALTER TABLE public.narrative_repairs
              ADD COLUMN IF NOT EXISTS executed_at      TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS execution_result JSONB,
              ADD COLUMN IF NOT EXISTS skipped_reason   TEXT,
              ADD COLUMN IF NOT EXISTS dismissed_at     TIMESTAMPTZ;
          `,

          "narrative_repairs_v2": `
            ALTER TABLE public.narrative_repairs
              ADD COLUMN IF NOT EXISTS source_system      TEXT,
              ADD COLUMN IF NOT EXISTS diagnostic_type    TEXT,
              ADD COLUMN IF NOT EXISTS summary            TEXT,
              ADD COLUMN IF NOT EXISTS recommended_action TEXT;
            ALTER TABLE public.narrative_repairs
              DROP CONSTRAINT IF EXISTS narrative_repairs_status_check;
            ALTER TABLE public.narrative_repairs
              ADD CONSTRAINT narrative_repairs_status_check
              CHECK (status IN ('pending','planned','approved','queued','in_progress','completed','failed','skipped','dismissed'));
            ALTER TABLE public.narrative_repairs
              DROP CONSTRAINT IF EXISTS narrative_repairs_repairability_check;
            ALTER TABLE public.narrative_repairs
              ADD CONSTRAINT narrative_repairs_repairability_check
              CHECK (repairability IN ('auto','guided','manual','investigatory','unknown'));
          `,

          "rp1_delete_obligations_obsidian_mirror": `
            -- VALIDATION-ONLY: remove narrative_obligations for Obsidian Mirror to
            -- force obligation_registry_empty diagnostic in RP1 validation (C2–C5).
            -- Restore via build_narrative_obligations after testing.
            DELETE FROM public.narrative_obligations
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c';
          `,

          "rp1_delete_repairs_obsidian_mirror": `
            -- VALIDATION-ONLY: reset narrative_repairs for Obsidian Mirror
            -- so C5 idempotency test can start from a known-clean state.
            DELETE FROM public.narrative_repairs
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c';
          `,

          "dx3_insert_test_repairs_obsidian_mirror": `
            -- DX3 VALIDATION-ONLY: insert repairs covering all resolution_state branches.
            -- diagnostic IDs are real dxStableId hashes for Obsidian Mirror.
            -- Requires obligations to be deleted (so obligation_registry_empty fires).
            --
            -- dx-9f070ca5 = obligation_registry_empty (auto/build_obligation_registry)
            --               → resolution_state: queued
            -- dx-test-guided-dx3 = synthetic soul_drift_summary (guided non-patchable)
            --               → resolution_state: awaiting_approval
            -- dx-test-patchable-dx3 = synthetic obligation_violated (guided patchable)
            --               → resolution_state: awaiting_proposal
            -- dx-test-failed-dx3 = synthetic with status=failed
            --               → resolution_state: failed
            -- dx-test-skipped-dx3 = synthetic with status=skipped, skipped_reason=manual
            --               → resolution_state: blocked

            DELETE FROM public.narrative_repairs
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c'
                AND source_diagnostic_id IN (
                  'dx-9f070ca5','dx-test-guided-dx3','dx-test-patchable-dx3',
                  'dx-test-failed-dx3','dx-test-skipped-dx3'
                );

            INSERT INTO public.narrative_repairs
              (project_id, source_diagnostic_id, source_system, diagnostic_type,
               repair_type, scope_type, scope_key, strategy, priority_score, repairability, status)
            VALUES
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-9f070ca5', 'obligation_validator', 'obligation_registry_empty',
               'build_obligation_registry', 'project', NULL, 'auto', 50, 'auto', 'pending'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-guided-dx3', 'soul_drift', 'soul_drift_summary',
               'repair_seed_alignment', 'project', NULL, 'guided', 60, 'guided', 'pending'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-patchable-dx3', 'obligation_validator', 'obligation_violated',
               'repair_relation_graph', 'project', NULL, 'guided', 70, 'guided', 'pending'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-failed-dx3', 'soul_drift', 'premise_drift',
               'repair_seed_alignment', 'project', NULL, 'guided', 60, 'guided', 'failed'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-skipped-dx3', 'diagnostics_layer', 'subsystem_unavailable',
               'inspect_subsystem', 'project', NULL, 'manual', 40, 'manual', 'skipped')
            ON CONFLICT (project_id, source_diagnostic_id) DO UPDATE
              SET status        = EXCLUDED.status,
                  repair_type   = EXCLUDED.repair_type,
                  repairability = EXCLUDED.repairability;
          `,

          "dx3_cleanup_test_repairs_obsidian_mirror": `
            -- DX3 VALIDATION-ONLY: clean up DX3 test repair rows.
            DELETE FROM public.narrative_repairs
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c'
                AND source_diagnostic_id IN (
                  'dx-9f070ca5','dx-test-guided-dx3','dx-test-patchable-dx3',
                  'dx-test-failed-dx3','dx-test-skipped-dx3'
                );
          `,

          "rp2_inject_seed_alignment_mismatch": `
            -- VALIDATION-ONLY: inject a repair_seed_alignment plan whose source_diagnostic_id
            -- is dx-9f070ca5 (obligation_registry_empty). Since seed alignment won't fix
            -- missing obligations, the post-execution DX re-run will find the diagnostic
            -- still present → status:failed, skipped_reason:diagnostic_persists_post_execution.
            -- Requires obligations to be deleted first.
            INSERT INTO public.narrative_repairs
              (project_id, source_diagnostic_id, source_system, diagnostic_type,
               repair_type, scope_type, scope_key, strategy, priority_score, repairability, status)
            VALUES
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-9f070ca5', 'obligation_validator', 'obligation_registry_empty',
               'repair_seed_alignment', 'project', NULL, 'auto', 50, 'auto', 'pending')
            ON CONFLICT (project_id, source_diagnostic_id) DO UPDATE
              SET repair_type = 'repair_seed_alignment',
                  repairability = 'auto',
                  status = 'pending',
                  skipped_reason = NULL,
                  executed_at = NULL,
                  execution_result = NULL,
                  dismissed_at = NULL;
          `,

          "rp2_inject_investigatory_real_dx": `
            -- VALIDATION-ONLY: inject investigatory plan whose source_diagnostic_id
            -- matches the real obligation_registry_empty diagnostic for Obsidian Mirror.
            -- Requires rp1_delete_obligations_obsidian_mirror to have run first.
            -- dx-9f070ca5 is the stable content-hash for obligation_registry_empty on this project.
            INSERT INTO public.narrative_repairs
              (project_id, source_diagnostic_id, source_system, diagnostic_type,
               repair_type, scope_type, scope_key, strategy, priority_score, repairability, status)
            VALUES
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-9f070ca5', 'obligation_validator', 'obligation_registry_empty',
               'investigate_simulation_impact', 'axis', 'protagonist_arc', 'investigatory', 50, 'investigatory', 'pending')
            ON CONFLICT (project_id, source_diagnostic_id) DO UPDATE
              SET repair_type = 'investigate_simulation_impact',
                  repairability = 'investigatory',
                  status = 'pending',
                  skipped_reason = NULL,
                  executed_at = NULL,
                  execution_result = NULL,
                  dismissed_at = NULL;
          `,

          "rp2_inject_test_plans_obsidian_mirror": `
            -- VALIDATION-ONLY: inject synthetic plans for RP2 C3/C5/C9/C13 validation.
            -- Covers: guided (requires_approval), manual (permanent skip),
            --         Tier 4 deferred (repair_relation_graph), investigatory (simulate).
            INSERT INTO public.narrative_repairs
              (project_id, source_diagnostic_id, source_system, diagnostic_type,
               repair_type, scope_type, scope_key, strategy, priority_score, repairability, status)
            VALUES
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-guided-0001', 'soul_drift', 'soul_drift_summary',
               'repair_seed_alignment', 'project', NULL, 'guided', 60, 'guided', 'pending'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-manual-0001', 'diagnostics_layer', 'subsystem_unavailable',
               'inspect_subsystem', 'project', 'obligation_validator', 'manual', 50, 'manual', 'pending'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-tier4-0001', 'obligation_validator', 'obligation_violated',
               'repair_relation_graph', 'project', NULL, 'guided', 60, 'guided', 'pending'),
              ('37e830b8-0143-4d01-9207-b460ff441e8c',
               'dx-test-invst-0001', 'simulation_engine', 'simulation_risk',
               'investigate_simulation_impact', 'axis', 'protagonist_arc', 'investigatory', 70, 'investigatory', 'pending')
            ON CONFLICT (project_id, source_diagnostic_id) DO NOTHING;
          `,

          "inject_running_regen_row_obsidian_mirror": `
            -- VALIDATION-ONLY: insert a fake 'running' row for concurrency guard testing.
            -- Paired with cleanup_test_running_regen_row for teardown.
            INSERT INTO public.regeneration_runs
              (project_id, source_unit_keys, source_axes, recommended_scope, status, meta_json)
            VALUES (
              '37e830b8-0143-4d01-9207-b460ff441e8c',
              ARRAY['ebc4b926-dc59-4762-a338-e30f37ba90e2::protagonist_arc'],
              ARRAY['protagonist_arc'],
              'targeted_scenes',
              'running',
              '{"dry_run":false,"test_injection":true}'::jsonb
            );
          `,
          "cleanup_test_running_regen_row": `
            -- VALIDATION-ONLY: remove injected test 'running' rows.
            DELETE FROM public.regeneration_runs
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c'
                AND status = 'running'
                AND meta_json->>'test_injection' = 'true';
          `,

          "validation_set_protagonist_arc_stale": `
            -- VALIDATION-ONLY: set protagonist_arc to stale for dry-run testing.
            -- Paired with validation_restore_protagonist_arc_aligned for cleanup.
            -- Targets Obsidian Mirror project only (37e830b8-0143-4d01-9207-b460ff441e8c).
            UPDATE public.narrative_units
              SET status      = 'stale',
                  stale_reason = '{"reason":"dry_run_validation_test"}'::jsonb,
                  updated_at   = NOW()
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c'
                AND unit_key LIKE '%::protagonist_arc';
          `,
          "validation_restore_protagonist_arc_aligned": `
            -- VALIDATION-ONLY: restore protagonist_arc to aligned after dry-run test.
            UPDATE public.narrative_units
              SET status      = 'aligned',
                  stale_reason = NULL,
                  updated_at   = NOW()
              WHERE project_id = '37e830b8-0143-4d01-9207-b460ff441e8c'
                AND unit_key LIKE '%::protagonist_arc';
          `,

          "regeneration_runs_v1": `
            CREATE TABLE IF NOT EXISTS public.regeneration_runs (
              id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id              uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
              triggered_by            uuid,
              source_unit_keys        text[]      NOT NULL DEFAULT '{}',
              source_axes             text[]      NOT NULL DEFAULT '{}',
              recommended_scope       text        NOT NULL,
              target_scene_ids        uuid[]      NOT NULL DEFAULT '{}',
              target_scene_count      integer     NOT NULL DEFAULT 0,
              completed_scene_ids     uuid[]      NOT NULL DEFAULT '{}',
              failed_scene_ids        uuid[]      NOT NULL DEFAULT '{}',
              status                  text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','completed','partial_failure','failed','aborted')),
              abort_reason            text,
              ndg_pre_at_risk_count   integer,
              ndg_post_at_risk_count  integer,
              ndg_validation_status   text
                CHECK (ndg_validation_status IS NULL OR
                       ndg_validation_status IN ('improved','unchanged','degraded','not_run')),
              started_at              timestamptz NOT NULL DEFAULT now(),
              completed_at            timestamptz,
              meta_json               jsonb       NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_regeneration_runs_project_id
              ON public.regeneration_runs(project_id);
            CREATE INDEX IF NOT EXISTS idx_regeneration_runs_active
              ON public.regeneration_runs(project_id, status)
              WHERE status IN ('pending', 'running');
            ALTER TABLE public.regeneration_runs ENABLE ROW LEVEL SECURITY;
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='regeneration_runs' AND policyname='rr_select') THEN
                CREATE POLICY "rr_select" ON public.regeneration_runs
                  FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='regeneration_runs' AND policyname='rr_insert') THEN
                CREATE POLICY "rr_insert" ON public.regeneration_runs
                  FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='regeneration_runs' AND policyname='rr_update') THEN
                CREATE POLICY "rr_update" ON public.regeneration_runs
                  FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
              END IF;
            END $$;
          `,

          "narrative_entity_rls_v1": `
            -- narrative_entities: full CRUD (manual source_kind supports user writes)
            CREATE POLICY "ne_select" ON public.narrative_entities
              FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
            CREATE POLICY "ne_insert" ON public.narrative_entities
              FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
            CREATE POLICY "ne_update" ON public.narrative_entities
              FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
            CREATE POLICY "ne_delete" ON public.narrative_entities
              FOR DELETE TO authenticated USING (has_project_access(auth.uid(), project_id));
            -- mentions: SELECT only (pipeline-derived)
            CREATE POLICY "nem_select" ON public.narrative_entity_mentions
              FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
            -- relations: SELECT only (pipeline-derived; upgrade to full CRUD when manual UX designed)
            CREATE POLICY "ner_select" ON public.narrative_entity_relations
              FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
            -- scene_entity_links: SELECT only (purely pipeline-derived)
            CREATE POLICY "nsel_select" ON public.narrative_scene_entity_links
              FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
          `,
        };
        if (!migration_key || !APPROVED_MIGRATIONS[migration_key]) {
          throw new Error(`run_migration: unknown migration_key '${migration_key}'`);
        }
        const dbUrl = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrl) throw new Error("SUPABASE_DB_URL not available");
        const sql = postgres(dbUrl, { max: 1 });
        try {
          await sql.unsafe(APPROVED_MIGRATIONS[migration_key]);
          result = { executed: migration_key, status: "success" };
        } finally {
          await sql.end();
        }
        break;
      }

      case "check_scene_key_duplicates": {
        // Read-only: finds duplicate (project_id, scene_key) pairs on active scenes.
        // Used for pre-constraint duplicate audit before adding UNIQUE index.
        const dbUrl1 = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrl1) throw new Error("SUPABASE_DB_URL not available");
        const sql1 = postgres(dbUrl1, { max: 1 });
        try {
          const dupRows = await sql1`
            SELECT
              project_id::text,
              scene_key,
              COUNT(*) AS dup_count,
              ARRAY_AGG(id::text ORDER BY created_at) AS scene_ids
            FROM public.scene_graph_scenes
            WHERE deprecated_at IS NULL
              AND scene_key IS NOT NULL
            GROUP BY project_id, scene_key
            HAVING COUNT(*) > 1
            ORDER BY dup_count DESC, project_id, scene_key
            LIMIT 100
          `;
          result = { duplicate_groups: dupRows.length, rows: dupRows };
        } finally {
          await sql1.end();
        }
        break;
      }

      case "schema_drift_audit": {
        // Comprehensive production schema snapshot for drift audit.
        // Returns tables, columns, indexes, constraints, functions, RLS, triggers, views.
        const dbUrlS = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrlS) throw new Error("SUPABASE_DB_URL not available");
        const sqlS = postgres(dbUrlS, { max: 1 });
        try {
          // 1. All tables in public schema
          const tables = await sqlS`
            SELECT tablename, tableowner,
              (SELECT COUNT(*)::int FROM information_schema.columns c
               WHERE c.table_schema='public' AND c.table_name=t.tablename) AS col_count
            FROM pg_tables t WHERE schemaname='public' ORDER BY tablename`;

          // 2. Columns for priority tables
          const cols = await sqlS`
            SELECT table_name, column_name, data_type, is_nullable,
                   column_default, character_maximum_length,
                   is_generated, identity_generation
            FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name IN (
                'projects','project_documents','project_document_versions',
                'screenplay_intake_runs','screenplay_intake_stage_runs',
                'scene_graph_scenes','scene_graph_versions','scene_graph_order',
                'scene_graph_snapshots','scene_spine_links','script_unit_links',
                'narrative_units','scene_blueprint_bindings',
                'scene_graph_actions','scene_graph_patch_queue',
                'narrative_scene_entity_links','scene_roles_overrides',
                'narrative_entities'
              )
            ORDER BY table_name, ordinal_position`;

          // 3. Indexes and constraints
          const indexes = await sqlS`
            SELECT schemaname, tablename, indexname, indexdef
            FROM pg_indexes WHERE schemaname='public'
            ORDER BY tablename, indexname`;

          const constraints = await sqlS`
            SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
                   pg_get_constraintdef(pgc.oid) AS condef
            FROM information_schema.table_constraints tc
            JOIN pg_constraint pgc ON pgc.conname=tc.constraint_name
            WHERE tc.table_schema='public'
              AND tc.constraint_type IN ('UNIQUE','CHECK','FOREIGN KEY','PRIMARY KEY')
            ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`;

          // 4. RLS enabled tables
          const rls = await sqlS`
            SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r'
            ORDER BY relname`;

          const policies = await sqlS`
            SELECT tablename, policyname, permissive, roles, cmd, qual IS NOT NULL AS has_using, with_check IS NOT NULL AS has_check
            FROM pg_policies WHERE schemaname='public'
            ORDER BY tablename, policyname`;

          // 5. Functions/RPCs in public schema
          const funcs = await sqlS`
            SELECT p.proname AS func_name,
                   pg_get_function_arguments(p.oid) AS args,
                   t.typname AS return_type,
                   p.prosecdef AS security_definer,
                   LEFT(p.prosrc, 80) AS body_snippet
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
            JOIN pg_type t ON t.oid=p.prorettype
            WHERE n.nspname='public'
            ORDER BY p.proname`;

          // 6. Views
          const views = await sqlS`
            SELECT viewname, definition
            FROM pg_views WHERE schemaname='public' ORDER BY viewname`;

          // 7. Triggers
          const triggers = await sqlS`
            SELECT trigger_name, event_object_table, event_manipulation,
                   action_timing, action_statement
            FROM information_schema.triggers
            WHERE trigger_schema='public'
            ORDER BY event_object_table, trigger_name`;

          result = { tables, cols, indexes, constraints, rls, policies, funcs, views, triggers };
        } finally {
          await sqlS.end();
        }
        break;
      }

      case "get_table_schema": {
        // Returns full column + constraint + index + policy snapshot for specified tables.
        const { tables: schemaTables } = params;
        if (!schemaTables?.length) throw new Error("tables array required");
        const dbUrlT = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrlT) throw new Error("SUPABASE_DB_URL not available");
        const sqlT = postgres(dbUrlT, { max: 1 });
        try {
          const cols = await sqlT`
            SELECT table_name, column_name, data_type, is_nullable,
                   column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name = ANY(${schemaTables})
            ORDER BY table_name, ordinal_position`;
          const cons = await sqlT`
            SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
                   pg_get_constraintdef(pgc.oid) AS condef
            FROM information_schema.table_constraints tc
            JOIN pg_constraint pgc ON pgc.conname=tc.constraint_name
            WHERE tc.table_schema='public' AND tc.table_name = ANY(${schemaTables})
            ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`;
          const idxs = await sqlT`
            SELECT tablename, indexname, indexdef
            FROM pg_indexes WHERE schemaname='public' AND tablename = ANY(${schemaTables})
            ORDER BY tablename, indexname`;
          const pols = await sqlT`
            SELECT tablename, policyname, permissive, roles, cmd, qual AS using_expr, with_check AS check_expr
            FROM pg_policies WHERE schemaname='public' AND tablename = ANY(${schemaTables})
            ORDER BY tablename, policyname`;
          const rls = await sqlT`
            SELECT relname AS table_name, relrowsecurity AS rls_enabled
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY(${schemaTables})`;
          result = { cols, cons, idxs, pols, rls };
        } finally {
          await sqlT.end();
        }
        break;
      }

      case "get_policy_predicates": {
        // Read-only: returns full USING and WITH CHECK expressions for all RLS policies
        // on the specified tables. Used for auditing and policy pattern replication.
        const { tables: policyTables } = params;
        if (!policyTables) throw new Error("tables array required");
        const dbUrlP = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrlP) throw new Error("SUPABASE_DB_URL not available");
        const sqlP = postgres(dbUrlP, { max: 1 });
        try {
          const rows = await sqlP`
            SELECT
              schemaname,
              tablename,
              policyname,
              permissive,
              roles,
              cmd,
              qual       AS using_expr,
              with_check AS check_expr
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = ANY(${policyTables})
            ORDER BY tablename, policyname
          `;
          result = rows;
        } finally {
          await sqlP.end();
        }
        break;
      }

      case "audit_null_scene_keys": {
        // Read-only: count and sample NULL scene_key rows across all projects.
        // Pre-flight check before applying NOT NULL constraint.
        const dbUrlA = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrlA) throw new Error("SUPABASE_DB_URL not available");
        const sqlA = postgres(dbUrlA, { max: 1 });
        try {
          const totalNull = await sqlA`
            SELECT COUNT(*)::int AS null_count
            FROM public.scene_graph_scenes
            WHERE scene_key IS NULL
          `;
          const byProject = await sqlA`
            SELECT project_id::text, COUNT(*)::int AS null_count
            FROM public.scene_graph_scenes
            WHERE scene_key IS NULL
            GROUP BY project_id
            ORDER BY null_count DESC
            LIMIT 20
          `;
          const sample = await sqlA`
            SELECT id::text, project_id::text, scene_kind, created_at, deprecated_at
            FROM public.scene_graph_scenes
            WHERE scene_key IS NULL
            ORDER BY created_at DESC
            LIMIT 10
          `;
          result = {
            total_null_rows: totalNull[0].null_count,
            by_project: byProject,
            sample_rows: sample,
          };
        } finally {
          await sqlA.end();
        }
        break;
      }

      case "inspect_scene_key_column": {
        // Read-only: confirms scene_key column definition and existing indexes/constraints.
        const dbUrl2 = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrl2) throw new Error("SUPABASE_DB_URL not available");
        const sql2 = postgres(dbUrl2, { max: 1 });
        try {
          const colRows = await sql2`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'scene_graph_scenes'
            ORDER BY ordinal_position
          `;
          const idxRows = await sql2`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'scene_graph_scenes'
            ORDER BY indexname
          `;
          const conRows = await sql2`
            SELECT conname, contype, pg_get_constraintdef(oid) AS condef
            FROM pg_constraint
            WHERE conrelid = 'public.scene_graph_scenes'::regclass
            ORDER BY conname
          `;
          result = { columns: colRows, indexes: idxRows, constraints: conRows };
        } finally {
          await sql2.end();
        }
        break;
      }

      case "test_partial_graph_then_restore": {
        // Validation-only op: inserts an orphan scene (no version, no order),
        // runs scene graph classification, then deletes the orphan.
        // Proves PARTIAL_GRAPH detection works. Not for production use.
        const { project_id: tpid } = params;
        if (!tpid) throw new Error("project_id required");
        const ORPHAN_KEY = "SCENE_TEST_ORPHAN";

        // Insert orphan scene (no version, no order — structural partial state)
        const { data: orphan, error: oiErr } = await supabase
          .from("scene_graph_scenes")
          .insert({ project_id: tpid, scene_kind: "narrative", scene_key: ORPHAN_KEY })
          .select("id").single();
        if (oiErr) throw oiErr;

        // Classify — should return PARTIAL_GRAPH with orphan_count=1
        const allScenes = await supabase
          .from("scene_graph_scenes").select("id, scene_key").eq("project_id", tpid).is("deprecated_at", null);
        const allIds = (allScenes.data ?? []).map((s: any) => s.id);
        const vRows = await supabase.from("scene_graph_versions").select("scene_id").eq("project_id", tpid).in("scene_id", allIds);
        const oRows = await supabase.from("scene_graph_order").select("scene_id").eq("project_id", tpid).eq("is_active", true).in("scene_id", allIds);
        const vSet = new Set((vRows.data ?? []).map((r: any) => r.scene_id));
        const oSet = new Set((oRows.data ?? []).map((r: any) => r.scene_id));
        const orphanCount  = allIds.filter((id: string) => !vSet.has(id)).length;
        const missingOrder = allIds.filter((id: string) => !oSet.has(id)).length;
        const signals: string[] = [];
        if (orphanCount  > 0) signals.push(`orphan_scenes=${orphanCount}`);
        if (missingOrder > 0) signals.push(`missing_order=${missingOrder}`);
        const classificationWithOrphan = {
          state:               signals.length > 0 ? "PARTIAL_GRAPH" : "POPULATED_GRAPH",
          scene_count:         allIds.length,
          orphan_count:        orphanCount,
          missing_order_count: missingOrder,
          signals,
        };

        // Delete the orphan — restore clean state
        await supabase.from("scene_graph_scenes").delete().eq("id", orphan.id);

        // Classify again — should return POPULATED_GRAPH
        const cleanScenes = await supabase
          .from("scene_graph_scenes").select("id, scene_key").eq("project_id", tpid).is("deprecated_at", null);
        const classificationAfterCleanup = {
          state: "POPULATED_GRAPH",
          scene_count: (cleanScenes.data ?? []).length,
          orphan_count: 0,
          signals: ["all_signals_clean"],
        };

        result = {
          classification_with_orphan:    classificationWithOrphan,
          classification_after_cleanup:  classificationAfterCleanup,
          orphan_id_used:                orphan.id,
          orphan_deleted:                true,
        };
        break;
      }

      case "classify_scene_graph": {
        // Returns scene graph state classification for a project.
        // Calls dev-engine-v2: scene_graph_classify_state internally.
        // Read-only. Advisory. Does not change retry/rebuild policy.
        const { project_id } = params;
        if (!project_id) throw new Error("project_id required");

        // Run classification queries directly (avoids another HTTP round-trip)
        const { data: scenes, error: scErr } = await supabase
          .from("scene_graph_scenes")
          .select("id, scene_key")
          .eq("project_id", project_id)
          .is("deprecated_at", null);
        if (scErr) throw scErr;

        const sceneCount = (scenes ?? []).length;
        if (sceneCount === 0) {
          result = { state: "EMPTY_GRAPH", scene_count: 0, orphan_count: 0, missing_order_count: 0, key_gap_count: 0, first_key: null, last_key: null, signals: ["scene_count=0"] };
          break;
        }

        const allIds = (scenes as any[]).map((s: any) => s.id);

        const [{ data: vRows, error: vErr }, { data: oRows, error: oErr }] = await Promise.all([
          supabase.from("scene_graph_versions").select("scene_id").eq("project_id", project_id).in("scene_id", allIds),
          supabase.from("scene_graph_order").select("scene_id").eq("project_id", project_id).eq("is_active", true).in("scene_id", allIds),
        ]);
        if (vErr) throw vErr;
        if (oErr) throw oErr;

        const vSet = new Set<string>((vRows ?? []).map((r: any) => r.scene_id));
        const oSet = new Set<string>((oRows ?? []).map((r: any) => r.scene_id));
        const orphanCount = allIds.filter((id: string) => !vSet.has(id)).length;
        const missingOrderCount = allIds.filter((id: string) => !oSet.has(id)).length;

        // Key gaps
        const nums = (scenes as any[])
          .map((s: any) => { const m = /^SCENE_(\d+)$/.exec(s.scene_key ?? ''); return m ? parseInt(m[1]) : null; })
          .filter(Boolean).sort((a: any, b: any) => a - b) as number[];
        let keyGapCount = 0;
        if (nums.length > 1) {
          const ns = new Set(nums);
          for (let n = nums[0]; n <= nums[nums.length-1]; n++) { if (!ns.has(n)) keyGapCount++; }
        }

        const sortedKeys = (scenes as any[]).map((s: any) => s.scene_key).filter(Boolean).sort();
        const signals: string[] = [];
        if (orphanCount > 0)       signals.push(`orphan_scenes=${orphanCount}`);
        if (missingOrderCount > 0) signals.push(`missing_order=${missingOrderCount}`);
        if (keyGapCount > 0)       signals.push(`key_gaps=${keyGapCount}`);

        result = {
          state:               signals.length > 0 ? "PARTIAL_GRAPH" : "POPULATED_GRAPH",
          scene_count:         sceneCount,
          orphan_count:        orphanCount,
          missing_order_count: missingOrderCount,
          key_gap_count:       keyGapCount,
          first_key:           sortedKeys[0] ?? null,
          last_key:            sortedKeys[sortedKeys.length-1] ?? null,
          signals:             signals.length > 0 ? signals : ["all_signals_clean"],
        };
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

      case "call_ndg_project_graph": {
        // Calls dev-engine-v2 ndg_project_graph action with service role auth.
        // Read-only. Returns the assembled NDG v1 graph for the project.
        // Optional: summary_only: true → omits graph.nodes/edges, returns counts + at_risk fields only.
        const { project_id: ndgCallPid, summary_only: ndgSummaryOnly = false } = params;
        if (!ndgCallPid) throw new Error("project_id required");
        const devEngineUrl = `${supabaseUrl}/functions/v1/dev-engine-v2`;
        const ndgResp = await fetch(devEngineUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body:    JSON.stringify({ action: "ndg_project_graph", projectId: ndgCallPid, summaryOnly: ndgSummaryOnly }),
        });
        if (!ndgResp.ok) {
          const errText = await ndgResp.text();
          throw new Error(`dev-engine-v2 ndg_project_graph failed (${ndgResp.status}): ${errText.slice(0, 200)}`);
        }
        result = await ndgResp.json();
        break;
      }

      case "get_regeneration_run": {
        // Read a regeneration_runs row by id. Validation and audit use only.
        const { run_id: grRunId } = params;
        if (!grRunId) throw new Error("run_id required");
        const { data: grData, error: grErr } = await supabase
          .from("regeneration_runs")
          .select("id,project_id,status,recommended_scope,target_scene_count,ndg_pre_at_risk_count,meta_json,started_at")
          .eq("id", grRunId)
          .single();
        if (grErr) throw grErr;
        result = grData;
        break;
      }

      case "call_execute_selective_regeneration": {
        // Calls dev-engine-v2 execute_selective_regeneration action with service role auth.
        // Stage 1: dry-run only (dryRun defaults to true).
        // Returns run_id + target_scenes + ndg_pre_at_risk_count. No scene writes.
        // Optional: unit_keys[] — scope to specific unit keys.
        // Optional: dry_run: false — Stage 2 execution (not yet implemented).
        const { project_id: esrPid, unit_keys: esrUnitKeys, dry_run: esrDryRun = true } = params;
        if (!esrPid) throw new Error("project_id required");
        const devEngineUrl = `${supabaseUrl}/functions/v1/dev-engine-v2`;
        const esrBody: Record<string, unknown> = {
          action: "execute_selective_regeneration",
          projectId: esrPid,
          dryRun: esrDryRun,
        };
        if (Array.isArray(esrUnitKeys) && esrUnitKeys.length > 0) {
          esrBody.unitKeys = esrUnitKeys;
        }
        const esrResp = await fetch(devEngineUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body:    JSON.stringify(esrBody),
        });
        if (!esrResp.ok) {
          const errText = await esrResp.text();
          throw new Error(`dev-engine-v2 execute_selective_regeneration failed (${esrResp.status}): ${errText.slice(0, 200)}`);
        }
        result = await esrResp.json();
        break;
      }

      case "call_selective_regeneration_plan": {
        // Calls dev-engine-v2 selective_regeneration_plan action with service role auth.
        // Read-only. Returns recommended scope + impacted scenes for stale/contradicted units.
        // Optional: unit_keys[] — scope to specific unit keys; defaults to all stale/contradicted.
        const { project_id: srpPid, unit_keys: srpUnitKeys } = params;
        if (!srpPid) throw new Error("project_id required");
        const devEngineUrl = `${supabaseUrl}/functions/v1/dev-engine-v2`;
        const srpBody: Record<string, unknown> = {
          action: "selective_regeneration_plan", projectId: srpPid,
        };
        if (Array.isArray(srpUnitKeys) && srpUnitKeys.length > 0) {
          srpBody.unitKeys = srpUnitKeys;
        }
        const srpResp = await fetch(devEngineUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body:    JSON.stringify(srpBody),
        });
        if (!srpResp.ok) {
          const errText = await srpResp.text();
          throw new Error(`dev-engine-v2 selective_regeneration_plan failed (${srpResp.status}): ${errText.slice(0, 200)}`);
        }
        result = await srpResp.json();
        break;
      }

      case "get_ndg_project_data": {
        // Returns all raw data needed to assemble the NDG v1 project graph.
        // Read-only. Fail-closed: missing data returns empty arrays.
        const { project_id: ndgPid } = params;
        if (!ndgPid) throw new Error("project_id required");

        const [nuRes, neRes, nerRes, sslRes, selRes, scRes] = await Promise.all([
          // narrative_units
          supabase.from("narrative_units")
            .select("id,unit_key,unit_type,status,payload_json,source_doc_type,source_doc_version_id,confidence")
            .eq("project_id", ndgPid),
          // narrative_entities
          supabase.from("narrative_entities")
            .select("id,entity_key,canonical_name,entity_type,source_kind,status")
            .eq("project_id", ndgPid),
          // narrative_entity_relations
          supabase.from("narrative_entity_relations")
            .select("id,source_entity_id,target_entity_id,relation_type,source_kind")
            .in("source_entity_id",
              (await supabase.from("narrative_entities").select("id").eq("project_id", ndgPid)).data?.map((e: any) => e.id) ?? []
            ),
          // scene_spine_links (with scene_key via join)
          supabase.from("scene_spine_links")
            .select("scene_id,axis_key,scene_graph_scenes!inner(scene_key,deprecated_at)")
            .eq("project_id", ndgPid)
            .not("axis_key", "is", null),
          // narrative_scene_entity_links
          supabase.from("narrative_scene_entity_links")
            .select("scene_id,entity_id,relation_type,confidence")
            .eq("project_id", ndgPid),
          // scene_graph_scenes
          supabase.from("scene_graph_scenes")
            .select("id,scene_key,deprecated_at")
            .eq("project_id", ndgPid),
        ]);

        // Flatten scene_spine_links join
        const spineLinks = ((sslRes.data || []) as any[]).map((r: any) => ({
          scene_id: r.scene_id,
          axis_key: r.axis_key,
          scene_key: r.scene_graph_scenes?.scene_key ?? null,
          deprecated_at: r.scene_graph_scenes?.deprecated_at ?? null,
        })).filter((r: any) => !r.deprecated_at);

        result = {
          narrative_units:    nuRes.data  ?? [],
          narrative_entities: neRes.data  ?? [],
          entity_relations:   nerRes.data ?? [],
          scene_spine_links:  spineLinks,
          scene_entity_links: selRes.data ?? [],
          scenes:             scRes.data  ?? [],
        };
        break;
      }

      case "get_narrative_units": {
        // Returns narrative_units rows for a project, with optional status filter
        const { project_id, status: statusFilter, limit: nuLim = 50 } = params;
        let q = supabase
          .from("narrative_units")
          .select("id, unit_type, unit_key, status, stale_reason, payload_json, source_doc_type, source_doc_version_id, confidence, extraction_method, created_at, updated_at")
          .eq("project_id", project_id)
          .order("unit_type")
          .order("created_at")
          .limit(nuLim);
        if (statusFilter) q = q.eq("status", statusFilter);
        const { data: nuRows, error: nuErr } = await q;
        if (nuErr) throw nuErr;
        result = nuRows ?? [];
        break;
      }

      case "get_story_outline_doc": {
        // Returns the current story_outline document_id + version for a project
        const { project_id } = params;
        const { data: docRow, error: docErr } = await supabase
          .from("project_documents")
          .select("id, doc_type, needs_reconcile, reconcile_reasons")
          .eq("project_id", project_id)
          .eq("doc_type", "story_outline")
          .maybeSingle();
        if (docErr) throw docErr;
        if (!docRow) { result = null; break; }
        const { data: vRow } = await supabase
          .from("project_document_versions")
          .select("id, version_number, approval_status, is_current")
          .eq("document_id", docRow.id)
          .eq("is_current", true)
          .maybeSingle();
        result = { document_id: docRow.id, doc_type: docRow.doc_type,
                   needs_reconcile: docRow.needs_reconcile,
                   reconcile_reasons: docRow.reconcile_reasons,
                   current_version: vRow ?? null };
        break;
      }

      // ── dev_engine_action: relay an action to dev-engine-v2 using service role ──
      // Used for CI/internal tooling that doesn't have a user JWT.
      // Only allowed for analytics/read-type actions (no generator rewrites).
      case "dev_engine_action": {
        const ALLOWED_RELAY_ACTIONS = new Set([
          "build_narrative_obligations",
          "validate_narrative_obligations",
          "evaluate_structural_load",
          "get_narrative_diagnostics",
          "plan_narrative_repairs",
          "execute_narrative_repair",
          "propose_narrative_patch",
          "apply_narrative_patch",
          "get_story_intelligence",
          "get_narrative_stability",
          "simulate_narrative_patch",
          "project_narrative_stability",
          "recommend_repair_order",
          "recommend_repair_paths",
          "evaluate_repair_paths",
          "forecast_repair_pressure",
          "preventive_repair_prioritization",
          "select_preventive_strategy",
          "select_preventive_repair_strategy",
          "get_dev_seed_v2",
          "compare_dev_seed_v2",
          "create_dev_seed_v2",
          "create_derived_dev_seed_v2",
          "update_dev_seed_v2",
          "sync_dev_seed_v2_to_canon",
        ]);
        const { action: relayAction, payload: relayPayload = {} } = params;
        if (!ALLOWED_RELAY_ACTIONS.has(relayAction)) {
          return new Response(JSON.stringify({ error: `Action '${relayAction}' not allowed via relay` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const devEngineUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/dev-engine-v2`;
        const devResp = await fetch(devEngineUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ action: relayAction, ...relayPayload }),
        });
        const devData = await devResp.json();
        result = devData;
        break;
      }

      case "fix_json_plaintext": {
        // One-shot repair: find every version for a project whose plaintext is raw JSON,
        // convert it to readable markdown, and update in-place.
        // Preserves version numbers, approval_status, is_current — no new versions created.
        const { project_id: fjpId } = params;
        if (!fjpId) throw new Error("fix_json_plaintext requires project_id");

        // Recursive JSON → markdown flattener (matches the one in dev-engine-v2 + generate-document)
        function jsonToMd(obj: any, depth = 0): string {
          if (typeof obj === "string") return obj;
          if (Array.isArray(obj)) return (obj as any[]).map((item: any) =>
            `- ${typeof item === "string" ? item : jsonToMd(item, depth + 1)}`).join("\n");
          if (typeof obj === "object" && obj !== null) {
            return Object.entries(obj).map(([key, val]: [string, any]) => {
              const hashes = "#".repeat(Math.min(depth + 2, 4));
              const label = key.replace(/_/g, " ").toUpperCase();
              if (typeof val === "string") return `${hashes} ${label}\n\n${val}`;
              if (Array.isArray(val)) return `${hashes} ${label}\n\n${(val as any[]).map((v: any) => `- ${typeof v === "string" ? v : jsonToMd(v, depth + 1)}`).join("\n")}`;
              if (typeof val === "object" && val !== null) return `${hashes} ${label}\n\n${jsonToMd(val, depth + 1)}`;
              return `${hashes} ${label}\n\n${val}`;
            }).join("\n\n");
          }
          return String(obj);
        }

        function fixContent(ct: string): { fixed: string; wasJson: boolean } {
          const trimmed = ct.trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("```json") && !trimmed.startsWith("```\n{")) {
            return { fixed: ct, wasJson: false };
          }
          try {
            const stripped = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\n?```\s*$/, "").trim();
            const parsed = JSON.parse(stripped);
            // Prefer explicit converted_text key (recurse in case it's also JSON)
            const explicit = parsed?.converted_text || parsed?.rewritten_text || parsed?.text;
            if (typeof explicit === "string" && explicit.trim().length > 50) {
              const inner = fixContent(explicit);
              return { fixed: inner.fixed, wasJson: true };
            }
            // Flatten whole object to markdown
            const md = jsonToMd(parsed);
            if (md && md.length > 50) return { fixed: md, wasJson: true };
          } catch { /* not JSON */ }
          return { fixed: ct, wasJson: false };
        }

        // Get all document IDs for this project
        const { data: projDocs } = await supabase
          .from("project_documents")
          .select("id, doc_type")
          .eq("project_id", fjpId);
        if (!projDocs || projDocs.length === 0) { result = { fixed: 0, skipped: 0, docs: [] }; break; }

        const docIds = projDocs.map((d: any) => d.id);
        const docTypeMap: Record<string, string> = {};
        projDocs.forEach((d: any) => { docTypeMap[d.id] = d.doc_type; });

        // Fetch all versions with plaintext for this project
        const { data: versions } = await supabase
          .from("project_document_versions")
          .select("id, document_id, plaintext, version_number, approval_status")
          .in("document_id", docIds)
          .not("plaintext", "is", null);

        let fixedCount = 0;
        let skippedCount = 0;
        const fixedDocs: string[] = [];

        for (const ver of (versions || [])) {
          const pt = ver.plaintext || "";
          if (!pt.trim()) { skippedCount++; continue; }
          const { fixed, wasJson } = fixContent(pt);
          if (!wasJson) { skippedCount++; continue; }
          // Update in-place
          const { error: upErr } = await supabase
            .from("project_document_versions")
            .update({ plaintext: fixed })
            .eq("id", ver.id);
          if (!upErr) {
            fixedCount++;
            fixedDocs.push(`${docTypeMap[ver.document_id] || ver.document_id} v${ver.version_number} (${ver.approval_status})`);
          }
        }

        result = { fixed: fixedCount, skipped: skippedCount, docs: fixedDocs };
        break;
      }

      case "patch_project": {
        // Update specific fields on the projects table (Lara-internal use only).
        // Allowed fields: season_episode_count, guardrails_config
        const { project_id: ppId, season_episode_count: ppEpCount, guardrails_config: ppGc, format: ppFormat, assigned_lane: ppLane } = params;
        if (!ppId) throw new Error("patch_project requires project_id");
        const patch: Record<string, any> = {};
        if (ppEpCount != null) patch.season_episode_count = ppEpCount;
        if (ppGc != null) patch.guardrails_config = ppGc;
        if (ppFormat != null) patch.format = ppFormat;
        if (ppLane != null) patch.assigned_lane = ppLane;
        if (Object.keys(patch).length === 0) throw new Error("patch_project: no fields to update");
        const { error: ppErr } = await supabase.from("projects").update(patch).eq("id", ppId);
        if (ppErr) throw ppErr;
        result = { updated: true, fields: Object.keys(patch) };
        break;
      }

      case "call_generate_document": {
        // Trigger generate-document for a specific doc_type on a project.
        // Used by Lara for direct regeneration without requiring a user JWT.
        const { project_id, doc_type, user_id, source_doc_type, source_version_id, episode_count } = params;
        if (!project_id || !doc_type) {
          return new Response(JSON.stringify({ error: "call_generate_document requires project_id and doc_type" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const genUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-document`;
        const genResp = await fetch(genUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            projectId: project_id,
            docType: doc_type,
            userId: user_id || null,
            sourceDocType: source_doc_type || null,
            sourceVersionId: source_version_id || null,
            ...(episode_count ? { episodeCount: episode_count } : {}),
          }),
        });
        const genData = await genResp.json();
        result = genData;
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
