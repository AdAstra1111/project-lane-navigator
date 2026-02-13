import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

async function extractFromPDF(data: ArrayBuffer): Promise<ExtractionResult> {
  try {
    // Try pdf.js for reliable extraction
    // @ts-ignore - dynamic esm import
    const pdfjsLib = await import("https://esm.sh/pdfjs-dist@4.8.69/legacy/build/pdf.mjs");

    // Disable worker to avoid workerSrc error in Deno edge runtime
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
      return {
        text: "",
        totalPages,
        pagesAnalyzed: null,
        status: "failed",
        error: "Couldn't read text from this file. Try exporting as a text-based PDF.",
      };
    }

    return {
      text: fullText.replace(/\u0000/g, "").trim(),
      totalPages,
      pagesAnalyzed: pagesToRead,
      status: pagesToRead < totalPages ? "partial" : "success",
      error: null,
    };
  } catch (pdfJsErr) {
    console.warn("pdf.js extraction failed, trying basic fallback:", pdfJsErr);

    // Fallback to basic regex extraction
    const bytes = new Uint8Array(data);
    const text = basicPDFExtract(bytes);

    if (text.length < 50) {
      return {
        text: "",
        totalPages: null,
        pagesAnalyzed: null,
        status: "failed",
        error: "Couldn't read text from this file. Try exporting as a text-based PDF.",
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
  }
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
            error_message: `Failed to download file: ${downloadError?.message || "Unknown error"}`,
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

        if (result.text) {
          combinedText += `\n\n--- ${fileName} ---\n${result.text.replace(/\u0000/g, "")}`;
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

EVIDENCE ANCHORING (CRITICAL):
- For EVERY major conclusion or observation, include 1–2 short quoted snippets or concrete references from the document (under 15 words each).
- This applies to ALL fields: structural_read, creative_signal, market_reality, and the rationale.
- Example: "The protagonist's goal remains unclear for much of Act One ('I just want things to be different') which weakens momentum."

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
