import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Auto Populate Visual Set — Orchestrates batch image generation
 * for all unfilled required visual slots.
 *
 * Calls generate-lookbook-image internally for each slot.
 * All images are created as candidates (never auto-approved).
 *
 * Phases:
 *   1. Character Identity (headshot, profile, full body)
 *   2. Character References (close_up, medium, etc.)
 *   3. World / Locations
 *   4. Visual Language + Key Moments
 */

// Slot types
interface SlotSpec {
  assetGroup: string;
  subject: string | null;
  shotType: string | null;
  isIdentity: boolean;
  phase: number;
}

const IDENTITY_PACK = ["identity_headshot", "identity_profile", "identity_full_body"];
const CHARACTER_REF_PACK = ["close_up", "medium", "full_body", "profile", "emotional_variant"];
const WORLD_PACK = ["wide", "atmospheric", "detail", "time_variant"];
const VISUAL_LANG_PACK = ["lighting_ref", "texture_ref", "composition_ref", "color_ref"];
const KEY_MOMENT_PACK = ["tableau", "medium", "close_up", "wide"];

const SECTION_MAP: Record<string, string> = {
  character: "character",
  world: "world",
  visual_language: "visual_language",
  key_moment: "key_moment",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      project_id,
      identity_only = false,
      use_canon_descriptions = true,
      use_approved_anchors = true,
    } = body as {
      project_id: string;
      identity_only?: boolean;
      use_canon_descriptions?: boolean;
      use_approved_anchors?: boolean;
    };

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load canon
    const { data: canon } = await supabase
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", project_id)
      .maybeSingle();

    const canonJson = canon?.canon_json as any || {};
    const characters: { name: string; description?: string }[] = [];
    const locations: { name: string; description?: string }[] = [];

    if (canonJson.characters && Array.isArray(canonJson.characters)) {
      for (const c of canonJson.characters) {
        const name = typeof c === "string" ? c.trim() : (c.name || c.character_name || "").trim();
        if (name && name !== "Unknown") {
          characters.push({
            name,
            description: typeof c === "object" ? (c.description || c.physical_description || "") : "",
          });
        }
      }
    }
    if (canonJson.locations && Array.isArray(canonJson.locations)) {
      for (const l of canonJson.locations) {
        const name = typeof l === "string" ? l.trim() : (l.name || l.location_name || "").trim();
        if (name) {
          locations.push({
            name,
            description: typeof l === "object" ? (l.description || "") : "",
          });
        }
      }
    }

    // Limit scope
    const chars = characters.slice(0, 8);
    const locs = locations.slice(0, 8);

    // Load existing images to determine what's already filled
    const { data: existingImages } = await supabase
      .from("project_images")
      .select("asset_group, subject, shot_type, generation_purpose, curation_state, is_primary")
      .eq("project_id", project_id)
      .in("curation_state", ["active", "candidate"]);

    const existing = existingImages || [];

    function hasSlot(assetGroup: string, subject: string | null, shotType: string, genPurpose?: string): boolean {
      return existing.some((img: any) =>
        img.asset_group === assetGroup &&
        (subject === null || img.subject === subject) &&
        img.shot_type === shotType &&
        (!genPurpose || img.generation_purpose === genPurpose)
      );
    }

    // Build slot manifest
    const slotsToGenerate: SlotSpec[] = [];

    // Phase 1: Character Identity
    for (const char of chars) {
      for (const shotType of IDENTITY_PACK) {
        if (!hasSlot("character", char.name, shotType, "character_identity")) {
          slotsToGenerate.push({
            assetGroup: "character",
            subject: char.name,
            shotType,
            isIdentity: true,
            phase: 1,
          });
        }
      }
    }

    if (!identity_only) {
      // Phase 2: Character References
      for (const char of chars) {
        for (const shotType of CHARACTER_REF_PACK) {
          if (!hasSlot("character", char.name, shotType)) {
            slotsToGenerate.push({
              assetGroup: "character",
              subject: char.name,
              shotType,
              isIdentity: false,
              phase: 2,
            });
          }
        }
      }

      // Phase 3: World / Locations
      for (const loc of locs) {
        for (const shotType of WORLD_PACK) {
          if (!hasSlot("world", loc.name, shotType)) {
            slotsToGenerate.push({
              assetGroup: "world",
              subject: loc.name,
              shotType,
              isIdentity: false,
              phase: 3,
            });
          }
        }
      }

      // Phase 4: Visual Language
      for (const shotType of VISUAL_LANG_PACK) {
        if (!hasSlot("visual_language", null, shotType)) {
          slotsToGenerate.push({
            assetGroup: "visual_language",
            subject: null,
            shotType,
            isIdentity: false,
            phase: 4,
          });
        }
      }

      // Phase 4: Key Moments
      for (const shotType of KEY_MOMENT_PACK) {
        if (!hasSlot("key_moment", null, shotType)) {
          slotsToGenerate.push({
            assetGroup: "key_moment",
            subject: null,
            shotType,
            isIdentity: false,
            phase: 4,
          });
        }
      }
    }

    // Sort by phase
    slotsToGenerate.sort((a, b) => a.phase - b.phase);

    if (slotsToGenerate.length === 0) {
      return new Response(JSON.stringify({
        status: "complete",
        message: "All slots already have candidates",
        generated: 0,
        total_slots: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load identity anchors for character reference shots (phase 2+)
    const identityAnchors: Record<string, { headshot?: string; fullBody?: string }> = {};
    if (use_approved_anchors) {
      const { data: anchorImages } = await supabase
        .from("project_images")
        .select("subject, shot_type, storage_path, is_primary")
        .eq("project_id", project_id)
        .eq("asset_group", "character")
        .eq("generation_purpose", "character_identity")
        .in("curation_state", ["active", "candidate"])
        .in("shot_type", ["identity_headshot", "identity_full_body"]);

      if (anchorImages) {
        for (const img of anchorImages) {
          const sub = img.subject as string;
          if (!sub) continue;
          if (!identityAnchors[sub]) identityAnchors[sub] = {};
          if (img.shot_type === "identity_headshot") {
            identityAnchors[sub].headshot = img.storage_path as string;
          } else if (img.shot_type === "identity_full_body") {
            identityAnchors[sub].fullBody = img.storage_path as string;
          }
        }
      }
    }

    // Generate in order — call generate-lookbook-image for each slot
    const results: Array<{
      slot_key: string;
      phase: number;
      status: string;
      image_id?: string;
      error?: string;
    }> = [];

    const functionUrl = `${supabaseUrl}/functions/v1/generate-lookbook-image`;

    for (const slot of slotsToGenerate) {
      const slotKey = `${slot.assetGroup}:${slot.subject || '_'}:${slot.shotType}`;
      const section = SECTION_MAP[slot.assetGroup] || "character";

      // Build request body for generate-lookbook-image
      // CRITICAL: Always pass forced_shot_type for deterministic single-slot generation
      const genBody: Record<string, any> = {
        project_id,
        section,
        count: 1,
        asset_group: slot.assetGroup,
        pack_mode: false,
        forced_shot_type: slot.shotType, // Deterministic — generates exactly this shot type
      };

      if (slot.isIdentity && slot.assetGroup === "character") {
        // Identity shots use identity prompts via forced_shot_type + character_name
        genBody.character_name = slot.subject;
        // No identity_mode needed — forced_shot_type + isIdentityShot triggers identity prompt
      } else if (slot.assetGroup === "character") {
        genBody.character_name = slot.subject;
      } else if (slot.assetGroup === "world") {
        genBody.location_name = slot.subject;
      }

      // Use canon descriptions as identity notes
      if (use_canon_descriptions && slot.subject) {
        const charMatch = chars.find(c => c.name === slot.subject);
        const locMatch = locs.find(l => l.name === slot.subject);
        if (charMatch?.description) {
          genBody.identity_canon_facts = charMatch.description;
        }
        if (locMatch?.description) {
          genBody.location_description = locMatch.description;
        }
      }

      // Attach identity anchors for non-identity character shots
      if (!slot.isIdentity && slot.assetGroup === "character" && slot.subject && identityAnchors[slot.subject]) {
        genBody.identity_anchor_paths = identityAnchors[slot.subject];
      }

      try {
        const resp = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader || "",
            apikey: anonKey,
          },
          body: JSON.stringify(genBody),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`[auto-populate] Slot ${slotKey} failed [${resp.status}]:`, errText);
          results.push({ slot_key: slotKey, phase: slot.phase, status: "failed", error: errText });
          continue;
        }

        const data = await resp.json();
        const firstResult = data.results?.[0];
        if (firstResult?.status === "ready") {
          results.push({
            slot_key: slotKey,
            phase: slot.phase,
            status: "generated",
            image_id: firstResult.image_id,
          });
        } else {
          results.push({
            slot_key: slotKey,
            phase: slot.phase,
            status: firstResult?.status || "unknown",
            error: firstResult?.error,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[auto-populate] Slot ${slotKey} error:`, msg);
        results.push({ slot_key: slotKey, phase: slot.phase, status: "error", error: msg });
      }
    }

    const generated = results.filter(r => r.status === "generated").length;
    const failed = results.filter(r => r.status !== "generated").length;

    return new Response(JSON.stringify({
      status: generated > 0 ? "partial" : "failed",
      generated,
      failed,
      total_slots: slotsToGenerate.length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[auto-populate] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
