/**
 * storyboard-engine — Edge function for Storyboard Pipeline v1.
 * Reads canonical visual_units, creates panel plans via LLM, generates image frames via Gemini.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, callLLMWithJsonRetry, callLLMChunked } from "../_shared/llm.ts";
import { enforceCinematicQuality } from "../_shared/cinematic-kernel.ts";
import { adaptStoryboardPanelsWithMode } from "../_shared/cinematic-adapters.ts";
import { selectCikModel } from "../_shared/cik/modelRouter.ts";
import { buildStoryboardRepairInstruction } from "../_shared/cinematic-repair.ts";
import { getProjectModality, buildModalityPromptBlock } from "../_shared/productionModality.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";
const STORAGE_BUCKET = "storyboards";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** Verify project access using a direct query (service role bypasses RLS, so we check ownership/collaboration). */
async function verifyAccess(db: any, userId: string, projectId: string): Promise<boolean> {
  // Use the existing has_project_access SQL function via a raw select
  const { data, error } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
  if (error) {
    // Fallback: check project ownership directly
    console.warn("rpc has_project_access failed, falling back to direct check:", error.message);
    const { data: proj } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).limit(1).maybeSingle();
    if (proj) return true;
    // Check collaborator
    const { data: collab } = await db.from("project_collaborators").select("id").eq("project_id", projectId).eq("user_id", userId).eq("status", "accepted").limit(1).maybeSingle();
    return !!collab;
  }
  return !!data;
}

/**
 * Robust extraction of image data URL from Gemini chat/completions response.
 * Tries multiple response shapes.
 */
function extractDataUrl(genResult: any): string | null {
  try {
    const choice = genResult?.choices?.[0]?.message;
    if (!choice) return null;

    // Shape 1: images array
    const imgUrl1 = choice.images?.[0]?.image_url?.url;
    if (imgUrl1 && imgUrl1.startsWith("data:image")) return imgUrl1;

    // Shape 2: content is array of parts
    if (Array.isArray(choice.content)) {
      for (const part of choice.content) {
        // inline_data / image_url part
        if (part.type === "image_url" && part.image_url?.url?.startsWith("data:image")) {
          return part.image_url.url;
        }
        if (part.type === "image" && part.image?.url?.startsWith("data:image")) {
          return part.image.url;
        }
        // inline_data format (Gemini native)
        if (part.inline_data?.data) {
          const mime = part.inline_data.mime_type || "image/png";
          return `data:${mime};base64,${part.inline_data.data}`;
        }
        // String part that IS a data URL
        if (typeof part === "string" && part.startsWith("data:image")) return part;
        if (typeof part.text === "string" && part.text.startsWith("data:image")) return part.text;
      }
    }

    // Shape 3: content is a string that is a data URL
    if (typeof choice.content === "string" && choice.content.startsWith("data:image")) {
      return choice.content;
    }
  } catch (e) {
    console.error("extractDataUrl error:", e);
  }
  return null;
}

/** Decode a data:image/...;base64,... URL to raw bytes */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64Part = dataUrl.split(",")[1];
  if (!base64Part) throw new Error("Invalid data URL — no base64 part");
  const binaryStr = atob(base64Part);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

// ─── list_canonical_units ───
async function handleListCanonicalUnits(db: any, body: any) {
  const { projectId, unitKeys } = body;
  let query = db.from("visual_units").select("unit_key, canonical_payload, source_versions, locked, stale").eq("project_id", projectId);
  if (unitKeys && Array.isArray(unitKeys) && unitKeys.length > 0) {
    query = query.in("unit_key", unitKeys);
  }
  const { data, error } = await query.order("unit_key");
  if (error) return json({ error: error.message }, 500);
  const units = (data || []).map((u: any) => ({
    ...u,
    scores: {
      trailer_value: u.canonical_payload?.trailer_value,
      storyboard_value: u.canonical_payload?.storyboard_value,
      pitch_value: u.canonical_payload?.pitch_value,
      complexity: u.canonical_payload?.complexity,
    },
  }));
  return json({ units });
}

