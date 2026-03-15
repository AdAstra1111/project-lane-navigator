import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MODELS } from "../_shared/llm.ts";

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

    const { text, file_name } = await req.json();
    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use AI to extract structured budget lines from the raw text
    const systemPrompt = `You are an expert film & TV budget parser. Given raw text extracted from a budget document (PDF or CSV), extract all identifiable budget line items.

Return a JSON array where each item has:
- "category": one of "atl" (Above the Line), "btl" (Below the Line), "post" (Post-Production), "vfx" (VFX & Digital), "logistics" (Logistics & Travel), "schedule" (Schedule / Shoot), "contingency" (Contingency), "soft-money" (Soft Money Offsets), "other" (Other)
- "line_name": descriptive name of the line item (clean it up from any codes or numbers)
- "amount": numeric amount (number, no currency symbols). If the amount is unclear, use 0.

Rules:
- Categorize intelligently based on the line item description
- Merge duplicate or redundant items
- Skip subtotals, totals, and header rows
- If the text looks like a CSV, parse it accordingly
- If categories or account numbers are present (e.g. "1100 Producer"), map them to the correct category
- Return ONLY the JSON array, no markdown, no explanation

Example output:
[
  {"category": "atl", "line_name": "Writer", "amount": 50000},
  {"category": "btl", "line_name": "Camera Department", "amount": 120000}
]`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `File: ${file_name || "budget"}\n\nContent:\n${text.slice(0, 50000)}` },
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
    let content = aiData.choices?.[0]?.message?.content || "[]";

    // Strip markdown code fences if present
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let lines: any[];
    try {
      lines = JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse AI response", raw: content }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate and clean
    const validCategories = ["atl", "btl", "post", "vfx", "logistics", "schedule", "contingency", "soft-money", "other"];
    const cleanedLines = lines
      .filter((l: any) => l && l.line_name)
      .map((l: any) => ({
        category: validCategories.includes(l.category) ? l.category : "other",
        line_name: String(l.line_name).slice(0, 200),
        amount: typeof l.amount === "number" ? l.amount : parseFloat(String(l.amount).replace(/[^0-9.-]/g, "")) || 0,
      }));

    return new Response(
      JSON.stringify({ success: true, lines: cleanedLines, total: cleanedLines.reduce((s: number, l: any) => s + l.amount, 0) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("extract-budget error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
