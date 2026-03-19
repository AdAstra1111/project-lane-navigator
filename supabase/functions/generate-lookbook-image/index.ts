import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveImageGenerationConfig, buildImageRepositoryMeta } from "../_shared/imageGenerationResolver.ts";
import type { ImageRole, ImageStyleMode } from "../_shared/imageGenerationResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Style Policy ─────────────────────────────────────────────────────────────

type LocalImageStyleMode = "photorealistic_cinematic" | "stylised_animation" | "stylised_graphic" | "stylised_experimental" | "stylised_period_painterly";

interface ImageStylePolicy {
  mode: LocalImageStyleMode;
  styleDirectives: string;
  negativeStyleConstraints: string;
}

const PHOTOREAL_DIRECTIVES =
  "Photorealistic cinematic imagery. Live-action film still. Shot on ARRI Alexa or RED cinema camera with premium anamorphic lenses. Real-world materials, textures, surfaces. Believable natural or motivated cinematic lighting. Real lens behaviour including subtle flares, bokeh, and depth of field. Premium theatrical realism. No illustration, no concept art, no digital painting, no CGI render look.";
const PHOTOREAL_NEGATIVES =
  "painterly, illustrative, cartoon, anime, graphic-novel style, concept art rendering, abstract, surreal, watercolor, oil painting, sketch, line art, cel-shaded, pop art, storybook illustration, digital painting, CGI render look, stock photo aesthetic, 3D render, Unreal Engine, video game screenshot";

const ANIMATION_FORMATS = ["animation", "anim-feature", "anim-series", "animated"];
const GRAPHIC_GENRES = ["graphic-novel", "comic", "manga"];

function resolveStylePolicy(format: string, genres: string[]): ImageStylePolicy {
  const f = format.toLowerCase();
  const gs = genres.map(g => g.toLowerCase());
  if (ANIMATION_FORMATS.some(af => f.includes(af))) {
    return { mode: "stylised_animation", styleDirectives: "Stylised animated visual language. Professional animation studio quality.", negativeStyleConstraints: "photorealistic, live-action, stock photo" };
  }
  if (gs.some(g => GRAPHIC_GENRES.some(gg => g.includes(gg)))) {
    return { mode: "stylised_graphic", styleDirectives: "Graphic novel / comic book visual style. Bold ink work.", negativeStyleConstraints: "photorealistic, live-action, stock photo" };
  }
  return { mode: "photorealistic_cinematic", styleDirectives: PHOTOREAL_DIRECTIVES, negativeStyleConstraints: PHOTOREAL_NEGATIVES };
}

// ── Shot taxonomy prompt builders ────────────────────────────────────────────

type AssetGroup = "character" | "world" | "key_moment" | "visual_language" | "poster";
type ShotType = "close_up" | "medium" | "wide" | "full_body" | "profile" | "over_shoulder" | "detail" | "tableau" | "emotional_variant" | "atmospheric" | "time_variant" | "lighting_ref" | "texture_ref" | "composition_ref" | "color_ref";
type LookbookSection = "world" | "character" | "key_moment" | "visual_language";

const SHOT_PACKS: Record<AssetGroup, ShotType[]> = {
  character: ["close_up", "medium", "full_body", "profile", "emotional_variant"],
  world: ["wide", "atmospheric", "detail", "time_variant"],
  key_moment: ["tableau", "medium", "close_up", "wide"],
  visual_language: ["lighting_ref", "texture_ref", "composition_ref", "color_ref"],
  poster: [],
};

interface SectionContext {
  title: string;
  format: string;
  genres: string[];
  tone: string;
  worldDescription: string;
  characters: string;
  conflict: string;
  themes: string;
  logline: string;
  stylePolicy: ImageStylePolicy;
  characterName?: string;
}

