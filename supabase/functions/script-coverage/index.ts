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

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, temperature = 0.25, model = "google/gemini-2.5-flash"): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
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

// Infer top problem types from Pass A output for targeted RAG retrieval
function inferProblemTypes(passAOutput: string): string[] {
  const problemKeywords: Record<string, string[]> = {
    structure: ["structure", "act ", "turning point", "midpoint", "climax", "sequence", "plot"],
    character: ["character", "protagonist", "antagonist", "arc", "motivation", "want", "need"],
    dialogue: ["dialogue", "exposition", "subtext", "voice", "speech"],
    theme: ["theme", "thematic", "meaning", "message", "moral"],
    pacing: ["pacing", "pace", "slow", "rushed", "tempo", "momentum"],
    stakes: ["stakes", "tension", "conflict", "jeopardy", "risk"],
    tone: ["tone", "tonal", "mood", "atmosphere", "genre consistency"],
    market: ["market", "audience", "commercial", "positioning", "buyer", "sales"],
  };

  const lower = passAOutput.toLowerCase();
  const scores: [string, number][] = Object.entries(problemKeywords).map(([type, keywords]) => {
    const count = keywords.reduce((sum, kw) => sum + (lower.split(kw).length - 1), 0);
    return [type, count];
  });

  scores.sort((a, b) => b[1] - a[1]);
  return scores.filter(s => s[1] > 0).slice(0, 4).map(s => s[0]);
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
    const truncatedScript = scriptText.slice(0, 50000);

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

    const projectMeta = `PROJECT TYPE: ${formatLabel}\nGENRES: ${(genres || []).join(", ") || "Not specified"}\nLANE: ${lane || "Not specified"}\nHOUSE STYLE: ${JSON.stringify(houseStyle)}`;

    // =========== PASS A: ANALYST ===========
    const passAUser = `${projectMeta}\n\nSCRIPT TEXT:\n${truncatedScript}\n\n${truncatedScript.length >= 50000 ? "[Note: Script truncated at 50k chars]" : ""}`;
    const passAResult = await callAI(LOVABLE_API_KEY, promptVersion.analyst_prompt, passAUser, 0.2);

    // =========== RAG: Retrieve great notes based on Pass A problem types ===========
    const inferredTypes = inferProblemTypes(passAResult);
    console.log("Inferred problem types for RAG:", inferredTypes);

    let exemplarBlock = "";
    if (inferredTypes.length > 0) {
      // Fetch exemplars matching project_type AND inferred problem types
      const { data: targetedExemplars } = await adminClient
        .from("great_notes_library")
        .select("note_text, problem_type, evidence_style")
        .eq("project_type", formatLabel)
        .in("problem_type", inferredTypes)
        .limit(6);

      // Also fetch a few general exemplars for breadth
      const { data: generalExemplars } = await adminClient
        .from("great_notes_library")
        .select("note_text, problem_type, evidence_style")
        .eq("project_type", formatLabel)
        .not("problem_type", "in", `(${inferredTypes.join(",")})`)
        .limit(4);

      const allExemplars = [...(targetedExemplars || []), ...(generalExemplars || [])];

      if (allExemplars.length > 0) {
        exemplarBlock = "\n\nSTYLE EXEMPLARS (imitate specificity and structure, NOT content):\n" +
          allExemplars.map((e: any, i: number) => `${i + 1}. [${e.problem_type}] ${e.note_text}`).join("\n");
      }
    } else {
      // Fallback: fetch any exemplars for the project type
      const { data: exemplars } = await adminClient
        .from("great_notes_library")
        .select("note_text, problem_type, evidence_style")
        .eq("project_type", formatLabel)
        .limit(8);

      if (exemplars?.length) {
        exemplarBlock = "\n\nSTYLE EXEMPLARS (imitate specificity and structure, NOT content):\n" +
          exemplars.map((e: any, i: number) => `${i + 1}. [${e.problem_type}] ${e.note_text}`).join("\n");
      }
    }

    // =========== PASS B: PRODUCER/STORY EDITOR ===========
    const passBUser = `${projectMeta}\n\nANALYST DIAGNOSTICS (Pass A):\n${passAResult}${exemplarBlock}\n\nProduce FINAL COVERAGE strictly matching the Output Contract.`;
    const passBResult = await callAI(LOVABLE_API_KEY, promptVersion.producer_prompt, passBUser, 0.3);

    // =========== PASS C: QC + STRUCTURED NOTES (merged to avoid timeout) ===========
    const passCSystem = promptVersion.qc_prompt + `

ADDITIONAL REQUIREMENT: After the QC fields, include a "structured_notes" array in your JSON output.
Extract ALL actionable notes from the coverage into this array. Each note object:
{
  "note_id": "N-001",
  "section": "WHAT'S NOT WORKING",
  "category": "structure",  // structure|character|dialogue|theme|market|pacing|stakes|tone
  "priority": 1,            // 1=core, 2=important, 3=optional
  "title": "Short title",
  "note_text": "Full note text",
  "evidence": [{"type":"scene","ref":"SCENE 12 — ..."}],
  "prescription": "What to do about it",
  "safe_fix": "Conservative fix",
  "bold_fix": "Ambitious fix",
  "tags": ["act1","stakes"]
}
Rules: sequential IDs (N-001, N-002...), every note needs evidence, category must be one of 8 values.`;

    const passCUser = `PASS B FINAL COVERAGE:\n${passBResult}\n\nPASS A DIAGNOSTICS (for cross-check):\n${passAResult.slice(0, 15000)}\n\nEnforce Output Contract. Remove vagueness. Flag hallucinations. Return JSON with cleaned_coverage, qc_changelog, hallucination_flags, metrics, AND structured_notes array.`;
    const passCResult = await callAI(LOVABLE_API_KEY, passCSystem, passCUser, 0.15, "google/gemini-2.5-flash-lite");

    // Parse QC output (now includes structured_notes)
    const qcParsed = parseJSON(passCResult);
    const finalCoverage = qcParsed?.cleaned_coverage || passBResult;
    const metrics = qcParsed?.metrics || {};
    const hallucinations = qcParsed?.hallucination_flags || [];
    metrics.hallucinations_count = hallucinations.length;
    metrics.inferred_problem_types = inferredTypes;
    metrics.exemplar_count = exemplarBlock ? (exemplarBlock.match(/\d+\./g)?.length || 0) : 0;

    // Extract structured notes from QC output
    let structuredNotes: any[] = [];
    const rawNotes = qcParsed?.structured_notes;
    if (Array.isArray(rawNotes) && rawNotes.length > 0) {
      structuredNotes = rawNotes.map((n: any, i: number) => ({
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
      // Fallback: parse bullet points from final coverage
      const noteLines = finalCoverage.split("\n").filter((l: string) => l.match(/^[-•*]\s|^\d+\./));
      structuredNotes = noteLines.map((line: string, i: number) => ({
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
    console.log(`Extracted ${structuredNotes.length} structured notes`);

    // Save coverage run
    const runData = {
      project_id: projectId,
      script_id: scriptId,
      prompt_version_id: promptVersion.id,
      model: "google/gemini-2.5-flash",
      project_type: formatLabel,
      lane: lane || null,
      inputs: {
        chunk_size: 50000,
        temperature: [0.2, 0.3, 0.15],
        exemplar_count: metrics.exemplar_count,
        inferred_problem_types: inferredTypes,
      },
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
    }

    // Update project verdict
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
