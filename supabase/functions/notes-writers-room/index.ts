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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("Missing auth", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || supabaseServiceKey;

    // Auth check
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

    // ── Context pack builder ──
    async function buildContextPack(projectId: string, versionId?: string, userMessage?: string) {
      // Fetch project metadata
      const { data: project } = await admin.from("projects").select("title, format, budget_range, tone, target_audience, genres").eq("id", projectId).single();
      
      // Fetch current script plaintext
      let scriptText = "";
      let scriptDocInfo: any = null;
      
      if (versionId) {
        const { data: ver } = await admin.from("project_document_versions")
          .select("id, plaintext, version_number, label, created_at, document_id")
          .eq("id", versionId)
          .single();
        if (ver?.plaintext) {
          scriptText = ver.plaintext;
          scriptDocInfo = { versionId: ver.id, versionNumber: ver.version_number, label: ver.label, updatedAt: ver.created_at, documentId: ver.document_id };
        }
      }
      
      // If no version specified or no plaintext, try finding a script document
      if (!scriptText) {
        const { data: docs } = await admin.from("project_documents")
          .select("id, doc_type")
          .eq("project_id", projectId)
          .ilike("doc_type", "%script%")
          .limit(5);
        if (docs && docs.length > 0) {
          // Prefer script_pdf, script, screenplay in that order
          const sorted = docs.sort((a: any, b: any) => {
            const prio = (t: string) => t === 'script' ? 0 : t === 'screenplay' ? 1 : t === 'script_pdf' ? 2 : 3;
            return prio(a.doc_type) - prio(b.doc_type);
          });
          for (const doc of sorted) {
            // Try is_current=true first, then fall back to latest version
            let { data: curVer } = await admin.from("project_document_versions")
              .select("id, plaintext, version_number, label, created_at, document_id")
              .eq("document_id", doc.id)
              .eq("is_current", true)
              .maybeSingle();
            if (!curVer?.plaintext) {
              const { data: latestVer } = await admin.from("project_document_versions")
                .select("id, plaintext, version_number, label, created_at, document_id")
                .eq("document_id", doc.id)
                .order("version_number", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (latestVer?.plaintext) curVer = latestVer;
            }
            if (curVer?.plaintext) {
              scriptText = curVer.plaintext;
              scriptDocInfo = { versionId: curVer.id, versionNumber: curVer.version_number, label: curVer.label, updatedAt: curVer.created_at, documentId: curVer.document_id, docType: doc.doc_type };
              break;
            }
          }
        }
      }
      
      // Smart excerpt based on user message intent
      let scriptExcerpt = "";
      const msg = (userMessage || "").toLowerCase();
      const wantsEnd = /\b(end|ending|final|last|climax|conclusion|denouement|third act|act\s*3)\b/.test(msg);
      const wantsBeginning = /\b(begin|beginning|start|opening|first|act\s*1|inciting)\b/.test(msg);
      
      if (scriptText) {
        if (wantsEnd) {
          scriptExcerpt = scriptText.slice(-12000);
        } else if (wantsBeginning) {
          scriptExcerpt = scriptText.slice(0, 12000);
        } else if (scriptText.length <= 8000) {
          scriptExcerpt = scriptText;
        } else {
          // Default: last 6000 chars (most relevant for active development)
          scriptExcerpt = scriptText.slice(0, 2000) + "\n\n[...MIDDLE OMITTED...]\n\n" + scriptText.slice(-6000);
        }
      }
      
      return {
        project: project ? { title: project.title, format: project.format, genres: project.genres, tone: project.tone, targetAudience: project.target_audience, budgetRange: project.budget_range } : null,
        scriptExcerpt,
        scriptDocInfo,
        hasScript: !!scriptText,
        scriptLength: scriptText.length,
      };
    }

    // ── get_or_create thread helper ──
    async function getOrCreateThread(projectId: string, documentId: string, noteHash: string, versionId?: string, noteSnapshot?: any) {
      // Try to find existing
      const { data: existing } = await admin
        .from("note_threads")
        .select("*")
        .eq("document_id", documentId)
        .eq("note_hash", noteHash)
        .maybeSingle();

      if (existing) {
        // Update version_id if provided and different
        if (versionId && existing.version_id !== versionId) {
          await admin.from("note_threads").update({ version_id: versionId }).eq("id", existing.id);
        }
        // Ensure state row exists
        const { data: stateExists } = await admin.from("note_thread_state").select("thread_id").eq("thread_id", existing.id).maybeSingle();
        if (!stateExists) {
          await admin.from("note_thread_state").insert({ thread_id: existing.id, updated_by: user!.id });
        }
        return existing;
      }

      // Create new
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

      // Create state row
      await admin.from("note_thread_state").insert({ thread_id: newThread.id, updated_by: user!.id });
      return newThread;
    }

    // ── ACTION: get ──
    if (action === "get") {
      const { projectId, documentId, noteHash, versionId, noteSnapshot } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing projectId/documentId/noteHash");

      // Check access
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

    // ── ACTION: get_context_info ──
    if (action === "get_context_info") {
      const { projectId, versionId } = body;
      if (!projectId) return err("Missing projectId");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const ctx = await buildContextPack(projectId, versionId);
      return ok({
        project: ctx.project,
        hasScript: ctx.hasScript,
        scriptLength: ctx.scriptLength,
        scriptDocInfo: ctx.scriptDocInfo,
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
      const { projectId, documentId, noteHash, versionId, noteSnapshot, content, role } = body;
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

      // Get context for AI response
      const [stateRes, msgsRes, contextPack] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(30),
        buildContextPack(projectId, versionId, content),
      ]);

      const state = stateRes.data;
      const noteInfo = thread.note_snapshot || {};

      const projectLabel = contextPack.project ? `${contextPack.project.title} (${contextPack.project.format || 'unknown format'})` : 'Unknown project';
      const scriptLabel = contextPack.scriptDocInfo ? `Script v${contextPack.scriptDocInfo.versionNumber}${contextPack.scriptDocInfo.label ? ' — ' + contextPack.scriptDocInfo.label : ''}` : null;

      const systemPrompt = `You are the IFFY Writers' Room assistant, operating INSIDE a film/TV development application. You have DIRECT ACCESS to project documents loaded by the server.

PROJECT: ${projectLabel}
${contextPack.project?.genres ? `Genres: ${contextPack.project.genres.join(', ')}` : ''}
${contextPack.project?.tone ? `Tone: ${contextPack.project.tone}` : ''}

${contextPack.hasScript ? `SCRIPT LOADED: ${scriptLabel} (${contextPack.scriptLength} characters total)` : 'NO SCRIPT CURRENTLY LOADED.'}

Note under discussion:
${JSON.stringify(noteInfo, null, 2)}

Direction preferences: ${JSON.stringify(state?.direction || {})}
Pinned constraints: ${JSON.stringify(state?.pinned_constraints || [])}

RULES:
- You CAN read the project's script because it is provided to you as a context pack by the server. NEVER say "I can't read your script" or "paste the text."
- If the user asks to read the end/beginning/a section of the script, use the SCRIPT EXCERPT provided below.
- If script context is missing and the user asks about the script, say: "I don't currently have the script loaded. Click 'Load current script' above the chat or tell me which document to use."
- Be concise, creative, and practical. Focus on actionable solutions.
- When referencing script content, cite specific details from the excerpt.`;

      let contextBlock = "";
      if (contextPack.scriptExcerpt) {
        contextBlock = `\n\nSCRIPT EXCERPT (from ${scriptLabel || 'current script'}):\n---\n${contextPack.scriptExcerpt}\n---`;
      }

      const chatHistory = (msgsRes.data || []).map((m: any) => `${m.role}: ${m.content}`).join("\n");

      const result = await callLLM({
        apiKey,
        model: MODELS.FAST,
        system: systemPrompt + contextBlock,
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
      const { projectId, documentId, noteHash, versionId, noteSnapshot, scriptContext } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      // Get current state, messages, prior option sets, and context pack
      const [stateRes, msgsRes, setsRes, contextPack] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(20),
        admin.from("note_option_sets").select("*").eq("thread_id", thread.id).order("option_set_index", { ascending: true }),
        buildContextPack(projectId, versionId),
      ]);

      const state = stateRes.data;
      const priorSets = setsRes.data || [];
      const lastIndex = state?.last_generated_set || priorSets.length;
      const newIndex = lastIndex + 1;

      // Compact prior options for anti-repeat
      const priorCompact = priorSets.flatMap((s: any) =>
        (s.options || []).map((o: any) => ({ id: o.id, pitch: o.pitch }))
      );

      const noteInfo = thread.note_snapshot || {};
      const direction = state?.direction || {};
      const pins = state?.pinned_constraints || [];
      const chatHistory = (msgsRes.data || []).map((m: any) => `${m.role}: ${m.content}`).join("\n").slice(0, 4000);

      const projectLabel = contextPack.project ? `${contextPack.project.title} (${contextPack.project.format || 'unknown'})` : '';

      const systemPrompt = `You are the IFFY Writers' Room options generator for ${projectLabel || 'a film/TV project'}.
You have access to the project's script via the server context pack.
Generate 5-9 NEW creative solutions for the given note/issue.

HARD RULE: Do NOT repeat any prior solutions or close variants. Avoid same core idea, same twist, same mechanism.

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

${contextPack.scriptExcerpt ? `Script context (from ${contextPack.scriptDocInfo?.label || 'current script'}):\n${contextPack.scriptExcerpt.slice(0, 4000)}` : "No script loaded."}

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
          if (parsed.new_options && Array.isArray(parsed.new_options) && parsed.new_options.length >= 3) {
            break;
          }
          parsed = null;
        } catch {
          parsed = null;
        }
      }

      if (!parsed) return err("Failed to generate valid options after retries");

      // Ensure each option has an id
      parsed.new_options = parsed.new_options.map((o: any, i: number) => ({
        ...o,
        id: o.id || `opt_${newIndex}_${i}`,
      }));

      // Insert option set (retry once on conflict)
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
            // Refetch last index
            const { data: latestSets } = await admin.from("note_option_sets").select("option_set_index").eq("thread_id", thread.id).order("option_set_index", { ascending: false }).limit(1);
            insertIndex = (latestSets?.[0]?.option_set_index || insertIndex) + 1;
            continue;
          }
          throw new Error(insertErr.message);
        }
        break;
      }

      // Update state
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
      const { projectId, documentId, noteHash, versionId, noteSnapshot, scriptContext } = body;
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

${scriptContext ? `Script context:\n${scriptContext.slice(0, 3000)}` : ""}

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
        } catch {
          parsed = null;
        }
      }

      if (!parsed) return err("Failed to generate valid synthesis after retries");

      // Persist synthesis
      await admin.from("note_thread_state").update({
        synthesis: parsed,
        updated_by: user.id,
      }).eq("thread_id", thread.id);

      // Mark thread as chosen
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
      const { threadId } = body;
      if (!threadId) return err("Missing threadId");

      // Load thread
      const { data: thread, error: threadErr } = await admin.from("note_threads").select("*").eq("id", threadId).single();
      if (threadErr || !thread) return err("Thread not found");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: thread.project_id });
      if (!access) return err("Access denied", 403);

      // Load messages (last 30)
      const { data: msgs } = await admin.from("note_thread_messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(30);

      // Load state for pinned constraints
      const { data: state } = await admin.from("note_thread_state").select("*").eq("thread_id", threadId).maybeSingle();

      // Load script plaintext (capped at 12k chars)
      let scriptExcerpt = "";
      if (thread.version_id) {
        const { data: ver } = await admin.from("project_document_versions")
          .select("plaintext")
          .eq("id", thread.version_id)
          .single();
        if (ver?.plaintext) {
          const txt = ver.plaintext;
          if (txt.length <= 12000) {
            scriptExcerpt = txt;
          } else {
            scriptExcerpt = txt.slice(0, 6000) + "\n\n[...TRUNCATED...]\n\n" + txt.slice(-6000);
          }
        }
      }

      const noteInfo = thread.note_snapshot || {};
      const pins = state?.pinned_constraints || [];
      const chatHistory = (msgs || []).map((m: any) => `${m.role}: ${m.content}`).join("\n").slice(0, 5000);

      const systemPrompt = `You are a script development engine. Given a note, discussion thread, and script excerpt, generate a structured Change Plan as valid JSON.

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

Script excerpt:
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

      // Ensure IDs on changes
      parsed.changes = (parsed.changes || []).map((c: any, i: number) => ({
        ...c,
        id: c.id || `chg_${Date.now()}_${i}`,
        enabled: c.enabled !== false,
      }));

      // Supersede old draft/confirmed plans for this thread
      await admin.from("note_change_plans")
        .update({ status: "superseded" })
        .eq("thread_id", threadId)
        .in("status", ["draft", "confirmed"]);

      // Insert new plan
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
        // Basic validation
        if (typeof planPatch !== 'object' || !planPatch.changes) return err("Invalid planPatch");
        updates.plan = planPatch;
      }

      // Supersede other plans
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
      const { planId } = body;
      if (!planId) return err("Missing planId");

      const { data: plan, error: pErr } = await admin.from("note_change_plans").select("*").eq("id", planId).single();
      if (pErr || !plan) return err("Plan not found");
      if (plan.status !== "confirmed") return err("Plan must be confirmed before applying");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: plan.project_id });
      if (!access) return err("Access denied", 403);

      const changePlan = plan.plan as any;
      const enabledChanges = (changePlan.changes || []).filter((c: any) => c.enabled !== false);
      if (enabledChanges.length === 0) return err("No enabled changes to apply");

      // Load source version plaintext
      const { data: sourceVer } = await admin.from("project_document_versions")
        .select("plaintext, version_number, document_id")
        .eq("id", plan.version_id)
        .single();
      if (!sourceVer) return err("Source version not found");

      // Build rewrite prompt
      const rewritePrompt = `You are a script rewriter. Apply the following changes to the script below.

Direction: ${changePlan.direction_summary || ''}

Changes to apply:
${enabledChanges.map((c: any, i: number) => `${i + 1}. [${c.type}/${c.scope}] ${c.title}: ${c.instructions}`).join('\n')}

Acceptance criteria:
${enabledChanges.flatMap((c: any) => (c.acceptance_criteria || []).map((a: string) => `- ${a}`)).join('\n')}

IMPORTANT: Return the COMPLETE rewritten script. Do not omit any sections. Preserve all formatting conventions.`;

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

      // Minimal verification
      const verification: any = { ok: true, checks: [], warnings: [] };
      if (!rewrittenText || rewrittenText.trim().length < 50) {
        verification.ok = false;
        verification.warnings.push("Rewritten text is suspiciously short or empty");
      }
      if (rewrittenText.length < scriptText.length * 0.3) {
        verification.warnings.push("Rewritten text is significantly shorter than original");
      }

      // Get next version number
      const { data: maxVer } = await admin.from("project_document_versions")
        .select("version_number")
        .eq("document_id", sourceVer.document_id)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();
      const nextVersion = (maxVer?.version_number || 0) + 1;

      // Use set_current_version pattern: insert new version
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

      // Set as current via RPC
      try {
        await admin.rpc("set_current_version", {
          p_document_id: sourceVer.document_id,
          p_new_version_id: newVer.id,
        });
      } catch (e: any) {
        console.warn("set_current_version failed, falling back:", e.message);
      }

      // Update plan + thread status
      await admin.from("note_change_plans").update({ status: "applied" }).eq("id", planId);
      await admin.from("note_threads").update({ status: "applied" }).eq("id", plan.thread_id);

      return ok({ newVersionId: newVer.id, verification });
    }

    return err(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error("notes-writers-room error:", e);
    return err(e.message || "Internal error", 500);
  }
});
