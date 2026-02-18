/**
 * generate-issue-fixes — For a batch of issue IDs, generate 2–4 fix options each.
 * Stores options in issue_events with event_type="fixes_generated".
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
    const { project_id, issue_ids, current_text } = body as {
      project_id: string;
      issue_ids: string[];
      doc_version_id?: string;
      current_text: string;
    };

    if (!project_id || !Array.isArray(issue_ids) || !current_text) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: userId,
      _project_id: project_id,
    });
    if (!hasAccess) return json({ error: "Access denied" }, 403);

    // Fetch issues
    const { data: issues, error: issuesError } = await db
      .from("project_issues")
      .select("*")
      .eq("project_id", project_id)
      .in("id", issue_ids);

    if (issuesError || !issues?.length) {
      return json({ error: "Issues not found" }, 404);
    }

    const issueList = (issues as Array<Record<string, unknown>>).map((iss) =>
      `- ID: ${iss.id}
  Category: ${iss.category} | Severity: ${iss.severity} | Anchor: ${iss.anchor || "N/A"}
  Summary: ${iss.summary}
  Detail: ${iss.detail}
  Evidence: ${iss.evidence_snippet || "N/A"}`
    ).join("\n\n");

    const systemPrompt = `You are a narrative development editor. 
Generate concrete, scene-specific fix options for each issue.
For each issue, provide 2-4 distinct fix approaches that address the root problem.
Each fix option must include:
- option_label: short name (e.g. "Restructure Act 2 Opening")
- approach: 1-sentence description of the change
- instruction: specific editorial instruction for the rewriter (what exactly to change)
- impact: brief note on what this preserves vs changes
- recommended: boolean (true for exactly one option per issue)

Return JSON: { "fixes": [ { "issue_id": "...", "options": [...] } ] }`;

    const userPrompt = `Document excerpt (first 3000 chars):
${current_text.slice(0, 3000)}

Issues requiring fix options:
${issueList}

Generate 2–4 fix options per issue. Be specific about scene/beat locations using the anchor field.`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.4,
      maxTokens: 8000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);
    const fixes = parsed.fixes || [];

    // Store fix options in issue_events with correct event_type
    const events = fixes.map((f: Record<string, unknown>) => ({
      issue_id: f.issue_id,
      event_type: "fixes_generated",
      payload: { fix_options: f.options, generated_at: new Date().toISOString() },
    }));

    if (events.length > 0) {
      await db.from("project_issue_events").insert(events);
    }

    return json({ ok: true, fixes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("generate-issue-fixes error:", err);
    return json({ error: msg }, 500);
  }
});
