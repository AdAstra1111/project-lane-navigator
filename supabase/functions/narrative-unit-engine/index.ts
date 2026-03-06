/**
 * Narrative Unit Engine (NUE) — Phase 1: READ-ONLY Extraction
 *
 * Extracts atomic narrative units from canonical sources and development documents.
 * Units are observational only — they do NOT influence generation or pipeline behavior.
 *
 * Supported actions:
 *   - extract: Run deterministic extraction for a project
 *   - list: List narrative units for a project (optionally filtered by unit_type)
 *
 * Unit types (Phase 1):
 *   - PROTAGONIST_OBJECTIVE
 *   - ANTAGONIST_FORCE
 *   - SEASON_ENGINE
 *   - RELATIONSHIP_TENSION
 *   - MARKET_HOOK
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Unit Type Registry ──

type NUEUnitType =
  | "PROTAGONIST_OBJECTIVE"
  | "ANTAGONIST_FORCE"
  | "SEASON_ENGINE"
  | "RELATIONSHIP_TENSION"
  | "MARKET_HOOK";

interface ExtractionSource {
  unit_type: NUEUnitType;
  source_doc_types: string[];
  canon_fields: string[];
  extraction_strategy: "canon_field" | "doc_heading" | "canon_characters";
}

const EXTRACTION_REGISTRY: ExtractionSource[] = [
  {
    unit_type: "PROTAGONIST_OBJECTIVE",
    source_doc_types: ["character_bible", "concept_brief"],
    canon_fields: ["characters"],
    extraction_strategy: "canon_characters",
  },
  {
    unit_type: "ANTAGONIST_FORCE",
    source_doc_types: ["concept_brief", "season_arc"],
    canon_fields: ["premise"],
    extraction_strategy: "doc_heading",
  },
  {
    unit_type: "SEASON_ENGINE",
    source_doc_types: ["concept_brief", "season_arc"],
    canon_fields: ["premise", "ongoing_threads"],
    extraction_strategy: "doc_heading",
  },
  {
    unit_type: "RELATIONSHIP_TENSION",
    source_doc_types: ["character_bible"],
    canon_fields: ["characters"],
    extraction_strategy: "canon_characters",
  },
  {
    unit_type: "MARKET_HOOK",
    source_doc_types: ["idea", "concept_brief", "market_sheet"],
    canon_fields: ["logline"],
    extraction_strategy: "canon_field",
  },
];

// ── Extraction Logic ──

interface ExtractedUnit {
  unit_type: NUEUnitType;
  unit_key: string;
  payload_json: Record<string, unknown>;
  source_doc_type: string;
  source_doc_version_id: string | null;
  confidence: number;
  extraction_method: string;
}

/**
 * Extract PROTAGONIST_OBJECTIVE from canon characters[].
 * Deterministic: uses character with role containing "protagonist" or first listed character.
 */
function extractProtagonistObjective(
  canonJson: Record<string, unknown>,
  docs: Map<string, { version_id: string; plaintext: string }>,
): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];
  const characters = canonJson.characters as any[] | undefined;
  if (!Array.isArray(characters) || characters.length === 0) return units;

  for (const char of characters) {
    if (!char?.name || !char?.role) continue;
    const role = String(char.role).toLowerCase();
    const goals = char.goals || char.description || "";

    // Identify protagonist: role contains protagonist/lead/main, or is first character
    const isProtagonist =
      role.includes("protagonist") ||
      role.includes("lead") ||
      role.includes("main character") ||
      characters.indexOf(char) === 0;

    if (!isProtagonist) continue;

    // Extract objective from goals, description, or core value
    const objectiveParts: string[] = [];
    if (char.goals) objectiveParts.push(String(char.goals).trim());
    if (char.description) objectiveParts.push(String(char.description).trim());
    const coreValue = (char as any).core_value || (char as any)["Core Value"];
    if (coreValue) objectiveParts.push(`Core value: ${String(coreValue).trim()}`);

    if (objectiveParts.length === 0) continue;

    const charBible = docs.get("character_bible");
    const sourceDocType = charBible ? "character_bible" : "canon";
    const sourceVersionId = charBible?.version_id || null;

    units.push({
      unit_type: "PROTAGONIST_OBJECTIVE",
      unit_key: `protagonist_objective::${String(char.name).toLowerCase().trim()}`,
      payload_json: {
        character_name: String(char.name).trim(),
        role: String(char.role).trim(),
        objective: objectiveParts.join(" | "),
        source: "canon_characters",
      },
      source_doc_type: sourceDocType,
      source_doc_version_id: sourceVersionId,
      confidence: char.goals ? 0.9 : 0.7,
      extraction_method: "deterministic_canon_character",
    });
    break; // Only first protagonist
  }

  return units;
}

