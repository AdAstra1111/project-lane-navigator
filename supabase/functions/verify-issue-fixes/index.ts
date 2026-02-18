/**
 * verify-issue-fixes — For each staged issue, checks if it's been resolved in the new version.
 * Uses anchor-aware text windowing — not just first 4000 chars.
 * Resolves passing issues, reopens failing ones with explanation.
 * Auth: service-role client + getClaims() local JWT verification.
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

/**
 * Extract a relevant excerpt from docText for a given anchor.
 * If anchor found: returns a 2000-char window centred on it.
 * If no anchor: returns first 1400 + middle 800 + last 800 chars.
 */
function extractExcerpt(docText: string, anchor: string | null): string {
  const WIN = 2000;
  if (anchor) {
    const idx = docText.toLowerCase().indexOf(anchor.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - WIN / 2);
      const end = Math.min(docText.length, idx + WIN / 2);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < docText.length ? "…" : "";
      return prefix + docText.slice(start, end) + suffix;
    }
  }
  // Fallback: beginning + middle + end
  const len = docText.length;
  const head = docText.slice(0, 1400);
  const mid = docText.slice(Math.floor(len / 2) - 400, Math.floor(len / 2) + 400);
  const tail = docText.slice(Math.max(0, len - 800));
  return `[START]\n${head}\n\n[MIDDLE]\n${mid}\n\n[END]\n${tail}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const db = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await db.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

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

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: userId,
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
      docText = (ver as Record<string, string> | null)?.plaintext || "";
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

    // For each issue, build a per-issue verification prompt with anchor-aware excerpt
    const verifications: Array<{
      issue_id: string;
      fixed: boolean;
      why: string;
      evidence?: string;
    }> = [];

    // Batch in groups of 5 to stay within token limits
    const BATCH = 5;
    const issueArr = issues as Array<Record<string, unknown>>;

    for (let i = 0; i < issueArr.length; i += BATCH) {
      const batch = issueArr.slice(i, i + BATCH);

      const issueBlocks = batch.map((iss) => {
        const anchor = iss.anchor as string | null;
        const excerpt = extractExcerpt(docText!, anchor);
        return `--- ISSUE ID: "${iss.id}" ---
Anchor: ${anchor || "General"}
Summary: ${iss.summary}
Detail: ${iss.detail}
Original Evidence: ${iss.evidence_snippet || "N/A"}

RELEVANT DOCUMENT EXCERPT:
${excerpt}`;
      }).join("\n\n");

      const systemPrompt = `You are a strict narrative QA reviewer. 
For each listed issue, determine if it has been adequately resolved in the provided document excerpts.
Be precise: if the fix is partial or the root problem still exists, mark it as NOT fixed.
Return JSON: { "verifications": [ { "issue_id": "...", "fixed": true/false, "why": "1-2 sentences", "evidence": "quoted text from excerpt showing why" } ] }`;

      const userPrompt = `ISSUES TO VERIFY (each includes the relevant document excerpt):
${issueBlocks}

For each issue, assess whether the problem described is no longer present.
fixed=true means fully resolved. fixed=false means still present or only partially changed.`;

      const result = await callLLM({
        apiKey,
        model: MODELS.BALANCED,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.1,
        maxTokens: 4000,
      });

      const parsed = await parseJsonSafe(result.content, apiKey);
      if (Array.isArray(parsed.verifications)) {
        verifications.push(...parsed.verifications);
      }
    }

    const results: Array<{ issue_id: string; outcome: "resolved" | "reopened" }> = [];

    for (const v of verifications) {
      const newStatus = v.fixed ? "resolved" : "open";
      const verifyStatus = v.fixed ? "pass" : "fail";

      await db.from("project_issues").update({
        status: newStatus,
        verify_status: verifyStatus,
        verify_detail: v.why,
      }).eq("id", v.issue_id);

      // Write correct event_type: "verified" (with resolved/reopened info in payload)
      await db.from("project_issue_events").insert({
        issue_id: v.issue_id,
        event_type: "verified",
        payload: {
          new_doc_version_id,
          verify_status: verifyStatus,
          outcome: v.fixed ? "resolved" : "reopened",
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("verify-issue-fixes error:", err);
    return json({ error: msg }, 500);
  }
});
