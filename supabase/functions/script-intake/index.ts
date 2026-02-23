import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/* ── helpers ── */

async function callLLM(messages: any[], tools?: any[], tool_choice?: any) {
  const body: any = {
    model: "google/gemini-2.5-flash",
    messages,
    temperature: 0.3,
  };
  if (tools) { body.tools = tools; body.tool_choice = tool_choice; }

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429) throw new Error("RATE_LIMIT");
    if (resp.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`AI error ${resp.status}: ${t}`);
  }

  const json = await resp.json();
  
  // Handle gateway errors that come back as 200 with error body
  if (json.error) {
    const errMsg = json.error?.message || JSON.stringify(json.error);
    const code = json.error?.code;
    console.error("AI gateway error in response body:", errMsg, "code:", code);
    if (code === 524) throw new Error("AI provider timeout - PDF may be too large. Try a smaller file.");
    throw new Error(`AI error: ${errMsg}`);
  }
  
  // If tool call, parse arguments
  const choice = json.choices?.[0];
  if (choice?.message?.tool_calls?.[0]) {
    const args = choice.message.tool_calls[0].function.arguments;
    return JSON.parse(args);
  }
  // Otherwise return content
  return choice?.message?.content || "";
}

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error } = await anonClient.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}

/* ── pdf text extraction helpers ── */

async function nativeExtractPages(arrayBuffer: ArrayBuffer): Promise<{ pageNumber: number; text: string }[]> {
  try {
    // @ts-ignore - dynamic esm import
    const pdfjsLib = await import("https://esm.sh/pdfjs-dist@4.8.69/legacy/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const results: { pageNumber: number; text: string }[] = [];
    const totalPages = Math.min(doc.numPages, 200);

    for (let i = 1; i <= totalPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item: any) => "str" in item)
        .map((item: any) => item.str)
        .join(" ")
        .trim();
      results.push({ pageNumber: i, text });
    }
    return results;
  } catch (err) {
    console.warn("[script-intake] pdf.js extraction failed:", err);
    return [];
  }
}

