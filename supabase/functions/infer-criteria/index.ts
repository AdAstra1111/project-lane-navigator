/**
 * POST /functions/v1/infer-criteria
 * Input:  { project_id }
 * Output: { criteria, sources }
 *
 * Fetches the latest versions of key project documents and extracts
 * story-setup fields with provenance tracking.
 *
 * Priority order: topline_narrative > concept_brief > market_sheet > idea > blueprint
 *
 * Extraction pipeline:
 *   1. Guardrails / project-metadata (lowest priority)
 *   2. Per-doc regex heading extraction (deterministic)
 *   3. LLM inference for still-missing fields (Lovable AI gateway)
 *   4. Safe defaults for remaining gaps
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, resolveGateway } from "../_shared/llm.ts";

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

export type InferMethod = "heading_extract" | "llm_infer" | "project_metadata" | "default";

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

// ─── Guardrails: reject known junk matches ──────────────────────────────────

const JUNK_PATTERNS = [
  /^density\s*[/\\]/i,         // "Density / Scale Constraints"
  /^\*{2}/,                     // starts with markdown bold syntax
  /^scale\s*constraints/i,
  /^summary$/i,                 // bare "Summary"
  /^n\/a$/i,
  /^none$/i,
  /^tbd$/i,
  /^todo$/i,
  /^[\-–—]+$/,                  // just dashes
];

/** Returns null if value is empty, placeholder, or matches known junk */
function sanitize(value: string): string | null {
  const v = value?.trim();
  if (!v || v.length < 3) return null;
  for (const pat of JUNK_PATTERNS) {
    if (pat.test(v)) return null;
  }
  return v;
}

// Per-field blocklist patterns — reject matches that are semantically wrong
const FIELD_BLOCKLIST: Partial<Record<keyof CriteriaResult, RegExp[]>> = {
  stakes: [/^we\s+specialize/i, /^our\s+team/i],                // "Why Us" content in stakes
  world_rules: [/density.*constraint/i, /budget.*tier/i],        // market metadata in world_rules
};

function sanitizeField(field: keyof CriteriaResult, value: string): string | null {
  const base = sanitize(value);
  if (!base) return null;
  const blocklist = FIELD_BLOCKLIST[field];
  if (blocklist) {
    for (const pat of blocklist) {
      if (pat.test(base)) return null;
    }
  }
  return base;
}

// ─── Heading Extraction ─────────────────────────────────────────────────────

/**
 * Extract content under a markdown/text heading.
 * Handles:
 *   - Inline:  `## Heading: value on same line`
 *   - Block:   `## Heading\n\nContent paragraph(s)...`
 * Stops at next heading (#, **, ---) or EOF.
 */
export function extractHeading(text: string, ...variants: string[]): string {
  for (const heading of variants) {
    // Pattern 1: inline value on same line (e.g. "**Protagonist:** Jane Doe")
    const inlineRe = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*{2})?${heading}(?:\\*{2})?[:\\-–]?\\s*(.+?)(?:\\n|$)`,
      "im",
    );
    const inlineM = text.match(inlineRe);
    const inlineVal = inlineM?.[1]?.trim();
    if (inlineVal && inlineVal.length >= 3) return inlineVal.slice(0, 600);

    // Pattern 2: heading on its own line, content on next non-blank line(s)
    const blockRe = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*{2})?${heading}(?:\\*{2})?[:\\-–]?\\s*\\n+` +
      `([^\\n#*\\-].+?)` +
      `(?=\\n\\s*(?:#{1,3}\\s|\\*{2}[A-Z]|---)|$)`,
      "ims",
    );
    const blockM = text.match(blockRe);
    if (blockM?.[1]?.trim()) {
      const raw = blockM[1].trim();
      const firstPara = raw.split(/\n\s*\n/)[0].replace(/\n/g, " ").trim();
      if (firstPara.length >= 3) return firstPara.slice(0, 600);
    }
  }
  return "";
}

