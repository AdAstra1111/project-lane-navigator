// @ts-nocheck
/**
 * extract-visual-dna — Evidence-driven Character Visual DNA extraction.
 * 
 * Gathers project evidence (canon, character bible, scripts, scene descriptions)
 * and uses AI to extract structured visual traits with confidence and provenance.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveGateway, callLLM, MODELS, extractJSON } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExtractedTrait {
  label: string;
  category: "age" | "gender" | "build" | "face" | "hair" | "skin" | "clothing" | "posture" | "marker" | "other";
  confidence: "high" | "medium" | "low";
  evidence_source: string;
  evidence_excerpt: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project_id, character_name } = await req.json();
    if (!project_id || !character_name) {
      return new Response(JSON.stringify({ error: "project_id and character_name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // ── 1. Gather evidence from all available sources ──

    const evidenceBlocks: { source: string; text: string }[] = [];

    // A. Canon JSON (character entry)
    const { data: canon } = await sb
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", project_id)
      .maybeSingle();

    if (canon?.canon_json) {
      const cj = canon.canon_json as Record<string, any>;
      
      // Find character in canon
      const characters = cj.characters || [];
      const charEntry = Array.isArray(characters)
        ? characters.find((c: any) =>
            (c.name || "").toLowerCase() === character_name.toLowerCase()
          )
        : null;

      if (charEntry) {
        evidenceBlocks.push({
          source: "canon_json.character",
          text: JSON.stringify(charEntry, null, 2).slice(0, 4000),
        });
      }

      // World rules for period/era context
      if (cj.world_rules) {
        const wr = typeof cj.world_rules === "string" ? cj.world_rules : JSON.stringify(cj.world_rules);
        evidenceBlocks.push({
          source: "canon_json.world_rules",
          text: wr.slice(0, 2000),
        });
      }

      // Timeline
      if (cj.timeline) {
        const tl = typeof cj.timeline === "string" ? cj.timeline : JSON.stringify(cj.timeline);
        evidenceBlocks.push({
          source: "canon_json.timeline",
          text: tl.slice(0, 1500),
        });
      }
    }

    // B. Project documents — character bible, scripts, treatments
    const { data: docs } = await sb
      .from("project_documents")
      .select("id, title, doc_type, latest_version_id")
      .eq("project_id", project_id)
      .in("doc_type", [
        "character_bible",
        "screenplay",
        "treatment",
        "pilot_script",
        "episode_script",
        "series_bible",
        "outline",
        "episode_1",
      ])
      .order("doc_type")
      .limit(10);

    if (docs && docs.length > 0) {
      const versionIds = docs.map((d: any) => d.latest_version_id).filter(Boolean);

      if (versionIds.length > 0) {
        const { data: versions } = await sb
          .from("project_document_versions")
          .select("id, document_id, plaintext")
          .in("id", versionIds);

        if (versions) {
          for (const v of versions) {
            const doc = docs.find((d: any) => d.id === v.document_id);
            if (!v.plaintext) continue;
            const text = v.plaintext as string;
            
            // Extract character-relevant sections
            const charRelevant = extractCharacterRelevantText(text, character_name);
            if (charRelevant.length > 50) {
              evidenceBlocks.push({
                source: `document:${doc?.doc_type || "unknown"}:${doc?.title || v.document_id}`,
                text: charRelevant.slice(0, 5000),
              });
            }
          }
        }
      }
    }

    // C. Character identity notes
    const { data: identityNotes } = await sb
      .from("character_identity_notes")
      .select("notes")
      .eq("project_id", project_id)
      .eq("character_name", character_name)
      .maybeSingle();

    if (identityNotes?.notes) {
      evidenceBlocks.push({
        source: "identity_notes",
        text: identityNotes.notes,
      });
    }

    // D. Scene graph — character descriptions from scenes
    const { data: sceneVersions } = await sb
      .from("scene_graph_versions")
      .select("content, slugline, summary")
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (sceneVersions) {
      const charMentions: string[] = [];
      const nameLower = character_name.toLowerCase();
      for (const sv of sceneVersions) {
        const content = (sv.content || "") as string;
        if (content.toLowerCase().includes(nameLower)) {
          // Extract paragraphs mentioning the character
          const paragraphs = content.split(/\n\n+/);
          for (const p of paragraphs) {
            if (p.toLowerCase().includes(nameLower) && p.length > 20) {
              charMentions.push(p.trim());
            }
          }
        }
      }
      if (charMentions.length > 0) {
        evidenceBlocks.push({
          source: "scene_graph",
          text: charMentions.slice(0, 15).join("\n\n").slice(0, 4000),
        });
      }
    }

    if (evidenceBlocks.length === 0) {
      return new Response(JSON.stringify({
        traits: [],
        evidence_sources: [],
        message: "No evidence found for this character in the project.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. AI extraction ──

    const { apiKey } = resolveGateway();

    const evidenceText = evidenceBlocks
      .map((b, i) => `=== SOURCE ${i + 1}: ${b.source} ===\n${b.text}`)
      .join("\n\n---\n\n");

    const systemPrompt = `You are a Visual Character Analyst for film/TV production.
Your task: Extract ONLY physically renderable visual traits for "${character_name}" from the provided evidence.

RULES:
- Extract ONLY traits visible in a photograph or rendered image
- NO psychology, motivation, personality, emotions, or narrative function
- Each trait must cite its evidence source and a brief excerpt
- Assign confidence: "high" (explicitly stated), "medium" (clearly implied), "low" (weakly suggested)
- Categories: age, gender, build, face, hair, skin, clothing, posture, marker, other
- "marker" = scars, tattoos, prosthetics, glasses, birthmarks, disabilities
- Keep labels concise (2-8 words)
- Do NOT invent traits not supported by evidence
- If evidence is ambiguous, use "low" confidence

Return JSON:
{
  "traits": [
    {
      "label": "concise trait description",
      "category": "age|gender|build|face|hair|skin|clothing|posture|marker|other",
      "confidence": "high|medium|low",
      "evidence_source": "source identifier from evidence block",
      "evidence_excerpt": "brief quote from evidence (max 80 chars)"
    }
  ]
}`;

    const result = await callLLM({
      apiKey,
      model: MODELS.FAST,
      system: systemPrompt,
      user: `Extract visual traits for "${character_name}" from this evidence:\n\n${evidenceText}`,
      temperature: 0.1,
      maxTokens: 4000,
    });

    let parsed: { traits: ExtractedTrait[] };
    try {
      parsed = JSON.parse(extractJSON(result.content));
    } catch {
      parsed = { traits: [] };
    }

    // Validate and clean
    const validCategories = new Set(["age", "gender", "build", "face", "hair", "skin", "clothing", "posture", "marker", "other"]);
    const validConfidence = new Set(["high", "medium", "low"]);
    const cleanTraits = (parsed.traits || [])
      .filter((t: any) => t.label && validCategories.has(t.category))
      .map((t: any) => ({
        label: String(t.label).slice(0, 100),
        category: t.category,
        confidence: validConfidence.has(t.confidence) ? t.confidence : "low",
        evidence_source: String(t.evidence_source || "unknown").slice(0, 200),
        evidence_excerpt: String(t.evidence_excerpt || "").slice(0, 120),
      }));

    return new Response(JSON.stringify({
      traits: cleanTraits,
      evidence_sources: evidenceBlocks.map(b => b.source),
      character_name,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("extract-visual-dna error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Extract text sections relevant to a specific character from a document.
 */
function extractCharacterRelevantText(fullText: string, characterName: string): string {
  const nameLower = characterName.toLowerCase();
  const firstName = characterName.split(/\s+/)[0]?.toLowerCase() || nameLower;
  const lines = fullText.split("\n");
  const relevant: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes(nameLower) || line.includes(firstName)) {
      // Include context: 2 lines before, the line, and 2 lines after
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length - 1, i + 2);
      const block = lines.slice(start, end + 1).join("\n");
      if (!relevant.includes(block)) {
        relevant.push(block);
      }
    }
  }
  
  return relevant.join("\n\n---\n\n");
}
