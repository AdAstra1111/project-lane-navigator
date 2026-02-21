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
const MIN_CHAR_THRESHOLD = 1500; // Below this, PDF is likely image-based

interface ExtractionResult {
  text: string;
  totalPages: number | null;
  pagesAnalyzed: number | null;
  status: "success" | "partial" | "failed" | "needs_ocr";
  error: string | null;
  sourceType: "pdf_text" | "ocr" | "docx" | "plain";
}

// ---- Gemini-based PDF extraction / OCR (reliable for all PDFs) ----
async function extractPDFWithGemini(data: ArrayBuffer, isOCR: boolean = false): Promise<ExtractionResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "No API key for AI extraction", sourceType: "ocr" };
  }

  const bytes = new Uint8Array(data);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);

  const ocrInstruction = isOCR
    ? "This PDF appears to be image-based. Use OCR to read all visible text from each page image, including headers, body text, captions, labels, and any text embedded in graphics or diagrams."
    : "";

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are a document text extractor. Extract ALL text content from the provided PDF document. ${ocrInstruction} Preserve paragraph structure with line breaks. Output ONLY the extracted text, nothing else. No commentary, no summaries, no markdown formatting. Do NOT infer, fabricate, or add any content that is not visually present on the pages.`,
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
            { type: "text", text: `Extract all text from this PDF document. ${isOCR ? "This is an image-based/graphic-heavy PDF — use OCR to read all visible text from every page." : "Output only the raw text content."}` },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 65000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini extraction error:", response.status, errText);
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: `AI extraction failed: ${response.status}`, sourceType: "ocr" };
  }

  const result = await response.json();
  const text = (result.choices?.[0]?.message?.content?.trim() || "").replace(/\u0000/g, "");

  if (text.length < 50) {
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "AI could not extract readable text from this PDF", sourceType: "ocr" };
  }

  const wordCount = text.split(/\s+/).length;
  const estimatedPages = Math.ceil(wordCount / WORDS_PER_PAGE);

  return {
    text,
    totalPages: estimatedPages,
    pagesAnalyzed: estimatedPages,
    status: "success",
    error: null,
    sourceType: isOCR ? "ocr" : "pdf_text",
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
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGarbageText(text: string): boolean {
  if (text.length < 100) return true;
  const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, "");
  if (printable.length / text.length < 0.5) return true;

  // Detect raw PDF stream data (ASCII85/Flate encoded) that passed printable check
  const streamPatterns = /endstream|endobj|\/Filter|\/FlateDecode|ASCII85Decode|>>\s*stream/gi;
  const streamMatches = text.match(streamPatterns);
  if (streamMatches && streamMatches.length > 3) return true;

  // Check for actual natural-language words (at least 10% of tokens should be real words)
  const words = text.split(/\s+/).filter(w => w.length >= 3);
  const realWords = words.filter(w => /^[a-zA-Z'-]+$/.test(w));
  if (words.length > 20 && realWords.length / words.length < 0.15) return true;

  return false;
}

async function extractFromPDF(data: ArrayBuffer): Promise<ExtractionResult> {
  // Primary: Use Gemini for reliable extraction from all PDF types
  console.log(`[extract] Using Gemini as primary PDF extractor`);
  const geminiResult = await extractPDFWithGemini(data, false);

  if (geminiResult.status === "success" && geminiResult.text.length >= MIN_CHAR_THRESHOLD) {
    console.log(`[extract] Gemini extraction OK: ${geminiResult.text.length} chars`);
    return geminiResult;
  }

  // If Gemini returned some text but below threshold, try OCR mode
  if (geminiResult.status !== "success" || geminiResult.text.length < MIN_CHAR_THRESHOLD) {
    console.log(`[extract] Gemini standard extraction insufficient (${geminiResult.text.length} chars), trying OCR mode`);
    const ocrResult = await extractPDFWithGemini(data, true);
    if (ocrResult.status === "success" && ocrResult.text.length >= MIN_CHAR_THRESHOLD) {
      return ocrResult;
    }
  }

  // Fallback: basic extraction (for when Gemini is unavailable)
  const bytes = new Uint8Array(data);
  const basicText = basicPDFExtract(bytes);
  if (basicText.length >= MIN_CHAR_THRESHOLD && !isGarbageText(basicText)) {
    const wordCount = basicText.split(/\s+/).length;
    const estimatedPages = Math.ceil(wordCount / WORDS_PER_PAGE);
    const isPartial = wordCount > MAX_WORDS;
    console.log(`[extract] Basic PDF fallback: ${basicText.length} chars, ${wordCount} words`);
    return {
      text: isPartial ? basicText.split(/\s+/).slice(0, MAX_WORDS).join(" ") : basicText,
      totalPages: estimatedPages,
      pagesAnalyzed: isPartial ? MAX_PAGES : estimatedPages,
      status: isPartial ? "partial" : "success",
      error: null,
      sourceType: "pdf_text",
    };
  }

  // Everything failed
  return geminiResult.text.length > 0 ? geminiResult : {
    text: "", totalPages: null, pagesAnalyzed: null,
    status: "failed", error: "Could not extract readable text from this PDF",
    sourceType: "pdf_text",
  };
}

async function extractFromDOCX(data: ArrayBuffer): Promise<ExtractionResult> {
  try {
    // @ts-ignore
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(data);
    const docXml = await zip.file("word/document.xml")?.async("text");

    if (!docXml) {
      return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Couldn't read content from this DOCX file.", sourceType: "docx" };
    }

    const textParts: string[] = [];
    const paragraphs = docXml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const tMatches = para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      const paraText = Array.from(tMatches).map((m: any) => m[1]).join("");
      if (paraText.trim()) textParts.push(paraText.trim());
    }

    const text = textParts.join("\n").replace(/\u0000/g, "");
    if (text.length < 50) {
      return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Couldn't extract enough text from this DOCX file.", sourceType: "docx" };
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
      sourceType: "docx",
    };
  } catch (err) {
    console.error("DOCX extraction error:", err);
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "Failed to parse DOCX file.", sourceType: "docx" };
  }
}

function extractFromPlainText(rawText: string): ExtractionResult {
  const text = rawText.trim().replace(/\u0000/g, "");
  if (text.length < 20) {
    return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: "File contains too little text.", sourceType: "plain" };
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
    sourceType: "plain",
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
  return { text: "", totalPages: null, pagesAnalyzed: null, status: "failed", error: `Unsupported file type: .${ext}`, sourceType: "plain" };
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

    const body = await req.json();
    const { projectId, documentPaths: rawPaths } = body;
    if (!projectId || !rawPaths?.length) {
      throw new Error("Missing projectId or documentPaths");
    }
    // Filter out empty paths (dev-engine docs have no file_path)
    const documentPaths = (rawPaths as string[]).filter(p => p && p.trim() !== '');

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
      source_type: string;
      char_count: number;
    }

    const docResults: DocResult[] = [];

    for (const path of documentPaths) {
      const fileName = path.split("/").pop() || "document";

      const { data: fileData, error: downloadError } = await adminClient.storage
        .from("project-documents")
        .download(path);

      if (downloadError || !fileData) {
        console.error(`Failed to download ${path}:`, downloadError);
        const failResult: DocResult = {
          file_name: fileName,
          file_path: path,
          extracted_text: "",
          extraction_status: "failed",
          total_pages: null,
          pages_analyzed: null,
          error_message: `Failed to download: ${downloadError?.message || "Unknown error"}`,
          source_type: "pdf_text",
          char_count: 0,
        };
        docResults.push(failResult);

        // Log ingestion
        await adminClient.from("document_ingestions").insert({
          project_id: projectId,
          user_id: user.id,
          file_path: path,
          source_type: "pdf_text",
          char_count: 0,
          pages_processed: null,
          status: "failed",
          error: failResult.error_message,
        });
        continue;
      }

      const result = await extractTextFromFile(fileData, fileName);
      const cleanText = result.text.replace(/\x00/g, "");
      const charCount = cleanText.trim().length;

      // Determine ingestion status
      let ingestionStatus = "ok";
      if (result.status === "failed") {
        ingestionStatus = "failed";
      } else if (charCount < MIN_CHAR_THRESHOLD && result.sourceType !== "ocr") {
        ingestionStatus = "needs_ocr";
      } else if (result.sourceType === "ocr") {
        ingestionStatus = charCount >= 1000 ? "ocr_success" : "failed";
      }

      // If needs_ocr and we haven't already done OCR, the extractFromPDF already handles this
      // But log the final state
      const finalStatus = ingestionStatus === "needs_ocr" ? "failed" : result.status;
      const finalError = ingestionStatus === "needs_ocr"
        ? "Text extraction yielded too little content. The PDF may be image-based. Please upload a text-based export or PPTX."
        : result.error;

      docResults.push({
        file_name: fileName,
        file_path: path,
        extracted_text: cleanText,
        extraction_status: finalStatus === "needs_ocr" ? "failed" : (finalStatus as string),
        total_pages: result.totalPages,
        pages_analyzed: result.pagesAnalyzed,
        error_message: finalError,
        source_type: result.sourceType,
        char_count: charCount,
      });

      // Log to document_ingestions
      await adminClient.from("document_ingestions").insert({
        project_id: projectId,
        user_id: user.id,
        file_path: path,
        source_type: result.sourceType,
        char_count: charCount,
        pages_processed: result.pagesAnalyzed,
        status: ingestionStatus,
        error: finalError,
      });

      console.log(`[extract] ${fileName}: source=${result.sourceType}, chars=${charCount}, status=${ingestionStatus}`);
    }

    // Read the doc_type passed from the client (single source of truth)
    const docType = body.docType || "document";

    // Save document records to DB (upsert by file_path)
    for (const doc of docResults) {
      const { data: existing } = await adminClient
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("file_path", doc.file_path)
        .maybeSingle();

      const docRecord = {
        extracted_text: doc.extracted_text || null,
        extraction_status: doc.extraction_status,
        total_pages: doc.total_pages,
        pages_analyzed: doc.pages_analyzed,
        error_message: doc.error_message,
        ingestion_source: doc.source_type,
        char_count: doc.char_count,
        doc_type: docType,
      };

      if (existing) {
        const { error: updateErr } = await adminClient
          .from("project_documents")
          .update(docRecord)
          .eq("id", existing.id);
        if (updateErr) console.error("Failed to update document record:", updateErr);
      } else {
        const { error: docError } = await adminClient.from("project_documents").insert({
          project_id: projectId,
          user_id: user.id,
          file_name: doc.file_name,
          file_path: doc.file_path,
          ...docRecord,
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
