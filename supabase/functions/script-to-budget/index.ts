import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

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
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const { scriptText, format, genres, budgetRange, lane, totalBudget } = await req.json();

    if (!scriptText) {
      return new Response(JSON.stringify({ error: "scriptText is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const guardrails = buildGuardrailBlock({ productionType: format, engineName: "script-to-budget" });
    console.log(`[script-to-budget] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are an expert film & TV line producer and budget estimator. Given script text and project metadata, generate a realistic budget breakdown.

${guardrails.textBlock}

You must return a JSON object with:
- "estimated_total": number — your best estimate of total production budget in the project's currency
- "confidence": number 0-1 — how confident you are in this estimate
- "reasoning": string — 1-2 sentence explanation of your estimate
- "lines": array of budget line items, each with:
  - "category": one of "atl", "btl", "post", "vfx", "logistics", "schedule", "contingency", "soft-money", "other"
  - "line_name": descriptive name
  - "amount": estimated amount (number)
  - "rationale": brief 1-sentence justification

Analysis approach:
1. Count approximate scenes, locations (INT/EXT), cast size, action/VFX sequences
2. Assess if script implies stunts, special effects, period settings, multiple locations
3. Factor in format (film vs TV series), genre, and stated budget range
4. If a total budget is provided, distribute across categories realistically
5. If no total budget, estimate one based on the script complexity and lane

Budget range hints: micro=under $500K, low=$500K-2M, mid=$2M-10M, upper-mid=$10M-30M, high=$30M-80M, studio=$80M+

Return ONLY valid JSON, no markdown.`;

    const truncated = scriptText.split(/\s+/).slice(0, 15000).join(" ");

    const userContent = `Project metadata:
- Format: ${format || "film"}
- Genres: ${(genres || []).join(", ") || "unknown"}
- Budget range: ${budgetRange || "unknown"}
- Lane: ${lane || "unknown"}
- Total budget (if known): ${totalBudget ? `$${totalBudget}` : "estimate needed"}

Script text (first ~15K words):
${truncated}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "{}";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let result: any;
    try {
      result = JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse AI response", raw: content }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate
    const validCategories = ["atl", "btl", "post", "vfx", "logistics", "schedule", "contingency", "soft-money", "other"];
    const lines = (result.lines || [])
      .filter((l: any) => l && l.line_name)
      .map((l: any) => ({
        category: validCategories.includes(l.category) ? l.category : "other",
        line_name: String(l.line_name).slice(0, 200),
        amount: typeof l.amount === "number" ? l.amount : parseFloat(String(l.amount).replace(/[^0-9.-]/g, "")) || 0,
        rationale: String(l.rationale || "").slice(0, 300),
      }));

    return new Response(
      JSON.stringify({
        success: true,
        estimated_total: result.estimated_total || lines.reduce((s: number, l: any) => s + l.amount, 0),
        confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
        reasoning: String(result.reasoning || "").slice(0, 500),
        lines,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("script-to-budget error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
