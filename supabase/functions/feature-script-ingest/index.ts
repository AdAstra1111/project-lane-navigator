import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithJsonRetry, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { projectId, sourceVersionId, plaintextScript } = await req.json();
    if (!projectId || !plaintextScript) throw new Error("Missing projectId or plaintextScript");

    // Verify project access
    const { data: project } = await userClient.from("projects").select("id, title").eq("id", projectId).single();
    if (!project) throw new Error("Project not found or no access");

    console.log(`[feature-script-ingest] Starting for project ${projectId}, script length: ${plaintextScript.length}`);

    // Step 1: Split script into scenes using slugline detection
    const scenes = splitIntoScenes(plaintextScript);
    console.log(`[feature-script-ingest] Detected ${scenes.length} scenes`);

    if (scenes.length === 0) {
      throw new Error("Could not detect any scenes in the script. Ensure it contains INT./EXT. sluglines.");
    }

    // Step 2: Create blueprint
    const { data: blueprint, error: bpErr } = await adminClient
      .from("script_blueprints")
      .insert({
        project_id: projectId,
        source_document_version_id: sourceVersionId || null,
        blueprint_json: { meta: { format: "feature", title: project.title || "Untitled", genre: "", tone: "", draft_date: new Date().toISOString().slice(0, 10) } },
        created_by: user.id,
      })
      .select("id")
      .single();
    if (bpErr) throw bpErr;

    // Step 3: Create world state
    await adminClient.from("script_world_state").upsert({
      project_id: projectId,
      blueprint_id: blueprint.id,
      state_json: { knowledge_ledger: [], injury_ledger: [], relationship_ledger: [], prop_ledger: [], timeline_notes: [] },
    }, { onConflict: "project_id" });

    // Step 4: Create scene units + versions
    const unitRows: any[] = [];
    const scenesSummary: any[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      unitRows.push({
        project_id: projectId,
        blueprint_id: blueprint.id,
        unit_type: "scene",
        order_index: i,
        title: scene.title || `Scene ${i + 1}`,
        slugline: scene.slugline,
        time_of_day: scene.timeOfDay,
        location: scene.location,
        plaintext: scene.text,
        unit_json: {},
        created_by: user.id,
      });
    }

    const { data: createdUnits, error: unitErr } = await adminClient
      .from("script_units")
      .insert(unitRows)
      .select("id, order_index, title, slugline");
    if (unitErr) throw unitErr;

    // Create version 1 for each unit
    const versionRows = createdUnits.map((u: any, i: number) => ({
      unit_id: u.id,
      version_number: 1,
      plaintext: scenes[i].text,
      unit_json: {},
      created_by: user.id,
    }));

    await adminClient.from("script_unit_versions").insert(versionRows);

    // Step 5: Generate metadata for scenes in batches using LLM
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < createdUnits.length; batchStart += BATCH_SIZE) {
      const batch = createdUnits.slice(batchStart, batchStart + BATCH_SIZE);
      const batchScenes = scenes.slice(batchStart, batchStart + BATCH_SIZE);

      const scenesForLLM = batch.map((u: any, i: number) => ({
        id: u.id,
        order_index: u.order_index,
        slugline: u.slugline,
        text: batchScenes[i].text.slice(0, 2000),
      }));

      try {
        const parsed = await callLLMWithJsonRetry({
          apiKey,
          model: MODELS.FAST,
          system: `You are a screenplay analyst. For each scene provided, generate structured metadata as JSON.
Return a JSON array where each element has:
- "id": the scene id (string)
- "unit_json": an object with fields: intent (string), conflict (string), outcome (string), stakes (string), characters_present (string[]), props (string[]), secrets_info (string[]), setup_tags (string[]), payoff_tags (string[]), thematic_tags (string[]), state_delta: { knowledge: [{character, learns}], injuries: [{character, change}], relationships: [{a, b, change}] }

Return ONLY a JSON array.`,
          user: JSON.stringify(scenesForLLM),
          temperature: 0.2,
          maxTokens: 8000,
        }, {
          handler: "feature_script_ingest_metadata",
          validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.scenes)),
        });
        const metaArray = Array.isArray(parsed) ? parsed : [parsed];

        for (const meta of metaArray) {
          if (meta.id && meta.unit_json) {
            await adminClient
              .from("script_units")
              .update({ unit_json: meta.unit_json })
              .eq("id", meta.id);
            await adminClient
              .from("script_unit_versions")
              .update({ unit_json: meta.unit_json })
              .eq("unit_id", meta.id)
              .eq("version_number", 1);
          }
        }
      } catch (err) {
        console.error(`[feature-script-ingest] Metadata batch ${batchStart} failed:`, err);
        // Continue — metadata is non-critical at ingest time
      }
    }

    for (const u of createdUnits) {
      scenesSummary.push({ id: u.id, order_index: u.order_index, title: u.title, slugline: u.slugline });
    }

    return new Response(JSON.stringify({
      blueprintId: blueprint.id,
      unitsCreated: createdUnits.length,
      scenes: scenesSummary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[feature-script-ingest] Error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Scene splitter ──
interface ParsedScene {
  slugline: string;
  title: string;
  location: string;
  timeOfDay: string;
  text: string;
}

function splitIntoScenes(script: string): ParsedScene[] {
  const lines = script.split("\n");
  const scenes: ParsedScene[] = [];
  let currentScene: ParsedScene | null = null;
  let currentLines: string[] = [];

  const sluglineRegex = /^\s*(SCENE\s+\d+\s*[-:]?\s*)?((INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*.+)/i;
  const numberedRegex = /^\s*(\d+)\s*[\.\)\s]\s*((INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*.+)/i;

  for (const line of lines) {
    const slugMatch = line.match(sluglineRegex) || line.match(numberedRegex);
    if (slugMatch) {
      // Save previous scene
      if (currentScene) {
        currentScene.text = currentLines.join("\n").trim();
        if (currentScene.text.length > 0) scenes.push(currentScene);
      }

      const fullSlugline = (slugMatch[2] || slugMatch[3] || line).trim();
      const { location, timeOfDay } = parseSlugline(fullSlugline);

      currentScene = {
        slugline: fullSlugline,
        title: fullSlugline.slice(0, 80),
        location,
        timeOfDay,
        text: "",
      };
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Last scene
  if (currentScene) {
    currentScene.text = currentLines.join("\n").trim();
    if (currentScene.text.length > 0) scenes.push(currentScene);
  }

  // If no sluglines found, treat entire script as one scene
  if (scenes.length === 0 && script.trim().length > 0) {
    scenes.push({
      slugline: "FULL SCRIPT",
      title: "Full Script",
      location: "",
      timeOfDay: "",
      text: script.trim(),
    });
  }

  return scenes;
}

function parseSlugline(slugline: string): { location: string; timeOfDay: string } {
  // Extract time of day (after last dash)
  const dashParts = slugline.split(" - ");
  const timeOfDay = dashParts.length > 1 ? dashParts[dashParts.length - 1].trim() : "";
  
  // Extract location (between INT./EXT. and the dash)
  const locMatch = slugline.match(/(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.+?)(?:\s*-\s*|$)/i);
  const location = locMatch ? locMatch[1].trim() : "";

  return { location, timeOfDay };
}
