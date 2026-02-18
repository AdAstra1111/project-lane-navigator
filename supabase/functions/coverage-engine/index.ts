import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, composeSystem, extractJSON, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SCHEMA_VERSION = "v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || anonKey;

    // Auth check
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { projectId, subject, options } = body;

    if (!projectId || !subject?.type) {
      return new Response(JSON.stringify({ error: "Missing projectId or subject" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: user.id, _project_id: projectId,
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "No access to project" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get project metadata
    const { data: project } = await db.from("projects").select("title, format, genres, budget_range, target_audience, tone, assigned_lane").eq("id", projectId).single();
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve document versions to include
    let docVersionIds: string[] = [];
    let subjectType = subject.type;
    let bundleKey: string | null = null;
    let bundleName: string | null = null;

    if (subjectType === "document_version") {
      docVersionIds = [subject.documentVersionId];
    } else if (subjectType === "bundle") {
      bundleKey = subject.bundleKey;
      const useActiveOnly = subject.useActiveOnly !== false; // default true

      // Try active folder first
      if (useActiveOnly) {
        const { data: activeDocs } = await db
          .from("project_active_docs")
          .select("doc_type_key, document_version_id")
          .eq("project_id", projectId);

        if (activeDocs?.length) {
          // Map active doc_type_keys to coverage roles
          const ROLE_FROM_KEY: Record<string, string> = {
            concept_brief: "concept", market_sheet: "market", deck: "deck",
            blueprint: "blueprint", beat_sheet: "blueprint", character_bible: "character_bible",
            episode_grid: "episode_grid", season_arc: "season_arc",
            documentary_outline: "documentary_outline", format_rules: "format_rules",
            episode_script: "episode_script", feature_script: "feature_script",
            production_draft: "production_draft",
          };

          const BUNDLE_ROLES: Record<string, string[]> = {
            PACKAGE: ["concept", "market", "deck", "blueprint", "character_bible", "episode_script", "feature_script", "episode_grid", "season_arc", "format_rules", "documentary_outline"],
            NARRATIVE: ["feature_script", "episode_script", "episode_grid", "season_arc", "blueprint", "character_bible"],
            COMMERCIAL: ["market", "deck", "concept"],
            DOCU_REALITY: ["documentary_outline", "deck", "market", "concept"],
          };
          const desiredRoles = new Set(BUNDLE_ROLES[bundleKey || "PACKAGE"] || BUNDLE_ROLES.PACKAGE);

          for (const ad of activeDocs) {
            const role = ROLE_FROM_KEY[ad.doc_type_key];
            if (role && desiredRoles.has(role)) {
              docVersionIds.push(ad.document_version_id);
            }
          }
        }
      }

      // Fallback: if no active docs, use latest versions
      if (!docVersionIds.length) {
        const { data: docs } = await db
          .from("project_documents")
          .select("id, doc_type, title, file_name, latest_version_id")
          .eq("project_id", projectId)
          .not("latest_version_id", "is", null);

        if (!docs?.length) {
          return new Response(JSON.stringify({ error: "No documents found" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const versionIds = docs.map(d => d.latest_version_id).filter(Boolean);
        const { data: versions } = await db
          .from("project_document_versions")
          .select("id, deliverable_type, label, stage")
          .in("id", versionIds);
        const versionMap = new Map((versions || []).map(v => [v.id, v]));
        const roleMap = buildRoleMap(bundleKey, project.format, docs, versionMap);
        docVersionIds = roleMap.map(r => r.versionId);
      }

      bundleName = getBundleName(bundleKey);
    }

    if (!docVersionIds.length) {
      return new Response(JSON.stringify({ error: "No documents resolved for coverage" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch document texts
    const { data: versionRows } = await db
      .from("project_document_versions")
      .select("id, plaintext, deliverable_type, label, document_id")
      .in("id", docVersionIds);

    if (!versionRows?.length) {
      return new Response(JSON.stringify({ error: "No document text found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get parent doc info for titles
    const docIds = [...new Set(versionRows.map(v => v.document_id))];
    const { data: parentDocs } = await db
      .from("project_documents")
      .select("id, title, file_name, doc_type")
      .in("id", docIds);
    const parentMap = new Map((parentDocs || []).map(d => [d.id, d]));

    // Build document context for prompt
    const docContextParts: string[] = [];
    const docRoles: { versionId: string; role: string; title: string }[] = [];
    for (const v of versionRows) {
      const parent = parentMap.get(v.document_id);
      const role = resolveRole(v, parent);
      const title = parent?.title || parent?.file_name || v.deliverable_type || "Document";
      docRoles.push({ versionId: v.id, role, title });

      const text = (v.plaintext || "").slice(0, 15000); // Cap per doc
      docContextParts.push(`--- DOCUMENT [${v.id}] role="${role}" title="${title}" ---\n${text}\n--- END ---`);
    }

    const isDocumentary = ["documentary", "documentary-series", "hybrid-documentary"].includes(
      (project.format || "").toLowerCase().replace(/_/g, "-")
    );
    const isSeries = ["tv-series", "limited-series", "vertical-drama", "digital-series", "documentary-series", "anim-series"].includes(
      (project.format || "").toLowerCase().replace(/_/g, "-")
    );

    // Build prompt
    const systemPrompt = composeSystem({
      baseSystem: buildCoverageSystemPrompt(subjectType, bundleKey, isDocumentary, isSeries),
      guardrailsBlock: isDocumentary
        ? "CRITICAL: This is a documentary project. You MUST NOT invent characters, events, or facts. If information is not present in the documents, say 'Unknown' or 'Not evidenced'. Every claim must be traceable to a specific document."
        : undefined,
    });

    const userPrompt = `Project: "${project.title}"
Format: ${project.format}
Genres: ${(project.genres || []).join(", ")}
Budget: ${project.budget_range || "Not specified"}
Target Audience: ${project.target_audience || "Not specified"}
Lane: ${project.assigned_lane || "Not assigned"}

Coverage Type: ${subjectType === "bundle" ? `Bundle: ${bundleKey}` : "Single Document"}
Documents (${versionRows.length}):

${docContextParts.join("\n\n")}

Produce the coverage analysis JSON now.`;

    const model = options?.model || MODELS.BALANCED;

    const result = await callLLM({
      apiKey,
      model,
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 8000,
    });

    // Parse output
    let output: any;
    try {
      output = JSON.parse(extractJSON(result.content));
    } catch {
      console.error("Failed to parse coverage output:", result.content.slice(0, 500));
      return new Response(JSON.stringify({ error: "AI returned unparseable output" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure schema version
    output.schema_version = SCHEMA_VERSION;
    if (!output.subject) {
      output.subject = {
        subject_type: subjectType,
        bundle_key: bundleKey,
        document_version_ids: docVersionIds,
      };
    }

    // Extract scores
    const creativeScore = output.scores?.creative?.score ?? null;
    const commercialScore = output.scores?.commercial?.score ?? null;
    const narrativeScore = output.scores?.narrative?.score ?? null;
    const confidenceScore = output.confidence?.score ?? null;

    // Upsert subject
    let subjectId: string;
    if (subjectType === "document_version") {
      const { data: existing } = await db
        .from("project_coverage_subjects")
        .select("id")
        .eq("document_version_id", docVersionIds[0])
        .maybeSingle();

      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSubject } = await db
          .from("project_coverage_subjects")
          .insert({
            project_id: projectId,
            subject_type: "document_version",
            document_version_id: docVersionIds[0],
          })
          .select("id")
          .single();
        subjectId = newSubject!.id;
      }
    } else {
      // Bundle: upsert by project + bundle_key
      const { data: existing } = await db
        .from("project_coverage_subjects")
        .select("id")
        .eq("project_id", projectId)
        .eq("subject_type", "bundle")
        .eq("bundle_key", bundleKey)
        .maybeSingle();

      if (existing) {
        subjectId = existing.id;
        await db.from("project_coverage_subjects").update({
          bundle_document_version_ids: docVersionIds,
          bundle_name: bundleName,
        }).eq("id", subjectId);
      } else {
        const { data: newSubject } = await db
          .from("project_coverage_subjects")
          .insert({
            project_id: projectId,
            subject_type: "bundle",
            bundle_key: bundleKey,
            bundle_name: bundleName,
            bundle_document_version_ids: docVersionIds,
          })
          .select("id")
          .single();
        subjectId = newSubject!.id;
      }
    }

    // Insert run
    const { data: run, error: runError } = await db
      .from("project_coverage_runs")
      .insert({
        project_id: projectId,
        subject_id: subjectId,
        status: "completed",
        model,
        output,
        creative_score: creativeScore,
        commercial_score: commercialScore,
        narrative_score: narrativeScore,
        confidence: confidenceScore,
        risk_flags: output.risk_flags || [],
        contradictions: output.contradictions || [],
        missing_docs: output.missing_docs || null,
      })
      .select("*")
      .single();

    if (runError) {
      console.error("Failed to save run:", runError);
      return new Response(JSON.stringify({ error: "Failed to save coverage run" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ run, output }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Coverage engine error:", err);
    if (err.message === "RATE_LIMIT") {
      return new Response(JSON.stringify({ error: "RATE_LIMIT", message: "AI rate limit reached. Please wait a moment and try again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (err.message === "PAYMENT_REQUIRED") {
      return new Response(JSON.stringify({ error: "PAYMENT_REQUIRED", message: "AI usage limit reached. Please check your plan." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Helpers ───

function resolveRole(version: any, parentDoc: any): string {
  const keys = [version.deliverable_type, parentDoc?.doc_type].filter(Boolean);
  const ROLE_MAP: Record<string, string> = {
    concept_brief: "concept", concept: "concept", concept_lock: "concept",
    market_sheet: "market", market: "market", market_positioning: "market",
    deck: "deck", pitch_deck: "deck", lookbook: "deck",
    blueprint: "blueprint", series_bible: "blueprint", beat_sheet: "blueprint",
    character_bible: "character_bible", character: "character_bible",
    episode_grid: "episode_grid", vertical_episode_beats: "episode_grid",
    season_arc: "season_arc",
    documentary_outline: "documentary_outline", doc_outline: "documentary_outline",
    format_rules: "format_rules",
    script: "feature_script", feature_script: "feature_script",
    pilot_script: "episode_script", episode_script: "episode_script",
    episode_1_script: "episode_script",
    production_draft: "production_draft",
  };

  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[-\s]/g, "_");
    if (ROLE_MAP[norm]) return ROLE_MAP[norm];
  }

  const titleText = [parentDoc?.title, parentDoc?.file_name].filter(Boolean).join(" ").toLowerCase();
  if (/concept/i.test(titleText)) return "concept";
  if (/market/i.test(titleText)) return "market";
  if (/deck|lookbook/i.test(titleText)) return "deck";
  if (/character/i.test(titleText)) return "character_bible";
  if (/episode.*grid/i.test(titleText)) return "episode_grid";
  if (/season.*arc/i.test(titleText)) return "season_arc";
  if (/blueprint|bible/i.test(titleText)) return "blueprint";
  if (/script/i.test(titleText)) return "feature_script";

  return "other";
}

function buildRoleMap(
  bundleKey: string | null,
  format: string,
  docs: any[],
  versionMap: Map<string, any>,
): { versionId: string; role: string }[] {
  const BUNDLE_ROLES: Record<string, string[]> = {
    PACKAGE: ["concept", "market", "deck", "blueprint", "character_bible", "episode_script", "feature_script", "episode_grid", "season_arc", "format_rules", "documentary_outline"],
    NARRATIVE: ["feature_script", "episode_script", "episode_grid", "season_arc", "blueprint", "character_bible"],
    COMMERCIAL: ["market", "deck", "concept"],
    DOCU_REALITY: ["documentary_outline", "deck", "market", "concept"],
  };

  const desiredRoles = BUNDLE_ROLES[bundleKey || "PACKAGE"] || BUNDLE_ROLES.PACKAGE;
  const result: { versionId: string; role: string }[] = [];
  const usedRoles = new Set<string>();

  for (const role of desiredRoles) {
    for (const doc of docs) {
      if (!doc.latest_version_id) continue;
      const version = versionMap.get(doc.latest_version_id);
      const docRole = resolveRole(version || {}, doc);
      if (docRole === role && !usedRoles.has(role)) {
        result.push({ versionId: doc.latest_version_id, role });
        usedRoles.add(role);
        break;
      }
    }
  }

  return result;
}

function getBundleName(key: string | null): string {
  const names: Record<string, string> = {
    PACKAGE: "Whole Package",
    NARRATIVE: "Narrative Coverage",
    COMMERCIAL: "Commercial Readiness",
    DOCU_REALITY: "Documentary Integrity",
  };
  return names[key || ""] || "Coverage";
}

function buildCoverageSystemPrompt(
  subjectType: string,
  bundleKey: string | null,
  isDocumentary: boolean,
  isSeries: boolean,
): string {
  return `You are an expert script reader, development executive, and market analyst for film and television projects.

You are performing a PROJECT PROFILE COVERAGE analysis.

Your task: Evaluate the provided document(s) and produce a structured coverage report.

${subjectType === "bundle" ? `This is a BUNDLE coverage (${bundleKey}). You are evaluating multiple documents together as a package.` : "This is a single DOCUMENT coverage."}

${isDocumentary ? "This is a DOCUMENTARY project. You MUST NOT fabricate characters, events, or facts. If evidence is not in the documents, state 'Unknown'." : ""}

${isSeries ? "This is a SERIES project. Evaluate episode structure, season arc coherence, and character consistency across episodes." : ""}

OUTPUT FORMAT: Return ONLY valid JSON matching this exact schema:
{
  "schema_version": "v1",
  "scores": {
    "creative": { "score": <0-100>, "summary": "<1-2 sentences>", "bullets": ["<key point>", ...] },
    "commercial": { "score": <0-100>, "summary": "<1-2 sentences>", "bullets": ["<key point>", ...] },
    "narrative": ${isSeries || subjectType === "document_version" ? '{ "score": <0-100>, "summary": "<1-2 sentences>", "bullets": ["<key point>", ...] }' : "null"}
  },
  "confidence": { "score": <0-100>, "drivers": ["<reason for confidence level>", ...] },
  "strengths": ["<strength>", ...],
  "weaknesses": ["<weakness>", ...],
  "recommendations": [
    { "id": "R1", "title": "<title>", "why": "<reasoning>", "action": "<specific action>", "priority": "high|med|low", "targets": ["<doc role or specific>"] }
  ],
  "risk_flags": [
    { "type": "<type>", "severity": "high|med|low", "description": "<description>", "evidence_refs": ["E1"] }
  ],
  "contradictions": [
    { "type": "<type>", "severity": "high|med|low", "docA": "<document_version_id>", "docB": "<document_version_id>", "description": "<what contradicts>", "evidence_refs": ["E1", "E2"] }
  ],
  "evidence": [
    { "ref": "E1", "document_version_id": "<uuid>", "role": "<role>", "anchor": "<quote or section ref>", "note": "<why this matters>", "kind": "supported|inference" }
  ]
}

RULES:
1. Every claim MUST be backed by an evidence entry. If you cannot find evidence, mark kind as "inference".
2. Scores: 0-100 scale. 80+ = strong, 60-79 = solid, 40-59 = needs work, <40 = significant issues.
3. Confidence reflects how much material you had to work with. Fewer docs = lower confidence.
4. For bundles with multiple docs, actively look for CONTRADICTIONS between documents.
5. Be specific and actionable in recommendations.
6. Return ONLY valid JSON. No markdown fences, no commentary.`;
}
