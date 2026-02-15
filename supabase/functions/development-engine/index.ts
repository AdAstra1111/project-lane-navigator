import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Tier 1 for deep analysis, Tier 2 for rewrite
const REVIEW_MODEL = "google/gemini-2.5-pro";
const REWRITE_MODEL = "google/gemini-3-flash-preview";

function extractJSON(raw: string): string {
  let content = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!content.trim().startsWith("{")) {
    const i = content.indexOf("{");
    if (i >= 0) content = content.slice(i);
  }
  const last = content.lastIndexOf("}");
  if (last >= 0) content = content.slice(0, last + 1);
  return content.trim();
}

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3, maxTokens = 6000): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");
    const t = await response.text();
    console.error("AI error:", response.status, t);
    throw new Error("AI analysis failed");
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1 — REVIEW
// ═══════════════════════════════════════════════════════════════

const REVIEW_SYSTEM_BASE = `You are IFFY, a Creative–Commercial Alignment Architect operating in iterative loop mode.
Your goal is convergence: High Creative Integrity AND High Greenlight Probability.
You produce strategic evolution, not random notes.

Evaluate the submitted material and return ONLY valid JSON:
{
  "ci_score": 0-100,
  "gp_score": 0-100,
  "gap": number,
  "convergence_status": "Healthy Divergence" | "Strategic Tension" | "Dangerous Misalignment",
  "primary_creative_risk": "one sentence",
  "primary_commercial_risk": "one sentence",
  "protect": ["items that are non-negotiable creative strengths"],
  "strengthen": ["items that need more force or clarity"],
  "clarify": ["items that are confusing or ambiguous"],
  "elevate": ["items that could reach higher"],
  "remove": ["items that are dragging the work down"]
}`;

// ═══════════════════════════════════════════════════════════════
// PHASE 2 — STRATEGIC NOTES
// ═══════════════════════════════════════════════════════════════

const NOTES_SYSTEM = `You are IFFY. Based on the review findings, convert them into ranked strategic notes.
Return ONLY valid JSON:
{
  "structural_adjustments": [{"note": "...", "impact": "high|medium|low", "convergence_lift": number}],
  "character_enhancements": [{"note": "...", "impact": "high|medium|low", "convergence_lift": number}],
  "escalation_improvements": [{"note": "...", "impact": "high|medium|low", "convergence_lift": number}],
  "lane_clarity_moves": [{"note": "...", "impact": "high|medium|low", "convergence_lift": number}],
  "packaging_magnetism_moves": [{"note": "...", "impact": "high|medium|low", "convergence_lift": number}],
  "risk_mitigation_fixes": [{"note": "...", "impact": "high|medium|low", "convergence_lift": number}]
}
Rank by highest convergence impact within each category.`;

// ═══════════════════════════════════════════════════════════════
// PHASE 3 — REWRITE
// ═══════════════════════════════════════════════════════════════

const REWRITE_SYSTEM = `You are IFFY. Rewrite the submitted material applying the approved strategic notes.
Rules:
- Preserve all PROTECT items.
- Do not flatten voice for minor commercial gain.
- Strengthen escalation.
- Increase clarity without sanitising edge.
- Improve packaging magnetism organically.

Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of what changed",
  "creative_preserved": "what creative elements were protected",
  "commercial_improvements": "what commercial improvements were introduced"
}`;

// ═══════════════════════════════════════════════════════════════
// PHASE 4 — REASSESS
// ═══════════════════════════════════════════════════════════════

