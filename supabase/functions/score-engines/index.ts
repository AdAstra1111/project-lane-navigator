import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user auth
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch project details
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch engines
    const { data: engines } = await supabase
      .from("trend_engines")
      .select("*")
      .eq("status", "active");

    if (!engines?.length) {
      return new Response(JSON.stringify({ error: "No active engines" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build AI prompt
    const engineList = engines.map((e: any) => `- ${e.engine_name} (${e.engine_type}): ${e.description}`).join("\n");

    const prompt = `You are a film/TV market intelligence analyst. Score each trend engine for a specific project on a scale of 0-10 (one decimal place).

PROJECT:
- Title: ${project.title}
- Logline: ${project.logline || "Not provided"}
- Format: ${project.format}
- Genre: ${project.genre || "Not specified"}
- Budget Range: ${project.budget_range || "Not specified"}
- Target Audience: ${project.target_audience || "Not specified"}
- Tone: ${project.tone || "Not specified"}
- Primary Territory: ${(project as any).primary_territory || "Not specified"}
- Assigned Lane: ${project.assigned_lane || "Not specified"}
- Pipeline Stage: ${project.pipeline_stage || "Not specified"}
- Cast Attached: ${(project as any).cast_summary || "Not specified"}

TREND ENGINES TO SCORE:
${engineList}

For each engine, consider:
- Current market conditions and trends (as of early 2026)
- How well this project aligns with each engine's focus area
- Budget tier implications
- Territory and format relevance

Return a JSON array of objects with:
- engine_name: string (exact name from above)
- score: number (0.0 to 10.0)
- confidence: "high" | "medium" | "low"
- reasoning: string (1 sentence explaining the score)

Return ONLY the JSON array. No markdown fences, no explanation outside the array.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let parsed: any[];
    try {
      let cleaned = content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI scores:", content.slice(0, 500));
      throw new Error("AI returned invalid scoring data");
    }

    // Map engine names to IDs and upsert scores
    const engineMap = new Map(engines.map((e: any) => [e.engine_name, e.id]));
    const now = new Date().toISOString();
    let scored = 0;

    for (const item of parsed) {
      const engineId = engineMap.get(item.engine_name);
      if (!engineId) continue;

      const score = Math.min(10, Math.max(0, parseFloat(item.score) || 5));
      const confidence = ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "medium";

      const { error: upsertErr } = await supabase
        .from("project_engine_scores")
        .upsert({
          project_id,
          engine_id: engineId,
          user_id: user.id,
          score,
          confidence,
          source: "ai",
          notes: item.reasoning || "",
          last_scored_at: now,
        }, { onConflict: "project_id,engine_id" });

      if (!upsertErr) scored++;
    }

    // Update last_refresh on engines
    await supabase
      .from("trend_engines")
      .update({ last_refresh: now })
      .eq("status", "active");

    return new Response(
      JSON.stringify({ success: true, engines_scored: scored, scored_at: now }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("score-engines error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