async function ocrPdfChunkWithGemini(base64Pdf: string, startPage: number, endPage: number): Promise<{ pageNumber: number; text: string }[]> {
  const result = await callLLM(
    [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:application/pdf;base64,${base64Pdf}` },
          },
          {
            type: "text",
            text: `Extract ALL text from pages ${startPage} to ${endPage} of this PDF. For each page in that range, provide the page number and full text content. Use the extract_pdf_pages tool.`,
          },
        ],
      },
    ],
    [
      {
        type: "function",
        function: {
          name: "extract_pdf_pages",
          description: "Return extracted pages from a PDF",
          parameters: {
            type: "object",
            properties: {
              pages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    page_number: { type: "integer" },
                    text: { type: "string" },
                  },
                  required: ["page_number", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["pages"],
            additionalProperties: false,
          },
        },
      },
    ],
    { type: "function", function: { name: "extract_pdf_pages" } }
  );

  return (result.pages || []).map((p: any) => ({ pageNumber: p.page_number, text: p.text || "" }));
}

async function ocrPdfWithGemini(bytes: Uint8Array, totalPages: number): Promise<{ pageNumber: number; text: string }[]> {
  const { encodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");

  const totalSizeMB = bytes.length / (1024 * 1024);
  console.log(`[script-intake] OCR fallback: ${totalSizeMB.toFixed(1)}MB PDF, ${totalPages} pages`);

  const base64Pdf = encodeBase64(bytes);

  // Process in chunks of ~10 pages to avoid timeouts
  const CHUNK_SIZE = 10;
  const allPages: { pageNumber: number; text: string }[] = [];
  const pageCount = totalPages || 20; // fallback estimate

  for (let start = 1; start <= pageCount; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, pageCount);
    console.log(`[script-intake] OCR chunk: pages ${start}-${end}`);
    try {
      const chunkPages = await ocrPdfChunkWithGemini(base64Pdf, start, end);
      allPages.push(...chunkPages);
    } catch (err: any) {
      console.error(`[script-intake] OCR chunk ${start}-${end} failed:`, err.message);
      // Add empty pages for this chunk so we don't lose page numbering
      for (let p = start; p <= end; p++) {
        allPages.push({ pageNumber: p, text: "" });
      }
    }
  }

  return allPages;
}

/* ── action: ingest_pdf ── */
async function ingestPdf(
  supabase: any,
  { projectId, storagePath, documentId, versionId }: any
) {
  // Download PDF from storage
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("scripts")
    .download(storagePath);
  if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);

  const arrayBuffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Step 1: Try native text extraction first (fast, no AI needed)
  console.log(`[script-intake] Attempting native PDF extraction (${(bytes.length / 1024 / 1024).toFixed(1)}MB)...`);
  let pages = await nativeExtractPages(arrayBuffer);

  // Check quality — if most pages are empty, fall back to OCR
  const goodPages = pages.filter(p => p.text.length > 30);
  const nativeQuality = pages.length > 0 ? goodPages.length / pages.length : 0;
  console.log(`[script-intake] Native extraction: ${goodPages.length}/${pages.length} pages with text (quality: ${(nativeQuality * 100).toFixed(0)}%)`);

  if (nativeQuality < 0.5) {
    // PDF is likely image-based — use Gemini Vision OCR
    console.log(`[script-intake] Low native quality, falling back to Gemini OCR...`);
    try {
      pages = await ocrPdfWithGemini(bytes, pages.length || 20);
      console.log(`[script-intake] OCR extracted ${pages.length} pages`);
    } catch (ocrErr: any) {
      console.error("[script-intake] OCR fallback failed:", ocrErr.message);
      // If we had some native pages, use those rather than failing completely
      if (goodPages.length > 0) {
        console.log(`[script-intake] Using partial native extraction (${goodPages.length} pages)`);
        pages = goodPages.map(p => ({ ...p }));
      } else {
        throw new Error("Could not extract text from this PDF. It may be a scanned document — try exporting as a text-based PDF.");
      }
    }
  }

  // Step 2: Detect scenes from extracted text (lightweight AI call on text only, not the PDF)
  const fullText = pages.map(p => `[PAGE ${p.pageNumber}]\n${p.text}`).join("\n\n");
  const cappedForScenes = fullText.slice(0, 60000); // Scene detection doesn't need full text

  let titleGuess = "Untitled";
  let scenes: any[] = [];

  try {
    const sceneResult = await callLLM(
      [
        {
          role: "system",
          content: "You are a screenplay parser. Detect the title and scene headings from screenplay text. Be precise with page numbers.",
        },
        {
          role: "user",
          content: `Parse this screenplay text for the title and scene headings:\n\n${cappedForScenes}\n\nUse the parse_scenes tool.`,
        },
      ],
      [
        {
          type: "function",
          function: {
            name: "parse_scenes",
            description: "Parse title and scene headings from screenplay text",
            parameters: {
              type: "object",
              properties: {
                title_guess: { type: "string" },
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      scene_number: { type: "string" },
                      heading: { type: "string" },
                      page_start: { type: "integer" },
                      page_end: { type: "integer" },
                    },
                    required: ["heading", "page_start"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["title_guess", "scenes"],
              additionalProperties: false,
            },
          },
        },
      ],
      { type: "function", function: { name: "parse_scenes" } }
    );
    titleGuess = sceneResult.title_guess || "Untitled";
    scenes = sceneResult.scenes || [];
  } catch (sceneErr: any) {
    console.warn("[script-intake] Scene parsing failed (non-fatal):", sceneErr.message);
  }

  // Step 3: Store pages in script_pdf_pages
  if (pages.length > 0) {
    const rows = pages.map((p) => ({
      project_id: projectId,
      document_id: documentId,
      version_id: versionId,
      page_number: p.pageNumber,
      page_text: p.text || "",
    }));

    const { error: insertErr } = await supabase
      .from("script_pdf_pages")
      .insert(rows);
    if (insertErr) console.error("Page insert error:", insertErr);
  }

  // Store full plaintext on the version
  const plaintextFull = pages.map(p => p.text).join("\n\n--- PAGE BREAK ---\n\n");
  await supabase
    .from("project_document_versions")
    .update({ plaintext: plaintextFull })
    .eq("id", versionId);

  // Update extraction run
  await supabase.from("script_extraction_runs").insert({
    project_id: projectId,
    script_version_id: versionId,
    status: "completed",
    output: { title_guess: titleGuess, page_count: pages.length, scenes },
  });

  return {
    pageCount: pages.length,
    titleGuess,
    scenes: scenes.slice(0, 100),
  };
}

/* ── action: generate_coverage ── */
async function generateCoverage(
  supabase: any,
  { projectId, scriptVersionId }: any
) {
  // Load pages
  const { data: pages } = await supabase
    .from("script_pdf_pages")
    .select("page_number, page_text")
    .eq("version_id", scriptVersionId)
    .order("page_number", { ascending: true });

  if (!pages || pages.length === 0) throw new Error("No pages found for this script version");

  // Build script text with page markers
  const scriptText = pages
    .map((p: any) => `[PAGE ${p.page_number}]\n${p.page_text}`)
    .join("\n\n");

  // Cap at ~180k chars for context
  const cappedText = scriptText.slice(0, 180000);

  const result = await callLLM(
    [
      {
        role: "system",
        content: `You are a professional script coverage analyst. You provide thorough, evidence-based screenplay coverage. 

CLAIMS POLICY:
- Every non-trivial claim MUST cite a page number.
- If a claim cannot be backed by a direct quote + page, mark it as assumption=true and confidence=low.
- Be specific and reference actual character names, scenes, and dialogue.
- Never invent plot points or character details not present in the script.`,
      },
      {
        role: "user",
        content: `Provide full professional coverage of this screenplay. The script text includes [PAGE X] markers for reference.

${cappedText}

Generate coverage using the output_coverage tool.`,
      },
    ],
    [
      {
        type: "function",
        function: {
          name: "output_coverage",
          description: "Output structured screenplay coverage with evidence",
          parameters: {
            type: "object",
            properties: {
              loglines: {
                type: "array",
                items: { type: "string" },
                description: "3 logline options",
              },
              one_page_synopsis: { type: "string" },
              full_synopsis: { type: "string" },
              comments: { type: "string", description: "Reader's overall comments" },
              strengths: {
                type: "array",
                items: { type: "string" },
              },
              weaknesses: {
                type: "array",
                items: { type: "string" },
              },
              market_positioning: {
                type: "object",
                properties: {
                  comps: { type: "array", items: { type: "string" } },
                  audience: { type: "string" },
                  platform_fit: { type: "string" },
                  budget_band: { type: "string" },
                  risks: { type: "array", items: { type: "string" } },
                },
                required: ["comps", "audience", "platform_fit", "budget_band", "risks"],
                additionalProperties: false,
              },
              craft_structure: {
                type: "object",
                properties: {
                  act_breakdown: { type: "string" },
                  turning_points: { type: "array", items: { type: "string" } },
                  pacing_notes: { type: "string" },
                  character_arcs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        character: { type: "string" },
                        arc: { type: "string" },
                        page_refs: { type: "array", items: { type: "integer" } },
                      },
                      required: ["character", "arc"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["act_breakdown", "turning_points", "pacing_notes", "character_arcs"],
                additionalProperties: false,
              },
              scene_notes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scene_heading: { type: "string" },
                    page: { type: "integer" },
                    note: { type: "string" },
                    strength_or_issue: { type: "string" },
                  },
                  required: ["scene_heading", "page", "note"],
                  additionalProperties: false,
                },
                description: "Notes for top 30+ scenes",
              },
              scorecard: {
                type: "object",
                properties: {
                  premise: { type: "integer", description: "1-10" },
                  structure: { type: "integer" },
                  characters: { type: "integer" },
                  dialogue: { type: "integer" },
                  originality: { type: "integer" },
                  commercial_viability: { type: "integer" },
                  overall: { type: "integer" },
                  recommendation: {
                    type: "string",
                    description: "PASS / CONSIDER / RECOMMEND",
                  },
                },
                required: ["premise", "structure", "characters", "dialogue", "originality", "commercial_viability", "overall", "recommendation"],
                additionalProperties: false,
              },
              evidence_map: {
                type: "object",
                description: "Key claims mapped to page references and quotes",
                additionalProperties: {
                  type: "object",
                  properties: {
                    quote: { type: "string" },
                    page: { type: "integer" },
                    confidence: { type: "string" },
                    assumption: { type: "boolean" },
                  },
                  required: ["quote", "page", "confidence", "assumption"],
                  additionalProperties: false,
                },
              },
              confidence_summary: {
                type: "object",
                properties: {
                  overall: { type: "string" },
                  sections: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
                required: ["overall"],
                additionalProperties: false,
              },
            },
            required: [
              "loglines",
              "one_page_synopsis",
              "full_synopsis",
              "comments",
              "strengths",
              "weaknesses",
              "market_positioning",
              "craft_structure",
              "scene_notes",
              "scorecard",
              "evidence_map",
              "confidence_summary",
            ],
            additionalProperties: false,
          },
        },
      },
    ],
    { type: "function", function: { name: "output_coverage" } }
  );

  return result;
}

/* ── action: backfill_docs ── */
async function backfillDocs(
  supabase: any,
  { projectId, scriptVersionId, docTypes }: any
) {
  // Load pages
  const { data: pages } = await supabase
    .from("script_pdf_pages")
    .select("page_number, page_text")
    .eq("version_id", scriptVersionId)
    .order("page_number", { ascending: true });

  if (!pages || pages.length === 0) throw new Error("No pages found");

  const scriptText = pages
    .map((p: any) => `[PAGE ${p.page_number}]\n${p.page_text}`)
    .join("\n\n")
    .slice(0, 150000);

  const docTypeDescriptions: Record<string, string> = {
    idea: "A concise project idea statement (2-3 paragraphs) capturing the core concept, unique hook, and why now.",
    concept_brief: "A 1-2 page concept brief covering premise, tone, target audience, key themes, and unique selling points.",
    market_sheet: "A market positioning sheet with comps, target buyers, budget range, audience demographics, and platform strategy.",
    blueprint: "A series/project bible covering world rules, tone document, season structure, episode format, and narrative engine.",
    architecture: "Story architecture document covering act structure, key turning points, thematic throughlines, and narrative design.",
    character_bible: "Character bible with full profiles for all major characters including backstory, motivation, arc, relationships, and voice notes.",
    beat_sheet: "A detailed beat sheet covering all major story beats with page references, scene descriptions, and emotional trajectory.",
  };

  const requestedTypes = (docTypes || []).filter(
    (t: string) => t in docTypeDescriptions
  );

  const results = [];

  for (const docType of requestedTypes) {
    try {
      const result = await callLLM(
        [
          {
            role: "system",
            content: `You are a development executive deriving a "${docType}" document from a screenplay.

RULES:
- ONLY include information that is directly supported by the script text.
- For every claim, include page references.
- If you must infer something not explicitly stated, mark it as an assumption with low confidence.
- Never hallucinate backstory, world rules, or character details not in the script.
- The document should be in professional markdown format.`,
          },
          {
            role: "user",
            content: `From this screenplay, generate a "${docType}" document.

Description: ${docTypeDescriptions[docType]}

Script:
${scriptText}

Use the output_backfill_doc tool.`,
          },
        ],
        [
          {
            type: "function",
            function: {
              name: "output_backfill_doc",
              description: "Output a backfilled development document",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content_markdown: { type: "string" },
                  evidence_map: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: {
                        quote: { type: "string" },
                        page: { type: "integer" },
                        confidence: { type: "string" },
                        assumption: { type: "boolean" },
                      },
                      required: ["quote", "page", "confidence", "assumption"],
                      additionalProperties: false,
                    },
                  },
                  confidence_summary: {
                    type: "object",
                    properties: {
                      overall: { type: "string" },
                      note: { type: "string" },
                    },
                    required: ["overall"],
                    additionalProperties: false,
                  },
                },
                required: ["title", "content_markdown", "evidence_map", "confidence_summary"],
                additionalProperties: false,
              },
            },
          },
        ],
        { type: "function", function: { name: "output_backfill_doc" } }
      );

      results.push({ docType, ...result });
    } catch (err: any) {
      results.push({
        docType,
        title: docType,
        content_markdown: "",
        evidence_map: {},
        confidence_summary: { overall: "failed" },
        error: err.message,
      });
    }
  }

  return results;
}

/* ── action: save_backfilled_doc ── */
async function saveBackfilledDoc(
  supabase: any,
  userId: string,
  {
    projectId,
    docType,
    title,
    content_markdown,
    sourceScriptVersionId,
    evidence_map,
    confidence_summary,
    approve,
  }: any
) {
  // Check if document of this type exists
  const { data: existingDoc } = await supabase
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .maybeSingle();

  let documentId: string;

  if (existingDoc) {
    documentId = existingDoc.id;
  } else {
    const { data: newDoc, error: docErr } = await supabase
      .from("project_documents")
      .insert({
        project_id: projectId,
        user_id: userId,
        doc_type: docType,
        title: title || docType,
        file_name: `${title || docType}.md`,
        file_path: `${projectId}/${docType}_backfill.md`,
        extraction_status: "completed",
        source: "script_backfill",
      })
      .select("id")
      .single();
    if (docErr) throw new Error(`Doc create failed: ${docErr.message}`);
    documentId = newDoc.id;
  }

  // Get next version number
  const { data: maxVer } = await supabase
    .from("project_document_versions")
    .select("version_number")
    .eq("document_id", documentId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (maxVer?.version_number || 0) + 1;

  const { data: version, error: verErr } = await supabase
    .from("project_document_versions")
    .insert({
      document_id: documentId,
      created_by: userId,
      version_number: nextVersion,
      plaintext: content_markdown,
      label: `Derived from script`,
      deliverable_type: docType,
      inputs_used: {
        derivation_method: "script_backfill_v1",
        source_script_version_id: sourceScriptVersionId,
        evidence_map,
        confidence_summary,
      },
      approval_status: approve ? "approved" : "pending",
      approved_at: approve ? new Date().toISOString() : null,
      approved_by: approve ? userId : null,
    })
    .select("id")
    .single();

  if (verErr) throw new Error(`Version create failed: ${verErr.message}`);

  // Update latest_version_id on document
  await supabase
    .from("project_documents")
    .update({ latest_version_id: version.id })
    .eq("id", documentId);

  return { documentId, versionId: version.id };
}

/* ── main handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const userId = await verifyUser(req);
    const body = await req.json();
    const { action } = body;
    const supabase = getServiceClient();

    let result: any;

    switch (action) {
      case "ingest_pdf":
        result = await ingestPdf(supabase, body);
        break;
      case "generate_coverage":
        result = await generateCoverage(supabase, body);
        break;
      case "backfill_docs":
        result = await backfillDocs(supabase, body);
        break;
      case "save_backfilled_doc":
        result = await saveBackfilledDoc(supabase, userId, body);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("script-intake error:", err);
    const status = err.message === "RATE_LIMIT" ? 429 : err.message === "PAYMENT_REQUIRED" ? 402 : err.message === "Unauthorized" ? 401 : 500;
    return new Response(
      JSON.stringify({ error: err.message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