/**
 * Extract ANTAGONIST_FORCE from canon + concept_brief/season_arc documents.
 * Deterministic: looks for character with antagonist/villain role, or heading-based extraction.
 */
function extractAntagonistForce(
  canonJson: Record<string, unknown>,
  docs: Map<string, { version_id: string; plaintext: string }>,
): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];

  // Strategy 1: Canon characters with antagonist role
  const characters = canonJson.characters as any[] | undefined;
  if (Array.isArray(characters)) {
    for (const char of characters) {
      if (!char?.name || !char?.role) continue;
      const role = String(char.role).toLowerCase();
      if (
        role.includes("antagonist") ||
        role.includes("villain") ||
        role.includes("rival") ||
        role.includes("ruthless") ||
        role.includes("head of")
      ) {
        const charBible = docs.get("character_bible");
        units.push({
          unit_type: "ANTAGONIST_FORCE",
          unit_key: `antagonist_force::${String(char.name).toLowerCase().trim()}`,
          payload_json: {
            character_name: String(char.name).trim(),
            role: String(char.role).trim(),
            description: String(char.description || "").trim(),
            source: "canon_characters",
          },
          source_doc_type: charBible ? "character_bible" : "canon",
          source_doc_version_id: charBible?.version_id || null,
          confidence: 0.85,
          extraction_method: "deterministic_canon_character_role",
        });
      }
    }
  }

  // Strategy 2: From concept_brief premise if no antagonist found from characters
  if (units.length === 0) {
    const premise = canonJson.premise as string | undefined;
    if (premise && premise.length > 20) {
      // Look for "threatens" / "against" / "enemy" patterns — deterministic keyword
      const threatPatterns = [
        /(?:threaten|shatter|destroy|confront|oppose|against)\w*\s+(.{10,80})/i,
        /(?:his|her|their)\s+(?:brother|rival|enemy|nemesis|opponent)\s*,?\s*(\w[\w\s]{5,40})/i,
      ];
      for (const pat of threatPatterns) {
        const match = premise.match(pat);
        if (match) {
          const conceptBrief = docs.get("concept_brief");
          units.push({
            unit_type: "ANTAGONIST_FORCE",
            unit_key: "antagonist_force::premise_extracted",
            payload_json: {
              extracted_threat: match[0].trim().slice(0, 200),
              source: "canon_premise",
            },
            source_doc_type: conceptBrief ? "concept_brief" : "canon",
            source_doc_version_id: conceptBrief?.version_id || null,
            confidence: 0.6,
            extraction_method: "deterministic_premise_keyword",
          });
          break;
        }
      }
    }
  }

  return units;
}

/**
 * Extract SEASON_ENGINE from concept_brief and season_arc.
 * Deterministic: looks for structured headings or premise-level engine description.
 */
