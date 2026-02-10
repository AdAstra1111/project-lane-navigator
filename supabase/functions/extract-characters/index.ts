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

    // Find the latest "current" script for this project
    const { data: scripts } = await adminClient
      .from("project_scripts")
      .select("file_path")
      .eq("project_id", projectId)
      .eq("status", "current")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!scripts?.length || !scripts[0].file_path) {
      return new Response(JSON.stringify({ characters: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scriptFilePath = scripts[0].file_path;

    // Get the extracted text from project_documents matching this file_path
    const { data: docs } = await adminClient
      .from("project_documents")
      .select("extracted_text")
      .eq("project_id", projectId)
      .eq("file_path", scriptFilePath)
      .limit(1);

    let extractedText = docs?.[0]?.extracted_text || "";

    // If no extracted text found via file_path match, try the latest document with text
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

    if (!extractedText || extractedText.length < 50) {
      return new Response(JSON.stringify({ characters: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Truncate to ~20k words to stay within token limits
    const words = extractedText.split(/\s+/);
    const truncated = words.length > 20000 ? words.slice(0, 20000).join(" ") : extractedText;

    // Use Lovable AI to extract character names
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a script analysis tool. Extract all named speaking characters from the screenplay/script text provided. Return ONLY character names as they appear in the script (typically in UPPERCASE in screenplays). Exclude generic descriptions like "MAN", "WOMAN", "WAITER" unless they are clearly recurring characters. Focus on characters who have dialogue or are named specifically.`,
          },
          {
            role: "user",
            content: `Extract all named character names from this script:\n\n${truncated}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_characters",
              description: "Return the list of character names found in the script.",
              parameters: {
                type: "object",
                properties: {
                  characters: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Character name as it appears in the script" },
                        description: { type: "string", description: "Brief one-line description of the character if determinable, otherwise empty string" },
                      },
                      required: ["name", "description"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["characters"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_characters" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly.", characters: [] }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted.", characters: [] }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ characters: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    
    // Parse tool call response
    let characters: { name: string; description: string }[] = [];
    try {
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        characters = parsed.characters || [];
      }
    } catch (parseErr) {
      console.error("Failed to parse AI character response:", parseErr);
    }

    // Deduplicate and title-case
    const seen = new Set<string>();
    const uniqueCharacters = characters.filter((c) => {
      const key = c.name.toUpperCase().trim();
      if (seen.has(key) || !key) return false;
      seen.add(key);
      return true;
    }).map((c) => ({
      name: c.name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "),
      description: c.description,
    }));

    return new Response(JSON.stringify({ characters: uniqueCharacters }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-characters error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", characters: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