const SHOT_FRAMING: Record<ShotType, string> = {
  close_up: "Extreme close-up or tight close-up. Face filling the frame. Intimate, emotional, every pore visible. Shallow depth of field.",
  medium: "Medium shot, waist-up. Character in environment context. Balanced composition. Clear facial expression with setting visible.",
  wide: "Wide establishing shot. Sweeping, immersive cinematic scale. Characters small in frame against vast environment. Epic scope.",
  full_body: "Full body shot, head to toe. Character standing in environment. Clear silhouette and posture. Fashion editorial quality.",
  profile: "Profile view, side-on. Dramatic rim lighting. Strong silhouette against atmospheric background. Contemplative mood.",
  over_shoulder: "Over-the-shoulder perspective. Looking past one figure toward another or toward the scene. Creates depth and narrative tension.",
  detail: "Macro or detail shot. Close focus on a specific texture, object, or environmental detail. Shallow depth of field, rich texture.",
  tableau: "Tableau composition. Multiple figures arranged in a dramatic, almost painterly arrangement. Stage-like, deliberate blocking.",
  emotional_variant: "Same character, different emotional state. Raw emotional expression — tension, vulnerability, determination, or joy. Character-defining moment.",
  atmospheric: "Atmospheric mid-shot. Focus on mood, weather, light quality. Fog, rain, golden hour, or dramatic clouds. Environmental storytelling.",
  time_variant: "Same location, different time of day. Dawn/dusk/night variant. Dramatic lighting shift. Temporal contrast.",
  lighting_ref: "Lighting reference. Demonstrate the project's signature lighting approach — key light direction, color temperature, contrast ratio, shadow quality.",
  texture_ref: "Texture and surface reference. Close-up on key materials and surfaces. Skin, fabric, architecture, natural elements. Tactile, sensory.",
  composition_ref: "Composition reference. Demonstrate the project's framing grammar — rule of thirds, leading lines, negative space, symmetry or asymmetry.",
  color_ref: "Color palette reference. Dominant hues, accent colors, saturation level. The project's visual temperature and chromatic identity.",
};

function buildPackPrompt(assetGroup: AssetGroup, shotType: ShotType, ctx: SectionContext): string {
  const framing = SHOT_FRAMING[shotType];

  let subjectDescription = "";
  switch (assetGroup) {
    case "character":
      subjectDescription = ctx.characterName
        ? `Character: ${ctx.characterName}. ${ctx.characters || "A compelling screen presence with emotional depth."}`
        : ctx.characters || "The protagonist — a compelling screen presence with emotional depth.";
      break;
    case "world":
      subjectDescription = ctx.worldDescription || "The story's world rendered with atmospheric depth and cinematic grandeur.";
      break;
    case "key_moment":
      subjectDescription = ctx.conflict || ctx.logline || "A pivotal dramatic scene of tension and emotional stakes.";
      break;
    case "visual_language":
      subjectDescription = `Production design reference for "${ctx.title}". Focus on real-world cinematography: lighting setups, lens choices, color grading, practical textures, and architectural composition. No abstract or symbolic imagery.`;
      break;
  }

  // Anti-drift: ground visual_language to production design, not abstract/fantasy
  const driftExclusions = [
    'No dragons, no fantasy creatures, no mythical beasts, no supernatural entities',
    'No symbolic fantasy imagery, no magical effects, no sci-fi elements unless explicitly part of the project',
    'Ground all imagery in real-world production design',
  ].join('. ');

  return [
    `A cinematic film still for "${ctx.title}".`,
    ``,
    `SHOT TYPE: ${framing}`,
    ``,
    `SUBJECT: ${subjectDescription}`,
    ``,
    `TONE: ${ctx.tone || "dramatic"}. Genre: ${ctx.genres?.join(", ") || "drama"}.`,
    ``,
    `PHOTOREALISM MANDATE: ${ctx.stylePolicy.styleDirectives}`,
    ``,
    `ABSOLUTE PROHIBITIONS:`,
    `- ${ctx.stylePolicy.negativeStyleConstraints}`,
    `- No text, titles, watermarks, or typography of any kind`,
    `- No illustrated or painted look`,
    `- ${driftExclusions}`,
    `- Must look indistinguishable from a still frame from a theatrically released film`,
    ``,
    `TECHNICAL: 16:9 landscape. Premium cinematic quality. Anamorphic lens characteristics.`,
  ].join("\n");
}

