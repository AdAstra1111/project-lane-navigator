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
    if (!authHeader?.startsWith("Bearer ")) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) throw new Error("Not authenticated");
    const userId = claimsData.claims.sub;

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

    const scriptFilePath = scripts?.[0]?.file_path || null;

    // --- Try to find extracted text from project_documents ---
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

    // Fallback: any document with extracted text for this project
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
      // Find the script document for this project
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

    // Final fallback: any document version with plaintext
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

    // If no extracted text is available, return empty — avoid downloading
    // large PDFs into memory which can exceed edge function limits.
    if (!extractedText) {
      console.log("No extracted text available for character extraction — skipping PDF download to avoid memory limits");
      return new Response(JSON.stringify({ characters: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build messages: use PDF (multimodal) or text
    const systemMessage = {
      role: "system",
      content: `You are a script analysis tool. Extract all named speaking characters from the screenplay/script text provided. For each character, count how many distinct scenes they appear in and determine their gender. A scene is typically marked by a scene heading (INT./EXT. or similar slug line). Return character names as they appear in the script. Exclude generic descriptions like "MAN", "WOMAN", "WAITER" unless they are clearly recurring characters with multiple scenes. Focus on characters who have dialogue or are named specifically. For gender, use "male", "female", or "unknown" based on pronouns, character descriptions, dialogue context, or name conventions in the script.`,
    };

    const words = extractedText.split(/\s+/);
    const truncated = words.length > 20000 ? words.slice(0, 20000).join(" ") : extractedText;
    const userMessage = {
      role: "user",
      content: `Extract all named character names from this script, and count how many scenes each character appears in:\n\n${truncated}`,
    };

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
              name: "extract_characters",
              description: "Return the list of character names found in the script with scene counts.",
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
                        scene_count: { type: "number", description: "Number of distinct scenes the character appears in" },
                        gender: { type: "string", enum: ["male", "female", "unknown"], description: "Gender of the character based on script context, pronouns, and descriptions" },
                      },
                      required: ["name", "description", "scene_count", "gender"],
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
    
    let characters: { name: string; description: string; scene_count: number; gender?: string }[] = [];
    try {
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        characters = parsed.characters || [];
      }
    } catch (parseErr) {
      console.error("Failed to parse AI character response:", parseErr);
    }

    // Deduplicate, title-case, and sort by scene count descending
    const seen = new Set<string>();
    const uniqueCharacters = characters.filter((c) => {
      const key = c.name.toUpperCase().trim();
      if (seen.has(key) || !key) return false;
      seen.add(key);
      return true;
    }).map((c) => ({
      name: c.name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "),
      description: c.description,
      scene_count: c.scene_count || 0,
    })).map((c: any) => ({
      ...c,
      gender: c.gender || 'unknown',
    })).sort((a: any, b: any) => b.scene_count - a.scene_count);

    console.log(`Extracted ${uniqueCharacters.length} characters`);

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
