import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const PRO_MODEL = "google/gemini-2.5-pro";

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3, maxTokens = 8000): Promise<string> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature,
        max_tokens: maxTokens,
      }),
    });
    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");
    if (response.ok) {
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000)); continue; }
        throw new Error("AI returned empty response");
      }
      let data: any;
      try { data = JSON.parse(text); } catch {
        const lb = text.lastIndexOf("}");
        if (lb > 0) { try { data = JSON.parse(text.substring(0, lb + 1)); } catch { throw new Error("Unparseable AI response"); } }
        else throw new Error("Unparseable AI response");
      }
      return data.choices?.[0]?.message?.content || "";
    }
    const t = await response.text();
    console.error(`AI error attempt ${attempt + 1}:`, response.status, t);
    if (response.status >= 500 && attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000)); continue; }
    throw new Error(`AI call failed: ${response.status}`);
  }
  throw new Error("AI call failed after retries");
}

function extractJSON(raw: string): string {
  let c = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!c.trim().startsWith("{") && !c.trim().startsWith("[")) { const i = c.indexOf("{"); if (i >= 0) c = c.slice(i); }
  const last = c.lastIndexOf("}");
  if (last >= 0) c = c.slice(0, last + 1);
  return c.trim();
}

// ═══ Chunk document text ═══
function chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    chunks.push(text.slice(pos, end));
    pos += chunkSize - overlap;
  }
  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) throw new Error("Not authenticated");

    const body = await req.json();
    const { action } = body;

    // ═══════════════════════════════════════════════
    // ACTION: chunk-document (index a doc version)
    // ═══════════════════════════════════════════════
    if (action === "chunk-document") {
      const { projectId, versionId, docType, text } = body;
      if (!projectId || !versionId || !text) throw new Error("Missing projectId/versionId/text");

      // Delete old chunks for this version
      await sb.from("project_doc_chunks").delete().eq("version_id", versionId);

      const chunks = chunkText(text);
      const rows = chunks.map((chunk_text, i) => ({
        project_id: projectId,
        version_id: versionId,
        doc_type: docType || "unknown",
        chunk_index: i,
        chunk_text,
      }));

      if (rows.length > 0) {
        const { error } = await sb.from("project_doc_chunks").insert(rows);
        if (error) throw error;
      }

      return new Response(JSON.stringify({ chunked: rows.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════
    // ACTION: ask (RAG-grounded Q&A)
    // ═══════════════════════════════════════════════
    if (action === "ask") {
      const { projectId, scope, docVersionId, docType, queryText, selectedSpan } = body;
      if (!projectId || !queryText) throw new Error("Missing projectId/queryText");

      // Save query
      const { data: queryRow, error: qErr } = await sb.from("doc_queries").insert({
        project_id: projectId, user_id: user.id, doc_type: docType,
        doc_version_id: docVersionId, scope: scope || "current_doc", query_text: queryText,
      }).select("id").single();
      if (qErr) throw qErr;

      // Retrieve relevant chunks
      let chunks: any[] = [];
      if (scope === "current_doc" && docVersionId) {
        // Text search in current doc version chunks
        const { data } = await sb.rpc("search_project_doc_chunks", {
          p_project_id: projectId, search_query: queryText, match_count: 8,
        });
        chunks = (data || []).filter((c: any) => c.version_id === docVersionId);
        // Fallback: if no FTS hits, grab all chunks for this version
        if (chunks.length === 0) {
          const { data: allChunks } = await sb.from("project_doc_chunks")
            .select("*").eq("version_id", docVersionId).order("chunk_index").limit(20);
          chunks = allChunks || [];
        }
      } else {
        // Full package: search across all chunks
        const { data } = await sb.rpc("search_project_doc_chunks", {
          p_project_id: projectId, search_query: queryText, match_count: 15,
        });
        chunks = data || [];
      }

      const contextText = chunks.map((c: any) =>
        `[${c.doc_type} chunk ${c.chunk_index}]\n${c.chunk_text}`
      ).join("\n\n---\n\n");

      const spanNote = selectedSpan ? `\nUser highlighted: "${selectedSpan.text || ''}"` : "";

      const systemPrompt = `You are a document analyst for a film/TV development project.
Answer the user's question using ONLY the provided context.
If the context doesn't contain enough information, say what's missing and suggest where to add it.
Include citations in your answer as [doc_type, chunk N].
Be concise and specific.`;

      const userPrompt = `CONTEXT:\n${contextText || "(No indexed content found — document may need indexing)"}\n${spanNote}\n\nQUESTION: ${queryText}`;

      const answer = await callAI(apiKey, MODEL, systemPrompt, userPrompt, 0.2, 4000);

      // Extract citation references
      const citationMatches = [...answer.matchAll(/\[([^\]]+),\s*chunk\s*(\d+)\]/gi)];
      const citations = citationMatches.map(m => ({
        doc_type: m[1], chunk_index: parseInt(m[2]),
        snippet: chunks.find((c: any) => c.doc_type === m[1] && c.chunk_index === parseInt(m[2]))?.chunk_text?.slice(0, 200) || "",
      }));

      // Save answer
      await sb.from("doc_query_answers").insert({
        doc_query_id: queryRow.id, answer_text: answer, citations,
      });

      return new Response(JSON.stringify({ answer, citations, queryId: queryRow.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════
    // ACTION: propose-change
    // ═══════════════════════════════════════════════
    if (action === "propose-change") {
      const { projectId, targetDocType, targetVersionId, proposalText, selectedSpan } = body;
      if (!projectId || !targetDocType || !proposalText) throw new Error("Missing required fields");

      // Get current doc text
      let docText = "";
      if (targetVersionId) {
        const { data: ver } = await sb.from("project_document_versions")
          .select("plaintext").eq("id", targetVersionId).single();
        docText = ver?.plaintext || "";
      }

      // Get project qualifications
      const { data: proj } = await sb.from("projects")
        .select("format, season_episode_count, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, qualifications")
        .eq("id", projectId).single();

      const durRange = (proj as any)?.episode_target_duration_min_seconds && (proj as any)?.episode_target_duration_max_seconds
        ? `${(proj as any).episode_target_duration_min_seconds}–${(proj as any).episode_target_duration_max_seconds}s`
        : `${proj?.episode_target_duration_seconds || 'N/A'}s`;
      const canonBlock = proj ? `CANONICAL QUALIFICATIONS:
- Format: ${proj.format || 'film'}
- Season Episode Count: ${proj.season_episode_count || 'N/A'}
- Episode Duration Range: ${durRange}
IMPORTANT: Never deviate from these canonical values.` : "";

      const spanNote = selectedSpan?.text ? `\nFocus on this section: "${selectedSpan.text}"` : "";

      const systemPrompt = `You are editing a ${targetDocType} document for a film/TV project.
${canonBlock}

Generate a REVISED version of the document incorporating the user's proposed change.
Output ONLY the revised document text. No commentary or explanations.
Preserve all content not affected by the change.
Maintain the document's existing style and format.`;

      const draft = await callAI(apiKey, PRO_MODEL, systemPrompt,
        `CURRENT DOCUMENT:\n${docText}\n${spanNote}\n\nPROPOSED CHANGE:\n${proposalText}`,
        0.3, 12000);

      // Create draft version
      const { data: versions } = await sb.from("project_document_versions")
        .select("version_number, document_id").eq("id", targetVersionId).single();

      let draftVersionId: string | null = null;
      if (versions) {
        const { data: newVer, error: vErr } = await sb.from("project_document_versions").insert({
          document_id: versions.document_id,
          version_number: (versions.version_number || 0) + 100, // high number for draft
          label: `Draft: ${proposalText.slice(0, 40)}...`,
          plaintext: draft,
          created_by: user.id,
          change_summary: `Proposal: ${proposalText}`,
          status: "draft",
        }).select("id").single();
        if (!vErr && newVer) draftVersionId = newVer.id;
      }

      // Save proposal
      const { data: proposal, error: pErr } = await sb.from("doc_change_proposals").insert({
        project_id: projectId, user_id: user.id, target_doc_type: targetDocType,
        target_version_id: targetVersionId, proposal_text: proposalText,
        selected_span: selectedSpan, status: "draft", draft_new_version_id: draftVersionId,
      }).select("id").single();
      if (pErr) throw pErr;

      return new Response(JSON.stringify({ proposalId: proposal.id, draftVersionId, draftText: draft }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════
    // ACTION: test-proposal
    // ═══════════════════════════════════════════════
    if (action === "test-proposal") {
      const { proposalId } = body;
      if (!proposalId) throw new Error("Missing proposalId");

      const { data: proposal } = await sb.from("doc_change_proposals")
        .select("*").eq("id", proposalId).single();
      if (!proposal) throw new Error("Proposal not found");

      // Load current and draft texts
      let currentText = "", draftText = "";
      if (proposal.target_version_id) {
        const { data: cur } = await sb.from("project_document_versions")
          .select("plaintext").eq("id", proposal.target_version_id).single();
        currentText = cur?.plaintext || "";
      }
      if (proposal.draft_new_version_id) {
        const { data: dft } = await sb.from("project_document_versions")
          .select("plaintext").eq("id", proposal.draft_new_version_id).single();
        draftText = dft?.plaintext || "";
      }

      // Load project for canonical check
      const { data: proj } = await sb.from("projects")
        .select("format, season_episode_count, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, qualifications, resolved_qualifications")
        .eq("id", proposal.project_id).single();

      const docDurRange = (proj as any)?.episode_target_duration_min_seconds && (proj as any)?.episode_target_duration_max_seconds
        ? `${(proj as any).episode_target_duration_min_seconds}–${(proj as any).episode_target_duration_max_seconds}s`
        : `${proj?.episode_target_duration_seconds || 'N/A'}s`;

      // Run AI test battery
      const systemPrompt = `You are a quality analyst for film/TV document changes.
Analyze the proposed document revision against the original.
Return a JSON object with these fields:
{
  "canonical_test": { "pass": boolean, "issues": ["..."] },
  "continuity_test": { "pass": boolean, "conflicts": ["..."] },
  "style_test": { "pass": boolean, "notes": ["..."] },
  "impact_scores": { "clarity": 0-100, "stakes": 0-100, "pacing": 0-100, "overall": 0-100 },
  "stale_dependencies": ["list of doc_types that would become stale"],
  "summary": "one-paragraph impact summary",
  "recommendation": "approve" | "revise" | "reject"
}

CANONICAL CONSTRAINTS:
- Format: ${proj?.format || 'film'}
- Season Episode Count: ${proj?.season_episode_count || 'N/A'}
- Episode Duration Range: ${docDurRange}

Check for:
1. Canonical constraint violations (wrong episode count, format deviations)
2. Continuity conflicts (contradicts character bible, season arc, episode grid)
3. Style/tone consistency with the document type
4. Quality impact (clarity, stakes, pacing improvement or regression)
5. Which other doc types would need updates if this change is applied`;

      const testResult = await callAI(apiKey, MODEL, systemPrompt,
        `ORIGINAL (${proposal.target_doc_type}):\n${currentText}\n\nPROPOSED REVISION:\n${draftText}\n\nCHANGE INTENT: ${proposal.proposal_text}`,
        0.2, 4000);

      let report: any;
      try { report = JSON.parse(extractJSON(testResult)); }
      catch { report = { summary: testResult, recommendation: "revise" }; }

      // Update proposal with test report
      await sb.from("doc_change_proposals")
        .update({ test_report: report, status: "tested" })
        .eq("id", proposalId);

      return new Response(JSON.stringify({ report, proposalId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════
    // ACTION: apply-proposal
    // ═══════════════════════════════════════════════
    if (action === "apply-proposal") {
      const { proposalId } = body;
      if (!proposalId) throw new Error("Missing proposalId");

      const { data: proposal } = await sb.from("doc_change_proposals")
        .select("*").eq("id", proposalId).single();
      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status !== "tested") throw new Error("Proposal must be tested before applying");

      // Get draft version and promote it
      if (proposal.draft_new_version_id) {
        // Update status to final
        await sb.from("project_document_versions")
          .update({ status: "draft", label: `Applied: ${proposal.proposal_text.slice(0, 40)}` })
          .eq("id", proposal.draft_new_version_id);

        // Get document info to update latest_version_id in package
        const { data: ver } = await sb.from("project_document_versions")
          .select("document_id, version_number").eq("id", proposal.draft_new_version_id).single();
        if (ver) {
          // Renumber to proper sequence
          const { data: maxVer } = await sb.from("project_document_versions")
            .select("version_number").eq("document_id", ver.document_id)
            .neq("id", proposal.draft_new_version_id)
            .order("version_number", { ascending: false }).limit(1).single();
          const newNum = (maxVer?.version_number || 0) + 1;
          await sb.from("project_document_versions")
            .update({ version_number: newNum })
            .eq("id", proposal.draft_new_version_id);
        }

        // Chunk the new version for future RAG
        const { data: draftVer } = await sb.from("project_document_versions")
          .select("plaintext").eq("id", proposal.draft_new_version_id).single();
        if (draftVer?.plaintext) {
          await sb.from("project_doc_chunks").delete().eq("version_id", proposal.draft_new_version_id);
          const chunks = chunkText(draftVer.plaintext);
          const rows = chunks.map((chunk_text, i) => ({
            project_id: proposal.project_id,
            version_id: proposal.draft_new_version_id,
            doc_type: proposal.target_doc_type,
            chunk_index: i,
            chunk_text,
          }));
          if (rows.length > 0) await sb.from("project_doc_chunks").insert(rows);
        }
      }

      // Mark stale dependencies if test report identified them
      const staleDeps = proposal.test_report?.stale_dependencies || [];

      // Update proposal status
      await sb.from("doc_change_proposals")
        .update({ status: "applied" })
        .eq("id", proposalId);

      return new Response(JSON.stringify({
        applied: true, proposalId,
        draftVersionId: proposal.draft_new_version_id,
        staleDependencies: staleDeps,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
