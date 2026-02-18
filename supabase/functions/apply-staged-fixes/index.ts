/**
 * apply-staged-fixes — Takes all staged issues (with staged_fix_choice) for a document,
 * runs ONE combined rewrite prompt, and saves a new document version.
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
    const { project_id, doc_type, base_doc_version_id, issue_ids } = body as {
      project_id: string;
      doc_type: string;
      base_doc_version_id: string;
      issue_ids: string[];
    };

    if (!project_id || !doc_type || !base_doc_version_id || !Array.isArray(issue_ids)) {
      return json({ error: "Missing required fields" }, 400);
    }

    const db = createClient(supabaseUrl, serviceKey);

    // Verify project access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: user.id,
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

    const baseText = baseVersion.plaintext || "";
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
    const fixInstructions = issues.map((iss: any) => {
      const choice = iss.staged_fix_choice as any;
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

    // Create new document version
    const newVersionNumber = (baseVersion.version_number || 1) + 1;
    const { data: newVersion, error: createError } = await db
      .from("project_document_versions")
      .insert({
        document_id: baseVersion.document_id,
        version_number: newVersionNumber,
        label: `v${newVersionNumber} (batch fix)`,
        plaintext: newText,
        created_by: user.id,
        parent_version_id: base_doc_version_id,
        change_summary: `Applied ${issues.length} staged fix(es): ${issues.map((i: any) => i.summary.slice(0, 40)).join("; ")}`,
        approval_status: "draft",
      })
      .select("id, version_number")
      .single();

    if (createError || !newVersion) {
      console.error("Version create error:", createError);
      return json({ error: "Failed to create new version" }, 500);
    }

    // Log applied events for each issue
    const events = issues.map((iss: any) => ({
      issue_id: iss.id,
      event_type: "applied",
      payload: {
        new_version_id: newVersion.id,
        base_version_id: base_doc_version_id,
        fix_choice: iss.staged_fix_choice,
      },
    }));

    await db.from("project_issue_events").insert(events);

    // Issues remain "staged" until verification confirms resolution
    return json({
      ok: true,
      new_version_id: newVersion.id,
      new_version_number: newVersion.version_number,
      applied_issue_ids: issues.map((i: any) => i.id),
      applied_count: issues.length,
    });
  } catch (err: any) {
    console.error("apply-staged-fixes error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
