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
      const [stateRes, msgsRes] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(30),
      ]);

      const state = stateRes.data;
      const noteInfo = thread.note_snapshot || {};

      const systemPrompt = `You are a Writers' Room collaborator for film/TV development. You help writers solve creative problems in their scripts.
You are discussing a specific note/issue about the project.

Note context:
${JSON.stringify(noteInfo, null, 2)}

Direction preferences: ${JSON.stringify(state?.direction || {})}
Pinned constraints: ${JSON.stringify(state?.pinned_constraints || [])}

Be concise, creative, and practical. Focus on actionable solutions. Keep responses under 300 words.`;

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
      const { projectId, documentId, noteHash, versionId, noteSnapshot, scriptContext } = body;
      if (!projectId || !documentId || !noteHash) return err("Missing fields");

      const { data: access } = await admin.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
      if (!access) return err("Access denied", 403);

      const thread = await getOrCreateThread(projectId, documentId, noteHash, versionId, noteSnapshot);

      // Get current state, messages, and prior option sets
      const [stateRes, msgsRes, setsRes] = await Promise.all([
        admin.from("note_thread_state").select("*").eq("thread_id", thread.id).single(),
        admin.from("note_thread_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(20),
        admin.from("note_option_sets").select("*").eq("thread_id", thread.id).order("option_set_index", { ascending: true }),
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

      const systemPrompt = `You are a Writers' Room options generator for film/TV development.
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

${scriptContext ? `Script context:\n${scriptContext.slice(0, 3000)}` : ""}

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

    return err(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error("notes-writers-room error:", e);
    return err(e.message || "Internal error", 500);
  }
});