function extractSeasonEngine(
  canonJson: Record<string, unknown>,
  docs: Map<string, { version_id: string; plaintext: string }>,
): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];

  // Strategy 1: From season_arc document — heading-based
  const seasonArc = docs.get("season_arc");
  if (seasonArc?.plaintext) {
    const text = seasonArc.plaintext;
    // Look for LOGLINE or SHORT SYNOPSIS heading
    const loglineMatch = text.match(/^#\s*LOGLINE\s*\n(.+?)(?:\n#|\n\n)/ms);
    const synopsisMatch = text.match(/^#\s*SHORT\s+SYNOPSIS\s*\n(.+?)(?:\n#|\n\n)/ms);

    const engineText = loglineMatch?.[1]?.trim() || synopsisMatch?.[1]?.trim();
    if (engineText && engineText.length >= 20) {
      units.push({
        unit_type: "SEASON_ENGINE",
        unit_key: "season_engine::season_arc",
        payload_json: {
          engine_description: engineText.slice(0, 500),
          source: "season_arc_heading",
        },
        source_doc_type: "season_arc",
        source_doc_version_id: seasonArc.version_id,
        confidence: 0.9,
        extraction_method: "deterministic_heading_extraction",
      });
    }
  }

  // Strategy 2: From canon premise (fallback if no season_arc)
  if (units.length === 0) {
    const premise = canonJson.premise as string | undefined;
    if (premise && premise.length >= 30) {
      const conceptBrief = docs.get("concept_brief");
      units.push({
        unit_type: "SEASON_ENGINE",
        unit_key: "season_engine::premise",
        payload_json: {
          engine_description: premise.slice(0, 500),
          source: "canon_premise",
        },
        source_doc_type: conceptBrief ? "concept_brief" : "canon",
        source_doc_version_id: conceptBrief?.version_id || null,
        confidence: 0.7,
        extraction_method: "deterministic_canon_premise_fallback",
      });
    }
  }

  return units;
}

/**
 * Extract RELATIONSHIP_TENSION from canon characters[].relationships[].
 * Deterministic: uses structured relationship data from Phase 3E/3F.
 */
function extractRelationshipTension(
  canonJson: Record<string, unknown>,
  docs: Map<string, { version_id: string; plaintext: string }>,
): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];
  const characters = canonJson.characters as any[] | undefined;
  if (!Array.isArray(characters)) return units;

  const charBible = docs.get("character_bible");

  for (const char of characters) {
    if (!char?.name) continue;
    const rels = (char as any).relationships;
    if (!Array.isArray(rels)) continue;

    for (const rel of rels) {
      if (!rel?.target_name || !rel?.arc_summary) continue;
      const targetName = String(rel.target_name).trim();
      const arcSummary = String(rel.arc_summary).trim();
      if (targetName.length < 2 || arcSummary.length < 10) continue;

      // Sorted pair key for deduplication
      const [a, b] = [String(char.name).trim(), targetName].sort((x, y) =>
        x.toLowerCase().localeCompare(y.toLowerCase()),
      );
      const pairKey = `${a.toLowerCase()}<>${b.toLowerCase()}`;
      const unitKey = `relationship_tension::${pairKey}`;

      // Skip if already extracted for this pair
      if (units.some((u) => u.unit_key === unitKey)) continue;

      units.push({
        unit_type: "RELATIONSHIP_TENSION",
        unit_key: unitKey,
        payload_json: {
          character_a: a,
          character_b: b,
          arc_summary: arcSummary.slice(0, 500),
          source: "canon_characters_relationships",
        },
        source_doc_type: charBible ? "character_bible" : "canon",
        source_doc_version_id: charBible?.version_id || null,
        confidence: 0.85,
        extraction_method: "deterministic_structured_relationship",
      });
    }
  }

  return units;
}

/**
 * Extract MARKET_HOOK from canon logline + idea/concept_brief/market_sheet.
 * Deterministic: uses canon logline as primary source.
 */
function extractMarketHook(
  canonJson: Record<string, unknown>,
  docs: Map<string, { version_id: string; plaintext: string }>,
): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];

  // Strategy 1: Canon logline
  const logline = canonJson.logline as string | undefined;
  if (logline && logline.length >= 15) {
    const conceptBrief = docs.get("concept_brief");
    const idea = docs.get("idea");
    const sourceDoc = conceptBrief || idea;

    units.push({
      unit_type: "MARKET_HOOK",
      unit_key: "market_hook::logline",
      payload_json: {
        hook: logline.trim().slice(0, 500),
        source: "canon_logline",
      },
      source_doc_type: sourceDoc ? (conceptBrief ? "concept_brief" : "idea") : "canon",
      source_doc_version_id: sourceDoc?.version_id || null,
      confidence: 0.9,
      extraction_method: "deterministic_canon_logline",
    });
  }

  // Strategy 2: From idea document — "Vertical Hook" heading
  const idea = docs.get("idea");
  if (idea?.plaintext) {
    const hookMatch = idea.plaintext.match(
      /\*\*(?:The\s+)?Vertical\s+Hook[^*]*\*\*[:\s]*\n([\s\S]{20,300}?)(?:\n\*\*|\n##|\n\n\n)/i,
    );
    if (hookMatch) {
      units.push({
        unit_type: "MARKET_HOOK",
        unit_key: "market_hook::vertical_hook",
        payload_json: {
          hook: hookMatch[1].trim().slice(0, 500),
          source: "idea_vertical_hook",
        },
        source_doc_type: "idea",
        source_doc_version_id: idea.version_id,
        confidence: 0.8,
        extraction_method: "deterministic_heading_extraction",
      });
    }
  }

  // Strategy 3: From market_sheet — convergence guidance
  const marketSheet = docs.get("market_sheet");
  if (marketSheet?.plaintext) {
    const genreMatch = marketSheet.plaintext.match(
      /\*\*Genre Heat:\*\*\s*\n((?:\s*-\s*.+\n){1,10})/i,
    );
    if (genreMatch) {
      units.push({
        unit_type: "MARKET_HOOK",
        unit_key: "market_hook::genre_heat",
        payload_json: {
          hook: genreMatch[1].trim().slice(0, 500),
          source: "market_sheet_genre_heat",
        },
        source_doc_type: "market_sheet",
        source_doc_version_id: marketSheet.version_id,
        confidence: 0.75,
        extraction_method: "deterministic_heading_extraction",
      });
    }
  }

  return units;
}

