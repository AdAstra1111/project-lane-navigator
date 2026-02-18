/**
 * POST /functions/v1/infer-criteria
 * Input:  { project_id }
 * Output: { criteria, sources }
 *
 * Fetches the latest versions of key project documents (idea, topline_narrative,
 * concept_brief, market_sheet / vertical_market_sheet, blueprint) and extracts
 * story-setup fields with provenance tracking.
 *
 * Priority order: topline_narrative > concept_brief > market_sheet > idea > blueprint
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CriteriaResult {
  logline: string;
  premise: string;
  tone_genre: string;
  protagonist: string;
  antagonist: string;
  stakes: string;
  world_rules: string;
  comparables: string;
}

export type InferMethod = "extracted" | "inferred" | "default";

export interface FieldSource {
  source_doc_type: string;
  source_doc_id: string | null;
  method: InferMethod;
}

export type SourceMap = Record<keyof CriteriaResult, FieldSource>;

const EMPTY_CRITERIA: CriteriaResult = {
  logline: "", premise: "", tone_genre: "", protagonist: "",
  antagonist: "", stakes: "", world_rules: "", comparables: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Very cheap regex extraction for labelled headings */
function extractHeading(text: string, ...variants: string[]): string {
  for (const heading of variants) {
    const re = new RegExp(`(?:^|\\n)\\s*${heading}[:\\-–]?\\s*(.+?)(?:\\n|$)`, "im");
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim().slice(0, 400);
  }
  return "";
}

