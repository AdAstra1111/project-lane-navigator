/**
 * visual-unit-engine — Edge function for Visual Unit Engine v1.0.
 * Canonical, reviewable, diffable pipeline for visual units.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, parseJsonSafe } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

const DOC_TYPE_PRIORITY = [
  "shot_list", "scene_list", "screenplay", "script", "episode_script",
  "beat_sheet", "character_bible", "series_overview", "season_arc",
  "episode_grid", "lookbook", "world_tone",
];

// ─── select_sources ───
async function handleSelectSources(db: any, body: any) {
  const { projectId, preferApproved } = body;
  const sourceVersions: Record<string, any> = {};
  const warnings: string[] = [];

  for (const docType of DOC_TYPE_PRIORITY) {
    // Check project_active_docs first
    const { data: activeDocs } = await db.from("project_active_docs")
      .select("active_version_id, document_id")
      .eq("project_id", projectId)
      .eq("doc_type_key", docType)
      .limit(1);

    if (activeDocs && activeDocs.length > 0 && activeDocs[0].active_version_id) {
      const { data: ver } = await db.from("project_document_versions")
        .select("id, document_id, version_number, approval_status")
        .eq("id", activeDocs[0].active_version_id)
        .single();
      if (ver) {
        sourceVersions[docType] = {
          document_id: ver.document_id,
          version_id: ver.id,
          approval_status: ver.approval_status || "none",
          version_number: ver.version_number,
          label: "active",
        };
        continue;
      }
    }

    // Find doc by type
    const { data: docs } = await db.from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .limit(1);

    if (!docs || docs.length === 0) {
      warnings.push(`No ${docType} document found`);
      continue;
    }

    const docId = docs[0].id;

    // Get versions
    let query = db.from("project_document_versions")
      .select("id, document_id, version_number, approval_status")
      .eq("document_id", docId)
      .order("version_number", { ascending: false });

    if (preferApproved) {
      const { data: approved } = await db.from("project_document_versions")
        .select("id, document_id, version_number, approval_status")
        .eq("document_id", docId)
        .eq("approval_status", "approved")
        .order("version_number", { ascending: false })
        .limit(1);

      if (approved && approved.length > 0) {
        sourceVersions[docType] = {
          document_id: approved[0].document_id,
          version_id: approved[0].id,
          approval_status: "approved",
          version_number: approved[0].version_number,
          label: "approved",
        };
        continue;
      }
    }

    const { data: versions } = await query.limit(1);
    if (versions && versions.length > 0) {
      sourceVersions[docType] = {
        document_id: versions[0].document_id,
        version_id: versions[0].id,
        approval_status: versions[0].approval_status || "none",
        version_number: versions[0].version_number,
        label: "latest",
      };
    } else {
      warnings.push(`No versions for ${docType}`);
    }
  }

  return json({ source_versions: sourceVersions, warnings });
}

// ─── create_run ───
async function handleCreateRun(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, sourceVersions: providedVersions, scope, unitKey } = body;

  // Resolve sources
  let sourceVersions = providedVersions;
  if (!sourceVersions || Object.keys(sourceVersions).length === 0) {
    const srcResp = await handleSelectSources(db, { projectId, preferApproved: true });
    const srcData = await srcResp.json();
    sourceVersions = {};
    for (const [k, v] of Object.entries(srcData.source_versions as Record<string, any>)) {
      sourceVersions[k] = v.version_id;
    }
  }

  // Create run
  const { data: run, error: runErr } = await db.from("visual_unit_runs").insert({
    project_id: projectId,
    source_versions: sourceVersions,
    status: "pending",
    created_by: userId,
  }).select().single();

  if (runErr) return json({ error: "Failed to create run: " + runErr.message }, 500);

  try {
    // Gather context from source versions
    const versionIds = Object.values(sourceVersions).filter(Boolean) as string[];
    let contextText = "";

    if (versionIds.length > 0) {
      const { data: versions } = await db.from("project_document_versions")
        .select("id, document_id, plaintext, content")
        .in("id", versionIds);

      // Get doc info
      const docIds = (versions || []).map((v: any) => v.document_id);
      const { data: docs } = await db.from("project_documents")
        .select("id, title, doc_type")
        .in("id", docIds);
      const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

      const parts: string[] = [];
      for (const v of (versions || [])) {
        const doc = docMap.get(v.document_id);
        const text = (v.plaintext || v.content || "").toString();
        if (text.length > 0) {
          const label = doc ? `${doc.title} (${doc.doc_type})` : "Unknown";
          parts.push(`--- ${label} ---\n${text.slice(0, 3000)}`);
        }
      }
      contextText = parts.join("\n\n").slice(0, 14000);
    }

    if (!contextText || contextText.length < 50) {
      await db.from("visual_unit_runs").update({ status: "failed", error: "Insufficient source content" }).eq("id", run.id);
      return json({ error: "Insufficient source content for visual unit extraction" }, 400);
    }

    const scopeInstruction = scope === "unit" && unitKey
      ? `Regenerate ONLY the visual unit with unit_key="${unitKey}". Return a JSON array with exactly 1 item.`
      : "Extract ALL visual units from the materials. Return a JSON array.";

    const systemPrompt = `You are a visual production analyst. Analyze project materials and extract visual units — key moments that could become storyboard frames, trailer beats, or pitch images.

${scopeInstruction}

Each unit must have these fields:
- unit_key (string, stable id like "scene_3_turn" or "beat_7_reveal")
- scene_number (int or null)
- beat_ref (string or null, e.g. "B12")
- logline (string, 1-2 sentences describing the visual moment)
- pivot (string, what changes in this moment)
- stakes_shift (string, how stakes escalate)
- power_shift (string, who gains/loses power)
- visual_intention (string, describe the ideal visual treatment)
- location (string)
- time (string, e.g. "night", "dawn")
- characters_present (string[])
- wardrobe_props_notes (string)
- tone (string[])
- setpieces (string[])
- trailer_value (int 1-10)
- storyboard_value (int 1-10)
- pitch_value (int 1-10)
- complexity (int 1-10)
- risks (string[])
- suggested_shots (array of {type, subject, purpose})

Return ONLY a JSON array of these objects. No commentary.`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system: systemPrompt,
      user: contextText,
      temperature: 0.4,
      maxTokens: 8000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);
    const candidates = Array.isArray(parsed) ? parsed : (parsed.units || parsed.visual_units || [parsed]);

    if (candidates.length === 0) {
      await db.from("visual_unit_runs").update({ status: "failed", error: "No candidates extracted" }).eq("id", run.id);
      return json({ error: "No visual units could be extracted" }, 400);
    }

    // Insert candidates
    const rows = candidates.map((c: any) => ({
      project_id: projectId,
      run_id: run.id,
      unit_key: c.unit_key || `unit_${Math.random().toString(36).slice(2, 8)}`,
      status: "proposed",
      candidate_payload: c,
      extracted_from: { scene_number: c.scene_number, beat_ref: c.beat_ref },
      scores: {
        trailer_value: c.trailer_value,
        storyboard_value: c.storyboard_value,
        pitch_value: c.pitch_value,
        complexity: c.complexity,
      },
      created_by: userId,
    }));

    const { data: inserted, error: insertErr } = await db.from("visual_unit_candidates").insert(rows).select();
    if (insertErr) {
      await db.from("visual_unit_runs").update({ status: "failed", error: insertErr.message }).eq("id", run.id);
      return json({ error: "Failed to insert candidates: " + insertErr.message }, 500);
    }

    // Log events
    const events = (inserted || []).map((c: any) => ({
      project_id: projectId,
      candidate_id: c.id,
      event_type: "proposed",
      payload: { run_id: run.id, unit_key: c.unit_key },
      created_by: userId,
    }));
    if (events.length > 0) await db.from("visual_unit_events").insert(events);

    await db.from("visual_unit_runs").update({ status: "complete" }).eq("id", run.id);
    return json({ ok: true, runId: run.id, candidatesCount: (inserted || []).length });

  } catch (err: any) {
    await db.from("visual_unit_runs").update({ status: "failed", error: err.message }).eq("id", run.id);
    throw err;
  }
}

// ─── list_runs ───
async function handleListRuns(db: any, body: any) {
  const { projectId, limit = 20 } = body;
  const { data } = await db.from("visual_unit_runs")
    .select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(limit);
  return json({ runs: data || [] });
}

// ─── list_candidates ───
async function handleListCandidates(db: any, body: any) {
  const { projectId, runId, unitKey, statuses } = body;
  let query = db.from("visual_unit_candidates").select("*").eq("project_id", projectId);
  if (runId) query = query.eq("run_id", runId);
  if (unitKey) query = query.eq("unit_key", unitKey);
  if (statuses && Array.isArray(statuses) && statuses.length > 0) query = query.in("status", statuses);
  const { data } = await query.order("created_at", { ascending: false }).limit(200);
  return json({ candidates: data || [] });
}

// ─── get_candidate ───
async function handleGetCandidate(db: any, body: any) {
  const { projectId, candidateId } = body;
  const { data: candidate } = await db.from("visual_unit_candidates")
    .select("*").eq("id", candidateId).eq("project_id", projectId).single();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const { data: events } = await db.from("visual_unit_events")
    .select("*").eq("candidate_id", candidateId)
    .order("created_at", { ascending: false }).limit(50);
  return json({ candidate, events: events || [] });
}

// ─── get_unit ───
async function handleGetUnit(db: any, body: any) {
  const { projectId, unitKey } = body;
  const { data: unit } = await db.from("visual_units")
    .select("*").eq("project_id", projectId).eq("unit_key", unitKey).single();
  if (!unit) return json({ error: "Unit not found" }, 404);
  const { data: events } = await db.from("visual_unit_events")
    .select("*").eq("unit_id", unit.id)
    .order("created_at", { ascending: false }).limit(50);
  return json({ unit, events: events || [] });
}

// ─── accept_candidate ───
async function handleAcceptCandidate(db: any, body: any, userId: string) {
  const { projectId, candidateId } = body;
  const { data: candidate } = await db.from("visual_unit_candidates")
    .select("*, visual_unit_runs(source_versions)")
    .eq("id", candidateId).eq("project_id", projectId).single();
  if (!candidate) return json({ error: "Candidate not found" }, 404);

  // Check for existing canonical
  const { data: existing } = await db.from("visual_units")
    .select("*").eq("project_id", projectId).eq("unit_key", candidate.unit_key).single();

  if (existing?.locked) return json({ error: "Unit is locked" }, 409);

  // Upsert canonical
  const canonicalData = {
    project_id: projectId,
    unit_key: candidate.unit_key,
    candidate_id: candidateId,
    canonical_payload: candidate.candidate_payload,
    source_versions: candidate.visual_unit_runs?.source_versions || {},
    stale: false,
    updated_by: userId,
  };

  let unitId: string;
  if (existing) {
    await db.from("visual_units").update(canonicalData).eq("id", existing.id);
    unitId = existing.id;
    await db.from("visual_unit_events").insert({
      project_id: projectId, unit_id: existing.id,
      event_type: "overridden",
      payload: { old_candidate_id: existing.candidate_id, new_candidate_id: candidateId },
      created_by: userId,
    });
  } else {
    const { data: newUnit } = await db.from("visual_units").insert({
      ...canonicalData, created_by: userId,
    }).select().single();
    unitId = newUnit?.id;
  }

  // Update candidate status
  await db.from("visual_unit_candidates").update({ status: "accepted" }).eq("id", candidateId);

  // Supersede other candidates for same run+unit_key
  await db.from("visual_unit_candidates")
    .update({ status: "superseded" })
    .eq("run_id", candidate.run_id)
    .eq("unit_key", candidate.unit_key)
    .neq("id", candidateId)
    .in("status", ["proposed", "modified"]);

  // Log event
  await db.from("visual_unit_events").insert({
    project_id: projectId, unit_id: unitId, candidate_id: candidateId,
    event_type: "accepted", payload: {}, created_by: userId,
  });

  return json({ ok: true, unitId });
}

// ─── reject_candidate ───
async function handleRejectCandidate(db: any, body: any, userId: string) {
  const { projectId, candidateId, reason } = body;
  await db.from("visual_unit_candidates").update({ status: "rejected" })
    .eq("id", candidateId).eq("project_id", projectId);
  await db.from("visual_unit_events").insert({
    project_id: projectId, candidate_id: candidateId,
    event_type: "rejected", payload: { reason: reason || "" }, created_by: userId,
  });
  return json({ ok: true });
}

// ─── modify_candidate ───
async function handleModifyCandidate(db: any, body: any, userId: string) {
  const { projectId, candidateId, patch, note } = body;
  const { data: original } = await db.from("visual_unit_candidates")
    .select("*").eq("id", candidateId).eq("project_id", projectId).single();
  if (!original) return json({ error: "Candidate not found" }, 404);

  const mergedPayload = { ...original.candidate_payload, ...patch };
  const newScores = {
    trailer_value: mergedPayload.trailer_value,
    storyboard_value: mergedPayload.storyboard_value,
    pitch_value: mergedPayload.pitch_value,
    complexity: mergedPayload.complexity,
  };

  const { data: newCandidate } = await db.from("visual_unit_candidates").insert({
    project_id: projectId,
    run_id: original.run_id,
    unit_key: original.unit_key,
    status: "modified",
    candidate_payload: mergedPayload,
    extracted_from: original.extracted_from,
    scores: newScores,
    created_by: userId,
  }).select().single();

  await db.from("visual_unit_events").insert({
    project_id: projectId, candidate_id: newCandidate?.id,
    event_type: "modified",
    payload: { original_candidate_id: candidateId, patch, note: note || "" },
    created_by: userId,
  });

  return json({ ok: true, newCandidateId: newCandidate?.id });
}

// ─── lock/unlock ───
async function handleLockUnit(db: any, body: any, userId: string, lock: boolean) {
  const { projectId, unitKey } = body;
  const { data: unit } = await db.from("visual_units")
    .select("id").eq("project_id", projectId).eq("unit_key", unitKey).single();
  if (!unit) return json({ error: "Unit not found" }, 404);
  await db.from("visual_units").update({ locked: lock, updated_by: userId }).eq("id", unit.id);
  await db.from("visual_unit_events").insert({
    project_id: projectId, unit_id: unit.id,
    event_type: lock ? "locked" : "unlocked", payload: {}, created_by: userId,
  });
  return json({ ok: true });
}

// ─── mark_stale ───
async function handleMarkStale(db: any, body: any, userId: string) {
  const { projectId, unitKey, stale, reason } = body;
  const { data: unit } = await db.from("visual_units")
    .select("id").eq("project_id", projectId).eq("unit_key", unitKey).single();
  if (!unit) return json({ error: "Unit not found" }, 404);
  await db.from("visual_units").update({ stale: !!stale, updated_by: userId }).eq("id", unit.id);
  await db.from("visual_unit_events").insert({
    project_id: projectId, unit_id: unit.id,
    event_type: "stale_marked", payload: { stale: !!stale, reason: reason || "" }, created_by: userId,
  });
  return json({ ok: true });
}

// ─── compare ───
async function handleCompare(db: any, body: any, userId: string) {
  const { projectId, from, to, write } = body;
  if (!from || !to) return json({ error: "from and to required" }, 400);

  async function resolvePayload(ref: any): Promise<any> {
    if (ref.candidateId) {
      const { data } = await db.from("visual_unit_candidates")
        .select("candidate_payload, unit_key").eq("id", ref.candidateId).single();
      return data;
    }
    if (ref.unitKey) {
      const { data } = await db.from("visual_units")
        .select("canonical_payload, unit_key").eq("project_id", projectId).eq("unit_key", ref.unitKey).single();
      return data ? { candidate_payload: data.canonical_payload, unit_key: data.unit_key } : null;
    }
    return null;
  }

  const a = await resolvePayload(from);
  const b = await resolvePayload(to);
  if (!a || !b) return json({ error: "Could not resolve both sides" }, 404);

  const payloadA = a.candidate_payload || a.canonical_payload || {};
  const payloadB = b.candidate_payload || b.canonical_payload || {};

  // Compute diff
  const allKeys = new Set([...Object.keys(payloadA), ...Object.keys(payloadB)]);
  const changedFields: any[] = [];
  const scoreDeltaFields = ["trailer_value", "storyboard_value", "pitch_value", "complexity"];
  const scoreDeltas: Record<string, number> = {};

  for (const key of allKeys) {
    const va = JSON.stringify(payloadA[key]);
    const vb = JSON.stringify(payloadB[key]);
    if (va !== vb) {
      changedFields.push({ field: key, from: payloadA[key], to: payloadB[key] });
      if (scoreDeltaFields.includes(key)) {
        scoreDeltas[key] = (payloadB[key] || 0) - (payloadA[key] || 0);
      }
    }
  }

  const shotsA = payloadA.suggested_shots || [];
  const shotsB = payloadB.suggested_shots || [];
  const shotDeltas = { added: Math.max(0, shotsB.length - shotsA.length), removed: Math.max(0, shotsA.length - shotsB.length) };

  const diffSummary = `${changedFields.length} field(s) changed. Score deltas: ${JSON.stringify(scoreDeltas)}`;
  const diffJson = { changed_fields: changedFields, summary: diffSummary, score_deltas: scoreDeltas, shot_deltas: shotDeltas };

  let diffId: string | undefined;
  if (write) {
    const { data: diff } = await db.from("visual_unit_diffs").insert({
      project_id: projectId,
      from_candidate_id: from.candidateId || null,
      to_candidate_id: to.candidateId || null,
      from_unit_id: null,
      to_unit_id: null,
      unit_key: a.unit_key || b.unit_key || null,
      diff_summary: diffSummary,
      diff_json: diffJson,
      created_by: userId,
    }).select().single();
    diffId = diff?.id;

    await db.from("visual_unit_events").insert({
      project_id: projectId,
      event_type: "compared",
      payload: { from, to, diffId },
      created_by: userId,
    });
  }

  return json({ diff_summary: diffSummary, diff_json: diffJson, diffId });
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Unauthorized" }, 401); }

    const body = await req.json();
    const { action } = body;
    const projectId = body.projectId || body.project_id;
    if (!projectId && action !== "select_sources") return json({ error: "projectId required" }, 400);
    body.projectId = projectId;

    const db = adminClient();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey && action === "create_run") return json({ error: "AI key not configured" }, 500);

    // Verify project access
    if (projectId) {
      const { data: project } = await db.from("projects").select("id").eq("id", projectId).single();
      if (!project) return json({ error: "Project not found" }, 404);
    }

    switch (action) {
      case "select_sources": return await handleSelectSources(db, body);
      case "create_run": return await handleCreateRun(db, body, userId, apiKey!);
      case "list_runs": return await handleListRuns(db, body);
      case "list_candidates": return await handleListCandidates(db, body);
      case "get_candidate": return await handleGetCandidate(db, body);
      case "get_unit": return await handleGetUnit(db, body);
      case "accept_candidate": return await handleAcceptCandidate(db, body, userId);
      case "reject_candidate": return await handleRejectCandidate(db, body, userId);
      case "modify_candidate": return await handleModifyCandidate(db, body, userId);
      case "lock_unit": return await handleLockUnit(db, body, userId, true);
      case "unlock_unit": return await handleLockUnit(db, body, userId, false);
      case "mark_stale": return await handleMarkStale(db, body, userId);
      case "compare": return await handleCompare(db, body, userId);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("visual-unit-engine error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (msg === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: msg }, 500);
  }
});
