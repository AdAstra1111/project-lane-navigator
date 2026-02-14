import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { projectId } = await req.json();
    if (!projectId) throw new Error("Missing projectId");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the latest "current" script
    const { data: scripts } = await adminClient
      .from("project_scripts")
      .select("file_path")
      .eq("project_id", projectId)
      .eq("status", "current")
      .order("created_at", { ascending: false })
      .limit(1);

    const scriptFilePath = scripts?.[0]?.file_path || null;

    // Try extracted text first
    let extractedText = "";

    if (scriptFilePath) {
      const { data: docs } = await adminClient
        .from("project_documents")
        .select("extracted_text")
        .eq("project_id", projectId)
        .eq("file_path", scriptFilePath)
        .limit(1);
      extractedText = docs?.[0]?.extracted_text || "";
    }

    if (!extractedText) {
      const { data: fallbackDocs } = await adminClient
        .from("project_documents")
        .select("extracted_text")
        .eq("project_id", projectId)
        .not("extracted_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      extractedText = fallbackDocs?.[0]?.extracted_text || "";
    }

    // Fallback: check project_document_versions (dev-engine generated scripts)
    if (!extractedText) {
      const { data: scriptDoc } = await adminClient
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", "script")
        .order("created_at", { ascending: false })
        .limit(1);

      if (scriptDoc?.[0]?.id) {
        const { data: versions } = await adminClient
          .from("project_document_versions")
          .select("plaintext")
          .eq("document_id", scriptDoc[0].id)
          .order("version_number", { ascending: false })
          .limit(1);
        extractedText = versions?.[0]?.plaintext || "";
      }
    }

    // Final fallback: any document version with substantial plaintext
    if (!extractedText) {
      const { data: allDocs } = await adminClient
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(5);

      for (const doc of allDocs || []) {
        const { data: ver } = await adminClient
          .from("project_document_versions")
          .select("plaintext")
          .eq("document_id", doc.id)
          .not("plaintext", "is", null)
          .order("version_number", { ascending: false })
          .limit(1);
        if (ver?.[0]?.plaintext && ver[0].plaintext.length > 500) {
          extractedText = ver[0].plaintext;
          break;
        }
      }
    }

    // Fallback: download PDF
    let pdfBase64: string | null = null;
    if (!extractedText && scriptFilePath) {
      const { data: fileData, error: downloadError } = await adminClient.storage
        .from("project-documents")
        .download(scriptFilePath);

      if (!downloadError && fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        pdfBase64 = btoa(binary);
      }
    }

    if (!extractedText && !pdfBase64) {
      return new Response(JSON.stringify({ scenes: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemMessage = {
      role: "system",
      content: `You are a professional script breakdown tool. Extract every scene from the screenplay. For each scene identify:
- scene_number: the scene number as written, or sequential if not numbered
- heading: the full scene heading (slug line) e.g. "INT. HOSPITAL - NIGHT"
- int_ext: "INT", "EXT", or "INT/EXT"
- location: the location name from the heading
- time_of_day: DAY, NIGHT, DAWN, DUSK, CONTINUOUS, etc.
- description: a one-sentence summary of what happens in the scene
- cast_members: array of character names who appear or speak in this scene
- page_count: estimated page count for the scene using the standard rule of 250 words per page. Count the actual words in each scene's text (including action lines, dialogue, and parentheticals) and divide by 250. Round to nearest eighth (0.125). A typical feature film scene with 2 pages of dialogue and action = 2.0 pages. Do NOT underestimate — a scene with substantial dialogue between multiple characters is usually at least 1.5-3 pages. Short transitional scenes are typically 0.25-0.5 pages.

IMPORTANT PAGE COUNT RULES:
- A standard feature screenplay is 90-120 pages. If your total page count is below 50, you are severely underestimating.
- Count ALL words in the scene text including action/description paragraphs, character names, dialogue, and parentheticals.
- 250 words = 1 page. A scene with 500 words of text = 2 pages.
- Be thorough — include every scene, even short ones.`,
    };

    let userMessage: any;
    if (extractedText) {
      const words = extractedText.split(/\s+/);
      const truncated = words.length > 25000 ? words.slice(0, 25000).join(" ") : extractedText;
      userMessage = {
        role: "user",
        content: `Extract all scenes from this script:\n\n${truncated}`,
      };
    } else {
      userMessage = {
        role: "user",
        content: [
          { type: "text", text: "Extract all scenes from this screenplay PDF." },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
        ],
      };
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [systemMessage, userMessage],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_scenes",
              description: "Return the structured list of scenes from the screenplay.",
              parameters: {
                type: "object",
                properties: {
                  scenes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        scene_number: { type: "string" },
                        heading: { type: "string" },
                        int_ext: { type: "string" },
                        location: { type: "string" },
                        time_of_day: { type: "string" },
                        description: { type: "string" },
                        cast_members: { type: "array", items: { type: "string" } },
                        page_count: { type: "number" },
                      },
                      required: ["scene_number", "heading", "int_ext", "location", "time_of_day", "description", "cast_members", "page_count"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["scenes"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_scenes" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly.", scenes: [] }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted.", scenes: [] }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ scenes: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    let scenes: any[] = [];
    try {
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        scenes = parsed.scenes || [];
      }
    } catch (parseErr) {
      console.error("Failed to parse AI scene response:", parseErr);
    }

    // Save scenes to DB
    if (scenes.length > 0) {
      // Delete existing scenes for this project first (fresh extraction)
      await adminClient.from("project_scenes").delete().eq("project_id", projectId);

      const rows = scenes.map((s: any) => ({
        project_id: projectId,
        user_id: user.id,
        scene_number: String(s.scene_number || ""),
        heading: s.heading || "",
        int_ext: s.int_ext || "",
        location: s.location || "",
        time_of_day: s.time_of_day || "",
        description: s.description || "",
        cast_members: s.cast_members || [],
        page_count: s.page_count || 0,
      }));

      const { error: insertError } = await adminClient.from("project_scenes").insert(rows);
      if (insertError) console.error("Scene insert error:", insertError);
    }

    console.log(`Extracted ${scenes.length} scenes`);

    return new Response(JSON.stringify({ scenes, count: scenes.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-scenes error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", scenes: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
