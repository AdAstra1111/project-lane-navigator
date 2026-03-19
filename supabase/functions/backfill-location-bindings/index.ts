import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * backfill-location-bindings — Governed backfill for canon_location_id on:
 *   1. scene_graph_versions (match location text → canon_locations.normalized_name)
 *   2. project_images where asset_group='world' (match subject_ref → canon_locations)
 *
 * Only binds exact normalized matches. Ambiguous/unresolved rows remain null.
 * Returns a structured report.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { project_id, dry_run = false } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load canon locations for this project
    const { data: canonLocs, error: locErr } = await supabase
      .from("canon_locations")
      .select("id, canonical_name, normalized_name")
      .eq("project_id", project_id)
      .eq("active", true);

    if (locErr) throw new Error(`Failed to load canon_locations: ${locErr.message}`);
    if (!canonLocs || canonLocs.length === 0) {
      return new Response(JSON.stringify({
        status: "no_canon_locations",
        report: { scenes: { scanned: 0, bound: 0, unresolved: 0, ambiguous: 0 }, images: { scanned: 0, bound: 0, unresolved: 0, ambiguous: 0 } },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build normalized lookup — detect ambiguous (multiple canon locs with same normalized name)
    const normMap = new Map<string, string[]>(); // normalized_name → [canon_location_id, ...]
    for (const loc of canonLocs) {
      const norm = loc.normalized_name;
      if (!normMap.has(norm)) normMap.set(norm, []);
      normMap.get(norm)!.push(loc.id);
    }

    function resolveCanonId(text: string): { id: string | null; status: "bound" | "unresolved" | "ambiguous" } {
      const norm = (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!norm) return { id: null, status: "unresolved" };
      const candidates = normMap.get(norm);
      if (!candidates || candidates.length === 0) return { id: null, status: "unresolved" };
      if (candidates.length > 1) return { id: null, status: "ambiguous" };
      return { id: candidates[0], status: "bound" };
    }

    // 2. Backfill scene_graph_versions
    const { data: sceneRows, error: sceneErr } = await supabase
      .from("scene_graph_versions")
      .select("id, location, canon_location_id")
      .eq("project_id", project_id)
      .is("canon_location_id", null)
      .not("location", "is", null);

    if (sceneErr) throw new Error(`Failed to load scene versions: ${sceneErr.message}`);

    const sceneReport = { scanned: sceneRows?.length || 0, bound: 0, unresolved: 0, ambiguous: 0 };
    const sceneBoundUpdates: Array<{ id: string; canon_location_id: string }> = [];

    for (const row of sceneRows || []) {
      const loc = (row.location || "").trim();
      if (!loc) { sceneReport.unresolved++; continue; }
      const result = resolveCanonId(loc);
      if (result.status === "bound" && result.id) {
        sceneBoundUpdates.push({ id: row.id, canon_location_id: result.id });
        sceneReport.bound++;
      } else if (result.status === "ambiguous") {
        sceneReport.ambiguous++;
      } else {
        sceneReport.unresolved++;
      }
    }

    // 3. Backfill project_images (world asset_group)
    const { data: imgRows, error: imgErr } = await supabase
      .from("project_images")
      .select("id, subject_ref, canon_location_id")
      .eq("project_id", project_id)
      .eq("asset_group", "world")
      .is("canon_location_id", null);

    if (imgErr) throw new Error(`Failed to load world images: ${imgErr.message}`);

    const imageReport = { scanned: imgRows?.length || 0, bound: 0, unresolved: 0, ambiguous: 0 };
    const imageBoundUpdates: Array<{ id: string; canon_location_id: string }> = [];

    for (const row of imgRows || []) {
      const ref = (row.subject_ref || "").trim();
      if (!ref) { imageReport.unresolved++; continue; }
      const result = resolveCanonId(ref);
      if (result.status === "bound" && result.id) {
        imageBoundUpdates.push({ id: row.id, canon_location_id: result.id });
        imageReport.bound++;
      } else if (result.status === "ambiguous") {
        imageReport.ambiguous++;
      } else {
        imageReport.unresolved++;
      }
    }

    // 4. Apply updates (unless dry_run)
    if (!dry_run) {
      // Batch update scenes
      for (const upd of sceneBoundUpdates) {
        await supabase
          .from("scene_graph_versions")
          .update({ canon_location_id: upd.canon_location_id })
          .eq("id", upd.id);
      }
      // Batch update images
      for (const upd of imageBoundUpdates) {
        await supabase
          .from("project_images")
          .update({ canon_location_id: upd.canon_location_id })
          .eq("id", upd.id);
      }
    }

    return new Response(JSON.stringify({
      status: dry_run ? "dry_run_complete" : "backfill_complete",
      project_id,
      dry_run,
      report: {
        scenes: sceneReport,
        images: imageReport,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[backfill-location-bindings] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
