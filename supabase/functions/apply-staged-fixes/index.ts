/**
 * apply-staged-fixes — Takes all staged issues (with staged_fix_choice) for a document,
 * runs ONE combined rewrite prompt, and saves a new document version.
 * Version number is computed as MAX(version_number)+1 for the document to avoid collisions.
 * Auth: service-role client + getClaims() local JWT verification.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS } from "../_shared/llm.ts";

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
    const { project_id, doc_type, base_doc_version_id, issue_ids } = body as {
      project_id: string;
      doc_type: string;
      base_doc_version_id: string;
      issue_ids: string[];
    };

    if (!project_id || !doc_type || !base_doc_version_id || !Array.isArray(issue_ids)) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: userId,
      _project_id: project_id,
    });
    if (!hasAccess) return json({ error: "Access denied" }, 403);

    // Fetch base version text
    const { data: baseVersion, error: versionError } = await db
      .from("project_document_versions")
      .select("id, document_id, version_number, plaintext")
      .eq("id", base_doc_version_id)
      .maybeSingle();

    if (versionError || !baseVersion) {
      return json({ error: "Base version not found" }, 404);
    }

    const baseText = (baseVersion as Record<string, unknown>).plaintext as string || "";
    if (!baseText.trim()) {
      return json({ error: "Base version has no text content" }, 400);
    }

    // Fetch staged issues with chosen fixes
    const { data: issues, error: issuesError } = await db
      .from("project_issues")
      .select("*")
      .eq("project_id", project_id)
      .eq("status", "staged")
      .in("id", issue_ids);

    if (issuesError || !issues?.length) {
      return json({ error: "No staged issues found with the provided IDs" }, 400);
    }

    // Build fix instruction block
    const fixInstructions = (issues as Array<Record<string, unknown>>).map((iss) => {
      const choice = iss.staged_fix_choice as Record<string, string> | null;
      return `ISSUE [${iss.id}]
Anchor: ${iss.anchor || "General"}
Category: ${iss.category} | Severity: ${iss.severity}
Problem: ${iss.summary}
Detail: ${iss.detail}
Fix to apply: ${choice?.approach || "Resolve the issue described"}
Instruction: ${choice?.instruction || "Address the problem using minimal targeted changes"}`;
    }).join("\n\n---\n\n");

    const systemPrompt = `You are a professional script/story editor performing targeted narrative surgery.
Apply ONLY the specified fixes to the document. 
RULES:
1. Preserve all content not mentioned in the fix instructions
2. Apply each fix precisely at the specified anchor location
3. Do not add new characters, subplots, or scenes unless explicitly instructed
4. Maintain the original voice, tone, and style
5. Return the COMPLETE revised document text`;

    const userPrompt = `ORIGINAL DOCUMENT:
${baseText}

=== FIXES TO APPLY ===
${fixInstructions}

=== INSTRUCTION ===
Apply ALL of the above fixes in a single pass. Preserve everything else verbatim.
Return ONLY the complete revised document text, no commentary, no JSON.`;

    const result = await callLLM({
      apiKey,
      model: MODELS.PRO,
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 16000,
    });

    const newText = result.content.trim();
    if (!newText) {
      return json({ error: "AI returned empty rewrite" }, 500);
    }

    // Compute next version number as MAX(version_number)+1 to avoid collisions
    const documentId = (baseVersion as Record<string, unknown>).document_id as string;
    const { data: maxVerRow } = await db
      .from("project_document_versions")
      .select("version_number")
      .eq("document_id", documentId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const maxVersion = (maxVerRow as Record<string, number> | null)?.version_number ?? 1;
    const newVersionNumber = maxVersion + 1;

    // Create new document version
    const { data: newVersion, error: createError } = await db
      .from("project_document_versions")
      .insert({
        document_id: documentId,
        version_number: newVersionNumber,
        label: `v${newVersionNumber} (batch fix)`,
        plaintext: newText,
        created_by: userId,
        parent_version_id: base_doc_version_id,
        change_summary: `Applied ${issues.length} staged fix(es): ${(issues as Array<Record<string, unknown>>).map((i) => (i.summary as string).slice(0, 40)).join("; ")}`,
        approval_status: "draft",
      })
      .select("id, version_number")
      .single();

    if (createError || !newVersion) {
      console.error("Version create error:", createError);
      return json({ error: "Failed to create new version" }, 500);
    }

    const newVersionData = newVersion as Record<string, unknown>;

    // Log applied events for each issue with correct event_type
    const events = (issues as Array<Record<string, unknown>>).map((iss) => ({
      issue_id: iss.id,
      event_type: "applied",
      payload: {
        new_version_id: newVersionData.id,
        base_version_id: base_doc_version_id,
        fix_choice: iss.staged_fix_choice,
      },
    }));

    await db.from("project_issue_events").insert(events);

    // Issues remain "staged" until verification confirms resolution
    return json({
      ok: true,
      new_version_id: newVersionData.id,
      new_version_number: newVersionData.version_number,
      applied_issue_ids: (issues as Array<Record<string, unknown>>).map((i) => i.id),
      applied_count: issues.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("apply-staged-fixes error:", err);
    return json({ error: msg }, 500);
  }
});
