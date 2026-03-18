import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Deterministic Poster Prompt Builder ──────────────────────────────────────

interface PosterPromptInputs {
  title: string;
  format: string;
  genres: string[];
  tone: string;
  budget_range: string;
  target_audience: string;
  comparable_titles: string;
  assigned_lane: string | null;
  logline: string | null;
  canon_summary: string | null;
  // v1 truth-source documentation
  _truth_sources: {
    title: "projects.title";
    logline: "pitch_ideas.logline | project_documents(idea).plaintext";
    canon: "project_canon.canon_json";
    format_tone_genres: "projects row";
    // Deferred for v2: blueprint_version, treatment_version, character_bible_version
    _deferred: string[];
  };
}

interface PosterPrompt {
  prompt: string;
  style_tags: string[];
  negative_constraints: string[];
  inputs_snapshot: PosterPromptInputs;
}

function buildPosterPrompt(inputs: PosterPromptInputs): PosterPrompt {
  const {
    title, format, genres, tone,
    comparable_titles, logline, canon_summary,
  } = inputs;

  const toneVisuals: Record<string, string> = {
    dark: "moody shadows, desaturated palette, noir-inspired lighting",
    light: "warm golden light, hopeful atmosphere, soft focus backgrounds",
    gritty: "raw textures, urban decay, handheld documentary feel",
    comedic: "bright colors, dynamic composition, playful energy",
    thriller: "high contrast, tension-filled composition, cool blue tones",
    dramatic: "deep cinematic shadows, rich warm tones, emotional weight",
    horror: "deep blacks, unsettling atmosphere, eerie fog, cold tones",
    romantic: "soft bokeh, warm sunset tones, intimate framing",
    epic: "sweeping vista, grand scale, dramatic sky, golden hour",
    satirical: "bold graphic style, sharp contrast, pop-art influence",
    whimsical: "dreamy pastels, fantastical elements, storybook quality",
    suspenseful: "high contrast, silhouettes, tension, atmospheric haze",
  };

  const formatVisuals: Record<string, string> = {
    film: "cinematic widescreen composition, theatrical poster framing",
    "tv-series": "ensemble cast composition, serialized drama aesthetic",
    "limited-series": "prestige limited series, contained dramatic intensity",
    "vertical-drama": "vertical mobile-first composition, bold close-ups",
    documentary: "photojournalistic authenticity, real-world textures",
    "documentary-series": "observational realism, archival texture blend",
    "short-film": "artistic minimalism, festival poster aesthetic",
    "anim-feature": "stylized animated world, rich color palette",
    "anim-series": "bold animated character design, dynamic poses",
  };

  const genreMotifs: Record<string, string> = {
    drama: "emotional portraiture, dramatic lighting",
    thriller: "shadowy figures, tension, urban nightscape",
    horror: "darkness, isolation, dread",
    comedy: "vibrant colors, expressive characters",
    "sci-fi": "futuristic elements, technological atmosphere",
    romance: "intimate composition, warm tones",
    action: "dynamic movement, explosive energy",
    crime: "noir aesthetics, urban grit",
    mystery: "obscured faces, fog, enigmatic composition",
    fantasy: "otherworldly landscapes, magical atmosphere",
    war: "epic scale, visceral intensity, smoke and earth",
    western: "vast landscapes, dusty atmosphere, golden light",
    musical: "vibrant stage lighting, performance energy",
    animation: "stylized artistic rendering, bold shapes",
    documentary: "authentic textures, photographic realism",
    "true-crime": "evidence board aesthetic, cold case atmosphere",
  };

  const toneVisual = toneVisuals[tone?.toLowerCase()] || "cinematic atmosphere, professional lighting";
  const formatVisual = formatVisuals[format?.toLowerCase()] || "cinematic film poster composition";
  const genreVisual = genres
    .map(g => genreMotifs[g?.toLowerCase()] || "")
    .filter(Boolean)
    .join(", ");

  let narrativeContext = "";
  if (logline) narrativeContext = `The story: ${logline.slice(0, 200)}. `;
  if (canon_summary) narrativeContext += `World: ${canon_summary.slice(0, 150)}. `;

  let compReference = "";
  if (comparable_titles) {
    const comps = comparable_titles.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (comps.length > 0) compReference = `Visual inspiration from the world of films like ${comps.join(", ")}. `;
  }

  const prompt = [
    `Create a cinematic movie poster background image.`,
    `${formatVisual}.`,
    narrativeContext,
    compReference,
    `Visual atmosphere: ${toneVisual}.`,
    genreVisual ? `Genre motifs: ${genreVisual}.` : "",
    `The image should be a KEY ART background — no text, no titles, no typography, no words.`,
    `Professional theatrical poster quality. Photorealistic cinematic composition.`,
    `Dramatic lighting with depth and atmosphere.`,
    `Leave space in the lower third for title treatment overlay.`,
    `Aspect ratio: 2:3 portrait poster format.`,
  ].filter(Boolean).join(" ");

  const style_tags = [
    "cinematic", "theatrical-poster", "key-art",
    format || "film", tone || "dramatic",
    ...(genres || []),
  ];

  const negative_constraints = [
    "no text", "no titles", "no typography", "no watermarks",
    "no logos", "no credits", "no billing block",
    "no cartoon style unless animated format",
    "no stock photo look", "no generic AI aesthetic",
  ];

  return { prompt, style_tags, negative_constraints, inputs_snapshot: inputs };
}

