import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "google/gemini-2.5-flash";
const MAX_SAMPLE_CHARS = 12000;

async function callAI(apiKey: string, system: string, user: string): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI call failed: ${response.status} ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function extractJSON(raw: string): string {
  let c = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!c.trim().startsWith("{")) {
    const i = c.indexOf("{");
    if (i >= 0) c = c.slice(i);
  }
  const last = c.lastIndexOf("}");
  if (last >= 0) c = c.slice(0, last + 1);
  return c.trim();
}

const SYSTEM_PROMPT = `You are a writing voice profiler for a film/TV development platform. Given sample scripts/documents from a writer or writing team, analyze the writing style and produce a structured voice profile.

Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence summary of the writing voice",
  "do": ["5-8 specific things this writer tends to do well"],
  "dont": ["5-8 things this writer avoids or shouldn't do"],
  "knobs": {
    "dialogue_ratio": 0.0-1.0,
    "sentence_len_band": [min_words, max_words],
    "description_density": "low|medium|high",
    "subtext_level": "low|medium|high",
    "humor_temperature": "none|light|witty|high",
    "pace": "calm|standard|punchy",
    "tone_tags": ["tag1", "tag2"]
  },
  "signature_moves": ["distinctive patterns, e.g. 'button lines', 'hard scene cuts', 'metaphor-heavy action'],
  "banned_moves": ["things this writer never does"],
  "examples": {
    "micro_example": "A short example line that captures this voice",
    "rewrite_rule_example": "If given X, this voice would rewrite as Y"
  }
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || serviceKey;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { action } = body;

    if (action === "build_team_voice") {
      const { label, description, projectId, lane, sources } = body;
      if (!label || !sources?.length) {
        return new Response(JSON.stringify({ error: "label and sources required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Fetch doc text for each source
      const sampleTexts: string[] = [];
      const hasCowritten = sources.some((s: any) => s.isCowritten);

      for (const src of sources) {
        let text = "";
        if (src.versionId) {
          const { data: ver } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", src.versionId).single();
          text = ver?.plaintext || "";
        }
        if (!text && src.docId) {
          // Get latest version
          const { data: doc } = await supabase.from("project_documents")
            .select("latest_version_id").eq("id", src.docId).single();
          if (doc?.latest_version_id) {
            const { data: ver } = await supabase.from("project_document_versions")
              .select("plaintext").eq("id", doc.latest_version_id).single();
            text = ver?.plaintext || "";
          }
        }
        if (text) {
          sampleTexts.push(text.slice(0, MAX_SAMPLE_CHARS));
        }
      }

      if (sampleTexts.length === 0) {
        return new Response(JSON.stringify({ error: "No text found in selected documents" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const userPrompt = `Analyze the following ${sampleTexts.length} writing sample(s)${hasCowritten ? " (some are co-written)" : ""} and produce the voice profile.

${sampleTexts.map((t, i) => `=== SAMPLE ${i + 1} (${t.length} chars) ===\n${t}\n=== END SAMPLE ${i + 1} ===`).join("\n\n")}`;

      const raw = await callAI(apiKey, SYSTEM_PROMPT, userPrompt);
      const profileJson = JSON.parse(extractJSON(raw));

      if (hasCowritten) {
        profileJson.summary = `[Derived from co-written samples] ${profileJson.summary}`;
      }

      // Insert team_voice
      const { data: tv, error: tvErr } = await supabase.from("team_voices").insert({
        owner_user_id: user.id,
        label,
        description: description || null,
        lane_group: lane || null,
        profile_json: profileJson,
      }).select("id, label, updated_at, profile_json").single();

      if (tvErr) throw tvErr;

      // Insert sources
      const sourceRows = sources.map((s: any) => ({
        team_voice_id: tv.id,
        project_id: projectId || s.projectId,
        doc_id: s.docId,
        version_id: s.versionId || null,
        title: s.title || null,
        is_cowritten: s.isCowritten || false,
        cowriter_labels: s.cowriterLabels || [],
      }));
      await supabase.from("team_voice_sources").insert(sourceRows);

      return new Response(JSON.stringify({ teamVoice: tv }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === "update_team_voice") {
      const { teamVoiceId, description, sources } = body;
      if (!teamVoiceId) {
        return new Response(JSON.stringify({ error: "teamVoiceId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Verify ownership
      const { data: existing } = await supabase.from("team_voices")
        .select("id, owner_user_id, label").eq("id", teamVoiceId).single();
      if (!existing || existing.owner_user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Not found or not owner" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const updates: any = { updated_at: new Date().toISOString() };
      if (description !== undefined) updates.description = description;

      // If sources provided, regenerate profile
      if (sources?.length) {
        const sampleTexts: string[] = [];
        const hasCowritten = sources.some((s: any) => s.isCowritten);

        for (const src of sources) {
          let text = "";
          if (src.versionId) {
            const { data: ver } = await supabase.from("project_document_versions")
              .select("plaintext").eq("id", src.versionId).single();
            text = ver?.plaintext || "";
          }
          if (!text && src.docId) {
            const { data: doc } = await supabase.from("project_documents")
              .select("latest_version_id").eq("id", src.docId).single();
            if (doc?.latest_version_id) {
              const { data: ver } = await supabase.from("project_document_versions")
                .select("plaintext").eq("id", doc.latest_version_id).single();
              text = ver?.plaintext || "";
            }
          }
          if (text) sampleTexts.push(text.slice(0, MAX_SAMPLE_CHARS));
        }

        if (sampleTexts.length > 0) {
          const userPrompt = `Analyze the following ${sampleTexts.length} writing sample(s)${hasCowritten ? " (some are co-written)" : ""} and produce the voice profile.

${sampleTexts.map((t, i) => `=== SAMPLE ${i + 1} (${t.length} chars) ===\n${t}\n=== END SAMPLE ${i + 1} ===`).join("\n\n")}`;

          const raw = await callAI(apiKey, SYSTEM_PROMPT, userPrompt);
          const profileJson = JSON.parse(extractJSON(raw));
          if (hasCowritten) {
            profileJson.summary = `[Derived from co-written samples] ${profileJson.summary}`;
          }
          updates.profile_json = profileJson;
        }

        // Replace sources
        await supabase.from("team_voice_sources").delete().eq("team_voice_id", teamVoiceId);
        const sourceRows = sources.map((s: any) => ({
          team_voice_id: teamVoiceId,
          project_id: s.projectId,
          doc_id: s.docId,
          version_id: s.versionId || null,
          title: s.title || null,
          is_cowritten: s.isCowritten || false,
          cowriter_labels: s.cowriterLabels || [],
        }));
        await supabase.from("team_voice_sources").insert(sourceRows);
      }

      const { data: updated, error: uErr } = await supabase.from("team_voices")
        .update(updates).eq("id", teamVoiceId)
        .select("id, label, description, updated_at, profile_json").single();
      if (uErr) throw uErr;

      return new Response(JSON.stringify({ teamVoice: updated }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

  } catch (e) {
    console.error("team-voice-engine error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