// ─── create_run_and_panels ───
async function handleCreateRunAndPanels(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, unitKeys: requestedKeys, stylePreset = "cinematic_realism", aspectRatio = "16:9", castContext } = body;

  // Read project lane + modality once for prompt injection (fail loudly on auth/fetch errors)
  let projectLane: string | undefined;
  let projectModality = 'live_action';
  const { data: projRow, error: projFetchErr } = await db.from("projects").select("assigned_lane, project_features").eq("id", projectId).single();
  if (projFetchErr) {
    console.error(`[storyboard-engine] project fetch failed for ${projectId}: ${projFetchErr.message}`);
    // Non-fatal for lane/modality: defaults apply, but log loudly
  }
  if (projRow) {
    projectLane = projRow.assigned_lane || undefined;
    projectModality = getProjectModality(projRow.project_features);
  }
  console.log(`[storyboard-engine] production_modality=${projectModality} lane=${projectLane || "unknown"}`);

  const { data: allUnits } = await db.from("visual_units").select("*").eq("project_id", projectId);
  if (!allUnits || allUnits.length === 0) return json({ error: "No canonical visual units found" }, 400);

  let selectedUnits: any[];
  if (requestedKeys && Array.isArray(requestedKeys) && requestedKeys.length > 0) {
    selectedUnits = allUnits.filter((u: any) => requestedKeys.includes(u.unit_key));
  } else {
    selectedUnits = allUnits
      .sort((a: any, b: any) =>
        (b.canonical_payload?.storyboard_value || b.canonical_payload?.trailer_value || 0) -
        (a.canonical_payload?.storyboard_value || a.canonical_payload?.trailer_value || 0)
      )
      .slice(0, 12);
  }

  if (selectedUnits.length === 0) return json({ error: "No matching units" }, 400);
  const chosenKeys = selectedUnits.map((u: any) => u.unit_key);

  // ── Stable cast context hash (deterministic, no schema change) ──
  function stableStringify(val: unknown): string {
    if (val === null || val === undefined) return "null";
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return JSON.stringify(val);
    if (Array.isArray(val)) return "[" + val.map(stableStringify).join(",") + "]";
    if (typeof val === "object") {
      const keys = Object.keys(val as Record<string, unknown>).sort();
      return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((val as any)[k])).join(",") + "}";
    }
    return JSON.stringify(val);
  }

  let castContextHash: string | null = null;
  if (castContext && Array.isArray(castContext) && castContext.length > 0) {
    const normalized = [...castContext]
      .sort((a: any, b: any) => (a.character_key || a.actor_name || "").localeCompare(b.character_key || b.actor_name || ""))
      .map((entry: any) => ({
        character_key: entry.character_key || null,
        actor_name: entry.actor_name || null,
        description: entry.description || null,
        negative_prompt: entry.negative_prompt || null,
        wardrobe_pack: entry.wardrobe_pack || null,
        recipe: entry.recipe || {},
        reference_images: [...(entry.reference_images || [])].sort(),
      }));
    const canonical = stableStringify(normalized);
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
    castContextHash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log(`[storyboard-engine] cast_context_hash=${castContextHash} actors=${castContext.length}`);
  }

  const { data: run, error: runErr } = await db.from("storyboard_runs").insert({
    project_id: projectId,
    unit_keys: chosenKeys,
    style_preset: stylePreset,
    aspect_ratio: aspectRatio,
    status: "pending",
    created_by: userId,
  }).select().single();
  if (runErr) return json({ error: "Failed to create run: " + runErr.message }, 500);

  const _castAudit = castContextHash ? { cast_context_hash: castContextHash } : null;

  try {
    const unitDescriptions = selectedUnits.map((u: any) => {
      const p = u.canonical_payload || {};
      return {
        unit_key: u.unit_key,
        logline: p.logline || "",
        visual_intention: p.visual_intention || "",
        location: p.location || "",
        time: p.time || "",
        tone: (p.tone || []).join(", "),
        characters: (p.characters_present || []).join(", "),
        suggested_shots: p.suggested_shots || [],
      };
    });

    const PANELS_BATCH_SIZE = 4; // 4 units per batch to stay well under token limits

    const panelSystemPrompt = `You are a storyboard director. Given visual unit descriptions, produce a detailed panel plan for each unit.

Return STRICT JSON only (no prose, no markdown) in this exact schema:
{
  "panels_by_unit": [
    {
      "unit_key": "string",
      "panels": [
        {
          "panel_index": 1,
          "shot_type": "WS|MS|CU|ECU|OTS|Aerial|Insert",
          "camera": "static|handheld|dolly|crane|steadicam|drone",
          "lens": "18mm|24mm|35mm|50mm|85mm",
          "composition": "what's in frame + framing notes",
          "action": "what happens",
          "mood": "tone words",
          "lighting": "lighting plan",
          "prompt": "image generation prompt (safe, no copyrighted characters, describe scene cinematically)",
          "negative_prompt": "things to avoid in image",
          "continuity_notes": "brief continuity"
        }
      ]
    }
  ]
}

Rules:
- 3-5 panels per unit (vary shot types for visual interest)
- Style preset: ${stylePreset}
- Aspect ratio: ${aspectRatio}
- Prompts must be safe for AI image generation (no real people names, no copyrighted characters)
- Include lighting, mood, and composition details in the prompt field

------------------------------------------------------------
INTERNAL CIK METADATA (REQUIRED)
------------------------------------------------------------

You MUST include a top-level "cik" object in your JSON response.
It contains internal quality-scoring metadata and will be stripped before storage.

"cik": {
  "units": [
    {
      "id": "<unit_key value>",
      "intent": "intrigue|threat|wonder|chaos|emotion|release",
      "energy": 0.0-1.0,
      "tension": 0.0-1.0,
      "density": 0.0-1.0,
      "tonal_polarity": -1.0 to 1.0
    }
  ]
}

Rules for cik.units:
- Array length MUST equal the number of units in panels_by_unit.
- Each unit id MUST match the corresponding unit_key value.
- intent: choose the single dominant intent for each unit.
- energy/tension/density: 0.0 to 1.0 floats reflecting unit intensity.
- tonal_polarity: -1.0 (dark/threatening) to 1.0 (hopeful/uplifting).
- Do NOT omit any field. Do NOT change the main output schema.

CIK QUALITY MINIMUMS (MUST SATISFY):
- PEAK: At least one of the final 2 units must have energy >= 0.90 AND tension >= 0.80.
- CONTRAST: At least one adjacent pair of units must have an energy increase >= 0.20.

Return ONLY valid JSON`;

    // Inject cast context into prompt if available (additive — no change when absent)
    let castContextBlock = "";
    if (castContext && Array.isArray(castContext) && castContext.length > 0) {
      const castLines = castContext.map((c: any) => {
        const parts = [`Character: "${c.character_key}" → Actor: "${c.actor_name}"`];
        if (c.description) parts.push(`  Description: ${c.description}`);
        if (c.negative_prompt) parts.push(`  MUST NOT: ${c.negative_prompt}`);
        const recipe = c.recipe || {};
        if (recipe.invariants?.length) parts.push(`  Identity invariants: ${recipe.invariants.join("; ")}`);
        if (recipe.camera_rules?.length) parts.push(`  Camera rules: ${recipe.camera_rules.join("; ")}`);
        if (recipe.lighting_rules?.length) parts.push(`  Lighting rules: ${recipe.lighting_rules.join("; ")}`);
        return parts.join("\n");
      });
      castContextBlock = `\n\n=== AI CAST CONTEXT ===\nWhen these characters appear in panels, use these identity descriptions consistently.\nDo NOT depict real/recognizable people.\n${castLines.join("\n\n")}\n=== END CAST CONTEXT ===\n`;
    }

    // Inject modality block additively (empty string for live_action → no change)
    const modalityBlock = buildModalityPromptBlock(projectModality as any);
    console.log(`[storyboard-engine] production_modality=${projectModality}`);

    const fullPanelSystemPrompt = panelSystemPrompt + castContextBlock + modalityBlock;

    let panelsByUnit: any[];

    if (unitDescriptions.length <= PANELS_BATCH_SIZE) {
      // Small enough for a single call
      const parsed = await callLLMWithJsonRetry({
        apiKey,
        model: MODELS.BALANCED,
        system: fullPanelSystemPrompt,
        user: JSON.stringify(unitDescriptions).slice(0, 14000),
        temperature: 0.4,
        maxTokens: 10000,
      }, {
        handler: "generate_storyboard_panels",
        validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.panels_by_unit)),
      });
      panelsByUnit = parsed.panels_by_unit || parsed;
    } else {
      // Chunk by input units with deduplication + completeness
      panelsByUnit = await callLLMChunked({
        llmOpts: {
          apiKey,
          model: MODELS.BALANCED,
          system: fullPanelSystemPrompt,
          temperature: 0.4,
          maxTokens: 6000,
        },
        items: unitDescriptions,
        batchSize: PANELS_BATCH_SIZE,
        maxBatches: 8,
        handler: "generate_storyboard_panels",
        buildUserPrompt: (batch, idx, total) =>
          `Batch ${idx + 1} of ${total}. Generate panels for these ${batch.length} units ONLY:\n${JSON.stringify(batch)}`,
        validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.panels_by_unit)),
        extractItems: (d: any) => d.panels_by_unit || (Array.isArray(d) ? d : []),
        getKey: (item: any) => item.unit_key || "",
        dedupe: "first",
      });
    }

    // ── Post-combine integrity: completeness, ordering, field validation ──
    const requestedKeys = new Set(unitDescriptions.map((u: any) => u.unit_key));
    const returnedKeys = new Set(panelsByUnit.map((u: any) => u.unit_key));
    const missingKeys = [...requestedKeys].filter(k => !returnedKeys.has(k));
    if (missingKeys.length > 0) {
      throw new Error(`generate_storyboard_panels: missing panels for unit_key=${missingKeys.join(", ")}`);
    }

    // Reorder to match input order
    const keyOrder = unitDescriptions.map((u: any) => u.unit_key);
    const byKeyMap = new Map(panelsByUnit.map((u: any) => [u.unit_key, u]));
    panelsByUnit = keyOrder.map((k: string) => byKeyMap.get(k)).filter(Boolean);

    // Validate each entry has panels with required fields
    for (const entry of panelsByUnit) {
      if (!Array.isArray(entry.panels) || entry.panels.length === 0) {
        throw new Error(`generate_storyboard_panels: unit_key=${entry.unit_key} has no panels`);
      }
      for (const p of entry.panels) {
        if (p.panel_index == null || !p.prompt) {
          throw new Error(`generate_storyboard_panels: unit_key=${entry.unit_key} panel missing panel_index or prompt`);
        }
      }
    }

    // ── CIK quality gate (1 bounded repair attempt) ──
    const expectedUnitKeys = keyOrder as string[];
    const expectedUnitCount = expectedUnitKeys.length;
    const cikInput = { panels: panelsByUnit.flatMap((u: any) => (u.panels || []).map((p: any) => ({ ...p, unit_key: u.unit_key }))) };
    const sbRouter0 = selectCikModel({ attemptIndex: 0, lane: projectLane || "unknown" });
    const sbRouter1 = selectCikModel({ attemptIndex: 1, lane: projectLane || "unknown", attempt0HardFailures: [] });
    const cikResult = await enforceCinematicQuality({
      handler: "storyboard-engine",
      phase: "generate_storyboard_panels",
      model: MODELS.BALANCED,
      rawOutput: cikInput,
      adapter: (raw: any) => adaptStoryboardPanelsWithMode(raw, { expectedUnitCount, expectedUnitKeys }),
      buildRepairInstruction: buildStoryboardRepairInstruction,
      isStoryboard: true,
      expected_unit_count: expectedUnitCount,
      lane: projectLane,
      modelRouter: { attempt0: sbRouter0, attempt1: sbRouter1 },
      regenerateOnce: async (repairInstruction: string) => {
        // Re-run the same generation with repair instruction injected
        const repairedSystemPrompt = fullPanelSystemPrompt + "\n\n" + repairInstruction;
        let repairedPanels: any[];
        if (unitDescriptions.length <= PANELS_BATCH_SIZE) {
          const reParsed = await callLLMWithJsonRetry({
            apiKey,
            model: MODELS.BALANCED,
            system: repairedSystemPrompt,
            user: JSON.stringify(unitDescriptions).slice(0, 14000),
            temperature: 0.4,
            maxTokens: 10000,
          }, {
            handler: "generate_storyboard_panels_repair",
            validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.panels_by_unit)),
          });
          repairedPanels = reParsed.panels_by_unit || reParsed;
        } else {
          repairedPanels = await callLLMChunked({
            llmOpts: { apiKey, model: MODELS.BALANCED, system: repairedSystemPrompt, temperature: 0.4, maxTokens: 6000 },
            items: unitDescriptions,
            batchSize: PANELS_BATCH_SIZE,
            maxBatches: 8,
            handler: "generate_storyboard_panels_repair",
            buildUserPrompt: (batch, idx, total) =>
              `Batch ${idx + 1} of ${total}. Generate panels for these ${batch.length} units ONLY:\n${JSON.stringify(batch)}`,
            validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.panels_by_unit)),
            extractItems: (d: any) => d.panels_by_unit || (Array.isArray(d) ? d : []),
            getKey: (item: any) => item.unit_key || "",
            dedupe: "first",
          });
        }
        // Re-apply completeness + ordering checks
        const reRequestedKeys = new Set(unitDescriptions.map((u: any) => u.unit_key));
        const reReturnedKeys = new Set(repairedPanels.map((u: any) => u.unit_key));
        const reMissing = [...reRequestedKeys].filter(k => !reReturnedKeys.has(k));
        if (reMissing.length > 0) {
          throw new Error(`generate_storyboard_panels_repair: missing panels for unit_key=${reMissing.join(", ")}`);
        }
        const reByKey = new Map(repairedPanels.map((u: any) => [u.unit_key, u]));
        repairedPanels = keyOrder.map((k: string) => reByKey.get(k)).filter(Boolean);
        for (const entry of repairedPanels) {
          if (!Array.isArray(entry.panels) || entry.panels.length === 0) {
            throw new Error(`generate_storyboard_panels_repair: unit_key=${entry.unit_key} has no panels`);
          }
          for (const p of entry.panels) {
            if (p.panel_index == null || !p.prompt) {
              throw new Error(`generate_storyboard_panels_repair: unit_key=${entry.unit_key} panel missing panel_index or prompt`);
            }
          }
        }
        return { panels: repairedPanels.flatMap((u: any) => (u.panels || []).map((p: any) => ({ ...p, unit_key: u.unit_key }))) };
      },
    });
    // CIK result is stripped of cik; we don't change panelsByUnit since CIK is informational scoring only


    const panelRows: any[] = [];
    for (const unitPanels of panelsByUnit) {
      const uk = unitPanels.unit_key;
      if (!uk) continue;
      const panels = (unitPanels.panels || []).slice(0, 6);
      for (const panel of panels) {
        const payload: any = { ...panel };
        // Embed cast_context_hash on every panel for deterministic audit
        if (_castAudit) payload._audit = _castAudit;
        panelRows.push({
          project_id: projectId,
          run_id: run.id,
          unit_key: uk,
          panel_index: panel.panel_index || panelRows.filter((r: any) => r.unit_key === uk).length + 1,
          status: "proposed",
          panel_payload: payload,
          created_by: userId,
        });
      }
    }

    if (panelRows.length === 0) {
      await db.from("storyboard_runs").update({ status: "failed", error: "No panels generated" }).eq("id", run.id);
      return json({ error: "LLM produced no panels" }, 500);
    }

    const { error: insertErr } = await db.from("storyboard_panels").insert(panelRows);
    if (insertErr) {
      await db.from("storyboard_runs").update({ status: "failed", error: insertErr.message }).eq("id", run.id);
      return json({ error: "Failed to insert panels: " + insertErr.message }, 500);
    }

    await db.from("storyboard_runs").update({ status: "complete" }).eq("id", run.id);
    return json({ ok: true, runId: run.id, panelsCount: panelRows.length });
  } catch (err: any) {
    await db.from("storyboard_runs").update({ status: "failed", error: err.message }).eq("id", run.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded. Try again shortly." }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted." }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── list_runs ───
async function handleListRuns(db: any, body: any) {
  const { projectId, limit = 20 } = body;
  const { data } = await db.from("storyboard_runs").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(limit);
  return json({ runs: data || [] });
}

// ─── list_panels ───
async function handleListPanels(db: any, body: any) {
  const { projectId, runId } = body;
  if (!runId) return json({ error: "runId required" }, 400);
  const { data } = await db.from("storyboard_panels").select("*")
    .eq("project_id", projectId).eq("run_id", runId)
    .order("unit_key").order("panel_index");
  return json({ panels: data || [] });
}

// ─── get_panel ───
async function handleGetPanel(db: any, body: any) {
  const { projectId, panelId } = body;
  if (!panelId) return json({ error: "panelId required" }, 400);
  const { data: panel } = await db.from("storyboard_panels").select("*")
    .eq("id", panelId).eq("project_id", projectId).single();
  if (!panel) return json({ error: "Panel not found" }, 404);
  const { data: frames } = await db.from("storyboard_pipeline_frames").select("*")
    .eq("panel_id", panelId).eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return json({ panel, frames: frames || [] });
}

// ─── generate_frame ───
async function handleGenerateFrame(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, panelId, seed, override_prompt, override_negative } = body;
  if (!panelId) return json({ error: "panelId required" }, 400);

  const { data: panel } = await db.from("storyboard_panels").select("*, storyboard_runs(style_preset, aspect_ratio)")
    .eq("id", panelId).eq("project_id", projectId).single();
  if (!panel) return json({ error: "Panel not found" }, 404);

  const payload = panel.panel_payload || {};
  const run = panel.storyboard_runs || {};
  const stylePreset = run.style_preset || "cinematic_realism";
  const aspectRatio = run.aspect_ratio || "16:9";

  const basePrompt = override_prompt || payload.prompt || "A cinematic scene";
  const negativePrompt = override_negative || payload.negative_prompt || "";

  const styleGuide: Record<string, string> = {
    cinematic_realism: "cinematic storyboard frame, film still, high detail, realistic lighting, professional cinematography",
    anime: "anime style storyboard, detailed animation key frame, vivid colors",
    noir: "film noir style, high contrast black and white, dramatic shadows, moody atmosphere",
    watercolor: "watercolor storyboard sketch, artistic, soft edges, painterly style",
  };

  const finalPrompt = `${basePrompt}. ${styleGuide[stylePreset] || styleGuide.cinematic_realism}. Aspect ratio ${aspectRatio}.${negativePrompt ? ` Avoid: ${negativePrompt}` : ""}`;

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Image gen error:", response.status, errText);
      if (response.status === 429) return json({ error: "Rate limit exceeded" }, 429);
      if (response.status === 402) return json({ error: "AI credits exhausted" }, 402);
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      return json({ error: "Image generation failed: " + response.status }, 500);
    }

    const genResult = await response.json();

    // Robust image extraction
    const imageDataUrl = extractDataUrl(genResult);
    if (!imageDataUrl) {
      console.error("No image found in response. Shape:", JSON.stringify(Object.keys(genResult || {})), JSON.stringify(Object.keys(genResult?.choices?.[0]?.message || {})));
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      return json({ error: "No image returned from AI. Check logs for response shape." }, 500);
    }

    // Decode to bytes
    const bytes = dataUrlToBytes(imageDataUrl);

    // Upload to storage
    const storagePath = `${projectId}/storyboard-frames/${panelId}_${Date.now()}.png`;
    const blob = new Blob([bytes], { type: "image/png" });
    const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, {
      contentType: "image/png",
      upsert: false,
    });
    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      return json({ error: "Failed to upload image: " + uploadErr.message }, 500);
    }

    // Generate signed URL (private bucket — 7 day expiry)
    let publicUrl = "";
    const { data: signedData, error: signedErr } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    if (signedErr || !signedData?.signedUrl) {
      // Fallback: try public URL
      console.warn("Signed URL failed, trying public URL:", signedErr?.message);
      const { data: pubData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      publicUrl = pubData?.publicUrl || "";
      if (!publicUrl) {
        await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
        return json({ error: "Failed to create URL for uploaded image" }, 500);
      }
    } else {
      publicUrl = signedData.signedUrl;
    }

    // Insert frame record — created_by set explicitly
    const { data: frame, error: frameErr } = await db.from("storyboard_pipeline_frames").insert({
      project_id: projectId,
      panel_id: panelId,
      status: "generated",
      storage_path: storagePath,
      public_url: publicUrl,
      seed: seed || null,
      model: IMAGE_MODEL,
      gen_params: { prompt: finalPrompt, negative_prompt: negativePrompt, style_preset: stylePreset, aspect_ratio: aspectRatio, seed },
      created_by: userId,
    }).select().single();

    if (frameErr) {
      console.error("Frame insert error:", frameErr);
      return json({ error: "Failed to record frame: " + frameErr.message }, 500);
    }

    // Update panel status
    await db.from("storyboard_panels").update({ status: "generated" }).eq("id", panelId);

    return json({ ok: true, frame });
  } catch (err: any) {
    console.error("generate_frame error:", err);
    await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Invalid token" }, 401); }

    const body = await req.json();
    const action = body.action;
    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();

    // Verify access with fallback
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    switch (action) {
      case "list_canonical_units": return await handleListCanonicalUnits(db, body);
      case "create_run_and_panels": return await handleCreateRunAndPanels(db, body, userId, apiKey);
      case "list_runs": return await handleListRuns(db, body);
      case "list_panels": return await handleListPanels(db, body);
      case "get_panel": return await handleGetPanel(db, body);
      case "generate_frame": return await handleGenerateFrame(db, body, userId, apiKey);
      case "regenerate_frame": return await handleGenerateFrame(db, body, userId, apiKey);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("storyboard-engine error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
