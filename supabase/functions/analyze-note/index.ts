import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id as string;

    const { project_id, note } = await req.json();
    if (!project_id || !note) {
      return new Response(JSON.stringify({ error: "project_id and note are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch project context
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .eq("user_id", userId)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch attachments for context
    const [castRes, partnersRes, hodsRes, financeRes] = await Promise.all([
      supabase.from("project_cast").select("actor_name, role_name, status").eq("project_id", project_id),
      supabase.from("project_partners").select("partner_name, partner_type, territory, status").eq("project_id", project_id),
      supabase.from("project_hods").select("department, person_name, reputation_tier, status").eq("project_id", project_id),
      supabase.from("project_finance_scenarios").select("scenario_name, total_budget, presales_amount, incentive_amount, gap_amount").eq("project_id", project_id),
    ]);

    const analysis = project.analysis_passes || {};

    const guardrails = buildGuardrailBlock({ productionType: project.format || "film", engineName: "analyze-note" });
    console.log(`[analyze-note] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are IFFY, a decision-support tool for international film and television finance. A producer has added a note to their project. Your job is to assess how this consideration might affect the project's finance readiness.
${guardrails.textBlock}

PROJECT CONTEXT:
- Title: ${project.title}
- Format: ${project.format}
- Genres: ${(project.genres || []).join(", ")}
- Budget: ${project.budget_range}
- Lane: ${project.assigned_lane || "Not assigned"}
- Tone: ${project.tone}
- Target Audience: ${project.target_audience}

CURRENT ATTACHMENTS:
- Cast: ${(castRes.data || []).map((c: any) => `${c.actor_name} (${c.role_name}, ${c.status})`).join("; ") || "None"}
- Partners: ${(partnersRes.data || []).map((p: any) => `${p.partner_name} (${p.partner_type}, ${p.territory})`).join("; ") || "None"}
- HODs: ${(hodsRes.data || []).map((h: any) => `${h.person_name} (${h.department}, ${h.reputation_tier})`).join("; ") || "None"}
- Finance: ${(financeRes.data || []).map((f: any) => `${f.scenario_name}: budget ${f.total_budget}`).join("; ") || "No scenarios"}

ANALYSIS VERDICT: ${analysis.verdict || "No analysis yet"}

INSTRUCTIONS:
- Respond in 3-5 sentences maximum
- Be specific about HOW this affects finance readiness (packaging, incentives, pre-sales, co-production eligibility, market timing)
- If the note mentions a location, assess incentive implications
- If the note mentions talent, assess packaging and foreign value implications
- Be calm, confident, and producer-facing — no buzzwords
- End with one clear recommendation`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: note },
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
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const impactAnalysis = aiData.choices?.[0]?.message?.content || "Unable to assess impact at this time.";

    // Save the note and impact to project_updates
    const { error: insertErr } = await supabase.from("project_updates").insert({
      project_id,
      user_id: userId,
      title: note.length > 80 ? note.slice(0, 77) + "…" : note,
      description: note,
      update_type: "note",
      impact_summary: impactAnalysis,
    });

    if (insertErr) {
      console.error("Insert error:", insertErr);
      throw new Error("Failed to save note");
    }

    return new Response(
      JSON.stringify({ success: true, impact: impactAnalysis }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyze-note error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
