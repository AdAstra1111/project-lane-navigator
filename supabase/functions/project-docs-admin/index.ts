import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Blank template (used ONLY as fallback if no project context exists) ───
const TOPLINE_TEMPLATE_STUB = `# TOPLINE NARRATIVE

## LOGLINE

[Add your logline here]

## SHORT SYNOPSIS

[Add your short synopsis here]

## LONG SYNOPSIS

[Add your long synopsis here]

## STORY PILLARS

- Theme:
- Protagonist:
- Goal:
- Stakes:
- Antagonistic force:
- Setting:
- Tone:
- Comps:
`;

// ─── Placeholder detection ───
const PLACEHOLDER_PATTERNS = [
  /\[\s*1[–-]2 sentences\s*\]/i,
  /\[\s*150[–-]300 words\s*\]/i,
  /\[\s*~?1[–-]2 pages\s*\]/i,
  /\[\s*Theme:\s*\]/i,
  /\[\s*Protagonist:\s*\]/i,
  /\[\s*Write 1[–-]2 sentences\s/i,
  /\[\s*core thematic\s/i,
  /\[\s*name,\s*role\s/i,
];

function hasPlaceholders(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(text));
}

// ─── LLM ───
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callLLM(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Build topline from project context ───
async function generateToplineContent(
  sb: any,
  projectId: string,
  apiKey: string,
): Promise<{ content: string; inputsUsed: string[] }> {
  // Load project metadata
  const { data: project } = await sb
    .from("projects")
    .select("title, format, pipeline_stage")
    .eq("id", projectId)
    .single();

  const projectTitle = project?.title || "Untitled";
  const projectFormat = project?.format || "film";

  // Load source documents in priority order
  const SOURCE_DOC_TYPES = [
    "idea", "idea_brief", "concept_brief",
    "market_sheet", "vertical_market_sheet", "blueprint",
  ];

  const { data: docs } = await sb
    .from("project_documents")
    .select("id, doc_type, latest_version_id")
    .eq("project_id", projectId)
    .in("doc_type", SOURCE_DOC_TYPES);

  const versionIds = (docs || [])
    .filter((d: any) => d.latest_version_id)
    .map((d: any) => d.latest_version_id);

  if (versionIds.length === 0) {
    // No source docs — return empty string to signal failure
    return { content: "", inputsUsed: [] };
  }

  const { data: versions } = await sb
    .from("project_document_versions")
    .select("id, document_id, plaintext")
    .in("id", versionIds);

  const versionMap = new Map((versions || []).map((v: any) => [v.id, v]));

  let projectFactsBlock = "";
  const inputsUsed: string[] = [];

  for (const doc of (docs || [])) {
    const ver = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
    if (ver?.plaintext) {
      const excerpt = (ver.plaintext as string).slice(0, 3000);
      projectFactsBlock += `\n\n--- ${doc.doc_type.toUpperCase()} ---\n${excerpt}`;
      inputsUsed.push(ver.id);
    }
  }

  const isSeries = projectFormat.toLowerCase().includes("series") ||
    projectFormat.toLowerCase().includes("drama") ||
    projectFormat.toLowerCase().includes("vertical");

  const system = [
    `You are a senior script editor generating a TOPLINE NARRATIVE document for a ${projectFormat} project.`,
    `Project title: "${projectTitle}"`,
    ``,
    `## OUTPUT FORMAT (USE EXACTLY)`,
    ``,
    `# TOPLINE NARRATIVE`,
    ``,
    `## LOGLINE`,
    `[1–2 sentences — write your actual logline here]`,
    ``,
    `## SHORT SYNOPSIS`,
    `[150–300 words — actual synopsis here]`,
    ``,
    `## LONG SYNOPSIS`,
    `[~1–2 pages — full story arc here]`,
    ``,
    `## STORY PILLARS`,
    `- Theme: [actual theme]`,
    `- Protagonist: [name and role]`,
    `- Goal: [concrete objective]`,
    `- Stakes: [specific consequence]`,
    `- Antagonistic force: [person/system/conflict]`,
    `- Setting: [world and era]`,
    `- Tone: [descriptors and comps]`,
    `- Comps: [2–3 real titles with rationale]`,
    isSeries
      ? `\n## SERIES ONLY\n- Series promise / engine: [the repeating engine]\n- Season arc snapshot: [what changes EP1→finale]`
      : "",
    ``,
    `## CRITICAL RULES`,
    `1. FILL EVERY SECTION with project-specific content from the PROJECT FACTS below.`,
    `2. NEVER output bracket placeholders like [1–2 sentences] or [Theme:] in the final text — replace them with REAL content.`,
    `3. NEVER repeat these instructions in your output.`,
    `4. Begin your response DIRECTLY with "# TOPLINE NARRATIVE". No preamble, no commentary.`,
    `5. If a field is not in the source docs, synthesize a plausible answer from what IS available.`,
  ].filter(Boolean).join("\n");

  const userPrompt = `PROJECT FACTS for "${projectTitle}":\n${projectFactsBlock}\n\nGenerate the full Topline Narrative now. Replace every bracket placeholder with project-specific content.`;

  let content = await callLLM(apiKey, system, userPrompt);

  // Validate — retry once if placeholders remain
  if (hasPlaceholders(content)) {
    const retrySystem = system +
      `\n\n⚠️ RETRY: Your previous output contained literal bracket placeholders. These are FORBIDDEN. Every bracket must be replaced with real project-specific text.`;
    content = await callLLM(apiKey, retrySystem, userPrompt);
  }

  // If still has placeholders after retry, throw
  if (hasPlaceholders(content)) {
    throw new Error(
      "template_not_filled: Generated content still contains unfilled template placeholders after retry.",
    );
  }

  // Clean up Output Contract header if AI added it
  content = content
    .replace(/^Deliverable Type:.*?\n/gim, "")
    .replace(/^Completion Status:.*?\n/gim, "")
    .replace(/^Completeness Check:.*?\n/gim, "");

  // Ensure correct heading
  if (!content.trimStart().startsWith("# TOPLINE NARRATIVE")) {
    const match = content.match(/(#\s*TOPLINE NARRATIVE[\s\S]*)/i);
    if (match) content = match[1];
  }

  return { content, inputsUsed };
}

// ─── Ensure topline doc (idempotent) ───
async function ensureToplineDoc(
  sb: any,
  projectId: string,
  userId: string,
  apiKey: string | undefined,
): Promise<{ documentId: string; versionId: string; created: boolean; generated: boolean }> {
  // Idempotent: check if topline doc already exists
  const { data: existing } = await sb
    .from("project_documents")
    .select("id, latest_version_id")
    .eq("project_id", projectId)
    .eq("doc_type", "topline_narrative")
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      documentId: existing[0].id,
      versionId: existing[0].latest_version_id,
      created: false,
      generated: false,
    };
  }

  // Try to generate AI content if we have an API key and source docs
  let plaintext = TOPLINE_TEMPLATE_STUB;
  let label = "Initial template";
  let generated = false;

  if (apiKey) {
    try {
      const { content, inputsUsed } = await generateToplineContent(sb, projectId, apiKey);
      if (content && inputsUsed.length > 0) {
        plaintext = content;
        label = "AI-generated from project context";
        generated = true;
        console.log("[project-docs-admin] Topline generated from", inputsUsed.length, "source docs");
      } else {
        console.log("[project-docs-admin] No source docs found — using stub template");
      }
    } catch (err: any) {
      console.error("[project-docs-admin] LLM generation failed:", err.message);
      // Fall through to template stub
    }
  }

  // Create project_documents row
  const { data: doc, error: docErr } = await sb
    .from("project_documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      doc_type: "topline_narrative",
      title: "Topline Narrative",
      file_name: "topline_narrative.md",
      file_path: `${projectId}/topline_narrative.md`,
    })
    .select("id")
    .single();

  if (docErr) throw new Error(`Failed to create topline doc: ${docErr.message}`);

  // Create initial version
  const { data: version, error: verErr } = await sb
    .from("project_document_versions")
    .insert({
      document_id: doc.id,
      version_number: 1,
      plaintext,
      created_by: userId,
      label,
      deliverable_type: "topline_narrative",
    })
    .select("id")
    .single();

  if (verErr) throw new Error(`Failed to create topline version: ${verErr.message}`);

  // Set latest_version_id
  await sb
    .from("project_documents")
    .update({ latest_version_id: version.id })
    .eq("id", doc.id);

  return { documentId: doc.id, versionId: version.id, created: true, generated };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const sb = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: claimsErr } = await anonClient.auth.getUser(token);
    if (claimsErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id as string;

    const { action, projectId } = await req.json();
    if (!projectId) throw new Error("projectId required");

    // Verify project access
    const { data: project } = await sb
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();
    if (!project) throw new Error("Project not found");

    const isOwner = project.user_id === userId;
    if (!isOwner) {
      const { data: collab } = await sb
        .from("project_collaborators")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .eq("status", "accepted")
        .limit(1);
      if (!collab?.length) throw new Error("Access denied");
    }

    if (action === "ensure-topline") {
      const result = await ensureToplineDoc(sb, projectId, userId, apiKey);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