/** First non-empty paragraph ≤ 300 chars — useful as a last-resort logline */
function firstParagraph(text: string): string {
  const paras = text.split(/\n{2,}/).map(p => p.replace(/\n/g, " ").trim()).filter(p => p.length > 20);
  return paras[0]?.slice(0, 300) || "";
}

// ─── Field extraction config (deterministic priority per heading set) ────────

interface FieldExtractDef {
  field: keyof CriteriaResult;
  headings: string[];
  /** Secondary headings to try in a separate pass if primary fails */
  fallbackHeadings?: string[];
}

const FIELD_EXTRACT_DEFS: FieldExtractDef[] = [
  { field: "logline",     headings: ["LOGLINE", "LOG LINE", "HOOK", "ONE.LINE", "PREMISE IN ONE LINE"] },
  { field: "premise",     headings: ["PREMISE", "THE CONCEPT", "CONCEPT", "SERIES PREMISE", "SHOW PREMISE", "STORY ENGINE"] },
  { field: "tone_genre",  headings: ["TONE", "GENRE(?! BLEND)", "TONE.GENRE", "TONE & GENRE", "CORE TROPES", "VIBE"] },
  { field: "protagonist", headings: ["PROTAGONIST", "LEAD CHARACTER", "HERO", "MAIN CHARACTER", "CENTRAL CHARACTER", "OUR HERO"] },
  { field: "antagonist",  headings: ["ANTAGONIST", "VILLAIN", "OPPOSITION", "OPPOSING FORCE", "CONFLICT SOURCE"] },
  { field: "stakes",      headings: ["STAKES", "WHY IT SELLS", "CORE TENSION", "WHAT.S AT STAKE", "CENTRAL TENSION"], fallbackHeadings: ["WHY NOW"] },
  { field: "world_rules", headings: ["WORLD RULES", "WORLD.BUILDING", "WORLD BUILDING", "SETTING"] },
  { field: "comparables", headings: ["COMPARABLES", "COMPS", "COMP TITLES", "SIMILAR TO", "INSPIRED BY", "COMP SET"] },
];

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

    // ── Project ──
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

    const docTexts: Record<string, { id: string; text: string; doc_type: string }> = {};

    for (const doc of (docs || [])) {
      if (docTexts[doc.doc_type]) continue;

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

    const orderedDocs = DOC_PRIORITY.map(dt => docTexts[dt]).filter(Boolean);
    const hasAnyDoc = orderedDocs.length > 0;

    // ── Step 1: Deterministic heading extraction ──
    const criteria: CriteriaResult = { ...EMPTY_CRITERIA };
    const sources: Partial<SourceMap> = {};

    const setField = (
      field: keyof CriteriaResult,
      rawValue: string,
      docType: string,
      docId: string | null,
      method: InferMethod,
    ) => {
      if (criteria[field]) return; // already set (higher-priority source won)
      const clean = sanitizeField(field, rawValue);
      if (!clean) return;
      criteria[field] = clean;
      sources[field] = { source_doc_type: docType, source_doc_id: docId, method };
    };

    // 1a. Guardrails (saved story setup — lowest priority, overwritten by doc extraction)
    const gc = proj.guardrails_config || {};
    const gcStory = gc?.overrides?.story_setup || {};
    for (const field of Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[]) {
      if (gcStory[field]) {
        setField(field, gcStory[field], "project_guardrails", null, "project_metadata");
      }
    }

    // 1b. Project-level fields
    if (proj.tone || proj.genres?.length) {
      const tg = [proj.tone, ...(proj.genres || [])].filter(Boolean).join(" / ");
      setField("tone_genre", tg, "project_metadata", null, "project_metadata");
    }
    if (proj.comparable_titles) {
      setField("comparables", proj.comparable_titles, "project_metadata", null, "project_metadata");
    }

    // 1c. Per-doc regex extraction (doc priority order × field priority order)
    for (const docType of DOC_PRIORITY) {
      const entry = docTexts[docType];
      if (!entry) continue;
      const { id: docId, text } = entry;

      // Primary headings
      for (const def of FIELD_EXTRACT_DEFS) {
        const val = extractHeading(text, ...def.headings);
        if (val) setField(def.field, val, docType, docId, "heading_extract");
      }

      // Fallback headings (second pass)
      for (const def of FIELD_EXTRACT_DEFS) {
        if (!def.fallbackHeadings || criteria[def.field]) continue;
        const val = extractHeading(text, ...def.fallbackHeadings);
        if (val) setField(def.field, val, docType, docId, "heading_extract");
      }
    }

    // 1d. Last-resort logline from first paragraph
    if (!criteria.logline) {
      for (const dt of ["topline_narrative", "concept_brief", "idea"]) {
        const entry = docTexts[dt];
        if (!entry) continue;
        const para = firstParagraph(entry.text);
        if (para) { setField("logline", para, dt, entry.id, "heading_extract"); break; }
      }
    }

    // ── Step 2: LLM inference for still-missing fields ──
    const missingFields = (Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[])
      .filter(k => !criteria[k]);

    if (missingFields.length > 0 && hasAnyDoc) {
      console.warn("DOC_TO_FORM_LLM_FALLBACK", JSON.stringify({
        project_id,
        missing_fields: missingFields,
        available_doc_types: Object.keys(docTexts),
      }));

      let gateway: { url: string; apiKey: string } | null = null;
      try { gateway = resolveGateway(); } catch { /* no gateway */ }

      if (gateway) {
        const combinedText = orderedDocs.map(d => `--- ${d.doc_type} ---\n${d.text}`).join("\n\n").slice(0, 18000);

        const systemPrompt = `You are a film/TV development assistant. Extract story setup fields from the provided documents.
Return ONLY a JSON object with these exact keys: ${missingFields.join(", ")}.
For each field, provide a concise single-sentence value (or comma-separated list for comparables).
If a field cannot be determined from the documents, return an empty string "" for that key.
Do NOT invent information not present in the documents.`;

        const userPrompt = `Documents:\n${combinedText}\n\nExtract: ${missingFields.join(", ")}`;

        try {
          const result = await callLLM({
            apiKey: gateway.apiKey,
            model: MODELS.FAST_LITE,
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

          const bestDoc = orderedDocs[0];
          for (const field of missingFields) {
            const val = parsed[field];
            if (val?.trim()) {
              setField(field as keyof CriteriaResult, val, bestDoc?.doc_type || "llm_inference", bestDoc?.id || null, "llm_infer");
            }
          }
        } catch (e: unknown) {
          console.warn("LLM inference failed:", (e as Error)?.message ?? e);
        }
      }
    }

    // ── Step 3: Safe defaults for remaining gaps ──
    const remainingMissing = (Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[])
      .filter(k => !criteria[k]);

    const formatLabel = (proj.format || "film").replace(/_/g, "-");
    const DEFAULTS: Partial<CriteriaResult> = {
      tone_genre: formatLabel,
      world_rules: "Contemporary realistic setting",
    };

    for (const field of remainingMissing) {
      const def = DEFAULTS[field];
      if (def) setField(field, def, "default", null, "default");
    }

    // ── Build final response ──
    const fullSources: SourceMap = {} as SourceMap;
    const stillMissing: string[] = [];
    for (const field of Object.keys(EMPTY_CRITERIA) as (keyof CriteriaResult)[]) {
      fullSources[field] = sources[field] || { source_doc_type: "none", source_doc_id: null, method: "default" };
      if (!criteria[field]) stillMissing.push(field);
    }

    if (stillMissing.length > 0) {
      console.warn("DOC_TO_FORM_MAPPING_FAILURE", JSON.stringify({
        project_id,
        missing_fields: stillMissing,
        available_doc_types: Object.keys(docTexts),
      }));
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
