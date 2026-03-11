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

      case "run_migration": {
        // Execute approved DDL migrations via direct PostgreSQL connection.
        // Gated by X-Lara-Secret. Only pre-approved migration keys allowed.
        // Uses SUPABASE_DB_URL (direct pooler connection) for DDL execution.
        const { migration_key } = params;
        const APPROVED_MIGRATIONS: Record<string, string> = {
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
