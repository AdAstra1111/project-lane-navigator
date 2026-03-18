import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Poster Strategy Definitions ──────────────────────────────────────────────

const POSTER_STRATEGIES = [
  {
    key: "character",
    label: "Character Focus",
    briefing: (ctx: StrategyContext) =>
      `Create a cinematic character portrait poster. The lead character dominates the frame — ` +
      `intense emotional expression, shallow depth of field, minimal background. ` +
      (ctx.characters ? `Key character: ${ctx.characters}. ` : "") +
      `Intimate close-up or medium shot. The character's face tells the whole story. ` +
      `${ctx.toneVisual}. Photorealistic, theatrical poster quality.`,
  },
  {
    key: "world",
    label: "World / Environment",
    briefing: (ctx: StrategyContext) =>
      `Create a cinematic environment poster showcasing the world of the story. ` +
      `The setting dominates — vast, atmospheric, cinematic scale. ` +
      (ctx.worldSetting ? `Setting: ${ctx.worldSetting}. ` : "") +
      `Any human figure is small or silhouetted against the landscape. ` +
      `Epic composition, sweeping vista feel. ${ctx.toneVisual}. ` +
      `Photorealistic, theatrical poster quality.`,
  },
  {
    key: "conflict",
    label: "Conflict / Action",
    briefing: (ctx: StrategyContext) =>
      `Create a cinematic tension poster capturing the central conflict. ` +
      `Dynamic composition — confrontation, opposition, stakes. ` +
      (ctx.conflict ? `Conflict: ${ctx.conflict}. ` : "") +
      `High energy, dramatic angles, sense of motion and danger. ` +
      `${ctx.toneVisual}. Split compositions or dramatic diagonals. ` +
      `Photorealistic, theatrical poster quality.`,
  },
  {
    key: "prestige",
    label: "Symbolic / Prestige",
    briefing: (ctx: StrategyContext) =>
      `Create a minimalist prestige film poster. Metaphor-driven, symbolic, ` +
      `high-end film festival aesthetic. ` +
      (ctx.themes ? `Themes: ${ctx.themes}. ` : "") +
      `Abstract or suggestive imagery. Restrained color palette, elegant negative space. ` +
      `Art-house sensibility. Think A24 or Cannes poster style. ` +
      `Photorealistic or painterly, gallery quality.`,
  },
  {
    key: "commercial",
    label: "Commercial / High-Concept",
    briefing: (ctx: StrategyContext) =>
      `Create a bold commercial movie poster with a clear visual hook. ` +
      `Strong, immediate impact — the kind of poster that sells from across a room. ` +
      (ctx.logline ? `Hook: ${ctx.logline.slice(0, 120)}. ` : "") +
      `Bold composition, strong focal point, space for prominent title placement in lower third. ` +
      `${ctx.toneVisual}. Mainstream appeal, blockbuster energy. ` +
      `Photorealistic, theatrical poster quality.`,
  },
  {
    key: "genre",
    label: "Genre Pure",
    briefing: (ctx: StrategyContext) =>
      `Create a poster that fully commits to ${ctx.primaryGenre || "dramatic"} genre conventions. ` +
      `Every visual cue should signal the genre immediately — ` +
      `${ctx.genreVisual || "dramatic cinematography"}. ` +
      `Lean hard into genre expectations. A fan of ${ctx.primaryGenre || "this genre"} ` +
      `should instantly recognize what kind of film this is. ` +
      `${ctx.toneVisual}. Photorealistic, theatrical poster quality.`,
  },
] as const;

interface StrategyContext {
  title: string;
  logline: string | null;
  characters: string | null;
  worldSetting: string | null;
  conflict: string | null;
  themes: string | null;
  primaryGenre: string;
  genreVisual: string;
  toneVisual: string;
  formatVisual: string;
  compReference: string;
}

// ── Shared Visual Maps ───────────────────────────────────────────────────────

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

