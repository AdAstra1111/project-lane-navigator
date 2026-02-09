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

// ---- TYPES ----
interface ExtractionResult {
  text: string;
  totalPages: number | null;
  pagesAnalyzed: number | null;
  status: "success" | "partial" | "failed";
  error: string | null;
}

// ---- TEXT EXTRACTION (same as analyze-project) ----

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

async function extractFromPDF(data: ArrayBuffer): Promise<ExtractionResult> {
  try {
    // @ts-ignore
    const pdfjsLib = await import("https://esm.sh/pdfjs-dist@4.8.69/legacy/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";

    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
    const totalPages = doc.numPages;
    const pagesToRead = Math.min(totalPages, MAX_PAGES);

    const pageTexts: string[] = [];
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item: any) => "str" in item)
        .map((item: any) => item.str)
        .join(" ");
      pageTexts.push(text);
    }

    const fullText = pageTexts.join("\n\n");
    if (fullText.trim().length < 50) {
      return { text: "", totalPages, pagesAnalyzed: null, status: "failed", error: "Couldn't read text from this file." };
    }

    return {
      text: fullText.trim(),
      totalPages,
      pagesAnalyzed: pagesToRead,
      status: pagesToRead < totalPages ? "partial" : "success",
      error: null,
    };
  } catch (pdfJsErr) {
    console.warn("pdf.js failed, trying basic fallback:", pdfJsErr);
    const bytes = new Uint8Array(data);
    const text = basicPDFExtract(bytes);

    if (text.length < 50) {
      return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Couldn't read text from this file." };
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

      docResults.push({
        file_name: fileName,
        file_path: path,
        extracted_text: result.text,
        extraction_status: result.status,
        total_pages: result.totalPages,
        pages_analyzed: result.pagesAnalyzed,
        error_message: result.error,
      });
    }

    // Save document records to DB
    for (const doc of docResults) {
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
