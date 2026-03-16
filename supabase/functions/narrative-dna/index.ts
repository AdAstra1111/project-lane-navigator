/**
 * narrative-dna — Edge function for Narrative DNA extraction and management.
 *
 * Actions:
 *   - extract: extract DNA from source text → create profile
 *   - get: fetch profile by id
 *   - list: list user's profiles
 *   - update: edit extracted fields (while not locked)
 *   - lock: lock profile (immutable after)
 *
 * Phase 1 only — does NOT wire into DevSeed, pitch_ideas, or project canon.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { extractNarrativeDna, computeTextHash } from "../_shared/narrativeDnaExtractor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const bearer = req.headers.get("Authorization");
    if (!bearer) return jsonRes({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client for ownership enforcement
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: bearer } },
    });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonRes({ error: "Unauthorized" }, 401);

    // Service client for writes (RLS may block user-scoped inserts on new tables)
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action } = body;

    // ── EXTRACT ──────────────────────────────────────────────────────────────
    if (action === "extract") {
      const {
        source_title,
        source_type = "public_domain",
        source_text,
        source_corpus_script_id,
        source_ref_json,
      } = body;

      if (!source_title || typeof source_title !== "string") {
        return jsonRes({ error: "source_title is required" }, 400);
      }
      if (!source_text || typeof source_text !== "string") {
        return jsonRes({ error: "source_text is required" }, 400);
      }
      if (source_text.length < 2000) {
        return jsonRes({ error: "source_text must be at least 2,000 characters for reliable extraction" }, 400);
      }

      console.log(`[narrative-dna][extract] Starting: "${source_title}" (${source_text.length} chars)`);

      const textHash = await computeTextHash(source_text);
      const extraction = await extractNarrativeDna(source_text);

      console.log(`[narrative-dna][extract] Complete: confidence=${extraction.extraction_confidence}, spine_axes=${Object.values(extraction.spine_json).filter(Boolean).length}/9`);

      const { data: profile, error: insertErr } = await serviceClient
        .from("narrative_dna_profiles")
        .insert({
          user_id: user.id,
          source_title,
          source_type,
          source_corpus_script_id: source_corpus_script_id || null,
          source_text_hash: textHash,
          source_text_length: source_text.length,
          source_ref_json: source_ref_json || {},
          spine_json: extraction.spine_json,
          escalation_architecture: extraction.escalation_architecture,
          antagonist_pattern: extraction.antagonist_pattern,
          thematic_spine: extraction.thematic_spine,
          emotional_cadence: extraction.emotional_cadence,
          world_logic_rules: extraction.world_logic_rules,
          set_piece_grammar: extraction.set_piece_grammar,
          ending_logic: extraction.ending_logic,
          power_dynamic: extraction.power_dynamic,
          forbidden_carryovers: extraction.forbidden_carryovers,
          mutable_variables: extraction.mutable_variables,
          surface_expression_notes: extraction.surface_expression_notes,
          extraction_json: extraction.extraction_json,
          extraction_model: "google/gemini-2.5-flash",
          extraction_confidence: extraction.extraction_confidence,
          status: "extracted",
        })
        .select("*")
        .single();

      if (insertErr) {
        console.error(`[narrative-dna][extract] Insert failed:`, insertErr.message);
        return jsonRes({ error: `Failed to save profile: ${insertErr.message}` }, 500);
      }

      return jsonRes({ success: true, profile });
    }

    // ── GET ───────────────────────────────────────────────────────────────────
    if (action === "get") {
      const { id } = body;
      if (!id) return jsonRes({ error: "id is required" }, 400);

      const { data: profile, error } = await supabase
        .from("narrative_dna_profiles")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (error || !profile) return jsonRes({ error: "Profile not found" }, 404);
      return jsonRes({ profile });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { data: profiles, error } = await supabase
        .from("narrative_dna_profiles")
        .select("id, source_title, source_type, status, extraction_confidence, created_at, updated_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ profiles: profiles || [] });
    }

    // ── UPDATE ───────────────────────────────────────────────────────────────
    if (action === "update") {
      const { id, updates } = body;
      if (!id) return jsonRes({ error: "id is required" }, 400);
      if (!updates || typeof updates !== "object") return jsonRes({ error: "updates object is required" }, 400);

      // Fetch current to enforce ownership + lock
      const { data: existing, error: fetchErr } = await supabase
        .from("narrative_dna_profiles")
        .select("id, status, user_id")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !existing) return jsonRes({ error: "Profile not found" }, 404);
      if (existing.status === "locked") return jsonRes({ error: "Cannot edit a locked profile" }, 403);

      // Allowlist of editable fields
      const EDITABLE = new Set([
        "source_title", "spine_json",
        "escalation_architecture", "antagonist_pattern", "thematic_spine",
        "emotional_cadence", "world_logic_rules", "set_piece_grammar",
        "ending_logic", "power_dynamic",
        "forbidden_carryovers", "mutable_variables", "surface_expression_notes",
      ]);

      const safeUpdates: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates)) {
        if (EDITABLE.has(key)) safeUpdates[key] = val;
      }

      if (Object.keys(safeUpdates).length === 0) {
        return jsonRes({ error: "No editable fields provided" }, 400);
      }

      const { data: updated, error: updateErr } = await serviceClient
        .from("narrative_dna_profiles")
        .update(safeUpdates)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (updateErr) return jsonRes({ error: updateErr.message }, 500);
      return jsonRes({ success: true, profile: updated });
    }

    // ── LOCK ─────────────────────────────────────────────────────────────────
    if (action === "lock") {
      const { id } = body;
      if (!id) return jsonRes({ error: "id is required" }, 400);

      const { data: existing, error: fetchErr } = await supabase
        .from("narrative_dna_profiles")
        .select("id, status, user_id")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !existing) return jsonRes({ error: "Profile not found" }, 404);
      if (existing.status === "locked") return jsonRes({ error: "Profile is already locked" }, 400);

      const { data: locked, error: lockErr } = await serviceClient
        .from("narrative_dna_profiles")
        .update({ status: "locked", locked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (lockErr) return jsonRes({ error: lockErr.message }, 500);

      console.log(`[narrative-dna][lock] Profile locked: ${id}`);
      return jsonRes({ success: true, profile: locked });
    }

    // ── LIST_SOURCES ──────────────────────────────────────────────────────
    if (action === "list_sources") {
      const { dna_profile_id } = body;
      if (!dna_profile_id) return jsonRes({ error: "dna_profile_id is required" }, 400);

      const { data: links, error } = await supabase
        .from("dna_source_links")
        .select("*")
        .eq("dna_profile_id", dna_profile_id)
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ links: links || [] });
    }

    // ── ADD_SOURCE ────────────────────────────────────────────────────────
    if (action === "add_source") {
      const { dna_profile_id, source_label, source_url, source_type = "other", is_primary = false, notes = "" } = body;
      if (!dna_profile_id) return jsonRes({ error: "dna_profile_id is required" }, 400);
      if (!source_label || typeof source_label !== "string") return jsonRes({ error: "source_label is required" }, 400);
      if (!source_url || typeof source_url !== "string") return jsonRes({ error: "source_url is required" }, 400);

      try { new URL(source_url); } catch { return jsonRes({ error: "source_url must be a valid URL" }, 400); }

      // Verify ownership of the DNA profile
      const { data: profile, error: pErr } = await supabase
        .from("narrative_dna_profiles")
        .select("id")
        .eq("id", dna_profile_id)
        .eq("user_id", user.id)
        .single();
      if (pErr || !profile) return jsonRes({ error: "DNA profile not found" }, 404);

      // If marking as primary, clear existing primary
      if (is_primary) {
        await serviceClient
          .from("dna_source_links")
          .update({ is_primary: false })
          .eq("dna_profile_id", dna_profile_id)
          .eq("user_id", user.id)
          .eq("is_primary", true);
      }

      const { data: link, error: insertErr } = await serviceClient
        .from("dna_source_links")
        .insert({
          dna_profile_id,
          user_id: user.id,
          source_label: source_label.trim(),
          source_url: source_url.trim(),
          source_type,
          is_primary,
          notes: notes || "",
        })
        .select("*")
        .single();

      if (insertErr) return jsonRes({ error: insertErr.message }, 500);
      return jsonRes({ success: true, link });
    }

    // ── UPDATE_SOURCE ─────────────────────────────────────────────────────
    if (action === "update_source") {
      const { id, updates } = body;
      if (!id) return jsonRes({ error: "id is required" }, 400);
      if (!updates || typeof updates !== "object") return jsonRes({ error: "updates object is required" }, 400);

      // Verify ownership
      const { data: existing, error: fErr } = await supabase
        .from("dna_source_links")
        .select("id, dna_profile_id")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (fErr || !existing) return jsonRes({ error: "Source link not found" }, 404);

      const EDITABLE = new Set(["source_label", "source_url", "source_type", "is_primary", "notes"]);
      const safeUpdates: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates)) {
        if (EDITABLE.has(key)) safeUpdates[key] = val;
      }
      if (Object.keys(safeUpdates).length === 0) return jsonRes({ error: "No editable fields provided" }, 400);

      // Validate URL if provided
      if (safeUpdates.source_url) {
        try { new URL(safeUpdates.source_url); } catch { return jsonRes({ error: "source_url must be a valid URL" }, 400); }
      }

      // If setting primary, clear others first
      if (safeUpdates.is_primary === true) {
        await serviceClient
          .from("dna_source_links")
          .update({ is_primary: false })
          .eq("dna_profile_id", existing.dna_profile_id)
          .eq("user_id", user.id)
          .eq("is_primary", true);
      }

      const { data: updated, error: uErr } = await serviceClient
        .from("dna_source_links")
        .update(safeUpdates)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (uErr) return jsonRes({ error: uErr.message }, 500);
      return jsonRes({ success: true, link: updated });
    }

    // ── REMOVE_SOURCE ─────────────────────────────────────────────────────
    if (action === "remove_source") {
      const { id } = body;
      if (!id) return jsonRes({ error: "id is required" }, 400);

      const { error: dErr } = await serviceClient
        .from("dna_source_links")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (dErr) return jsonRes({ error: dErr.message }, 500);
      return jsonRes({ success: true });
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[narrative-dna] Error:", err.message);
    return jsonRes({ error: err.message || "Internal server error" }, 500);
  }
});
