import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveImageGenerationConfig, buildImageRepositoryMeta } from "../_shared/imageGenerationResolver.ts";
import type { ImageRole, ImageStyleMode } from "../_shared/imageGenerationResolver.ts";
import { resolveVisualStyleProfile, validateStyleOrError } from "../_shared/visualStyleAuthority.ts";
import type { VisualStyleLock } from "../_shared/visualStyleAuthority.ts";

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
type ShotType = "close_up" | "medium" | "wide" | "full_body" | "profile" | "over_shoulder" | "detail" | "tableau" | "emotional_variant" | "atmospheric" | "time_variant" | "lighting_ref" | "texture_ref" | "composition_ref" | "color_ref" | "identity_headshot" | "identity_profile" | "identity_full_body";
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
  locationName?: string;
  locationDescription?: string;
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
  lighting_ref: "Lighting reference — real film set lighting setup. Show practical and motivated light sources. Key light direction, fill ratio, color temperature, hard vs soft shadows. As seen on a professional film set with cinema-grade lighting fixtures. Real environments, real physics of light.",
  texture_ref: "Material and surface reference — real-world production design. Close-up on key physical materials: weathered wood, concrete, fabric weave, skin texture, metal patina, natural stone. Shot with macro lens, shallow DOF. Tactile, grounded, zero abstraction.",
  composition_ref: "Cinematography composition reference — real camera framing. Demonstrate specific framing grammar: rule of thirds, leading lines, negative space, symmetry. Show an actual physical environment framed through a cinema lens. No abstract or symbolic composition.",
  color_ref: "Color grading reference — real-world color palette in context. Show actual environments and surfaces demonstrating the project's chromatic identity: dominant hues, accent temperature, saturation level. Grounded in physical space, not abstract color fields.",
  identity_headshot: "IDENTITY REFERENCE — Front-facing headshot. Head and shoulders centered in frame. Plain neutral grey or off-white backdrop. Soft, even studio lighting (key + fill, no dramatic shadows). Neutral expression. No environmental context. No narrative elements. Clean casting-photo style. Face clearly visible, eyes to camera.",
  identity_profile: "IDENTITY REFERENCE — Three-quarter or side profile view. Head and upper body. Plain neutral backdrop. Soft studio lighting revealing facial structure from the side. Neutral expression. No environmental context. Clean reference photography style.",
  identity_full_body: "IDENTITY REFERENCE — Full body, head to toe, centered in frame. Neutral standing pose showing full proportions. Plain neutral grey or off-white backdrop. Even studio lighting. Baseline neutral wardrobe (simple, non-costume clothing). No environmental context, no props, no narrative. Casting reference style.",
};

// ── Shot-type specific identity enforcement ──────────────────────────────────

const SHOT_TYPE_IDENTITY_CONSTRAINTS: Partial<Record<ShotType, string>> = {
  identity_full_body: "Full-body framing MUST preserve accurate human proportions consistent with identity reference. Do NOT reinterpret height, build, or body type. Head-to-body ratio must match reference exactly.",
  full_body: "Full-body framing MUST preserve accurate human proportions consistent with identity reference. Do NOT reinterpret height, build, or body type. Head-to-body ratio must match reference exactly.",
  close_up: "Facial structure MUST match identity reference exactly. Eye shape, nose, jawline, cheekbone structure must be identical.",
  identity_headshot: "Facial structure MUST match identity reference exactly. Eye shape, nose, jawline, cheekbone structure must be identical.",
  medium: "Character proportions and facial structure must match identity reference. Waist-up framing must preserve build and shoulder width.",
  profile: "Side profile must match identity reference — nose shape, jawline angle, brow ridge, forehead slope must be consistent.",
  identity_profile: "Side profile must match identity reference — nose shape, jawline angle, brow ridge, forehead slope must be consistent.",
};

/**
 * Build the full identity lock mandate for prompt injection.
 * This is the hardest constraint — placed right after canon facts.
 */