// Legacy section prompt for backward compat when pack_mode is off
function buildSectionPrompt(section: LookbookSection, ctx: SectionContext, variantIndex: number): string {
  const pack = SHOT_PACKS[section === "character" ? "character" : section === "world" ? "world" : section === "key_moment" ? "key_moment" : "visual_language"];
  const shotType = pack[variantIndex % pack.length];
  return buildPackPrompt(section as AssetGroup, shotType, ctx);
}

// ── Image generation ─────────────────────────────────────────────────────────

interface ProviderImageResult {
  imageDataUrl: string;
  format: string;
  rawBytes: Uint8Array;
}

function extractImageFromResponse(aiData: unknown): ProviderImageResult {
  const data = aiData as Record<string, unknown>;
  const choices = data?.choices as Array<Record<string, unknown>> | undefined;
  if (choices?.length) {
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const images = message?.images as Array<Record<string, unknown>> | undefined;
    if (images?.length) {
      const imageUrl = (images[0]?.image_url as Record<string, unknown>)?.url as string;
      if (imageUrl) return parseDataUrl(imageUrl);
    }
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "image_url" && part?.image_url?.url) return parseDataUrl(part.image_url.url as string);
        if (part?.inline_data?.data && part?.inline_data?.mime_type) {
          const mimeType = part.inline_data.mime_type as string;
          const ext = mimeType.split("/")[1] || "png";
          const b64 = part.inline_data.data as string;
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          return { imageDataUrl: `data:${mimeType};base64,${b64}`, format: ext, rawBytes: bytes };
        }
      }
    }
  }
  throw new Error("No image found in AI response");
}

function parseDataUrl(dataUrl: string): ProviderImageResult {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL format");
  const format = match[1];
  const rawBytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { imageDataUrl: dataUrl, format, rawBytes };
}

