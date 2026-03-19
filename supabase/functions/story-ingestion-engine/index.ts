// @ts-nocheck
/**
 * Story Ingestion Engine — Canonical multi-stage pipeline (Phase 2 Hardened).
 * Parses script → extracts entities → detects state transitions →
 * reconciles aliases → distributes to downstream subsystems.
 * 
 * Phase 2 additions:
 * - Source resolution reporting (which doc, why selected, fallback used)
 * - Parse quality metrics (slugline count, dialogue cues, warnings)
 * - Structured diff reporting against prior runs
 * - State distribution gating (review_status on entity_visual_states)
 * - Review action upgrades (approve/reject entities, aliases, transitions, participation)
 *
 * Actions: ingest, status, review, review_action, diff
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveGateway, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function verifyUser(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error } = await anonClient.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 1: DETERMINISTIC STRUCTURAL PARSE
   ═══════════════════════════════════════════════════════════════════════════ */

interface ParsedScene {
  ordinal: number;
  scene_key: string;
  slugline: string;
  location: string;
  int_ext: string;
  time_of_day: string;
  content: string;
  summary: string;
  characters_mentioned: string[];
}

interface ParseQuality {
  scenes_detected: number;
  slugline_count: number;
  dialogue_cue_count: number;
  parse_method: "deterministic_slugline" | "fallback_plaintext" | "hybrid";
  parse_quality: "high" | "medium" | "low";
  warnings: string[];
  text_length: number;
}

interface SourceResolution {
  documents_considered: { id: string; doc_type: string }[];
  selected_document_id: string | null;
  selected_doc_type: string | null;
  selection_reason: string;
  version_id_used: string | null;
  text_length: number;
  fallback_used: boolean;
  inline_text_provided: boolean;
}

function parseSlugline(line: string): { slugline: string; location: string; int_ext: string; time_of_day: string } {
  const sl = line.trim().replace(/^\d+\s*[\.\)\s]\s*/, "");
  const match = sl.match(/^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.?)\s*(.+?)(?:\s*[-–—]\s*(.+))?$/i);
  if (match) {
    return {
      slugline: sl,
      int_ext: match[1].replace(/\./g, "").replace(/\//g, "/").toUpperCase(),
      location: (match[2] || "").trim(),
      time_of_day: (match[3] || "").trim(),
    };
  }
  return { slugline: sl, location: "", int_ext: "", time_of_day: "" };
}

