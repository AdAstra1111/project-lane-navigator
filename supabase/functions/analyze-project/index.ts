import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---- CONSTANTS ----
const MAX_PAGES = 200;          // read up to 200 pages
const WORDS_PER_PAGE = 250;
const MAX_WORDS = 25_000;       // hard cap — keeps token count within AI context window
const MAX_CHARS = 400_000;      // character-level safety cap for noisy extractions

const VALID_LANES = [
  "studio-streamer", "independent-film", "low-budget",
  "international-copro", "genre-market", "prestige-awards", "fast-turnaround",
];

// ---- TYPES ----
interface ExtractionResult {
  text: string;
  totalPages: number | null;
  pagesAnalyzed: number | null;
  status: "success" | "partial" | "failed";
  error: string | null;
}

// ---- GARBAGE DETECTION ----
function isGarbageText(text: string): boolean {
  if (text.length < 100) return true;
  const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, "");
  if (printable.length / text.length < 0.5) return true;

  // Detect raw PDF stream data (ASCII85/Flate encoded)
  const streamPatterns = /endstream|endobj|\/Filter|\/FlateDecode|ASCII85Decode|>>\s*stream/gi;
  const streamMatches = text.match(streamPatterns);
  if (streamMatches && streamMatches.length > 3) return true;

  // Check for actual natural-language words (at least 15% of tokens should be real words)
  const words = text.split(/\s+/).filter(w => w.length >= 3);
  const realWords = words.filter(w => /^[a-zA-Z'-]+$/.test(w));
  if (words.length > 20 && realWords.length / words.length < 0.15) return true;

  return false;
}

// ---- TEXT EXTRACTION ----

function basicPDFExtract(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [];

  // Extract text from BT...ET blocks (PDF text operators)
  const btBlocks = raw.matchAll(/BT\s([\s\S]*?)ET/g);
  for (const block of btBlocks) {
    const content = block[1];
    // Tj operator: (text) Tj
    const tjMatches = content.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of tjMatches) parts.push(m[1]);
    // TJ array: [(text) kern (text)] TJ
    const tjArrays = content.matchAll(/\[([^\]]*)\]\s*TJ/gi);
    for (const arr of tjArrays) {
      const innerMatches = arr[1].matchAll(/\(([^)]*)\)/g);
      for (const inner of innerMatches) parts.push(inner[1]);
    }
  }

  // Fallback: general parenthetical strings if BT/ET yields little
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