async function generateImage(apiKey: string, prompt: string, model: string, gatewayUrl: string): Promise<ProviderImageResult> {
  const resp = await fetch(gatewayUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI gateway error [${resp.status}]: ${errText}`);
  }
  return extractImageFromResponse(await resp.json());
}

// ── Role mapping ─────────────────────────────────────────────────────────────

const SECTION_TO_ROLE: Record<LookbookSection, string> = {
  world: "world_establishing",
  character: "character_primary",
  key_moment: "visual_reference",
  visual_language: "visual_reference",
};

const SECTION_TO_ASSET_GROUP: Record<LookbookSection, AssetGroup> = {
  world: "world",
  character: "character",
  key_moment: "key_moment",
  visual_language: "visual_language",
};

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      project_id, section, count = 4, entity_id, character_name,
      asset_group: requestedAssetGroup, pack_mode = false,
    } = body as {
      project_id: string;
      section: LookbookSection;
      count?: number;
      entity_id?: string;
      character_name?: string;
      asset_group?: AssetGroup;
      pack_mode?: boolean;
    };

    if (!project_id || !section) {
      return new Response(JSON.stringify({ error: "project_id and section required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validSections: LookbookSection[] = ["world", "character", "key_moment", "visual_language"];
    if (!validSections.includes(section)) {
      return new Response(JSON.stringify({ error: `Invalid section: ${section}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load project context
    const { data: project } = await supabase
      .from("projects")
      .select("title, format, genres, tone")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");

    // Load canon
    let worldDescription = "";
    let characters = "";
    let conflict = "";
    let themes = "";
    let logline = "";

    const { data: canon } = await supabase
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", project_id)
      .maybeSingle();
    if (canon?.canon_json) {
      const cj = canon.canon_json as any;
      worldDescription = cj.world_description || cj.setting || cj.locations || "";
      logline = cj.logline || cj.premise || "";
      conflict = cj.central_conflict || "";
      themes = Array.isArray(cj.themes) ? cj.themes.join(", ") : (cj.themes || "");
      if (cj.characters && Array.isArray(cj.characters)) {
        characters = cj.characters.map((c: any) => typeof c === "string" ? c : `${c.name || "Unknown"} (${c.role || ""})`).slice(0, 4).join(", ");
      }
    }

    const stylePolicy = resolveStylePolicy(project.format || "film", project.genres || []);
    const imageRole = SECTION_TO_ROLE[section] as ImageRole;
    const styleMode = stylePolicy.mode as ImageStyleMode;
    const assetGroup = requestedAssetGroup || SECTION_TO_ASSET_GROUP[section];

    const ctx: SectionContext = {
      title: project.title || "Untitled",
      format: project.format || "film",
      genres: project.genres || [],
      tone: project.tone || "dramatic",
      worldDescription,
      characters,
      conflict,
      themes,
      logline,
      stylePolicy,
      characterName: character_name,
    };

    // Determine shots to generate
    const shotPack = SHOT_PACKS[assetGroup] || [];
    const shotsToGenerate: ShotType[] = pack_mode && shotPack.length > 0
      ? shotPack.slice(0, Math.min(count, shotPack.length))
      : [];

    // If not pack_mode or no pack, fall back to count-based generation
    const genCount = shotsToGenerate.length > 0 ? shotsToGenerate.length : Math.min(Math.max(count, 1), 6);

    const results: Array<{ image_id: string; status: string; shot_type?: string; error?: string }> = [];

    for (let i = 0; i < genCount; i++) {
      const shotType = shotsToGenerate[i] || null;
      const prompt = shotType
        ? buildPackPrompt(assetGroup, shotType, ctx)
        : buildSectionPrompt(section, ctx, i);

      const resolverInput = { role: imageRole, styleMode, strategyKey: `lookbook_${section}` };
      const genConfig = resolveImageGenerationConfig(resolverInput);
      const repoMeta = buildImageRepositoryMeta(genConfig, resolverInput);

      try {
        const imageResult = await generateImage(LOVABLE_API_KEY, prompt, genConfig.model, genConfig.gatewayUrl);

        const storagePath = `${project_id}/lookbook/${section}/${Date.now()}-${shotType || `v${i}`}.${imageResult.format}`;
        const { error: uploadErr } = await supabase.storage
          .from("project-posters")
          .upload(storagePath, imageResult.rawBytes, {
            contentType: `image/${imageResult.format}`,
            upsert: true,
          });
        if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

        const { data: imgRecord, error: insertErr } = await supabase
          .from("project_images")
          .insert({
            project_id,
            role: imageRole,
            entity_id: entity_id || null,
            strategy_key: `lookbook_${section}`,
            prompt_used: prompt,
            negative_prompt: stylePolicy.negativeStyleConstraints,
            canon_constraints: { source_feature: "lookbook_engine", section },
            storage_path: storagePath,
            storage_bucket: "project-posters",
            is_primary: false,
            is_active: true,
            source_poster_id: null,
            user_id: user.id,
            created_by: user.id,
            provider: genConfig.provider,
            model: genConfig.model,
            style_mode: styleMode,
            generation_config: {
              ...repoMeta,
              source_feature: "lookbook_engine",
              section,
              variant_index: i,
              shot_type: shotType,
            },
            // New Visual Asset System fields
            asset_group: assetGroup,
            subject: character_name || null,
            shot_type: shotType,
            curation_state: "candidate",
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`[lookbook-image] repo insert error for variant ${i}:`, insertErr.message);
          results.push({ image_id: "", status: "stored_no_repo", shot_type: shotType || undefined, error: insertErr.message });
        } else {
          results.push({ image_id: imgRecord.id, status: "ready", shot_type: shotType || undefined });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[lookbook-image] generation error for ${section} ${shotType || `variant ${i}`}:`, msg);
        results.push({ image_id: "", status: "failed", shot_type: shotType || undefined, error: msg });
      }
    }

    return new Response(JSON.stringify({ section, asset_group: assetGroup, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-lookbook-image error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
