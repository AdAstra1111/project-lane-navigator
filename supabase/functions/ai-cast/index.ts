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
          .select("*, ai_actor_versions(id, version_number, is_approved, created_at)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonRes({ actors: data || [] }, 200, req);
      }

      case "get_actor": {
        const { actorId } = body;
        const { data, error } = await db.from("ai_actors")
          .select("*, ai_actor_versions(*, ai_actor_assets(*))")
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
        // Screen test generation is not available at runtime.
        // Upload reference images manually via the UI instead.
        return jsonRes({
          error: "Screen test generation is not configured. Please upload reference images manually via the AI Cast Library.",
          code: "SCREEN_TEST_NOT_CONFIGURED",
        }, 501, req);
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
            character_key, wardrobe_pack, notes,
            ai_actors!inner(id, name, description, negative_prompt, tags, user_id),
            ai_actor_versions(id, version_number, recipe_json, is_approved)
          `)
          .eq("project_id", projectId);

        if (castErr) throw castErr;

        // Filter to only actors owned by the caller (cross-user actors blocked)
        const ownedMappings = (castMappings || []).filter(
          (m: any) => (m as any).ai_actors?.user_id === userId
        );

        // For each mapping, get reference assets
        const castContext: any[] = [];
        for (const mapping of ownedMappings) {
          const actor = (mapping as any).ai_actors;
          const version = (mapping as any).ai_actor_versions;

          let assets: any[] = [];
          if (version?.id) {
            const { data: assetData } = await db.from("ai_actor_assets")
              .select("asset_type, storage_path, public_url, meta_json")
              .eq("actor_version_id", version.id)
              .in("asset_type", ["reference_image", "screen_test_still"]);
            assets = assetData || [];
          }

          castContext.push({
            character_key: mapping.character_key,
            actor_name: actor?.name,
            description: actor?.description,
            negative_prompt: actor?.negative_prompt,
            recipe: version?.recipe_json || {},
            reference_images: assets.filter((a: any) => a.asset_type === "reference_image").map((a: any) => a.public_url),
            screen_test_images: assets.filter((a: any) => a.asset_type === "screen_test_still").map((a: any) => a.public_url),
            wardrobe_pack: mapping.wardrobe_pack,
          });
        }

        return jsonRes({ cast_context: castContext }, 200, req);
      }

      default:
        return jsonRes({ error: `Unknown action: ${action}` }, 400, req);
    }
  } catch (err: any) {
    console.error("ai-cast error:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500, req);
  }
});
