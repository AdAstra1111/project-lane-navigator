import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callLLM, MODELS, composeSystem } from "../_shared/llm.ts";
import { fetchCoreDocs } from "../_shared/coreDocs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Safe JSON extractor ─────────────────────────────────────────────────────
async function safeParse(text: string, apiKey: string): Promise<any> {
  // Try direct parse first
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch { /* fall through */ }
  }
  try { return JSON.parse(text); } catch { /* fall through */ }
  // Ask LLM to extract JSON
  const fixResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Extract the JSON object from this text. Return ONLY the raw JSON, no markdown." },
        { role: "user", content: text.slice(0, 8000) },
      ],
    }),
  });
  const fixData = await fixResp.json();
  const fixText = fixData.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(fixText); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const apiKey = Deno.env.get("LOVABLE_API_KEY") || serviceKey;

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const sbAnon = createClient(supabaseUrl, anonKey);
    const { data: { user } } = await sbAnon.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sbAdmin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { projectId, episodeNumber, episodeScriptId } = body;

    if (!projectId || !episodeNumber) {
      return new Response(JSON.stringify({ error: "projectId and episodeNumber required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Authz ──
    const { data: hasAccess } = await sbAdmin.rpc("has_project_access", {
      _user_id: user.id, _project_id: projectId,
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create run row ──
    const { data: run, error: runErr } = await sbAdmin.from("series_dev_notes_runs").insert({
      project_id: projectId,
      episode_number: episodeNumber,
      script_id: episodeScriptId || null,
      status: "running",
      started_by: user.id,
    }).select("id").single();
    if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
    const runId = run.id;

    let logs = "";
    const log = (msg: string) => {
      logs += `[${new Date().toISOString()}] ${msg}\n`;
      if (logs.length > 20000) logs = logs.slice(-18000);
    };

    try {
      // ── Fetch core docs ──
      log("Fetching core docs...");
      const coreDocs = await fetchCoreDocs(sbAdmin, projectId);

      // ── Fetch episode script text ──
      log(`Fetching episode ${episodeNumber} script...`);
      let scriptText = "";
      if (episodeScriptId) {
        const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", episodeScriptId).maybeSingle();
        scriptText = (s as any)?.text_content || "";
      }
      if (!scriptText) {
        const { data: ep } = await sbAdmin.from("series_episodes")
          .select("script_id, title").eq("project_id", projectId).eq("episode_number", episodeNumber).maybeSingle();
        if ((ep as any)?.script_id) {
          const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", (ep as any).script_id).maybeSingle();
          scriptText = (s as any)?.text_content || "";
        }
      }
      if (!scriptText) throw new Error(`No script text found for episode ${episodeNumber}`);
      log(`Script: ${scriptText.length} chars`);

      // ── Fetch canon facts for prior episodes ──
      const { data: canonFacts } = await sbAdmin.from("series_episode_canon_facts")
        .select("episode_number, recap, facts_json")
        .eq("project_id", projectId)
        .lt("episode_number", episodeNumber)
        .order("episode_number");

      let canonContext = "";
      let canonLen = 0;
      const MAX_CANON_CHARS = 8000;
      for (const f of (canonFacts || []) as any[]) {
        let block = `EP${f.episode_number}: ${f.recap || ""}`;
        if (f.facts_json && typeof f.facts_json === "object") {
          const fj = f.facts_json;
          const parts: string[] = [];
          if (fj.characters?.length) parts.push(`Characters: ${JSON.stringify(fj.characters).slice(0, 600)}`);
          if (fj.timeline_events?.length) parts.push(`Timeline: ${JSON.stringify(fj.timeline_events).slice(0, 400)}`);
          if (fj.world_rules?.length) parts.push(`Rules: ${JSON.stringify(fj.world_rules).slice(0, 300)}`);
          if (fj.relationships?.length) parts.push(`Relationships: ${JSON.stringify(fj.relationships).slice(0, 300)}`);
          if (fj.unresolved_threads?.length) parts.push(`Unresolved: ${JSON.stringify(fj.unresolved_threads).slice(0, 300)}`);
          if (parts.length) block += `\n  ${parts.join("\n  ")}`;
        }
        block += "\n";
        if (canonLen + block.length > MAX_CANON_CHARS) {
          const remaining = MAX_CANON_CHARS - canonLen;
          if (remaining > 100) canonContext += block.slice(0, remaining) + "...\n";
          break;
        }
        canonContext += block;
        canonLen += block.length;
      }

      // ── Build canon pack blocks ──
      const bibleBlock = coreDocs.characterBible ? `\n## CHARACTER BIBLE\n${coreDocs.characterBible.slice(0, 5000)}` : "";
      const arcBlock = coreDocs.seasonArc ? `\n## SEASON ARC\n${coreDocs.seasonArc.slice(0, 3000)}` : "";
      const gridBlock = coreDocs.episodeGrid ? `\n## EPISODE GRID\n${coreDocs.episodeGrid.slice(0, 4000)}` : "";
      const formatBlock = coreDocs.formatRules ? `\n## FORMAT RULES\n${coreDocs.formatRules.slice(0, 2000)}` : "";
      const priorCanonBlock = canonContext ? `\n## PRIOR EPISODE CANON (do not contradict)\n${canonContext}` : "";

      // ── Structured Episode Reviewer System Prompt ──
      const systemPrompt = composeSystem({
        baseSystem: `You are IFFY — EPISODE SCRIPT REVIEWER (SERIES-AWARE, EPISODE-SCOPED).

GOAL: Review ONLY Episode ${episodeNumber} as a "small part of the whole series".

Use the Series Overview / Episode Grid ONLY as:
(1) a CONTRACT for what Episode ${episodeNumber} must accomplish, and
(2) CONTINUITY CONSTRAINTS so the episode doesn't break canon.

DO NOT judge Episode ${episodeNumber} for not depicting events assigned to later episodes.

HARD RULES (NO EXCEPTIONS):
1) Episode-scoped grading: Grade ONLY against Episode ${episodeNumber}'s grid beats + any "must-plant" items assigned to it. Do NOT critique missing beats that belong to other episodes.
2) Future pivot references: Mention pivots in later episodes ONLY to evaluate whether Episode ${episodeNumber} contains REQUIRED setup signals assigned to it by the grid. If the grid does NOT assign setup for a pivot to this episode, state: "No setup obligation in Episode ${episodeNumber} for this pivot."
3) Evidence requirement: Every claim must include evidence from the script (scene heading or ≤20-word quote + approximate location).
4) Canon conflicts: Only flag conflicts that BREAK canon (character facts, timeline, world rules). Do not demand the episode "deliver the season."

OUTPUT STRUCTURE — return ONLY valid JSON with these exact keys:

{
  "episode_number": ${episodeNumber},
  "section_a": {
    "required_beats": ["beat 1", "beat 2", ...],
    "must_plant_setups": ["setup 1", ...],
    "end_state_promise": "what audience should feel/learn by end of this episode"
  },
  "section_b": {
    "beat_checks": [
      {
        "beat": "beat description from grid",
        "status": "PRESENT|PARTIAL|MISSING",
        "evidence": "scene heading or ≤20-word quote + location",
        "fix": "specific episode-scoped change if not PRESENT"
      }
    ],
    "setup_checks": [
      {
        "setup": "setup item description",
        "status": "PRESENT|PARTIAL|MISSING|NOT_REQUIRED",
        "evidence": "evidence or N/A",
        "fix": "how to plant subtly within this episode"
      }
    ]
  },
  "section_c": {
    "cold_open_hook": "assessment of cold open / hook effectiveness",
    "act_turns": "assessment of act breaks, midpoint, escalation",
    "climax_button": "does it leave a next-episode pull?",
    "character_turns": "character turns within this episode only",
    "pacing": "pacing assessment for vertical drama runtime"
  },
  "section_d": {
    "canon_conflicts": [],
    "season_alignment": "on track|off track",
    "alignment_bullets": ["bullet 1", "bullet 2"],
    "later_pivot_notes": ["note about setup obligation or 'No setup obligation in Episode ${episodeNumber} for this pivot.'"]
  },
  "section_e": {
    "patches": [
      {
        "name": "patch name",
        "where": "scene or sequence",
        "what": "specific change",
        "why": "ties back to episode contract item"
      }
    ]
  },
  "overall_grade": "A|B|C|D|F",
  "summary": "2-3 sentence overall assessment",
  "strengths": ["what's working well"],
  "canon_risk_count": 0,
  "notes": [],
  "canon_risk_notes": []
}

RULES:
- Section E: 5–12 concrete, episode-scoped patches only
- Section B: check every required beat from the grid
- Never demand later-episode content unless grid assigns it as must-plant for Episode ${episodeNumber}
- Be decisive, practical, evidence-backed
- Do NOT hallucinate plot points or characters not in the script
- "notes" and "canon_risk_notes" arrays are for backward compatibility — populate them from section_b beat_checks that are MISSING/PARTIAL`,
        guardrailsBlock: "Never suggest changes that contradict established canon facts or the character bible. If uncertain, mark it in canon_risk_notes.",
        conditioningBlock: priorCanonBlock || undefined,
      });

      const userPrompt = `${bibleBlock}${arcBlock}${gridBlock}${formatBlock}

## EPISODE ${episodeNumber} SCRIPT (TARGET — REVIEW THIS ONLY)
${scriptText.slice(0, 12000)}`;

      log("Calling AI for structured episode review...");
      const result = await callLLM({
        apiKey, model: MODELS.FAST,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.2, maxTokens: 8000,
      });

      const parsed = await safeParse(result.content, apiKey);

      // ── Backward-compat: ensure notes arrays exist ──
      if (!parsed.notes) parsed.notes = [];
      if (!parsed.canon_risk_notes) parsed.canon_risk_notes = [];
      if (!parsed.canon_risk_count) parsed.canon_risk_count = 0;
      if (!parsed.overall_grade) parsed.overall_grade = "C";
      if (!parsed.summary) parsed.summary = "Episode review complete.";
      if (!parsed.strengths) parsed.strengths = [];

      // ── Derive legacy notes from section_b for any UI that uses them ──
      const allBeatChecks = parsed.section_b?.beat_checks || [];
      const issueNotes = allBeatChecks
        .filter((b: any) => b.status === "MISSING" || b.status === "PARTIAL")
        .map((b: any) => ({
          tier: b.status === "MISSING" ? "blocking" : "high_impact",
          category: "structure",
          title: b.beat,
          detail: `Status: ${b.status}. Evidence: ${b.evidence || "none found."}`,
          suggestion: b.fix || "",
          canon_safe: true,
        }));

      // Supplement with any section_e patches as polish notes
      const patchNotes = (parsed.section_e?.patches || []).slice(0, 5).map((p: any) => ({
        tier: "polish",
        category: "craft",
        title: p.name,
        detail: `${p.where} — ${p.what}`,
        suggestion: p.why,
        canon_safe: true,
      }));

      parsed.notes = [...issueNotes, ...patchNotes];

      // Canon risk notes from section_d conflicts
      const canonConflicts = parsed.section_d?.canon_conflicts || [];
      parsed.canon_risk_notes = canonConflicts.map((c: any) => ({
        tier: "blocking",
        category: "canon",
        title: typeof c === "string" ? c : (c.issue || "Canon conflict"),
        detail: typeof c === "string" ? c : (c.evidence || ""),
        suggestion: typeof c === "string" ? "Resolve canon conflict" : (c.fix || "Resolve conflict"),
        canon_safe: false,
      }));
      parsed.canon_risk_count = parsed.canon_risk_notes.length;

      log(`Episode review complete. Grade: ${parsed.overall_grade}. Beats checked: ${allBeatChecks.length}. Patches: ${parsed.section_e?.patches?.length || 0}.`);

      // ── Update run ──
      await sbAdmin.from("series_dev_notes_runs").update({
        status: "completed",
        summary: parsed.summary,
        results_json: parsed,
        logs,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);

      return new Response(JSON.stringify({
        runId, status: "completed", results: parsed,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (innerErr: any) {
      log(`ERROR: ${innerErr.message}`);
      await sbAdmin.from("series_dev_notes_runs").update({
        status: "failed", summary: innerErr.message, logs,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
      throw innerErr;
    }

  } catch (e: any) {
    console.error("[series-dev-notes] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
