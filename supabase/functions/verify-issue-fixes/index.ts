/**
 * verify-issue-fixes — For each staged issue, checks if it's been resolved in the new version.
 * Resolves passing issues, reopens failing ones with explanation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, parseJsonSafe } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { project_id, issue_ids, new_doc_version_id, new_text } = body as {
      project_id: string;
      issue_ids: string[];
      new_doc_version_id: string;
      new_text?: string;
    };

    if (!project_id || !Array.isArray(issue_ids) || !new_doc_version_id) {
      return json({ error: "Missing required fields" }, 400);
    }

    const db = createClient(supabaseUrl, serviceKey);

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: project_id,
    });
    if (!hasAccess) return json({ error: "Access denied" }, 403);

    // Get new version text if not provided
    let docText = new_text;
    if (!docText) {
      const { data: ver } = await db
        .from("project_document_versions")
        .select("plaintext")
        .eq("id", new_doc_version_id)
        .maybeSingle();
      docText = ver?.plaintext || "";
    }

    if (!docText?.trim()) {
      return json({ error: "No text found for new version" }, 400);
    }

    // Fetch staged issues
    const { data: issues, error: issuesError } = await db
      .from("project_issues")
      .select("*")
      .eq("project_id", project_id)
      .in("id", issue_ids);

    if (issuesError || !issues?.length) {
      return json({ error: "Issues not found" }, 404);
    }

    const issueList = issues.map((iss: any) =>
      `- ID: "${iss.id}"
  Anchor: ${iss.anchor || "General"}
  Summary: ${iss.summary}
  Detail: ${iss.detail}
  Original Evidence: ${iss.evidence_snippet || "N/A"}`
    ).join("\n\n");

    const systemPrompt = `You are a strict narrative QA reviewer. 
For each listed issue, determine if it has been adequately resolved in the provided document.
Be precise: if the fix is partial or the root problem still exists, mark it as NOT fixed.
Return JSON: { "verifications": [ { "issue_id": "...", "fixed": true/false, "why": "...", "evidence": "..." } ] }`;

    const userPrompt = `REVISED DOCUMENT (first 4000 chars):
${docText.slice(0, 4000)}

ISSUES TO VERIFY:
${issueList}

For each issue, assess whether the problem described is no longer present in the revised document.
fixed=true means the issue is fully resolved. fixed=false means it still exists or only partially changed.`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.1,
      maxTokens: 6000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);
    const verifications: Array<{
      issue_id: string;
      fixed: boolean;
      why: string;
      evidence?: string;
    }> = parsed.verifications || [];

    const results: Array<{ issue_id: string; outcome: "resolved" | "reopened" }> = [];

    for (const v of verifications) {
      const newStatus = v.fixed ? "resolved" : "open";
      const verifyStatus = v.fixed ? "pass" : "fail";

      await db.from("project_issues").update({
        status: newStatus,
        verify_status: verifyStatus,
        verify_detail: v.why,
      }).eq("id", v.issue_id);

      await db.from("project_issue_events").insert({
        issue_id: v.issue_id,
        event_type: v.fixed ? "resolved" : "reopened",
        payload: {
          new_doc_version_id,
          verify_status: verifyStatus,
          why: v.why,
          evidence: v.evidence,
        },
      });

      results.push({
        issue_id: v.issue_id,
        outcome: v.fixed ? "resolved" : "reopened",
      });
    }

    const resolvedCount = results.filter((r) => r.outcome === "resolved").length;
    const reopenedCount = results.filter((r) => r.outcome === "reopened").length;

    return json({
      ok: true,
      results,
      resolved_count: resolvedCount,
      reopened_count: reopenedCount,
      verifications,
    });
  } catch (err: any) {
    console.error("verify-issue-fixes error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
