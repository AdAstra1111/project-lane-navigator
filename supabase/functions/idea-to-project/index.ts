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

    // --- AI parse ---
    const systemPrompt = `You are a film/TV development executive assistant. 
Given a free-text idea from a producer, extract structured project metadata and return ONLY a valid JSON object with these fields:
- title: string (short project title, infer from idea if not explicit)
- format: one of "film" | "series" | "documentary" | "short" | "podcast" | "book_adaptation"
- genres: string[] (1-4 genres, e.g. ["Drama", "Thriller"])
- budget_range: string (one of "$0–$500K" | "$500K–$2M" | "$2M–$10M" | "$10M–$50M" | "$50M+")
- target_audience: string (e.g. "Adult 25–54" | "Young Adult 18–34" | "Family" | "Niche/Specialist")
- tone: string (e.g. "Dark & Gritty" | "Light & Comedic" | "Emotional & Dramatic" | "Thriller/Suspense" | "Inspirational")
- comparable_titles: string (comma-separated comps if you can infer them)
- idea_summary: string (1-2 sentence summary of the idea)

Be generous in your interpretation — extract whatever you can from the text, use sensible defaults for missing fields. Always return valid JSON only, no markdown fences, no extra text.`;

    const aiResponse = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: ideaText.slice(0, 4000) },
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI call failed: ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      // Try to extract JSON from text
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error("AI returned invalid JSON");
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
