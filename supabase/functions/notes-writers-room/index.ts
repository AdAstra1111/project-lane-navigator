import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callLLM, extractJSON, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(data: any) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── PRESET DOC TYPE GROUPS ──
const PRESET_DOC_TYPES: Record<string, string[]> = {
  script_pack: [
    "script", "screenplay", "script_pdf", "feature_script", "screenplay_draft",
    "production_draft", "pilot_script", "episode_script", "season_script", "master_script",
  ],
  development_pack: [
    "idea", "concept_brief", "brief", "topline", "market_sheet", "convergence",
    "blueprint", "architecture", "format_rules", "beat_sheet",
  ],
  canon_pack: [
    "character_bible", "world_bible", "rules", "timeline", "relationships",
    "threads", "canon",
  ],
  production_pack: [
    "scene_list", "shot_plan", "shot_list", "storyboard", "schedule",
    "location_list", "call_sheet",
  ],
  approved_pack: [], // special: resolved at runtime
};

// Priority order for trimming when over budget
const DOC_TYPE_PRIORITY: Record<string, number> = {
  script: 10, screenplay: 10, script_pdf: 10, feature_script: 10, screenplay_draft: 10,
  production_draft: 10, pilot_script: 10, episode_script: 10, season_script: 10, master_script: 10,
  character_bible: 8, world_bible: 7, blueprint: 6, architecture: 6,
  idea: 5, concept_brief: 5, brief: 5, market_sheet: 5, beat_sheet: 5,
  convergence: 4, format_rules: 3,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("Missing auth", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || supabaseServiceKey;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return err("Unauthorized", 401);

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action } = body;

    if (action === "ping") return ok({ pong: true });

    // ── Helper: resolve best version for a document ──
    async function resolveVersion(documentId: string, preference: string = "current") {
      // Try current first
      if (preference === "current" || preference === "latest") {
        const { data: cur } = await admin.from("project_document_versions")
          .select("id, plaintext, version_number, label, created_at, document_id, is_current, status")
          .eq("document_id", documentId)
          .eq("is_current", true)
          .maybeSingle();
        if (cur?.plaintext) return cur;
      }

      // Try approved
      if (preference === "approved") {
        const { data: approved } = await admin.from("project_document_versions")
          .select("id, plaintext, version_number, label, created_at, document_id, is_current, status")
          .eq("document_id", documentId)
          .eq("status", "final")
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (approved?.plaintext) return approved;
      }

      // Fallback: latest by version_number
      const { data: latest } = await admin.from("project_document_versions")
        .select("id, plaintext, version_number, label, created_at, document_id, is_current, status")
        .eq("document_id", documentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      return latest?.plaintext ? latest : null;
    }

    // ── Helper: build excerpt from plaintext ──
    function buildExcerpt(plaintext: string, mode: string, charsPerDoc: number): string {
      if (!plaintext) return "";
      if (plaintext.length <= charsPerDoc) return plaintext;
      if (mode === "start") return plaintext.slice(0, charsPerDoc);
      if (mode === "end") return plaintext.slice(-charsPerDoc);
      // default: mixed
      const half = Math.floor(charsPerDoc / 2);
      return plaintext.slice(0, half) + "\n\n[...MIDDLE OMITTED...]\n\n" + plaintext.slice(-half);
    }

    // ── Helper: infer excerpt mode from user message ──
    function inferMode(message: string): string {
      const msg = (message || "").toLowerCase();
      if (/\b(end|ending|final|last|climax|conclusion|denouement|third act|act\s*3)\b/.test(msg)) return "end";
      if (/\b(begin|beginning|start|opening|first|act\s*1|inciting)\b/.test(msg)) return "start";
      return "end"; // default to end (most relevant for active dev)
    }

    // ── Helper: infer which preset or doc types from user message ──
    function inferPresetFromMessage(message: string): string {
      const msg = (message || "").toLowerCase();
      if (/\b(market\s*sheet|market|commercial)\b/.test(msg)) return "development_pack";
      if (/\b(character|bible|world|canon|relationship|timeline)\b/.test(msg)) return "canon_pack";
      if (/\b(brief|idea|topline|concept|convergence|blueprint|architecture|format)\b/.test(msg)) return "development_pack";
      if (/\b(scene\s*list|shot|storyboard|schedule|production)\b/.test(msg)) return "production_pack";
      return "script_pack";
    }

    // ── ACTION: list_project_documents ──
    if (action === "list_project_documents") {
      const { projectId } = body;
      if (!projectId) return err("Missing projectId");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const { data: docs } = await admin.from("project_documents")
        .select("id, doc_type, file_name, created_at, updated_at")
        .eq("project_id", projectId)
        .order("doc_type");

      if (!docs || docs.length === 0) return ok({ docs: [] });

      // Get version info for each doc
      const docList = await Promise.all(docs.map(async (doc: any) => {
        const { data: versions } = await admin.from("project_document_versions")
          .select("id, version_number, is_current, status, created_at, label")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false })
          .limit(5);

        const current = versions?.find((v: any) => v.is_current);
        const latest = versions?.[0];
        const approved = versions?.find((v: any) => v.status === "final");

        return {
          documentId: doc.id,
          docType: doc.doc_type,
          title: doc.file_name || doc.doc_type,
          updatedAt: doc.updated_at || doc.created_at,
          currentVersionId: current?.id || null,
          currentVersionNumber: current?.version_number || null,
          latestVersionId: latest?.id || null,
          latestVersionNumber: latest?.version_number || null,
          approvedVersionId: approved?.id || null,
          versionCount: versions?.length || 0,
        };
      }));

      return ok({ docs: docList });
    }

    // ── ACTION: load_context_pack ──
    if (action === "load_context_pack") {
      const {
        projectId,
        presetKey = "script_pack",
        includeDocTypes,
        includeDocumentIds,
        versionPreference = "current",
        mode = "end",
        charsPerDoc = 8000,
        maxTotalChars = 24000,
      } = body;
      if (!projectId) return err("Missing projectId");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      // Fetch project metadata
      const { data: project } = await admin.from("projects")
        .select("title, format, budget_range, tone, target_audience, genres")
        .eq("id", projectId).single();

      // Resolve which docs to fetch
      let docFilter: any;
      let resolvedPreset = presetKey;

      if (includeDocumentIds && includeDocumentIds.length > 0) {
        // Exact doc IDs — fetch then reorder to match caller's deterministic order
        const { data: docs } = await admin.from("project_documents")
          .select("id, doc_type, file_name")
          .eq("project_id", projectId)
          .in("id", includeDocumentIds);
        // Reorder to match includeDocumentIds order (`.in()` does not preserve order)
        const docMap = new Map((docs || []).map((d: any) => [d.id, d]));
        const ordered: any[] = [];
        for (const did of includeDocumentIds) {
          const d = docMap.get(did);
          if (d) ordered.push(d);
        }
        docFilter = ordered;
        resolvedPreset = "custom";
      } else if (includeDocTypes && includeDocTypes.length > 0) {
        const { data: docs } = await admin.from("project_documents")
          .select("id, doc_type, file_name")
          .eq("project_id", projectId)
          .in("doc_type", includeDocTypes);
        docFilter = docs || [];
        resolvedPreset = "custom";
      } else if (presetKey === "approved_pack") {
        // Special: all docs that have an approved (status=final) version
        const { data: allDocs } = await admin.from("project_documents")
          .select("id, doc_type, file_name")
          .eq("project_id", projectId);
        docFilter = allDocs || [];
        // Will filter below to only those with final versions
      } else {
        const types = PRESET_DOC_TYPES[presetKey] || PRESET_DOC_TYPES.script_pack;
        // Use ilike pattern matching for flexibility
        const { data: allDocs } = await admin.from("project_documents")
          .select("id, doc_type, file_name")
          .eq("project_id", projectId);
      docFilter = (allDocs || []).filter((d: any) =>
          types.some(t => d.doc_type === t || d.doc_type.includes(t) || t.includes(d.doc_type))
        );
        // Fallback: if preset matched nothing, load ALL project docs
        if (docFilter.length === 0 && allDocs && allDocs.length > 0) {
          docFilter = allDocs;
          resolvedPreset = "all_available";
        }
      }

      if (!docFilter || docFilter.length === 0) {
        return ok({ ok: false, reason: "no_documents", contextPack: null });
      }

      // Sort by priority (highest first)
      docFilter.sort((a: any, b: any) => {
        const pa = DOC_TYPE_PRIORITY[a.doc_type] || 1;
        const pb = DOC_TYPE_PRIORITY[b.doc_type] || 1;
        return pb - pa;
      });

      // Build doc excerpts
      const docResults: any[] = [];
      let totalChars = 0;

      for (const doc of docFilter) {
        if (totalChars >= maxTotalChars) break;

        const vPref = presetKey === "approved_pack" ? "approved" : versionPreference;
        const ver = await resolveVersion(doc.id, vPref);
        if (!ver || !ver.plaintext) continue;

        const remainingBudget = maxTotalChars - totalChars;
        const excerptBudget = Math.min(charsPerDoc, remainingBudget);
        const excerpt = buildExcerpt(ver.plaintext, mode, excerptBudget);

        docResults.push({
          documentId: doc.id,
          docType: doc.doc_type,
          title: doc.file_name || doc.doc_type,
          versionId: ver.id,
          versionNumber: ver.version_number,
          label: ver.label,
          updatedAt: ver.created_at,
          excerptChars: excerpt.length,
          totalChars: ver.plaintext.length,
          excerptText: excerpt,
        });
        totalChars += excerpt.length;
      }

      if (docResults.length === 0) {
        return ok({ ok: false, reason: "no_documents_with_text", contextPack: null });
      }

      return ok({
        ok: true,
        contextPack: {
          presetKey: resolvedPreset,
          mode,
          versionPreference,
          totalChars,
          project: project ? {
            title: project.title, format: project.format, genres: project.genres,
            tone: project.tone, targetAudience: project.target_audience,
          } : null,
          docs: docResults,
        },
      });
    }

    // ── get_or_create thread helper ──
    async function getOrCreateThread(projectId: string, documentId: string, noteHash: string, versionId?: string, noteSnapshot?: any) {
      const { data: existing } = await admin
        .from("note_threads")
        .select("*")
        .eq("document_id", documentId)
        .eq("note_hash", noteHash)
        .maybeSingle();

      if (existing) {
        if (versionId && existing.version_id !== versionId) {
          await admin.from("note_threads").update({ version_id: versionId }).eq("id", existing.id);
        }
        const { data: stateExists } = await admin.from("note_thread_state").select("thread_id").eq("thread_id", existing.id).maybeSingle();
        if (!stateExists) {
          await admin.from("note_thread_state").insert({ thread_id: existing.id, updated_by: user!.id });
        }
        return existing;
      }

      const { data: newThread, error: createErr } = await admin
        .from("note_threads")
        .insert({
          project_id: projectId,
          document_id: documentId,
          note_hash: noteHash,
          version_id: versionId || null,
          note_snapshot: noteSnapshot || null,
          created_by: user!.id,
        })
        .select()
        .single();
      if (createErr) throw new Error(createErr.message);

      await admin.from("note_thread_state").insert({ thread_id: newThread.id, updated_by: user!.id });
      return newThread;
    }

    // ── Build the IFFY system prompt + context block ──
    function buildSystemPrompt(
      projectMeta: any,
      noteInfo: any,
      state: any,
      contextPack: any,
    ): string {
      const projectLabel = projectMeta
        ? `${projectMeta.title} (${projectMeta.format || 'unknown format'})`
        : 'Unknown project';

      const docsLoaded = contextPack?.docs?.length || 0;
      const docsSummary = docsLoaded > 0
        ? contextPack.docs.map((d: any) => `${d.docType} v${d.versionNumber}${d.label ? ' — ' + d.label : ''} (${d.excerptChars} chars)`).join(', ')
        : 'None';

      let prompt = `You are the IFFY Writers' Room assistant, operating INSIDE the IFFY film/TV development application. You have DIRECT ACCESS to project documents loaded by the server via the CONTEXT PACK below.

PROJECT: ${projectLabel}
${projectMeta?.genres ? `Genres: ${projectMeta.genres.join(', ')}` : ''}
${projectMeta?.tone ? `Tone: ${projectMeta.tone}` : ''}

DOCUMENTS LOADED: ${docsLoaded} (${docsSummary})

Note under discussion:
${JSON.stringify(noteInfo, null, 2)}

Direction preferences: ${JSON.stringify(state?.direction || {})}
Pinned constraints: ${JSON.stringify(state?.pinned_constraints || [])}

CRITICAL RULES:
1. You CAN read project documents — they are provided to you in the CONTEXT PACK below. NEVER say "I can't read your script", "paste the text", or "I don't have access to your documents."
2. If you have document excerpts, USE THEM to answer. Reference specific details, quotes, page elements.
3. When answering, briefly state which docs you're using: "Using Script v12…" or "Using Brief v3 + Market Sheet v2…"
4. If the CONTEXT PACK is empty AND the user asks about documents, say: "No documents are currently loaded in the context. Use the 'Change context' button above the chat to load documents."
5. Be concise, creative, and practical. Focus on actionable solutions.
6. WRITE ACCESS: You DO have write capability via the Apply pipeline. The workflow is: (1) you propose a Change Plan, (2) the user reviews and confirms it, (3) the user clicks Apply, (4) the system creates a new document version with the changes and sets it as current. NEVER say "I don't have direct write access", "I can't write", "I can't apply changes", "I'm read-only", "I cannot modify the script", or any similar claim. Instead say: "I can apply changes — confirm the plan and press Apply to write them into a new version."
7. FORBIDDEN CLAIMS — never use these phrases: "no direct write access", "I can't write", "I can't apply", "read-only", "cannot modify", "unable to edit", "no write access", "doesn't have write access". If asked whether you can edit, respond affirmatively and explain the Propose → Confirm → Apply workflow.`;

      // Append document excerpts
      if (contextPack?.docs?.length > 0) {
        prompt += "\n\n═══ CONTEXT PACK ═══";
        for (const doc of contextPack.docs) {
          prompt += `\n\n── ${doc.docType.toUpperCase()} (v${doc.versionNumber}${doc.label ? ' — ' + doc.label : ''}, ${doc.totalChars} chars total, showing ${doc.excerptChars} chars) ──\n${doc.excerptText}`;
        }
        prompt += "\n\n═══ END CONTEXT PACK ═══";
      }

      return prompt;
    }

    // ── ACTION: get ──
    if (action === "get") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing projectId/documentId/noteHash");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      const [stateRes, msgsRes, setsRes] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }),
        admin.from("note_option_sets").select("*").eq("thread_id", thread.id).order("option_set_index", { ascending: true }),
      ]);

      return ok({
        thread,
        state: stateRes.data,
        messages: msgsRes.data || [],
        optionSets: setsRes.data || [],
      });
    }

    // ── ACTION: update_state ──
    if (action === "update_state") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot, direction, pinnedConstraints } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      const updates: any = { updated_by: user.id };
      if (direction !== undefined) updates.direction = direction;
      if (pinnedConstraints !== undefined) updates.pinned_constraints = pinnedConstraints;

      await admin.from("note_thread_state").update(updates).eq("thread_id", thread.id);

      return ok({ success: true, threadId: thread.id });
    }

    // ── ACTION: post_message ──
    if (action === "post_message") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot, content, role, contextPack: clientContextPack } = body;
      if (!projectId || !documentId || !noteHash || !content) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      // Insert user message
      const { data: userMsg } = await admin.from("note_thread_messages").insert({
        thread_id: thread.id,
        role: role || "user",
        content,
        created_by: user.id,
      }).select().single();

      // Get state + messages
      const [stateRes, msgsRes] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(30),
      ]);

      const state = stateRes.data;
      const noteInfo = thread.note_snapshot || {};

      // Use client-provided context pack, or auto-load one
      let contextPack = clientContextPack;
      if (!contextPack || !contextPack.docs || contextPack.docs.length === 0) {
        // Auto-load based on message intent
        const autoPreset = inferPresetFromMessage(content);
        const autoMode = inferMode(content);
        console.log(`[writers-room] Auto-loading context: preset=${autoPreset}, mode=${autoMode}`);

        // Fetch project metadata
        const { data: project } = await admin.from("projects")
          .select("title, format, budget_range, tone, target_audience, genres")
          .eq("id", projectId).single();

        // Find matching docs
        const types = PRESET_DOC_TYPES[autoPreset] || PRESET_DOC_TYPES.script_pack;
        const { data: allDocs } = await admin.from("project_documents")
          .select("id, doc_type, file_name")
          .eq("project_id", projectId);

        const matchingDocs = (allDocs || []).filter((d: any) =>
          types.some((t: string) => d.doc_type === t || d.doc_type.includes(t) || t.includes(d.doc_type))
        );

        // Sort by priority
        matchingDocs.sort((a: any, b: any) => (DOC_TYPE_PRIORITY[b.doc_type] || 1) - (DOC_TYPE_PRIORITY[a.doc_type] || 1));

        const docResults: any[] = [];
        let totalChars = 0;
        const maxTotal = 24000;
        const perDoc = 8000;

        for (const doc of matchingDocs) {
          if (totalChars >= maxTotal) break;
          const ver = await resolveVersion(doc.id, "current");
          if (!ver || !ver.plaintext) continue;
          const budget = Math.min(perDoc, maxTotal - totalChars);
          const excerpt = buildExcerpt(ver.plaintext, autoMode, budget);
          docResults.push({
            documentId: doc.id, docType: doc.doc_type, title: doc.file_name || doc.doc_type,
            versionId: ver.id, versionNumber: ver.version_number, label: ver.label,
            updatedAt: ver.created_at, excerptChars: excerpt.length, totalChars: ver.plaintext.length,
            excerptText: excerpt,
          });
          totalChars += excerpt.length;
        }

        contextPack = {
          presetKey: autoPreset, mode: autoMode, docs: docResults,
          project: project ? { title: project.title, format: project.format, genres: project.genres, tone: project.tone } : null,
        };
      }

      const projectMeta = contextPack?.project || null;
      const systemPrompt = buildSystemPrompt(projectMeta, noteInfo, state, contextPack);

      const chatHistory = (msgsRes.data || []).map((m: any) => `${m.role}: ${m.content}`).join("\n");

      const result = await callLLM({
        apiKey,
        model: MODELS.FAST,
        system: systemPrompt,
        user: chatHistory,
        temperature: 0.5,
        maxTokens: 2000,
      });

      // Save assistant reply
      const { data: assistantMsg } = await admin.from("note_thread_messages").insert({
        thread_id: thread.id,
        role: "assistant",
        content: result.content,
        created_by: user.id,
      }).select().single();

      return ok({ userMessage: userMsg, assistantMessage: assistantMsg });
    }

    // ── ACTION: select_option ──
    if (action === "select_option") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot, selectedOption } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      await admin.from("note_thread_state").update({
        selected_option: selectedOption,
        updated_by: user.id,
      }).eq("thread_id", thread.id);

      return ok({ success: true });
    }

    // ── ACTION: generate_options ──
    if (action === "generate_options") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot, contextPack: clientCtx } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      const [stateRes, msgsRes, setsRes] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(20),
        admin.from("note_option_sets").select("*").eq("thread_id", thread.id).order("option_set_index", { ascending: true }),
      ]);

      const state = stateRes.data;
      const priorSets = setsRes.data || [];
      const lastIndex = state?.last_generated_set || priorSets.length;
      const newIndex = lastIndex + 1;

      const priorCompact = priorSets.flatMap((s: any) =>
        (s.options || []).map((o: any) => ({ id: o.id, pitch: o.pitch }))
      );

      const noteInfo = thread.note_snapshot || {};
      const direction = state?.direction || {};
      const pins = state?.pinned_constraints || [];
      const chatHistory = (msgsRes.data || []).map((m: any) => `${m.role}: ${m.content}`).join("\n").slice(0, 4000);

      // Build context excerpt for options generation
      let contextExcerpt = "";
      if (clientCtx?.docs?.length > 0) {
        contextExcerpt = clientCtx.docs.map((d: any) => `[${d.docType} v${d.versionNumber}]: ${d.excerptText?.slice(0, 3000) || ''}`).join("\n\n");
      }

      const projectLabel = clientCtx?.project ? `${clientCtx.project.title} (${clientCtx.project.format || 'unknown'})` : '';

      const systemPrompt = `You are the IFFY Writers' Room options generator for ${projectLabel || 'a film/TV project'}.
You have access to project documents via the server context pack.
Generate 5-9 NEW creative solutions for the given note/issue.

HARD RULE: Do NOT repeat any prior solutions or close variants.

Prior solutions to AVOID repeating (id + pitch):
${JSON.stringify(priorCompact)}

You MUST respond with ONLY valid JSON matching this exact schema:
{
  "clarifying_questions": ["string"] (0-2 items),
  "new_options": [
    {
      "id": "opt_<unique>",
      "pitch": "one-line pitch",
      "what_changes": ["string"],
      "pros": ["string"],
      "cons": ["string"],
      "scope_estimate": "small|medium|large",
      "cost_flags": ["string"],
      "risk_flags": ["string"],
      "rewrite_instructions": ["string"]
    }
  ] (5-9 items),
  "recommended_option_id": "string",
  "recommended_reason": "string"
}`;

      const userPrompt = `Note to solve:
${JSON.stringify(noteInfo, null, 2)}

Direction preferences: ${JSON.stringify(direction)}
Locked constraints: ${JSON.stringify(pins)}

Recent discussion:
${chatHistory}

${contextExcerpt ? `Project documents context:\n${contextExcerpt.slice(0, 6000)}` : "No documents loaded."}

Generate 5-9 completely new options. Do NOT repeat prior solutions.`;

      let parsed: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await callLLM({
          apiKey,
          model: MODELS.FAST,
          system: systemPrompt,
          user: userPrompt,
          temperature: 0.7,
          maxTokens: 6000,
        });

        try {
          parsed = JSON.parse(extractJSON(result.content));
          if (parsed.new_options && Array.isArray(parsed.new_options) && parsed.new_options.length >= 3) break;
          parsed = null;
        } catch { parsed = null; }
      }

      if (!parsed) return err("Failed to generate valid options after retries");

      parsed.new_options = parsed.new_options.map((o: any, i: number) => ({
        ...o,
        id: o.id || `opt_${newIndex}_${i}`,
      }));

      let insertIndex = newIndex;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error: insertErr } = await admin.from("note_option_sets").insert({
          thread_id: thread.id,
          option_set_index: insertIndex,
          direction: direction,
          pinned_constraints: pins,
          options: parsed.new_options,
          created_by: user.id,
        });
        if (insertErr) {
          if (insertErr.message.includes("unique") || insertErr.message.includes("duplicate")) {
            const { data: latestSets } = await admin.from("note_option_sets").select("option_set_index").eq("thread_id", thread.id).order("option_set_index", { ascending: false }).limit(1);
            insertIndex = (latestSets?.[0]?.option_set_index || insertIndex) + 1;
            continue;
          }
          throw new Error(insertErr.message);
        }
        break;
      }

      await admin.from("note_thread_state").update({
        last_generated_set: insertIndex,
        updated_by: user.id,
      }).eq("thread_id", thread.id);

      return ok({
        optionSetIndex: insertIndex,
        options: parsed.new_options,
        clarifyingQuestions: parsed.clarifying_questions || [],
        recommendedOptionId: parsed.recommended_option_id,
        recommendedReason: parsed.recommended_reason,
      });
    }

    // ── ACTION: synthesize_best ──
    if (action === "synthesize_best") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot, contextPack: clientCtx } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      const [stateRes, msgsRes, setsRes] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(30),
        admin.from("note_option_sets").select("*").eq("thread_id", thread.id).order("option_set_index", { ascending: false }).limit(5),
      ]);

      const state = stateRes.data;
      if (!state?.selected_option) return err("No option selected — select an option before synthesizing");

      const pins = state.pinned_constraints || [];
      const direction = state.direction || {};
      const chatHistory = (msgsRes.data || []).map((m: any) => `${m.role}: ${m.content}`).join("\n").slice(0, 5000);
      const recentOptions = (setsRes.data || []).flatMap((s: any) => s.options || []);

      let contextExcerpt = "";
      if (clientCtx?.docs?.length > 0) {
        contextExcerpt = clientCtx.docs.map((d: any) => `[${d.docType} v${d.versionNumber}]: ${d.excerptText?.slice(0, 3000) || ''}`).join("\n\n");
      }

      const systemPrompt = `You are a Writers' Room synthesis engine. Produce a consolidated direction based on the selected option, discussion, and constraints.

You MUST respond with ONLY valid JSON matching this exact schema:
{
  "chosen_option_id": "string",
  "direction_summary": "string (2-3 sentences)",
  "locked_constraints_used": ["string"],
  "rewrite_plan": ["string (step-by-step actions)"],
  "verification_checks": ["string (how to verify the rewrite worked)"]
}`;

      const userPrompt = `Selected option:
${JSON.stringify(state.selected_option, null, 2)}

Direction preferences: ${JSON.stringify(direction)}
Locked constraints: ${JSON.stringify(pins)}

Discussion thread:
${chatHistory}

All recent options considered:
${JSON.stringify(recentOptions.map((o: any) => ({ id: o.id, pitch: o.pitch })))}

${contextExcerpt ? `Project documents context:\n${contextExcerpt.slice(0, 4000)}` : ""}

Synthesize the best consolidated direction with a clear rewrite plan and verification checks.`;

      let parsed: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await callLLM({
          apiKey,
          model: MODELS.FAST,
          system: systemPrompt,
          user: userPrompt,
          temperature: 0.3,
          maxTokens: 4000,
        });

        try {
          parsed = JSON.parse(extractJSON(result.content));
          if (parsed.rewrite_plan && Array.isArray(parsed.rewrite_plan)) break;
          parsed = null;
        } catch { parsed = null; }
      }

      if (!parsed) return err("Failed to generate valid synthesis after retries");

      await admin.from("note_thread_state").update({
        synthesis: parsed,
        updated_by: user.id,
      }).eq("thread_id", thread.id);

      await admin.from("note_threads").update({ status: "chosen" }).eq("id", thread.id);

      return ok({ synthesis: parsed });
    }

    // ── ACTION: get_latest_plan ──
    if (action === "get_latest_plan") {
      const { threadId } = body;
      if (!threadId) return err("Missing threadId");

      const { data: plan } = await admin
        .from("note_change_plans")
        .select("*")
        .eq("thread_id", threadId)
        .in("status", ["draft", "confirmed", "applied"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return ok({ plan: plan || null });
    }

    // ── ACTION: propose_change_plan ──
    if (action === "propose_change_plan") {
      const { threadId, contextPack: clientCtx } = body;
      if (!threadId) return err("Missing threadId");

      const { data: thread, error: threadErr } = await admin.from("note_threads").select("*").eq("id", threadId).single();
      if (threadErr || !thread) return err("Thread not found");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: thread.project_id });
      if (!access) return err("Access denied", 403);

      const { data: msgs } = await admin.from("note_thread_messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(30);

      const { data: state } = await admin.from("note_thread_state").select("*").eq("thread_id", threadId).maybeSingle();

      // Use client context pack or fall back to auto-load script
      let scriptExcerpt = "";
      if (clientCtx?.docs?.length > 0) {
        scriptExcerpt = clientCtx.docs.map((d: any) => `[${d.docType} v${d.versionNumber}]:\n${d.excerptText?.slice(0, 6000) || ''}`).join("\n\n");
      } else if (thread.version_id) {
        const ver = await resolveVersion(thread.document_id || "", "current");
        if (ver?.plaintext) {
          scriptExcerpt = buildExcerpt(ver.plaintext, "end", 12000);
        }
      }
      // Additional fallback: find any script doc
      if (!scriptExcerpt) {
        const { data: allDocs } = await admin.from("project_documents")
          .select("id, doc_type").eq("project_id", thread.project_id);
        const scriptDoc = (allDocs || []).find((d: any) =>
          PRESET_DOC_TYPES.script_pack.some(t => d.doc_type === t || d.doc_type.includes(t) || t.includes(d.doc_type))
        );
        if (scriptDoc) {
          const ver = await resolveVersion(scriptDoc.id, "current");
          if (ver?.plaintext) scriptExcerpt = buildExcerpt(ver.plaintext, "end", 12000);
        }
      }

      const noteInfo = thread.note_snapshot || {};
      const pins = state?.pinned_constraints || [];
      const chatHistory = (msgs || []).map((m: any) => `${m.role}: ${m.content}`).join("\n").slice(0, 5000);

      const systemPrompt = `You are a script development engine. Given a note, discussion thread, and document excerpts, generate a structured Change Plan as valid JSON.

You MUST respond with ONLY valid JSON matching this EXACT schema:
{
  "direction_summary": "2-3 sentence summary of what changes and why",
  "changes": [
    {
      "id": "chg_<unique>",
      "title": "short title",
      "type": "dialogue|action|character|plot|structure|tone|setup_payoff|world|other",
      "scope": "micro|scene|sequence|act|global",
      "target": {
        "scene_numbers": [number],
        "characters": ["string"],
        "locations": ["string"],
        "beats": ["string"],
        "lines": { "from": number, "to": number }
      },
      "instructions": "imperative instruction for the rewriter",
      "rationale": "why this change addresses the note",
      "risk_flags": ["string"],
      "cost_flags": ["string"],
      "acceptance_criteria": ["testable criterion"],
      "enabled": true
    }
  ],
  "impacts": [
    { "area": "continuity|character_arc|theme|budget|schedule|rating|format_rules", "note": "string" }
  ],
  "rewrite_payload": {
    "mode": "selective|full",
    "target_scene_numbers": [number],
    "patch_strategy": "surgical|rewrite_scene|rewrite_sequence",
    "prompt": "concise final rewrite prompt for applying all changes"
  }
}

Rules:
- Each change must be atomic, imperative, testable
- Include acceptance_criteria for each change
- Set mode='selective' when specific scene_numbers exist, else 'full'
- Fill rewrite_payload.prompt with a concise final prompt`;

      const userPrompt = `Note to address:
${JSON.stringify(noteInfo, null, 2)}

Pinned constraints: ${JSON.stringify(pins)}

Discussion:
${chatHistory}

Document excerpts:
${scriptExcerpt.slice(0, 8000)}

Generate a Change Plan with atomic, testable changes.`;

      let parsed: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await callLLM({
          apiKey,
          model: MODELS.FAST,
          system: systemPrompt,
          user: userPrompt,
          temperature: 0.4,
          maxTokens: 6000,
        });
        try {
          parsed = JSON.parse(extractJSON(result.content));
          if (parsed.changes && Array.isArray(parsed.changes) && parsed.changes.length > 0) break;
          parsed = null;
        } catch { parsed = null; }
      }

      if (!parsed) return err("Failed to generate valid change plan after retries");

      parsed.changes = (parsed.changes || []).map((c: any, i: number) => ({
        ...c,
        id: c.id || `chg_${Date.now()}_${i}`,
        enabled: c.enabled !== false,
      }));

      await admin.from("note_change_plans")
        .update({ status: "superseded" })
        .eq("thread_id", threadId)
        .in("status", ["draft", "confirmed"]);

      const { data: planRow, error: planErr } = await admin.from("note_change_plans").insert({
        thread_id: threadId,
        project_id: thread.project_id,
        document_id: thread.document_id,
        version_id: thread.version_id,
        status: "draft",
        plan: parsed,
        created_by: user.id,
      }).select().single();

      if (planErr) throw new Error(planErr.message);

      return ok({ planRow });
    }

    // ── ACTION: confirm_change_plan ──
    if (action === "confirm_change_plan") {
      const { planId, planPatch } = body;
      if (!planId) return err("Missing planId");

      const { data: plan, error: pErr } = await admin.from("note_change_plans").select("*").eq("id", planId).single();
      if (pErr || !plan) return err("Plan not found");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: plan.project_id });
      if (!access) return err("Access denied", 403);

      const updates: any = { status: "confirmed" };
      if (planPatch) {
        if (typeof planPatch !== 'object' || !planPatch.changes) return err("Invalid planPatch");
        updates.plan = planPatch;
      }

      await admin.from("note_change_plans")
        .update({ status: "superseded" })
        .eq("thread_id", plan.thread_id)
        .in("status", ["draft", "confirmed"])
        .neq("id", planId);

      await admin.from("note_change_plans").update(updates).eq("id", planId);

      const { data: updated } = await admin.from("note_change_plans").select("*").eq("id", planId).single();
      return ok({ planRow: updated });
    }

    // ── ACTION: apply_change_plan ──
    if (action === "apply_change_plan") {
      const { planId, forceShrink, applyScope: clientApplyScope } = body;
      if (!planId) return err("Missing planId");

      const { data: plan, error: pErr } = await admin.from("note_change_plans").select("*").eq("id", planId).single();
      if (pErr || !plan) return err("Plan not found");
      if (plan.status !== "confirmed") return err("Plan must be confirmed before applying");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: plan.project_id });
      if (!access) return err("Access denied", 403);

      const changePlan = plan.plan as any;
      const enabledChanges = (changePlan.changes || []).filter((c: any) => c.enabled !== false);
      if (enabledChanges.length === 0) return err("No enabled changes to apply");

      const { data: sourceVer } = await admin.from("project_document_versions")
        .select("plaintext, version_number, document_id")
        .eq("id", plan.version_id)
        .single();
      if (!sourceVer) return err("Source version not found");

      // ── Determine scope before building prompt ──
      const { parseScenes, detectOutOfScopeChanges, resolveApplyScope, computeScopedShrink } = await import("../_shared/sceneScope.ts");
      const scopeResult = resolveApplyScope(changePlan, clientApplyScope);
      const isSelectiveRewrite = scopeResult.mode === 'scene' && scopeResult.allowedScenes.length > 0;

      // ── Build rewrite prompt with preserve-text contract for selective rewrites ──
      const preserveContract = isSelectiveRewrite
        ? `\n\nSELECTIVE REWRITE RULES (MANDATORY):
- You are rewriting ONLY scenes: ${scopeResult.allowedScenes.join(', ')}.
- For target scenes: output the FULL scene text with the requested changes integrated. Do NOT summarize or compress.
- All NON-TARGET scenes MUST be copied VERBATIM from the source script. Do not paraphrase, shorten, or rephrase them.
- Maintain approximate length for each scene. Additions should INCREASE length, not reduce it.
- Do NOT omit any scene. The output must contain every scene from the original.`
        : '';

      const rewritePrompt = `You are a script rewriter. Apply the following changes to the script below.

Direction: ${changePlan.direction_summary || ''}

Changes to apply:
${enabledChanges.map((c: any, i: number) => `${i + 1}. [${c.type}/${c.scope}] ${c.title}: ${c.instructions}`).join('\n')}

Acceptance criteria:
${enabledChanges.flatMap((c: any) => (c.acceptance_criteria || []).map((a: string) => `- ${a}`)).join('\n')}

IMPORTANT: Return the COMPLETE rewritten script. Do not omit any sections. Preserve all formatting conventions.
Do NOT summarize or compress any part of the script. Maintain the original length and detail level.${preserveContract}`;

      const scriptText = sourceVer.plaintext || '';
      const cappedScript = scriptText.length > 12000
        ? scriptText.slice(0, 6000) + "\n[...]\n" + scriptText.slice(-6000)
        : scriptText;

      const result = await callLLM({
        apiKey,
        model: MODELS.PRO,
        system: rewritePrompt,
        user: cappedScript,
        temperature: 0.3,
        maxTokens: 16000,
      });

      const rewrittenText = result.content;

      // ── Scope-aware shrink guard ──
      const SHRINK_GUARD_THRESHOLD = 0.3;
      const verification: any = { ok: true, checks: [], warnings: [] };
      if (!rewrittenText || rewrittenText.trim().length < 50) {
        verification.ok = false;
        verification.warnings.push("Rewritten text is suspiciously short or empty");
      }

      // Compute shrink scoped to targeted scenes (selective) or full document
      const shrinkResult = computeScopedShrink(scriptText, rewrittenText, scopeResult.allowedScenes);

      if (shrinkResult.shrinkFraction > SHRINK_GUARD_THRESHOLD) {
        // Check if plan has explicit deletions
        const hasDeletions = enabledChanges.some((c: any) =>
          (c.type === 'structure' && /delet|remov/i.test(c.instructions)) ||
          /cut scene|remove scene/i.test(c.instructions)
        );

        if (!hasDeletions && !forceShrink) {
          const scopeLabel = shrinkResult.isSelective
            ? `Targeted scenes would shrink by ${shrinkResult.shrinkPct}%`
            : `Document would shrink by ${shrinkResult.shrinkPct}%`;
          return ok({
            blocked: true,
            reason: "shrink_guard",
            shrink_pct: shrinkResult.shrinkPct,
            is_selective: shrinkResult.isSelective,
            message: `${scopeLabel} which exceeds the ${Math.round(SHRINK_GUARD_THRESHOLD * 100)}% safety threshold. No explicit deletions found in the plan. Set forceShrink=true to override.`,
          });
        }
        const shrinkLabel = shrinkResult.isSelective ? 'Targeted scenes' : 'Text';
        verification.warnings.push(`${shrinkLabel} shrunk by ${shrinkResult.shrinkPct}% (threshold: ${Math.round(SHRINK_GUARD_THRESHOLD * 100)}%)`);
      }

      if (rewrittenText.length < scriptText.length * 0.3) {
        verification.warnings.push("Rewritten text is significantly shorter than original");
      }

      // ── Scene-scope enforcement ──
      let scopeCheck: any = { ok: true, mode: scopeResult.mode };
      if (isSelectiveRewrite) {
        const originalScenes = parseScenes(scriptText);
        const updatedScenes = parseScenes(rewrittenText);
        const check = detectOutOfScopeChanges(originalScenes, updatedScenes, scopeResult.allowedScenes);
        if (!check.ok) {
          return ok({
            blocked: true,
            reason: "scope_guard",
            out_of_scope_scenes: check.outOfScopeScenes,
            message: check.message,
          });
        }
        scopeCheck = { ...scopeCheck, ...check, allowedScenes: scopeResult.allowedScenes };
      }

      // ── Compute diff summary ──
      const affectedScenes = new Set<number>();
      enabledChanges.forEach((c: any) => {
        (c.target?.scene_numbers || []).forEach((sn: number) => affectedScenes.add(sn));
      });
      const diffSummary = {
        before_length: scriptText.length,
        after_length: rewrittenText.length,
        length_delta: rewrittenText.length - scriptText.length,
        length_delta_pct: scriptText.length > 0 ? Math.round(((rewrittenText.length - scriptText.length) / scriptText.length) * 100) / 100 : 0,
        affected_scene_count: affectedScenes.size,
        affected_scenes: [...affectedScenes].sort((a, b) => a - b),
        changes_applied: enabledChanges.length,
        scope_enforcement: scopeCheck,
      };

      const { data: maxVer } = await admin.from("project_document_versions")
        .select("version_number")
        .eq("document_id", sourceVer.document_id)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();
      const nextVersion = (maxVer?.version_number || 0) + 1;

      const { data: newVer, error: newVerErr } = await admin.from("project_document_versions").insert({
        document_id: sourceVer.document_id,
        version_number: nextVersion,
        plaintext: rewrittenText,
        label: `Writers' Room rewrite v${nextVersion}`,
        created_by: user.id,
        parent_version_id: plan.version_id,
        applied_change_plan_id: planId,
        applied_change_plan: changePlan,
        verification_json: verification,
        change_summary: changePlan.direction_summary || 'Applied Writers\' Room change plan',
      }).select("id").single();

      if (newVerErr) throw new Error(newVerErr.message);

      try {
        await admin.rpc("set_current_version", {
          p_document_id: sourceVer.document_id,
          p_new_version_id: newVer.id,
        });
      } catch (e: any) {
        console.warn("set_current_version failed, falling back:", e.message);
      }

      // ── Record changeset ──
      await admin.from("writers_room_changesets").insert({
        project_id: plan.project_id,
        document_id: plan.document_id,
        thread_id: plan.thread_id,
        plan_id: planId,
        plan_json: changePlan,
        before_version_id: plan.version_id,
        after_version_id: newVer.id,
        diff_summary: diffSummary,
        created_by: user.id,
      });

      await admin.from("note_change_plans").update({ status: "applied" }).eq("id", planId);
      await admin.from("note_threads").update({ status: "applied" }).eq("id", plan.thread_id);

      return ok({ newVersionId: newVer.id, verification, diffSummary });
    }

    return err(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error("notes-writers-room error:", e);
    return err(e.message || "Internal error", 500);
  }
});
