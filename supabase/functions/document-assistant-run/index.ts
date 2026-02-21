import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const PRO_MODEL = "google/gemini-2.5-pro";

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3, maxTokens = 8000): Promise<string> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature,
        max_tokens: maxTokens,
      }),
    });
    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");
    if (response.ok) {
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000)); continue; }
        throw new Error("AI returned empty response");
      }
      let data: any;
      try { data = JSON.parse(text); } catch {
        const lb = text.lastIndexOf("}");
        if (lb > 0) { try { data = JSON.parse(text.substring(0, lb + 1)); } catch { throw new Error("Unparseable AI response"); } }
        else throw new Error("Unparseable AI response");
      }
      return data.choices?.[0]?.message?.content || "";
    }
    const t = await response.text();
    console.error(`AI error attempt ${attempt + 1}:`, response.status, t);
    if (response.status >= 500 && attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000)); continue; }
    throw new Error(`AI call failed: ${response.status}`);
  }
  throw new Error("AI call failed after retries");
}

function extractJSON(raw: string): string {
  let c = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!c.trim().startsWith("{") && !c.trim().startsWith("[")) { const i = c.indexOf("{"); if (i >= 0) c = c.slice(i); }
  const last = c.lastIndexOf("}");
  if (last >= 0) c = c.slice(0, last + 1);
  return c.trim();
}

// Truncate logs to avoid giant DB rows
function trimLogs(logs: string, maxLen = 20000): string {
  if (logs.length <= maxLen) return logs;
  return logs.slice(0, maxLen) + "\n\n[...truncated]";
}

