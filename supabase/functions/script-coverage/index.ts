import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FORMAT_LABELS: Record<string, string> = {
  film: "Feature Film", "tv-series": "TV Series", documentary: "Documentary Feature",
  "documentary-series": "Documentary Series", commercial: "Commercial / Advert",
  "branded-content": "Branded Content", "short-film": "Short Film",
  "music-video": "Music Video", "proof-of-concept": "Proof of Concept",
  "digital-series": "Digital / Social Series", hybrid: "Hybrid Project",
  "vertical-drama": "Vertical Drama",
};

const MAX_SCRIPT_CHARS = 15000;
const FAST_MODEL = "google/gemini-2.5-flash-lite";

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, temperature = 0.25): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55s per call max

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: FAST_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (response.status === 402) throw new Error("AI usage limit reached. Please add credits.");
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI analysis failed");
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseJSON(raw: string): any {
  try {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1].trim());
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { projectId, scriptId, promptVersionId, draftLabel, scriptText, format, genres, lane } = await req.json();

    if (!scriptText || scriptText.length < 100) {
      return new Response(JSON.stringify({ error: "Script text too short for coverage analysis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const formatLabel = FORMAT_LABELS[format] || "Film";
    const truncatedScript = scriptText.slice(0, MAX_SCRIPT_CHARS);
    const t0 = Date.now();
    console.log(`[coverage] start, input=${scriptText.length}, truncated=${truncatedScript.length}`);

    // Fetch prompt version
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: promptVersion } = promptVersionId 
      ? await adminClient.from("coverage_prompt_versions").select("*").eq("id", promptVersionId).single()
      : await adminClient.from("coverage_prompt_versions").select("*").eq("status", "active").limit(1).single();

    if (!promptVersion) throw new Error("No active prompt version found");
    console.log(`[coverage] db done ${Date.now() - t0}ms`);

    const projectMeta = `TYPE: ${formatLabel} | GENRES: ${(genres || []).join(", ") || "N/A"} | LANE: ${lane || "N/A"}`;

    // =========== PASS A: ANALYST (diagnostic read) ===========
    const passAResult = await callAI(
      LOVABLE_API_KEY,
      promptVersion.analyst_prompt,
      `${projectMeta}\n\nSCRIPT:\n${truncatedScript}`,
      0.2
    );
    console.log(`[coverage] A done ${Date.now() - t0}ms`);

    // =========== PASS B: PRODUCER (final coverage + structured notes) ===========
    const passBSystem = promptVersion.producer_prompt + `

ALSO include a "structured_notes" JSON array at the end of your response inside a \`\`\`json block.
Each note: {"note_id":"N-001","section":"string","category":"structure|character|dialogue|theme|market|pacing|stakes|tone","priority":1-3,"title":"short","note_text":"full note","prescription":"what to do","tags":["act1"]}`;

    const passBResult = await callAI(
      LOVABLE_API_KEY,
      passBSystem,
      `${projectMeta}\n\nANALYST DIAGNOSTICS:\n${passAResult}\n\nProduce FINAL COVERAGE with verdict (RECOMMEND/CONSIDER/PASS).`,
      0.3
    );
    console.log(`[coverage] B done ${Date.now() - t0}ms`);

    // Parse structured notes from Pass B
    let structuredNotes: any[] = [];
    const parsed = parseJSON(passBResult);
    if (parsed?.structured_notes && Array.isArray(parsed.structured_notes)) {
      structuredNotes = parsed.structured_notes.map((n: any, i: number) => ({
        note_id: n.note_id || `N-${String(i + 1).padStart(3, '0')}`,
        section: n.section || 'GENERAL',
        category: n.category || 'general',
        priority: n.priority || 2,
        title: n.title || n.note_text?.slice(0, 60) || `Note ${i + 1}`,
        note_text: n.note_text || '',
        evidence: Array.isArray(n.evidence) ? n.evidence : [],
        prescription: n.prescription || '',
        safe_fix: n.safe_fix || '',
        bold_fix: n.bold_fix || '',
        tags: Array.isArray(n.tags) ? n.tags : [],
      }));
    } else {
      // Fallback: extract bullet points
      const noteLines = passBResult.split("\n").filter((l: string) => l.match(/^[-•*]\s|^\d+\./));
      structuredNotes = noteLines.slice(0, 20).map((line: string, i: number) => ({
        note_id: `N-${String(i + 1).padStart(3, '0')}`,
        section: 'GENERAL',
        category: 'general',
        priority: 2,
        title: line.replace(/^[-•*\d.]+\s*/, "").trim().slice(0, 60),
        note_text: line.replace(/^[-•*\d.]+\s*/, "").trim(),
        evidence: [],
        prescription: '',
        safe_fix: '',
        bold_fix: '',
        tags: [],
      }));
    }
    console.log(`[coverage] ${structuredNotes.length} notes, total ${Date.now() - t0}ms`);

    const finalCoverage = passBResult;
    const recommendation = finalCoverage.match(/RECOMMEND|CONSIDER|PASS/)?.[0] || "CONSIDER";

    // Save coverage run
    const { data: inserted, error: insertErr } = await supabase
      .from("coverage_runs")
      .insert({
        project_id: projectId,
        script_id: scriptId,
        prompt_version_id: promptVersion.id,
        model: FAST_MODEL,
        project_type: formatLabel,
        lane: lane || null,
        inputs: { chunk_size: MAX_SCRIPT_CHARS, temperature: [0.2, 0.3] },
        pass_a: passAResult,
        pass_b: passBResult,
        pass_c: "",
        final_coverage: finalCoverage,
        structured_notes: structuredNotes,
        metrics: { notes_count: structuredNotes.length, elapsed_ms: Date.now() - t0 },
        draft_label: draftLabel || "Draft 1",
        created_by: userId,
      })
      .select("id, created_at")
      .single();

    if (insertErr) console.error("Save error:", insertErr);

    // Update project verdict
    await supabase.from("projects").update({ script_coverage_verdict: recommendation }).eq("id", projectId);

    console.log(`[coverage] complete in ${Date.now() - t0}ms`);

    return new Response(JSON.stringify({
      id: inserted?.id,
      created_at: inserted?.created_at,
      final_coverage: finalCoverage,
      structured_notes: structuredNotes,
      metrics: { notes_count: structuredNotes.length, elapsed_ms: Date.now() - t0 },
      pass_a: passAResult,
      pass_b: passBResult,
      pass_c: "",
      recommendation,
      qc_changelog: [],
      hallucination_flags: [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("script-coverage error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
