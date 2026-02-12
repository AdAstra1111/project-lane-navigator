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

    // Fetch corpus calibration for deviation scoring
    let corpusCalibration: any = null;
    let goldBaseline: any = null;
    try {
      const { data: calData } = await adminClient
        .from("corpus_insights")
        .select("pattern, production_type, insight_type")
        .in("insight_type", ["calibration", "gold_baseline"]);
      if (calData?.length) {
        const pt = (format || "").toLowerCase();
        const calRows = calData.filter((d: any) => d.insight_type === "calibration");
        corpusCalibration = calRows.find((d: any) => {
          const cpt = (d.production_type || "").toLowerCase();
          return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
        })?.pattern || calRows[0]?.pattern;
        const goldRows = calData.filter((d: any) => d.insight_type === "gold_baseline");
        goldBaseline = goldRows.find((d: any) => {
          const cpt = (d.production_type || "").toLowerCase();
          return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
        })?.pattern || goldRows.find((d: any) => d.production_type === "all")?.pattern;
      }
    } catch { /* non-critical */ }

    // Fetch Masterwork Canon benchmarks for genre-matched structural comparison
    let masterworkBlock = "";
    try {
      const scriptGenre = ((genres || [])[0] || "").toLowerCase();
      const scriptFormat = (format || "film").includes("tv") ? "tv-pilot" : "film";
      let query = adminClient.from("masterwork_canon").select("*").eq("active", true);
      // Try genre match first, fall back to format match
      const { data: genreMatches } = await query.eq("genre", scriptGenre).eq("format", scriptFormat).limit(5);
      let masterworks = genreMatches || [];
      if (masterworks.length < 3) {
        const { data: formatMatches } = await adminClient.from("masterwork_canon").select("*").eq("active", true).eq("format", scriptFormat).limit(6);
        masterworks = formatMatches || [];
      }
      if (masterworks.length > 0) {
        const avgAct1 = masterworks.reduce((s: number, m: any) => s + (m.act1_break_pct || 0), 0) / masterworks.length;
        const avgMidpoint = masterworks.reduce((s: number, m: any) => s + (m.midpoint_pct || 0), 0) / masterworks.length;
        const avgAct2 = masterworks.reduce((s: number, m: any) => s + (m.act2_break_pct || 0), 0) / masterworks.length;
        const avgInciting = masterworks.reduce((s: number, m: any) => s + (m.inciting_incident_pct || 0), 0) / masterworks.length;
        const commonEscalation = masterworks.map((m: any) => m.escalation_pattern).filter(Boolean);
        const commonThirdAct = masterworks.map((m: any) => m.third_act_type).filter(Boolean);
        const commonDialogue = masterworks.map((m: any) => m.dialogue_density).filter(Boolean);
        const commonDepth = masterworks.map((m: any) => m.thematic_depth).filter(Boolean);

        masterworkBlock = `

MASTERWORK CANON BENCHMARKS (from ${masterworks.length} proven ${scriptGenre || scriptFormat} scripts):
- Act 1 break: ~${Math.round(avgAct1)}% of script
- Inciting incident: ~${Math.round(avgInciting)}% of script
- Midpoint power shift: ~${Math.round(avgMidpoint)}% of script
- Act 2 break / Act 3 start: ~${Math.round(avgAct2)}% of script
- Common escalation patterns: ${[...new Set(commonEscalation)].join(", ")}
- Common third act types: ${[...new Set(commonThirdAct)].join(", ")}
- Typical dialogue density: ${[...new Set(commonDialogue)].join(", ")}
- Typical thematic depth: ${[...new Set(commonDepth)].join(", ")}
- Scene purpose density standard: ${masterworks[0]?.scene_purpose_density || "high"} to very-high
- Character objective clarity standard: ${masterworks[0]?.character_objective_clarity || "strong"} to razor-sharp
- Dialogue compression standard: ${masterworks[0]?.dialogue_compression || "tight"} to surgical

MASTERWORK COMPARISON RULES:
1. Compare the submitted script's act break timing, inciting incident placement, midpoint power shift, and escalation velocity against these benchmarks.
2. Compare scene purpose density, character objective clarity, and dialogue compression.
3. Assess emotional layering depth against masterwork standards.
4. If the script deviates SIGNIFICANTLY from masterwork structural norms, flag as: STRUCTURAL RISK
5. If pacing deviates significantly (late hooks, sluggish escalation, weak midpoint), flag as: PACING RISK
6. If character objectives are unclear or dialogue is unfocused compared to masterwork standards, flag as: CHARACTER DEPTH RISK
7. Do NOT soften notes if deviation is clear. Be direct and specific.
8. Reference patterns (e.g. "proven ${scriptGenre} scripts typically place the inciting incident by ${Math.round(avgInciting)}%") but do NOT name specific masterwork titles unless the user requests it.
9. Do NOT imitate or reproduce any creative content from reference scripts.`;
      }
    } catch (e) { console.error("[coverage] masterwork fetch error:", e); }

    // Fetch Commercial Proof benchmarks for viability comparison
    let commercialBlock = "";
    try {
      const scriptGenre = ((genres || [])[0] || "").toLowerCase();
      const scriptFormat = (format || "film").includes("tv") ? "tv-pilot" : "film";
      const { data: genreHits } = await adminClient.from("commercial_proof").select("*").eq("active", true).eq("genre", scriptGenre).limit(6);
      let commercials = genreHits || [];
      if (commercials.length < 3) {
        const { data: formatHits } = await adminClient.from("commercial_proof").select("*").eq("active", true).eq("format", scriptFormat).limit(8);
        commercials = formatHits || [];
      }
      if (commercials.length > 0) {
        const countHigh = (arr: any[], field: string, val: string) => arr.filter((m: any) => m[field] === val).length;
        const pctHigh = (field: string) => Math.round(countHigh(commercials, field, 'high') / commercials.length * 100);
        const commonROI = [...new Set(commercials.map((m: any) => m.roi_tier).filter(Boolean))];
        const commonFranchise = [...new Set(commercials.map((m: any) => m.franchise_potential).filter(Boolean))];
        const commonAudience = [...new Set(commercials.map((m: any) => m.audience_target).filter(Boolean))];

        commercialBlock = `

COMMERCIAL PROOF BENCHMARKS (from ${commercials.length} proven ${scriptGenre || scriptFormat} commercial hits):
- Hook clarity rated 'high' in ${pctHigh('hook_clarity')}% of proven hits
- Concept simplicity rated 'high' in ${pctHigh('concept_simplicity')}% of proven hits
- Trailer moment density rated 'high' in ${pctHigh('trailer_moment_density')}% of proven hits
- International travelability rated 'high' in ${pctHigh('international_travelability')}% of proven hits
- Streamer appeal rated 'high' in ${pctHigh('streamer_appeal')}% of proven hits
- Common ROI tiers: ${commonROI.join(", ")}
- Common franchise potential: ${commonFranchise.join(", ")}
- Common audience targets: ${commonAudience.join(", ")}

COMMERCIAL VIABILITY COMPARISON RULES:
1. Assess logline clarity — can the concept be grasped in one sentence?
2. Check hook within first 10 pages — is there a clear, compelling inciting moment?
3. Evaluate stakes clarity — are the consequences of failure concrete and escalating?
4. Identify marketable set pieces — are there 2-3 moments that would sell in a trailer?
5. Assess role attractiveness — would a bankable actor want this lead role?
6. Evaluate sequel/franchise potential — does the world support expansion?
7. Check budget-to-concept alignment — does the ambition match feasible production scale?
8. Assess genre promise fulfillment — does the script deliver what the genre audience expects?

COMMERCIAL RISK FLAGS:
- Strong artistic merit but weak commercial hooks → flag: MARKET RISK
- Strong concept but weak structural execution → flag: EXECUTION RISK
- High budget ambition with low international travelability → flag: FINANCE RISK

DUAL SCORING REQUIREMENT:
You MUST provide two separate scores in your coverage:
- STRUCTURAL STRENGTH (0-10): Based on craft, structure, character depth, pacing (calibrated against MASTERWORK_CANON)
- COMMERCIAL VIABILITY (0-10): Based on hook clarity, marketability, castability, audience appeal (calibrated against COMMERCIAL_PROOF)
Both scores must appear in the verdict section. Final coverage grade must reflect BOTH axes.
Do NOT soften commercial viability notes. If the script has weak hooks or low travelability, say so directly.`;
      }
    } catch (e) { console.error("[coverage] commercial proof fetch error:", e); }

    console.log(`[coverage] db done ${Date.now() - t0}ms, corpus=${corpusCalibration ? 'yes' : 'no'}, gold=${goldBaseline ? 'yes' : 'no'}, masterwork=${masterworkBlock ? 'yes' : 'no'}, commercial=${commercialBlock ? 'yes' : 'no'}`);

    let corpusDeviationBlock = "";
    if (corpusCalibration) {
      corpusDeviationBlock = `

CORPUS CALIBRATION DATA (from ${corpusCalibration.sample_size || 'N/A'} analyzed scripts of this format):
- Median page count: ${corpusCalibration.median_page_count || 'N/A'}
- Median scene count: ${corpusCalibration.median_scene_count || 'N/A'}
- Median dialogue ratio: ${corpusCalibration.median_dialogue_ratio ? Math.round(corpusCalibration.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Median runtime: ${corpusCalibration.median_runtime || 'N/A'} min
- Median midpoint position: ${corpusCalibration.median_midpoint_position || 'N/A'}

Include a "Deviation from Corpus Norms" section in your analysis. Compare the script against these medians and note significant deviations. Penalize structural score if the script deviates significantly from median structure/length without creative justification.`;
    }

    if (goldBaseline) {
      corpusDeviationBlock += `

GOLD BENCHMARK DATA (from ${goldBaseline.sample_size || 'N/A'} top-quality scripts):
- Gold median page count: ${goldBaseline.median_page_count || 'N/A'}
- Gold median scene count: ${goldBaseline.median_scene_count || 'N/A'}
- Gold median dialogue ratio: ${goldBaseline.median_dialogue_ratio ? Math.round(goldBaseline.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Gold quality score: ${goldBaseline.median_quality_score || 'N/A'}
- Gold midpoint position: ${goldBaseline.median_midpoint_position || 'N/A'}

Include a "Gold Benchmark Deviation" section noting how this script compares to the best-in-class corpus scripts. Highlight gaps between current draft and gold standard.

IMPORTANT: Do NOT imitate or copy any specific screenplay from the corpus. Use only numeric/structural targets derived from aggregate statistics.`;
    }

    const projectMeta = `TYPE: ${formatLabel} | GENRES: ${(genres || []).join(", ") || "N/A"} | LANE: ${lane || "N/A"}`;

    // =========== PASS A: ANALYST (diagnostic read) ===========
    const passAResult = await callAI(
      LOVABLE_API_KEY,
      promptVersion.analyst_prompt + corpusDeviationBlock + masterworkBlock + commercialBlock,
      `${projectMeta}\n\nSCRIPT:\n${truncatedScript}`,
      0.2
    );
    console.log(`[coverage] A done ${Date.now() - t0}ms`);

    // =========== PASS B: PRODUCER (final coverage + structured notes) ===========
    const passBSystem = promptVersion.producer_prompt + `

CRITICAL FORMAT INSTRUCTIONS:
1. Write your ENTIRE coverage report in plain English prose with markdown headings (##) and bullet points.
2. Start with the verdict line: **VERDICT: RECOMMEND** or **VERDICT: CONSIDER** or **VERDICT: PASS**
3. Include sections: Logline, Summary, Strengths, Areas for Improvement, Key Diagnostics, Market Assessment.
4. DO NOT return JSON for the main coverage. Write it as a readable document a producer would expect.
5. AFTER the prose coverage, include a "structured_notes" JSON array inside a \`\`\`json block.
Each note: {"note_id":"N-001","section":"string","category":"structure|character|dialogue|theme|market|pacing|stakes|tone","priority":1-3,"title":"short","note_text":"full note","prescription":"what to do","tags":["act1"]}`;

    const passBResult = await callAI(
      LOVABLE_API_KEY,
      passBSystem,
      `${projectMeta}\n\nANALYST DIAGNOSTICS:\n${passAResult}\n\nWrite a FINAL COVERAGE REPORT in plain English prose (not JSON) with verdict (RECOMMEND/CONSIDER/PASS). Use markdown headings and bullet points.`,
      0.3
    );
    console.log(`[coverage] B done ${Date.now() - t0}ms`);

    // Parse structured notes from Pass B
    let structuredNotes: any[] = [];
    const parsed = parseJSON(passBResult);
    if (parsed?.structured_notes && Array.isArray(parsed.structured_notes) && parsed.structured_notes.length > 0) {
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
    } else if (parsed?.problems_with_evidence && Array.isArray(parsed.problems_with_evidence)) {
      // AI returned structured JSON with problems_with_evidence instead of structured_notes
      structuredNotes = parsed.problems_with_evidence.map((p: any, i: number) => ({
        note_id: `N-${String(i + 1).padStart(3, '0')}`,
        section: 'GENERAL',
        category: 'general',
        priority: 2,
        title: (p.finding || '').slice(0, 60),
        note_text: p.finding || '',
        evidence: p.evidence ? [typeof p.evidence === 'string' ? p.evidence : JSON.stringify(p.evidence)] : [],
        prescription: '',
        safe_fix: '',
        bold_fix: '',
        tags: [],
      }));
      // Also add top_diagnostics as higher-priority notes
      if (parsed.top_diagnostics && Array.isArray(parsed.top_diagnostics)) {
        const offset = structuredNotes.length;
        for (const d of parsed.top_diagnostics) {
          structuredNotes.push({
            note_id: `D-${String(offset + structuredNotes.length + 1).padStart(3, '0')}`,
            section: 'DIAGNOSTICS',
            category: 'structure',
            priority: 1,
            title: (d.diagnosis || '').slice(0, 60),
            note_text: d.diagnosis || '',
            evidence: [],
            prescription: '',
            safe_fix: '',
            bold_fix: '',
            tags: ['diagnostic'],
          });
        }
      }
    } else {
      // Fallback: extract bullet points from prose
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

    // Build final coverage: if the AI returned pure JSON, extract prose from the structured data
    let finalCoverage = passBResult;
    
    // Check if the response is primarily JSON (starts with ``` or {)
    const trimmedB = passBResult.trim();
    const isPureJSON = trimmedB.startsWith('```') || trimmedB.startsWith('{');
    
    if (isPureJSON && parsed) {
      // AI returned structured JSON — synthesize a readable coverage from it
      const parts: string[] = [];
      if (parsed.verdict || parsed.recommendation) {
        parts.push(`**VERDICT: ${parsed.verdict || parsed.recommendation || 'CONSIDER'}**\n`);
      }
      if (parsed.logline) parts.push(`**Logline:** ${parsed.logline}\n`);
      if (parsed.summary) parts.push(`**Summary:** ${parsed.summary}\n`);
      if (parsed.strengths_with_evidence?.length) {
        parts.push('## Strengths');
        for (const s of parsed.strengths_with_evidence) {
          parts.push(`- **${s.finding}**${s.evidence ? ` — _"${String(s.evidence).slice(0, 120)}…"_` : ''}`);
        }
      }
      if (parsed.problems_with_evidence?.length) {
        parts.push('\n## Areas for Improvement');
        for (const p of parsed.problems_with_evidence) {
          parts.push(`- **${p.finding}**${p.evidence ? ` — _"${String(p.evidence).slice(0, 120)}…"_` : ''}`);
        }
      }
      if (parsed.top_diagnostics?.length) {
        parts.push('\n## Key Diagnostics');
        for (const d of parsed.top_diagnostics) {
          parts.push(`${d.rank}. ${d.diagnosis}`);
        }
      }
      finalCoverage = parts.join('\n');
    } else {
      // AI returned prose with an embedded JSON block — strip only the JSON block
      finalCoverage = passBResult
        .replace(/```(?:json)?\s*\{[\s\S]*?"structured_notes"[\s\S]*?\}[\s\S]*?```/g, '')
        .trim();
    }
    
    if (!finalCoverage || finalCoverage.length < 20) {
      // Last resort: generate minimal coverage from whatever we have
      if (parsed) {
        const fallbackParts: string[] = ['**VERDICT: CONSIDER**\n'];
        // Pull any text fields from the parsed object
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'string' && val.length > 20 && key !== 'structured_notes') {
            fallbackParts.push(`**${key.replace(/_/g, ' ')}:** ${val}\n`);
          }
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
            fallbackParts.push(`\n## ${key.replace(/_/g, ' ')}`);
            for (const item of val.slice(0, 10)) {
              const text = item.finding || item.diagnosis || item.note_text || JSON.stringify(item);
              fallbackParts.push(`- ${text}`);
            }
          }
        }
        finalCoverage = fallbackParts.join('\n');
      } else {
        finalCoverage = '**VERDICT: CONSIDER**\n\nCoverage analysis completed but output could not be formatted. Please check the Analysis Passes tab for raw results.';
      }
    }
    
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
