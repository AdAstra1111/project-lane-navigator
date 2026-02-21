import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";
import { composeSystem } from "../_shared/llm.ts";

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

const DEFAULT_SCRIPT_CHARS = 40000;
const MAX_SCRIPT_CHARS_CAP = 200000;
// Use flash model for both passes to stay within edge function time limits
const COVERAGE_MODEL = "google/gemini-2.5-flash";
const FAST_MODEL = "google/gemini-2.5-flash";

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, temperature = 0.25): Promise<string> {
  const controller = new AbortController();
  // 60s per AI call — two calls + DB ops must fit within ~150s edge function limit
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: COVERAGE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (response.status === 402) throw new Error("AI usage limit reached. Please add credits.");
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI analysis failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Coverage analysis timed out. Try a shorter script excerpt.");
    throw err;
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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { projectId, scriptId, promptVersionId, draftLabel, scriptText, format, genres, lane, documentaryMode, maxContextChars: reqMaxContext } = await req.json();

    if (!scriptText || scriptText.length < 100) {
      return new Response(JSON.stringify({ error: "Script text too short for coverage analysis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const isDocumentary = documentaryMode || ['documentary', 'documentary-series', 'hybrid-documentary'].includes(format);
    const formatLabel = FORMAT_LABELS[format] || "Film";
    // Dynamic context: use requested limit or default, capped at safety max
    const maxChars = typeof reqMaxContext === "number" && reqMaxContext > 0
      ? Math.min(reqMaxContext, MAX_SCRIPT_CHARS_CAP)
      : DEFAULT_SCRIPT_CHARS;
    const truncatedScript = scriptText.slice(0, maxChars);
    const t0 = Date.now();
    console.log(`[coverage] start, input=${scriptText.length}, using=${truncatedScript.length}/${maxChars}, documentary=${isDocumentary}`);

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

    // Fetch Failure Contrast patterns for risk detection
    let failureBlock = "";
    try {
      const scriptGenre = ((genres || [])[0] || "").toLowerCase();
      const { data: failures } = await adminClient.from("failure_contrast").select("*").eq("active", true).limit(20);
      if (failures?.length) {
        // Compute failure pattern prevalence
        const total = failures.length;
        const pctFlag = (field: string) => Math.round(failures.filter((f: any) => f[field] === true).length / total * 100);
        const commonWeaknesses = [...new Set(failures.map((f: any) => f.primary_weakness).filter(Boolean))];
        const genreFailures = failures.filter((f: any) => f.genre === scriptGenre);
        const avgInciting = failures.filter((f: any) => f.inciting_incident_page).reduce((s: number, f: any) => s + f.inciting_incident_page, 0) / (failures.filter((f: any) => f.inciting_incident_page).length || 1);

        failureBlock = `

FAILURE CONTRAST PATTERNS (from ${total} scripts that failed commercially or structurally):
- Average inciting incident in failed scripts: page ${Math.round(avgInciting)} (too late)
- ${pctFlag('late_inciting_incident')}% had late inciting incidents
- ${pctFlag('passive_protagonist')}% had passive protagonists (reactive > 60% of scenes)
- ${pctFlag('on_the_nose_dialogue')}% had on-the-nose dialogue (theme stated directly)
- ${pctFlag('no_midpoint_shift')}% lacked a meaningful midpoint power shift
- ${pctFlag('flat_escalation')}% had flat escalation (stakes not rising by Act 2B)
- ${pctFlag('costless_climax')}% had costless climaxes (resolved without protagonist sacrifice)
- Common primary weaknesses: ${commonWeaknesses.join(", ")}
${genreFailures.length > 0 ? `- Genre-specific failures (${scriptGenre}): ${genreFailures.map((f: any) => f.title).join(", ")}` : ''}

FAILURE PATTERN DETECTION RULES:
1. Check inciting incident placement — if after page 20 (film) or page 10 (pilot), flag concern.
2. Assess protagonist agency — is the lead driving events or reacting? If reactive > 60%, flag.
3. Check dialogue subtext — is theme explained directly through dialogue? If yes, flag.
4. Evaluate midpoint — is there a genuine power shift? If not, flag.
5. Check escalation — are stakes rising through Act 2B? If flat, flag.
6. Assess climax cost — does the protagonist sacrifice something meaningful? If not, flag.

If 3+ failure patterns are detected → flag as: DEVELOPMENT RISK
If budget ambition exceeds commercial viability patterns → flag as: FINANCE RISK
If tone is inconsistent within genre lane → flag as: GENRE EXECUTION RISK

REWRITE PRIORITY:
For each issue found, assign a rewrite priority:
- HIGH: Structural problems (late hook, no midpoint, flat escalation)
- MEDIUM: Character/dialogue issues (passive protagonist, on-the-nose dialogue)
- LOW: Polish-level issues (subtext refinement, scene trimming)

Include a "Development Roadmap" section with 3-5 prioritized rewrite steps.

CALIBRATION STANCE:
- If the script resembles FAILURE_CONTRAST patterns more than MASTERWORK_CANON or COMMERCIAL_PROOF, state this clearly.
- Do NOT soften critique. Be professional but decisive.
- Provide specific page-level notes where possible.`;
      }
    } catch (e) { console.error("[coverage] failure contrast fetch error:", e); }

    console.log(`[coverage] db done ${Date.now() - t0}ms, corpus=${corpusCalibration ? 'yes' : 'no'}, gold=${goldBaseline ? 'yes' : 'no'}, masterwork=${masterworkBlock ? 'yes' : 'no'}, commercial=${commercialBlock ? 'yes' : 'no'}, failure=${failureBlock ? 'yes' : 'no'}`);

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

    // Detect format type
    const isVertical = format === 'vertical-drama' || formatLabel.toLowerCase().includes('vertical');
    const isTV = !isVertical && !isDocumentary && (['tv-series', 'digital-series'].includes(format) ||
                 formatLabel.toLowerCase().includes('series') ||
                 formatLabel.toLowerCase().includes('limited'));

    // Build format-specific engine block
    let formatEngineBlock = "";
    if (isDocumentary) {
      formatEngineBlock = `

DOCUMENTARY STORY ENGINE — ACTIVATED (this is a DOCUMENTARY project, NOT scripted fiction)

You are IFFY's Documentary Story Engine.
You are not a screenwriter.
You are a high-level documentary story strategist, executive producer, festival programmer, legal risk evaluator, and impact producer combined.

CRITICAL REALITY-LOCK RULES:
- Do NOT create fictional characters, scenes, dialogue, or outcomes
- Do NOT add "composite characters"
- Only reference names, entities, claims, and events explicitly present in the submitted material
- If something is not confirmed, label it as UNKNOWN or HYPOTHESIS
- Every major claim must include an EVIDENCE NOTE: [Document Quote], [Confirmed], [Source Needed], [Not Yet Verified]

Assume real money, real reputations, and real legal consequences are involved.

Analyse the project across these 10 dimensions:

### 1. NARRATIVE GRAVITY (Score 0-10)
- Is there a compelling central question?
- Is there a clear human anchor?
- Are stakes tangible and escalating?
- Is there transformation or revelation?
- Is it cinematic or informational?
If it feels like a lecture instead of a film, explain why.

### 2. STRUCTURAL INTEGRITY (Score 0-10)
Identify the most appropriate structural model:
- Investigative / Character transformation / Rise and fall / Quest / Mosaic ensemble / Essay / Hybrid
Explain why it fits — and what is currently missing to execute it properly.
Map the likely narrative beats:
Opening → Inciting → Escalation → Midpoint shift → Crisis → Climax → Resolution
Identify structural weaknesses.

### 3. EMOTIONAL ARCHITECTURE (Score 0-10)
- Where are the emotional peaks?
- Where is vulnerability?
- Is there tension?
- Is there ambiguity fatigue?
- Does the story breathe?
If it lacks emotional propulsion, explain precisely what kind of scenes would fix it.

### 4. ACCESS & FRAGILITY ANALYSIS (Score 0-10)
Evaluate:
- Access stability
- Gatekeeper risk
- Political volatility
- Subject unpredictability
- Archive dependency
- Story collapse probability
If the main subject withdrew tomorrow, does the film survive?
Estimate story collapse risk: Low / Moderate / High / Severe — explain why.

### 5. LEGAL & ETHICAL EXPOSURE (Score 0-10, inverted: 10=low risk)
Identify potential:
- Defamation risk
- Consent gaps
- Minor vulnerability
- Power imbalance
- Exploitation optics
- Safety risk to crew or subjects
Flag serious exposure areas clearly but neutrally.
Suggest mitigation strategies.

### 6. MARKET POSITIONING (Score 0-10)
Assess likely fit for:
- Major streamer
- Public broadcaster
- Premium cable
- Festival premiere
- Impact-funded model
- Theatrical awards push
- Vertical / digital serialized
Is the topic saturated? Does it require exclusive access to justify attention?
Explain the most realistic monetisation lane.

### 7. GRANT & IMPACT POTENTIAL (Score 0-10)
Does this topic align with:
- Social justice funding
- Environmental funds
- Cultural heritage funds
- Political accountability grants
- NGO partnerships
Is this an impact film or a prestige entertainment doc?
Estimate grant probability: Low / Moderate / Strong / Very Strong — explain why.

### 8. COMMERCIAL VIABILITY vs RISK BALANCE (Score 0-10)
Is this:
- High prestige but legally dangerous?
- Safe but unremarkable?
- Cinematically bold but access-fragile?
- Fundable but hard to finish?
- Brilliant if lightning strikes?
Be honest.

### 9. RED FLAGS
Identify any of the following:
- Informational trap
- Over-reliance on archive
- Too many experts
- No protagonist
- No escalation
- Emotional monotony
- Moral ambiguity risk
- Market oversaturation

### 10. STRATEGIC RECOMMENDATIONS
Provide:
• 5 precise actions that would materially strengthen the film
• 3 alternative narrative angles if the current thesis weakens
• 3 scene types that must be captured to elevate the project
• 1 bold strategic pivot if required

DOCUMENTARY SCORING GRID:
Score each 0-10, use FULL range:

### DOCUMENTARY STORY ENGINE BENCHMARK GRID
| Dimension | Score |
|---|---|
| Narrative Gravity | X/10 |
| Structural Integrity | X/10 |
| Emotional Architecture | X/10 |
| Access & Fragility | X/10 |
| Legal & Ethical Safety | X/10 |
| Market Positioning | X/10 |
| Grant & Impact Potential | X/10 |
| Commercial Viability | X/10 |

**OVERALL NARRATIVE STRENGTH: X/10**
**ACCESS STABILITY: Low / Moderate / Strong**
**LEGAL RISK LEVEL: Low / Moderate / High / Severe**
**MARKET VIABILITY: Low / Moderate / Strong**
**GRANT POTENTIAL: Low / Moderate / Strong / Very Strong**
**IMPACT POTENTIAL: Low / Moderate / High / Transformational**
**STORY COLLAPSE PROBABILITY: X%**

GREENLIGHT SCORE: X/100
GRANT PROBABILITY: X/100
FESTIVAL PROBABILITY: X/100
IMPACT SCORE: X/100

DOCUMENTARY DEVELOPMENT TIERS (assign exactly one):
- Tier A — Commission Ready (all dimensions 7+, access secured)
- Tier B — Strong With Access Work (most 6+, access needs securing)
- Tier C — Development Required (access or legal gaps)
- Tier D — Concept Rethink Needed (market fit <4 or access <4)

FINANCE READINESS STATUS:
- GREEN — Submit to funds and broadcasters
- YELLOW — Secure access and legal clearance first
- RED — Development hold until access confirmed

DOCUMENTARY-SPECIFIC RISK FLAGS (check ALL):
- ACCESS FRAGILITY RISK
- LEGAL RISK
- POLITICAL RISK
- MARKET FIT RISK
- ARCHIVE COST RISK
- IMPACT GAP
- INSURANCE RISK
- INFORMATIONAL TRAP
- NO PROTAGONIST
- EMOTIONAL MONOTONY

Conclude with a short EXECUTIVE SUMMARY written as if speaking to a serious financier evaluating whether to back the film.`;
    } else if (isVertical) {
      formatEngineBlock = `

VERTICAL DRAMA ENGINE — ACTIVATED (this is a mobile-first short episodic project, NOT a feature film or traditional TV series)

CRITICAL: Do NOT evaluate using feature film or traditional TV logic. Use vertical/mobile-first episodic criteria.
Vertical dramas are 1-3 minute episodes, 30-100 episode arcs, high-hook, rapid-escalation narratives.

SECTION 1 — EPISODE MICRO-STRUCTURE (Score 0-10):

HOOK SPEED:
- Is there a dramatic hook within first 5-15 seconds?
- Does conflict appear immediately?
- If episode starts with slow exposition → flag: HOOK FAILURE

EMOTIONAL SPIKE:
- Is there a clear emotional beat (shock, betrayal, desire, fear) per episode?
- High emotional polarity is essential

CLIFFHANGER DENSITY:
- Does every episode end on a reversal, reveal, or threat?
- If no clear cliffhanger → flag: RETENTION RISK

CONFLICT CLARITY:
- Is the central relationship conflict obvious and intense?
- Romance / betrayal / revenge / power imbalance must be immediately clear

SECTION 2 — ARC ENGINE (Score 0-10):

CORE RELATIONSHIP TENSION:
- Love vs betrayal, power imbalance, secret identity, revenge drive
- Must be simple, intense, and renewable

ESCALATION CURVE:
- Does tension escalate every 3-5 episodes?
- Are reversals frequent?
- If escalation plateaus before episode 20 → flag: ARC COLLAPSE RISK

TWIST FREQUENCY:
- Is there a reveal at least every 2-3 episodes?

REWARD CYCLE:
- Does audience get small payoffs while larger tension builds?

SECTION 3 — ADDICTION METRICS (Score 0-10):

SCROLL-STOP FACTOR:
- Would viewer stop mid-feed to watch?

REWATCH MOMENT:
- Are there sharable, replayable moments?

SIMPLE PREMISE CLARITY:
- Can concept be understood in 1 sentence instantly?
- If premise requires complex world-building → flag: FORMAT MISALIGNMENT

ROMANCE / BETRAYAL INTENSITY:
- High emotional polarity is the #1 driver

VERTICAL-SPECIFIC RISK FLAGS (you MUST check all of these):
- If episode starts with slow exposition → HOOK FAILURE
- If no clear cliffhanger per episode → RETENTION RISK
- If premise requires complex world-building → FORMAT MISALIGNMENT
- If escalation plateaus before episode 20 → ARC COLLAPSE RISK

CALIBRATION RULES FOR VERTICAL:
- Do NOT evaluate thematic depth as primary metric
- Do NOT require subtlety
- Prioritise: Speed, Emotional polarity, Betrayal, Romance intensity, Revenge clarity
- Vertical drama is: High frequency, High emotion, High cliffhanger`;
    } else if (isTV) {
      formatEngineBlock = `

TV STRUCTURE ENGINE — ACTIVATED (this is an episodic project, NOT a feature film)

CRITICAL: Do NOT evaluate this script using feature film logic. Use series-specific development criteria.

SECTION 1 — PILOT EVALUATION (Episode 1):
Score each 0-10:

PILOT HOOK:
- Is there a compelling cold open?
- Is the premise clear within 10-15 pages?
- Does episode 1 end with a strong propulsion question?

SERIES ENGINE:
- Is there a sustainable narrative engine beyond episode 1?
- Does the premise generate 6-8 episodes minimum?
- Is conflict renewable (not exhaustible)?

CHARACTER LONGEVITY:
- Does protagonist have multi-season potential?
- Are secondary characters expandable?
- Is there evolving internal conflict that sustains across seasons?

WORLD DEPTH:
- Is the setting expandable?
- Does the world generate story organically?

CLIFFHANGER STRENGTH:
- Does the episode ending compel next-episode viewing?
- Is the hook organic, not manufactured?

SECTION 2 — SEASON ARC ANALYSIS:
If season outline or multi-episode content is provided:
- Season Question Clarity (is there a central season question?)
- Mid-season escalation event
- Episode escalation pattern
- Finale payoff strength
- Setup for future seasons

SECTION 3 — STREAMER ALIGNMENT:
Score 0-10:

BINGE PROPULSION:
- Does episode ending create "next episode" urgency?

ALGORITHM FRIENDLINESS:
- Strong genre signal?
- Clear audience targeting?
- Emotional intensity spikes?

RETENTION FACTOR:
- Reversal frequency
- Character reveal pacing
- Plot escalation rhythm

TV-SPECIFIC RISK FLAGS (you MUST check all of these):
- If pilot resolves central conflict fully → flag: SERIES ENGINE RISK
- If no clear season question → flag: STRUCTURAL RISK
- If protagonist arc completes in season 1 without future tension → flag: LONGEVITY RISK
- If tone shifts inconsistently between episodes → flag: TONAL RISK

CALIBRATION RULES FOR TV:
- Do NOT evaluate like a feature film
- Do NOT require full narrative closure
- Prioritise renewable conflict over clean resolution
- Prioritise hook density over thematic closure
- A great pilot OPENS questions, it doesn't close them`;
    }

    // =========== PASS A: ANALYST (diagnostic read) ===========
    const passAResult = await callAI(
      LOVABLE_API_KEY,
      promptVersion.analyst_prompt + corpusDeviationBlock + masterworkBlock + commercialBlock + failureBlock + formatEngineBlock,
      `${projectMeta}\n\nSCRIPT:\n${truncatedScript}`,
      0.2
    );
    console.log(`[coverage] A done ${Date.now() - t0}ms`);

    // =========== PASS B: PRODUCER (final coverage + structured notes + scoring grid) ===========
    // Format-specific scoring instructions
    let formatScoringInstructions = '';
    let formatNoteCategories = 'structure|character|dialogue|concept|pacing|genre|commercial';
    let formatTone = 'Professional producer. Clear. Non-academic. Solution-oriented.';
    let passBUserSuffix = '';

    if (isDocumentary) {
      formatNoteCategories = 'narrative_gravity|structural_integrity|emotional_architecture|access_fragility|legal_ethical|market_positioning|grant_impact|commercial_viability|red_flags|strategy';
      formatTone = 'Documentary story strategist. Evidence-anchored. Reality-locked. Financier-facing.';
      passBUserSuffix = ' This is a DOCUMENTARY project — use the 10-dimension Documentary Story Engine scoring (Narrative Gravity, Structural Integrity, Emotional Architecture, Access & Fragility, Legal & Ethical Safety, Market Positioning, Grant & Impact Potential, Commercial Viability). Do NOT use fiction/film categories. Every claim must include an evidence note. Conclude with an executive summary for a financier.';
      formatScoringInstructions = `

DOCUMENTARY STORY ENGINE SCORING (use this INSTEAD of the film grid):

Score each 0-10, use FULL range:

### DOCUMENTARY STORY ENGINE BENCHMARK GRID
| Dimension | Score |
|---|---|
| Narrative Gravity | X/10 |
| Structural Integrity | X/10 |
| Emotional Architecture | X/10 |
| Access & Fragility | X/10 |
| Legal & Ethical Safety | X/10 |
| Market Positioning | X/10 |
| Grant & Impact Potential | X/10 |
| Commercial Viability | X/10 |

**OVERALL NARRATIVE STRENGTH: X/10**
**GREENLIGHT SCORE: X/100**
**GRANT PROBABILITY: X/100**
**FESTIVAL PROBABILITY: X/100**
**IMPACT SCORE: X/100**
**STORY COLLAPSE PROBABILITY: X%**

DOCUMENTARY DEVELOPMENT TIERS (assign exactly one):
- Tier A — Commission Ready (all dimensions 7+)
- Tier B — Strong With Access Work (most 6+)
- Tier C — Development Required (access or legal gaps)
- Tier D — Concept Rethink Needed (market fit <4 or access <4)

DOCUMENTARY RISK FLAGS (include any that apply):
- ACCESS FRAGILITY RISK / LEGAL RISK / POLITICAL RISK / MARKET FIT RISK
- ARCHIVE COST RISK / IMPACT GAP / INSURANCE RISK
- INFORMATIONAL TRAP / NO PROTAGONIST / EMOTIONAL MONOTONY

FINANCE READINESS STATUS:
- GREEN — Submit to funds and broadcasters
- YELLOW — Secure access and legal clearance first
- RED — Development hold
`;
    } else if (isVertical) {
      formatNoteCategories = 'hook|arc|addiction|escalation|cliffhanger|premise';
      formatTone = 'Commercial strategist. Retention-obsessed. Data-aware.';
      passBUserSuffix = ' This is a VERTICAL DRAMA project — use vertical-specific scoring categories (Hook Speed, Cliffhanger Density, Escalation Curve, Addiction Potential, Market Simplicity), NOT film or TV categories.';
      formatScoringInstructions = `

VERTICAL DRAMA SCORING GRID (use this INSTEAD of the film/TV grid):

Score each 0-10, use FULL range, avoid safe-middle-6 inflation:

### VERTICAL PRODUCER BENCHMARK GRID
| Category | Score |
|---|---|
| Hook Speed | X/10 |
| Cliffhanger Density | X/10 |
| Escalation Curve | X/10 |
| Addiction Potential | X/10 |
| Market Simplicity | X/10 |

**HOOK SPEED: X/10**
**CLIFFHANGER DENSITY: X/10**
**ESCALATION CURVE: X/10**
**ADDICTION POTENTIAL: X/10**
**MARKET SIMPLICITY: X/10**
**OVERALL VERTICAL CONFIDENCE: X/10**

VERTICAL DEVELOPMENT TIERS (assign exactly one):
- Tier A — High Retention Potential (all categories 7+)
- Tier B — Strong Concept, Needs Hook Intensification (most 6+, hook/cliffhanger needs work)
- Tier C — Escalation Weakness (escalation <5 or addiction <5)
- Tier D — Not Format Appropriate (premise requires complex world-building or subtlety over speed)

VERTICAL RISK FLAGS (include any that apply):
- HOOK FAILURE: episode starts with slow exposition
- RETENTION RISK: no clear cliffhanger per episode
- FORMAT MISALIGNMENT: premise requires complex world-building incompatible with 1-3 min episodes
- ARC COLLAPSE RISK: escalation plateaus before episode 20
- If commercial viability weak: flag FINANCE RISK

FINANCE READINESS STATUS:
- GREEN — Commission and produce
- YELLOW — Hook/escalation adjustment needed
- RED — Format rethink required
`;
    } else if (isTV) {
      formatNoteCategories = 'pilot|engine|character|world|binge|streamer';
      formatTone = 'Professional development executive. Clear. Market-aware. Solution-oriented.';
      passBUserSuffix = ' This is a TV/SERIES project — use TV-specific scoring categories (Pilot Hook, Series Engine, Character Longevity, Binge Factor, Streamer Alignment), NOT film categories.';
      formatScoringInstructions = `

TV SERIES SCORING GRID (use this INSTEAD of the film grid for TV/series projects):

Score each 0-10, use FULL range, avoid safe-middle-6 inflation:

### TV PRODUCER BENCHMARK GRID
| Category | Score |
|---|---|
| Pilot Hook | X/10 |
| Series Engine | X/10 |
| Character Longevity | X/10 |
| World Depth | X/10 |
| Binge Factor | X/10 |
| Streamer Alignment | X/10 |

**PILOT STRENGTH: X/10**
**SERIES ENGINE: X/10**
**CHARACTER LONGEVITY: X/10**
**BINGE FACTOR: X/10**
**STREAMER ALIGNMENT: X/10**
**OVERALL SERIES CONFIDENCE: X/10**

TV DEVELOPMENT TIERS (assign exactly one):
- Tier A — Streamer-Ready Pilot (all categories 7+)
- Tier B — Strong With Engine Adjustment (most 6+, engine needs work)
- Tier C — Engine Needs Reinvention (series engine <5 or longevity <5)
- Tier D — Concept Rework Required (pilot hook <4 or 3+ categories <5)

TV RISK FLAGS (include any that apply):
- SERIES ENGINE RISK: pilot resolves central conflict, no renewable engine
- STRUCTURAL RISK: no clear season question
- LONGEVITY RISK: protagonist arc exhausted in season 1
- TONAL RISK: inconsistent tone across episodes
- BINGE RISK: weak episode endings, no propulsion
- If commercial viability weak: flag FINANCE RISK

FINANCE READINESS STATUS (same system):
- GREEN — Attach showrunner/talent and package
- YELLOW — Engine adjustment before packaging
- RED — Development hold
`;
    }

    const filmScoringBlock = (!isTV && !isVertical) ? `
PRODUCER SCORING GRID (0-10 per category, use FULL range, avoid safe-middle-6 inflation):

## Scoring Grid
Score each subcategory 0-10, then provide category averages:

STRUCTURE (avg of: Act clarity, Inciting incident timing, Midpoint power shift, Escalation momentum, Third act payoff)
CHARACTER (avg of: Protagonist agency, Clear objective, Internal conflict, Antagonistic force strength, Transformation arc)
DIALOGUE (avg of: Subtext presence, Compression efficiency, Character voice distinction, Exposition control)
CONCEPT (avg of: Logline clarity, Hook strength first 10 pages, Marketable premise, Originality vs familiarity balance)
PACING (avg of: Scene propulsion, Conflict density, Redundancy detection, Momentum consistency)
GENRE EXECUTION (avg of: Promise of premise delivered, Tone consistency, Audience expectation alignment)
COMMERCIAL VIABILITY (avg of: Budget-to-concept alignment, Castability of lead roles, International travelability, Sequel/franchise logic, Streamer alignment)

Include this exact format in your coverage:

### PRODUCER BENCHMARK GRID
| Category | Score |
|---|---|
| Structure | X/10 |
| Character | X/10 |
| Dialogue | X/10 |
| Concept | X/10 |
| Pacing | X/10 |
| Genre Execution | X/10 |
| Commercial Viability | X/10 |

**STRUCTURAL STRENGTH: X/10**
**COMMERCIAL VIABILITY: X/10**
**OVERALL PRODUCER CONFIDENCE: X/10**

RISK FLAGS (include any that apply):
- If any major category scores <5: flag HIGH DEVELOPMENT RISK
- If commercial viability <5 and budget ambition high: flag FINANCE RISK
- If structure strong (7+) but concept weak (<5): flag PACKAGING DEPENDENT
- If concept strong (7+) but execution weak (<5): flag REWRITE PRIORITY HIGH

DEVELOPMENT TIER (assign exactly one):
- Tier A — Packaging Ready (all categories 7+)
- Tier B — Strong With Targeted Rewrite (most categories 6+, 1-2 below)
- Tier C — Major Structural Rewrite Needed (structure or character <5)
- Tier D — Concept-Level Rebuild Required (concept <4 or 3+ categories <5)

FINANCE READINESS STATUS (assign exactly one):
- GREEN — Attach talent and package
- YELLOW — Rewrite before packaging
- RED — Development hold
` : '';

    const passBSystem = promptVersion.producer_prompt + formatScoringInstructions + `

CRITICAL FORMAT INSTRUCTIONS:
1. Write your ENTIRE coverage report in plain English prose with markdown headings (##) and bullet points.
2. Start with the verdict line: **VERDICT: RECOMMEND** or **VERDICT: CONSIDER** or **VERDICT: PASS**
3. Tone: ${formatTone}
4. DO NOT return JSON for the main coverage. Write it as a readable document.
` + filmScoringBlock + `
CALIBRATION:
- MASTERWORK_CANON (9-10 range) defines excellence benchmarks
- COMMERCIAL_PROOF defines market viability benchmarks
- FAILURE_CONTRAST defines risk detection patterns
- Use full 0-10 scale. A "6" means mediocre, not "pretty good"
- Score decisively. If the script resembles failure patterns, say so

5. AFTER the prose coverage and scoring grid, include a "structured_notes" JSON array inside a \`\`\`json block.
Each note: {"note_id":"N-001","section":"string","category":"${formatNoteCategories}","priority":1-3,"title":"short","note_text":"full note","prescription":"what to do","rewrite_priority":"high|medium|low","tags":["act1"]}`;

    const passBResult = await callAI(
      LOVABLE_API_KEY,
      passBSystem,
      `${projectMeta}\n\nANALYST DIAGNOSTICS:\n${passAResult}\n\nWrite a FINAL COVERAGE REPORT with the full ${isDocumentary ? 'Documentary Producer Benchmark Grid' : isVertical ? 'Vertical Producer Benchmark Grid' : isTV ? 'TV Producer Benchmark Grid' : 'Producer Benchmark Grid'}, risk flags, development tier, and finance readiness status. Use markdown. Be decisive.${passBUserSuffix}`,
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

    // Extract Producer Benchmark Grid scores from coverage prose
    const extractScore = (label: string): number | null => {
      // Match patterns like "Structure | 7/10" or "**STRUCTURAL STRENGTH: 8/10**" or "Structure: 7 / 10"
      const patterns = [
        new RegExp(`${label}[:\\s|]+\\s*(\\d+)\\s*/\\s*10`, 'i'),
        new RegExp(`${label}[:\\s|]+\\s*(\\d+)\\b`, 'i'),
      ];
      for (const p of patterns) {
        const m = passBResult.match(p);
        if (m) {
          const v = parseInt(m[1]);
          if (v >= 0 && v <= 10) return v;
        }
      }
      return null;
    };

    // Build scoring grid — format-specific categories
    const scoringGrid: Record<string, number | null> = isDocumentary ? {
      narrative_gravity: extractScore('Narrative Gravity'),
      structural_integrity: extractScore('Structural Integrity'),
      emotional_architecture: extractScore('Emotional Architecture'),
      access_fragility: extractScore('Access & Fragility') || extractScore('Access'),
      legal_ethical_safety: extractScore('Legal & Ethical Safety') || extractScore('Legal'),
      market_positioning: extractScore('Market Positioning') || extractScore('Market'),
      grant_impact_potential: extractScore('Grant & Impact Potential') || extractScore('Grant'),
      commercial_viability: extractScore('Commercial Viability'),
      overall_narrative_strength: extractScore('Overall Narrative Strength') || extractScore('Narrative Strength'),
      greenlight_score: extractScore('Greenlight Score') || extractScore('GREENLIGHT SCORE'),
      grant_probability: extractScore('Grant Probability') || extractScore('GRANT PROBABILITY'),
      festival_probability: extractScore('Festival Probability') || extractScore('FESTIVAL PROBABILITY'),
      impact_score: extractScore('Impact Score') || extractScore('IMPACT SCORE'),
    } : isVertical ? {
      hook_speed: extractScore('Hook Speed'),
      cliffhanger_density: extractScore('Cliffhanger Density'),
      escalation_curve: extractScore('Escalation Curve'),
      addiction_potential: extractScore('Addiction Potential'),
      market_simplicity: extractScore('Market Simplicity'),
      overall_vertical_confidence: extractScore('Overall Vertical Confidence') || extractScore('VERTICAL CONFIDENCE'),
    } : isTV ? {
      pilot_hook: extractScore('Pilot Hook') || extractScore('Pilot Strength'),
      series_engine: extractScore('Series Engine'),
      character_longevity: extractScore('Character Longevity'),
      world_depth: extractScore('World Depth'),
      binge_factor: extractScore('Binge Factor') || extractScore('Binge Propulsion'),
      streamer_alignment: extractScore('Streamer Alignment'),
      overall_series_confidence: extractScore('Overall Series Confidence') || extractScore('SERIES CONFIDENCE'),
    } : {
      structure: extractScore('Structure'),
      character: extractScore('Character'),
      dialogue: extractScore('Dialogue'),
      concept: extractScore('Concept'),
      pacing: extractScore('Pacing'),
      genre_execution: extractScore('Genre Execution'),
      commercial_viability: extractScore('Commercial Viability'),
      structural_strength: extractScore('Structural Strength'),
      commercial_viability_overall: extractScore('Commercial Viability') || extractScore('COMMERCIAL VIABILITY'),
      overall_producer_confidence: extractScore('Overall Producer Confidence') || extractScore('PRODUCER CONFIDENCE'),
    };

    // Extract risk flags
    const riskFlags: string[] = [];
    if (passBResult.match(/HIGH DEVELOPMENT RISK/i)) riskFlags.push('HIGH DEVELOPMENT RISK');
    if (passBResult.match(/FINANCE RISK/i)) riskFlags.push('FINANCE RISK');
    if (passBResult.match(/PACKAGING DEPENDENT/i)) riskFlags.push('PACKAGING DEPENDENT');
    if (passBResult.match(/REWRITE PRIORITY HIGH/i)) riskFlags.push('REWRITE PRIORITY HIGH');
    if (passBResult.match(/MARKET RISK/i)) riskFlags.push('MARKET RISK');
    if (passBResult.match(/EXECUTION RISK/i)) riskFlags.push('EXECUTION RISK');
    if (passBResult.match(/GENRE EXECUTION RISK/i)) riskFlags.push('GENRE EXECUTION RISK');
    if (passBResult.match(/DEVELOPMENT RISK/i) && !riskFlags.includes('HIGH DEVELOPMENT RISK')) riskFlags.push('DEVELOPMENT RISK');
    if (passBResult.match(/STRUCTURAL RISK/i)) riskFlags.push('STRUCTURAL RISK');
    if (passBResult.match(/PACING RISK/i)) riskFlags.push('PACING RISK');
    if (passBResult.match(/CHARACTER DEPTH RISK/i)) riskFlags.push('CHARACTER DEPTH RISK');
    // TV-specific risk flags
    if (isTV) {
      if (passBResult.match(/SERIES ENGINE RISK/i)) riskFlags.push('SERIES ENGINE RISK');
      if (passBResult.match(/LONGEVITY RISK/i)) riskFlags.push('LONGEVITY RISK');
      if (passBResult.match(/TONAL RISK/i)) riskFlags.push('TONAL RISK');
      if (passBResult.match(/BINGE RISK/i)) riskFlags.push('BINGE RISK');
    }
    // Documentary-specific risk flags
    if (isDocumentary) {
      if (passBResult.match(/ACCESS FRAGILITY RISK/i)) riskFlags.push('ACCESS FRAGILITY RISK');
      if (passBResult.match(/LEGAL RISK/i)) riskFlags.push('LEGAL RISK');
      if (passBResult.match(/POLITICAL RISK/i)) riskFlags.push('POLITICAL RISK');
      if (passBResult.match(/MARKET FIT RISK/i)) riskFlags.push('MARKET FIT RISK');
      if (passBResult.match(/ARCHIVE COST RISK/i)) riskFlags.push('ARCHIVE COST RISK');
      if (passBResult.match(/IMPACT GAP/i)) riskFlags.push('IMPACT GAP');
      if (passBResult.match(/INSURANCE RISK/i)) riskFlags.push('INSURANCE RISK');
      if (passBResult.match(/INFORMATIONAL TRAP/i)) riskFlags.push('INFORMATIONAL TRAP');
      if (passBResult.match(/NO PROTAGONIST/i)) riskFlags.push('NO PROTAGONIST');
      if (passBResult.match(/EMOTIONAL MONOTONY/i)) riskFlags.push('EMOTIONAL MONOTONY');
    }
    // Vertical-specific risk flags
    if (isVertical) {
      if (passBResult.match(/HOOK FAILURE/i)) riskFlags.push('HOOK FAILURE');
      if (passBResult.match(/RETENTION RISK/i)) riskFlags.push('RETENTION RISK');
      if (passBResult.match(/FORMAT MISALIGNMENT/i)) riskFlags.push('FORMAT MISALIGNMENT');
      if (passBResult.match(/ARC COLLAPSE RISK/i)) riskFlags.push('ARC COLLAPSE RISK');
    }

    // Extract development tier
    const tierMatch = passBResult.match(/Tier\s+([A-D])\b/i);
    const developmentTier = tierMatch ? `Tier ${tierMatch[1].toUpperCase()}` : null;

    // Extract finance readiness
    let financeReadiness: string | null = null;
    if (passBResult.match(/Finance Readiness[^:]*:\s*GREEN|GREEN\s*[—–-]\s*(Attach|Commission)/i)) financeReadiness = 'GREEN';
    else if (passBResult.match(/Finance Readiness[^:]*:\s*YELLOW|YELLOW\s*[—–-]\s*(Rewrite|Engine|Hook)/i)) financeReadiness = 'YELLOW';
    else if (passBResult.match(/Finance Readiness[^:]*:\s*RED|RED\s*[—–-]\s*(Development|Format)/i)) financeReadiness = 'RED';

    console.log(`[coverage] scores:`, JSON.stringify(scoringGrid), `tier=${developmentTier}, finance=${financeReadiness}, flags=${riskFlags.join(',')}`);

    // Build final coverage: if the AI returned pure JSON, extract prose from the structured data
    let finalCoverage = passBResult;
    
    const trimmedB = passBResult.trim();
    const isPureJSON = trimmedB.startsWith('```') || trimmedB.startsWith('{');
    
    if (isPureJSON && parsed) {
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
      finalCoverage = passBResult
        .replace(/```(?:json)?\s*\{[\s\S]*?"structured_notes"[\s\S]*?\}[\s\S]*?```/g, '')
        .replace(/```(?:json)?\s*\[[\s\S]*?"note_id"[\s\S]*?\][\s\S]*?```/g, '')
        .trim();
    }
    
    if (!finalCoverage || finalCoverage.length < 20) {
      if (parsed) {
        const fallbackParts: string[] = ['**VERDICT: CONSIDER**\n'];
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

    const metrics = {
      notes_count: structuredNotes.length,
      elapsed_ms: Date.now() - t0,
      scoring_grid: scoringGrid,
      risk_flags: riskFlags,
      development_tier: developmentTier,
      finance_readiness: financeReadiness,
    };

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
        metrics,
        draft_label: draftLabel || "Draft 1",
        created_by: userId,
      })
      .select("id, created_at")
      .single();

    if (insertErr) console.error("Save error:", insertErr);

    await supabase.from("projects").update({ script_coverage_verdict: recommendation }).eq("id", projectId);

    console.log(`[coverage] complete in ${Date.now() - t0}ms`);

    return new Response(JSON.stringify({
      id: inserted?.id,
      created_at: inserted?.created_at,
      final_coverage: finalCoverage,
      structured_notes: structuredNotes,
      metrics,
      pass_a: passAResult,
      pass_b: passBResult,
      pass_c: "",
      recommendation,
      scoring_grid: scoringGrid,
      risk_flags: riskFlags,
      development_tier: developmentTier,
      finance_readiness: financeReadiness,
      qc_changelog: [],
      hallucination_flags: [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("script-coverage error:", e);
    const msg: string = e instanceof Error ? e.message : "Unknown error";
    const isPayment = msg.includes("402") || msg.toLowerCase().includes("credits") || msg.toLowerCase().includes("payment");
    const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit");
    const status = isPayment ? 402 : isRateLimit ? 429 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
