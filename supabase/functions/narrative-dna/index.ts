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
import {
  extractNarrativeDna,
  extractNarrativeDnaChunked,
  computeTextHash,
  SINGLE_PASS_THRESHOLD,
  type ExtractionRunMeta,
} from "../_shared/narrativeDnaExtractor.ts";

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
        source_text: rawSourceText,
        source_url,
        source_corpus_script_id,
        source_ref_json,
      } = body;

      if (!source_title || typeof source_title !== "string" || !source_title.trim()) {
        return jsonRes({ error: "source_title is required" }, 400);
      }

      let resolvedText: string;
      let resolvedUrl: string | null = null;

      // ── URL mode: fetch text from URL ──
      if (source_url && typeof source_url === "string" && source_url.trim()) {
        const trimmedUrl = source_url.trim();
        let parsed: URL;
        try {
          parsed = new URL(trimmedUrl);
        } catch {
          return jsonRes({ error: "source_url must be a valid URL" }, 400);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return jsonRes({ error: "source_url must use http or https protocol" }, 400);
        }
        resolvedUrl = trimmedUrl;

        console.log(`[narrative-dna][extract] Fetching URL: ${trimmedUrl}`);
        let fetchRes: Response;
        try {
          fetchRes = await fetch(trimmedUrl, {
            headers: {
              "User-Agent": "IFFY-NarrativeDNA/1.0 (text extraction)",
              "Accept": "text/html, text/plain, */*",
            },
            redirect: "follow",
          });
        } catch (fetchErr: any) {
          console.error(`[narrative-dna][extract] Fetch failed:`, fetchErr.message);
          return jsonRes({ error: `Failed to fetch URL: ${fetchErr.message}` }, 502);
        }

        if (!fetchRes.ok) {
          const statusText = fetchRes.statusText || `status ${fetchRes.status}`;
          await fetchRes.text(); // consume body
          return jsonRes({ error: `URL returned ${statusText} (${fetchRes.status})` }, 502);
        }

        const contentType = fetchRes.headers.get("content-type") || "";
        const rawBody = await fetchRes.text();

        if (contentType.includes("text/html")) {
          // Strip HTML tags, scripts, styles to extract readable text
          resolvedText = rawBody
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
            .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
            .replace(/<header[\s\S]*?<\/header>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, " ")
            .trim();
        } else {
          // Plain text or other — use as-is
          resolvedText = rawBody.trim();
        }

        console.log(`[narrative-dna][extract] Fetched ${rawBody.length} raw chars → ${resolvedText.length} extracted chars`);

        if (resolvedText.length < 2000) {
          return jsonRes({
            error: `Extracted text from URL is only ${resolvedText.length.toLocaleString()} characters — minimum 2,000 required for reliable extraction. The page may have too little content or be dynamically rendered.`,
          }, 400);
        }

      // ── Text mode: use raw pasted text ──
      } else if (rawSourceText && typeof rawSourceText === "string") {
        resolvedText = rawSourceText;
        if (resolvedText.length < 2000) {
          return jsonRes({ error: "source_text must be at least 2,000 characters for reliable extraction" }, 400);
        }
      } else {
        return jsonRes({ error: "Either source_text or source_url is required" }, 400);
      }

      console.log(`[narrative-dna][extract] Starting: "${source_title}" (${resolvedText.length} chars, url=${resolvedUrl ? "yes" : "no"})`);

      const textHash = await computeTextHash(resolvedText);

      // Deterministic routing: single-pass vs chunked
      const useChunked = resolvedText.length > SINGLE_PASS_THRESHOLD;
      let extraction: any;
      let runMeta: ExtractionRunMeta;

      if (useChunked) {
        console.log(`[narrative-dna][extract] Large text (${resolvedText.length} chars) → chunked extraction`);
        const chunkedResult = await extractNarrativeDnaChunked(resolvedText);
        extraction = chunkedResult.result;
        runMeta = chunkedResult.runMeta;
      } else {
        console.log(`[narrative-dna][extract] Standard text (${resolvedText.length} chars) → single-pass extraction`);
        extraction = await extractNarrativeDna(resolvedText);
        runMeta = {
          extraction_mode: "single_pass" as const,
          normalized_text_length: resolvedText.length,
          chunk_count: 1,
          chunk_boundaries: [{ index: 0, start: 0, end: resolvedText.length, charCount: resolvedText.length }],
          chunk_signals: [],
          synthesis_model: null,
        };
      }

      console.log(`[narrative-dna][extract] Complete: mode=${runMeta.extraction_mode}, chunks=${runMeta.chunk_count}, confidence=${extraction.extraction_confidence}, spine_axes=${Object.values(extraction.spine_json).filter(Boolean).length}/9`);

      const { data: profile, error: insertErr } = await serviceClient
        .from("narrative_dna_profiles")
        .insert({
          user_id: user.id,
          source_title: source_title.trim(),
          source_type,
          source_corpus_script_id: source_corpus_script_id || null,
          source_text_hash: textHash,
          source_text_length: resolvedText.length,
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
          primary_engine_key: extraction.primary_engine_key,
          secondary_engine_key: extraction.secondary_engine_key,
          status: "extracted",
        })
        .select("*")
        .single();

      if (insertErr) {
        console.error(`[narrative-dna][extract] Insert failed:`, insertErr.message);
        return jsonRes({ error: `Failed to save profile: ${insertErr.message}` }, 500);
      }

      // Persist extraction run for provenance
      if (profile) {
        const { error: runErr } = await serviceClient
          .from("dna_extraction_runs")
          .insert({
            dna_profile_id: profile.id,
            user_id: user.id,
            source_url: resolvedUrl,
            source_mode: resolvedUrl ? "url" : "text",
            extraction_mode: runMeta.extraction_mode,
            normalized_text_length: runMeta.normalized_text_length,
            chunk_count: runMeta.chunk_count,
            chunk_boundaries: runMeta.chunk_boundaries,
            chunk_signals: runMeta.chunk_signals,
            synthesis_model: runMeta.synthesis_model,
            provenance: {
              text_hash: textHash,
              source_title: source_title.trim(),
              source_type,
              threshold_used: SINGLE_PASS_THRESHOLD,
              extraction_model: "google/gemini-2.5-flash",
              synthesis_model: runMeta.synthesis_model,
            },
            status: "completed",
          });
        if (runErr) {
          console.error(`[narrative-dna][extract] Run metadata insert failed (non-fatal):`, runErr.message);
        } else {
          console.log(`[narrative-dna][extract] Run metadata persisted (mode=${runMeta.extraction_mode}, chunks=${runMeta.chunk_count})`);
        }
      }

      // Auto-create primary source link if extraction was from URL
      if (resolvedUrl && profile) {
        const { error: linkErr } = await serviceClient
          .from("dna_source_links")
          .insert({
            dna_profile_id: profile.id,
            user_id: user.id,
            source_label: source_title.trim(),
            source_url: resolvedUrl,
            source_type: source_type === "public_domain" ? "public_domain_text" : "other",
            is_primary: true,
            notes: `Auto-created from URL extraction (${resolvedText.length.toLocaleString()} chars, ${runMeta.extraction_mode})`,
          });
        if (linkErr) {
          console.error(`[narrative-dna][extract] Source link insert failed (non-fatal):`, linkErr.message);
        } else {
          console.log(`[narrative-dna][extract] Primary source link created for ${resolvedUrl}`);
        }
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
        .select("id, source_title, source_type, status, extraction_confidence, primary_engine_key, secondary_engine_key, created_at, updated_at")
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

    // ── LIST_ENGINES ──────────────────────────────────────────────────────
    if (action === "list_engines") {
      const { data: engines, error } = await supabase
        .from("narrative_engines")
        .select("*")
        .order("engine_key", { ascending: true });

      if (error) return jsonRes({ error: error.message }, 500);

      // Get profile counts per engine
      const { data: profiles } = await supabase
        .from("narrative_dna_profiles")
        .select("primary_engine_key")
        .eq("user_id", user.id);

      const counts: Record<string, number> = {};
      for (const p of (profiles || [])) {
        if (p.primary_engine_key) {
          counts[p.primary_engine_key] = (counts[p.primary_engine_key] || 0) + 1;
        }
      }

      return jsonRes({
        engines: (engines || []).map((e: any) => ({
          ...e,
          profile_count: counts[e.engine_key] || 0,
        })),
      });
    }

    // ── GET_ENGINE ────────────────────────────────────────────────────────
    if (action === "get_engine") {
      const { engine_key } = body;
      if (!engine_key) return jsonRes({ error: "engine_key is required" }, 400);

      const { data: engine, error } = await supabase
        .from("narrative_engines")
        .select("*")
        .eq("engine_key", engine_key)
        .single();

      if (error || !engine) return jsonRes({ error: "Engine not found" }, 404);

      const { data: profiles } = await supabase
        .from("narrative_dna_profiles")
        .select("id, source_title, source_type, status, extraction_confidence, primary_engine_key, secondary_engine_key, created_at")
        .eq("user_id", user.id)
        .or(`primary_engine_key.eq.${engine_key},secondary_engine_key.eq.${engine_key}`)
        .order("created_at", { ascending: false });

      return jsonRes({ engine, profiles: profiles || [] });
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
      if (!source_label || typeof source_label !== "string" || !source_label.trim()) return jsonRes({ error: "source_label is required" }, 400);
      if (!source_url || typeof source_url !== "string" || !source_url.trim()) return jsonRes({ error: "source_url is required" }, 400);

      try {
        const parsed = new URL(source_url.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return jsonRes({ error: "source_url must use http or https protocol" }, 400);
        }
      } catch { return jsonRes({ error: "source_url must be a valid URL" }, 400); }

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
      if (safeUpdates.source_url != null) {
        if (typeof safeUpdates.source_url !== "string" || !safeUpdates.source_url.trim()) {
          return jsonRes({ error: "source_url cannot be empty" }, 400);
        }
        try {
          const parsed = new URL(safeUpdates.source_url.trim());
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return jsonRes({ error: "source_url must use http or https protocol" }, 400);
          }
        } catch { return jsonRes({ error: "source_url must be a valid URL" }, 400); }
      }
      // Validate label if provided
      if (safeUpdates.source_label != null) {
        if (typeof safeUpdates.source_label !== "string" || !safeUpdates.source_label.trim()) {
          return jsonRes({ error: "source_label cannot be empty" }, 400);
        }
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

    // ── RECLASSIFY ── DNA → ENGINE reclassification for legacy profiles ──
    if (action === "reclassify") {
      const { id } = body;
      if (!id) return jsonRes({ error: "profile id is required" }, 400);

      // Fetch the profile with all structural fields
      const { data: profile, error: pErr } = await supabase
        .from("narrative_dna_profiles")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (pErr || !profile) return jsonRes({ error: "Profile not found" }, 404);

      // Fetch all engines with structural traits
      const { data: engines } = await serviceClient
        .from("narrative_engines")
        .select("engine_key, engine_name, structural_traits, antagonist_topology, escalation_pattern, protagonist_pressure_mode, spatial_logic, structural_pattern, active")
        .eq("active", true)
        .order("engine_key");

      if (!engines || engines.length === 0) {
        return jsonRes({ error: "No active engines found in taxonomy" }, 500);
      }

      // Build structural fingerprint from DNA fields
      const spine = profile.spine_json || {};
      const fingerprint = {
        story_engine: spine.story_engine || null,
        protagonist_arc: spine.protagonist_arc || null,
        central_conflict: spine.central_conflict || null,
        pressure_system: spine.pressure_system || null,
        stakes_class: spine.stakes_class || null,
        resolution_type: spine.resolution_type || null,
        escalation_architecture: profile.escalation_architecture || null,
        antagonist_pattern: profile.antagonist_pattern || null,
        power_dynamic: profile.power_dynamic || null,
        ending_logic: profile.ending_logic || null,
        thematic_spine: profile.thematic_spine || null,
      };

      // Use LLM to classify based on structural fingerprint + engine taxonomy
      const { resolveGateway, callLLMWithJsonRetry, MODELS } = await import("../_shared/llm.ts");

      const engineDescriptions = engines.map((e: any) => {
        const traits = e.structural_traits || {};
        return `- ${e.engine_key}: ${e.engine_name}\n  Pattern: ${e.structural_pattern || e.description || "N/A"}\n  Traits: containment=${traits.containment || "?"}, isolation=${traits.isolation || "?"}, escalation=${traits.escalation_topology || "?"}, adversary=${traits.adversary_sequencing || "?"}, pressure=${traits.pressure_architecture || "?"}, moral_fracture=${traits.moral_fracture || "?"}\n  Antagonist topology: ${e.antagonist_topology || "N/A"}\n  Escalation: ${e.escalation_pattern || "N/A"}\n  Protagonist pressure: ${e.protagonist_pressure_mode || "N/A"}`;
      }).join("\n\n");

      const classificationPrompt = `You are a structural narrative analyst. Given a DNA structural fingerprint from a source story, classify it into one or more narrative engine families.

IMPORTANT: Classify based on DEEP STRUCTURAL PATTERNS, not surface content (genre, setting, creatures, era).
For example, Beowulf and Die Hard may share the same engine (survival_against_intruder / siege escalation) despite radically different surface content, because both involve:
- contained defender vs escalating adversaries
- wave-based confrontation structure
- sacrifice/survival pressure architecture

DNA STRUCTURAL FINGERPRINT:
${JSON.stringify(fingerprint, null, 2)}

Source title: ${profile.source_title}
Thematic spine: ${profile.thematic_spine || "N/A"}

AVAILABLE ENGINE FAMILIES:
${engineDescriptions}

Return JSON only:
{
  "primary_engine_key": "<best matching engine_key>",
  "secondary_engine_key": "<second best engine_key or null>",
  "candidate_engines": [
    {"engine_key": "<key>", "confidence": <0.0-1.0>, "matched_traits": ["trait1", "trait2"], "rejected_traits": ["trait3"]}
  ],
  "classification_rationale": "<2-3 sentences explaining WHY this structural pattern matches, referencing specific DNA traits>",
  "ambiguity_flags": ["<flag if classification is uncertain>"],
  "classification_version": "v1_structural"
}

Rules:
- candidate_engines must include ALL engines ranked by fit, top 3-5 minimum
- confidence must reflect genuine structural match quality
- if the match is ambiguous, say so in ambiguity_flags
- primary_engine_key MUST be from the available engine keys
- DO NOT classify based on genre, setting, or surface imagery`;

      const gw = resolveGateway();
      const classificationResult = await callLLMWithJsonRetry(
        {
          apiKey: gw.apiKey,
          model: MODELS.BALANCED,
          system: "You are a structural narrative classification engine. Return only valid JSON.",
          user: classificationPrompt,
          temperature: 0.2,
          maxTokens: 4000,
        },
        {
          handler: "dna_engine_reclassify",
          validate: (obj: any): obj is any => {
            if (!obj || typeof obj.primary_engine_key !== "string") return false;
            if (!Array.isArray(obj.candidate_engines)) return false;
            return true;
          },
        },
      );

      if (!classificationResult) {
        return jsonRes({ error: "Engine classification failed after retries" }, 500);
      }

      // Validate engine keys
      const { CANONICAL_ENGINE_KEYS } = await import("../_shared/narrativeDnaExtractor.ts");
      const validKeys = new Set(CANONICAL_ENGINE_KEYS as readonly string[]);

      const primaryKey = validKeys.has(classificationResult.primary_engine_key)
        ? classificationResult.primary_engine_key
        : null;
      const secondaryKey = classificationResult.secondary_engine_key && validKeys.has(classificationResult.secondary_engine_key)
        ? classificationResult.secondary_engine_key
        : null;

      if (!primaryKey) {
        console.warn(`[narrative-dna][reclassify] LLM returned invalid primary_engine_key: ${classificationResult.primary_engine_key}`);
        return jsonRes({
          error: "Classification returned invalid engine key",
          classification: classificationResult,
        }, 422);
      }

      // Persist reclassification
      const previousPrimary = profile.primary_engine_key;
      const previousSecondary = profile.secondary_engine_key;

      const { data: updated, error: uErr } = await serviceClient
        .from("narrative_dna_profiles")
        .update({
          primary_engine_key: primaryKey,
          secondary_engine_key: secondaryKey,
        })
        .eq("id", id)
        .select("id, source_title, primary_engine_key, secondary_engine_key, status")
        .single();

      if (uErr) {
        console.error(`[narrative-dna][reclassify] Update failed:`, uErr.message);
        return jsonRes({ error: `Reclassification persist failed: ${uErr.message}` }, 500);
      }

      // Structured diagnostic
      const diagnostic = {
        event: "DNA_ENGINE_RECLASSIFIED",
        profile_id: id,
        source_title: profile.source_title,
        previous_primary_engine_key: previousPrimary,
        previous_secondary_engine_key: previousSecondary,
        new_primary_engine_key: primaryKey,
        new_secondary_engine_key: secondaryKey,
        confidence: classificationResult.candidate_engines?.find((c: any) => c.engine_key === primaryKey)?.confidence ?? null,
        candidate_count: classificationResult.candidate_engines?.length ?? 0,
        ambiguity_flags: classificationResult.ambiguity_flags || [],
        classification_version: classificationResult.classification_version || "v1_structural",
        matched_traits: classificationResult.candidate_engines?.find((c: any) => c.engine_key === primaryKey)?.matched_traits || [],
      };

      if ((classificationResult.ambiguity_flags || []).length > 0) {
        console.warn(`[narrative-dna][reclassify] DNA_ENGINE_AMBIGUOUS`, JSON.stringify(diagnostic));
      } else {
        console.log(`[narrative-dna][reclassify] DNA_ENGINE_RECLASSIFIED`, JSON.stringify(diagnostic));
      }

      return jsonRes({
        success: true,
        profile: updated,
        classification: {
          primary_engine_key: primaryKey,
          secondary_engine_key: secondaryKey,
          candidate_engines: classificationResult.candidate_engines,
          classification_rationale: classificationResult.classification_rationale,
          ambiguity_flags: classificationResult.ambiguity_flags || [],
          classification_version: classificationResult.classification_version || "v1_structural",
        },
        diagnostic,
      });
    }

    // ── LIST_BLUEPRINT_FAMILIES ───────────────────────────────────────────
    if (action === "list_blueprint_families") {
      const { engine_key } = body;
      let query = supabase
        .from("narrative_engine_blueprint_families")
        .select("*")
        .eq("active", true)
        .order("family_key");

      if (engine_key) {
        query = query.eq("engine_key", engine_key);
      }

      const { data: families, error } = await query;
      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ families: families || [] });
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[narrative-dna] Error:", err.message);
    return jsonRes({ error: err.message || "Internal server error" }, 500);
  }
});