async function ocrWithGemini(pdfBytes: Uint8Array): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("No API key for OCR");

  // Use Deno's native base64 encoding to avoid stack overflow on large buffers
  const { encodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
  const base64Pdf = encodeBase64(pdfBytes);

  console.log(`[analyze] OCR fallback: sending ${pdfBytes.length} bytes to Gemini Vision`);

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL text from this PDF document. Return ONLY the extracted text content, preserving paragraph structure. Do not add commentary." },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[analyze] Gemini OCR failed:", response.status, errText);
    throw new Error(`OCR failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  console.log(`[analyze] OCR extracted ${text.length} chars`);
  return text.trim();
}

async function extractFromPDF(data: ArrayBuffer): Promise<ExtractionResult> {
  let nativeText = "";
  let totalPages: number | null = null;

  try {
    // Try pdf.js for reliable extraction
    // @ts-ignore - dynamic esm import
    const pdfjsLib = await import("https://esm.sh/pdfjs-dist@4.8.69/legacy/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";

    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
    totalPages = doc.numPages;
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

    nativeText = pageTexts.join("\n\n").replace(/\u0000/g, "").trim();
  } catch (pdfJsErr) {
    console.warn("pdf.js extraction failed, trying basic fallback:", pdfJsErr);
    const bytes = new Uint8Array(data);
    nativeText = basicPDFExtract(bytes);
  }

  // If native extraction yielded good text, use it
  if (nativeText.length >= 50 && !isGarbageText(nativeText)) {
    const wordCount = nativeText.split(/\s+/).length;
    const estimatedPages = totalPages || Math.ceil(wordCount / WORDS_PER_PAGE);
    const pagesToRead = Math.min(estimatedPages, MAX_PAGES);
    const isPartial = wordCount > MAX_WORDS;

    return {
      text: isPartial ? nativeText.split(/\s+/).slice(0, MAX_WORDS).join(" ") : nativeText,
      totalPages: estimatedPages,
      pagesAnalyzed: isPartial ? MAX_PAGES : pagesToRead,
      status: isPartial ? "partial" : "success",
      error: null,
    };
  }

  // OCR fallback: PDF is likely image-based
  console.log(`[analyze] Native extraction too thin (${nativeText.length} chars), trying Gemini OCR...`);
  try {
    const ocrText = await ocrWithGemini(new Uint8Array(data));
    if (ocrText.length >= 50 && !isGarbageText(ocrText)) {
      const wordCount = ocrText.split(/\s+/).length;
      const estimatedPages = totalPages || Math.ceil(wordCount / WORDS_PER_PAGE);
      const isPartial = wordCount > MAX_WORDS;

      return {
        text: isPartial ? ocrText.split(/\s+/).slice(0, MAX_WORDS).join(" ") : ocrText,
        totalPages: estimatedPages,
        pagesAnalyzed: estimatedPages,
        status: isPartial ? "partial" : "success",
        error: null,
      };
    }
  } catch (ocrErr) {
    console.error("[analyze] OCR fallback failed:", ocrErr);
  }

  return {
    text: "",
    totalPages,
    pagesAnalyzed: null,
    status: "failed",
    error: "Couldn't read text from this file. Try exporting as a text-based PDF.",
  };
}

async function extractFromDOCX(data: ArrayBuffer): Promise<ExtractionResult> {
  try {
    // @ts-ignore - dynamic esm import
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(data);
    const docXml = await zip.file("word/document.xml")?.async("text");

    if (!docXml) {
      return {
        text: "",
        totalPages: null,
        pagesAnalyzed: null,
        status: "failed",
        error: "Couldn't read content from this DOCX file.",
      };
    }

    // Extract text from w:t elements, preserving paragraphs
    const textParts: string[] = [];
    const paragraphs = docXml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const tMatches = para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      const paraText = Array.from(tMatches)
        .map((m: any) => m[1])
        .join("");
      if (paraText.trim()) textParts.push(paraText.trim());
    }

    const text = textParts.join("\n");

    if (text.length < 50) {
      return {
        text: "",
        totalPages: null,
        pagesAnalyzed: null,
        status: "failed",
        error: "Couldn't extract enough text from this DOCX file.",
      };
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
    return {
      text: "",
      totalPages: null,
      pagesAnalyzed: null,
      status: "failed",
      error: "Failed to parse DOCX file.",
    };
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

async function extractTextFromFile(
  data: Blob,
  fileName: string
): Promise<ExtractionResult> {
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

  return {
    text: "",
    totalPages: null,
    pagesAnalyzed: null,
    status: "failed",
    error: `Unsupported file type: .${ext}. Accepted formats: PDF, DOCX, TXT, FDX, Fountain.`,
  };
}

// ---- AI ANALYSIS ----

const LANE_DESCRIPTIONS = `
The seven monetisation lanes:
1. "studio-streamer" — Studio / Streamer: Big-budget, wide-audience, major studio or platform play. Typically $15M+, IP-driven, commercial.
2. "independent-film" — Independent Film: Director-driven, artistic vision, $1M–$15M, festival potential, discerning audiences.
3. "low-budget" — Low-Budget / Microbudget: Under $1M, constraint-driven creativity, self-financed, direct-to-platform.
4. "international-copro" — International Co-Production: Multi-territory, treaty structures, international cast, cross-cultural themes.
5. "genre-market" — Genre / Market-Driven: Clear genre (horror, thriller, action), pre-sales driven, genre-audience targeted.
6. "prestige-awards" — Prestige / Awards: Awards-caliber, elevated tone, A-list talent, festival premiere, awards season.
7. "fast-turnaround" — Fast-Turnaround / Trend-Based: Speed-to-market, cultural moment, lean budget, platform-first.
`;

const ANALYSIS_TOOLS = [
  {
    type: "function",
    function: {
      name: "classify_project",
      description:
        "Classify a film/TV project into exactly one monetisation lane with the mandatory 5-step IFFY analysis process. Write like an experienced producer — direct, practical, slightly opinionated. No generic encouragement or vague praise.",
      parameters: {
        type: "object",
        properties: {
          verdict: {
            type: "string",
            description:
              "IFFY Verdict: One decisive sentence summarising the project's status. Examples: 'Worth pursuing with revisions', 'Strong concept, weak execution', 'Market-misaligned in current form'. No hedging.",
          },
          structural_read: {
            type: "object",
            description: "Step 2: Structural analysis adapted to material type. For scripts: format, protagonist, structure, momentum. For decks/treatments/bibles: concept clarity, world-building, character definition, commercial positioning. Always state what type of material you received.",
            properties: {
              format_detected: {
                type: "string",
                description: "Detected material type: feature screenplay, TV pilot script, pitch deck, series bible, treatment, lookbook, one-pager, outline, sizzle concept, budget top-sheet, or combination. Be specific about what you received — this determines how the rest of the analysis is framed.",
              },
              genre_as_written: {
                type: "string",
                description: "The genre as evidenced by the material itself, not what the creator claims. Include short quoted evidence.",
              },
              protagonist_goal_clarity: {
                type: "string",
                description: "For scripts: protagonist definition and goal clarity with evidence. For decks/treatments: character concept strength and emotional hook clarity. For bibles: series-level character arcs and world rules. Adapt to what the material provides.",
              },
              structure_clarity: {
                type: "string",
                description: "For scripts: acts, turning points, pacing with specific moments. For decks: narrative flow, slide logic, commercial argument structure. For treatments: story progression and completeness. For bibles: world coherence and episode potential. State what you CAN and CANNOT assess from this material type.",
              },
            },
            required: ["format_detected", "genre_as_written", "protagonist_goal_clarity", "structure_clarity"],
            additionalProperties: false,
          },
          creative_signal: {
            type: "object",
            description: "Step 3: Creative quality. Evaluate originality of premise, tonal consistency, emotional engine, standout elements. Anchor to specific aspects, not abstractions.",
            properties: {
              originality: {
                type: "string",
                description: "How fresh or derivative the concept and execution are. Reference specific elements with short evidence.",
              },
              tone_consistency: {
                type: "string",
                description: "Whether the tone is controlled and consistent. Cite moments where it works or breaks.",
              },
              emotional_engine: {
                type: "string",
                description: "What drives emotional engagement — character, situation, theme, or spectacle. Be specific.",
              },
              standout_elements: {
                type: "string",
                description: "What people will actually remember — specific scenes, lines, images, or ideas.",
              },
            },
            required: ["originality", "tone_consistency", "emotional_engine", "standout_elements"],
            additionalProperties: false,
          },
          market_reality: {
            type: "object",
            description: "Step 4: Commercial viability. Assess based on execution, not aspirations.",
            properties: {
              likely_audience: {
                type: "string",
                description: "Who will actually watch this based on the execution, not aspirations.",
              },
              comparable_titles: {
                type: "string",
                description: "Real comparable films/shows based on the actual writing, not aspirational comps the creator wishes for.",
              },
              budget_implications: {
                type: "string",
                description: "What the writing/visual ambition implies about minimum viable budget.",
              },
              commercial_risks: {
                type: "string",
                description: "Key risks that could make this hard to finance, sell, or distribute.",
              },
            },
            required: ["likely_audience", "comparable_titles", "budget_implications", "commercial_risks"],
            additionalProperties: false,
          },
          lane: {
            type: "string",
            enum: VALID_LANES,
            description: "Step 1 (determined first): Exactly one Primary Monetisation Lane. This is LOCKED — all subsequent analysis supports or stress-tests this lane.",
          },
          confidence: {
            type: "number",
            description: "Confidence score from 0 to 1 for the lane assignment.",
          },
          rationale: {
            type: "string",
            description:
              "One clear paragraph explaining WHY this lane, referencing specific evidence from the material. Direct, no hedging.",
          },
          do_next: {
            type: "array",
            items: { type: "string" },
            description: "Exactly 3 specific, actionable next steps. Concrete actions, not vague advice.",
          },
          avoid: {
            type: "array",
            items: { type: "string" },
            description: "Exactly 3 specific things to avoid. Concrete warnings, not generic caution.",
          },
          lane_not_suitable: {
            type: "string",
            description:
              "One sentence on which lane this project is NOT suitable for, and why. Example: 'This is unlikely to succeed as a Studio / Streamer project due to scale vs concept density.' Be specific.",
          },
        },
        required: [
          "verdict",
          "structural_read",
          "creative_signal",
          "market_reality",
          "lane",
          "confidence",
          "rationale",
          "do_next",
          "avoid",
          "lane_not_suitable",
        ],
        additionalProperties: false,
      },
    },
  },
];

// ---- MAIN HANDLER ----

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    // Verify user
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const { projectInput, documentPaths } = await req.json();

    // ---- DOWNLOAD & EXTRACT ----
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
    let combinedText = "";

    if (documentPaths && documentPaths.length > 0) {
      // CRITICAL FIX: Prefer pre-extracted text from project_documents table.
      // This avoids re-extracting image-based PDFs that already went through OCR.
      const { data: preExtracted } = await adminClient
        .from("project_documents")
        .select("id, file_name, file_path, plaintext, extracted_text, extraction_status, total_pages, pages_analyzed, error_message, char_count")
        .eq("project_id", projectInput.id || "")
        .in("file_path", documentPaths);

      const preExtractedMap = new Map<string, any>();
      for (const row of (preExtracted || [])) {
        // Accept pre-extracted text OR plaintext as cached source — but reject garbage
        const candidateText = (row.extracted_text && (row.char_count || 0) >= 500)
          ? row.extracted_text
          : (row.plaintext && row.plaintext.length >= 50) ? row.plaintext : null;
        const usableText = candidateText && !isGarbageText(candidateText) ? candidateText : null;
        if (usableText) {
          preExtractedMap.set(row.file_path, { ...row, _usable_text: usableText });
        } else if (candidateText) {
          console.warn(`[analyze] Cached text for ${row.file_name} failed garbage check (${candidateText.length} chars) — will re-extract`);
        }
      }

      for (const path of documentPaths) {
        const fileName = path.split("/").pop() || "document";

        // Use pre-extracted text if available and substantial
        const cached = preExtractedMap.get(path);
        if (cached) {
          const cleanText = (cached._usable_text || "").replace(/\u0000/g, "");
          console.log(`[analyze] Using cached text for ${fileName}: ${cleanText.length} chars`);
          docResults.push({
            file_name: cached.file_name || fileName,
            file_path: path,
            extracted_text: cleanText,
            extraction_status: cached.extraction_status || "success",
            total_pages: cached.total_pages,
            pages_analyzed: cached.pages_analyzed,
            error_message: cached.error_message,
          });
          combinedText += `\n\n--- ${cached.file_name || fileName} ---\n${cleanText}`;
          continue;
        }

        // Fallback: download and extract fresh
        console.log(`[analyze] No cached extraction for ${fileName}, extracting from storage...`);
        const { data: fileData, error: downloadError } = await adminClient.storage
          .from("project-documents")
          .download(path);

        if (downloadError || !fileData) {
          console.warn(`Storage download failed for ${path}:`, downloadError);

          // Fallback: try project_document_versions plaintext
          const { data: docRow } = await adminClient
            .from("project_documents")
            .select("id, file_name")
            .eq("file_path", path)
            .limit(1)
            .maybeSingle();

          if (docRow) {
            const { data: latestVersion } = await adminClient
              .from("project_document_versions")
              .select("plaintext, version_number")
              .eq("document_id", docRow.id)
              .order("version_number", { ascending: false })
              .limit(1)
              .maybeSingle();

            const versionText = latestVersion?.plaintext?.replace(/\u0000/g, "")?.trim() || "";
            if (versionText.length > 20) {
              console.log(`[analyze] Using version plaintext for ${fileName} (v${latestVersion?.version_number}): ${versionText.length} chars`);
              docResults.push({
                file_name: docRow.file_name || fileName,
                file_path: path,
                extracted_text: versionText,
                extraction_status: "success",
                total_pages: Math.ceil(versionText.split(/\s+/).length / WORDS_PER_PAGE),
                pages_analyzed: null,
                error_message: null,
              });
              combinedText += `\n\n--- ${docRow.file_name || fileName} ---\n${versionText}`;
              continue;
            }
          }

          docResults.push({
            file_name: fileName,
            file_path: path,
            extracted_text: "",
            extraction_status: "failed",
            total_pages: null,
            pages_analyzed: null,
            error_message: `Failed to download file: ${downloadError?.message || "Unknown error"}`,
          });
          continue;
        }

        const result = await extractTextFromFile(fileData, fileName);

        // Reject garbage text from fresh extraction
        if (result.text && isGarbageText(result.text)) {
          console.warn(`[analyze] Fresh extraction for ${fileName} produced garbage (${result.text.length} chars) — marking as failed`);
          result.text = "";
          result.status = "failed";
          result.error = "Extracted text appears to be raw PDF data rather than readable content. Try re-uploading or exporting as a text-based PDF.";
        }

        docResults.push({
          file_name: fileName,
          file_path: path,
          extracted_text: result.text,
          extraction_status: result.status,
          total_pages: result.totalPages,
          pages_analyzed: result.pagesAnalyzed,
          error_message: result.error,
        });

        if (result.text) {
          combinedText += `\n\n--- ${fileName} ---\n${result.text.replace(/\u0000/g, "")}`;
        }
      }
    }

    // ---- DEV-ENGINE DOCS: Pull content from project_document_versions for docs without file_path ----
    if (projectInput.id) {
      const { data: devDocs } = await adminClient
        .from("project_documents")
        .select("id, file_name, doc_type")
        .eq("project_id", projectInput.id)
        .or("file_path.is.null,file_path.eq.");

      if (devDocs && devDocs.length > 0) {
        // Filter out docs we already processed via documentPaths
        const processedNames = new Set(docResults.map(d => d.file_name));
        const unprocessed = devDocs.filter(d => !processedNames.has(d.file_name));

        for (const doc of unprocessed) {
          // Get latest version's plaintext
          const { data: latestVersion } = await adminClient
            .from("project_document_versions")
            .select("plaintext, version_number")
            .eq("document_id", doc.id)
            .order("version_number", { ascending: false })
            .limit(1)
            .single();

          const text = latestVersion?.plaintext?.replace(/\u0000/g, "")?.trim() || "";
          if (text.length > 20) {
            console.log(`[analyze] Dev-engine doc "${doc.file_name}" (v${latestVersion?.version_number}): ${text.length} chars`);
            docResults.push({
              file_name: doc.file_name || "document",
              file_path: "",
              extracted_text: text,
              extraction_status: "success",
              total_pages: Math.ceil(text.split(/\s+/).length / WORDS_PER_PAGE),
              pages_analyzed: null,
              error_message: null,
            });
            combinedText += `\n\n--- ${doc.file_name} (${doc.doc_type || "document"}) ---\n${text}`;
          }
        }
      }
    }

    // Cap total text at MAX_CHARS first (catches noisy extractions), then MAX_WORDS
    if (combinedText.length > MAX_CHARS) {
      combinedText = combinedText.slice(0, MAX_CHARS);
    }
    const allWords = combinedText.trim().split(/\s+/);
    let partialRead: { pages_analyzed: number; total_pages: number } | null = null;

    if (allWords.length > MAX_WORDS) {
      combinedText = allWords.slice(0, MAX_WORDS).join(" ");
      const totalEstimated = Math.ceil(allWords.length / WORDS_PER_PAGE);
      partialRead = { pages_analyzed: Math.min(MAX_PAGES, totalEstimated), total_pages: totalEstimated };
    }

    // ---- SAFETY GUARD: Block AI if extracted text is too thin ----
    const totalCharCount = combinedText.trim().length;
    const hasDocumentPaths = documentPaths && documentPaths.length > 0;
    if (hasDocumentPaths && totalCharCount < 1500) {
      console.warn(`[analyze] BLOCKED: Only ${totalCharCount} chars extracted from ${documentPaths.length} files. Too thin for reliable analysis.`);
      return new Response(JSON.stringify({
        error: "extraction_too_thin",
        message: "The uploaded document(s) yielded too little text for reliable analysis. This usually means the PDF is image-based. Please re-extract using the ✨ button or upload a text-based export.",
        char_count: totalCharCount,
        documents: docResults,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasDocumentText = combinedText.trim().length > 50;

    // ---- PRODUCTION TYPE CONDITIONING ----
    const FORMAT_CONDITIONING: Record<string, string> = {
      film: 'This is a NARRATIVE FEATURE FILM. Evaluate through the lens of theatrical/streaming distribution, festival strategy, pre-sales potential, and traditional film financing structures. Do NOT reference series concepts, brand clients, ad revenue, or digital-first metrics.',
      'tv-series': 'This is a NARRATIVE TV SERIES. Evaluate through the lens of platform/broadcaster commissioning, showrunner strength, series engine sustainability, multi-season potential, and per-episode economics. Do NOT reference theatrical distribution, one-off film financing, or brand clients.',
      documentary: 'This is a DOCUMENTARY FEATURE. Evaluate through the lens of subject access exclusivity, grant funding eligibility, broadcaster/streamer fit, impact campaign potential, and rights clearance. Do NOT reference narrative cast packaging, fictional script structure, or commercial brand clients.',
      'documentary-series': 'This is a DOCUMENTARY SERIES. Evaluate through the lens of multi-episode storytelling, broadcaster/platform commissioning, subject access sustainability, per-episode economics, and impact campaign potential. Do NOT reference narrative cast packaging, fictional scripts, or commercial brand clients.',
      commercial: 'This is a COMMERCIAL / ADVERTISEMENT. Evaluate through the lens of client brief alignment, production margin, director fit, brand guidelines compliance, usage rights, and deliverables matrix. Do NOT reference film financing, festival strategy, equity, pre-sales, or streaming deals.',
      'branded-content': 'This is BRANDED CONTENT. Evaluate through the lens of brand story alignment, cultural authenticity, platform amplification potential, audience engagement, and long-tail IP value. Do NOT reference traditional film financing, festival strategy, equity, pre-sales, or broadcaster commissioning.',
      'short-film': 'This is a SHORT FILM. Evaluate through the lens of festival circuit strategy, talent showcase potential, proof-of-concept viability, and IP expansion possibilities. Do NOT reference feature film financing structures, pre-sales, equity, gap financing, or commercial brand clients.',
      'music-video': 'This is a MUSIC VIDEO. Evaluate through the lens of visual storytelling, artist brand alignment, label/commissioner relationship, director treatment strength, and social media release strategy. Do NOT reference film financing, festival strategy, equity, pre-sales, or broadcasting deals.',
      'proof-of-concept': 'This is a PROOF OF CONCEPT. Evaluate through the lens of IP demonstration potential, feature/series development viability, investor pitch readiness, and technical showcase quality. This is NOT a finished product. Do NOT reference distribution, sales, or recoupment.',
      'digital-series': 'This is a DIGITAL / SOCIAL SERIES. Evaluate through the lens of platform-native audience growth, content scalability, brand integration potential, subscriber/ad revenue models, and algorithm optimization. Do NOT reference traditional film/TV financing, theatrical distribution, or festival strategy.',
      hybrid: 'This is a HYBRID project spanning multiple formats or media types. Evaluate through the lens of cross-platform storytelling, transmedia potential, innovation fund eligibility, and experiential audience engagement. Be flexible with financing and distribution models.',
    };
    
    const formatContext = FORMAT_CONDITIONING[projectInput.format] || FORMAT_CONDITIONING.film;

    // ---- BUILD AI PROMPT ----
    const systemPrompt = `You are IFFY, an opinionated internal development executive for film and TV producers.
Your role is to assess projects based on their actual execution, not marketing intent, and to make clear, defensible judgements about market positioning.

PRODUCTION TYPE CONTEXT (CRITICAL — governs your entire analysis):
${formatContext}

DOCUMENT TYPE AWARENESS (CRITICAL):
A project can be started with ANY type of material — a full screenplay, a pitch deck, a series bible, a treatment, a lookbook, a one-pager, a sizzle concept, or even just a bare idea with no documents. You must:
1. IDENTIFY what type of document(s) you've received (screenplay, pitch deck, treatment, series bible, lookbook, one-pager, outline, budget top-sheet, etc.)
2. ADAPT your analysis depth to what the material actually provides. A pitch deck gives you commercial positioning and visual tone but NOT structural screenplay analysis. A treatment gives you story arc but NOT dialogue quality. A series bible gives you world-building and character depth but NOT episode-level structure.
3. NEVER assume a document is a script unless it clearly IS one (contains scene headings, dialogue, action lines in screenplay format).
4. EXPLICITLY STATE what type of material you received and what that allows you to assess vs. what remains unknown.
5. ACKNOWLEDGE what's missing — if you only have a deck, say "Without a script, I cannot assess dialogue quality or scene-level structure, but the deck reveals..."

When documents are provided, your analysis must be based PRIMARILY on the extracted document text. User-entered form data is secondary and used only to fill gaps or identify inconsistencies.

${LANE_DESCRIPTIONS}

ANALYSIS PROCESS (MANDATORY ORDER):
Step 1 — Determine Primary Monetisation Lane (FIRST, ONCE ONLY). Based on the material as written/presented, assign exactly one lane. Do not reconsider or change this lane later.
Step 2 — Structural Read: Adapt to material type. For scripts: format clarity, protagonist + goal clarity, act progression, narrative momentum. For decks/treatments/bibles: concept clarity, world-building depth, character definition, commercial positioning. Reference concrete evidence from whatever material is present.
Step 3 — Creative Signal: Originality of premise, tonal consistency, emotional engine, standout elements. Anchor conclusions to specific aspects found in the actual material.
Step 4 — Market Reality Check: Likely audience based on execution, comparable titles (execution-based, not aspirational), budget implications, commercial risks.
Step 5 — Decision Output (LOCKED TO PRIMARY LANE): All conclusions must support or stress-test the Primary Lane. Provide confidence, rationale, 3 DO NEXT, 3 AVOID, and which lane this is NOT suitable for.

EVIDENCE ANCHORING (CRITICAL — HALLUCINATION GUARD):
- You MUST extract only information EXPLICITLY PRESENT in the provided text.
- For EVERY major conclusion or observation, include 1–2 short quoted snippets copied VERBATIM from the document (under 15 words each).
- This applies to ALL fields: structural_read, creative_signal, market_reality, and the rationale.
- Example: "The protagonist's goal remains unclear for much of Act One ('I just want things to be different') which weakens momentum."
- If a piece of information is NOT explicitly stated in the document, say so. Do NOT infer, fabricate, or fill gaps creatively.
- If the document doesn't contain enough information for a field, state: "The document does not contain enough information to determine this."

NO HALLUCINATION RULE (ABSOLUTE):
- Do NOT fabricate plot details, character names, themes, or story elements not present in the text.
- Do NOT infer subject matter from the title alone.
- If the text is sparse or ambiguous, your analysis MUST reflect that uncertainty.
- Confidence score MUST be lowered proportionally when working with limited text.

CONSISTENCY CHECK (REQUIRED):
Before finalising output, ensure the verdict, lane, risks, and recommendations do not contradict each other. If contradictions exist, resolve them in favour of the Primary Monetisation Lane.

TONE:
- Direct, practical, slightly opinionated.
- Speak like an experienced producer who's read 10,000 scripts.
- If something is weak, say so clearly. If something is strong, say exactly why.
- Avoid generic encouragement, vague praise, or academic language.

${hasDocumentText ? "- Base your assessment PRIMARILY on the uploaded document content. The material itself determines the lane. Form inputs are secondary context only.\n- If the user's form inputs (genre, tone, audience, budget, comparables) CONTRADICT what the document actually shows, EXPLICITLY call out the discrepancy. Be specific about what the form says vs. what the page shows." : "- No documents were uploaded. Assess based on form inputs, but note limitations in your verdict."}
${partialRead ? `- NOTE: Only the first ~${partialRead.pages_analyzed} pages of an estimated ${partialRead.total_pages} total pages were provided. State this in your structural read.` : ""}`;

    const userMessage = `Classify this project.

FORM INPUTS:
- Title: ${projectInput.title}
- Format: ${projectInput.format}
- Genres: ${projectInput.genres?.join(", ") || "Not specified"}
- Budget Range: ${projectInput.budget_range || "Not specified"}
- Target Audience: ${projectInput.target_audience || "Not specified"}
- Tone: ${projectInput.tone || "Not specified"}
- Comparable Titles: ${projectInput.comparable_titles || "Not specified"}

${hasDocumentText ? `UPLOADED MATERIAL:\n${combinedText}` : "No documents uploaded. Classify based on form inputs only."}`;

    console.log(
      `Analyzing "${projectInput.title}": ${docResults.length} files, ${allWords.length} words extracted, partial=${!!partialRead}`
    );

    // ---- CALL AI ----
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: ANALYSIS_TOOLS,
        tool_choice: { type: "function", function: { name: "classify_project" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error(`AI gateway returned ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();

    // Extract from tool call response
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let result;

    if (toolCall?.function?.arguments) {
      const args = typeof toolCall.function.arguments === "string"
        ? toolCall.function.arguments
        : JSON.stringify(toolCall.function.arguments);
      try {
        result = JSON.parse(args);
      } catch (parseErr) {
        console.error("Failed to parse tool call arguments:", args);
        throw new Error("Failed to parse AI analysis response");
      }
    } else {
      // Fallback: try to parse from message content
      const rawContent = aiData.choices?.[0]?.message?.content || "";
      let cleaned = rawContent.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      try {
        result = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse AI response:", rawContent);
        throw new Error("Failed to parse AI classification response");
      }
    }

    // Validate lane
    if (!VALID_LANES.includes(result.lane)) {
      console.error("Invalid lane returned:", result.lane);
      throw new Error(`Invalid lane: ${result.lane}`);
    }

    // Ensure arrays have exactly 3 items
    result.do_next = (result.do_next || []).slice(0, 3);
    result.avoid = (result.avoid || []).slice(0, 3);

    // Add metadata
    result.partial_read = partialRead;
    result.documents = docResults;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-project error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
