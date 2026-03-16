import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Gateway resolution: LOVABLE_API_KEY (OpenRouter) → OPENROUTER_API_KEY → OPENAI_API_KEY
// Matches the same priority as dev-engine-v2 _shared/llm.ts resolveGateway()
function resolveGatewayKey(): { key: string; baseUrl: string; model: string } {
  const lovable = Deno.env.get("OPENROUTER_API_KEY");
  if (lovable) return { key: lovable, baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash" };
  const openrouter = Deno.env.get("OPENROUTER_API_KEY");
  if (openrouter) return { key: openrouter, baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash" };
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) return { key: openai, baseUrl: "https://api.openai.com/v1", model: "gpt-4o" };
  throw new Error("No AI gateway key configured — set LOVABLE_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY");
}

async function callLLM(prompt: string, maxTokens = 8000): Promise<any> {
  const { key, baseUrl, model } = resolveGatewayKey();

  const MAX_RETRIES = 3;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.25,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastErr = new Error(`LLM gateway error: ${res.status} ${body.slice(0, 300)}`);
        if (res.status === 429 || res.status >= 500) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw lastErr;
      }

      const raw = (await res.json()).choices[0].message.content as string;

      // Strip markdown fences if present
      const cleaned = raw
        .replace(/^```json\s*/im, "")
        .replace(/^```\s*/im, "")
        .replace(/\s*```$/im, "")
        .trim();

      try { return JSON.parse(cleaned); }
      catch {
        const s = cleaned.indexOf("{"); const e = cleaned.lastIndexOf("}");
        if (s !== -1 && e !== -1) return JSON.parse(cleaned.slice(s, e + 1));
        throw new Error("No valid JSON in LLM response");
      }
    } catch (err: any) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
    }
  }
  throw lastErr ?? new Error("LLM call failed after retries");
}

async function storeDoc(
  sb: any, project_id: string, script_document_id: string, user_id: string | null,
  doc_type: string, doc_role: string, title: string, data: any
): Promise<string> {
  const content = JSON.stringify(data, null, 2);
  const plaintext = contentToPlaintext(data);

  const { data: doc, error } = await sb.from("project_documents")
    .upsert({ project_id, doc_type, doc_role, title, plaintext, user_id },
      { onConflict: "project_id,doc_type" })
    .select("id").single();
  if (error || !doc) throw new Error(`Failed to upsert ${doc_type}: ${error?.message}`);

  await sb.from("project_document_versions")
    .update({ is_current: false })
    .eq("document_id", doc.id).eq("is_current", true);

  const { data: ver } = await sb.from("project_document_versions").insert({
    document_id: doc.id, version_number: 1,
    plaintext: content, is_current: true,
    status: "draft", approval_status: "approved",
    created_by: user_id || null, is_stale: false,
    meta_json: { ci: 85, gp: 88, reverse_engineered: true, extracted_from: script_document_id },
  }).select("id").single();

  await sb.from("project_documents").update({ plaintext, latest_version_id: ver?.id }).eq("id", doc.id);
  return doc.id;
}

function contentToPlaintext(data: any): string {
  if (typeof data === "string") return data;
  return Object.entries(data)
    .map(([k, v]) => {
      if (v === null || v === undefined) return "";
      if (Array.isArray(v)) return `${k.toUpperCase().replace(/_/g,' ')}\n${v.map((i: any) => typeof i === "object" ? JSON.stringify(i, null, 2) : `• ${i}`).join("\n")}`;
      if (typeof v === "object") return `${k.toUpperCase().replace(/_/g,' ')}\n${JSON.stringify(v, null, 2)}`;
      return `${k.toUpperCase().replace(/_/g,' ')}\n${v}`;
    })
    .filter(Boolean).join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { project_id, script_document_id, script_version_id, user_id } = await req.json();
    if (!project_id || !script_document_id)
      return new Response(JSON.stringify({ error: "project_id and script_document_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Fetch script text — multi-fallback chain ─────────────────────────
    //
    // Priority:
    //   1. Explicit script_version_id → project_document_versions.plaintext
    //   2. project_documents.latest_version_id → project_document_versions.plaintext
    //   3. project_documents.plaintext (inline cache)
    //
    // Rationale: fresh uploads store content exclusively in project_document_versions.
    // project_documents.plaintext may be empty or stale until a pipeline doc is stored.

    let scriptText = "";

    // Path 1: explicit version ID (passed by UI if available)
    if (script_version_id) {
      const { data: v } = await sb.from("project_document_versions")
        .select("plaintext").eq("id", script_version_id).maybeSingle();
      scriptText = v?.plaintext || "";
    }

    // Path 2: latest_version_id on the document record
    if (!scriptText) {
      const { data: doc } = await sb.from("project_documents")
        .select("plaintext, latest_version_id").eq("id", script_document_id).maybeSingle();

      if (doc?.latest_version_id) {
        const { data: latestVer } = await sb.from("project_document_versions")
          .select("plaintext").eq("id", doc.latest_version_id).maybeSingle();
        scriptText = latestVer?.plaintext || "";
      }

      // Path 3: inline plaintext on the document itself (fallback)
      if (!scriptText && doc?.plaintext) {
        scriptText = doc.plaintext;
      }
    }

    // Path 4: most recent version by version_number if all else empty
    if (!scriptText) {
      const { data: latestVer } = await sb.from("project_document_versions")
        .select("plaintext")
        .eq("document_id", script_document_id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      scriptText = latestVer?.plaintext || "";
    }

    if (!scriptText || scriptText.length < 100) {
      return new Response(JSON.stringify({
        error: "Script text not found",
        detail: "No readable script text found in project_documents or project_document_versions for this document. Ensure the script has been uploaded and saved.",
        script_document_id,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isTV = /\b(episode|ep\.\s*\d|season \d|series \d|int\.\s+\w.*?—\s*ep)/i.test(scriptText.slice(0, 3000));
    const format = isTV ? "tv-series" : "film";
    const script = scriptText.slice(0, 42000);

    // ══════════════════════════════════════════════════════
    // CALL 1: Structural docs — concept brief, market sheet,
    //         story arc/treatment, voice profile
    // ══════════════════════════════════════════════════════
    const call1 = await callLLM(`You are a senior script analyst and development executive. Analyse this ${format} script with professional depth.

SCRIPT:
${script}

Return a JSON object with EXACTLY these top-level keys:

"metadata": {
  "title": "exact title from script",
  "logline": "one punchy sentence — inciting incident + protagonist + stakes",
  "genre": "primary genre",
  "subgenre": "secondary genre",
  "tone": "precise tone description (e.g. 'darkly comic thriller with romantic undertones')",
  "themes": ["theme1","theme2","theme3"],
  "target_audience": "specific demographic",
  "time_period": "when story is set",
  "locations": ["main location 1","main location 2"]
}

"concept_brief": {
  "premise": "3-4 sentence full premise — world, protagonist, inciting incident, central conflict, what's at stake",
  "why_now": "Why is this story urgent and relevant today?",
  "emotional_core": "What will the audience FEEL? What emotional experience does this deliver?",
  "unique_selling_points": ["USP 1","USP 2","USP 3"],
  "comparable_titles": ["Title (Year) — why it compares"],
  "development_notes": "Key strengths and areas to develop",
  "hook": "The one irresistible thing about this story"
}

"market_sheet": {
  "target_platforms": ["Netflix","A24","etc"],
  "audience_demographics": "Primary and secondary audience with specifics",
  "international_appeal": "Which markets and why",
  "production_tier": "micro-budget|low-budget|mid-range|high-end",
  "estimated_budget_range": "e.g. $5M-$15M",
  "awards_potential": "honest assessment with specific awards it could target",
  "franchise_potential": "sequel/spin-off/IP potential",
  "comparable_box_office": "what comparable titles earned",
  "sales_pitch": "Three punchy paragraphs: the hook, the story, the sell",
  "competitive_positioning": "What gap in the market does this fill?"
}

"treatment": {
  "logline": "one sentence",
  "synopsis": "Full story synopsis in present tense — 6-8 paragraphs covering all three acts in detail",
  "act_1": "What happens in Act 1 — inciting incident, protagonist goal established",
  "act_2a": "First half of Act 2 — complications, midpoint",
  "midpoint": "The midpoint reversal/revelation",
  "act_2b": "Second half of Act 2 — darkest moment, all-is-lost",
  "act_3": "Act 3 — climax and resolution",
  "central_question": "The dramatic question the story answers",
  "thematic_statement": "What does this story ultimately say?",
  "setup_payoffs": [{"setup": "detail planted early","payoff": "how it pays off later"}]
}

"voice_profile": {
  "overall_style": "3-4 sentences on the writer's voice — what makes it distinctive",
  "dialogue_style": "How characters speak — rhythm, subtext, specificity",
  "scene_writing": "How scenes are constructed — length, density, visual language",
  "pacing": "How the script moves — scene length variation, tension management",
  "vocabulary_level": "Precise descriptor: 'literary', 'street vernacular', 'elevated commercial', etc",
  "humour_style": "Type and frequency of humour, or null if absent",
  "signature_techniques": ["Specific technique this writer uses regularly","another technique","another"],
  "comparable_writers": ["Writer whose voice this resembles — one sentence why"],
  "strengths": ["What this voice does exceptionally well"],
  "growth_areas": ["Where the voice could be elevated with development"],
  "rewrite_instructions": "Detailed instructions for an AI to write in this voice — rhythm, vocabulary, dialogue approach, scene construction, what to avoid"
}`, 10000);

    // ══════════════════════════════════════════════════════
    // CALL 2: Beat sheet + character bible in parallel-ish
    // (two separate prompts, run sequentially but optimised)
    // ══════════════════════════════════════════════════════
    const [call2, call3] = await Promise.all([
      // Beat sheet — actual scene-by-scene story beats
      callLLM(`You are a professional script analyst. Extract a complete BEAT SHEET from this ${format} script.

A beat sheet lists every significant story beat — the structural turning points, emotional shifts, and key moments that drive the narrative. Think Save the Cat / Blake Snyder structure but mapped precisely to THIS script.

SCRIPT:
${script}

Return JSON with:
{
  "title": "string",
  "total_beats": number,
  "structure_model": "which structural model best fits (e.g. '3-act', 'hero's journey', 'non-linear')",
  "beats": [
    {
      "number": 1,
      "name": "Beat name (e.g. 'Opening Image', 'Inciting Incident', 'Break into Two', 'Midpoint', 'Dark Night of the Soul', 'Climax', 'Resolution')",
      "page_range": "e.g. pp.1-5",
      "description": "What happens — be specific to THIS script, not generic",
      "emotional_shift": "What the audience feels at this moment",
      "protagonist_state": "Where the protagonist is emotionally/situationally",
      "dramatic_function": "Why this beat is essential to the story"
    }
  ],
  "structural_notes": "Overall assessment of how well the story is structured",
  "pacing_notes": "Where the script moves well and where it drags",
  "turning_points": ["The 5-7 most important turning points in the script"]
}

Extract ALL major beats — aim for 30-60 beats for a feature, more for a longer script. Be specific to THIS story.`, 8000),

      // Character bible — deep profiles
      callLLM(`You are a casting director and script analyst. Write a COMPLETE CHARACTER BIBLE for this ${format} script.

SCRIPT:
${script}

For each named character (focus on speaking roles and named characters), write a full profile. Return JSON:
{
  "characters": [
    {
      "name": "Full name",
      "age": "specific age or range",
      "role": "protagonist|antagonist|deuteragonist|supporting|minor",
      "physical_description": "Specific physical details from the script or clearly implied — height, build, distinguishing features, how they carry themselves",
      "first_impression": "How they appear when we first meet them",
      "backstory": "What happened before the story starts — be specific to what the script reveals or implies",
      "psychology": "Core wound, deepest fear, what drives them beneath the surface",
      "want": "What they consciously want in the story",
      "need": "What they actually need (often different from want)",
      "fatal_flaw": "The character flaw that creates their central problem",
      "arc": "Precisely how they change (or fail to change) across the story",
      "arc_moments": ["The 3-5 key moments that define their arc"],
      "voice_and_speech": "How they speak — rhythm, vocabulary, what they say vs what they mean, subtext",
      "sample_dialogue": "A line or exchange that perfectly captures their voice",
      "relationships": {"character_name": "nature of relationship and dynamic"},
      "wardrobe_notes": "How they dress — what it says about them",
      "casting_archetype": "The type of actor this role requires",
      "casting_suggestions": ["2-3 real actor names who could play this role"]
    }
  ],
  "relationship_dynamics": "Paragraph describing the key relationship tensions that drive the story",
  "ensemble_notes": "How the characters work together as an ensemble — contrasts, echoes, thematic groupings"
}

Be thorough and specific to THIS script. Use dialogue and scenes as evidence.`, 8000),
    ]);

    const { metadata } = call1;
    const stored: string[] = [];

    // Store concept brief
    await storeDoc(sb, project_id, script_document_id, user_id,
      "concept_brief", "creative_primary", `${metadata.title} — Concept Brief`,
      { title: metadata.title, logline: metadata.logline, genre: metadata.genre, subgenre: metadata.subgenre, tone: metadata.tone, themes: metadata.themes, target_audience: metadata.target_audience, time_period: metadata.time_period, ...call1.concept_brief });
    stored.push("concept_brief");

    // Market sheet
    const marketType = isTV ? "vertical_market_sheet" : "market_sheet";
    await storeDoc(sb, project_id, script_document_id, user_id,
      marketType, "creative_primary", `${metadata.title} — Market Sheet`,
      { title: metadata.title, logline: metadata.logline, genre: metadata.genre, format, ...call1.market_sheet });
    stored.push(marketType);

    // Treatment / Season Arc
    const arcType = isTV ? "season_arc" : "treatment";
    await storeDoc(sb, project_id, script_document_id, user_id,
      arcType, "creative_primary", `${metadata.title} — ${isTV ? "Season Arc" : "Treatment"}`,
      { title: metadata.title, logline: metadata.logline, format, ...call1.treatment });
    stored.push(arcType);

    // Beat Sheet / Format Rules
    const beatType = isTV ? "format_rules" : "beat_sheet";
    await storeDoc(sb, project_id, script_document_id, user_id,
      beatType, "creative_primary", `${metadata.title} — ${isTV ? "Format Rules" : "Beat Sheet"}`,
      call2);
    stored.push(beatType);

    // Character Bible
    await storeDoc(sb, project_id, script_document_id, user_id,
      "character_bible", "creative_primary", `${metadata.title} — Character Bible`,
      call3);
    stored.push("character_bible");

    // Story Outline (scene grid)
    const outlineType = isTV ? "episode_grid" : "story_outline";
    await storeDoc(sb, project_id, script_document_id, user_id,
      outlineType, "creative_primary", `${metadata.title} — ${isTV ? "Episode Grid" : "Story Outline"}`,
      { title: metadata.title, format, entries: call2.beats?.slice(0, 20)?.map((b: any, i: number) => ({ number: i + 1, title: b.name, description: b.description, emotional_shift: b.emotional_shift })) || [] });
    stored.push(outlineType);

    // Save voice profile to project canon
    const { data: canon } = await sb.from("project_canon").select("id, canon_json").eq("project_id", project_id).single();
    if (canon) {
      await sb.from("project_canon").update({
        canon_json: { ...(canon.canon_json || {}), voice_profile: call1.voice_profile, title: metadata.title }
      }).eq("id", canon.id);
    } else {
      await sb.from("project_canon").insert({
        project_id, canon_json: { voice_profile: call1.voice_profile, title: metadata.title }
      });
    }

    // Update project — use valid format keys from stage-ladders registry
    await sb.from("projects").update({
      title: metadata.title,
      lifecycle_stage: isTV ? "episode_grid" : "story_outline",
      format: isTV ? "tv-series" : "film",
    }).eq("id", project_id);

    return new Response(JSON.stringify({
      success: true,
      title: metadata.title,
      format,
      documents_created: stored,
      voice_profile_saved: true,
      voice_summary: call1.voice_profile?.overall_style,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[reverse-engineer-script] Fatal error:", err?.message ?? err);
    // Return structured error — client shows err.message in toast
    return new Response(JSON.stringify({
      error: err?.message ?? "Unexpected error in pipeline generation",
      stage: "pipeline_generation",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