// ── Main Extraction Pipeline ──

async function runExtraction(
  supabase: any,
  projectId: string,
): Promise<{
  units: ExtractedUnit[];
  persisted: number;
  errors: string[];
  duration_ms: number;
}> {
  const startTime = Date.now();
  const errors: string[] = [];

  // 1. Fetch canon
  const { data: canonRow, error: canonErr } = await supabase
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .maybeSingle();

  if (canonErr || !canonRow) {
    return { units: [], persisted: 0, errors: ["canon_not_found"], duration_ms: Date.now() - startTime };
  }
  const canonJson = (canonRow.canon_json || {}) as Record<string, unknown>;

  // 2. Fetch current doc versions for extraction sources
  const sourceDocTypes = [
    "idea", "concept_brief", "character_bible", "season_arc", "market_sheet",
  ];
  const { data: docRows } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId)
    .in("doc_type", sourceDocTypes);

  const docs = new Map<string, { version_id: string; plaintext: string }>();
  if (docRows && docRows.length > 0) {
    const docIds = docRows.map((d: any) => d.id);
    const { data: versionRows } = await supabase
      .from("project_document_versions")
      .select("id, document_id, plaintext")
      .in("document_id", docIds)
      .eq("is_current", true);

    if (versionRows) {
      for (const ver of versionRows) {
        const doc = docRows.find((d: any) => d.id === ver.document_id);
        if (doc && ver.plaintext) {
          docs.set(doc.doc_type, { version_id: ver.id, plaintext: ver.plaintext });
        }
      }
    }
  }

  // 3. Run all extractors
  const allUnits: ExtractedUnit[] = [
    ...extractProtagonistObjective(canonJson, docs),
    ...extractAntagonistForce(canonJson, docs),
    ...extractSeasonEngine(canonJson, docs),
    ...extractRelationshipTension(canonJson, docs),
    ...extractMarketHook(canonJson, docs),
  ];

  // 4. IEL Logging
  for (const unit of allUnits) {
    console.log(
      `[IEL] nue_unit_extracted { project_id: "${projectId}", unit_type: "${unit.unit_type}", unit_key: "${unit.unit_key}", source_doc_type: "${unit.source_doc_type}", doc_version: "${unit.source_doc_version_id || "none"}", confidence: ${unit.confidence}, method: "${unit.extraction_method}" }`,
    );
  }

  // 5. Persist via upsert
  let persisted = 0;
  for (const unit of allUnits) {
    try {
      const { error: upsertErr } = await supabase
        .from("narrative_units")
        .upsert(
          {
            project_id: projectId,
            unit_type: unit.unit_type,
            unit_key: unit.unit_key,
            payload_json: unit.payload_json,
            source_doc_type: unit.source_doc_type,
            source_doc_version_id: unit.source_doc_version_id,
            confidence: unit.confidence,
            extraction_method: unit.extraction_method,
          },
          { onConflict: "project_id,unit_type,unit_key" },
        );
      if (upsertErr) {
        errors.push(`upsert "${unit.unit_key}": ${upsertErr.message}`);
      } else {
        persisted++;
      }
    } catch (err: any) {
      errors.push(`upsert "${unit.unit_key}": ${err?.message || "unknown"}`);
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[IEL] nue_extraction_complete { project_id: "${projectId}", units_extracted: ${allUnits.length}, persisted: ${persisted}, errors: ${errors.length}, duration_ms: ${duration} }`,
  );

  return { units: allUnits, persisted, errors, duration_ms: duration };
}

// ── HTTP Handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, projectId, unitType } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "extract") {
      const result = await runExtraction(supabase, projectId);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list") {
      let query = supabase
        .from("narrative_units")
        .select("*")
        .eq("project_id", projectId)
        .order("unit_type")
        .order("created_at", { ascending: false });

      if (unitType) {
        query = query.eq("unit_type", unitType);
      }

      const { data, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ units: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Supported: extract, list` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
