// @ts-nocheck
/**
 * Story Ingestion Engine — Canonical multi-stage pipeline.
 * Parses script → extracts entities → detects state transitions →
 * reconciles aliases → distributes to downstream subsystems.
 *
 * Actions: ingest, status, review
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

/** Extract character names from uppercase dialogue cues */
function extractCharacterCues(text: string): string[] {
  const cuePattern = /^[ \t]{10,}([A-Z][A-Z\s\.\-']{1,30})(?:\s*\(.*?\))?\s*$/gm;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = cuePattern.exec(text)) !== null) {
    const name = m[1].trim();
    // Filter structural terms
    const skip = /^(FADE|CUT|DISSOLVE|SMASH|INTERCUT|CONTINUED|CONT'D|THE END|TITLE|SUPER|V\.O\.|O\.S\.|BACK TO|FLASHBACK|END OF|MONTAGE|SERIES OF|BEGIN|MORE|ANGLE|CLOSE|WIDE|PAN|INSERT|TRANSITION)$/i;
    if (!skip.test(name) && name.length > 1 && name.length < 30) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function parseScriptToScenes(scriptText: string): ParsedScene[] {
  const lines = scriptText.split("\n");
  const sluglinePattern = /^\s*(\d+\s*[\.\)\s]\s*)?(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.?)\s/i;
  const sceneBreaks: { startLine: number; headingLine: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (sluglinePattern.test(lines[i])) {
      sceneBreaks.push({ startLine: i, headingLine: lines[i] });
    }
  }

  if (sceneBreaks.length === 0) {
    sceneBreaks.push({ startLine: 0, headingLine: "SCENE 1" });
  }

  return sceneBreaks.map((b, i) => {
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

  // Build a condensed scene manifest for the LLM
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

  // Fallback: try to parse content as JSON
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
  // Use existing scene_graph_atomic_write
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

  // Build scene_key → scene_id map
  const sceneMap = new Map<string, string>();
  if (Array.isArray(rpcResult)) {
    for (const r of rpcResult) {
      sceneMap.set(r.scene_key, r.scene_id);
    }
  }

  // Tag scenes with ingestion run
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
  const entityMap = new Map<string, string>(); // canonical_name → entity_id
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

    // Upsert into narrative_entities
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

    // Collect aliases
    const aliases = e.aliases || [];
    for (const alias of aliases) {
      const normAlias = normalizeEntityKey(alias);
      if (normAlias && normAlias !== entityKey) {
        aliasRows.push({
          project_id: projectId,
          canonical_entity_id: entityId,
          alias_name: alias,
          normalized_alias: normAlias,
          source: "story_ingestion",
          confidence: 0.8,
          review_status: "auto_accepted",
        });
      }
    }
  }

  // Write aliases (ignore conflicts)
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

    // Character participation from dialogue cues
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
      });
    }

    // Location participation from slugline
    if (scene.location) {
      // Find matching location entity
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
          });
        }
      }
    }
  }

  // Also wire AI-extracted scene presence
  for (const char of extractedEntities.characters) {
    const entityId = entityMap.get(char.canonical_name);
    if (!entityId || !char.scenes_present) continue;
    for (const sk of char.scenes_present) {
      const sceneId = sceneMap.get(sk);
      if (!sceneId) continue;
      // Don't duplicate
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
      });
    }
  }

  // Batch insert with conflict handling
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
      confidence: t.confidence === "high" ? 0.9 : t.confidence === "medium" ? 0.7 : 0.5,
      review_tier: t.review_tier || "review_required",
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
  const results: any = { canon_locations: 0, entity_visual_states: 0 };

  // ── Distribute locations to canon_locations ──
  for (const loc of extractedEntities.locations) {
    const entityId = entityMap.get(loc.canonical_name);
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

  // ── Distribute state transitions to entity_visual_states ──
  for (const t of stateTransitions) {
    const entityId = entityMap.get(t.entity_name);
    if (!entityId) continue;

    const stateKey = normalizeEntityKey(t.to_state);

    const { data: existing } = await supabase
      .from("entity_visual_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("entity_name", t.entity_name)
      .eq("state_key", stateKey)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      await supabase.from("entity_visual_states").insert({
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
      });
      results.entity_visual_states++;
    }
  }

  return results;
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

    if (action === "ingest") {
      const { projectId, sourceDocumentIds, sourceVersionId, force } = body;
      if (!projectId) throw new Error("projectId required");

      console.log(`[story-ingestion] Starting ingestion for project ${projectId}`);

      // ── Create run record ──
      const { data: run, error: runErr } = await supabase
        .from("story_ingestion_runs")
        .insert({
          project_id: projectId,
          source_kind: body.sourceKind || "feature_script",
          source_document_ids: sourceDocumentIds || [],
          source_version_ids: sourceVersionId ? [sourceVersionId] : [],
          status: "parsing",
          created_by: userId,
        })
        .select("id")
        .single();

      if (runErr || !run) throw new Error(`Failed to create ingestion run: ${runErr?.message}`);
      const runId = run.id;

      try {
        // ── STAGE 1: Fetch script text ──
        let scriptText = body.text || "";
        let sourceDocIds = sourceDocumentIds || [];

        if (!scriptText) {
          // Find script documents
          const scriptDocTypes = ["feature_script", "production_draft", "season_script",
            "episode_script", "script", "pilot_script", "season_master_script"];
          const { data: docs } = await supabase
            .from("project_documents")
            .select("id, doc_type")
            .eq("project_id", projectId)
            .in("doc_type", scriptDocTypes)
            .order("created_at", { ascending: false });

          if (!docs || docs.length === 0) {
            throw new Error("No script documents found for this project");
          }

          sourceDocIds = docs.map((d: any) => d.id);

          // Get latest version plaintext
          const { data: ver } = await supabase
            .from("project_document_versions")
            .select("id, plaintext")
            .eq("document_id", docs[0].id)
            .eq("is_current", true)
            .limit(1)
            .maybeSingle();

          if (!ver?.plaintext || ver.plaintext.length < 100) {
            // Try fallback: latest version
            const { data: fallback } = await supabase
              .from("project_document_versions")
              .select("id, plaintext")
              .eq("document_id", docs[0].id)
              .order("version_number", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!fallback?.plaintext || fallback.plaintext.length < 100) {
              throw new Error("No usable script text found. Ensure script has been extracted.");
            }
            scriptText = fallback.plaintext;
          } else {
            scriptText = ver.plaintext;
          }

          // Update run with resolved sources
          await supabase.from("story_ingestion_runs")
            .update({ source_document_ids: sourceDocIds })
            .eq("id", runId);
        }

        console.log(`[story-ingestion] Script text length: ${scriptText.length}`);

        // ── STAGE 1: Deterministic structural parse ──
        const scenes = parseScriptToScenes(scriptText);
        console.log(`[story-ingestion] Parsed ${scenes.length} scenes`);

        await supabase.from("story_ingestion_runs")
          .update({ status: "extracting", stage_summary: { scenes_parsed: scenes.length } })
          .eq("id", runId);

        // ── STAGE 1b: Write scenes to scene graph ──
        const sceneMap = await writeScenesToDB(supabase, projectId, userId, runId, scenes, !!force);
        console.log(`[story-ingestion] Wrote ${sceneMap.size} scenes to scene graph`);

        // ── STAGE 2: AI entity + state extraction ──
        const extracted = await extractEntitiesAndStates(scenes);
        console.log(`[story-ingestion] Extracted: ${extracted.characters.length} chars, ${extracted.locations.length} locs, ${extracted.props.length} props, ${extracted.costume_looks.length} looks, ${extracted.state_transitions.length} states`);

        // ── STAGE 2b: Merge deterministic character cues ──
        // Characters from dialogue cues that AI missed
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
        };

        await supabase.from("story_ingestion_runs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            manifest_json: manifest,
            stage_summary: manifest,
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
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (stageErr: any) {
        console.error(`[story-ingestion] Pipeline failed:`, stageErr);
        await supabase.from("story_ingestion_runs")
          .update({ status: "failed", failure_reason: stageErr.message || String(stageErr) })
          .eq("id", runId);
        throw stageErr;
      }

    } else if (action === "status") {
      const { projectId } = body;
      const { data: runs } = await supabase
        .from("story_ingestion_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(5);

      return new Response(JSON.stringify({ ok: true, runs: runs || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "review") {
      const { projectId, runId } = body;

      // Fetch entities needing review
      const { data: entities } = await supabase
        .from("narrative_entities")
        .select("*")
        .eq("project_id", projectId)
        .eq("ingestion_run_id", runId);

      const { data: transitions } = await supabase
        .from("state_transition_candidates")
        .select("*")
        .eq("project_id", projectId)
        .eq("ingestion_run_id", runId);

      const { data: aliases } = await supabase
        .from("entity_aliases")
        .select("*")
        .eq("project_id", projectId);

      const { data: participation } = await supabase
        .from("scene_entity_participation")
        .select("*")
        .eq("project_id", projectId)
        .eq("ingestion_run_id", runId);

      return new Response(JSON.stringify({
        ok: true,
        entities: entities || [],
        state_transitions: transitions || [],
        aliases: aliases || [],
        participation_count: participation?.length || 0,
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
