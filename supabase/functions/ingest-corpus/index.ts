import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, supabaseKey);
    const { action, ...params } = await req.json();

    if (action === "ingest") {
      return await handleIngest(adminClient, user.id, params, lovableKey, corsHeaders);
    } else if (action === "search") {
      return await handleSearch(adminClient, user.id, params, corsHeaders);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  } catch (e) {
    console.error("ingest-corpus error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Ingest ────────────────────────────────────────────────────────────

async function handleIngest(
  db: ReturnType<typeof createClient>,
  userId: string,
  params: { source_id: string },
  lovableKey: string | undefined,
  cors: Record<string, string>,
) {
  const { source_id } = params;
  const log: string[] = [];
  const addLog = (msg: string) => { log.push(`[${new Date().toISOString()}] ${msg}`); };

  // 1. Verify source
  const { data: source, error: srcErr } = await db
    .from("approved_sources")
    .select("*")
    .eq("id", source_id)
    .eq("user_id", userId)
    .single();

  if (srcErr || !source) throw new Error("Source not found or not owned by user");
  if (source.rights_status !== "APPROVED") {
    throw new Error(`Ingestion refused: rights_status is '${source.rights_status}', must be 'APPROVED'`);
  }

  addLog(`Starting ingestion for "${source.title}" (${source.format})`);

  // 2. Download file
  addLog("Downloading source file…");
  let rawText = "";

  if (source.format === "html") {
    const resp = await fetch(source.source_url);
    if (!resp.ok) throw new Error(`Failed to fetch HTML: ${resp.status}`);
    const html = await resp.text();
    rawText = extractHtmlText(html);
    addLog(`HTML extracted: ${rawText.length} chars`);
  } else {
    // PDF — use Gemini via Lovable AI to extract text
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured — needed for PDF extraction");
    addLog("Fetching PDF and extracting text via AI…");
    const pdfResp = await fetch(source.source_url);
    if (!pdfResp.ok) throw new Error(`Failed to fetch PDF: ${pdfResp.status}`);
    const pdfBuffer = await pdfResp.arrayBuffer();
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer.slice(0, 4_000_000))));

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extract ALL text from this screenplay PDF. Preserve sluglines (INT./EXT.), character names, dialogue, and action lines. Return ONLY the extracted text, nothing else." },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
            ],
          },
        ],
      }),
    });
    if (!aiResp.ok) {
      const errText = await aiResp.text();
      throw new Error(`AI extraction failed (${aiResp.status}): ${errText}`);
    }
    const aiData = await aiResp.json();
    rawText = aiData.choices?.[0]?.message?.content || "";
    addLog(`PDF text extracted via AI: ${rawText.length} chars`);
  }

  if (rawText.length < 100) throw new Error("Extracted text too short — likely extraction failure");

  // 3. Normalize + checksum
  rawText = normalizeText(rawText);
  const checksum = await sha256(rawText);
  addLog(`Checksum: ${checksum}`);

  // 4. Upload raw text to storage
  const storagePath = `corpus/raw/${checksum}.txt`;
  const { error: uploadErr } = await db.storage.from("scripts").upload(storagePath, rawText, {
    contentType: "text/plain",
    upsert: true,
  });
  if (uploadErr) addLog(`Storage upload warning: ${uploadErr.message}`);
  else addLog("Raw text uploaded to storage");

  // 5. Create corpus_scripts record
  const pageEstimate = Math.round(rawText.length / 3000); // ~3000 chars per screenplay page
  const { data: scriptRec, error: insErr } = await db
    .from("corpus_scripts")
    .insert({
      user_id: userId,
      source_id,
      checksum,
      raw_storage_path: storagePath,
      page_count_estimate: pageEstimate,
      ingestion_status: "processing",
      ingestion_log: log.join("\n"),
    })
    .select()
    .single();

  if (insErr) throw new Error(`Failed to create corpus_scripts record: ${insErr.message}`);
  const scriptId = scriptRec.id;

  // 6. Parse scenes
  addLog("Parsing screenplay structure…");
  const scenes = parseScenes(rawText);
  addLog(`Parsed ${scenes.length} scenes`);

  if (scenes.length > 0) {
    const sceneRows = scenes.map((s, i) => ({
      user_id: userId,
      script_id: scriptId,
      scene_number: i + 1,
      slugline: s.slugline,
      location: s.location,
      time_of_day: s.timeOfDay,
      scene_text: s.text.slice(0, 50_000),
    }));
    const { error: sceneErr } = await db.from("corpus_scenes").insert(sceneRows);
    if (sceneErr) addLog(`Scene insert warning: ${sceneErr.message}`);
  }

  // 7. Chunk text
  addLog("Chunking text…");
  const chunks = chunkText(rawText, scenes);
  addLog(`Created ${chunks.length} chunks`);

  if (chunks.length > 0) {
    const chunkRows = chunks.map((c, i) => ({
      user_id: userId,
      script_id: scriptId,
      chunk_index: i,
      chunk_text: c,
    }));
    // Insert in batches of 50
    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error: chunkErr } = await db.from("corpus_chunks").insert(batch);
      if (chunkErr) addLog(`Chunk batch ${i} warning: ${chunkErr.message}`);
    }
  }

  // 8. Generate derived artifacts via LLM
  if (lovableKey) {
    addLog("Generating derived artifacts…");
    try {
      const excerpt = rawText.slice(0, 15_000);
      const artifactResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You are a professional screenplay analyst. Analyze the provided screenplay excerpt and return ONLY valid JSON.",
            },
            {
              role: "user",
              content: `Analyze this screenplay and produce a JSON object with these keys:
1) "beats" — array of 15 beat structure entries, each with "beat_number", "name", "description", "approximate_page"
2) "character_arcs" — array of main characters with "name", "arc_type", "arc_summary"
3) "pacing_map" — object with "act_breaks" (array of page numbers), "tension_shifts" (array of {page, direction, description})
4) "budget_flags" — array of {flag, description, severity} identifying production cost drivers

Screenplay excerpt:
${excerpt}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "store_artifacts",
                description: "Store derived screenplay artifacts",
                parameters: {
                  type: "object",
                  properties: {
                    beats: { type: "array", items: { type: "object", properties: { beat_number: { type: "number" }, name: { type: "string" }, description: { type: "string" }, approximate_page: { type: "number" } }, required: ["beat_number", "name", "description"] } },
                    character_arcs: { type: "array", items: { type: "object", properties: { name: { type: "string" }, arc_type: { type: "string" }, arc_summary: { type: "string" } }, required: ["name", "arc_type", "arc_summary"] } },
                    pacing_map: { type: "object", properties: { act_breaks: { type: "array", items: { type: "number" } }, tension_shifts: { type: "array", items: { type: "object" } } } },
                    budget_flags: { type: "array", items: { type: "object", properties: { flag: { type: "string" }, description: { type: "string" }, severity: { type: "string" } }, required: ["flag", "description", "severity"] } },
                  },
                  required: ["beats", "character_arcs", "pacing_map", "budget_flags"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "store_artifacts" } },
        }),
      });

      if (artifactResp.ok) {
        const artifactData = await artifactResp.json();
        const toolCall = artifactData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall) {
          const artifacts = JSON.parse(toolCall.function.arguments);
          const artifactRows = [
            { user_id: userId, script_id: scriptId, artifact_type: "beats", json_data: artifacts.beats || [] },
            { user_id: userId, script_id: scriptId, artifact_type: "character_arcs", json_data: artifacts.character_arcs || [] },
            { user_id: userId, script_id: scriptId, artifact_type: "pacing_map", json_data: artifacts.pacing_map || {} },
            { user_id: userId, script_id: scriptId, artifact_type: "budget_flags", json_data: artifacts.budget_flags || [] },
          ];
          const { error: artErr } = await db.from("corpus_derived_artifacts").insert(artifactRows);
          if (artErr) addLog(`Artifact insert warning: ${artErr.message}`);
          else addLog("Derived artifacts stored");
        }
      } else {
        addLog(`Artifact generation failed: ${artifactResp.status}`);
      }
    } catch (artError) {
      addLog(`Artifact generation error: ${artError}`);
    }
  }

  // 9. Mark complete
  addLog("Ingestion complete");
  await db.from("corpus_scripts").update({
    ingestion_status: "complete",
    ingestion_log: log.join("\n"),
    page_count_estimate: pageEstimate,
  }).eq("id", scriptId);

  return new Response(JSON.stringify({ success: true, script_id: scriptId, pages: pageEstimate, scenes: scenes.length, chunks: chunks.length }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Search ────────────────────────────────────────────────────────────

async function handleSearch(
  db: ReturnType<typeof createClient>,
  userId: string,
  params: { query: string; limit?: number },
  cors: Record<string, string>,
) {
  const { query, limit = 10 } = params;
  if (!query) throw new Error("query is required");

  const { data: chunks, error } = await db.rpc("search_corpus_chunks", {
    search_query: query,
    match_count: limit,
    p_user_id: userId,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);

  // Fetch parent script metadata + artifacts for matched scripts
  const scriptIds = [...new Set((chunks || []).map((c: any) => c.script_id))];
  let scripts: any[] = [];
  let artifacts: any[] = [];

  if (scriptIds.length > 0) {
    const [scriptsRes, artifactsRes] = await Promise.all([
      db.from("corpus_scripts").select("id, source_id, page_count_estimate, checksum, approved_sources(title)").in("id", scriptIds),
      db.from("corpus_derived_artifacts").select("*").in("script_id", scriptIds),
    ]);
    scripts = scriptsRes.data || [];
    artifacts = artifactsRes.data || [];
  }

  return new Response(JSON.stringify({ chunks: chunks || [], scripts, artifacts }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractHtmlText(html: string): string {
  // Prefer <pre> blocks (common for screenplay hosting)
  const preMatches = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/gi);
  if (preMatches) {
    const preText = preMatches.map(m => m.replace(/<\/?[^>]+(>|$)/g, "")).join("\n\n");
    if (preText.length > 1000) return preText;
  }
  // Fallback: strip all tags from body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : html;
  return content.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "");
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\0/g, "")
    .trim();
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

interface ParsedScene {
  slugline: string;
  location: string;
  timeOfDay: string;
  text: string;
}

function parseScenes(text: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  const lines = text.split("\n");
  let current: ParsedScene | null = null;
  const slugRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (slugRegex.test(trimmed)) {
      if (current) scenes.push(current);
      const { location, timeOfDay } = parseSlugline(trimmed);
      current = { slugline: trimmed, location, timeOfDay, text: "" };
    }
    if (current) current.text += line + "\n";
  }
  if (current) scenes.push(current);
  return scenes;
}

function parseSlugline(slug: string): { location: string; timeOfDay: string } {
  const parts = slug.split(" - ");
  const location = parts[0]?.replace(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*/i, "").trim() || "";
  const timeOfDay = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  return { location, timeOfDay };
}

function chunkText(text: string, scenes: ParsedScene[]): string[] {
  const TARGET_CHARS = 6000; // ~1500-2000 tokens
  const MAX_CHARS = 10000;
  const chunks: string[] = [];

  if (scenes.length === 0) {
    // No scenes detected — chunk by character count
    for (let i = 0; i < text.length; i += TARGET_CHARS) {
      chunks.push(text.slice(i, i + TARGET_CHARS));
    }
    return chunks;
  }

  let buffer = "";
  for (const scene of scenes) {
    if (buffer.length + scene.text.length > MAX_CHARS && buffer.length > 0) {
      chunks.push(buffer);
      buffer = "";
    }
    buffer += scene.text;
    if (buffer.length >= TARGET_CHARS) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks;
}
