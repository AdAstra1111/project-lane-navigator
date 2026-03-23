/**
 * Edge Function: ai-cast
 * Manages AI actor library: create, version, assets, screen tests, cast context.
 * Actions: ping, create_actor, update_actor, list_actors, get_actor,
 *          create_version, approve_version, add_asset, delete_asset,
 *          generate_screen_test, get_cast_context
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const BUILD = "ai-cast-v2";

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Credentials": "true",
  };
}

function jsonRes(data: any, status = 200, req: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

const MAX_SCREEN_TEST_STILLS = 12;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method === "GET") {
    return jsonRes({ ok: true, build: BUILD }, 200, req);
  }

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ error: "Invalid JSON" }, 400, req);
  }

  const { action } = body;
  if (action === "ping") return jsonRes({ ok: true, build: BUILD }, 200, req);

  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonRes({ error: "Unauthorized" }, 401, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === serviceKey;

  let userId: string;
  if (isServiceRole) {
    userId = body.userId;
    if (!userId) return jsonRes({ error: "userId required for service_role" }, 400, req);
  } else {
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return jsonRes({ error: "Unauthorized" }, 401, req);
    userId = userData.user.id;
  }

  const db = createClient(supabaseUrl, serviceKey);

  try {
    switch (action) {
      case "create_actor": {
        const { name, description, negative_prompt, tags } = body;
        const { data, error } = await db.from("ai_actors").insert({
          user_id: userId,
          name: name || "Untitled Actor",
          description: description || "",
          negative_prompt: negative_prompt || "",
          tags: tags || [],
          status: "draft",
        }).select("id, name, status, created_at").single();
        if (error) throw error;

        // Auto-create version 1
        const { data: ver, error: verErr } = await db.from("ai_actor_versions").insert({
          actor_id: data.id,
          version_number: 1,
          recipe_json: { invariants: [], allowed_variations: [], camera_rules: [], lighting_rules: [] },
          created_by: userId,
        }).select("id, version_number").single();
        if (verErr) throw verErr;

        return jsonRes({ actor: data, version: ver }, 200, req);
      }

      case "update_actor": {
        const { actorId, name, description, negative_prompt, tags, status } = body;
        const { data: existing } = await db.from("ai_actors").select("id").eq("id", actorId).eq("user_id", userId).single();
        if (!existing) return jsonRes({ error: "Actor not found or access denied" }, 404, req);

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (negative_prompt !== undefined) updates.negative_prompt = negative_prompt;
        if (tags !== undefined) updates.tags = tags;
        if (status !== undefined) updates.status = status;

        const { data, error } = await db.from("ai_actors").update(updates).eq("id", actorId).select("*").single();
        if (error) throw error;
        return jsonRes({ actor: data }, 200, req);
      }

      case "list_actors": {
        const { data, error } = await db.from("ai_actors")
          .select("*, ai_actor_versions!ai_actor_versions_actor_id_fkey(id, version_number, created_at)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonRes({ actors: data || [] }, 200, req);
      }

      case "get_actor": {
        const { actorId } = body;
        const { data, error } = await db.from("ai_actors")
          .select("*, ai_actor_versions!ai_actor_versions_actor_id_fkey(*, ai_actor_assets(*))")
          .eq("id", actorId)
          .eq("user_id", userId)
          .single();
        if (error || !data) return jsonRes({ error: "Actor not found" }, 404, req);
        return jsonRes({ actor: data }, 200, req);
      }

      case "create_version": {
        const { actorId, recipe_json } = body;
        const { data: actor } = await db.from("ai_actors").select("id").eq("id", actorId).eq("user_id", userId).single();
        if (!actor) return jsonRes({ error: "Actor not found" }, 404, req);

        const { data: versions } = await db.from("ai_actor_versions")
          .select("version_number")
          .eq("actor_id", actorId)
          .order("version_number", { ascending: false })
          .limit(1);
        const nextVer = ((versions?.[0]?.version_number) || 0) + 1;

        const { data, error } = await db.from("ai_actor_versions").insert({
          actor_id: actorId,
          version_number: nextVer,
          recipe_json: recipe_json || { invariants: [], allowed_variations: [], camera_rules: [], lighting_rules: [] },
          created_by: userId,
        }).select("*").single();
        if (error) throw error;
        return jsonRes({ version: data }, 200, req);
      }

      case "approve_version": {
        const { actorId, versionId } = body;
        const { data: actor } = await db.from("ai_actors").select("id").eq("id", actorId).eq("user_id", userId).single();
        if (!actor) return jsonRes({ error: "Actor not found" }, 404, req);

        // Single approved version rule: unapprove all others first
        await db.from("ai_actor_versions")
          .update({ is_approved: false })
          .eq("actor_id", actorId)
          .neq("id", versionId);

        // Approve the chosen version
        const { data, error } = await db.from("ai_actor_versions")
          .update({ is_approved: true })
          .eq("id", versionId)
          .eq("actor_id", actorId)
          .select("*").single();
        if (error) throw error;

        // Activate actor
        await db.from("ai_actors").update({ status: "active" }).eq("id", actorId);

        return jsonRes({ version: data }, 200, req);
      }

      case "add_asset": {
        const { versionId, asset_type, storage_path, public_url, meta_json } = body;
        // Verify ownership chain
        const { data: ver } = await db.from("ai_actor_versions")
          .select("id, actor_id, ai_actors!inner(user_id)")
          .eq("id", versionId)
          .single();
        if (!ver || (ver as any).ai_actors?.user_id !== userId) {
          return jsonRes({ error: "Version not found or access denied" }, 404, req);
        }

        const { data, error } = await db.from("ai_actor_assets").insert({
          actor_version_id: versionId,
          asset_type: asset_type || "reference_image",
          storage_path: storage_path || "",
          public_url: public_url || "",
          meta_json: meta_json || {},
        }).select("*").single();
        if (error) throw error;
        return jsonRes({ asset: data }, 200, req);
      }

      case "delete_asset": {
        const { assetId } = body;
        if (!assetId) return jsonRes({ error: "assetId required" }, 400, req);

        // Verify ownership chain: asset → version → actor.user_id == userId
        const { data: asset } = await db.from("ai_actor_assets")
          .select("id, actor_version_id, ai_actor_versions!inner(actor_id, ai_actors!inner(user_id))")
          .eq("id", assetId)
          .single();

        if (!asset) return jsonRes({ error: "Asset not found" }, 404, req);
        const ownerUserId = (asset as any).ai_actor_versions?.ai_actors?.user_id;
        if (ownerUserId !== userId) {
          return jsonRes({ error: "Access denied — you do not own this asset" }, 403, req);
        }

        const { error } = await db.from("ai_actor_assets").delete().eq("id", assetId);
        if (error) throw error;
        return jsonRes({ deleted: true }, 200, req);
      }

      case "generate_screen_test": {
        const { actorId, versionId, count } = body;
        if (!actorId || !versionId) {
          return jsonRes({ error: "actorId and versionId required" }, 400, req);
        }

        // 1. Verify actor ownership
        const { data: stActor } = await db.from("ai_actors")
          .select("id, name, description, negative_prompt, anchor_coverage_status, user_id")
          .eq("id", actorId).eq("user_id", userId).single();
        if (!stActor) return jsonRes({ error: "Actor not found or access denied" }, 404, req);

        // 2. Verify version belongs to actor
        const { data: stVer } = await db.from("ai_actor_versions")
          .select("id, actor_id").eq("id", versionId).eq("actor_id", actorId).single();
        if (!stVer) return jsonRes({ error: "Version not found for this actor" }, 404, req);

        // 3. Check anchor coverage
        if ((stActor as any).anchor_coverage_status !== "complete") {
          return jsonRes({
            error: "Insufficient anchor coverage. Upload headshot, full body, and profile reference images first.",
            code: "ANCHOR_COVERAGE_INSUFFICIENT",
            current_status: (stActor as any).anchor_coverage_status,
          }, 400, req);
        }

        // 4. Fetch anchor reference images
        const { data: anchorAssets } = await db.from("ai_actor_assets")
          .select("public_url, asset_type, meta_json")
          .eq("actor_version_id", versionId)
          .in("asset_type", ["reference_headshot", "reference_full_body", "reference_profile"]);
        const anchors = (anchorAssets || []).filter((a: any) => a.public_url);

        if (anchors.length < 1) {
          return jsonRes({
            error: "No anchor reference images found for this version.",
            code: "NO_ANCHOR_ASSETS",
          }, 400, req);
        }

        // 5. Build generation prompts
        const actorName = (stActor as any).name || "Character";
        const actorDesc = (stActor as any).description || "";
        const negPrompt = (stActor as any).negative_prompt || "";
        const genCount = Math.min(Math.max(count || 3, 1), MAX_SCREEN_TEST_STILLS);

        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (!LOVABLE_API_KEY) {
          return jsonRes({ error: "AI generation not configured" }, 500, req);
        }

        const poses = [
          "a cinematic medium close-up portrait, natural lighting, looking slightly off-camera, film grain texture",
          "a cinematic three-quarter body shot, warm practical lighting, subtle environment context, captured on 35mm film",
          "a dramatic close-up with strong side lighting, shallow depth of field, moody atmosphere, shot on Arri Alexa",
          "a full body wide shot in a cinematic environment, natural daylight, authentic wardrobe, documentary-style framing",
          "an intimate over-the-shoulder perspective, soft bokeh background, golden hour light, real skin texture with pores",
          "a dynamic medium shot with movement, slightly desaturated color grade, environmental storytelling, handheld camera feel",
        ];

        // 6. Generate images
        const results: any[] = [];
        const errors: any[] = [];

        for (let i = 0; i < genCount; i++) {
          const pose = poses[i % poses.length];
          const prompt = `Generate a photorealistic cinematic still of ${actorName}. ${actorDesc}. The shot is ${pose}. The image must look like a real photograph captured on set — not AI-rendered, not concept art. Real skin texture with visible pores, film grain, imperfect real-world lighting. ${negPrompt ? `Avoid: ${negPrompt}.` : ""} No watermarks, no text overlays.`;

          try {
            // Build messages with anchor image references
            const messageContent: any[] = [{ type: "text", text: prompt }];
            // Include up to 2 anchor refs for identity consistency
            for (const anchor of anchors.slice(0, 2)) {
              if (anchor.public_url) {
                messageContent.push({
                  type: "image_url",
                  image_url: { url: anchor.public_url },
                });
              }
            }

            const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3.1-flash-image-preview",
                messages: [{ role: "user", content: messageContent }],
                modalities: ["image", "text"],
              }),
            });

            if (!aiResp.ok) {
              const errText = await aiResp.text();
              console.error(`Screen test gen ${i} failed (${aiResp.status}):`, errText);
              if (aiResp.status === 429) {
                errors.push({ index: i, error: "Rate limited — try again shortly", code: "RATE_LIMITED" });
                continue;
              }
              if (aiResp.status === 402) {
                errors.push({ index: i, error: "Credits exhausted", code: "CREDITS_EXHAUSTED" });
                break;
              }
              errors.push({ index: i, error: `Generation failed: ${aiResp.status}` });
              continue;
            }

            const aiData = await aiResp.json();
            const imageB64 = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

            if (!imageB64 || !imageB64.startsWith("data:image")) {
              errors.push({ index: i, error: "No image returned from model" });
              continue;
            }

            // 7. Decode and upload to storage
            const base64Data = imageB64.split(",")[1];
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let b = 0; b < binaryStr.length; b++) {
              bytes[b] = binaryStr.charCodeAt(b);
            }

            const storagePath = `actors/${actorId}/screen-test/${versionId}_${i}_${Date.now()}.png`;
            const { error: uploadErr } = await db.storage
              .from("ai-media")
              .upload(storagePath, bytes, { contentType: "image/png", upsert: true });

            if (uploadErr) {
              console.error(`Upload failed for screen test ${i}:`, uploadErr);
              errors.push({ index: i, error: "Upload failed" });
              continue;
            }

            // 8. Get public URL
            const { data: urlData } = db.storage.from("ai-media").getPublicUrl(storagePath);
            const publicUrl = urlData?.publicUrl || "";

            // 9. Persist as asset
            const { data: assetRow, error: assetErr } = await db.from("ai_actor_assets").insert({
              actor_version_id: versionId,
              asset_type: "screen_test_still",
              storage_path: storagePath,
              public_url: publicUrl,
              meta_json: {
                shot_type: "screen_test",
                pose_index: i,
                pose_description: pose,
                generated_at: new Date().toISOString(),
                model: "gemini-3.1-flash-image-preview",
              },
            }).select("id, public_url, asset_type, meta_json").single();

            if (assetErr) {
              console.error(`Asset persist failed for ${i}:`, assetErr);
              errors.push({ index: i, error: "Failed to save asset record" });
              continue;
            }

            results.push(assetRow);
          } catch (genErr) {
            console.error(`Screen test generation ${i} exception:`, genErr);
            errors.push({ index: i, error: (genErr as any)?.message || "Unknown generation error" });
          }
        }

        return jsonRes({
          generated: results.length,
          requested: genCount,
          assets: results,
          errors: errors.length > 0 ? errors : undefined,
        }, 200, req);
      }

      case "get_cast_context": {
        const { projectId } = body;
        if (!projectId) return jsonRes({ error: "projectId required" }, 400, req);

        // Verify project access — for service role, still verify the provided userId has access
        const { data: hasAccess } = await db.rpc("has_project_access", {
          _user_id: userId,
          _project_id: projectId,
        });
        if (!hasAccess) return jsonRes({ error: "Access denied" }, 403, req);

        // Get all cast mappings for the project, ensuring actors belong to the calling user
        const { data: castMappings, error: castErr } = await db
          .from("project_ai_cast")
          .select(`
            character_key, wardrobe_pack, notes, ai_actor_version_id,
            ai_actors!inner(id, name, description, negative_prompt, tags, user_id, approved_version_id, roster_ready)
          `)
          .eq("project_id", projectId);

        if (castErr) throw castErr;

        // Filter to only actors owned by the caller (cross-user actors blocked)
        const ownedMappings = (castMappings || []).filter(
          (m: any) => (m as any).ai_actors?.user_id === userId
        );

        // For each mapping, resolve ONLY the pinned version from binding — no fallback
        const castContext: any[] = [];
        for (const mapping of ownedMappings) {
          const actor = (mapping as any).ai_actors;
          // MUST use pinned version from binding only — no fallback to approved_version_id
          const versionId = (mapping as any).ai_actor_version_id || null;

          if (!versionId) {
            // No pinned version — explicit unbound, skip this mapping
            castContext.push({
              character_key: mapping.character_key,
              actor_name: actor?.name,
              bound: false,
              reason: 'no_pinned_version',
            });
            continue;
          }

          const { data: verData } = await db.from("ai_actor_versions")
            .select("id, version_number, recipe_json")
            .eq("id", versionId)
            .maybeSingle();

          const { data: assetData } = await db.from("ai_actor_assets")
            .select("asset_type, storage_path, public_url, meta_json")
            .eq("actor_version_id", versionId)
            .in("asset_type", ["reference_image", "screen_test_still", "reference_headshot", "reference_full_body"]);
          const assets = assetData || [];

          castContext.push({
            character_key: mapping.character_key,
            bound: true,
            actor_id: actor?.id,
            actor_name: actor?.name,
            actor_version_id: versionId,
            description: actor?.description,
            negative_prompt: actor?.negative_prompt,
            recipe: verData?.recipe_json || {},
            reference_images: assets.filter((a: any) => a.asset_type === "reference_image" || a.asset_type === "reference_headshot" || a.asset_type === "reference_full_body").map((a: any) => a.public_url),
            screen_test_images: assets.filter((a: any) => a.asset_type === "screen_test_still").map((a: any) => a.public_url),
            wardrobe_pack: mapping.wardrobe_pack,
          });
        }

        return jsonRes({ cast_context: castContext }, 200, req);
      }

      case "delete_actor": {
        const { actorId } = body;
        if (!actorId) return jsonRes({ error: "actorId required" }, 400, req);

        // Verify ownership
        const { data: actorRow } = await db.from("ai_actors")
          .select("id, roster_ready, user_id")
          .eq("id", actorId)
          .eq("user_id", userId)
          .single();
        if (!actorRow) return jsonRes({ error: "Actor not found or access denied" }, 404, req);

        // Safety: block deletion of roster-ready actors unless force flag
        if ((actorRow as any).roster_ready && !body.force) {
          return jsonRes({
            error: "Cannot delete a roster-ready actor. Revoke roster status first, or pass force: true.",
            code: "ROSTER_READY_BLOCK",
          }, 400, req);
        }

        // Cascade delete: assets → versions → validation data → promotion decisions → bindings → actor
        // 1. Delete assets for all versions
        const { data: versionIds } = await db.from("ai_actor_versions")
          .select("id").eq("actor_id", actorId);
        const vIds = (versionIds || []).map((v: any) => v.id);
        if (vIds.length > 0) {
          await db.from("ai_actor_assets").delete().in("actor_version_id", vIds);
        }

        // 2. Delete validation images → results → runs
        const { data: runIds } = await db.from("actor_validation_runs")
          .select("id").eq("actor_id", actorId);
        const rIds = (runIds || []).map((r: any) => r.id);
        if (rIds.length > 0) {
          await db.from("actor_validation_images").delete().in("validation_run_id", rIds);
          await db.from("actor_validation_results").delete().in("validation_run_id", rIds);
        }
        await db.from("actor_validation_runs").delete().eq("actor_id", actorId);

        // 3. Delete promotion decisions
        await db.from("actor_promotion_decisions").delete().eq("actor_id", actorId);

        // 4. Delete marketplace listings
        await db.from("actor_marketplace_listings").delete().eq("actor_id", actorId);

        // 5. Delete cast bindings referencing this actor
        await db.from("project_ai_cast").delete().eq("ai_actor_id", actorId);

        // 6. Delete casting candidates referencing this actor
        await db.from("casting_candidates").delete().eq("promoted_actor_id", actorId);

        // 7. Delete versions
        await db.from("ai_actor_versions").delete().eq("actor_id", actorId);

        // 8. Delete actor
        const { error: delErr } = await db.from("ai_actors").delete().eq("id", actorId);
        if (delErr) throw delErr;

        return jsonRes({ deleted: true, actor_id: actorId, versions_deleted: vIds.length }, 200, req);
      }

      default:
        return jsonRes({ error: `Unknown action: ${action}` }, 400, req);
    }
  } catch (err: any) {
    console.error("ai-cast error:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500, req);
  }
});
