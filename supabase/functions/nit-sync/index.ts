// nit-sync/index.ts
// NIT v1 — On-demand full entity sync for a project.
//
// Actions:
//   sync  — read project_canon + narrative_spine_json, run T1+T2+T3, return entity list
//   list  — return all narrative_entities for project (no sync)
//
// This function is the canonical entry point for populating NIT entities on new
// or existing projects. It does NOT use dormant canon_units tables.
//
// POST body: { projectId: string, action?: 'sync' | 'list' }
// Default action: 'sync'

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  syncCanonEntities,
  syncSpineEntities,
} from "../_shared/narrativeEntityEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body       = await req.json();
    const projectId  = body?.projectId as string | undefined;
    const action     = (body?.action as string | undefined) ?? "sync";

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list") {
      // Return current entity registry without syncing
      const { data: entities, error: listErr } = await supabase
        .from("narrative_entities")
        .select("*")
        .eq("project_id", projectId)
        .order("entity_type")
        .order("entity_key");

      if (listErr) {
        return new Response(JSON.stringify({ error: listErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        project_id:       projectId,
        action:           "list",
        entity_count:     (entities || []).length,
        entities:         entities || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── action = 'sync' ──────────────────────────────────────────────────

    // 1. Load project_canon.canon_json
    const { data: canonRow } = await supabase
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();

    const canonJson = canonRow?.canon_json ?? null;

    // 2. Load projects.narrative_spine_json
    const { data: projectRow } = await supabase
      .from("projects")
      .select("narrative_spine_json")
      .eq("id", projectId)
      .maybeSingle();

    const spineJson = projectRow?.narrative_spine_json ?? null;

    // 3. T1 — sync character entities from canon
    const t1 = await syncCanonEntities(supabase, projectId, canonJson);

    // 4. T2+T3 — sync arc + conflict entities from spine
    const t2t3 = await syncSpineEntities(supabase, projectId, spineJson);

    const totalSynced = t1.synced + t2t3.synced;

    // 5. Return full entity list post-sync
    const { data: entities } = await supabase
      .from("narrative_entities")
      .select("*")
      .eq("project_id", projectId)
      .order("entity_type")
      .order("entity_key");

    return new Response(JSON.stringify({
      project_id:              projectId,
      action:                  "sync",
      characters_synced:       t1.synced,
      arc_conflict_synced:     t2t3.synced,
      total_synced:            totalSynced,
      entity_count:            (entities || []).length,
      entities:                entities || [],
      canon_json_present:      !!canonJson,
      spine_json_present:      !!spineJson,
      t1_error:                t1.error ?? null,
      t2t3_error:              t2t3.error ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[nit-sync] unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
