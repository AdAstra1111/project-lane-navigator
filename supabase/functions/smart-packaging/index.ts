import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectTitle, format, genres, budgetRange, tone, assignedLane, excludeNames, replacementFor, maxSuggestions, targetCharacter, mode } = await req.json();
    const isCrew = mode === 'crew';
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const count = maxSuggestions || 5;
    const excludeClause = excludeNames?.length
      ? `\n\nIMPORTANT: Do NOT suggest these names (already passed on): ${excludeNames.join(', ')}`
      : '';
    const replacementClause = replacementFor
      ? `\n\nThis is a REPLACEMENT request. The producer passed on "${replacementFor}". Suggest someone who fills a similar role/function but is a different talent.`
      : '';
    const characterClause = (targetCharacter && !isCrew)
      ? `\n\nTARGET ROLE: The producer is specifically casting for the character "${targetCharacter.name}"${targetCharacter.description ? ` — ${targetCharacter.description}` : ''}${targetCharacter.scene_count ? ` (appears in ${targetCharacter.scene_count} scenes, ${targetCharacter.scene_count > 15 ? 'LEAD' : targetCharacter.scene_count > 5 ? 'SUPPORTING LEAD' : 'SUPPORTING'} role)` : ''}. Tailor ALL suggestions to ACTORS ONLY who could convincingly play this specific character. Do NOT suggest directors or crew — only actors. Consider age, physicality, acting range, and prior roles that demonstrate suitability.`
      : '';

    const crewPrompt = isCrew
      ? `You are an expert film/TV crew packaging strategist. Given a project, suggest ${count} specific department heads (HODs) and key crew members that would maximize its production value and market credibility.`
      : `You are an expert film/TV packaging strategist. Given a project, suggest ${count} specific cast members and/or directors that would maximize its financeability and market appeal.`;

    const crewFields = isCrew
      ? `For each suggestion provide:
- name: Full name of the crew member
- role: Their department/position (e.g. "Director of Photography", "Production Designer", "Composer", "Editor", "VFX Supervisor")
- rationale: Why this person fits this project (2-3 sentences)
- market_value: "High", "Medium-High", "Medium" based on reputation and demand
- availability_window: Estimated availability like "2025-2026" or "Available"

Focus on crew that:
1. Has relevant genre/format experience
2. Would add production credibility and attract talent
3. Is realistically within the budget range
4. Has a track record that buyers/financiers recognise`
      : `For each suggestion provide:
- name: Full name of the talent
- role: "Lead Actor", "Supporting Actor", "Director", etc.
- rationale: Why this person fits this project (2-3 sentences)
- market_value: "High", "Medium-High", "Medium" based on current market standing
- availability_window: Estimated availability like "2025-2026" or "Available"

Focus on talent that:
1. Matches the budget range realistically
2. Has genre relevance
3. Would unlock financing or pre-sales in key territories
4. Is currently in demand or trending upward`;

    const prompt = `${crewPrompt}

Project: "${projectTitle}"
Format: ${format}
Genres: ${genres?.join(', ')}
Budget: ${budgetRange}
Tone: ${tone}
Lane: ${assignedLane || 'unclassified'}${characterClause}${excludeClause}${replacementClause}

${crewFields}`;

    const systemMsg = isCrew ? "You are a film industry crew packaging expert." : "You are a film industry packaging expert.";
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_packaging",
            description: "Return packaging suggestions for the project.",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      role: { type: "string" },
                      rationale: { type: "string" },
                      market_value: { type: "string" },
                      availability_window: { type: "string" },
                    },
                    required: ["name", "role", "rationale", "market_value", "availability_window"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_packaging" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("smart-packaging error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
