import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, callLLMWithJsonRetry } from "../_shared/llm.ts";
import { isObject, isNonEmptyString } from "../_shared/validators.ts";

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

    const { projectId, unitId, fix } = await req.json();
    if (!projectId || !unitId || !fix) throw new Error("Missing projectId, unitId, or fix");

    const { action, payload } = fix;

    // Load unit
    const { data: unit } = await adminClient
      .from("script_units")
      .select("id, blueprint_id, order_index, title, slugline, plaintext, unit_json, project_id")
      .eq("id", unitId)
      .single();
    if (!unit) throw new Error("Unit not found");

    const result: any = { updatedUnitId: unitId, newVersionId: null, patchedUnitIds: [], refreshedBlueprint: false };

    if (action === "rewrite_scene") {
      // Load blueprint for context
      const { data: bp } = await adminClient
        .from("script_blueprints")
        .select("blueprint_json")
        .eq("id", unit.blueprint_id)
        .single();

      const rewrite = await callLLMWithJsonRetry({
        apiKey,
        model: MODELS.BALANCED,
        system: `You are a professional screenwriter. Rewrite the following scene to fix the issues described.
Maintain the scene's essential beats, characters, and dramatic function as defined in the blueprint.
Return a JSON object with:
- "plaintext": the rewritten scene text (full screenplay format)
- "unit_json": updated metadata matching the unit_json schema

Return ONLY valid JSON.`,
        user: JSON.stringify({
          current_scene: { slugline: unit.slugline, plaintext: unit.plaintext, unit_json: unit.unit_json },
          blueprint_context: bp?.blueprint_json || {},
          fix_instructions: payload,
        }),
        temperature: 0.4,
        maxTokens: 8000,
      }, {
        handler: "rewrite_scene",
        validate: (d): d is any => isObject(d) && (isNonEmptyString(d.plaintext) || isObject(d.unit_json)),
      });
      const newText = rewrite.plaintext || unit.plaintext;
      const newUnitJson = rewrite.unit_json || unit.unit_json;

      // Get next version number
      const { data: maxVer } = await adminClient
        .from("script_unit_versions")
        .select("version_number")
        .eq("unit_id", unitId)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();

      const nextVersion = (maxVer?.version_number || 0) + 1;

      // Create new version
      const { data: newVer } = await adminClient
        .from("script_unit_versions")
        .insert({
          unit_id: unitId,
          version_number: nextVersion,
          plaintext: newText,
          unit_json: newUnitJson,
          created_by: user.id,
        })
        .select("id")
        .single();

      // Update unit
      await adminClient
        .from("script_units")
        .update({ plaintext: newText, unit_json: newUnitJson })
        .eq("id", unitId);

      result.newVersionId = newVer?.id;

    } else if (action === "patch_impacted") {
      // Patch impacted scenes
      const impactedIds = payload?.impacted_unit_ids || [];
      const instructions = payload?.instructions || "";

      for (const impId of impactedIds) {
        const { data: impUnit } = await adminClient
          .from("script_units")
          .select("id, slugline, plaintext, unit_json")
          .eq("id", impId)
          .single();
        if (!impUnit) continue;

        try {
          const patchResult = await callLLM({
            apiKey,
            model: MODELS.FAST,
            system: `You are a screenwriter applying a minimal patch to a scene for continuity.
Apply the described fix with minimal changes to the scene. Preserve tone and style.
Return JSON: { "plaintext": string, "unit_json": object }`,
            user: JSON.stringify({
              scene: { slugline: impUnit.slugline, plaintext: impUnit.plaintext, unit_json: impUnit.unit_json },
              patch_instructions: instructions,
              triggering_scene: { slugline: unit.slugline, change_summary: payload?.change_summary },
            }),
            temperature: 0.3,
            maxTokens: 6000,
          });

          const patch = await parseJsonSafe(patchResult.content, apiKey);

          // Get next version
          const { data: maxV } = await adminClient
            .from("script_unit_versions")
            .select("version_number")
            .eq("unit_id", impId)
            .order("version_number", { ascending: false })
            .limit(1)
            .single();

          const nextV = (maxV?.version_number || 0) + 1;

          await adminClient.from("script_unit_versions").insert({
            unit_id: impId,
            version_number: nextV,
            plaintext: patch.plaintext || impUnit.plaintext,
            unit_json: patch.unit_json || impUnit.unit_json,
            created_by: user.id,
          });

          await adminClient
            .from("script_units")
            .update({ plaintext: patch.plaintext || impUnit.plaintext, unit_json: patch.unit_json || impUnit.unit_json })
            .eq("id", impId);

          result.patchedUnitIds.push(impId);
        } catch (err) {
          console.error(`[feature-scene-apply-fix] Failed to patch ${impId}:`, err);
        }
      }

    } else if (action === "update_blueprint") {
      // Update blueprint
      const { data: bp } = await adminClient
        .from("script_blueprints")
        .select("blueprint_json")
        .eq("id", unit.blueprint_id)
        .single();

      if (bp) {
        const updateResult = await callLLM({
          apiKey,
          model: MODELS.FAST,
          system: `Update the screenplay blueprint JSON to incorporate the described changes.
Return the complete updated blueprint JSON.`,
          user: JSON.stringify({
            current_blueprint: bp.blueprint_json,
            changes: payload,
          }),
          temperature: 0.2,
          maxTokens: 10000,
        });

        const updatedBp = await parseJsonSafe(updateResult.content, apiKey);
        await adminClient
          .from("script_blueprints")
          .update({ blueprint_json: updatedBp })
          .eq("id", unit.blueprint_id);

        result.refreshedBlueprint = true;
      }
    }

    // Refresh world state
    try {
      const { data: allScenes } = await adminClient
        .from("script_units")
        .select("id, unit_json")
        .eq("project_id", projectId)
        .eq("unit_type", "scene")
        .order("order_index");

      if (allScenes) {
        const worldState: any = {
          knowledge_ledger: [], injury_ledger: [], relationship_ledger: [], prop_ledger: [], timeline_notes: [],
        };

        for (const s of allScenes) {
          const uj = s.unit_json as any;
          if (!uj?.state_delta) continue;
          const sd = uj.state_delta;
          if (sd.knowledge) {
            for (const k of sd.knowledge) {
              const existing = worldState.knowledge_ledger.find((e: any) => e.character === k.character);
              if (existing) existing.knows.push(k.learns);
              else worldState.knowledge_ledger.push({ character: k.character, knows: [k.learns] });
            }
          }
          if (sd.injuries) for (const inj of sd.injuries) worldState.injury_ledger.push({ character: inj.character, status: inj.change });
          if (sd.relationships) for (const rel of sd.relationships) worldState.relationship_ledger.push({ a: rel.a, b: rel.b, status: rel.change });
          if (uj.props) {
            for (const prop of uj.props) {
              const existing = worldState.prop_ledger.find((p: any) => p.prop === prop);
              if (existing) existing.last_seen_scene_id = s.id;
              else worldState.prop_ledger.push({ prop, status: "present", last_seen_scene_id: s.id });
            }
          }
        }

        await adminClient.from("script_world_state").upsert({
          project_id: projectId,
          blueprint_id: unit.blueprint_id,
          state_json: worldState,
        }, { onConflict: "project_id" });
      }
    } catch (err) {
      console.error("[feature-scene-apply-fix] World state refresh failed:", err);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[feature-scene-apply-fix] Error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
