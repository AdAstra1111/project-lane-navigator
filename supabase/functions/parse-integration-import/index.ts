import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROMPTS: Record<string, string> = {
  budget: `You are an expert film & TV budget parser. Extract structured budget data from the provided text.

Return a JSON object with:
- "total_budget": number (total budget amount)
- "above_line_total": number (ATL total)
- "below_line_total": number (BTL total)
- "contingency": number
- "currency": string (e.g. "USD", "GBP", "EUR")
- "categories": array of { "name": string, "amount": number, "account_code": string (optional) }
- "notes": string (any relevant observations)

Rules:
- Merge duplicates, skip subtotals/headers
- If currency is ambiguous, default to "USD"
- Return ONLY valid JSON, no markdown`,

  cost_report: `You are a film production cost report parser. Extract structured data from the provided text.

Return a JSON object with:
- "approved_budget": number
- "actual_spend": number
- "committed": number
- "estimate_at_completion": number (EAC)
- "variance": number (positive = under budget)
- "report_date": string (ISO date if found)
- "currency": string
- "departments": array of { "name": string, "budget": number, "actual": number, "variance": number }
- "notes": string

Return ONLY valid JSON.`,

  payroll_summary: `You are a film production payroll parser. Extract structured data.

Return a JSON object with:
- "total_payroll": number
- "headcount": number
- "union_breakdown": object mapping union name to headcount (optional)
- "payroll_period_start": string (ISO date)
- "payroll_period_end": string (ISO date)
- "currency": string
- "departments": array of { "name": string, "amount": number, "headcount": number }
- "notes": string

Return ONLY valid JSON.`,

  schedule: `You are a film production schedule parser. Extract structured data.

Return a JSON object with:
- "total_shoot_days": number
- "start_date": string (ISO date)
- "end_date": string (ISO date)
- "location_count": number
- "locations": array of { "name": string, "days": number, "int_ext": string }
- "prep_days": number (if found)
- "wrap_days": number (if found)
- "notes": string

Return ONLY valid JSON.`,

  delivery_spec: `You are a film delivery specification parser. Extract structured data.

Return a JSON object with:
- "deliverables": array of { "type": string, "format": string, "status": string }
- "delivery_deadline": string (ISO date if found)
- "territories": array of strings
- "notes": string

Return ONLY valid JSON.`,

  incentive_report: `You are a film tax incentive report parser. Extract structured data.

Return a JSON object with:
- "jurisdiction": string
- "incentive_type": string (tax credit, rebate, cash grant)
- "qualifying_spend": number
- "incentive_rate": number (percentage as decimal, e.g. 0.25 for 25%)
- "estimated_value": number
- "currency": string
- "requirements": array of strings
- "notes": string

Return ONLY valid JSON.`,
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
    const { text, file_name, import_type } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = PROMPTS[import_type] || PROMPTS.budget;

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
          { role: "user", content: `File: ${file_name || "import"}\n\nContent:\n${text.slice(0, 50000)}` },
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

    // Strip markdown fences
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    // Robust JSON extraction
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      content = content.slice(firstBrace, lastBrace + 1);
    }

    let summary: any;
    try {
      summary = JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse AI response", raw: content }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("parse-integration-import error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
