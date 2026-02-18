import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ideaText } = await req.json();

    if (!ideaText || ideaText.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Idea text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- AI parse using tool calling for reliable structured output ---
    const systemPrompt = `You are a film/TV development executive assistant. Given a free-text idea from a producer, extract structured project metadata and call the extract_project_metadata function with the results. Be generous in your interpretation — extract whatever you can from the text and use sensible defaults for missing fields.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: ideaText.slice(0, 4000) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_project_metadata",
              description: "Extract structured film/TV project metadata from a free-text idea.",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short project title, infer from idea if not explicit" },
                  format: { type: "string", enum: ["film", "series", "documentary", "short", "podcast", "book_adaptation"] },
                  genres: { type: "array", items: { type: "string" }, description: "1-4 genres e.g. Drama, Thriller" },
                  budget_range: { type: "string", enum: ["$0–$500K", "$500K–$2M", "$2M–$10M", "$10M–$50M", "$50M+"] },
                  target_audience: { type: "string", description: "e.g. Adult 25–54, Young Adult 18–34, Family, Niche/Specialist" },
                  tone: { type: "string", description: "e.g. Dark & Gritty, Light & Comedic, Emotional & Dramatic, Thriller/Suspense, Inspirational" },
                  comparable_titles: { type: "string", description: "Comma-separated comparable titles if inferrable" },
                  idea_summary: { type: "string", description: "1-2 sentence summary of the idea" },
                },
                required: ["title", "format", "genres", "budget_range", "target_audience", "tone", "idea_summary"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_project_metadata" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI call failed: ${errText}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    let parsed: Record<string, any>;
    if (toolCall?.function?.arguments) {
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        throw new Error("AI returned invalid structured data");
      }
    } else {
      // Fallback: try content field
      const rawContent = aiData.choices?.[0]?.message?.content || "";
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { throw new Error("AI returned invalid JSON"); }
      } else {
        throw new Error("AI returned no structured data");
      }
    }

    // Sanitise and normalise
    const VALID_FORMATS = ["film", "series", "documentary", "short", "podcast", "book_adaptation"];
    const format = VALID_FORMATS.includes(parsed.format) ? parsed.format : "film";

    const title = (parsed.title || "Untitled Idea").slice(0, 200);
    const genres: string[] = Array.isArray(parsed.genres) ? parsed.genres.slice(0, 4) : [];
    const budget_range = parsed.budget_range || "$2M–$10M";
    const target_audience = parsed.target_audience || "Adult 25–54";
    const tone = parsed.tone || "Emotional & Dramatic";
    const comparable_titles = parsed.comparable_titles || "";
    const idea_summary = parsed.idea_summary || ideaText.slice(0, 300);

    // Create project
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        title,
        format,
        genres,
        budget_range,
        target_audience,
        tone,
        comparable_titles,
        pipeline_stage: "Development",
        document_urls: [],
      })
      .select("id")
      .single();

    if (projErr || !project) {
      throw new Error("Failed to create project: " + (projErr?.message || "Unknown"));
    }

    const projectId = project.id;

    // Create an idea document with the raw text + AI summary
    const ideaDocContent = [
      `# ${title}`,
      "",
      `## Idea`,
      idea_summary,
      "",
      "## Original Notes",
      ideaText,
    ].join("\n");

    const { data: doc, error: docErr } = await supabase
      .from("project_documents")
      .insert({
        project_id: projectId,
        user_id: user.id,
        title: `Idea — ${title}`,
        doc_type: "idea",
        source: "generated",
        file_name: `idea-${title.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`,
        file_path: `projects/${projectId}/idea.txt`,
        plaintext: ideaDocContent,
      })
      .select("id")
      .single();

    if (!docErr && doc) {
      await supabase.from("project_document_versions").insert({
        document_id: doc.id,
        version_number: 1,
        label: "Initial Idea",
        plaintext: ideaDocContent,
        created_by: user.id,
        change_summary: "Created from idea text entry.",
      });
    }

    return new Response(
      JSON.stringify({ projectId, title, format, genres, budget_range }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("idea-to-project error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