// ── Provider Adapter ─────────────────────────────────────────────────────────

interface ProviderImageResult {
  imageDataUrl: string; // data:image/...;base64,...
  format: string;       // png, jpeg, webp
  rawBytes: Uint8Array;
}

/**
 * Extract image from AI gateway response.
 * Adapter pattern — isolates provider-specific response parsing.
 * Supports: Lovable AI gateway (OpenAI-compatible with images array).
 */
function extractImageFromResponse(aiData: unknown): ProviderImageResult {
  const data = aiData as Record<string, unknown>;

  // Path 1: OpenAI-compatible choices[].message.images[]
  const choices = data?.choices as Array<Record<string, unknown>> | undefined;
  if (choices?.length) {
    const message = choices[0]?.message as Record<string, unknown> | undefined;

    // Sub-path 1a: images array with image_url.url
    const images = message?.images as Array<Record<string, unknown>> | undefined;
    if (images?.length) {
      const imageUrl = (images[0]?.image_url as Record<string, unknown>)?.url as string;
      if (imageUrl) return parseDataUrl(imageUrl);
    }

    // Sub-path 1b: content array with image_url type
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "image_url" && part?.image_url?.url) {
          return parseDataUrl(part.image_url.url as string);
        }
      }
    }

    // Sub-path 1c: inline_data in parts
    if (Array.isArray(content)) {
      for (const part of content) {
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

  // Path 2: top-level data array (some providers)
  const dataArr = data?.data as Array<Record<string, unknown>> | undefined;
  if (dataArr?.length) {
    const b64 = dataArr[0]?.b64_json as string;
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return { imageDataUrl: `data:image/png;base64,${b64}`, format: "png", rawBytes: bytes };
    }
    const url = dataArr[0]?.url as string;
    if (url) return parseDataUrl(url);
  }

  throw new Error(
    `No image found in AI response. Keys: ${JSON.stringify(Object.keys(data || {}))}. ` +
    `choices[0].message keys: ${JSON.stringify(Object.keys((data as any)?.choices?.[0]?.message || {}))}`
  );
}

function parseDataUrl(dataUrl: string): ProviderImageResult {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    throw new Error(`Invalid image data URL format (length: ${dataUrl.length}, prefix: ${dataUrl.slice(0, 50)})`);
  }
  const format = match[1];
  const rawBytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { imageDataUrl: dataUrl, format, rawBytes };
}

// ── Resolve project truth for prompt inputs ──────────────────────────────────

