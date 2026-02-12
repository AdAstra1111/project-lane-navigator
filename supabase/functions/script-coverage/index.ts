import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FORMAT_LABELS: Record<string, string> = {
  film: "Feature Film", "tv-series": "TV Series", documentary: "Documentary Feature",
  "documentary-series": "Documentary Series", commercial: "Commercial / Advert",
  "branded-content": "Branded Content", "short-film": "Short Film",
  "music-video": "Music Video", "proof-of-concept": "Proof of Concept",
  "digital-series": "Digital / Social Series", hybrid: "Hybrid Project",
  "vertical-drama": "Vertical Drama",
};

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, temperature = 0.25): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
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

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { projectId, scriptId, promptVersionId, draftLabel, scriptText, format, genres, lane } = await req.json();

    if (!scriptText || scriptText.length < 100) {
      return new Response(JSON.stringify({ error: "Script text too short for coverage analysis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const formatLabel = FORMAT_LABELS[format] || "Film";
    const truncatedScript = scriptText.slice(0, 80000);

    // Fetch house style
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: houseStyleRow } = await adminClient.from("house_style").select("preferences").limit(1).single();
    const houseStyle = houseStyleRow?.preferences || {};

    // Fetch prompt version
    let promptVersion: any = null;
    if (promptVersionId) {
      const { data } = await adminClient.from("coverage_prompt_versions").select("*").eq("id", promptVersionId).single();
      promptVersion = data;
    }
    if (!promptVersion) {
      const { data } = await adminClient.from("coverage_prompt_versions").select("*").eq("status", "active").limit(1).single();
      promptVersion = data;
    }

    if (!promptVersion) throw new Error("No active prompt version found");

    // Fetch great notes exemplars for RAG
    const { data: exemplars } = await adminClient
      .from("great_notes_library")
      .select("note_text, problem_type, evidence_style")
      .eq("project_type", formatLabel)
      .limit(8);

    const exemplarBlock = exemplars?.length
      ? "\n\nSTYLE EXEMPLARS (imitate specificity and structure, NOT content):\n" +
        exemplars.map((e: any, i: number) => `${i + 1}. [${e.problem_type}] ${e.note_text}`).join("\n")
      : "";

    const projectMeta = `PROJECT TYPE: ${formatLabel}\nGENRES: ${(genres || []).join(", ") || "Not specified"}\nLANE: ${lane || "Not specified"}\nHOUSE STYLE: ${JSON.stringify(houseStyle)}`;

    // =========== PASS A: ANALYST ===========
    const passAUser = `${projectMeta}\n\nSCRIPT TEXT:\n${truncatedScript}\n\n${truncatedScript.length >= 80000 ? "[Note: Script truncated at 80k chars]" : ""}`;
    const passAResult = await callAI(LOVABLE_API_KEY, promptVersion.analyst_prompt, passAUser, 0.2);

    // =========== PASS B: PRODUCER/STORY EDITOR ===========
    const passBUser = `${projectMeta}\n\nANALYST DIAGNOSTICS (Pass A):\n${passAResult}${exemplarBlock}\n\nProduce FINAL COVERAGE strictly matching the Output Contract.`;
    const passBResult = await callAI(LOVABLE_API_KEY, promptVersion.producer_prompt, passBUser, 0.3);

    // =========== PASS C: QC ===========
    const passCUser = `PASS B FINAL COVERAGE:\n${passBResult}\n\nPASS A DIAGNOSTICS (for cross-check):\n${passAResult.slice(0, 15000)}\n\nEnforce Output Contract. Remove vagueness. Flag hallucinations. Return JSON with cleaned_coverage, qc_changelog, hallucination_flags, metrics.`;
    const passCResult = await callAI(LOVABLE_API_KEY, promptVersion.qc_prompt, passCUser, 0.15);

    // Parse QC output
    const qcParsed = parseJSON(passCResult);
    const finalCoverage = qcParsed?.cleaned_coverage || passBResult;
    const metrics = qcParsed?.metrics || {};
    const hallucinations = qcParsed?.hallucination_flags || [];
    metrics.hallucinations_count = hallucinations.length;

    // Parse structured notes from final coverage (extract numbered bullets with IDs)
    const noteLines = finalCoverage.split("\n").filter((l: string) => l.match(/^[-•*]\s|^\d+\./));
    const structuredNotes = noteLines.map((line: string, i: number) => {
      const section = "S" + Math.floor(i / 5 + 1);
      return { id: `${section}-N${(i % 5) + 1}`, text: line.replace(/^[-•*\d.]+\s*/, "").trim() };
    });

    // Save coverage run
    const runData = {
      project_id: projectId,
      script_id: scriptId,
      prompt_version_id: promptVersion.id,
      model: "google/gemini-2.5-flash",
      project_type: formatLabel,
      lane: lane || null,
      inputs: { chunk_size: 80000, temperature: [0.2, 0.3, 0.15], exemplar_count: exemplars?.length || 0 },
      pass_a: passAResult,
      pass_b: passBResult,
      pass_c: passCResult,
      final_coverage: finalCoverage,
      structured_notes: structuredNotes,
      metrics,
      draft_label: draftLabel || "Draft 1",
      created_by: userId,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("coverage_runs")
      .insert(runData)
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("Failed to save coverage run:", insertErr);
      // Still return coverage even if save fails
    }

    // Also update project verdict for readiness scoring
    const recommendation = finalCoverage.match(/RECOMMEND|CONSIDER|PASS/)?.[0] || "CONSIDER";
    await supabase
      .from("projects")
      .update({ script_coverage_verdict: recommendation })
      .eq("id", projectId);

    return new Response(JSON.stringify({
      id: inserted?.id,
      created_at: inserted?.created_at,
      final_coverage: finalCoverage,
      structured_notes: structuredNotes,
      metrics,
      pass_a: passAResult,
      pass_b: passBResult,
      pass_c: passCResult,
      recommendation,
      qc_changelog: qcParsed?.qc_changelog || [],
      hallucination_flags: hallucinations,
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