// ── PosterPromptInputs (backwards compat) ────────────────────────────────────

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
  characters: string | null;
  conflict: string | null;
  themes: string | null;
  world_setting: string | null;
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
  let characters: string | null = null;
  let conflict: string | null = null;
  let themes: string | null = null;
  let world_setting: string | null = null;

  const { data: canon } = await supabase
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .maybeSingle();
  if (canon?.canon_json) {
    const cj = canon.canon_json as any;
    const parts: string[] = [];
    if (cj.world_description) { parts.push(cj.world_description); world_setting = cj.world_description; }
    if (cj.seed_draft?.premise) parts.push(cj.seed_draft.premise);
    if (cj.setting) { parts.push(cj.setting); if (!world_setting) world_setting = cj.setting; }
    canon_summary = parts.join(". ").slice(0, 300) || null;

    // Extract characters
    if (cj.characters && Array.isArray(cj.characters)) {
      characters = cj.characters.map((c: any) => c.name || c).slice(0, 3).join(", ");
    } else if (cj.protagonist) {
      characters = cj.protagonist;
    }

    // Extract conflict / themes
    if (cj.central_conflict) conflict = cj.central_conflict;
    if (cj.themes) {
      themes = Array.isArray(cj.themes) ? cj.themes.slice(0, 4).join(", ") : String(cj.themes);
    }
  }

  // Try character_bible doc for characters if still missing
  if (!characters) {
    const { data: charDoc } = await supabase
      .from("project_documents")
      .select("plaintext")
      .eq("project_id", projectId)
      .eq("doc_type", "character_bible")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (charDoc?.plaintext) {
      const nameMatches = charDoc.plaintext.match(/^##?\s+(.+)/gm);
      if (nameMatches) {
        characters = nameMatches.slice(0, 3).map((m: string) => m.replace(/^#+\s*/, "").trim()).join(", ");
      }
    }
  }

  // Try concept_brief for conflict/themes if still missing
  if (!conflict || !themes) {
    const { data: conceptDoc } = await supabase
      .from("project_documents")
      .select("plaintext")
      .eq("project_id", projectId)
      .eq("doc_type", "concept_brief")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conceptDoc?.plaintext) {
      if (!conflict) {
        const cm = conceptDoc.plaintext.match(/(?:conflict|stakes|tension):?\s*(.+?)(?:\n|$)/i);
        if (cm) conflict = cm[1].trim().slice(0, 200);
      }
      if (!themes) {
        const tm = conceptDoc.plaintext.match(/(?:themes?):?\s*(.+?)(?:\n|$)/i);
        if (tm) themes = tm[1].trim().slice(0, 200);
      }
    }
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
    characters,
    conflict,
    themes,
    world_setting,
  };
}

function buildStrategyContext(inputs: PosterPromptInputs): StrategyContext {
  const primaryGenre = inputs.genres[0] || "drama";
  const toneVisual = toneVisuals[inputs.tone?.toLowerCase()] || "cinematic atmosphere, professional lighting";
  const genreVisual = inputs.genres
    .map(g => genreMotifs[g?.toLowerCase()] || "")
    .filter(Boolean)
    .join(", ");

  let compReference = "";
  if (inputs.comparable_titles) {
    const comps = inputs.comparable_titles.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (comps.length > 0) compReference = `Visual inspiration from films like ${comps.join(", ")}. `;
  }

  return {
    title: inputs.title,
    logline: inputs.logline,
    characters: inputs.characters,
    worldSetting: inputs.world_setting,
    conflict: inputs.conflict,
    themes: inputs.themes,
    primaryGenre,
    genreVisual,
    toneVisual,
    formatVisual: "",
    compReference,
  };
}

function buildStrategyPrompt(strategy: typeof POSTER_STRATEGIES[number], ctx: StrategyContext): string {
  const base = strategy.briefing(ctx);
  return [
    base,
    ctx.compReference,
    `The image should be KEY ART — no text, no titles, no typography, no words.`,
    `Leave space in the lower third for title treatment overlay.`,
    `Aspect ratio: 2:3 portrait poster format.`,
  ].filter(Boolean).join(" ");
}

// ── Provider Adapter ─────────────────────────────────────────────────────────

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
        if (part?.type === "image_url" && part?.image_url?.url) {
          return parseDataUrl(part.image_url.url as string);
        }
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

  const dataArr = data?.data as Array<Record<string, unknown>> | undefined;
  if (dataArr?.length) {
    const b64 = dataArr[0]?.b64_json as string;
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return { imageDataUrl: `data:image/png;base64,${b64}`, format: "png", rawBytes: bytes };
    }
  }

  throw new Error(`No image found in AI response. Keys: ${JSON.stringify(Object.keys(data || {}))}`);
}

function parseDataUrl(dataUrl: string): ProviderImageResult {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error(`Invalid image data URL format`);
  const format = match[1];
  const rawBytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { imageDataUrl: dataUrl, format, rawBytes };
}

// ── Image generation helper ──────────────────────────────────────────────────

