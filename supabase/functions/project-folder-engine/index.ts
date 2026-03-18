import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emitTransition, TRANSITION_EVENTS } from "../_shared/transitionLedger.ts";
import { extractCanonConstraints, detectCanonDrift, logDriftResult } from "../_shared/canonConstraintEnforcement.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

// ─── Doc Type Key Normalizer (server-side mirror) ───

const KEY_MAP: Record<string, string> = {
  idea: "idea",
  concept_brief: "concept_brief", concept: "concept_brief", concept_lock: "concept_brief",
  market_sheet: "market_sheet", market: "market_sheet", market_positioning: "market_sheet",
  vertical_market_sheet: "market_sheet",
  treatment: "treatment",
  story_outline: "story_outline", outline: "story_outline", architecture: "story_outline",
  deck: "deck", pitch_deck: "deck", lookbook: "deck",
  blueprint: "blueprint", series_bible: "blueprint",
  beat_sheet: "beat_sheet",
  character_bible: "character_bible", character: "character_bible",
  episode_grid: "episode_grid", vertical_episode_beats: "episode_grid",
  season_arc: "season_arc", season_script: "season_script", vertical_episode_beats_bundle: "season_script",
  documentary_outline: "documentary_outline", doc_outline: "documentary_outline",
  format_rules: "format_rules",
  script: "feature_script", feature_script: "feature_script", feature: "feature_script",
  pilot_script: "episode_script", episode_script: "episode_script", episode_1_script: "episode_script",
  source_script: "feature_script",
  production_draft: "production_draft",
};

const TITLE_HINTS: [RegExp, string][] = [
  [/concept\s*brief/i, "concept_brief"],
  [/market\s*(sheet|positioning)/i, "market_sheet"],
  [/\bdeck\b/i, "deck"],
  [/blueprint|series\s*bible/i, "blueprint"],
  [/beat\s*sheet/i, "beat_sheet"],
  [/character\s*bible/i, "character_bible"],
  [/episode\s*grid/i, "episode_grid"],
  [/season\s*arc/i, "season_arc"],
  [/documentary\s*outline/i, "documentary_outline"],
  [/format\s*rules/i, "format_rules"],
  [/pilot|episode\s*1\b/i, "episode_script"],
  [/\bscript\b/i, "feature_script"],
];

function resolveDocTypeKey(version: any, parentDoc: any, isSeries: boolean): string {
  const keys = [version?.deliverable_type, parentDoc?.doc_type].filter(Boolean);
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[-\s]/g, "_");
    if (KEY_MAP[norm]) {
      let key = KEY_MAP[norm];
      if (isSeries && key === "feature_script") key = "episode_script";
      return key;
    }
  }
  if (version?.label) {
    const normLabel = version.label.toLowerCase().replace(/[-\s]/g, "_");
    if (KEY_MAP[normLabel]) return KEY_MAP[normLabel];
  }
  const titleText = [parentDoc?.title, parentDoc?.file_name].filter(Boolean).join(" ");
  for (const [re, key] of TITLE_HINTS) {
    if (re.test(titleText)) {
      if (isSeries && key === "feature_script") return "episode_script";
      return key;
    }
  }
  return "other";
}

const SERIES_FORMATS = ["tv-series", "limited-series", "vertical-drama", "digital-series", "documentary-series", "anim-series"];

function isSeriesFormat(format: string): boolean {
  return SERIES_FORMATS.includes((format || "").toLowerCase().replace(/_/g, "-"));
}

