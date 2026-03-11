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
  syncAllEntities,
  extractEntityMentionsForVersion,
  extractEntityMentionsForProject,
  syncSceneEntityLinksForProject,
  syncDialogueCharactersForProject,
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

    // ── action = 'sync_dialogue_characters' — Phase 2 Dialogue Character Detection ──
    // Extracts uppercase screenplay dialogue headings from each scene's content,
    // resolves them to NIT character entities via deterministic shorthand derivation,
    // and upserts narrative_scene_entity_links (relation_type='character_present').
    //
    // Additive to sync_scene_entity_links (canonical name scan). Together they give
    // complete coverage: exact names + dialogue headings.
    //
    // Fail-closed: no entities or no scenes → no-op, no crash.
    // Idempotent: ON CONFLICT ignoreDuplicates.
    // Does NOT modify NIT schema.
    if (action === "sync_dialogue_characters") {
      const result = await syncDialogueCharactersForProject(supabase, projectId);
      return new Response(JSON.stringify({
        project_id:          projectId,
        action:              "sync_dialogue_characters",
        scenes_processed:    result.scenes_processed,
        links_upserted:      result.links_upserted,
        characters_written:  result.characters_written,
        per_scene:           result.per_scene,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── action = 'sync_scene_entity_links' — Scene Identity v1.1 ──
    // Scans latest scene version content for exact NIT character entity names.
    // Upserts narrative_scene_entity_links (relation_type='character_present').
    // Fail-closed: empty scene graph or no NIT entities → no-op, no crash.
    if (action === "sync_scene_entity_links") {
      const result = await syncSceneEntityLinksForProject(supabase, projectId);
      return new Response(JSON.stringify({
        project_id:       projectId,
        action:           "sync_scene_entity_links",
        scenes_processed: result.scenes_processed,
        links_upserted:   result.links_upserted,
        per_scene:        result.per_scene,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── action = 'sync_mentions' — extract entity mentions for a project / specific version ──
    if (action === "sync_mentions") {
      const { documentId, versionId, docType } = body;

      // Single-version mode: documentId + versionId + docType all provided
      if (documentId && versionId && docType) {
        const result = await extractEntityMentionsForVersion(
          supabase, projectId, documentId, versionId, docType,
        );
        return new Response(JSON.stringify({
          project_id:        projectId,
          action:            "sync_mentions",
          mode:              "single_version",
          version_id:        versionId,
          doc_type:          docType,
          mentions_upserted: result.mentions_upserted,
          skipped_reason:    result.skipped_reason ?? null,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Project-wide mode: scan all current supported versions
      const result = await extractEntityMentionsForProject(supabase, projectId);
      return new Response(JSON.stringify({
        project_id:         projectId,
        action:             "sync_mentions",
        mode:               "project_wide",
        versions_processed: result.versions_processed,
        total_mentions:     result.total_mentions,
        per_version:        result.per_version,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

      const { data: mentions } = await supabase
        .from("narrative_entity_mentions")
        .select("entity_id, document_id, version_id, section_key, start_line, end_line, mention_text, match_method, confidence")
        .eq("project_id", projectId);

      return new Response(JSON.stringify({
        project_id:       projectId,
        action:           "list",
        entity_count:     (entities || []).length,
        mention_count:    (mentions || []).length,
        entities:         entities || [],
        mentions:         mentions || [],
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

    // 3. Full sync: T1 (characters) + T2/T3 (spine) + protagonist linkage + relations
    const syncResult = await syncAllEntities(supabase, projectId, canonJson, spineJson);

    // 4. Return full entity list + relations post-sync
    const { data: entities } = await supabase
      .from("narrative_entities")
      .select("*")
      .eq("project_id", projectId)
      .order("entity_type")
      .order("entity_key");

    const { data: relations } = await supabase
      .from("narrative_entity_relations")
      .select("source_entity_id, target_entity_id, relation_type, source_kind, confidence")
      .eq("project_id", projectId);

    return new Response(JSON.stringify({
      project_id:                projectId,
      action:                    "sync",
      characters_synced:         syncResult.characters_synced,
      arc_conflict_synced:       syncResult.arc_conflict_synced,
      total_synced:              syncResult.characters_synced + syncResult.arc_conflict_synced,
      protagonist_linked:        syncResult.protagonist_linked,
      protagonist_character_key: syncResult.protagonist_character_key,
      relations_created:         syncResult.relations_created,
      entity_count:              (entities || []).length,
      relation_count:            (relations || []).length,
      entities:                  entities || [],
      relations:                 relations || [],
      canon_json_present:        !!canonJson,
      spine_json_present:        !!spineJson,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[nit-sync] unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
