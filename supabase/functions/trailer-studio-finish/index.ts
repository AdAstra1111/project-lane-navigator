/**
 * trailer-studio-finish — Studio Finishing Layer v1
 * Actions: list_profiles, create_profile, create_render_variants, get_render_variants,
 *          update_variant_status, compute_color_corrections
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function verifyAccess(db: any, userId: string, projectId: string): Promise<boolean> {
  const { data } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
  return !!data;
}

// ─── Social variant definitions ───

const SOCIAL_VARIANTS: Record<string, { width: number; height: number; label: string }> = {
  master_16x9: { width: 1920, height: 1080, label: "Master 16:9" },
  social_9x16: { width: 1080, height: 1920, label: "Social 9:16 (Stories/Reels)" },
  feed_4x5: { width: 1080, height: 1350, label: "Feed 4:5 (Instagram)" },
  square_1x1: { width: 1080, height: 1080, label: "Square 1:1" },
};

// ─── Build FFmpeg filter graph (for documentation/render instructions) ───

function buildFinishingFilterGraph(profile: any): {
  video_filters: string[];
  audio_filters: string[];
  render_instructions: Record<string, any>;
} {
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  // 1) Contrast + Saturation via eq
  if (profile.contrast_boost || profile.saturation_boost) {
    const contrast = 1 + (profile.contrast_boost || 0);
    const saturation = 1 + (profile.saturation_boost || 0);
    videoFilters.push(`eq=contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}`);
  }

  // 2) LUT (3D LUT file)
  if (profile.lut_storage_path) {
    videoFilters.push(`lut3d='${profile.lut_storage_path}'`);
  }

  // 3) Highlights rolloff (simple curves approximation)
  if (profile.highlights_rolloff > 0) {
    const rolloff = Math.min(1, profile.highlights_rolloff);
    const highPoint = Math.round(255 * (1 - rolloff * 0.3));
    videoFilters.push(`curves=highlights='0/0 0.5/0.5 1/${(highPoint / 255).toFixed(2)}'`);
  }

  // 4) Sharpen
  if (profile.sharpen_amount > 0) {
    const amount = Math.min(2, profile.sharpen_amount);
    videoFilters.push(`unsharp=5:5:${amount.toFixed(1)}:5:5:0`);
  }

  // 5) Film grain via noise
  if (profile.grain_amount > 0) {
    const strength = Math.round(profile.grain_amount * 30); // 0-30 range
    videoFilters.push(`noise=alls=${strength}:allf=t+u`);
  }

  // 6) Vignette
  if (profile.vignette_amount > 0) {
    const angle = `PI/${Math.round(4 / Math.max(0.1, profile.vignette_amount))}`;
    videoFilters.push(`vignette=angle=${angle}`);
  }

  // 7) Letterbox
  if (profile.letterbox_enabled) {
    // Will be handled per-variant via pad filter
  }

  // Audio: loudness normalization
  audioFilters.push(
    `loudnorm=I=${profile.lufs_target || -14}:TP=${profile.true_peak_db || -1.0}:LRA=11`
  );

  return {
    video_filters: videoFilters,
    audio_filters: audioFilters,
    render_instructions: {
      codec: "libx264",
      crf: 18,
      preset: "medium",
      movflags: "+faststart",
      pix_fmt: "yuv420p",
      letterbox: profile.letterbox_enabled ? { ratio: profile.letterbox_ratio || "2.39" } : null,
      color_consistency: profile.color_consistency_enabled ? { strength: profile.color_consistency_strength || 0.6 } : null,
    },
  };
}

// ─── Compute color correction params (histogram-match approximation) ───

function computeColorCorrections(
  clips: any[],
  referenceClipId: string | null,
  strength: number = 0.6
): { reference_clip_id: string | null; corrections: any[]; strength: number } {
  // In a real implementation, we'd extract frame stats via ffprobe.
  // For now, we compute deterministic correction params based on provider + beat phase
  // that the render pipeline can apply via lutrgb/eq per segment.

  const reference = referenceClipId
    ? clips.find((c: any) => c.id === referenceClipId)
    : clips.find((c: any) => c.has_clip && !c.is_text_card);

  if (!reference) {
    return { reference_clip_id: null, corrections: [], strength };
  }

  const refProvider = reference.provider || "veo";
  const corrections = clips.map((clip: any) => {
    if (!clip.has_clip || clip.is_text_card || clip.clip_id === reference.clip_id) {
      return { beat_index: clip.beat_index, skip: true, reason: "reference or text card" };
    }

    const clipProvider = clip.provider || "veo";
    // Provider-based color offset estimation
    let rShift = 0, gShift = 0, bShift = 0;
    let contrastAdj = 0;

    if (clipProvider !== refProvider) {
      // Cross-provider correction (Runway tends warmer, Veo cooler)
      if (clipProvider === "runway" && refProvider === "veo") {
        rShift = -3; gShift = 0; bShift = 2; contrastAdj = 0.02;
      } else if (clipProvider === "veo" && refProvider === "runway") {
        rShift = 3; gShift = 0; bShift = -2; contrastAdj = -0.02;
      }
    }

    // Apply strength scaling
    rShift = Math.round(rShift * strength);
    gShift = Math.round(gShift * strength);
    bShift = Math.round(bShift * strength);
    contrastAdj = contrastAdj * strength;

    return {
      beat_index: clip.beat_index,
      clip_id: clip.clip_id,
      provider: clipProvider,
      corrections: {
        r_shift: rShift,
        g_shift: gShift,
        b_shift: bShift,
        contrast_adj: Math.round(contrastAdj * 100) / 100,
      },
      filter: rShift || gShift || bShift
        ? `lutrgb=r=val+${rShift}:g=val+${gShift}:b=val+${bShift}`
        : null,
    };
  });

  return {
    reference_clip_id: reference.clip_id || reference.id,
    corrections,
    strength,
  };
}

// ─── Handlers ───

async function handleListProfiles(db: any, body: any) {
  const { projectId } = body;

  // Get presets + project-specific profiles
  const { data } = await db.from("trailer_finishing_profiles")
    .select("*")
    .or(`is_preset.eq.true,project_id.eq.${projectId}`)
    .order("is_preset", { ascending: false })
    .order("name");

  return json({ ok: true, profiles: data || [] });
}

async function handleCreateProfile(db: any, body: any, userId: string) {
  const { projectId, name, ...settings } = body;
  if (!name) return json({ error: "name required" }, 400);

  const { data, error } = await db.from("trailer_finishing_profiles").insert({
    project_id: projectId,
    name,
    is_preset: false,
    created_by: userId,
    ...settings,
  }).select().single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, profile: data });
}

async function handleCreateRenderVariants(db: any, body: any, userId: string) {
  const {
    projectId, cutId, audioRunId, finishingProfileId,
    variantKeys = ["master_16x9", "social_9x16", "feed_4x5", "square_1x1"],
  } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  // Load cut to get timeline for color corrections
  const { data: cut } = await db.from("trailer_cuts").select("timeline, duration_ms")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  // Load finishing profile
  let profile: any = null;
  if (finishingProfileId) {
    const { data: fp } = await db.from("trailer_finishing_profiles")
      .select("*").eq("id", finishingProfileId).single();
    profile = fp;
  }
  if (!profile) {
    // Use first preset
    const { data: presets } = await db.from("trailer_finishing_profiles")
      .select("*").eq("is_preset", true).limit(1);
    profile = presets?.[0] || {
      grain_amount: 0, vignette_amount: 0, letterbox_enabled: false,
      sharpen_amount: 0, saturation_boost: 0, contrast_boost: 0,
      highlights_rolloff: 0, lufs_target: -14, true_peak_db: -1.0,
      color_consistency_enabled: true, color_consistency_strength: 0.6,
    };
  }

  // Build filter graph
  const filterGraph = buildFinishingFilterGraph(profile);

  // Compute color corrections if enabled
  let colorCorrections: any = null;
  if (profile.color_consistency_enabled) {
    colorCorrections = computeColorCorrections(
      cut.timeline || [],
      null,
      profile.color_consistency_strength || 0.6,
    );
  }

  // Create variant rows
  const variants: any[] = [];
  for (const key of variantKeys) {
    const def = SOCIAL_VARIANTS[key];
    if (!def) continue;

    const storagePath = `${projectId}/runs/${cutId}/variants/${key}.mp4`;

    variants.push({
      project_id: projectId,
      trailer_cut_id: cutId,
      audio_run_id: audioRunId || null,
      finishing_profile_id: profile.id || null,
      variant_key: key,
      width: def.width,
      height: def.height,
      frame_rate: 24,
      crop_mode: "smart_center",
      status: "queued",
      storage_path_mp4: storagePath,
      render_log_json: {
        filter_graph: filterGraph,
        color_corrections: colorCorrections,
        profile_snapshot: {
          name: profile.name,
          grain: profile.grain_amount,
          vignette: profile.vignette_amount,
          letterbox: profile.letterbox_enabled,
          sharpen: profile.sharpen_amount,
          saturation: profile.saturation_boost,
          contrast: profile.contrast_boost,
          lufs: profile.lufs_target,
        },
      },
      reference_clip_id: colorCorrections?.reference_clip_id || null,
      color_corrections_json: colorCorrections,
      created_by: userId,
    });
  }

  if (variants.length === 0) return json({ error: "No valid variant keys" }, 400);

  const { data: inserted, error: insertErr } = await db
    .from("trailer_render_variants")
    .insert(variants)
    .select();

  if (insertErr) return json({ error: insertErr.message }, 500);

  return json({
    ok: true,
    variantCount: inserted?.length || 0,
    variants: inserted,
    filterGraph,
    colorCorrections,
  });
}

async function handleGetRenderVariants(db: any, body: any) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  const { data } = await db.from("trailer_render_variants")
    .select("*, trailer_finishing_profiles(name, is_preset)")
    .eq("project_id", projectId)
    .eq("trailer_cut_id", cutId)
    .order("created_at", { ascending: false });

  return json({ ok: true, variants: data || [] });
}

async function handleUpdateVariantStatus(db: any, body: any) {
  const { projectId, variantId, status, publicUrl, error: errorMsg, renderLogJson } = body;
  if (!variantId) return json({ error: "variantId required" }, 400);

  const update: any = { status, updated_at: new Date().toISOString() };
  if (publicUrl) update.public_url = publicUrl;
  if (errorMsg) update.error = errorMsg;
  if (renderLogJson) update.render_log_json = renderLogJson;

  await db.from("trailer_render_variants").update(update)
    .eq("id", variantId).eq("project_id", projectId);

  return json({ ok: true });
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
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    switch (action) {
      case "list_profiles": return await handleListProfiles(db, body);
      case "create_profile": return await handleCreateProfile(db, body, userId);
      case "create_render_variants": return await handleCreateRenderVariants(db, body, userId);
      case "get_render_variants": return await handleGetRenderVariants(db, body);
      case "update_variant_status": return await handleUpdateVariantStatus(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("[trailer-studio-finish] Error:", err.message);
    return json({ error: err.message }, 500);
  }
});