// ─── Helper: resolve best CI/GP for a version from development_runs or meta_json ───
async function resolveVersionScores(db: any, versionId: string): Promise<{ ci: number | null; gp: number | null }> {
  // 1. Check existing meta_json scores
  const { data: verRow } = await db.from("project_document_versions")
    .select("meta_json")
    .eq("id", versionId)
    .maybeSingle();
  const meta = verRow?.meta_json || {};
  const metaCi = typeof meta.ci === "number" ? meta.ci : null;
  const metaGp = typeof meta.gp === "number" ? meta.gp : null;

  // 2. Check most recent ANALYZE development_run for this version
  const { data: latestRun } = await db.from("development_runs")
    .select("output_json")
    .eq("version_id", versionId)
    .eq("run_type", "ANALYZE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let runCi: number | null = null;
  let runGp: number | null = null;
  if (latestRun?.output_json) {
    const out = latestRun.output_json;
    runCi = out?.ci_score ?? out?.scores?.ci_score ?? out?.scores?.ci ?? out?.ci ?? null;
    runGp = out?.gp_score ?? out?.scores?.gp_score ?? out?.scores?.gp ?? out?.gp ?? null;
  }

  // Use the highest available scores (run vs meta_json)
  const bestCi = (runCi !== null && metaCi !== null) ? Math.max(runCi, metaCi)
    : (runCi ?? metaCi);
  const bestGp = (runGp !== null && metaGp !== null) ? Math.max(runGp, metaGp)
    : (runGp ?? metaGp);

  return { ci: bestCi, gp: bestGp };
}

// ─── Helper: mark version as approved in project_document_versions ───
// Atomically writes approval_status AND persists CI/GP to meta_json
async function markVersionApproved(db: any, versionId: string, userId: string) {
  // Resolve best available scores
  const { ci, gp } = await resolveVersionScores(db, versionId);

  // Read existing meta_json to merge
  const { data: existing } = await db.from("project_document_versions")
    .select("meta_json")
    .eq("id", versionId)
    .maybeSingle();
  const existingMeta = (existing?.meta_json && typeof existing.meta_json === "object" && !Array.isArray(existing.meta_json))
    ? existing.meta_json : {};

  // Build merged update — only override scores if we have values
  const mergedMeta = { ...existingMeta };
  if (ci !== null) {
    mergedMeta.ci = ci;
    mergedMeta.score_source = mergedMeta.score_source || "approval_stamp";
    mergedMeta.score_updated_at = new Date().toISOString();
  }
  if (gp !== null) {
    mergedMeta.gp = gp;
  }

  // Atomic write: approval + scores in one update
  await db.from("project_document_versions")
    .update({
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userId,
      meta_json: mergedMeta,
    })
    .eq("id", versionId);

  console.log(`[project-folder-engine] version_approved_with_scores { version_id: "${versionId}", ci: ${ci}, gp: ${gp}, source: "markVersionApproved" }`);
}

// ─── Main Handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // Auth
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: claimsErr } = await anonClient.auth.getUser(token);
    if (claimsErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }
    const userId = user.id as string;

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { action, projectId } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing projectId" }), { status: 400, headers: JSON_HEADERS });
    }

    // Verify access
    const { data: hasAccess } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "No access" }), { status: 403, headers: JSON_HEADERS });
    }

    // Get project format
    const { data: project } = await db.from("projects").select("format").eq("id", projectId).single();
    const isSeries = isSeriesFormat(project?.format || "");

    // ─── ACTION: approve ───
    if (action === "approve") {
      const { documentVersionId, sourceFlow, notes } = body;
      if (!documentVersionId) {
        return new Response(JSON.stringify({ error: "Missing documentVersionId" }), { status: 400, headers: JSON_HEADERS });
      }

      // Fetch version + parent doc
      const { data: version } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, document_id, approval_status")
        .eq("id", documentVersionId).single();
      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), { status: 404, headers: JSON_HEADERS });
      }

      const { data: parentDoc } = await db.from("project_documents")
        .select("id, doc_type, title, file_name")
        .eq("id", version.document_id).single();

      const docTypeKey = resolveDocTypeKey(version, parentDoc, isSeries);

      // PATCH A: Demote all previous approvals for this doc_type within the project.
      // Enforces single-authoritative-version invariant per (project_id, doc_type).
      // Scope: ALL documents with the same doc_type in this project (not just same document_id),
      // because multiple project_documents rows can share a doc_type and each may have
      // approved versions — approving one must clear ALL others.
      const docType = parentDoc?.doc_type;
      let allDocIdsForType: string[] = [version.document_id];
      if (docType) {
        const { data: siblingDocs } = await db.from("project_documents")
          .select("id")
          .eq("project_id", projectId)
          .eq("doc_type", docType)
          .neq("id", version.document_id);
        if (siblingDocs && siblingDocs.length > 0) {
          allDocIdsForType = allDocIdsForType.concat(siblingDocs.map((d: any) => d.id));
        }
      }

      const { data: prevApproved } = await db.from("project_document_versions")
        .select("id")
        .in("document_id", allDocIdsForType)
        .eq("approval_status", "approved")
        .neq("id", documentVersionId);

      if (prevApproved && prevApproved.length > 0) {
        const prevIds = prevApproved.map((v: any) => v.id);
        await db.from("project_document_versions")
          .update({ approval_status: "superseded" })
          .in("id", prevIds);
        console.log(`[project-folder-engine] approval_superseded_previous { doc_type: "${docType}", project_id: "${projectId}", superseded_count: ${prevIds.length}, superseded_ids: ${JSON.stringify(prevIds)}, new_authoritative: "${documentVersionId}" }`);

        // ── TRANSITION LEDGER: version_superseded for each demoted version ──
        for (const prevId of prevIds) {
          await emitTransition(db, {
            projectId,
            eventType: TRANSITION_EVENTS.VERSION_SUPERSEDED,
            docType: docTypeKey,
            sourceVersionId: prevId,
            resultingVersionId: documentVersionId,
            trigger: "approval_supersede",
            sourceOfTruth: "project-folder-engine",
            resultingState: { approval_status: "superseded" },
          }, { critical: false });
        }
      }

      // ── CCE: Canon drift gate — block approval of drifted versions ──
      // Upstream/source doc types are exempt — they define canon, not consume it
      const CANON_DRIFT_EXEMPT_DOC_TYPES = new Set([
        "idea", "concept_brief", "canon", "nec", "format_rules",
        "project_overview", "creative_brief", "market_positioning",
        "vertical_market_sheet", "market_sheet", "character_bible",
        "deck",
      ]);
      const shouldCheckDrift = !CANON_DRIFT_EXEMPT_DOC_TYPES.has(docType || "");
      if (shouldCheckDrift) {
        try {
          const { data: vPlain } = await db.from("project_document_versions")
            .select("plaintext, meta_json").eq("id", documentVersionId).single();
          const existingDrift = (vPlain?.meta_json as any)?.canon_drift;
          // Use persisted drift result if available, otherwise compute on-demand
          let driftPassed = true;
          if (existingDrift && typeof existingDrift.passed === "boolean") {
            driftPassed = existingDrift.passed;
          } else if (vPlain?.plaintext && vPlain.plaintext.length > 100) {
            const { data: canonRow } = await db.from("project_canon")
              .select("canon_json").eq("project_id", projectId).maybeSingle();
            const constraints = extractCanonConstraints(canonRow?.canon_json || {});
            const driftResult = detectCanonDrift(vPlain.plaintext, constraints);
            logDriftResult("project-folder-engine:approve", projectId, docType || "unknown", driftResult);
            driftPassed = driftResult.passed;
            // Persist for future use
            if (driftResult.constraintsUsed) {
              const driftMeta = {
                canon_drift: {
                  passed: driftResult.passed,
                  violations: driftResult.findings.filter((f: any) => f.severity === "violation").length,
                  warnings: driftResult.findings.filter((f: any) => f.severity === "warning").length,
                  domains_checked: driftResult.domains_checked,
                  checked_at: driftResult.checkedAt,
                  findings: driftResult.findings.map((f: any) => ({ domain: f.domain, severity: f.severity, detail: f.detail })),
                },
              };
              await db.from("project_document_versions").update({
                meta_json: { ...(vPlain?.meta_json || {}), ...driftMeta },
              }).eq("id", documentVersionId);
            }
          }
          if (!driftPassed) {
            console.error(`[project-folder-engine][CCE] CANON_DRIFT_APPROVAL_BLOCKED { version_id: "${documentVersionId}", project_id: "${projectId}", doc_type: "${docType}" }`);
            return new Response(JSON.stringify({
              error: "CANON_DRIFT_APPROVAL_BLOCKED",
              message: "Cannot approve: this version has canon drift violations. Review the Canon Drift badge for details and regenerate or repair the version.",
              version_id: documentVersionId,
              doc_type: docType,
            }), { status: 422, headers: JSON_HEADERS });
          }
        } catch (cceGateErr: any) {
          // CCE gate failure is non-fatal for approval — log but allow
          console.warn(`[project-folder-engine][CCE] approval gate check failed (non-fatal):`, cceGateErr?.message);
        }
      } else {
        console.log(`[project-folder-engine][CCE] canon_drift_gate_skipped: upstream_doc_type { version_id: "${documentVersionId}", doc_type: "${docType}" }`);
      }

      // Mark version as approved
      if (version.approval_status !== "approved") {
        await markVersionApproved(db, documentVersionId, userId);
      }

      // ── TRANSITION LEDGER: version_approved (fail-open — never block approval) ──
      await emitTransition(db, {
        projectId,
        eventType: TRANSITION_EVENTS.VERSION_APPROVED,
        docType: docTypeKey,
        resultingVersionId: documentVersionId,
        trigger: sourceFlow || "manual",
        sourceOfTruth: "project-folder-engine",
        createdBy: userId,
        resultingState: { approval_status: "approved", doc_type_key: docTypeKey },
      }, { critical: false });

      // IEL: Also set as current version so ABVR picks it up as authoritative
      // This ensures Auto-Run rebinds to the user-approved version
      try {
        await db.rpc("set_current_version", {
          p_document_id: version.document_id,
          p_new_version_id: documentVersionId,
        });
        console.log(`[project-folder-engine] set_current_version { version_id: "${documentVersionId}", document_id: "${version.document_id}" }`);
      } catch (setCurrentErr: any) {
        console.warn(`[project-folder-engine] set_current_version_failed { version_id: "${documentVersionId}", error: "${setCurrentErr?.message}" }`);
      }

      // ── TRANSITION LEDGER: authoritative_version_resolved (fail-open — never block approval) ──
      await emitTransition(db, {
        projectId,
        eventType: TRANSITION_EVENTS.AUTHORITATIVE_VERSION_RESOLVED,
        docType: docTypeKey,
        resultingVersionId: documentVersionId,
        trigger: sourceFlow || "manual",
        sourceOfTruth: "project-folder-engine",
        createdBy: userId,
        resultingState: { is_current: true, approval_status: "approved", doc_type_key: docTypeKey },
      }, { critical: false });

      // Auto-set primary if this is a script authority doc type
      const SCRIPT_DOC_TYPES = ["season_script", "feature_script", "episode_script", "script", "pilot_script", "script_pdf"];
      const parentDocType = parentDoc?.doc_type || "";
      if (SCRIPT_DOC_TYPES.includes(parentDocType)) {
        // Clear is_primary for other scripts in this project
        await db.from("project_documents")
          .update({ is_primary: false })
          .eq("project_id", projectId)
          .eq("is_primary", true)
          .in("doc_type", SCRIPT_DOC_TYPES);
        // Set this document as primary
        await db.from("project_documents")
          .update({ is_primary: true })
          .eq("id", version.document_id);
      }

      // Upsert into project_active_docs
      const { data: upserted, error: upsertErr } = await db.from("project_active_docs")
        .upsert({
          project_id: projectId,
          doc_type_key: docTypeKey,
          document_version_id: documentVersionId,
          approved_at: new Date().toISOString(),
          approved_by: userId,
          source_flow: sourceFlow || "manual",
          notes: notes || null,
        }, { onConflict: "project_id,doc_type_key" })
        .select("*")
        .single();

      if (upsertErr) {
        console.error("Upsert error:", upsertErr);
        return new Response(JSON.stringify({ error: "Failed to activate doc" }), { status: 500, headers: JSON_HEADERS });
      }

      return new Response(JSON.stringify({ active: upserted, docTypeKey }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: approve-many ───
    if (action === "approve-many") {
      const { documentVersionIds, sourceFlow } = body;
      if (!Array.isArray(documentVersionIds) || documentVersionIds.length === 0) {
        return new Response(JSON.stringify({ error: "Missing documentVersionIds array" }), { status: 400, headers: JSON_HEADERS });
      }

      const results: any[] = [];
      for (const versionId of documentVersionIds) {
        const { data: version } = await db.from("project_document_versions")
          .select("id, deliverable_type, label, stage, document_id, approval_status")
          .eq("id", versionId).single();
        if (!version) continue;

        const { data: parentDoc } = await db.from("project_documents")
          .select("id, doc_type, title, file_name")
          .eq("id", version.document_id).single();

        const docTypeKey = resolveDocTypeKey(version, parentDoc, isSeries);

        // Demote previous approvals for this doc_type across the whole project
        const amDocType = parentDoc?.doc_type;
        let amDocIds: string[] = [version.document_id];
        if (amDocType) {
          const { data: amSiblings } = await db.from("project_documents")
            .select("id").eq("project_id", projectId).eq("doc_type", amDocType).neq("id", version.document_id);
          if (amSiblings) amDocIds = amDocIds.concat(amSiblings.map((d: any) => d.id));
        }
        const { data: prevApproved } = await db.from("project_document_versions")
          .select("id")
          .in("document_id", amDocIds)
          .eq("approval_status", "approved")
          .neq("id", versionId);
        if (prevApproved && prevApproved.length > 0) {
          await db.from("project_document_versions")
            .update({ approval_status: "superseded" })
            .in("id", prevApproved.map((v: any) => v.id));
        }

        // Mark approved
        if (version.approval_status !== "approved") {
          await markVersionApproved(db, versionId, userId);
        }

        // Upsert active
        const { data: upserted } = await db.from("project_active_docs")
          .upsert({
            project_id: projectId,
            doc_type_key: docTypeKey,
            document_version_id: versionId,
            approved_at: new Date().toISOString(),
            approved_by: userId,
            source_flow: sourceFlow || "manual",
          }, { onConflict: "project_id,doc_type_key" })
          .select("*")
          .single();

        if (upserted) results.push(upserted);
      }

      return new Response(JSON.stringify({ activeDocs: results, count: results.length }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: set-active ───
    if (action === "set-active") {
      const { docTypeKey, documentVersionId, allowDraft } = body;
      if (!docTypeKey || !documentVersionId) {
        return new Response(JSON.stringify({ error: "Missing docTypeKey or documentVersionId" }), { status: 400, headers: JSON_HEADERS });
      }

      // Validate version exists and check approval status
      const { data: version } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, document_id, approval_status")
        .eq("id", documentVersionId).single();
      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), { status: 404, headers: JSON_HEADERS });
      }

      // Require approved unless allowDraft is true
      if (version.approval_status !== "approved" && !allowDraft) {
        return new Response(JSON.stringify({
          error: "Version is not approved. Approve it first, or pass allowDraft:true.",
          approval_status: version.approval_status,
        }), { status: 400, headers: JSON_HEADERS });
      }

      const { data: parentDoc } = await db.from("project_documents")
        .select("id, doc_type, title, file_name, project_id")
        .eq("id", version.document_id).single();

      if (parentDoc?.project_id !== projectId) {
        return new Response(JSON.stringify({ error: "Version does not belong to project" }), { status: 400, headers: JSON_HEADERS });
      }

      const computedKey = resolveDocTypeKey(version, parentDoc, isSeries);
      if (computedKey !== docTypeKey && docTypeKey !== "other") {
        console.warn(`Doc type key mismatch: computed=${computedKey}, requested=${docTypeKey}`);
      }

      const { data: upserted, error: upsertErr } = await db.from("project_active_docs")
        .upsert({
          project_id: projectId,
          doc_type_key: docTypeKey,
          document_version_id: documentVersionId,
          approved_at: new Date().toISOString(),
          approved_by: userId,
          source_flow: "manual_override",
        }, { onConflict: "project_id,doc_type_key" })
        .select("*")
        .single();

      if (upsertErr) {
        return new Response(JSON.stringify({ error: "Failed to set active" }), { status: 500, headers: JSON_HEADERS });
      }

      return new Response(JSON.stringify({ active: upserted }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: init (returns candidates, does NOT auto-activate) ───
    if (action === "init") {
      // Get all project docs with latest versions
      const { data: docs } = await db.from("project_documents")
        .select("id, doc_type, title, file_name, latest_version_id")
        .eq("project_id", projectId)
        .not("latest_version_id", "is", null);

      if (!docs?.length) {
        return new Response(JSON.stringify({ candidates: [] }), { headers: JSON_HEADERS });
      }

      // Get existing active docs
      const { data: existing } = await db.from("project_active_docs")
        .select("doc_type_key")
        .eq("project_id", projectId);
      const existingKeys = new Set((existing || []).map((e: any) => e.doc_type_key));

      // Get version metadata
      const versionIds = docs.map(d => d.latest_version_id).filter(Boolean);
      const { data: versions } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, approval_status")
        .in("id", versionIds);
      const versionMap = new Map((versions || []).map((v: any) => [v.id, v]));

      // Build candidates grouped by doc_type_key
      const byKey: Record<string, { versionId: string; title: string; approvalStatus: string }[]> = {};
      for (const doc of docs) {
        if (!doc.latest_version_id) continue;
        const version = versionMap.get(doc.latest_version_id);
        const key = resolveDocTypeKey(version || {}, doc, isSeries);
        if (key === "other") continue;
        if (existingKeys.has(key)) continue;

        if (!byKey[key]) byKey[key] = [];
        byKey[key].push({
          versionId: doc.latest_version_id,
          title: doc.title || doc.file_name || "Untitled",
          approvalStatus: version?.approval_status || "draft",
        });
      }

      // Pick best candidate per key: prefer approved, then latest
      const candidates: any[] = [];
      for (const [key, entries] of Object.entries(byKey)) {
        // Sort: approved first, then by title heuristic for pilot
        const sorted = entries.sort((a, b) => {
          if (a.approvalStatus === "approved" && b.approvalStatus !== "approved") return -1;
          if (b.approvalStatus === "approved" && a.approvalStatus !== "approved") return 1;
          // For episode_script, prefer pilot
          if (key === "episode_script") {
            const aIsPilot = /pilot|episode\s*1\b|ep\s*1\b/i.test(a.title);
            const bIsPilot = /pilot|episode\s*1\b|ep\s*1\b/i.test(b.title);
            if (aIsPilot && !bIsPilot) return -1;
            if (bIsPilot && !aIsPilot) return 1;
          }
          return 0;
        });
        const best = sorted[0];
        candidates.push({
          doc_type_key: key,
          document_version_id: best.versionId,
          title: best.title,
          approval_status: best.approvalStatus,
          reason: best.approvalStatus === "approved" ? "Latest approved version" : "Latest draft (not yet approved)",
        });
      }

      return new Response(JSON.stringify({ candidates }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: unapprove ───
    if (action === "unapprove") {
      const { documentVersionId } = body;
      if (!documentVersionId) {
        return new Response(JSON.stringify({ error: "Missing documentVersionId" }), { status: 400, headers: JSON_HEADERS });
      }

      // Fetch version
      const { data: version } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, document_id, approval_status")
        .eq("id", documentVersionId).single();
      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), { status: 404, headers: JSON_HEADERS });
      }

      // Revert approval_status to draft
      await db.from("project_document_versions")
        .update({ approval_status: "draft", approved_at: null, approved_by: null })
        .eq("id", documentVersionId);

      // Remove from project_active_docs if this version is the active one
      const { data: parentDoc } = await db.from("project_documents")
        .select("id, doc_type, title, file_name")
        .eq("id", version.document_id).single();

      const docTypeKey = resolveDocTypeKey(version, parentDoc, isSeries);

      const { data: activeDoc } = await db.from("project_active_docs")
        .select("id, document_version_id")
        .eq("project_id", projectId)
        .eq("doc_type_key", docTypeKey)
        .single();

      if (activeDoc && activeDoc.document_version_id === documentVersionId) {
        await db.from("project_active_docs")
          .delete()
          .eq("id", activeDoc.id);
      }

      return new Response(JSON.stringify({ unapproved: true, docTypeKey }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: list ───
    if (action === "list") {
      const { data: activeDocs } = await db.from("project_active_docs")
        .select("*")
        .eq("project_id", projectId)
        .order("doc_type_key");

      return new Response(JSON.stringify({ activeDocs: activeDocs || [] }), { headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: JSON_HEADERS });

  } catch (err: any) {
    console.error("Folder engine error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: JSON_HEADERS,
    });
  }
});
