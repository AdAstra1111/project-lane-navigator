import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_PAGES = 300;
const WORDS_PER_PAGE = 250;
const MAX_WORDS = MAX_PAGES * WORDS_PER_PAGE;

interface ExtractionResult {
  text: string;
  totalPages: number | null;
  pagesAnalyzed: number | null;
  status: "success" | "partial" | "failed";
  error: string | null;
}

// ---- Gemini-based PDF extraction (reliable for all PDFs) ----
async function extractPDFWithGemini(data: ArrayBuffer): Promise<ExtractionResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "No API key for AI extraction" };
  }

  const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: "You are a document text extractor. Extract ALL text content from the provided PDF document. Preserve paragraph structure with line breaks. Output ONLY the extracted text, nothing else. No commentary, no summaries, no markdown formatting.",
        },
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename: "document.pdf",
                file_data: `data:application/pdf;base64,${base64}`,
              },
            },
            { type: "text", text: "Extract all text from this PDF document. Output only the raw text content." },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini extraction error:", response.status, errText);
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: `AI extraction failed: ${response.status}` };
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content?.trim() || "";

  if (text.length < 50) {
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "AI could not extract readable text from this PDF" };
  }

  const wordCount = text.split(/\s+/).length;
  const estimatedPages = Math.ceil(wordCount / WORDS_PER_PAGE);

  return {
    text,
    totalPages: estimatedPages,
    pagesAnalyzed: estimatedPages,
    status: "success",
    error: null,
  };
}

// ---- Basic PDF text extraction (for simple uncompressed PDFs) ----
function basicPDFExtract(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [];

  const btBlocks = raw.matchAll(/BT\s([\s\S]*?)ET/g);
  for (const block of btBlocks) {
    const content = block[1];
    const tjMatches = content.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of tjMatches) parts.push(m[1]);
    const tjArrays = content.matchAll(/\[([^\]]*)\]\s*TJ/gi);
    for (const arr of tjArrays) {
      const innerMatches = arr[1].matchAll(/\(([^)]*)\)/g);
      for (const inner of innerMatches) parts.push(inner[1]);
    }
  }

  if (parts.join(" ").length < 200) {
    const generalMatches = raw.matchAll(/\(([^)]{3,})\)/g);
    for (const m of generalMatches) {
      const segment = m[1];
      if (/[a-zA-Z]{2,}/.test(segment) && !/^[\d.]+$/.test(segment)) {
        parts.push(segment);
      }
    }
  }

  return parts
    .map((s) =>
      s.replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGarbageText(text: string): boolean {
  if (text.length < 100) return true;
  // Check if text has a high ratio of non-printable/non-ASCII characters
  const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, "");
  return printable.length / text.length < 0.5;
}

async function extractFromPDF(data: ArrayBuffer): Promise<ExtractionResult> {
  // Try basic extraction first (fast, works for simple PDFs)
  const bytes = new Uint8Array(data);
  const basicText = basicPDFExtract(bytes);

  if (basicText.length >= 200 && !isGarbageText(basicText)) {
    const wordCount = basicText.split(/\s+/).length;
    const estimatedPages = Math.ceil(wordCount / WORDS_PER_PAGE);
    const isPartial = wordCount > MAX_WORDS;
    return {
      text: isPartial ? basicText.split(/\s+/).slice(0, MAX_WORDS).join(" ") : basicText,
      totalPages: estimatedPages,
      pagesAnalyzed: isPartial ? MAX_PAGES : estimatedPages,
      status: isPartial ? "partial" : "success",
      error: null,
    };
  }

  // Basic extraction failed or produced garbage — use Gemini
  console.log("[extract] Basic PDF extraction insufficient, using AI extraction");
  return extractPDFWithGemini(data);
}

async function extractFromDOCX(data: ArrayBuffer): Promise<ExtractionResult> {
  try {
    // @ts-ignore
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(data);
    const docXml = await zip.file("word/document.xml")?.async("text");

    if (!docXml) {
      return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Couldn't read content from this DOCX file." };
    }

    const textParts: string[] = [];
    const paragraphs = docXml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const tMatches = para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      const paraText = Array.from(tMatches).map((m: any) => m[1]).join("");
      if (paraText.trim()) textParts.push(paraText.trim());
    }

    const text = textParts.join("\n");
    if (text.length < 50) {
      return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Couldn't extract enough text from this DOCX file." };
    }

    const wordCount = text.split(/\s+/).length;
    const estimatedPages = Math.ceil(wordCount / WORDS_PER_PAGE);
    const isPartial = wordCount > MAX_WORDS;

    return {
      text: isPartial ? text.split(/\s+/).slice(0, MAX_WORDS).join(" ") : text,
      totalPages: estimatedPages,
      pagesAnalyzed: isPartial ? MAX_PAGES : estimatedPages,
      status: isPartial ? "partial" : "success",
      error: null,
    };
  } catch (err) {
    console.error("DOCX extraction error:", err);
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Failed to parse DOCX file." };
  }
}

