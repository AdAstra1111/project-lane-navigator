import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Invalid auth");

    const { projectId, question } = await req.json();
    if (!projectId || !question) throw new Error("Missing projectId or question");

    // Validate user has access to this project
    const { data: hasAccess } = await supabase.rpc('has_project_access', {
      _user_id: user.id,
      _project_id: projectId
    });
    if (!hasAccess) throw new Error("Unauthorized: You do not have access to this project");

    // Fetch project data
    const [projectRes, castRes, partnersRes, financeRes, dealsRes, docsRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("project_cast").select("*").eq("project_id", projectId),
      supabase.from("project_partners").select("*").eq("project_id", projectId),
      supabase.from("project_finance_scenarios").select("*").eq("project_id", projectId),
      supabase.from("project_deals").select("*").eq("project_id", projectId),
      supabase.from("project_documents").select("file_name, extraction_status, extracted_text").eq("project_id", projectId),
    ]);

    const project = projectRes.data;
    if (!project) throw new Error("Project not found");

    // Build context
    const context = `
PROJECT: ${project.title}
Format: ${project.format}
Genres: ${(project.genres || []).join(", ")}
Budget: ${project.budget_range}
Lane: ${project.assigned_lane || "Unclassified"}
Stage: ${project.pipeline_stage}
Tone: ${project.tone}
Target Audience: ${project.target_audience}
Comparable Titles: ${project.comparable_titles}

ANALYSIS: ${project.reasoning || "None"}
${project.analysis_passes ? `VERDICT: ${(project.analysis_passes as any)?.verdict || "None"}` : ""}

CAST (${(castRes.data || []).length}): ${(castRes.data || []).map((c: any) => `${c.actor_name} as ${c.role_name} (${c.status})`).join("; ")}

PARTNERS (${(partnersRes.data || []).length}): ${(partnersRes.data || []).map((p: any) => `${p.partner_name} - ${p.partner_type} (${p.territory})`).join("; ")}

FINANCE SCENARIOS: ${(financeRes.data || []).map((f: any) => `${f.scenario_name}: Budget ${f.total_budget}, Pre-sales ${f.presales_amount}, Equity ${f.equity_amount}, Gap ${f.gap_amount}`).join("; ")}

DEALS (${(dealsRes.data || []).length}): ${(dealsRes.data || []).map((d: any) => `${d.buyer_name} - ${d.territory} - ${d.deal_type} - $${d.minimum_guarantee} (${d.status})`).join("; ")}

DOCUMENTS: ${(docsRes.data || []).map((d: any) => d.file_name).join(", ")}
${(docsRes.data || []).filter((d: any) => d.extracted_text).map((d: any) => `--- ${d.file_name} ---\n${d.extracted_text || ""}`).join("\n")}
    `.trim();

    // Call AI with streaming
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("AI not configured");

    const guardrails = buildGuardrailBlock({ productionType: project.format, engineName: "project-chat" });
    console.log(`[project-chat] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a senior film & TV producer's strategic advisor embedded inside a project management tool called IFFY. You have full access to the project dossier below. Answer questions conversationally but with strategic depth. Be specific, reference actual data from the project. Keep responses concise but insightful — aim for 2-4 paragraphs max. If you don't have enough data, say so and suggest what the user should add.

${guardrails.textBlock}

PROJECT DOSSIER:
${context}`,
          },
          { role: "user", content: question },
        ],
        max_tokens: 1000,
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", errText);
      throw new Error("AI request failed");
    }

    // Stream the response back
    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("project-chat error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
