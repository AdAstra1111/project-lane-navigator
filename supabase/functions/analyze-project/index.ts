import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LANE_DEFINITIONS = `
The seven monetisation lanes are:
1. "studio-streamer" — Studio / Streamer: Big-budget, wide-audience projects suited for major studios or streaming platforms (Netflix, HBO, Disney+). Typically $15M+ budgets, IP-driven, commercially oriented.
2. "independent-film" — Independent Film: Director-driven projects with artistic vision, moderate budgets ($1M–$15M), festival potential, aimed at discerning/arthouse audiences.
3. "low-budget" — Low-Budget / Microbudget: Under $1M, constraints as creative assets, self-financed or micro-investor funded, direct-to-platform distribution.
4. "international-copro" — International Co-Production: Multi-territory stories, treaty co-production structures, international cast/locations, cross-cultural themes.
5. "genre-market" — Genre / Market-Driven: Clear genre identity (horror, thriller, action), pre-sales driven, built for genre audiences and market screenings.
6. "prestige-awards" — Prestige / Awards: Awards-caliber material, elevated tone, A-list talent potential, festival premiere strategy, designed for awards season.
7. "fast-turnaround" — Fast-Turnaround / Trend-Based: Speed-to-market projects riding cultural moments, trending topics, lean budgets, platform-first distribution.
`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const { projectInput, documentPaths } = await req.json();

    // Download and extract text from uploaded documents
    let documentContent = "";
    if (documentPaths && documentPaths.length > 0) {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      for (const path of documentPaths) {
        const { data: fileData, error: downloadError } = await adminClient
          .storage
          .from("project-documents")
          .download(path);

        if (downloadError) {
          console.error(`Failed to download ${path}:`, downloadError);
          continue;
        }

        const fileName = path.split("/").pop() || "document";
        const ext = fileName.split(".").pop()?.toLowerCase();

        if (ext === "txt" || ext === "fdx" || ext === "fountain" || ext === "md") {
          const text = await fileData.text();
          documentContent += `\n\n--- DOCUMENT: ${fileName} ---\n${text}`;
        } else if (ext === "pdf") {
          // For PDF, attempt to extract text content
          const arrayBuffer = await fileData.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          // Simple PDF text extraction - extract text between stream markers
          const rawText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          // Extract readable text segments
          const textSegments: string[] = [];
          const matches = rawText.matchAll(/\(([^)]+)\)/g);
          for (const match of matches) {
            const segment = match[1].replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
            if (segment.length > 2 && /[a-zA-Z]/.test(segment)) {
              textSegments.push(segment);
            }
          }
          const extractedText = textSegments.join(" ");
          if (extractedText.length > 50) {
            documentContent += `\n\n--- DOCUMENT: ${fileName} ---\n${extractedText}`;
          } else {
            documentContent += `\n\n--- DOCUMENT: ${fileName} ---\n[PDF content could not be fully extracted. Text may be image-based. Working with available metadata and form inputs.]`;
          }
        } else {
          // For other file types, try text extraction
          try {
            const text = await fileData.text();
            if (text.length > 20 && /[a-zA-Z]/.test(text)) {
              documentContent += `\n\n--- DOCUMENT: ${fileName} ---\n${text}`;
            }
          } catch {
            documentContent += `\n\n--- DOCUMENT: ${fileName} ---\n[Could not extract text from this file format.]`;
          }
        }
      }
    }

    const hasDocuments = documentContent.trim().length > 0;

    const systemPrompt = `You are IFFY, an expert film and TV development executive and market analyst. You assess creative projects and classify them into monetisation lanes.

${LANE_DEFINITIONS}

You MUST respond with a valid JSON object using this exact structure:
{
  "passes": {
    "structure": {
      "title": "Structural Analysis",
      "summary": "2-3 sentence summary of narrative structure findings",
      "signals": ["signal 1", "signal 2", "signal 3"]
    },
    "creative": {
      "title": "Creative Signal",
      "summary": "2-3 sentence summary of creative/artistic qualities",
      "signals": ["signal 1", "signal 2", "signal 3"]
    },
    "market": {
      "title": "Market Reality",
      "summary": "2-3 sentence summary of market positioning and commercial prospects",
      "signals": ["signal 1", "signal 2", "signal 3"]
    }
  },
  "lane": "one of the seven lane IDs exactly as listed above",
  "confidence": 0.0 to 1.0,
  "reasoning": "A detailed 3-5 sentence explanation of WHY this lane was chosen, referencing specific evidence from the material",
  "recommendations": [
    { "category": "Packaging", "title": "short title", "description": "actionable advice" },
    { "category": "Finance", "title": "short title", "description": "actionable advice" },
    { "category": "Strategy", "title": "short title", "description": "actionable advice" },
    { "category": "Market", "title": "short title", "description": "actionable advice" }
  ]
}

${hasDocuments ? `CRITICAL: Base your assessment PRIMARILY on the uploaded document content. The document IS the project — analyze the actual writing, structure, dialogue, tone, and execution on the page. Form inputs are secondary context only. The material itself determines the lane.` : `No documents were uploaded. Base your assessment on the form inputs provided.`}

Respond ONLY with the JSON object. No markdown, no code fences, no explanatory text.`;

    const userMessage = `Analyze this project:

FORM INPUTS:
- Title: ${projectInput.title}
- Format: ${projectInput.format}
- Genres: ${projectInput.genres?.join(", ") || "Not specified"}
- Budget Range: ${projectInput.budget_range || "Not specified"}
- Target Audience: ${projectInput.target_audience || "Not specified"}
- Tone: ${projectInput.tone || "Not specified"}
- Comparable Titles: ${projectInput.comparable_titles || "Not specified"}

${hasDocuments ? `UPLOADED MATERIAL:\n${documentContent}` : "No documents uploaded."}

Perform your three-pass analysis (structure, creative signal, market reality) and return the classification.`;

    console.log(`Analyzing project "${projectInput.title}" with ${documentPaths?.length || 0} documents`);

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
    const rawContent = aiData.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error("No content in AI response");
    }

    // Parse the JSON response, handling potential markdown fences
    let cleaned = rawContent.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", cleaned);
      throw new Error("Failed to parse AI classification response");
    }

    // Validate required fields
    const validLanes = [
      "studio-streamer", "independent-film", "low-budget",
      "international-copro", "genre-market", "prestige-awards", "fast-turnaround"
    ];
    if (!validLanes.includes(result.lane)) {
      throw new Error(`Invalid lane: ${result.lane}`);
    }

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
