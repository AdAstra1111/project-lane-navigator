import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveImageGenerationConfig, buildImageRepositoryMeta } from "../_shared/imageGenerationResolver.ts";
import type { ImageRole, ImageStyleMode } from "../_shared/imageGenerationResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Style Policy (inline, mirrors src/lib/images/stylePolicy.ts) ─────────

type LocalImageStyleMode = "photorealistic_cinematic" | "stylised_animation" | "stylised_graphic" | "stylised_experimental" | "stylised_period_painterly";

interface ImageStylePolicy {
  mode: LocalImageStyleMode;
  styleDirectives: string;
  negativeStyleConstraints: string;
}

const PHOTOREAL_DIRECTIVES =
  "Photorealistic cinematic imagery. Shot on high-end cinema camera. Real-world materials, textures, surfaces. Believable natural or motivated lighting. Cinematic depth of field. Premium theatrical realism.";
const PHOTOREAL_NEGATIVES =
  "painterly, illustrative, cartoon, anime, graphic-novel style, concept art rendering, abstract, surreal, watercolor, oil painting, sketch, line art, cel-shaded, pop art, storybook illustration, digital painting, CGI render look, stock photo aesthetic";

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

// ── Section prompt builders ──────────────────────────────────────────────────

type LookbookSection = "world" | "character" | "key_moment" | "visual_language";

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

function buildSectionPrompt(section: LookbookSection, ctx: SectionContext, variantIndex: number): string {
  const variation = [`angle A — wide establishing shot`, `angle B — atmospheric detail`, `angle C — immersive perspective`, `angle D — dramatic composition`, `angle E — intimate focus`, `angle F — environmental portrait`];
  const varHint = variation[variantIndex % variation.length];

  let base = "";
  switch (section) {
    case "world":
      base = `A cinematic establishing shot for "${ctx.title}" — ${varHint}. ` +
        `${ctx.worldDescription || "The story's world rendered with atmospheric depth"}. ` +
        `Sweeping, immersive, with cinematic scale and presence. ` +
        `Tone: ${ctx.tone}. No text, no titles, no watermarks.`;
      break;
    case "character":
      base = `A cinematic character portrait for "${ctx.title}" — ${ctx.characterName || "the protagonist"}. ` +
        `${varHint}. ` +
        `${ctx.characters || "A compelling character rendered with emotional depth"}. ` +
        `In the world of the story. Tone: ${ctx.tone}. No text, no titles, no watermarks.`;
      break;
    case "key_moment":
      base = `A key dramatic moment from "${ctx.title}" — ${varHint}. ` +
        `${ctx.conflict || ctx.logline || "A pivotal scene of tension and stakes"}. ` +
        `Cinematic framing, emotional intensity. Tone: ${ctx.tone}. No text, no titles, no watermarks.`;
      break;
    case "visual_language":
      base = `A visual language reference image for "${ctx.title}" — ${varHint}. ` +
        `Demonstrating the project's visual approach: ${ctx.themes || "cinematic atmosphere and texture"}. ` +
        `Focus on lighting, color palette, texture, and composition style. ` +
        `Tone: ${ctx.tone}. No text, no titles, no watermarks.`;
      break;
  }

  return [
    base,
    `IMAGE STYLE POLICY: ${ctx.stylePolicy.styleDirectives}`,
    `DO NOT: ${ctx.stylePolicy.negativeStyleConstraints}`,
    `REQUIREMENTS: 16:9 landscape composition. Premium cinematic quality. No text or typography.`,
  ].join("\n\n");
}

// ── Image generation (same pattern as generate-poster) ───────────────────────

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
    const { project_id, section, count = 3, entity_id, character_name } = body as {
      project_id: string;
      section: LookbookSection;
      count?: number;
      entity_id?: string;
      character_name?: string;
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

    const genCount = Math.min(Math.max(count, 1), 6);
    const results: Array<{ image_id: string; status: string; error?: string }> = [];

    for (let i = 0; i < genCount; i++) {
      const prompt = buildSectionPrompt(section, ctx, i);
      const resolverInput = { role: imageRole, styleMode, strategyKey: `lookbook_${section}` };
      const genConfig = resolveImageGenerationConfig(resolverInput);
      const repoMeta = buildImageRepositoryMeta(genConfig, resolverInput);

      try {
        const imageResult = await generateImage(LOVABLE_API_KEY, prompt, genConfig.model, genConfig.gatewayUrl);

        const storagePath = `${project_id}/lookbook/${section}/${Date.now()}-v${i}.${imageResult.format}`;
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
            generation_config: { ...repoMeta, source_feature: "lookbook_engine", section, variant_index: i },
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`[lookbook-image] repo insert error for variant ${i}:`, insertErr.message);
          results.push({ image_id: "", status: "stored_no_repo", error: insertErr.message });
        } else {
          results.push({ image_id: imgRecord.id, status: "ready" });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[lookbook-image] generation error for ${section} variant ${i}:`, msg);
        results.push({ image_id: "", status: "failed", error: msg });
      }
    }

    return new Response(JSON.stringify({ section, results }), {
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