async function resolveProjectInputs(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<PosterPromptInputs> {
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("title, format, genres, tone, budget_range, target_audience, comparable_titles, assigned_lane, source_pitch_idea_id")
    .eq("id", projectId)
    .single();

  if (projErr || !project) throw new Error(`Project not found: ${projErr?.message}`);

  let logline: string | null = null;
  if (project.source_pitch_idea_id) {
    const { data: pitch } = await supabase
      .from("pitch_ideas")
      .select("logline")
      .eq("id", project.source_pitch_idea_id)
      .single();
    if (pitch?.logline) logline = pitch.logline;
  }

  if (!logline) {
    const { data: ideaDoc } = await supabase
      .from("project_documents")
      .select("plaintext")
      .eq("project_id", projectId)
      .eq("doc_type", "idea")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ideaDoc?.plaintext) {
      const match = ideaDoc.plaintext.match(/\*?\*?Logline:?\*?\*?\s*(.+?)(?:\n|$)/i);
      if (match) logline = match[1].trim().slice(0, 300);
    }
  }

  let canon_summary: string | null = null;
  const { data: canon } = await supabase
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .maybeSingle();
  if (canon?.canon_json) {
    const cj = canon.canon_json as any;
    const parts: string[] = [];
    if (cj.world_description) parts.push(cj.world_description);
    if (cj.seed_draft?.premise) parts.push(cj.seed_draft.premise);
    if (cj.setting) parts.push(cj.setting);
    canon_summary = parts.join(". ").slice(0, 300) || null;
  }

  return {
    title: project.title || "Untitled Project",
    format: project.format || "film",
    genres: project.genres || [],
    tone: project.tone || "dramatic",
    budget_range: project.budget_range || "",
    target_audience: project.target_audience || "",
    comparable_titles: project.comparable_titles || "",
    assigned_lane: project.assigned_lane,
    logline,
    canon_summary,
    _truth_sources: {
      title: "projects.title",
      logline: "pitch_ideas.logline | project_documents(idea).plaintext",
      canon: "project_canon.canon_json",
      format_tone_genres: "projects row",
      _deferred: [
        "blueprint_version (best CI version)",
        "treatment_version (best CI version)",
        "character_bible_version (protagonist/antagonist archetypes)",
        "style_benchmark if available",
      ],
    },
  };
}

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

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve project truth
    const inputs = await resolveProjectInputs(supabase, project_id);
    const posterPrompt = buildPosterPrompt(inputs);

    // Get next version number
    const { data: existingPosters } = await supabase
      .from("project_posters")
      .select("version_number")
      .eq("project_id", project_id)
      .order("version_number", { ascending: false })
      .limit(1);
    const nextVersion = (existingPosters?.[0]?.version_number || 0) + 1;

    // Create poster record in pending state
    const { data: posterRecord, error: insertErr } = await supabase
      .from("project_posters")
      .insert({
        project_id,
        user_id: user.id,
        version_number: nextVersion,
        status: "generating",
        source_type: "generated",
        aspect_ratio: "2:3",
        layout_variant: "cinematic-dark",
        prompt_text: posterPrompt.prompt,
        prompt_inputs: posterPrompt.inputs_snapshot,
        provider: "lovable-ai",
        model: "google/gemini-2.5-flash-image",
        render_status: "key_art_only",
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Failed to create poster record: ${insertErr.message}`);

    // Generate key art via Lovable AI
    try {
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: posterPrompt.prompt }],
          modalities: ["image", "text"],
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        if (aiResponse.status === 429) {
          await supabase.from("project_posters").update({
            status: "failed", error_message: "Rate limited — try again in a moment",
          }).eq("id", posterRecord.id);
          return new Response(JSON.stringify({ error: "Rate limited", poster_id: posterRecord.id }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (aiResponse.status === 402) {
          await supabase.from("project_posters").update({
            status: "failed", error_message: "Credits required",
          }).eq("id", posterRecord.id);
          return new Response(JSON.stringify({ error: "Payment required", poster_id: posterRecord.id }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI gateway error [${aiResponse.status}]: ${errText}`);
      }

      const aiData = await aiResponse.json();

      // Use provider adapter to extract image
      const imageResult = extractImageFromResponse(aiData);

      const keyArtPath = `${project_id}/key-art/v${nextVersion}.${imageResult.format}`;
      const { error: uploadErr } = await supabase.storage
        .from("project-posters")
        .upload(keyArtPath, imageResult.rawBytes, {
          contentType: `image/${imageResult.format}`,
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Private bucket: use signed URL (1 hour expiry for immediate use)
      const { data: signedUrlData, error: signedErr } = await supabase.storage
        .from("project-posters")
        .createSignedUrl(keyArtPath, 3600);

      const keyArtUrl = signedErr ? null : signedUrlData?.signedUrl;

      // Deactivate previous active posters
      await supabase
        .from("project_posters")
        .update({ is_active: false })
        .eq("project_id", project_id)
        .neq("id", posterRecord.id);

      // Update poster record — key art only, rendered fields NULL (honest)
      const { data: updatedPoster, error: updateErr } = await supabase
        .from("project_posters")
        .update({
          status: "ready",
          is_active: true,
          key_art_storage_path: keyArtPath,
          key_art_public_url: keyArtUrl,
          // rendered_* stays NULL — composition is client-side preview only in v1
          render_status: "key_art_only",
        })
        .eq("id", posterRecord.id)
        .select()
        .single();

      if (updateErr) throw new Error(`Failed to update poster: ${updateErr.message}`);

      return new Response(JSON.stringify({
        poster: updatedPoster,
        prompt: posterPrompt,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (genErr: unknown) {
      const errMsg = genErr instanceof Error ? genErr.message : "Unknown generation error";
      console.error("Poster generation failed:", errMsg);

      await supabase.from("project_posters").update({
        status: "failed",
        error_message: errMsg,
      }).eq("id", posterRecord.id);

      return new Response(JSON.stringify({
        error: errMsg,
        poster_id: posterRecord.id,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-poster error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
