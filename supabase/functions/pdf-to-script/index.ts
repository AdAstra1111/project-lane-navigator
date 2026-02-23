/**
 * pdf-to-script — Extract plaintext from a script_pdf document and create a
 * project_documents + project_document_versions row with doc_type='script'.
 *
 * POST { projectId }
 * Returns { documentId, versionId, title, chars, message }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { callLLM, MODELS } from "../_shared/llm.ts";

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
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000))
    throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const EXTRACTION_PROMPT = `You are a screenplay text extraction specialist.
Extract the COMPLETE screenplay/script text from this PDF accurately.

REQUIREMENTS:
- Preserve ALL scene headings (sluglines like INT./EXT.)
- Preserve ALL character names and dialogue
- Preserve ALL action/description lines
- Preserve ALL parentheticals
- Maintain the original formatting structure as plaintext
- Do NOT summarize or abbreviate — extract the FULL text
- Output ONLY the extracted screenplay text, no commentary

Begin extraction:`;

/**
 * Try LLM extraction using inline PDF base64 (input_file modality).
 * Falls back to signed-URL text prompt if gateway rejects input_file.
 */
async function extractViaLLM(
  apiKey: string,
  pdfBase64: string,
  signedUrl: string | null,
): Promise<string> {
  const systemMsg = "You are a document text extraction specialist. Extract the full text from the provided PDF accurately and completely. Output only the extracted text.";

  // Modality attempts: input_file, then file, then signed-URL text fallback
  const modalities = [
    { type: "input_file", input_file: { mime_type: "application/pdf", data: pdfBase64 } },
    { type: "file", file: { mime_type: "application/pdf", data: pdfBase64 } },
  ];

  for (const attachment of modalities) {
    try {
      const resp = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODELS.PRO,
          messages: [
            { role: "system", content: systemMsg },
            {
              role: "user",
              content: [
                { type: "text", text: EXTRACTION_PROMPT },
                attachment,
              ],
            },
          ],
          temperature: 0.05,
          max_tokens: 32000,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || "";
        if (text.length >= 500) return text;
        console.warn(`${attachment.type} extraction too short (${text.length} chars), trying next`);
      } else {
        console.warn(`${attachment.type} modality rejected (${resp.status}), trying next`);
      }
    } catch (e) {
      console.warn(`${attachment.type} extraction failed:`, e);
    }
  }

  // Strategy 2: text-only prompt with signed URL
  if (!signedUrl) {
    throw new Error("PDF extraction failed and no signed URL available for fallback");
  }

  const result = await callLLM({
    apiKey,
    model: MODELS.PRO,
    system: "You are a document text extraction specialist. Extract the full text from the provided PDF URL accurately and completely. Output only the extracted text.",
    user: `${EXTRACTION_PROMPT}\n\nPDF document URL (download and extract text from this): ${signedUrl}`,
    temperature: 0.05,
    maxTokens: 32000,
    retries: 2,
  });

  return result.content || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      userId = parseUserId(token);
    } catch {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { projectId } = body;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const admin = adminClient();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI key not configured" }, 500);

    // 1) Lookup project title
    const { data: project } = await admin
      .from("projects")
      .select("id, title")
      .eq("id", projectId)
      .single();
    if (!project) return json({ error: "Project not found" }, 404);

    // 2) Find newest script_pdf document
    const { data: pdfDoc } = await admin
      .from("project_documents")
      .select("id, title, file_path, storage_path")
      .eq("project_id", projectId)
      .eq("doc_type", "script_pdf")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!pdfDoc)
      return json(
        { error: "No script_pdf document found for this project. Upload a PDF script first." },
        400
      );

    // 3) Determine storage path
    const storagePath = pdfDoc.storage_path || pdfDoc.file_path;
    if (!storagePath)
      return json({ error: "No storage path found for the PDF document" }, 400);

    // 4) Download PDF bytes from storage
    // Try 'scripts' bucket first (where useScriptIntake uploads), then 'project-documents' fallback
    let fileData: Blob | null = null;
    let dlError: any = null;
    for (const bucket of ["scripts", "project-documents"]) {
      const result = await admin.storage.from(bucket).download(storagePath);
      if (!result.error && result.data) {
        fileData = result.data;
        dlError = null;
        break;
      }
      dlError = result.error;
    }

    if (dlError || !fileData) {
      console.error("PDF download error:", dlError);
      return json({ error: "Failed to download PDF: " + (dlError?.message || "unknown") }, 500);
    }

    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    const pdfBase64 = encodeBase64(pdfBytes);

    // 5) Create signed URL for fallback strategy
    let signedUrl: string | null = null;
    for (const bucket of ["scripts", "project-documents"]) {
      try {
        const { data: signedData } = await admin.storage
          .from(bucket)
          .createSignedUrl(storagePath, 600);
        if (signedData?.signedUrl) { signedUrl = signedData.signedUrl; break; }
      } catch (e) {
        console.warn("Signed URL creation failed (non-fatal):", e);
      }
    }

    // 6) Extract text via LLM (inline base64 first, signed URL fallback)
    const extractedText = await extractViaLLM(apiKey, pdfBase64, signedUrl);

    if (!extractedText || extractedText.length < 500) {
      return json(
        { error: `Extraction produced only ${extractedText.length} characters (minimum 500 required). The PDF may be image-only, empty, or corrupted.` },
        400
      );
    }

    // 7) Create project_documents row with ONLY safe/known columns
    const docTitle = `${project.title} — Trailer Source Script`;
    const { data: newDoc, error: docErr } = await admin
      .from("project_documents")
      .insert({
        project_id: projectId,
        user_id: userId,
        doc_type: "script",
        title: docTitle,
        file_name: "trailer-source-script.txt",
      })
      .select("id")
      .single();

    if (docErr || !newDoc) {
      console.error("Doc insert error:", docErr);
      return json({ error: "Failed to create document: " + (docErr?.message || "unknown") }, 500);
    }

    // 8) Create project_document_versions row — plaintext stored HERE
    // Try with content field first, fallback without it
    let newVersion: any = null;
    let verErr: any = null;

    const baseVersionInsert = {
      document_id: newDoc.id,
      version_number: 1,
      plaintext: extractedText,
      created_by: userId,
      is_current: true,
      label: "Extracted from PDF",
      approval_status: "draft",
    };

    // Attempt 1: with content field
    const attempt1 = await admin
      .from("project_document_versions")
      .insert({ ...baseVersionInsert, content: extractedText })
      .select("id")
      .single();

    if (attempt1.error) {
      // Attempt 2: without content field (in case column doesn't exist)
      console.warn("Version insert with content failed, retrying without:", attempt1.error.message);
      const attempt2 = await admin
        .from("project_document_versions")
        .insert(baseVersionInsert)
        .select("id")
        .single();
      newVersion = attempt2.data;
      verErr = attempt2.error;
    } else {
      newVersion = attempt1.data;
    }

    if (verErr || !newVersion) {
      console.error("Version insert error:", verErr);
      // Clean up the doc we just created
      await admin.from("project_documents").delete().eq("id", newDoc.id);
      return json({ error: "Failed to create version: " + (verErr?.message || "unknown") }, 500);
    }

    // 9) Update latest_version_id on the document (if column exists)
    const { error: lvErr } = await admin
      .from("project_documents")
      .update({ latest_version_id: newVersion.id })
      .eq("id", newDoc.id);
    if (lvErr && !lvErr.message.includes("does not exist")) {
      console.error("latest_version_id update error:", lvErr);
    }

    return json({
      documentId: newDoc.id,
      versionId: newVersion.id,
      title: docTitle,
      chars: extractedText.length,
      message: `Extracted ${extractedText.length.toLocaleString()} characters from PDF "${pdfDoc.title}".`,
    });
  } catch (err) {
    console.error("pdf-to-script error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
});