function buildIdentityLockMandate(characterName: string, identitySignatureBlock: string | null): string {
  const lines = [
    `[IDENTITY LOCK — DO NOT DEVIATE]`,
    ``,
    `This character MUST match the same person defined by the locked identity images.`,
    ``,
    `Maintain STRICT consistency in:`,
    `- Facial structure (exact match — eye shape, eye spacing, nose shape, jawline, cheekbone structure, brow ridge)`,
    `- Body proportions (height, build, shoulder width, head-to-body ratio)`,
    `- Posture and silhouette`,
    `- Skin tone, complexion, and facial proportions`,
    `- Hair color, hair texture, hairline position`,
    `- Wardrobe baseline (unless explicitly changed by state modifier)`,
    ``,
    `This is the SAME individual, not a variation or reinterpretation.`,
    ``,
    `REJECT:`,
    `- Different face, different age, different build, different ethnicity`,
    `- Different bone structure, different head-to-body ratio`,
    `- Idealized or beautified version of the reference`,
    `- "Similar-looking person" — must be UNMISTAKABLY identical`,
  ];

  if (identitySignatureBlock) {
    lines.push('', identitySignatureBlock);
  }

  return lines.join('\n');
}

function buildIdentityPrompt(characterName: string, shotType: ShotType, ctx: SectionContext): string {
  const framing = SHOT_FRAMING[shotType];
  const characterDesc = ctx.characters || "A distinctive individual with clear, memorable features.";

  return [
    `CHARACTER IDENTITY REFERENCE for "${characterName}" from "${ctx.title}".`,
    ``,
    `${framing}`,
    ``,
    `CHARACTER: ${characterName}. ${characterDesc}`,
    ``,
    `IDENTITY MANDATE:`,
    `- This is a CASTING REFERENCE photo, not a film still`,
    `- Plain neutral grey or off-white studio backdrop`,
    `- Soft, even studio lighting — no dramatic shadows, no colored gels`,
    `- Neutral baseline wardrobe — simple, non-costume clothing appropriate to the character`,
    `- NO environmental context, NO props, NO narrative elements`,
    `- NO cinematic framing tricks — clean, direct, unambiguous reference`,
    `- The same person must be recognizable across all identity reference images`,
    `- Consistent facial structure, skin tone, hair, and body proportions`,
    ``,
    `PHOTOREALISM: ${ctx.stylePolicy.styleDirectives}`,
    ``,
    `ABSOLUTE PROHIBITIONS:`,
    `- No cinematic scene context or environmental storytelling`,
    `- No dramatic or emotional poses`,
    `- No action, no motion blur, no dynamic composition`,
    `- No text, titles, watermarks, or typography`,
    `- No illustration, painting, or CGI look`,
    `- ${ctx.stylePolicy.negativeStyleConstraints}`,
    ``,
    `TECHNICAL: High-resolution studio photography quality. Even lighting. Sharp focus across entire subject.`,
  ].join("\n");
}

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
      if (ctx.locationName) {
        subjectDescription = `Location: "${ctx.locationName}". ${ctx.locationDescription || ctx.worldDescription || "A cinematic environment rendered with atmospheric depth."}`;
      } else {
        subjectDescription = ctx.worldDescription || "The story's world rendered with atmospheric depth and cinematic grandeur.";
      }
      break;
    case "key_moment":
      subjectDescription = ctx.conflict || ctx.logline || "A pivotal dramatic scene of tension and emotional stakes.";
      break;
    case "visual_language":
      subjectDescription = `Production design reference for "${ctx.title}". Focus on real-world cinematography: lighting setups, lens choices, color grading, practical textures, and architectural composition. No abstract or symbolic imagery.`;
      break;
  }

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