// Fetch project context for simulations
async function fetchProjectContext(sb: any, projectId: string) {
  const { data: project } = await sb.from("projects")
    .select("title, logline, genre, format, budget_range, pipeline_stage, season_episode_count, episode_target_duration_seconds")
    .eq("id", projectId).single();

  // Fetch latest versions of key document types
  const docTypes = ["concept_brief", "market_sheet", "blueprint", "character_bible", "beat_sheet", "draft", "format_rules", "treatment"];
  const docs: Record<string, string> = {};
  for (const dt of docTypes) {
    const { data: doc } = await sb.from("project_documents")
      .select("id").eq("project_id", projectId).eq("doc_type", dt).limit(1).single();
    if (doc) {
      const { data: ver } = await sb.from("project_document_versions")
        .select("plaintext").eq("document_id", doc.id).order("version_number", { ascending: false }).limit(1).single();
      if (ver?.plaintext) docs[dt] = ver.plaintext;
    }
  }
  return { project, docs };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) throw new Error("Not authenticated");
    const userId = user.id;

    const body = await req.json();
    const { projectId, threadId: inputThreadId, userMessage } = body;
    if (!projectId || !userMessage) throw new Error("Missing projectId or userMessage");

    // 1) Ensure thread
    let threadId = inputThreadId;
    if (!threadId) {
      const { data: existing } = await sb.from("document_assistant_threads")
        .select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single();
      if (existing) {
        threadId = existing.id;
      } else {
        const { data: newThread, error: tErr } = await sb.from("document_assistant_threads")
          .insert({ project_id: projectId, created_by: userId }).select("id").single();
        if (tErr) throw tErr;
        threadId = newThread.id;
      }
    }

    // 2) Insert user message
    const { data: userMsg, error: umErr } = await sb.from("document_assistant_messages")
      .insert({ thread_id: threadId, role: "user", content: userMessage, created_by: userId })
      .select("id").single();
    if (umErr) throw umErr;

    // 3) Insert ack assistant message
    const { data: ackMsg, error: amErr } = await sb.from("document_assistant_messages")
      .insert({ thread_id: threadId, role: "assistant", content: "Running simulations…", metadata: { stage: "ack" }, created_by: userId })
      .select("id").single();
    if (amErr) throw amErr;

    // 4) Fetch project context
    const ctx = await fetchProjectContext(sb, projectId);
    const projectSummary = ctx.project
      ? `Title: ${ctx.project.title || "Untitled"}\nLogline: ${ctx.project.logline || "N/A"}\nGenre: ${ctx.project.genre || "N/A"}\nFormat: ${ctx.project.format || "film"}\nBudget: ${ctx.project.budget_range || "N/A"}\nStage: ${ctx.project.pipeline_stage || "N/A"}`
      : "Project metadata not available.";

    const docsBlock = Object.entries(ctx.docs).length > 0
      ? Object.entries(ctx.docs).map(([dt, txt]) => `=== ${dt.toUpperCase()} ===\n${txt}`).join("\n\n")
      : "No documents available yet.";

    // 5) LLM: analyze message + produce actions
    const analyzeSystem = `You are a creative and commercial development assistant for film/TV projects.
Given a user message and project context, produce:
1. A thoughtful response to the user
2. Zero or more proposed ACTIONS the user could apply

Return STRICT JSON:
{
  "response": "your response text (markdown ok)",
  "actions": [
    {
      "action_type": "e.g. apply_note_to_blueprint | rewrite_character_arc | tighten_act_two | change_ending | reduce_budget_scope | increase_commercial_hook",
      "target_ref": { "doc_type": "...", "section": "..." },
      "patch": { "description": "what changes" },
      "human_summary": "one-sentence summary of the proposed change",
      "simulation_plan": "what to evaluate in baseline vs counterfactual"
    }
  ]
}
If the user is just asking a question with no actionable change, return empty actions array.
Be specific and grounded in the actual project documents.`;

    const analyzeUser = `PROJECT:\n${projectSummary}\n\nDOCUMENTS:\n${docsBlock}\n\nUSER MESSAGE:\n${userMessage}`;
    const analyzeRaw = await callAI(apiKey, MODEL, analyzeSystem, analyzeUser, 0.3, 6000);

    let parsed: any;
    try { parsed = JSON.parse(extractJSON(analyzeRaw)); }
    catch { parsed = { response: analyzeRaw, actions: [] }; }

    const assistantText = parsed.response || analyzeRaw;
    const proposedActions: any[] = parsed.actions || [];

    // 6) Update ack message with real response
    await sb.from("document_assistant_messages")
      .update({ content: assistantText, metadata: { stage: "complete", action_count: proposedActions.length } })
      .eq("id", ackMsg.id);

    // 7) For each action: create action row, run simulation, store results
    const actionResults: any[] = [];

    for (const pa of proposedActions) {
      // a) Insert action
      const { data: actionRow, error: aErr } = await sb.from("document_assistant_actions").insert({
        thread_id: threadId,
        proposed_by_message_id: ackMsg.id,
        action_type: pa.action_type || "general_note",
        target_ref: pa.target_ref || {},
        patch: pa.patch || {},
        human_summary: pa.human_summary || "Proposed change",
        status: "testing",
        created_by: userId,
      }).select("id").single();
      if (aErr) { console.error("Action insert error:", aErr); continue; }

      // b) Insert test_run
      const { data: testRun, error: trErr } = await sb.from("document_assistant_test_runs").insert({
        action_id: actionRow.id,
        started_by: userId,
        status: "running",
      }).select("id").single();
      if (trErr) { console.error("Test run insert error:", trErr); continue; }

      // c) Run simulation
      let testStatus = "error";
      let testSummary = "";
      let testDetails: any = {};
      let testLogs = "";

      try {
        const simSystem = `You are a creative + commercial simulation engine for film/TV development.
Given a BASELINE (current project state) and a PROPOSED ACTION, evaluate the impact.

Return STRICT JSON matching this EXACT schema:
{
  "baseline": {
    "one_liner": "one sentence describing the current project",
    "core_conflicts": ["..."],
    "main_characters": [{"name":"","role":"","arc":"","risk_flags":["..."]}],
    "structure": {"act1":"","act2":"","act3":"","pacing_notes":["..."]},
    "tone_and_theme": {"tone":"","themes":["..."],"comparables":["..."]}
  },
  "counterfactual": {
    "delta_summary": ["what would change"],
    "expected_changes": {
      "narrative": {"improvements":["..."],"regressions":["..."],"unknowns":["..."]},
      "characters": {"improvements":["..."],"regressions":["..."],"unknowns":["..."]},
      "pacing": {"improvements":["..."],"regressions":["..."],"unknowns":["..."]},
      "tone_theme": {"improvements":["..."],"regressions":["..."],"unknowns":["..."]}
    }
  },
  "scores": {
    "story_coherence": {"baseline":0,"after":0,"rationale":""},
    "character_compelling": {"baseline":0,"after":0,"rationale":""},
    "emotional_engagement": {"baseline":0,"after":0,"rationale":""},
    "market_fit": {"baseline":0,"after":0,"rationale":""},
    "finance_viability": {"baseline":0,"after":0,"rationale":""},
    "buyer_attachability": {"baseline":0,"after":0,"rationale":""},
    "budget_risk": {"baseline":0,"after":0,"rationale":""}
  },
  "financing_notes": {
    "target_budget_band": "micro|low|mid|high|studio|unknown",
    "package_needs": ["..."],
    "sales_red_flags": ["..."],
    "mitigations": ["..."],
    "who_might_buy": ["..."]
  },
  "recommendation": {
    "verdict": "APPLY|DONT_APPLY|APPLY_WITH_CHANGES",
    "confidence": 0.0,
    "why": ["..."],
    "if_apply_adjustments": ["..."],
    "next_steps": ["..."]
  }
}

All scores are 0-100. Be grounded ONLY in provided documents. If key documents are missing, note it and downgrade confidence.`;

        const simUser = `PROJECT:\n${projectSummary}\n\nDOCUMENTS:\n${docsBlock}\n\nPROPOSED ACTION:\nType: ${pa.action_type}\nSummary: ${pa.human_summary}\nPatch: ${JSON.stringify(pa.patch)}\nSimulation Plan: ${pa.simulation_plan || "Full creative + commercial impact"}`;

        const simRaw = await callAI(apiKey, PRO_MODEL, simSystem, simUser, 0.2, 10000);
        testLogs += `Raw model output (trimmed):\n${simRaw.slice(0, 15000)}\n`;

        try {
          testDetails = JSON.parse(extractJSON(simRaw));
        } catch (parseErr) {
          testLogs += `\nFirst parse failed: ${parseErr}. Retrying...\n`;
          // Retry once
          try {
            const retryRaw = await callAI(apiKey, MODEL, "Fix this malformed JSON. Return ONLY valid JSON.", simRaw.slice(0, 8000), 0, 6000);
            testDetails = JSON.parse(extractJSON(retryRaw));
            testLogs += `Retry succeeded.\n`;
          } catch (retryErr) {
            testLogs += `Retry also failed: ${retryErr}\n`;
            testDetails = { raw_output: simRaw.slice(0, 5000), parse_error: String(parseErr) };
            testStatus = "error";
            testSummary = "Simulation output could not be parsed.";
          }
        }

        // Determine pass/fail from details
        if (testDetails.recommendation?.verdict) {
          const verdict = testDetails.recommendation.verdict;
          const scores = testDetails.scores || {};
          const scoreKeys = ["story_coherence", "character_compelling", "emotional_engagement", "market_fit", "finance_viability", "buyer_attachability"];
          let netPositive = 0;
          for (const k of scoreKeys) {
            if (scores[k] && scores[k].after > scores[k].baseline) netPositive++;
          }
          const budgetRisk = scores.budget_risk || {};
          const budgetSevere = (budgetRisk.after || 0) > (budgetRisk.baseline || 0) + 15;

          if ((verdict === "APPLY" || verdict === "APPLY_WITH_CHANGES") && netPositive >= 4 && !budgetSevere) {
            testStatus = "passed";
            testSummary = `APPLY — net positive on ${netPositive}/6 key areas. ${testDetails.recommendation.why?.[0] || ""}`;
          } else {
            testStatus = "failed";
            testSummary = `${verdict} — net positive on only ${netPositive}/6.${budgetSevere ? " Budget risk increased severely." : ""} ${testDetails.recommendation.why?.[0] || ""}`;
          }
        } else if (testStatus !== "error") {
          testStatus = "error";
          testSummary = "Simulation did not produce a recommendation verdict.";
        }
      } catch (simErr) {
        testStatus = "error";
        testSummary = `Simulation error: ${simErr instanceof Error ? simErr.message : String(simErr)}`;
        testLogs += `\nException: ${simErr}\n${simErr instanceof Error ? simErr.stack : ""}\n`;
      }

      // f) Update test_run
      await sb.from("document_assistant_test_runs").update({
        finished_at: new Date().toISOString(),
        status: testStatus,
        summary: testSummary,
        details: testDetails,
        logs: trimLogs(testLogs),
      }).eq("id", testRun.id);

      // g) Update action status
      const newActionStatus = testStatus === "passed" ? "ready_to_apply" : "test_failed";
      await sb.from("document_assistant_actions")
        .update({ status: newActionStatus }).eq("id", actionRow.id);

      actionResults.push({ actionId: actionRow.id, testRunId: testRun.id, status: newActionStatus, testStatus });
    }

    // 8) Fetch latest messages and actions for response
    const { data: messages } = await sb.from("document_assistant_messages")
      .select("*").eq("thread_id", threadId).order("created_at", { ascending: true }).limit(50);

    const { data: actions } = await sb.from("document_assistant_actions")
      .select("*, document_assistant_test_runs(*)").eq("thread_id", threadId)
      .order("created_at", { ascending: false }).limit(20);

    return new Response(JSON.stringify({ threadId, messages: messages || [], actions: actions || [], actionResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("document-assistant-run error:", err);
    const status = (err as Error).message === "RATE_LIMIT" ? 429
      : (err as Error).message === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