function extractCharacterCues(text: string): string[] {
  const cuePattern = /^[ \t]{10,}([A-Z][A-Z\s\.\-']{1,30})(?:\s*\(.*?\))?\s*$/gm;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = cuePattern.exec(text)) !== null) {
    const name = m[1].trim();
    const skip = /^(FADE|CUT|DISSOLVE|SMASH|INTERCUT|CONTINUED|CONT'D|THE END|TITLE|SUPER|V\.O\.|O\.S\.|BACK TO|FLASHBACK|END OF|MONTAGE|SERIES OF|BEGIN|MORE|ANGLE|CLOSE|WIDE|PAN|INSERT|TRANSITION)$/i;
    if (!skip.test(name) && name.length > 1 && name.length < 30) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function parseScriptToScenes(scriptText: string): { scenes: ParsedScene[]; quality: ParseQuality } {
  const lines = scriptText.split("\n");
  const sluglinePattern = /^\s*(\d+\s*[\.\)\s]\s*)?(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.?)\s/i;
  const sceneBreaks: { startLine: number; headingLine: string }[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (sluglinePattern.test(lines[i])) {
      sceneBreaks.push({ startLine: i, headingLine: lines[i] });
    }
  }

  let parseMethod: ParseQuality["parse_method"] = "deterministic_slugline";

  if (sceneBreaks.length === 0) {
    sceneBreaks.push({ startLine: 0, headingLine: "SCENE 1" });
    parseMethod = "fallback_plaintext";
    warnings.push("No explicit INT./EXT. sluglines detected — using fallback single-scene parse");
  }

  // Count dialogue cues across full text
  const allDialogueCues = extractCharacterCues(scriptText);
  const dialogueCueCount = allDialogueCues.length;

  if (dialogueCueCount < 3) {
    warnings.push("Sparse dialogue cues detected (< 3 unique character names)");
  }
  if (scriptText.length < 2000) {
    warnings.push("Source plaintext is very short (< 2000 chars)");
  }
  if (sceneBreaks.length < 3 && sceneBreaks.length > 0 && parseMethod !== "fallback_plaintext") {
    warnings.push("Very few scenes detected — possible mixed-format script");
  }

  const scenes = sceneBreaks.map((b, i) => {
    const start = b.startLine;
    const end = i + 1 < sceneBreaks.length ? sceneBreaks[i + 1].startLine : lines.length;
    const content = lines.slice(start, end).join("\n").trim();
    const parsed = parseSlugline(b.headingLine);
    const chars = extractCharacterCues(content);
    return {
      ordinal: i + 1,
      scene_key: `SC${String(i + 1).padStart(3, "0")}`,
      ...parsed,
      content,
      summary: content.slice(0, 300),
      characters_mentioned: chars,
    };
  });

  // Determine quality
  let parseQuality: ParseQuality["parse_quality"] = "high";
  if (parseMethod === "fallback_plaintext") parseQuality = "low";
  else if (warnings.length >= 2) parseQuality = "medium";
  else if (scenes.length < 5 && scriptText.length > 5000) parseQuality = "medium";

  return {
    scenes,
    quality: {
      scenes_detected: scenes.length,
      slugline_count: sceneBreaks.length,
      dialogue_cue_count: dialogueCueCount,
      parse_method: parseMethod,
      parse_quality: parseQuality,
      warnings,
      text_length: scriptText.length,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 2: AI-ASSISTED ENTITY & STATE EXTRACTION
   ═══════════════════════════════════════════════════════════════════════════ */

async function extractEntitiesAndStates(scenes: ParsedScene[]): Promise<{
  characters: any[];
  locations: any[];
  props: any[];
  costume_looks: any[];
  state_transitions: any[];
}> {
  const { url, apiKey } = resolveGateway();

  const sceneManifest = scenes.map(s => ({
    scene_key: s.scene_key,
    slugline: s.slugline,
    characters: s.characters_mentioned,
    summary: s.content.slice(0, 500),
  }));

  const prompt = `You are a screenplay production analyst. Analyze this screenplay scene manifest and extract ALL production entities.

SCENE MANIFEST (${scenes.length} scenes):
${JSON.stringify(sceneManifest, null, 1).slice(0, 120000)}

Extract using the output_entities tool. Be thorough but accurate.

RULES:
- Characters: ALL named speaking characters. Include age range if mentioned.
- Locations: ALL distinct locations from sluglines + mentioned settings.
- Props: Only visually significant / plot-relevant props (weapons, letters, artifacts, vehicles).
- Costume Looks: Only when a specific costume/outfit is described or changes.
- State Transitions: Visually significant changes (age shifts, injuries, damage, costume changes, location state changes). Link to scene_key where the change occurs.
- confidence: "high" for explicit facts, "medium" for strong inference, "low" for speculation.
- review_tier: "auto_accepted" for explicit facts, "review_required" for inferences, "proposed_only" for speculation.`;

  const tools = [{
    type: "function",
    function: {
      name: "output_entities",
      description: "Output all extracted production entities",
      parameters: {
        type: "object",
        properties: {
          characters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                canonical_name: { type: "string" },
                aliases: { type: "array", items: { type: "string" } },
                gender: { type: "string" },
                age_range: { type: "string" },
                description: { type: "string" },
                role_importance: { type: "string", enum: ["lead", "supporting", "recurring", "minor", "featured_extra"] },
                scenes_present: { type: "array", items: { type: "string" } },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                review_tier: { type: "string", enum: ["auto_accepted", "review_required", "proposed_only"] },
              },
              required: ["canonical_name", "description", "confidence", "review_tier"],
            },
          },
          locations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                canonical_name: { type: "string" },
                aliases: { type: "array", items: { type: "string" } },
                location_type: { type: "string" },
                int_ext: { type: "string" },
                geography: { type: "string" },
                description: { type: "string" },
                story_importance: { type: "string", enum: ["primary", "secondary", "minor"] },
                recurring: { type: "boolean" },
                scenes_present: { type: "array", items: { type: "string" } },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                review_tier: { type: "string", enum: ["auto_accepted", "review_required", "proposed_only"] },
              },
              required: ["canonical_name", "description", "confidence", "review_tier"],
            },
          },
          props: {
            type: "array",
            items: {
              type: "object",
              properties: {
                canonical_name: { type: "string" },
                description: { type: "string" },
                associated_character: { type: "string" },
                plot_significance: { type: "string" },
                scenes_present: { type: "array", items: { type: "string" } },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                review_tier: { type: "string", enum: ["auto_accepted", "review_required", "proposed_only"] },
              },
              required: ["canonical_name", "description", "confidence", "review_tier"],
            },
          },
          costume_looks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                look_name: { type: "string" },
                character: { type: "string" },
                description: { type: "string" },
                scenes_used: { type: "array", items: { type: "string" } },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                review_tier: { type: "string", enum: ["auto_accepted", "review_required", "proposed_only"] },
              },
              required: ["look_name", "character", "description", "confidence", "review_tier"],
            },
          },
          state_transitions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entity_name: { type: "string" },
                entity_type: { type: "string", enum: ["character", "location", "prop"] },
                from_state: { type: "string" },
                to_state: { type: "string" },
                state_category: { type: "string", enum: ["age", "injury", "costume", "transformation", "damage", "time_of_day", "season", "social_state", "corruption", "restoration"] },
                trigger_scene_key: { type: "string" },
                evidence: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                review_tier: { type: "string", enum: ["auto_accepted", "review_required", "proposed_only"] },
              },
              required: ["entity_name", "entity_type", "to_state", "state_category", "confidence", "review_tier"],
            },
          },
        },
        required: ["characters", "locations", "props", "costume_looks", "state_transitions"],
      },
    },
  }];

  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS.PRO,
      messages: [{ role: "user", content: prompt }],
      tools,
      tool_choice: { type: "function", function: { name: "output_entities" } },
      temperature: 0.2,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI extraction failed: ${resp.status} ${t.slice(0, 300)}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  if (choice?.message?.tool_calls?.[0]) {
    const args = JSON.parse(choice.message.tool_calls[0].function.arguments);
    return {
      characters: args.characters || [],
      locations: args.locations || [],
      props: args.props || [],
      costume_looks: args.costume_looks || [],
      state_transitions: args.state_transitions || [],
    };
  }

  const content = choice?.message?.content || "";
  try {
    const parsed = JSON.parse(content);
    return {
      characters: parsed.characters || [],
      locations: parsed.locations || [],
      props: parsed.props || [],
      costume_looks: parsed.costume_looks || [],
      state_transitions: parsed.state_transitions || [],
    };
  } catch {
    console.error("[story-ingestion] Failed to parse AI response:", content.slice(0, 500));
    return { characters: [], locations: [], props: [], costume_looks: [], state_transitions: [] };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 3: DB WRITES — SCENES, ENTITIES, PARTICIPATION, STATES
   ═══════════════════════════════════════════════════════════════════════════ */

function normalizeEntityKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

async function writeScenesToDB(
  supabase: any, projectId: string, userId: string, runId: string,
  scenes: ParsedScene[], force: boolean
): Promise<Map<string, string>> {
  const orderKeys = scenes.map((_, i) => {
    const fraction = (i + 1) / (scenes.length + 1);
    return fraction.toFixed(8);
  });

  const rpcPayload = scenes.map((s, i) => ({
    scene_key: s.scene_key,
    scene_kind: "narrative",
    order_key: orderKeys[i],
    slugline: s.slugline,
    location: s.location,
    time_of_day: s.time_of_day,
    content: s.content,
    summary: s.summary,
  }));

  const { data: rpcResult, error: rpcErr } = await supabase.rpc("scene_graph_atomic_write", {
    p_project_id: projectId,
    p_created_by: userId,
    p_force: force,
    p_scenes: rpcPayload,
  });

  if (rpcErr) throw new Error(`Scene write failed: ${rpcErr.message}`);

  const sceneMap = new Map<string, string>();
  if (Array.isArray(rpcResult)) {
    for (const r of rpcResult) {
      sceneMap.set(r.scene_key, r.scene_id);
    }
  }

  if (sceneMap.size > 0) {
    const sceneIds = [...sceneMap.values()];
    for (const sid of sceneIds) {
      await supabase.from("scene_graph_scenes")
        .update({ ingestion_run_id: runId })
        .eq("id", sid);
    }
  }

  return sceneMap;
}

async function writeEntitiesToDB(
  supabase: any, projectId: string, runId: string,
  entities: { characters: any[]; locations: any[]; props: any[]; costume_looks: any[] }
): Promise<Map<string, string>> {
  const entityMap = new Map<string, string>();
  const aliasRows: any[] = [];

  const allEntities = [
    ...entities.characters.map(c => ({ ...c, entity_type: "character" })),
    ...entities.locations.map(l => ({ ...l, entity_type: "location" })),
    ...entities.props.map(p => ({ ...p, entity_type: "prop" })),
    ...entities.costume_looks.map(cl => ({ ...cl, canonical_name: cl.look_name, entity_type: "costume_look" })),
  ];

  for (const e of allEntities) {
    const entityKey = normalizeEntityKey(e.canonical_name);
    const metaJson: any = {
      description: e.description || "",
      confidence: e.confidence || "medium",
      review_tier: e.review_tier || "review_required",
    };
    if (e.gender) metaJson.gender = e.gender;
    if (e.age_range) metaJson.age_range = e.age_range;
    if (e.role_importance) metaJson.role_importance = e.role_importance;
    if (e.location_type) metaJson.location_type = e.location_type;
    if (e.int_ext) metaJson.int_ext = e.int_ext;
    if (e.geography) metaJson.geography = e.geography;
    if (e.story_importance) metaJson.story_importance = e.story_importance;
    if (e.recurring !== undefined) metaJson.recurring = e.recurring;
    if (e.associated_character) metaJson.associated_character = e.associated_character;
    if (e.character) metaJson.character = e.character;
    if (e.scenes_present) metaJson.scenes_present = e.scenes_present;
    if (e.scenes_used) metaJson.scenes_used = e.scenes_used;
    if (e.plot_significance) metaJson.plot_significance = e.plot_significance;

    const { data: existing } = await supabase
      .from("narrative_entities")
      .select("id")
      .eq("project_id", projectId)
      .eq("entity_key", entityKey)
      .limit(1)
      .maybeSingle();

    let entityId: string;
    if (existing) {
      entityId = existing.id;
      await supabase.from("narrative_entities")
        .update({
          canonical_name: e.canonical_name,
          entity_type: e.entity_type,
          source_kind: "story_ingestion",
          meta_json: metaJson,
          ingestion_run_id: runId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entityId);
    } else {
      const { data: newE, error: insertErr } = await supabase
        .from("narrative_entities")
        .insert({
          project_id: projectId,
          entity_key: entityKey,
          canonical_name: e.canonical_name,
          entity_type: e.entity_type,
          source_kind: "story_ingestion",
          status: "active",
          meta_json: metaJson,
          ingestion_run_id: runId,
        })
        .select("id")
        .single();
      if (insertErr) {
        console.error(`[ingestion] Entity insert failed for ${e.canonical_name}:`, insertErr.message);
        continue;
      }
      entityId = newE.id;
    }

    entityMap.set(e.canonical_name, entityId);

    // Collect aliases with confidence-aware review status
    const aliases = e.aliases || [];
    for (const alias of aliases) {
      const normAlias = normalizeEntityKey(alias);
      if (normAlias && normAlias !== entityKey) {
        // High confidence auto-accepted; ambiguous gets review_required
        const aliasConfidence = e.confidence === "high" ? 0.9 : e.confidence === "medium" ? 0.7 : 0.5;
        const aliasReview = aliasConfidence >= 0.8 ? "auto_accepted" : "review_required";
        aliasRows.push({
          project_id: projectId,
          canonical_entity_id: entityId,
          alias_name: alias,
          normalized_alias: normAlias,
          source: "story_ingestion",
          confidence: aliasConfidence,
          review_status: aliasReview,
        });
      }
    }
  }

  if (aliasRows.length > 0) {
    for (const row of aliasRows) {
      await supabase.from("entity_aliases").upsert(row, { onConflict: "project_id,normalized_alias" });
    }
  }

  return entityMap;
}

async function writeParticipation(
  supabase: any, projectId: string, runId: string,
  scenes: ParsedScene[], sceneMap: Map<string, string>, entityMap: Map<string, string>,
  extractedEntities: { characters: any[]; locations: any[] }
) {
  const rows: any[] = [];

  for (const scene of scenes) {
    const sceneId = sceneMap.get(scene.scene_key);
    if (!sceneId) continue;

    for (const charName of scene.characters_mentioned) {
      const entityId = entityMap.get(charName);
      if (!entityId) continue;
      rows.push({
        project_id: projectId,
        ingestion_run_id: runId,
        scene_id: sceneId,
        entity_id: entityId,
        entity_type: "character",
        role_in_scene: "speaking",
        is_primary: false,
        confidence: 0.9,
        source_reason: "dialogue_cue",
        review_tier: "auto_accepted",
        review_status: "approved",
      });
    }

    if (scene.location) {
      for (const [name, eid] of entityMap.entries()) {
        const locMatch = extractedEntities.locations.find(l => l.canonical_name === name);
        if (locMatch && scene.location.toUpperCase().includes(name.toUpperCase())) {
          rows.push({
            project_id: projectId,
            ingestion_run_id: runId,
            scene_id: sceneId,
            entity_id: eid,
            entity_type: "location",
            role_in_scene: "setting",
            is_primary: true,
            confidence: 0.95,
            source_reason: "slugline_match",
            review_tier: "auto_accepted",
            review_status: "approved",
          });
        }
      }
    }
  }

  for (const char of extractedEntities.characters) {
    const entityId = entityMap.get(char.canonical_name);
    if (!entityId || !char.scenes_present) continue;
    for (const sk of char.scenes_present) {
      const sceneId = sceneMap.get(sk);
      if (!sceneId) continue;
      if (rows.find(r => r.scene_id === sceneId && r.entity_id === entityId && r.entity_type === "character")) continue;
      rows.push({
        project_id: projectId,
        ingestion_run_id: runId,
        scene_id: sceneId,
        entity_id: entityId,
        entity_type: "character",
        role_in_scene: "present",
        is_primary: false,
        confidence: 0.7,
        source_reason: "ai_extraction",
        review_tier: "review_required",
        review_status: "pending",
      });
    }
  }

  for (const row of rows) {
    await supabase.from("scene_entity_participation")
      .upsert(row, { onConflict: "scene_id,entity_id,entity_type" });
  }

  return rows.length;
}

async function writeStateTransitions(
  supabase: any, projectId: string, runId: string,
  transitions: any[], entityMap: Map<string, string>, sceneMap: Map<string, string>
) {
  let count = 0;
  for (const t of transitions) {
    const entityId = entityMap.get(t.entity_name);
    if (!entityId) continue;

    const sceneId = t.trigger_scene_key ? sceneMap.get(t.trigger_scene_key) : null;
    const conf = t.confidence === "high" ? 0.9 : t.confidence === "medium" ? 0.7 : 0.5;
    // Auto-approve high-confidence auto_accepted; everything else starts pending
    const reviewStatus = (t.review_tier === "auto_accepted" && conf >= 0.85) ? "approved" : "pending";

    await supabase.from("state_transition_candidates").insert({
      project_id: projectId,
      ingestion_run_id: runId,
      entity_id: entityId,
      entity_type: t.entity_type || "character",
      from_state_key: t.from_state || null,
      to_state_key: t.to_state,
      state_category: t.state_category || "transformation",
      scene_id: sceneId,
      evidence_text: t.evidence || null,
      confidence: conf,
      review_tier: t.review_tier || "review_required",
      review_status: reviewStatus,
    });
    count++;
  }
  return count;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 4: DISTRIBUTION TO DOWNSTREAM SUBSYSTEMS
   ═══════════════════════════════════════════════════════════════════════════ */

async function distributeToSubsystems(
  supabase: any, projectId: string, userId: string, runId: string,
  entityMap: Map<string, string>,
  extractedEntities: { characters: any[]; locations: any[]; props: any[]; costume_looks: any[] },
  stateTransitions: any[]
) {
  const results: any = { canon_locations: 0, entity_visual_states: 0, cast_candidates: 0, props_seeded: 0, costume_looks_seeded: 0 };

  // ── Distribute locations to canon_locations ──
  for (const loc of extractedEntities.locations) {
    const normalizedName = normalizeEntityKey(loc.canonical_name);

    const { data: existing } = await supabase
      .from("canon_locations")
      .select("id")
      .eq("project_id", projectId)
      .eq("normalized_name", normalizedName)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      await supabase.from("canon_locations").insert({
        project_id: projectId,
        canonical_name: loc.canonical_name,
        normalized_name: normalizedName,
        location_type: loc.location_type || "location",
        interior_or_exterior: loc.int_ext || null,
        geography: loc.geography || null,
        story_importance: loc.story_importance || "secondary",
        recurring: loc.recurring ?? false,
        description: loc.description || null,
        associated_characters: [],
        source_document_ids: [],
        provenance: `story_ingestion:${runId}`,
        active: true,
      });
      results.canon_locations++;
    }
  }

  // ── Distribute state transitions to entity_visual_states (gated by confidence) ──
  for (const t of stateTransitions) {
    const entityId = entityMap.get(t.entity_name);
    if (!entityId) continue;

    const stateKey = normalizeEntityKey(t.to_state);
    const conf = t.confidence === "high" ? 0.9 : t.confidence === "medium" ? 0.7 : 0.5;

    // Gate: only materialize if at least medium confidence
    if (conf < 0.5) continue;

    const { data: existing } = await supabase
      .from("entity_visual_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("entity_name", t.entity_name)
      .eq("state_key", stateKey)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      // review_status: proposed for everything from ingestion — never auto-approved
      const reviewStatus = (conf >= 0.85 && t.review_tier === "auto_accepted") ? "approved" : "proposed";

      const { data: newEvs } = await supabase.from("entity_visual_states").insert({
        project_id: projectId,
        entity_type: t.entity_type || "character",
        entity_name: t.entity_name,
        entity_id: entityId,
        state_key: stateKey,
        state_label: t.to_state,
        state_category: t.state_category || "transformation",
        canonical_description: t.evidence || t.to_state,
        source_reason: `story_ingestion:${runId}`,
        story_phase: t.trigger_scene_key || null,
        confidence: t.confidence === "high" ? "high" : t.confidence === "medium" ? "medium" : "low",
        active: true,
        review_status: reviewStatus,
        ingestion_run_id: runId,
      }).select("id").maybeSingle();

      // Link back to state_transition_candidate
      if (newEvs?.id) {
        await supabase.from("state_transition_candidates")
          .update({ promoted_to_evs_id: newEvs.id })
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId)
          .eq("entity_id", entityId)
          .eq("to_state_key", t.to_state);
      }

      results.entity_visual_states++;
    }
  }

  // ── Track cast candidates (characters ready for visual pipeline) ──
  for (const char of extractedEntities.characters) {
    if (char.confidence === "high" || char.review_tier === "auto_accepted") {
      results.cast_candidates++;
    }
  }

  results.props_seeded = extractedEntities.props.length;
  results.costume_looks_seeded = extractedEntities.costume_looks.length;

  return results;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DIFF ENGINE — Compare two ingestion runs
   ═══════════════════════════════════════════════════════════════════════════ */

async function computeRunDiff(supabase: any, projectId: string, currentRunId: string) {
  // Find prior completed run
  const { data: priorRuns } = await supabase
    .from("story_ingestion_runs")
    .select("id, manifest_json")
    .eq("project_id", projectId)
    .eq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!priorRuns || priorRuns.length === 0) {
    return { has_prior: false, diff: null };
  }

  const priorRun = priorRuns[0];
  const priorManifest = priorRun.manifest_json || {};

  // Fetch current run entities
  const { data: curEntities } = await supabase
    .from("narrative_entities")
    .select("canonical_name, entity_type")
    .eq("project_id", projectId)
    .eq("ingestion_run_id", currentRunId);

  // Fetch prior run entities
  const { data: priorEntities } = await supabase
    .from("narrative_entities")
    .select("canonical_name, entity_type")
    .eq("project_id", projectId)
    .eq("ingestion_run_id", priorRun.id);

  const curSet = new Set((curEntities || []).map((e: any) => `${e.entity_type}::${e.canonical_name}`));
  const priorSet = new Set((priorEntities || []).map((e: any) => `${e.entity_type}::${e.canonical_name}`));

  const added = [...curSet].filter(x => !priorSet.has(x));
  const removed = [...priorSet].filter(x => !curSet.has(x));

  // Scenes diff from scene graph
  const { data: curScenes } = await supabase
    .from("scene_graph_scenes")
    .select("scene_key")
    .eq("project_id", projectId)
    .eq("ingestion_run_id", currentRunId);

  const { data: priorScenes } = await supabase
    .from("scene_graph_scenes")
    .select("scene_key")
    .eq("project_id", projectId)
    .eq("ingestion_run_id", priorRun.id);

  const curSceneKeys = new Set((curScenes || []).map((s: any) => s.scene_key));
  const priorSceneKeys = new Set((priorScenes || []).map((s: any) => s.scene_key));

  const scenesAdded = [...curSceneKeys].filter(k => !priorSceneKeys.has(k));
  const scenesRemoved = [...priorSceneKeys].filter(k => !curSceneKeys.has(k));

  // Categorize entity changes
  const categorize = (items: string[], type: string) => items.filter(i => i.startsWith(`${type}::`)).map(i => i.split("::")[1]);

  const diff = {
    prior_run_id: priorRun.id,
    scenes_added: scenesAdded,
    scenes_removed: scenesRemoved,
    scenes_unchanged: [...curSceneKeys].filter(k => priorSceneKeys.has(k)).length,
    characters_added: categorize(added, "character"),
    characters_removed: categorize(removed, "character"),
    locations_added: categorize(added, "location"),
    locations_removed: categorize(removed, "location"),
    props_added: categorize(added, "prop"),
    props_removed: categorize(removed, "prop"),
    costume_looks_added: categorize(added, "costume_look"),
    costume_looks_removed: categorize(removed, "costume_look"),
    total_entities_added: added.length,
    total_entities_removed: removed.length,
  };

  return { has_prior: true, diff };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCE RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

async function resolveScriptSource(
  supabase: any, projectId: string, body: any
): Promise<{ scriptText: string; sourceResolution: SourceResolution }> {
  const resolution: SourceResolution = {
    documents_considered: [],
    selected_document_id: null,
    selected_doc_type: null,
    selection_reason: "",
    version_id_used: null,
    text_length: 0,
    fallback_used: false,
    inline_text_provided: false,
  };

  if (body.text) {
    resolution.inline_text_provided = true;
    resolution.selection_reason = "inline_text_provided";
    resolution.text_length = body.text.length;
    return { scriptText: body.text, sourceResolution: resolution };
  }

  // Priority order for script doc types
  const scriptDocTypes = [
    "production_draft", "feature_script", "season_script",
    "episode_script", "script", "pilot_script", "season_master_script",
  ];

  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, doc_type, created_at")
    .eq("project_id", projectId)
    .in("doc_type", scriptDocTypes)
    .order("created_at", { ascending: false });

  if (!docs || docs.length === 0) {
    throw new Error("No script documents found for this project");
  }

  resolution.documents_considered = docs.map((d: any) => ({ id: d.id, doc_type: d.doc_type }));

  // Select by priority
  let selectedDoc = null;
  for (const preferredType of scriptDocTypes) {
    selectedDoc = docs.find((d: any) => d.doc_type === preferredType);
    if (selectedDoc) break;
  }
  if (!selectedDoc) selectedDoc = docs[0];

  resolution.selected_document_id = selectedDoc.id;
  resolution.selected_doc_type = selectedDoc.doc_type;
  resolution.selection_reason = `doc_type_priority:${selectedDoc.doc_type}`;

  // Get current version
  const { data: ver } = await supabase
    .from("project_document_versions")
    .select("id, plaintext")
    .eq("document_id", selectedDoc.id)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  if (ver?.plaintext && ver.plaintext.length >= 100) {
    resolution.version_id_used = ver.id;
    resolution.text_length = ver.plaintext.length;
    return { scriptText: ver.plaintext, sourceResolution: resolution };
  }

  // Fallback: latest version by version_number
  resolution.fallback_used = true;
  resolution.selection_reason += "|fallback_latest_version";

  const { data: fallback } = await supabase
    .from("project_document_versions")
    .select("id, plaintext")
    .eq("document_id", selectedDoc.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fallback?.plaintext || fallback.plaintext.length < 100) {
    throw new Error("No usable script text found. Ensure script has been extracted.");
  }

  resolution.version_id_used = fallback.id;
  resolution.text_length = fallback.plaintext.length;
  return { scriptText: fallback.plaintext, sourceResolution: resolution };
}

/* ═══════════════════════════════════════════════════════════════════════════
   REVIEW ACTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

async function handleReviewAction(supabase: any, userId: string, body: any) {
  const { projectId, target, targetId, action: reviewAction } = body;
  if (!projectId || !target || !targetId || !reviewAction) {
    throw new Error("projectId, target, targetId, action required");
  }

  const validActions = ["approve", "reject", "escalate"];
  if (!validActions.includes(reviewAction)) {
    throw new Error(`Invalid review action: ${reviewAction}. Must be: ${validActions.join(", ")}`);
  }

  const statusMap: Record<string, string> = {
    approve: "approved",
    reject: "rejected",
    escalate: "escalated",
  };
  const newStatus = statusMap[reviewAction];

  const tableMap: Record<string, string> = {
    entity: "narrative_entities",
    alias: "entity_aliases",
    transition: "state_transition_candidates",
    participation: "scene_entity_participation",
  };

  const table = tableMap[target];
  if (!table) throw new Error(`Unknown review target: ${target}`);

  const updatePayload: any = {
    review_status: newStatus,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  };

  // For narrative_entities, update meta_json instead (no review_status column)
  if (target === "entity") {
    const { data: entity } = await supabase.from(table).select("meta_json").eq("id", targetId).single();
    if (!entity) throw new Error("Entity not found");
    const updatedMeta = { ...(entity.meta_json || {}), review_status: newStatus, reviewed_by: userId, reviewed_at: new Date().toISOString() };
    await supabase.from(table).update({ meta_json: updatedMeta }).eq("id", targetId);
  } else {
    await supabase.from(table).update(updatePayload).eq("id", targetId);
  }

  return { ok: true, target, targetId, new_status: newStatus };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN HANDLER
   ═══════════════════════════════════════════════════════════════════════════ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await verifyUser(req);
    const body = await req.json();
    const { action } = body;

    const supabase = getServiceClient();

    // ═══════════════════════════════════════════════════════════════
    // ACTION: ingest
    // ═══════════════════════════════════════════════════════════════
    if (action === "ingest") {
      const { projectId, force } = body;
      if (!projectId) throw new Error("projectId required");

      console.log(`[story-ingestion] Starting ingestion for project ${projectId}`);

      // ── Create run record ──
      const { data: run, error: runErr } = await supabase
        .from("story_ingestion_runs")
        .insert({
          project_id: projectId,
          source_kind: body.sourceKind || "feature_script",
          source_document_ids: body.sourceDocumentIds || [],
          source_version_ids: body.sourceVersionId ? [body.sourceVersionId] : [],
          status: "parsing",
          created_by: userId,
        })
        .select("id")
        .single();

      if (runErr || !run) throw new Error(`Failed to create ingestion run: ${runErr?.message}`);
      const runId = run.id;

      try {
        // ── SOURCE RESOLUTION ──
        const { scriptText, sourceResolution } = await resolveScriptSource(supabase, projectId, body);

        // Update run with source resolution
        await supabase.from("story_ingestion_runs")
          .update({
            source_document_ids: sourceResolution.selected_document_id
              ? [sourceResolution.selected_document_id]
              : [],
            source_resolution_json: sourceResolution,
          })
          .eq("id", runId);

        console.log(`[story-ingestion] Source resolved: ${sourceResolution.selection_reason}, ${sourceResolution.text_length} chars`);

        // ── STAGE 1: Deterministic structural parse ──
        const { scenes, quality: parseQuality } = parseScriptToScenes(scriptText);
        console.log(`[story-ingestion] Parsed ${scenes.length} scenes (quality: ${parseQuality.parse_quality}, method: ${parseQuality.parse_method})`);

        await supabase.from("story_ingestion_runs")
          .update({
            status: "extracting",
            parse_quality_json: parseQuality,
            stage_summary: { scenes_parsed: scenes.length },
          })
          .eq("id", runId);

        // ── STAGE 1b: Write scenes to scene graph ──
        const sceneMap = await writeScenesToDB(supabase, projectId, userId, runId, scenes, !!force);
        console.log(`[story-ingestion] Wrote ${sceneMap.size} scenes to scene graph`);

        // ── STAGE 2: AI entity + state extraction ──
        const extracted = await extractEntitiesAndStates(scenes);
        console.log(`[story-ingestion] Extracted: ${extracted.characters.length} chars, ${extracted.locations.length} locs, ${extracted.props.length} props, ${extracted.costume_looks.length} looks, ${extracted.state_transitions.length} states`);

        // ── STAGE 2b: Merge deterministic character cues ──
        const allDialogueChars = new Set<string>();
        for (const s of scenes) {
          for (const c of s.characters_mentioned) allDialogueChars.add(c);
        }
        for (const name of allDialogueChars) {
          if (!extracted.characters.find((c: any) => c.canonical_name.toUpperCase() === name.toUpperCase())) {
            extracted.characters.push({
              canonical_name: name,
              description: `Speaking character (deterministic dialogue cue extraction)`,
              confidence: "high",
              review_tier: "auto_accepted",
              aliases: [],
            });
          }
        }

        await supabase.from("story_ingestion_runs")
          .update({
            status: "reconciling",
            stage_summary: {
              scenes_parsed: scenes.length,
              characters: extracted.characters.length,
              locations: extracted.locations.length,
              props: extracted.props.length,
              costume_looks: extracted.costume_looks.length,
              state_transitions: extracted.state_transitions.length,
            },
          })
          .eq("id", runId);

        // ── STAGE 3: Write entities ──
        const entityMap = await writeEntitiesToDB(supabase, projectId, runId, extracted);
        console.log(`[story-ingestion] Wrote ${entityMap.size} entities`);

        // ── STAGE 3b: Write participation ──
        const participationCount = await writeParticipation(
          supabase, projectId, runId, scenes, sceneMap, entityMap, extracted
        );
        console.log(`[story-ingestion] Wrote ${participationCount} participation records`);

        // ── STAGE 3c: Write state transitions ──
        const stateCount = await writeStateTransitions(
          supabase, projectId, runId, extracted.state_transitions, entityMap, sceneMap
        );
        console.log(`[story-ingestion] Wrote ${stateCount} state transition candidates`);

        // ── STAGE 4: Distribute to subsystems ──
        await supabase.from("story_ingestion_runs")
          .update({ status: "distributing" })
          .eq("id", runId);

        const distResults = await distributeToSubsystems(
          supabase, projectId, userId, runId, entityMap, extracted, extracted.state_transitions
        );
        console.log(`[story-ingestion] Distribution: ${JSON.stringify(distResults)}`);

        // ── Compute diff against prior run ──
        const { has_prior, diff: runDiff } = await computeRunDiff(supabase, projectId, runId);

        // ── Count review-required items ──
        const { count: reviewEntities } = await supabase.from("narrative_entities")
          .select("*", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId)
          .filter("meta_json->>review_tier", "neq", "auto_accepted");

        const { count: reviewAliases } = await supabase.from("entity_aliases")
          .select("*", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("review_status", "review_required");

        const { count: reviewTransitions } = await supabase.from("state_transition_candidates")
          .select("*", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId)
          .eq("review_status", "pending");

        const { count: reviewParticipation } = await supabase.from("scene_entity_participation")
          .select("*", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId)
          .eq("review_status", "pending");

        // ── Complete ──
        const manifest = {
          scenes_parsed: scenes.length,
          scenes_written: sceneMap.size,
          characters: extracted.characters.length,
          locations: extracted.locations.length,
          props: extracted.props.length,
          costume_looks: extracted.costume_looks.length,
          state_transitions: extracted.state_transitions.length,
          participation_records: participationCount,
          canon_locations_created: distResults.canon_locations,
          entity_visual_states_created: distResults.entity_visual_states,
          entities_total: entityMap.size,
          cast_candidates: distResults.cast_candidates,
          props_seeded: distResults.props_seeded,
          costume_looks_seeded: distResults.costume_looks_seeded,
          review_required: {
            entities: reviewEntities || 0,
            aliases: reviewAliases || 0,
            transitions: reviewTransitions || 0,
            participation: reviewParticipation || 0,
          },
        };

        await supabase.from("story_ingestion_runs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            manifest_json: manifest,
            stage_summary: manifest,
            diff_json: runDiff,
          })
          .eq("id", runId);

        // Supersede prior completed runs
        await supabase.from("story_ingestion_runs")
          .update({ status: "superseded", superseded_by: runId })
          .eq("project_id", projectId)
          .eq("status", "completed")
          .neq("id", runId);

        return new Response(JSON.stringify({
          ok: true,
          run_id: runId,
          manifest,
          source_resolution: sourceResolution,
          parse_quality: parseQuality,
          diff: has_prior ? runDiff : null,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (stageErr: any) {
        console.error(`[story-ingestion] Pipeline failed:`, stageErr);
        await supabase.from("story_ingestion_runs")
          .update({ status: "failed", failure_reason: stageErr.message || String(stageErr) })
          .eq("id", runId);
        throw stageErr;
      }

    // ═══════════════════════════════════════════════════════════════
    // ACTION: status
    // ═══════════════════════════════════════════════════════════════
    } else if (action === "status") {
      const { projectId } = body;
      const { data: runs } = await supabase
        .from("story_ingestion_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10);

      return new Response(JSON.stringify({ ok: true, runs: runs || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ═══════════════════════════════════════════════════════════════
    // ACTION: review — fetch review items for a run
    // ═══════════════════════════════════════════════════════════════
    } else if (action === "review") {
      const { projectId, runId } = body;

      const [entitiesRes, transitionsRes, aliasesRes, participationRes] = await Promise.all([
        supabase.from("narrative_entities")
          .select("*")
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId),
        supabase.from("state_transition_candidates")
          .select("*")
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId),
        supabase.from("entity_aliases")
          .select("*")
          .eq("project_id", projectId),
        supabase.from("scene_entity_participation")
          .select("*")
          .eq("project_id", projectId)
          .eq("ingestion_run_id", runId)
          .eq("review_status", "pending"),
      ]);

      // Compute review summary
      const entities = entitiesRes.data || [];
      const transitions = transitionsRes.data || [];
      const aliases = aliasesRes.data || [];
      const participation = participationRes.data || [];

      const reviewSummary = {
        entities_needing_review: entities.filter((e: any) => e.meta_json?.review_tier !== "auto_accepted").length,
        aliases_needing_review: aliases.filter((a: any) => a.review_status === "review_required").length,
        transitions_pending: transitions.filter((t: any) => t.review_status === "pending").length,
        participation_pending: participation.length,
      };

      return new Response(JSON.stringify({
        ok: true,
        entities,
        state_transitions: transitions,
        aliases,
        participation_pending: participation,
        review_summary: reviewSummary,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // ═══════════════════════════════════════════════════════════════
    // ACTION: review_action — approve/reject/escalate specific items
    // ═══════════════════════════════════════════════════════════════
    } else if (action === "review_action") {
      const result = await handleReviewAction(supabase, userId, body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ═══════════════════════════════════════════════════════════════
    // ACTION: diff — fetch diff for a specific run
    // ═══════════════════════════════════════════════════════════════
    } else if (action === "diff") {
      const { projectId, runId } = body;

      // Fetch run's stored diff
      const { data: run } = await supabase
        .from("story_ingestion_runs")
        .select("diff_json, manifest_json, source_resolution_json, parse_quality_json")
        .eq("id", runId)
        .single();

      return new Response(JSON.stringify({
        ok: true,
        diff: run?.diff_json || null,
        manifest: run?.manifest_json || null,
        source_resolution: run?.source_resolution_json || null,
        parse_quality: run?.parse_quality_json || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("[story-ingestion] Error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
