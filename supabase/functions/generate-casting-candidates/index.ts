/**
 * Edge Function: generate-casting-candidates
 * Generates multiple AI casting candidate images per character using project canon + visual DNA.
 * Uses Lovable AI image generation (Gemini) to produce headshot + full-body pairs.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Casting archetype variations to create diverse but character-consistent candidates
const VARIATION_DESCRIPTORS = [
  { style: "naturalistic", mood: "warm and grounded", casting_note: "everyday authenticity" },
  { style: "striking", mood: "intense and magnetic", casting_note: "strong screen presence" },
  { style: "refined", mood: "elegant and composed", casting_note: "classical beauty" },
  { style: "raw", mood: "gritty and real", casting_note: "unconventional casting" },
  { style: "luminous", mood: "soft and radiant", casting_note: "ethereal quality" },
  { style: "commanding", mood: "powerful and assured", casting_note: "authority and gravitas" },
];

interface CharacterInfo {
  name: string;
  traits: string[];
  dna: Record<string, any> | null;
  role?: string;
}

async function resolveCharacters(
  supabase: any,
  projectId: string
): Promise<CharacterInfo[]> {
  // Get canon characters
  const { data: canonFacts } = await supabase
    .from("canon_facts")
    .select("subject, predicate, object, value")
    .eq("project_id", projectId)
    .eq("fact_type", "character")
    .eq("is_active", true);

  const charMap = new Map<string, CharacterInfo>();

  for (const fact of canonFacts || []) {
    if (!charMap.has(fact.subject)) {
      charMap.set(fact.subject, { name: fact.subject, traits: [], dna: null });
    }
    const ch = charMap.get(fact.subject)!;
    if (fact.predicate === "role" || fact.predicate === "archetype") {
      ch.role = fact.object || (fact.value as any)?.toString();
    }
    if (fact.object) ch.traits.push(`${fact.predicate}: ${fact.object}`);
  }

  // Fallback: if no canon characters, resolve from project_images subjects
  if (charMap.size === 0) {
    // Try subject_type = 'character' first
    const { data: imgSubjects } = await supabase
      .from("project_images")
      .select("subject")
      .eq("project_id", projectId)
      .eq("subject_type", "character")
      .not("subject", "is", null);

    const seen = new Set<string>();
    for (const row of imgSubjects || []) {
      const name = (row.subject || "").trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        charMap.set(name, { name, traits: [], dna: null });
      }
    }

    // Also check identity shot types (subject_type may be null for older images)
    if (charMap.size === 0) {
      const { data: identityImgs } = await supabase
        .from("project_images")
        .select("subject")
        .eq("project_id", projectId)
        .in("shot_type", ["identity_headshot", "identity_full_body"])
        .not("subject", "is", null);

      for (const row of identityImgs || []) {
        const name = (row.subject || "").trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          charMap.set(name, { name, traits: [], dna: null });
        }
      }
    }

    // Final fallback: any project_images with a non-null subject that isn't a location
    if (charMap.size === 0) {
      const { data: allSubjects } = await supabase
        .from("project_images")
        .select("subject, subject_type")
        .eq("project_id", projectId)
        .not("subject", "is", null);

      for (const row of allSubjects || []) {
        const name = (row.subject || "").trim();
        const stype = (row.subject_type || "").toLowerCase();
        if (name && !seen.has(name) && stype !== "location") {
          seen.add(name);
          charMap.set(name, { name, traits: [], dna: null });
        }
      }
    }
  }

  // Get visual DNA for each character
  for (const [name, info] of charMap) {
    const { data: dna } = await supabase
      .from("character_visual_dna")
      .select("identity_signature, physical_categories, binding_markers")
      .eq("project_id", projectId)
      .ilike("character_name", name)
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();

    if (dna) info.dna = dna;
  }

  return [...charMap.values()];
}

function buildCastingPrompt(
  character: CharacterInfo,
  variation: typeof VARIATION_DESCRIPTORS[0],
  shotType: "headshot" | "full_body",
  projectStyle: string
): string {
  const parts: string[] = [];

  // Core shot direction
  if (shotType === "headshot") {
    parts.push(
      `Professional casting headshot photograph. Close-up portrait, shoulders up, neutral background.`
    );
  } else {
    parts.push(
      `Professional casting full-body photograph. Standing pose, full figure visible from head to toe, neutral studio background.`
    );
  }

  // Character identity from DNA
  if (character.dna?.identity_signature) {
    const sig = character.dna.identity_signature;
    if (sig.age) parts.push(`Age: ${sig.age}.`);
    if (sig.gender) parts.push(`Gender presentation: ${sig.gender}.`);
    if (sig.ethnicity) parts.push(`Appearance: ${sig.ethnicity}.`);
    if (sig.build) parts.push(`Build: ${sig.build}.`);
    if (sig.hair) parts.push(`Hair: ${sig.hair}.`);
    if (sig.face) parts.push(`Face: ${sig.face}.`);
    if (sig.height) parts.push(`Height: ${sig.height}.`);
  }

  // Physical categories from DNA
  if (character.dna?.physical_categories) {
    const pc = character.dna.physical_categories;
    for (const [key, val] of Object.entries(pc)) {
      if (val && typeof val === "object" && (val as any).value) {
        parts.push(`${key}: ${(val as any).value}.`);
      }
    }
  }

  // Canon traits
  if (character.traits.length > 0) {
    parts.push(`Character traits: ${character.traits.slice(0, 5).join("; ")}.`);
  }

  if (character.role) {
    parts.push(`Character role: ${character.role}.`);
  }

  // Variation
  parts.push(
    `Casting direction: ${variation.casting_note}. Mood: ${variation.mood}. Style: ${variation.style}.`
  );

  // Project style context
  if (projectStyle) {
    parts.push(`Project visual style: ${projectStyle}.`);
  }

  // Quality directives
  parts.push(
    `Photorealistic. Professional lighting. Sharp focus. High resolution casting photograph. No text, no watermarks.`
  );

  return parts.join(" ");
}

async function generateImage(
  prompt: string,
  apiKey: string
): Promise<string | null> {
  try {
    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-image-preview",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Image gen failed (${resp.status}):`, errText);
      if (resp.status === 429) throw new Error("RATE_LIMITED");
      if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
      return null;
    }

    const data = await resp.json();
    const imageUrl =
      data.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
    return imageUrl;
  } catch (e: any) {
    if (e.message === "RATE_LIMITED" || e.message === "CREDITS_EXHAUSTED")
      throw e;
    console.error("Image generation error:", e);
    return null;
  }
}

async function uploadBase64Image(
  supabase: any,
  base64Url: string,
  path: string
): Promise<string | null> {
  try {
    const base64Data = base64Url.split(",")[1];
    if (!base64Data) return null;

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const { error } = await supabase.storage
      .from("project-images")
      .upload(path, bytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (error) {
      console.error("Upload error:", error);
      return null;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("project-images").getPublicUrl(path);
    return publicUrl;
  } catch (e) {
    console.error("Upload error:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { projectId, candidatesPerCharacter = 4, characterFilter } = body;

    if (!projectId) return jsonRes({ error: "projectId required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY)
      return jsonRes({ error: "LOVABLE_API_KEY not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return jsonRes({ error: "Unauthorized" }, 401);

    // Resolve characters
    let characters = await resolveCharacters(supabase, projectId);
    if (characterFilter) {
      characters = characters.filter((c) =>
        c.name.toLowerCase() === characterFilter.toLowerCase()
      );
    }

    if (characters.length === 0) {
      return jsonRes({ error: "No characters found for project" }, 400);
    }

    // Get project style context
    const { data: project } = await supabase
      .from("projects")
      .select("title, genre, format, tone")
      .eq("id", projectId)
      .maybeSingle();

    const projectStyle = project
      ? [project.genre, project.format, project.tone].filter(Boolean).join(", ")
      : "";

    // Generate batch ID
    const batchId = crypto.randomUUID();
    const count = Math.min(candidatesPerCharacter, 6);
    const results: any[] = [];
    let generated = 0;
    let failed = 0;

    for (const character of characters) {
      for (let i = 0; i < count; i++) {
        const variation =
          VARIATION_DESCRIPTORS[i % VARIATION_DESCRIPTORS.length];

        // Generate headshot
        const headshotPrompt = buildCastingPrompt(
          character,
          variation,
          "headshot",
          projectStyle
        );

        let headshotUrl: string | null = null;
        let fullBodyUrl: string | null = null;

        try {
          const headshotBase64 = await generateImage(
            headshotPrompt,
            LOVABLE_API_KEY
          );
          if (headshotBase64) {
            const storagePath = `casting/${projectId}/${batchId}/${character.name.toLowerCase().replace(/\s+/g, "_")}_${i}_headshot.png`;
            headshotUrl = await uploadBase64Image(
              supabase,
              headshotBase64,
              storagePath
            );
          }

          // Small delay between generations to avoid rate limits
          await new Promise((r) => setTimeout(r, 1500));

          // Generate full body
          const fullBodyPrompt = buildCastingPrompt(
            character,
            variation,
            "full_body",
            projectStyle
          );
          const fullBodyBase64 = await generateImage(
            fullBodyPrompt,
            LOVABLE_API_KEY
          );
          if (fullBodyBase64) {
            const storagePath = `casting/${projectId}/${batchId}/${character.name.toLowerCase().replace(/\s+/g, "_")}_${i}_full_body.png`;
            fullBodyUrl = await uploadBase64Image(
              supabase,
              fullBodyBase64,
              storagePath
            );
          }
        } catch (e: any) {
          if (e.message === "RATE_LIMITED") {
            // Wait and continue with remaining
            console.warn("Rate limited, waiting 10s...");
            await new Promise((r) => setTimeout(r, 10000));
            failed++;
            continue;
          }
          if (e.message === "CREDITS_EXHAUSTED") {
            return jsonRes(
              {
                error: "AI credits exhausted. Please add funds.",
                partial_results: results,
                generated,
                failed,
              },
              402
            );
          }
          failed++;
          continue;
        }

        if (!headshotUrl && !fullBodyUrl) {
          failed++;
          continue;
        }

        // Insert candidate
        const { data: inserted, error: insertErr } = await supabase
          .from("casting_candidates")
          .insert({
            project_id: projectId,
            user_id: user.id,
            character_key: character.name,
            batch_id: batchId,
            status: "generated",
            headshot_url: headshotUrl,
            full_body_url: fullBodyUrl,
            generation_config: {
              variation: variation.style,
              casting_note: variation.casting_note,
              mood: variation.mood,
              headshot_prompt: headshotUrl
                ? buildCastingPrompt(character, variation, "headshot", projectStyle).substring(0, 200)
                : null,
              full_body_prompt: fullBodyUrl
                ? buildCastingPrompt(character, variation, "full_body", projectStyle).substring(0, 200)
                : null,
              character_dna_used: !!character.dna,
              model: "google/gemini-3.1-flash-image-preview",
            },
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error("Insert error:", insertErr);
          failed++;
        } else {
          results.push({
            id: inserted.id,
            character: character.name,
            variation: variation.style,
          });
          generated++;
        }

        // Delay between candidates
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    return jsonRes({
      batch_id: batchId,
      generated,
      failed,
      characters: characters.length,
      results,
    });
  } catch (err: any) {
    console.error("generate-casting-candidates error:", err);

    if (err.message?.includes("RATE_LIMITED")) {
      return jsonRes({ error: "Rate limited. Please try again later." }, 429);
    }
    if (err.message?.includes("CREDITS_EXHAUSTED")) {
      return jsonRes({ error: "AI credits exhausted. Please add funds." }, 402);
    }

    return jsonRes({ error: err.message || "Internal error" }, 500);
  }
});