function extractFromPlainText(rawText: string): ExtractionResult {
  const text = rawText.trim();
  if (text.length < 20) {
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "File contains too little text." };
  }
  const wordCount = text.split(/\s+/).length;
  const estimatedPages = Math.ceil(wordCount / WORDS_PER_PAGE);
  const isPartial = wordCount > MAX_WORDS;
  return {
    text: isPartial ? text.split(/\s+/).slice(0, MAX_WORDS).join(" ") : text,
    totalPages: estimatedPages,
    pagesAnalyzed: isPartial ? MAX_PAGES : estimatedPages,
    status: isPartial ? "partial" : "success",
    error: null,
  };
}

async function extractTextFromFile(data: Blob, fileName: string): Promise<ExtractionResult> {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (ext === "txt" || ext === "md" || ext === "fountain" || ext === "fdx") {
    const rawText = await data.text();
    return extractFromPlainText(rawText);
  }
  if (ext === "pdf") {
    const buffer = await data.arrayBuffer();
    return extractFromPDF(buffer);
  }
  if (ext === "docx") {
    const buffer = await data.arrayBuffer();
    return extractFromDOCX(buffer);
  }
  return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: `Unsupported file type: .${ext}` };
}

// ---- MAIN HANDLER ----

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const { projectId, documentPaths } = await req.json();
    if (!projectId || !documentPaths?.length) {
      throw new Error("Missing projectId or documentPaths");
    }

    // Validate user has access to this project
    const { data: hasAccess } = await supabase.rpc('has_project_access', {
      _user_id: user.id,
      _project_id: projectId
    });
    if (!hasAccess) throw new Error("Unauthorized: You do not have access to this project");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    interface DocResult {
      file_name: string;
      file_path: string;
      extracted_text: string;
      extraction_status: string;
      total_pages: number | null;
      pages_analyzed: number | null;
      error_message: string | null;
    }

    const docResults: DocResult[] = [];

    for (const path of documentPaths) {
      const fileName = path.split("/").pop() || "document";

      const { data: fileData, error: downloadError } = await adminClient.storage
        .from("project-documents")
        .download(path);

      if (downloadError || !fileData) {
        console.error(`Failed to download ${path}:`, downloadError);
        docResults.push({
          file_name: fileName,
          file_path: path,
          extracted_text: "",
          extraction_status: "failed",
          total_pages: null,
          pages_analyzed: null,
          error_message: `Failed to download: ${downloadError?.message || "Unknown error"}`,
        });
        continue;
      }

      const result = await extractTextFromFile(fileData, fileName);

      // Strip null bytes that PostgreSQL cannot store
      const cleanText = result.text.replace(/\x00/g, '');

      docResults.push({
        file_name: fileName,
        file_path: path,
        extracted_text: cleanText,
        extraction_status: result.status,
        total_pages: result.totalPages,
        pages_analyzed: result.pagesAnalyzed,
        error_message: result.error,
      });
    }

    // Save document records to DB (upsert by file_path to avoid duplicates)
    for (const doc of docResults) {
      const { data: existing } = await adminClient
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("file_path", doc.file_path)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await adminClient
          .from("project_documents")
          .update({
            extracted_text: doc.extracted_text || null,
            extraction_status: doc.extraction_status,
            total_pages: doc.total_pages,
            pages_analyzed: doc.pages_analyzed,
            error_message: doc.error_message,
          })
          .eq("id", existing.id);
        if (updateErr) console.error("Failed to update document record:", updateErr);
      } else {
        const { error: docError } = await adminClient.from("project_documents").insert({
          project_id: projectId,
          user_id: user.id,
          file_name: doc.file_name,
          file_path: doc.file_path,
          extracted_text: doc.extracted_text || null,
          extraction_status: doc.extraction_status,
          total_pages: doc.total_pages,
          pages_analyzed: doc.pages_analyzed,
          error_message: doc.error_message,
        });
        if (docError) console.error("Failed to save document record:", docError);
      }
    }

    // Update project's document_urls array
    const { data: project } = await adminClient
      .from("projects")
      .select("document_urls")
      .eq("id", projectId)
      .single();

    const existingUrls = (project?.document_urls as string[]) || [];
    const newUrls = [...existingUrls, ...documentPaths];

    await adminClient
      .from("projects")
      .update({ document_urls: newUrls })
      .eq("id", projectId);

    return new Response(JSON.stringify({ documents: docResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-documents error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
