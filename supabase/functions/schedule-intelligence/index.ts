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
    const { scenes, shootDays, schedule, format, genres, budgetRange } = await req.json();

    if (!scenes || scenes.length === 0) {
      return new Response(JSON.stringify({ error: "scenes are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert 1st Assistant Director and production scheduling analyst. Given scene data and optional existing schedule, provide scheduling intelligence.

Return a JSON object with:
- "estimated_shoot_days": number — estimated total shoot days needed
- "estimated_pages_per_day": number — average pages per day (industry standard: 3-5 for film, 5-8 for TV)
- "confidence": number 0-1
- "overtime_risk": "low" | "medium" | "high" — overall overtime risk assessment
- "overtime_factors": string[] — specific factors that could cause overtime
- "cast_clustering": array of { "actor": string, "scene_count": number, "consecutive_possible": boolean, "hold_days_estimate": number } — top cast members sorted by scene count
- "location_groups": array of { "location": string, "scene_count": number, "total_pages": number, "suggested_days": number }
- "night_shoot_count": number — scenes requiring night shoots
- "ext_ratio": number — percentage of exterior scenes (weather risk)
- "scheduling_flags": string[] — warnings like "heavy night schedule", "many company moves", "cast availability conflicts"
- "suggested_block_structure": string — e.g. "3 weeks main unit, 1 week second unit"
- "reasoning": string — brief explanation

Return ONLY valid JSON.`;

    // Summarize scenes for the AI
    const sceneSummary = scenes.slice(0, 200).map((s: any) => ({
      num: s.scene_number,
      heading: s.heading?.slice(0, 80),
      int_ext: s.int_ext,
      time: s.time_of_day,
      pages: s.page_count,
      cast: s.cast_members?.slice(0, 5),
      location: s.location?.slice(0, 50),
    }));

    const scheduleSummary = shootDays?.length > 0
      ? `Existing schedule: ${shootDays.length} shoot days planned, ${schedule?.length || 0} scenes assigned.`
      : "No schedule created yet.";

    const userContent = `Project: ${format || "film"}, ${(genres || []).join(", ")}, budget range: ${budgetRange || "unknown"}
${scheduleSummary}

Scene data (${scenes.length} total scenes):
${JSON.stringify(sceneSummary)}`;

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
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "{}";
    // Strip markdown fences
    content = content.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
    // Find the actual JSON object boundaries
    if (!content.trim().startsWith("{") && !content.trim().startsWith("[")) {
      const objStart = content.indexOf("{");
      if (objStart >= 0) content = content.slice(objStart);
    }
    const lastBracket = Math.max(content.lastIndexOf("}"), content.lastIndexOf("]"));
    if (lastBracket >= 0) content = content.slice(0, lastBracket + 1);
    content = content.trim();

    let result: any;
    try {
      result = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI content:", content.slice(0, 500));
      return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("schedule-intelligence error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