/** First non-empty paragraph ≤ 300 chars — useful as a last-resort logline */
function firstParagraph(text: string): string {
  const paras = text.split(/\n{2,}/).map(p => p.replace(/\n/g, " ").trim()).filter(p => p.length > 20);
  return paras[0]?.slice(0, 300) || "";
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Local JWT decode for auth (fast, no network hop)
    let userId: string | null = null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
      if (!userId || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify project ownership / access ──
    const { data: proj } = await supabase.from("projects")
      .select("id, title, tone, genres, comparable_titles, format, guardrails_config")
      .eq("id", project_id)
      .single();
    if (!proj) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch key documents ──
    const DOC_PRIORITY = [
      "topline_narrative", "concept_brief", "market_sheet",
      "vertical_market_sheet", "idea", "blueprint",
    ];

    const { data: docs } = await supabase
      .from("project_documents")
      .select("id, doc_type, extracted_text, plaintext, created_at")
      .eq("project_id", project_id)
      .in("doc_type", DOC_PRIORITY)
      .order("created_at", { ascending: false });

    // Fetch latest version text for each doc
    const docTexts: Record<string, { id: string; text: string; doc_type: string }> = {};

    for (const doc of (docs || [])) {
      if (docTexts[doc.doc_type]) continue; // already have newest (ordered by created_at desc)

      // Try latest version first
      const { data: vers } = await supabase
        .from("project_document_versions")
        .select("plaintext")
        .eq("document_id", doc.id)
        .order("version_number", { ascending: false })
        .limit(1);

      const text = vers?.[0]?.plaintext || doc.plaintext || doc.extracted_text || "";
      if (text) {
        docTexts[doc.doc_type] = { id: doc.id, text: text.slice(0, 12000), doc_type: doc.doc_type };
      }
    }

    // ── Ordered text blocks for LLM ──
    const orderedDocs = DOC_PRIORITY.map(dt => docTexts[dt]).filter(Boolean);
    const hasAnyDoc = orderedDocs.length > 0;

    // ── Step 1: Regex extraction (cheap, no LLM) ──
    const criteria: CriteriaResult = { ...EMPTY_CRITERIA };
    const sources: Partial<SourceMap> = {};

    // Helper to set a field if not yet set
    const setField = (
      field: keyof CriteriaResult,
      value: string,
      docType: string,
      docId: string | null,
      method: InferMethod,
    ) => {
      if (!value?.trim() || criteria[field]) return;
      criteria[field] = value.trim();
      sources[field] = { source_doc_type: docType, source_doc_id: docId, method };
    };

    // Pull project-level fallbacks first (lowest priority — overwritten by doc extraction)
    const gc = proj.guardrails_config || {};
    const gcStory = gc?.overrides?.story_setup || {};

    // Check guardrails for previously saved story setup
    for (const field of Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[]) {
      if (gcStory[field]) {
        setField(field, gcStory[field], "project_guardrails", null, "extracted");
      }
    }

    // Project-level fields (tone, genres, comparable_titles)
    if (proj.tone || proj.genres?.length) {
      const tg = [proj.tone, ...(proj.genres || [])].filter(Boolean).join(" / ");
      setField("tone_genre", tg, "project_metadata", null, "extracted");
    }
    if (proj.comparable_titles) {
      setField("comparables", proj.comparable_titles, "project_metadata", null, "extracted");
    }

    // Per-doc regex extraction (priority order)
    for (const docType of DOC_PRIORITY) {
      const entry = docTexts[docType];
      if (!entry) continue;
      const { id: docId, text } = entry;

      setField("logline", extractHeading(text, "LOGLINE", "LOG LINE", "HOOK", "ONE.LINE", "PREMISE IN ONE LINE"), docType, docId, "extracted");
      setField("premise", extractHeading(text, "PREMISE", "THE CONCEPT", "CONCEPT", "SERIES PREMISE", "SHOW PREMISE"), docType, docId, "extracted");
      setField("tone_genre", extractHeading(text, "TONE", "GENRE", "TONE.GENRE", "TONE & GENRE", "CORE TROPES", "VIBE"), docType, docId, "extracted");
      setField("protagonist", extractHeading(text, "PROTAGONIST", "LEAD", "HERO", "MAIN CHARACTER", "CENTRAL CHARACTER"), docType, docId, "extracted");
      setField("antagonist", extractHeading(text, "ANTAGONIST", "VILLAIN", "OPPOSITION", "THREAT", "CONFLICT SOURCE"), docType, docId, "extracted");
      setField("stakes", extractHeading(text, "STAKES", "WHY IT SELLS", "CORE TENSION", "RISK", "WHAT.S AT STAKE"), docType, docId, "extracted");
      setField("world_rules", extractHeading(text, "WORLD", "WORLD.BUILDING", "RULES", "SETTING", "WORLD RULES"), docType, docId, "extracted");
      setField("comparables", extractHeading(text, "COMPARABLES", "COMPS", "COMP TITLES", "SIMILAR TO", "INSPIRED BY", "COMP SET"), docType, docId, "extracted");
    }

    // Fallback: use first paragraph as logline if still empty
    if (!criteria.logline) {
      for (const docType of ["topline_narrative", "concept_brief", "idea"]) {
        const entry = docTexts[docType];
        if (!entry) continue;
        const para = firstParagraph(entry.text);
        if (para) {
          setField("logline", para, docType, entry.id, "extracted");
          break;
        }
      }
    }

    // ── Step 2: LLM inference for still-missing fields ──
    const missingFields = (Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[])
      .filter(k => !criteria[k]);

    if (missingFields.length > 0 && hasAnyDoc) {
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (apiKey) {
        const combinedText = orderedDocs.map(d => `--- ${d.doc_type} ---\n${d.text}`).join("\n\n").slice(0, 18000);

        const systemPrompt = `You are a film/TV development assistant. Extract story setup fields from the provided documents.
Return ONLY a JSON object with these exact keys: ${missingFields.join(", ")}.
For each field, provide a concise single-sentence value (or comma-separated list for comparables).
If a field cannot be determined from the documents, return an empty string "" for that key.
Do NOT invent information not present in the documents.`;

        const userPrompt = `Documents:\n${combinedText}\n\nExtract: ${missingFields.join(", ")}`;

        try {
          const result = await callLLM({
            apiKey,
            model: MODELS.FAST,
            system: systemPrompt,
            user: userPrompt,
            temperature: 0.1,
            maxTokens: 1200,
          });

          let parsed: Record<string, string> = {};
          try {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          } catch { /* ignore parse errors */ }

          // Use the best available source doc for attribution
          const bestDoc = orderedDocs[0];
          for (const field of missingFields) {
            const val = parsed[field];
            if (val?.trim()) {
              setField(field as keyof CriteriaResult, val, bestDoc?.doc_type || "inference", bestDoc?.id || null, "inferred");
            }
          }
        } catch (e) {
          console.warn("LLM inference failed:", e.message);
          // Non-fatal — we return what we extracted with regex
        }
      }
    }

    // ── Step 3: Apply safe defaults for still-empty fields ──
    const remainingMissing = (Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[])
      .filter(k => !criteria[k]);

    const formatLabel = (proj.format || "film").replace(/_/g, "-");
    const DEFAULTS: Partial<CriteriaResult> = {
      tone_genre: formatLabel,
      world_rules: "Contemporary realistic setting",
      comparables: "",
    };

    for (const field of remainingMissing) {
      const def = DEFAULTS[field];
      if (def) {
        setField(field, def, "default", null, "default");
      }
    }

    // ── Fill remaining sources (for fields that had no source set) ──
    const fullSources: SourceMap = {} as SourceMap;
    for (const field of Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[]) {
      fullSources[field] = sources[field] || {
        source_doc_type: "none",
        source_doc_id: null,
        method: "default",
      };
    }

    return new Response(JSON.stringify({ criteria, sources: fullSources }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("infer-criteria error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