async function generateImage(
  apiKey: string,
  prompt: string,
): Promise<ProviderImageResult> {
  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    if (aiResponse.status === 429) throw new Error("Rate limit exceeded");
    if (aiResponse.status === 402) throw new Error("Payment required");
    throw new Error(`AI gateway error [${aiResponse.status}]: ${errText}`);
  }

  const aiData = await aiResponse.json();
  return extractImageFromResponse(aiData);
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

    const body = await req.json();
    const { project_id, mode, strategy_key } = body;
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve project truth
    const inputs = await resolveProjectInputs(supabase, project_id);
    const strategyCtx = buildStrategyContext(inputs);

    // ── Mode: multi_concept — generate 6 strategy posters ──
    if (mode === "multi_concept") {
      const strategies = strategy_key
        ? POSTER_STRATEGIES.filter(s => s.key === strategy_key)
        : [...POSTER_STRATEGIES];

      const results: Array<{
        strategy_key: string;
        strategy_label: string;
        poster_id: string;
        status: string;
        error?: string;
      }> = [];

      // Get next version base
      const { data: existingPosters } = await supabase
        .from("project_posters")
        .select("version_number")
        .eq("project_id", project_id)
        .order("version_number", { ascending: false })
        .limit(1);
      let nextVersion = (existingPosters?.[0]?.version_number || 0) + 1;

      for (const strategy of strategies) {
        const prompt = buildStrategyPrompt(strategy, strategyCtx);
        const versionNum = nextVersion++;

        // Create poster record
        const { data: posterRecord, error: insertErr } = await supabase
          .from("project_posters")
          .insert({
            project_id,
            user_id: user.id,
            version_number: versionNum,
            status: "generating",
            source_type: "generated",
            aspect_ratio: "2:3",
            layout_variant: strategy.key,
            prompt_text: prompt,
            prompt_inputs: { ...inputs, strategy_key: strategy.key, strategy_label: strategy.label },
            provider: "lovable-ai",
            model: "google/gemini-2.5-flash-image",
            render_status: "key_art_only",
            is_active: false,
          })
          .select()
          .single();

        if (insertErr) {
          results.push({ strategy_key: strategy.key, strategy_label: strategy.label, poster_id: "", status: "failed", error: insertErr.message });
          continue;
        }

        try {
          const imageResult = await generateImage(LOVABLE_API_KEY, prompt);

          const keyArtPath = `${project_id}/key-art/v${versionNum}-${strategy.key}.${imageResult.format}`;
          const { error: uploadErr } = await supabase.storage
            .from("project-posters")
            .upload(keyArtPath, imageResult.rawBytes, {
              contentType: `image/${imageResult.format}`,
              upsert: true,
            });

          if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

          await supabase.from("project_posters")
            .update({
              status: "ready",
              key_art_storage_path: keyArtPath,
              render_status: "key_art_only",
            })
            .eq("id", posterRecord.id);

          results.push({ strategy_key: strategy.key, strategy_label: strategy.label, poster_id: posterRecord.id, status: "ready" });
        } catch (genErr: unknown) {
          const errMsg = genErr instanceof Error ? genErr.message : "Generation failed";
          await supabase.from("project_posters").update({ status: "failed", error_message: errMsg }).eq("id", posterRecord.id);
          results.push({ strategy_key: strategy.key, strategy_label: strategy.label, poster_id: posterRecord.id, status: "failed", error: errMsg });

          // Stop on rate limit / payment errors
          if (errMsg.includes("Rate limit") || errMsg.includes("Payment required")) break;
        }
      }

      return new Response(JSON.stringify({ results, inputs_used: inputs }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode: generate (legacy single poster) ──
    const prompt = buildStrategyPrompt(POSTER_STRATEGIES[4], strategyCtx); // commercial by default

    const { data: existingPosters } = await supabase
      .from("project_posters")
      .select("version_number")
      .eq("project_id", project_id)
      .order("version_number", { ascending: false })
      .limit(1);
    const nextVersion = (existingPosters?.[0]?.version_number || 0) + 1;

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
        prompt_text: prompt,
        prompt_inputs: inputs,
        provider: "lovable-ai",
        model: "google/gemini-2.5-flash-image",
        render_status: "key_art_only",
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Failed to create poster record: ${insertErr.message}`);

    try {
      const imageResult = await generateImage(LOVABLE_API_KEY, prompt);

      const keyArtPath = `${project_id}/key-art/v${nextVersion}.${imageResult.format}`;
      const { error: uploadErr } = await supabase.storage
        .from("project-posters")
        .upload(keyArtPath, imageResult.rawBytes, {
          contentType: `image/${imageResult.format}`,
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      await supabase.from("project_posters")
        .update({ is_active: false })
        .eq("project_id", project_id)
        .neq("id", posterRecord.id);

      const { data: updatedPoster, error: updateErr } = await supabase
        .from("project_posters")
        .update({
          status: "ready",
          is_active: true,
          key_art_storage_path: keyArtPath,
          render_status: "key_art_only",
        })
        .eq("id", posterRecord.id)
        .select()
        .single();

      if (updateErr) throw new Error(`Failed to update poster: ${updateErr.message}`);

      return new Response(JSON.stringify({ poster: updatedPoster }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (genErr: unknown) {
      const errMsg = genErr instanceof Error ? genErr.message : "Unknown generation error";
      await supabase.from("project_posters").update({ status: "failed", error_message: errMsg }).eq("id", posterRecord.id);
      return new Response(JSON.stringify({ error: errMsg, poster_id: posterRecord.id }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-poster error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