async function generateImage(
  apiKey: string,
  prompt: string,
  model: string,
  gatewayUrl: string,
  referenceImageUrls?: string[],
): Promise<ProviderImageResult> {
  const content: Array<Record<string, unknown>> = [];
  if (referenceImageUrls?.length) {
    for (const url of referenceImageUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
  }
  content.push({ type: "text", text: prompt });

  const resp = await fetch(gatewayUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
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
      base_look_mode = false,
      location_name, location_description,
      location_ref_mode = false,
      location_id = null,
      state_key = null,
      state_label = null,
      state_prompt_modifier = null,
      identity_mode = false,
      identity_anchor_paths = null,
      identity_notes = null,
      identity_canon_facts = null,
      identity_traits_block = null,
      identity_signature_block = null,
      forced_shot_type = null,
    } = body as {
      project_id: string;
      section: LookbookSection;
      count?: number;
      entity_id?: string;
      character_name?: string;
      asset_group?: AssetGroup;
      pack_mode?: boolean;
      base_look_mode?: boolean;
      location_name?: string;
      location_description?: string;
      location_ref_mode?: boolean;
      location_id?: string | null;
      state_key?: string | null;
      state_label?: string | null;
      state_prompt_modifier?: string | null;
      identity_mode?: boolean;
      identity_anchor_paths?: { headshot?: string; fullBody?: string } | null;
      identity_notes?: string | null;
      identity_canon_facts?: string | null;
      identity_traits_block?: string | null;
      identity_signature_block?: string | null;
      forced_shot_type?: string | null;
    };

    // IEL: location_binding_write_enforcement — warn if world image without canon location_id
    if (requestedAssetGroup === "world" && location_name && !location_id) {
      console.warn("[IEL:location_binding_write_enforcement_violation] World image generation requested without location_id — subject_ref fallback only");
    }

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

    // ── VSAL: Resolve Visual Style Authority (soft — warns but does not block) ──
    const styleResolution = await resolveVisualStyleProfile(supabase, project_id);
    let visualStyleLock = styleResolution.lock;
    let vsalPromptBlock = styleResolution.promptBlock;
    if (!styleResolution.found || !styleResolution.complete) {
      console.warn(`[VSAL:soft] No complete visual style profile — proceeding without style authority (${styleResolution.error})`);
      visualStyleLock = null;
      vsalPromptBlock = null;
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
      locationName: location_name,
      locationDescription: location_description,
    };

    // ── Resolve identity anchor signed URLs if provided ──
    const identityReferenceUrls: string[] = [];
    let identityLockUsed = false;
    let headshotAnchorUsed = false;
    let fullBodyAnchorUsed = false;

    if (identity_anchor_paths && (identity_anchor_paths.headshot || identity_anchor_paths.fullBody)) {
      if (identity_anchor_paths.headshot) {
        try {
          const { data: signedData } = await supabase.storage
            .from("project-posters")
            .createSignedUrl(identity_anchor_paths.headshot, 3600);
          if (signedData?.signedUrl) {
            identityReferenceUrls.push(signedData.signedUrl);
            headshotAnchorUsed = true;
          }
        } catch (e) {
          console.warn(`[lookbook-image] Failed to resolve headshot anchor: ${identity_anchor_paths.headshot}`, e);
        }
      }
      if (identity_anchor_paths.fullBody) {
        try {
          const { data: signedData } = await supabase.storage
            .from("project-posters")
            .createSignedUrl(identity_anchor_paths.fullBody, 3600);
          if (signedData?.signedUrl) {
            identityReferenceUrls.push(signedData.signedUrl);
            fullBodyAnchorUsed = true;
          }
        } catch (e) {
          console.warn(`[lookbook-image] Failed to resolve full-body anchor: ${identity_anchor_paths.fullBody}`, e);
        }
      }
      identityLockUsed = headshotAnchorUsed || fullBodyAnchorUsed;
    }

    console.log(`[lookbook-image] Identity lock: ${identityLockUsed ? 'ACTIVE' : 'INACTIVE'}, headshot: ${headshotAnchorUsed}, fullBody: ${fullBodyAnchorUsed}, notes: ${identity_notes ? 'YES' : 'NO'}, signature: ${identity_signature_block ? 'YES' : 'NO'}`);

    // ── IEL: NEVER allow character generation without anchors when they exist ──
    // If identity_anchor_paths were provided but failed to resolve, that's a hard error
    if (identity_anchor_paths && assetGroup === "character" && !identityLockUsed) {
      console.error(`[lookbook-image] IEL VIOLATION: identity anchors provided but failed to resolve — aborting character generation`);
      return new Response(JSON.stringify({
        error: "Identity anchors provided but could not be resolved. Generation aborted to prevent drift.",
        identity_lock_failed: true,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine shots to generate
    // ── Single-slot mode: forced_shot_type overrides all pack logic ──
    const IDENTITY_PACK: ShotType[] = ["identity_headshot", "identity_profile", "identity_full_body"];
    const BASE_LOOK_PACK: ShotType[] = ["close_up", "profile", "full_body", "full_body", "medium"];
    const LOCATION_REF_PACK: ShotType[] = ["wide", "atmospheric", "detail", "time_variant"];

    let shotsToGenerate: ShotType[];
    if (forced_shot_type) {
      // Deterministic single-slot mode — generate exactly this shot type
      shotsToGenerate = [forced_shot_type as ShotType];
    } else if (identity_mode && assetGroup === "character") {
      shotsToGenerate = IDENTITY_PACK;
    } else if (base_look_mode && assetGroup === "character") {
      shotsToGenerate = BASE_LOOK_PACK;
    } else if (location_ref_mode && assetGroup === "world") {
      shotsToGenerate = LOCATION_REF_PACK;
    } else if (pack_mode) {
      shotsToGenerate = (SHOT_PACKS[assetGroup] || []);
    } else {
      shotsToGenerate = [];
    }

    // When forced or pack mode, limit to count
    if (shotsToGenerate.length > 0 && !forced_shot_type) {
      shotsToGenerate = shotsToGenerate.slice(0, Math.min(count, shotsToGenerate.length));
    }

    const genCount = shotsToGenerate.length > 0 ? shotsToGenerate.length : Math.min(Math.max(count, 1), 6);

    const results: Array<{ image_id: string; status: string; shot_type?: string; error?: string; identity_locked?: boolean }> = [];

    for (let i = 0; i < genCount; i++) {
      const shotType = shotsToGenerate[i] || null;

      // ── PROMPT ASSEMBLY — strict priority order ──
      // 1. Base prompt (shot framing + subject)
      // 2. Canon facts (highest data priority)
      // 3. Identity lock mandate (hard constraint)
      // 4. Identity signature (structured face/body/silhouette)
      // 5. Visual traits block (source-tagged)
      // 6. User notes (subordinate)
      // 7. State modifier
      // 8. Shot-type specific constraints

      const isIdentityShot = shotType?.startsWith("identity_");
      const isIdentityGeneration = identity_mode || (forced_shot_type && isIdentityShot);

      // Step 1: Base prompt
      let prompt: string;
      if (isIdentityGeneration && isIdentityShot && character_name) {
        prompt = buildIdentityPrompt(character_name, shotType as ShotType, ctx);
      } else {
        prompt = shotType
          ? buildPackPrompt(assetGroup, shotType, ctx)
          : buildSectionPrompt(section, ctx, i);
      }

      // Step 2: Canon facts (highest priority data)
      if (identity_canon_facts) {
        prompt += `\n\nCANON CHARACTER FACTS: ${identity_canon_facts}`;
      }

      // Step 3: Identity lock mandate (hard constraint — applies to ALL character shots when locked)
      if (identityLockUsed && assetGroup === "character" && character_name) {
        prompt += `\n\n${buildIdentityLockMandate(character_name, identity_signature_block || null)}`;
      }

      // Step 4: Visual traits block (source-tagged, prioritized)
      if (identity_traits_block) {
        prompt += `\n\n${identity_traits_block}`;
      }

      // Step 5: User identity notes (subordinate to canon and lock)
      if (identity_notes) {
        prompt += `\n\nUSER IDENTITY GUIDANCE (subordinate to canon and identity lock): ${identity_notes}`;
      }

      // Step 6: State variant modifier
      if (state_prompt_modifier) {
        prompt += `\n\nSTATE VARIANT: ${state_prompt_modifier}\nThis is a state-specific reference showing the subject in this particular condition/state. Maintain visual continuity with the base reference while clearly showing the state change. The PERSON remains the same — only the state changes.`;
      }

      // Step 7: Shot-type specific identity constraints
      if (identityLockUsed && shotType && SHOT_TYPE_IDENTITY_CONSTRAINTS[shotType as ShotType]) {
        prompt += `\n\nSHOT-TYPE CONSTRAINT: ${SHOT_TYPE_IDENTITY_CONSTRAINTS[shotType as ShotType]}`;
      }

      // Step 8: VSAL — Visual Style Authority Lock (if available)
      if (vsalPromptBlock) {
        prompt += `\n\n${vsalPromptBlock}`;
        if (visualStyleLock && visualStyleLock.forbid.length > 0) {
          prompt += `\n\nADDITIONAL PROHIBITIONS (VSAL): ${visualStyleLock.forbid.join(", ")}`;
        }
      }

      const resolverInput = { role: imageRole, styleMode, strategyKey: `lookbook_${section}` };
      const genConfig = resolveImageGenerationConfig(resolverInput);
      const repoMeta = buildImageRepositoryMeta(genConfig, resolverInput);

      // Use identity references for ALL character generation when locked
      const refsForThisShot = (identityLockUsed && assetGroup === "character") ? identityReferenceUrls : [];

      try {
        const imageResult = await generateImage(LOVABLE_API_KEY, prompt, genConfig.model, genConfig.gatewayUrl, refsForThisShot.length > 0 ? refsForThisShot : undefined);

        const identitySegment = identity_mode ? '-identity' : '';
        const stateSegment = state_key ? `-${state_key}` : '';
        const storagePath = `${project_id}/lookbook/${section}/${Date.now()}-${shotType || `v${i}`}${identitySegment}${stateSegment}.${imageResult.format}`;
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
            strategy_key: isIdentityGeneration ? "character_identity" : `lookbook_${section}`,
            prompt_used: prompt,
            negative_prompt: isIdentityGeneration
              ? "cinematic scene, environmental context, narrative elements, dramatic lighting, props, costumes, action poses, text, watermarks, illustration, painting, CGI"
              : stylePolicy.negativeStyleConstraints,
            canon_constraints: { source_feature: isIdentityGeneration ? "character_identity_engine" : "lookbook_engine", section },
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
              source_feature: isIdentityGeneration ? "character_identity_engine" : "lookbook_engine",
              section,
              variant_index: i,
              shot_type: shotType,
              state_key: state_key || null,
              // Full audit trail
              identity_mode: identity_mode || isIdentityGeneration || false,
              identity_locked: identityLockUsed,
              identity_headshot_anchor_used: headshotAnchorUsed,
              identity_full_body_anchor_used: fullBodyAnchorUsed,
              identity_anchors_count: identityReferenceUrls.length,
              identity_notes_used: !!identity_notes,
              identity_canon_facts_used: !!identity_canon_facts,
              identity_traits_used: !!identity_traits_block,
              identity_signature_used: !!identity_signature_block,
              identity_lock_strength: (headshotAnchorUsed && fullBodyAnchorUsed) ? 'strong' : (headshotAnchorUsed || fullBodyAnchorUsed) ? 'partial' : 'none',
              state_variant_used: !!state_prompt_modifier,
            },
            asset_group: assetGroup,
            subject: character_name || location_name || null,
            shot_type: shotType,
            curation_state: "candidate",
            subject_type: assetGroup === "character" ? "character"
              : (assetGroup === "world" && location_name) ? "location"
              : assetGroup === "world" ? "world"
              : assetGroup === "key_moment" ? "moment"
              : assetGroup === "visual_language" ? "production_design"
              : null,
            subject_ref: character_name || location_name || null,
            location_ref: location_name || null,
            canon_location_id: location_id || null,
            generation_purpose: isIdentityGeneration ? "character_identity"
              : state_key ? `state_variant_${state_key}`
              : base_look_mode ? "character_reference"
              : location_ref_mode ? "location_reference"
              : `lookbook_${section}`,
            state_key: state_key || null,
            state_label: state_label || null,
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`[lookbook-image] repo insert error for variant ${i}:`, insertErr.message);
          results.push({ image_id: "", status: "stored_no_repo", shot_type: shotType || undefined, error: insertErr.message, identity_locked: identityLockUsed });
        } else {
          results.push({ image_id: imgRecord.id, status: "ready", shot_type: shotType || undefined, identity_locked: identityLockUsed });
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