const REASSESS_SYSTEM = `You are IFFY. Reassess the rewritten material.
You have the ORIGINAL scores. Compare and calculate deltas.

Return ONLY valid JSON:
{
  "ci_score": 0-100,
  "gp_score": 0-100,
  "gap": number,
  "convergence_status": "Healthy Divergence" | "Strategic Tension" | "Dangerous Misalignment",
  "delta_ci": number (positive = improvement),
  "delta_gp": number,
  "delta_gap": number (negative = improvement),
  "trajectory": "Converging" | "Eroding" | "Stalled" | "Strengthened" | "Over-Optimised",
  "summary": "2-3 sentence strategic assessment"
}`;

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized");

    const body = await req.json();
    const { action, sessionId, inputText, approvedNotes, format, genres, lane, budget, title, projectId } = body;

    // Build guardrails for this session
    const guardrails = buildGuardrailBlock({ productionType: format });
    console.log(`[development-engine] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);
    const REVIEW_SYSTEM = REVIEW_SYSTEM_BASE + "\n" + guardrails.textBlock;

    // ── CREATE SESSION ──
    if (action === "create-session") {
      const { data, error } = await supabase.from("dev_engine_sessions").insert({
        user_id: user.id,
        project_id: projectId || null,
        title: title || "Untitled Session",
        input_text: inputText || "",
        input_type: body.inputType || "concept",
        format, genres, lane, budget,
      }).select().single();
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PHASE 1: REVIEW ──
    if (action === "review") {
      if (!sessionId) throw new Error("sessionId required");

      const { data: session } = await supabase.from("dev_engine_sessions")
        .select("*").eq("id", sessionId).single();
      if (!session) throw new Error("Session not found");

      const materialText = (inputText || session.input_text || "").slice(0, 20000);
      const contextLine = [
        session.format && `FORMAT: ${session.format}`,
        session.genres?.length && `GENRES: ${session.genres.join(", ")}`,
        session.lane && `LANE: ${session.lane}`,
        session.budget && `BUDGET: ${session.budget}`,
      ].filter(Boolean).join("\n");

      const userPrompt = `${contextLine}\n\nMATERIAL:\n${materialText}`;
      const raw = await callAI(LOVABLE_API_KEY, REVIEW_MODEL, REVIEW_SYSTEM, userPrompt);
      let parsed: any;
      try { parsed = JSON.parse(extractJSON(raw)); } catch {
        // Repair
        const repair = await callAI(LOVABLE_API_KEY, "google/gemini-2.5-flash",
          "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 5000));
        parsed = JSON.parse(extractJSON(repair));
      }

      const iterNum = (session.current_iteration || 0) + 1;

      const { data: iteration, error: itErr } = await supabase.from("dev_engine_iterations").insert({
        session_id: sessionId,
        user_id: user.id,
        iteration_number: iterNum,
        phase: "review",
        ci_score: parsed.ci_score,
        gp_score: parsed.gp_score,
        gap: parsed.gap ?? Math.abs((parsed.ci_score || 50) - (parsed.gp_score || 50)),
        convergence_status: parsed.convergence_status,
        primary_creative_risk: parsed.primary_creative_risk,
        primary_commercial_risk: parsed.primary_commercial_risk,
        protect_items: parsed.protect || [],
        strengthen_items: parsed.strengthen || [],
        clarify_items: parsed.clarify || [],
        elevate_items: parsed.elevate || [],
        remove_items: parsed.remove || [],
        raw_ai_response: parsed,
      }).select().single();
      if (itErr) throw itErr;

      await supabase.from("dev_engine_sessions").update({
        current_iteration: iterNum,
        latest_ci: parsed.ci_score,
        latest_gp: parsed.gp_score,
        latest_gap: parsed.gap ?? Math.abs((parsed.ci_score || 50) - (parsed.gp_score || 50)),
        convergence_status: parsed.convergence_status,
      }).eq("id", sessionId);

      return new Response(JSON.stringify({ iteration, parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PHASE 2: STRATEGIC NOTES ──
    if (action === "notes") {
      if (!sessionId) throw new Error("sessionId required");

      const { data: session } = await supabase.from("dev_engine_sessions")
        .select("*").eq("id", sessionId).single();
      if (!session) throw new Error("Session not found");

      // Get latest review iteration
      const { data: latestIt } = await supabase.from("dev_engine_iterations")
        .select("*").eq("session_id", sessionId).order("iteration_number", { ascending: false }).limit(1).single();
      if (!latestIt) throw new Error("No review found");

      const reviewContext = JSON.stringify({
        ci_score: latestIt.ci_score,
        gp_score: latestIt.gp_score,
        gap: latestIt.gap,
        protect: latestIt.protect_items,
        strengthen: latestIt.strengthen_items,
        clarify: latestIt.clarify_items,
        elevate: latestIt.elevate_items,
        remove: latestIt.remove_items,
        creative_risk: latestIt.primary_creative_risk,
        commercial_risk: latestIt.primary_commercial_risk,
      });

      const userPrompt = `REVIEW FINDINGS:\n${reviewContext}\n\nMATERIAL EXCERPT:\n${(session.input_text || "").slice(0, 8000)}`;
      const raw = await callAI(LOVABLE_API_KEY, REVIEW_MODEL, NOTES_SYSTEM, userPrompt);
      let parsed: any;
      try { parsed = JSON.parse(extractJSON(raw)); } catch {
        const repair = await callAI(LOVABLE_API_KEY, "google/gemini-2.5-flash",
          "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 5000));
        parsed = JSON.parse(extractJSON(repair));
      }

      await supabase.from("dev_engine_iterations").update({
        phase: "notes",
        structural_adjustments: parsed.structural_adjustments || [],
        character_enhancements: parsed.character_enhancements || [],
        escalation_improvements: parsed.escalation_improvements || [],
        lane_clarity_moves: parsed.lane_clarity_moves || [],
        packaging_magnetism_moves: parsed.packaging_magnetism_moves || [],
        risk_mitigation_fixes: parsed.risk_mitigation_fixes || [],
      }).eq("id", latestIt.id);

      return new Response(JSON.stringify({ notes: parsed, iterationId: latestIt.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PHASE 3: REWRITE ──
    if (action === "rewrite") {
      if (!sessionId) throw new Error("sessionId required");

      const { data: session } = await supabase.from("dev_engine_sessions")
        .select("*").eq("id", sessionId).single();
      if (!session) throw new Error("Session not found");

      const { data: latestIt } = await supabase.from("dev_engine_iterations")
        .select("*").eq("session_id", sessionId).order("iteration_number", { ascending: false }).limit(1).single();
      if (!latestIt) throw new Error("No notes found");

      const protectItems = latestIt.protect_items || [];
      const approved = approvedNotes || [];

      const userPrompt = `PROTECT (non-negotiable):\n${JSON.stringify(protectItems)}

APPROVED STRATEGIC NOTES:\n${JSON.stringify(approved)}

MATERIAL TO REWRITE:\n${(session.input_text || "").slice(0, 15000)}`;

      const raw = await callAI(LOVABLE_API_KEY, REWRITE_MODEL, REWRITE_SYSTEM, userPrompt, 0.4, 10000);
      let parsed: any;
      try { parsed = JSON.parse(extractJSON(raw)); } catch {
        const repair = await callAI(LOVABLE_API_KEY, "google/gemini-2.5-flash",
          "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 8000));
        parsed = JSON.parse(extractJSON(repair));
      }

      await supabase.from("dev_engine_iterations").update({
        phase: "rewrite",
        rewritten_text: parsed.rewritten_text || "",
        changes_summary: parsed.changes_summary || "",
        creative_preserved: parsed.creative_preserved || "",
        commercial_improvements: parsed.commercial_improvements || "",
        approved_notes: approved,
      }).eq("id", latestIt.id);

      return new Response(JSON.stringify({ rewrite: parsed, iterationId: latestIt.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PHASE 4: REASSESS ──
    if (action === "reassess") {
      if (!sessionId) throw new Error("sessionId required");

      const { data: latestIt } = await supabase.from("dev_engine_iterations")
        .select("*").eq("session_id", sessionId).order("iteration_number", { ascending: false }).limit(1).single();
      if (!latestIt) throw new Error("No rewrite found");

      const userPrompt = `ORIGINAL SCORES:
CI: ${latestIt.ci_score}, GP: ${latestIt.gp_score}, Gap: ${latestIt.gap}

REWRITTEN MATERIAL:
${(latestIt.rewritten_text || "").slice(0, 15000)}

CHANGES APPLIED:
${latestIt.changes_summary || "None listed"}

Reassess and provide new scores with deltas.`;

      const raw = await callAI(LOVABLE_API_KEY, REVIEW_MODEL, REASSESS_SYSTEM, userPrompt);
      let parsed: any;
      try { parsed = JSON.parse(extractJSON(raw)); } catch {
        const repair = await callAI(LOVABLE_API_KEY, "google/gemini-2.5-flash",
          "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 5000));
        parsed = JSON.parse(extractJSON(repair));
      }

      await supabase.from("dev_engine_iterations").update({
        phase: "reassess",
        reassess_ci: parsed.ci_score,
        reassess_gp: parsed.gp_score,
        reassess_gap: parsed.gap ?? Math.abs((parsed.ci_score || 50) - (parsed.gp_score || 50)),
        reassess_convergence: parsed.convergence_status,
        delta_ci: parsed.delta_ci,
        delta_gp: parsed.delta_gp,
        delta_gap: parsed.delta_gap,
        trajectory: parsed.trajectory,
      }).eq("id", latestIt.id);

      // Update session
      const { data: session } = await supabase.from("dev_engine_sessions")
        .select("*").eq("id", sessionId).single();

      await supabase.from("dev_engine_sessions").update({
        latest_ci: parsed.ci_score,
        latest_gp: parsed.gp_score,
        latest_gap: parsed.gap ?? Math.abs((parsed.ci_score || 50) - (parsed.gp_score || 50)),
        convergence_status: parsed.convergence_status,
        trajectory: parsed.trajectory,
        // Update input_text to the rewritten version for next loop
        input_text: latestIt.rewritten_text || session?.input_text || "",
      }).eq("id", sessionId);

      return new Response(JSON.stringify({ reassess: parsed, iterationId: latestIt.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: Apply rewrite (user chooses to make rewrite the new input) ──
    if (action === "apply-rewrite") {
      if (!sessionId) throw new Error("sessionId required");
      const { data: latestIt } = await supabase.from("dev_engine_iterations")
        .select("rewritten_text").eq("session_id", sessionId).order("iteration_number", { ascending: false }).limit(1).single();
      if (!latestIt?.rewritten_text) throw new Error("No rewrite to apply");

      await supabase.from("dev_engine_sessions").update({
        input_text: latestIt.rewritten_text,
      }).eq("id", sessionId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("development-engine error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    const userMsg = msg === "RATE_LIMIT" ? "Rate limit exceeded. Try again in a moment."
      : msg === "PAYMENT_REQUIRED" ? "AI usage limit reached." : msg;
    return new Response(JSON.stringify({ error: userMsg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
